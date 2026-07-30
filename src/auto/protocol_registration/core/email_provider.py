# -*- coding: utf-8 -*-
"""
邮箱来源调度层。

支持 Outlook 账号池，以及通过 gmail_IMAP 本地服务获取 OTP。
"""
import json
import logging
import re
import time
from datetime import datetime
from email.utils import parsedate_to_datetime
from urllib import error as urllib_error
from urllib import request as urllib_request

logger = logging.getLogger(__name__)


_replacement_client = None
_replacement_accounts: dict[str, dict] = {}


def _get_replacement_client():
    """延迟创建补号服务客户端，避免非 replacement 模式读取后台配置。"""
    global _replacement_client
    if _replacement_client is not None:
        return _replacement_client

    from config import (
        REPLACEMENT_ACCOUNT_ID,
        REPLACEMENT_ADMIN_PASSWORD,
        REPLACEMENT_API_BASE,
    )
    from core.replacement_client import ReplacementServiceClient

    _replacement_client = ReplacementServiceClient(
        base_url=REPLACEMENT_API_BASE,
        admin_password=REPLACEMENT_ADMIN_PASSWORD or None,
        account_id=REPLACEMENT_ACCOUNT_ID or None,
    )
    return _replacement_client


def acquire_email() -> str:
    """按配置领取一个用于注册的邮箱地址。"""
    from config import OTP_PROVIDER, REGISTER_EMAIL

    if OTP_PROVIDER == "replacement":
        if REGISTER_EMAIL:
            raise RuntimeError(
                "replacement 模式不支持固定 REGISTER_EMAIL，请让程序从补号账号列表领取邮箱"
            )
        account = _get_replacement_client().acquire_account()
        email = str(account.get("email") or "").strip()
        if not email:
            raise RuntimeError("补号账号列表返回空邮箱")
        _replacement_accounts[email.lower()] = dict(account)
        return email

    if OTP_PROVIDER == "gmail_imap":
        if REGISTER_EMAIL:
            return REGISTER_EMAIL.strip()
        raise RuntimeError(
            "Gmail IMAP 模式不会自动领取邮箱，请在 config/register.py 配置 REGISTER_EMAIL"
        )

    from core.outlook_client import pick_account

    account = pick_account()
    return account.email


def wait_for_otp(email: str, after_ts: float, excluded_codes: set[str] | None = None) -> str:
    """
    等待并返回该邮箱最新的 ChatGPT OTP（6 位数字字符串）。

    Args:
        email: 目标邮箱
        after_ts: UTC 时间戳，只看比这更新的邮件，避免取到旧 OTP
    """
    from config import OTP_PROVIDER

    if OTP_PROVIDER == "replacement":
        normalized = str(email or "").strip().lower()
        account = _replacement_accounts.get(normalized)
        if account is None:
            client = _get_replacement_client()
            if client.selected_account and str(client.selected_account.get("email") or "").strip().lower() == normalized:
                account = client.selected_account
        if account is None:
            raise RuntimeError(f"未找到补号邮箱上下文: {email}")
        return _get_replacement_client().wait_for_otp(
            account, after_ts=after_ts, excluded_codes=excluded_codes
        )

    if OTP_PROVIDER == "gmail_imap":
        return fetch_gmail_imap_otp(email, after_ts)

    from core.outlook_client import fetch_latest_otp

    return fetch_latest_otp(email, after_ts=after_ts)


def mark_registration_success(email: str) -> None:
    """把本次成功注册的补号账号标记为 registered。"""
    from config import OTP_PROVIDER

    if OTP_PROVIDER != "replacement":
        return
    normalized = str(email or "").strip().lower()
    account = _replacement_accounts.get(normalized)
    if account is None:
        raise RuntimeError(f"未找到补号邮箱上下文，无法回写状态: {email}")
    _get_replacement_client().mark_registered(account)


def close() -> None:
    """关闭 replacement 模式可能创建的 Roxy CDP bridge。"""
    global _replacement_client
    if _replacement_client is not None:
        _replacement_client.close()
        _replacement_client = None
    _replacement_accounts.clear()


def _parse_message_timestamp(value) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value) if value > 10_000_000_000 else float(value)

    text = str(value).strip()
    try:
        return parsedate_to_datetime(text).timestamp()
    except (TypeError, ValueError, OverflowError):
        pass

    try:
        normalized = text.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized).timestamp()
    except (TypeError, ValueError, OverflowError):
        return None


def _post_gmail_imap_json(url: str, body: dict, timeout: float) -> dict:
    payload = json.dumps(body).encode("utf-8")
    request = urllib_request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib_request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            status = response.status
    except urllib_error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        status = exc.code
    except urllib_error.URLError as exc:
        raise RuntimeError(f"gmail_IMAP 验证码服务不可用: {exc.reason}") from exc

    try:
        parsed = json.loads(raw) if raw else {}
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"gmail_IMAP 验证码服务返回非 JSON: {raw[:200]}") from exc
    return {"status": status, "payload": parsed}


def fetch_gmail_imap_otp(
    email: str,
    after_ts: float | None,
    *,
    post_json=None,
    sleep_fn=time.sleep,
    max_wait: int | None = None,
    poll_interval: int | None = None,
) -> str:
    """通过 gmail_IMAP 本地接口轮询指定邮箱的最新验证码。"""
    from config import (
        GMAIL_IMAP_API_BASE,
        GMAIL_IMAP_API_TIMEOUT,
        GMAIL_IMAP_MAX_WAIT,
        GMAIL_IMAP_POLL_INTERVAL,
    )

    if not email:
        raise ValueError("邮箱不能为空")

    endpoint = f"{GMAIL_IMAP_API_BASE.rstrip('/')}/api/verification-code/latest"
    request_fn = post_json or _post_gmail_imap_json
    timeout_seconds = max_wait if max_wait is not None else GMAIL_IMAP_MAX_WAIT
    interval_seconds = poll_interval if poll_interval is not None else GMAIL_IMAP_POLL_INTERVAL
    deadline = time.monotonic() + max(0, timeout_seconds)
    last_message = "CODE_NOT_FOUND"

    while True:
        response = request_fn(
            endpoint,
            {"account": email},
            GMAIL_IMAP_API_TIMEOUT,
        )
        payload = response.get("payload") or {}
        last_message = str(payload.get("message") or payload.get("error") or last_message)
        code = str(payload.get("code") or "").strip()
        message_ts = _parse_message_timestamp(payload.get("date"))

        is_new_enough = after_ts is None or (
            message_ts is not None and message_ts > after_ts
        )
        if (
            response.get("status") == 200
            and payload.get("ok") is True
            and re.fullmatch(r"\d{6}", code)
            and is_new_enough
        ):
            logger.info(f"[GmailIMAP] 已获取验证码: {email}")
            return code

        if time.monotonic() >= deadline:
            raise TimeoutError(
                f"gmail_IMAP 验证码等待超时: {email}, last={last_message}"
            )
        sleep_fn(max(0, interval_seconds))
