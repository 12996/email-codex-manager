# -*- coding: utf-8 -*-
"""
注册后处理模块：
    1. 拉取 /api/auth/session，从中抽取 accessToken / user 信息
    2. 设置 2FA（TOTP），返回 secret
    3. 把账号信息（邮箱 + accessToken + TOTP secret）落盘成 JSON

整体复用注册阶段的 BrowserSession（同一 cookie jar / 同一 IP / 同一 UA），
避免再起新会话被风控关联或缺失登录态。
"""
import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
import threading

import pyotp

from core.session import BrowserSession

logger = logging.getLogger(__name__)

# 输出目录（与项目根 .claude/ 工作区分离，单独放在 accounts/）
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_ACCOUNTS_DIR = _PROJECT_ROOT / "accounts"
_BATCH_ARCHIVE_LOCK = threading.RLock()


def _safe_registration_token_file_name(email: str) -> str:
    normalized = str(email or "").strip().lower()
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", normalized)
    if safe in {"", ".", ".."}:
        safe = "unknown-email"
    return f"{safe}.txt"


def save_registration_access_token_file(
    *,
    email: str,
    access_token: str,
    output_dir: str | Path | None = None,
) -> str | None:
    """按邮箱文件名保存纯 access token 文本；未配置目录时跳过。"""
    normalized_email = str(email or "").strip().lower()
    normalized_token = str(access_token or "").strip()
    if not normalized_email:
        raise ValueError("registration email is required before saving access token")
    if not normalized_token:
        raise ValueError("registration access token is required before saving token file")

    configured_dir = output_dir
    if configured_dir in (None, ""):
        configured_dir = os.environ.get("REGISTRATION_TOKEN_OUTPUT_DIR", "")
    if not str(configured_dir or "").strip():
        return None

    output_root = Path(configured_dir).expanduser()
    output_root.mkdir(parents=True, exist_ok=True)
    file_path = output_root / _safe_registration_token_file_name(normalized_email)
    file_path.write_text(normalized_token, encoding="utf-8")
    logger.info("[Save] 注册 token 文件已写入: %s", file_path)
    return str(file_path)


def _account_material_line(email: str, row: dict | None = None) -> str:
    """优先输出 Outlook 原始素材；没有素材时退回邮箱地址。"""
    if row:
        return row.get("original_email_line") or row.get("email") or email
    return email


def _account_copy_line(material_line: str, access_token: str, totp_secret: str | None = None) -> str:
    """生成包含 token 的整行归档，方便从批次汇总文件里复制。"""
    return f"{material_line}----{access_token}----{totp_secret}" if totp_secret else f"{material_line}----{access_token}"


def create_batch_archive_dir(count: int, workers: int = 1) -> Path:
    """为一次运行创建批次归档目录，例如 accounts/20260509-10个-3线程。"""
    day = datetime.now().strftime("%Y%m%d")
    base_name = f"{day}-{count}个" if workers <= 1 else f"{day}-{count}个-{workers}线程"
    folder = _ACCOUNTS_DIR / base_name
    suffix = 2
    while folder.exists():
        folder = _ACCOUNTS_DIR / f"{base_name}-{suffix}"
        suffix += 1
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "注册成功的邮箱.txt").write_text("", encoding="utf-8")
    (folder / "注册成功的token.txt").write_text("", encoding="utf-8")
    (folder / "注册成功整行.txt").write_text("", encoding="utf-8")
    (folder / "注册成功账号.json").write_text("[]\n", encoding="utf-8")
    return folder


def _append_line(path: Path, line: str) -> None:
    with path.open("a", encoding="utf-8", newline="\n") as f:
        f.write(line + "\n")


def _append_batch_archive(
    *,
    row_id: int,
    email: str,
    access_token: str,
    totp_secret: str | None,
    email_source: str | None,
    proxy_used: str | None,
    extra: dict,
    batch_dir: Path | None,
) -> Path:
    """把注册成功账号追加到本次批次目录的 TXT/JSON 文件中。"""
    from core import db

    folder = batch_dir or create_batch_archive_dir(count=1)
    row = db.get_account(row_id) or {}
    folder.mkdir(parents=True, exist_ok=True)
    material_line = _account_material_line(email, row)
    copy_line = _account_copy_line(material_line, access_token, totp_secret)
    archive = {
        "id": row_id,
        "email": email,
        "email_source": email_source,
        "proxy_used": proxy_used,
        "access_token": access_token,
        "totp_secret": totp_secret,
        "material_line": material_line,
        "copy_line": copy_line,
        "saved_at": datetime.now().isoformat(timespec="seconds"),
        "row": row,
        "extra": extra,
    }

    with _BATCH_ARCHIVE_LOCK:
        _append_line(folder / "注册成功的邮箱.txt", material_line)
        _append_line(folder / "注册成功的token.txt", access_token)
        _append_line(folder / "注册成功整行.txt", copy_line)

        json_path = folder / "注册成功账号.json"
        try:
            rows = json.loads(json_path.read_text(encoding="utf-8")) if json_path.exists() else []
        except Exception:
            rows = []
        if not isinstance(rows, list):
            rows = []
        rows.append(archive)
        json_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return folder


def follow_oauth_callback(session: BrowserSession, continue_url: str) -> str:
    """
    步骤12.5: 跟随 create_account 返回的 continue_url，完成 OAuth 回调。

    create_account 成功后返回的 continue_url 一般指向
        https://auth.openai.com/authorize/continue?...
    它会再 302 到
        https://chatgpt.com/api/auth/callback/openai?code=...&state=...
    回调请求会让 chatgpt.com 设置 `__Secure-next-auth.session-token` cookie，
    之后 /api/auth/session 才能返回 accessToken。

    Returns:
        重定向链最终落点 URL（一般是 chatgpt.com 站内地址）
    """
    if not continue_url:
        raise ValueError("continue_url 为空，无法完成 OAuth 回调")

    headers = session.get_auth_navigate_headers(referer="https://auth.openai.com/about-you")
    headers["sec-fetch-site"] = "same-origin"

    logger.info(f"[OAuth回调] 跟随 continue_url 完成 OAuth 回调...")
    if getattr(session, "uses_roxy_cdp", False):
        resp = session.navigate(continue_url, headers=headers, allow_redirects=True)
    else:
        resp = session.get(continue_url, headers=headers, allow_redirects=True)
    logger.info(f"[OAuth回调] 完成, 最终落点: {resp.url}")
    return resp.url


def fetch_session(session: BrowserSession) -> dict:
    """
    GET https://chatgpt.com/api/auth/session
    注册成功后立刻调用，拿到 accessToken / user / account / expires。

    Returns:
        完整 session JSON，包含字段:
            - accessToken: str (Bearer token, 用于 backend-api 调用)
            - user: {id, name, email, idp, iat, mfa}
            - account: {id, planType, structure, ...}
            - expires: ISO 时间字符串
    """
    url = "https://chatgpt.com/api/auth/session"
    headers = session.get_chatgpt_headers(referer="https://chatgpt.com/")

    logger.info("[Session] 拉取 ChatGPT session 信息...")
    resp = session.get(url, headers=headers)
    resp.raise_for_status()
    data = resp.json()

    if not data.get("accessToken"):
        logger.error(f"[Session] 响应中没有 accessToken: {data}")
        raise RuntimeError("未拿到 accessToken，登录态可能未建立")

    user = data.get("user") or {}
    account = data.get("account") or {}
    logger.info(
        f"[Session] 成功，user_id={user.get('id')}, email={user.get('email')}, "
        f"plan={account.get('planType')}, mfa={user.get('mfa')}"
    )
    return data


def _enroll_totp(session: BrowserSession, access_token: str) -> tuple[str, str]:
    """
    步骤6: 注册 TOTP，返回 (secret, session_id)
    """
    url = "https://chatgpt.com/backend-api/accounts/mfa/enroll"
    headers = _mfa_headers(session, access_token)

    body = json.dumps({"factor_type": "totp"})

    logger.info("[2FA] 注册 TOTP...")
    resp = session.post(url, headers=headers, data=body)
    if resp.status_code != 200:
        logger.error(f"[2FA] enroll 失败 {resp.status_code}: {resp.text}")
        resp.raise_for_status()
    data = resp.json()
    secret = data.get("secret")
    session_id = data.get("session_id")
    if not secret or not session_id:
        raise RuntimeError(f"enroll 响应字段缺失: {data}")
    logger.info("[2FA] TOTP secret 已获取")
    return secret, session_id


def _activate_totp(
    session: BrowserSession,
    access_token: str,
    secret: str,
    session_id: str,
) -> bool:
    """
    步骤7: 用 secret 生成 6 位 TOTP 码，激活 2FA。
    """
    url = "https://chatgpt.com/backend-api/accounts/mfa/user/activate_enrollment"
    headers = _mfa_headers(session, access_token)

    totp_code = pyotp.TOTP(secret).now()
    body = json.dumps({
        "code": totp_code,
        "factor_type": "totp",
        "session_id": session_id,
    })

    logger.info("[2FA] 激活 enrollment")
    resp = session.post(url, headers=headers, data=body)
    if resp.status_code != 200:
        logger.error(f"[2FA] activate 失败 {resp.status_code}: {resp.text}")
        resp.raise_for_status()
    data = resp.json()
    if not data.get("success"):
        raise RuntimeError(f"激活返回 success=false: {data}")
    return True


def _mfa_headers(session: BrowserSession, access_token: str) -> dict:
    """Build the same authenticated ChatGPT headers used by the Roxy MFA flow."""
    headers = session.get_chatgpt_headers(referer="https://chatgpt.com/")
    headers["authorization"] = f"Bearer {access_token}"
    headers["oai-device-id"] = session.device_id
    headers["oai-language"] = "zh-CN"
    return headers


def _fetch_mfa_info(session: BrowserSession, access_token: str) -> dict:
    """Read MFA state in the current browser context."""
    url = "https://chatgpt.com/backend-api/accounts/mfa_info"
    resp = session.get(url, headers=_mfa_headers(session, access_token))
    if resp.status_code != 200:
        logger.error(f"[2FA] mfa_info 失败 {resp.status_code}: {resp.text[:240]}")
        resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, dict):
        raise RuntimeError(f"mfa_info 响应格式错误: {type(data).__name__}")
    return data


def _setup_direct_2fa(session: BrowserSession, access_token: str) -> str:
    """Enable TOTP directly, matching roxy_register_openai.js."""
    before = _fetch_mfa_info(session, access_token)
    if before.get("mfa_enabled_v2"):
        raise RuntimeError("账号已启用 MFA，无法取得本次注册的 TOTP secret")

    secret, session_id = _enroll_totp(session, access_token)
    _activate_totp(session, access_token, secret, session_id)

    after = _fetch_mfa_info(session, access_token)
    if not after.get("mfa_enabled_v2"):
        raise RuntimeError("MFA 激活接口成功，但 mfa_info 未确认已启用")
    return secret


def setup_2fa(
    session: BrowserSession,
    email: str,
    access_token: str | None = None,
) -> str:
    """
    完整的 2FA 设置流程，直接复用注册后的 accessToken。
    不触发 password re-auth、email OTP 或 OAuth 回调。

    Args:
        session: 已完成注册的会话
        email: 账号邮箱（保留参数以兼容现有调用）
        access_token: 注册完成后已获取的 accessToken

    Returns:
        TOTP secret（Base32 字符串），可直接用于 pyotp.TOTP() 生成 6 位动态码
    """
    logger.info("=" * 60)
    logger.info("开始设置 2FA")
    logger.info("=" * 60)

    current_token = str(access_token or "").strip()
    if not current_token:
        current_token = str(fetch_session(session).get("accessToken") or "").strip()
    if not current_token:
        raise RuntimeError("2FA 缺少注册后的 accessToken")

    secret = _setup_direct_2fa(session, current_token)
    logger.info("✅ 2FA 设置完成，TOTP secret 已激活")
    return secret


def save_account_data(
    email: str,
    access_token: str,
    totp_secret: str | None = None,
    extra: dict | None = None,
    output_path: Path | None = None,  # 兼容老接口，已废弃
    email_source: str | None = None,
    proxy_used: str | None = None,
    batch_dir: Path | None = None,
) -> int:
    """
    将账号信息保存到本地 JSON/TXT 文件存储。
    返回新插入/更新的 row id。
    """
    from core.db import insert_account
    extra = extra or {}
    user = extra.get("user") or {}
    account = extra.get("account") or {}

    row_id = insert_account(
        email=email,
        access_token=access_token,
        totp_secret=totp_secret,
        user_id=user.get("id"),
        user_name=user.get("name"),
        plan_type=account.get("planType"),
        expires_at=extra.get("expires"),
        device_id=extra.get("device_id"),
        proxy_used=proxy_used,
        email_source=email_source,
        extra=extra,
    )
    batch_folder = _append_batch_archive(
        row_id=row_id,
        email=email,
        access_token=access_token,
        totp_secret=totp_secret,
        email_source=email_source,
        proxy_used=proxy_used,
        extra=extra,
        batch_dir=batch_dir,
    )
    save_registration_access_token_file(
        email=email,
        access_token=access_token,
    )
    logger.info(f"[Save] 账号已写入 DB, id={row_id}, email={email}")
    logger.info(f"[Save] 批次归档目录: {batch_folder}")
    return row_id
