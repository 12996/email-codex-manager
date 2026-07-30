"""客户端：从 gmail_IMAP 补号服务领取邮箱并读取注册验证码。"""

from __future__ import annotations

import html
import json
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime
from email.utils import parsedate_to_datetime
from http import cookiejar
from pathlib import Path
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

from core.otp_utils import extract_otp


_CODE_RE = re.compile(r"(?<!\d)\d{6}(?!\d)")
_CODE_FIELD_NAMES = {
    "code",
    "otp",
    "verification_code",
    "verificationCode",
    "verificationcode",
    "one_time_code",
    "oneTimeCode",
}


class ReplacementServiceError(RuntimeError):
    """补号服务请求或配置错误。"""


class ReplacementCodeNotFoundError(ReplacementServiceError):
    """邮箱验证码接口暂未返回有效验证码。"""


@dataclass
class _HttpResponse:
    status_code: int
    text: str


class _UrllibTransport:
    """带 CookieJar 的标准库 HTTP transport。"""

    def __init__(self):
        self._opener = urllib_request.build_opener(
            urllib_request.HTTPCookieProcessor(cookiejar.CookieJar())
        )

    def __call__(self, method, url, *, headers=None, data=None, timeout=None):
        request = urllib_request.Request(
            url,
            data=data,
            headers=headers or {},
            method=str(method).upper(),
        )
        try:
            with self._opener.open(request, timeout=timeout) as response:
                return _HttpResponse(
                    status_code=int(response.status),
                    text=response.read().decode("utf-8", errors="replace"),
                )
        except urllib_error.HTTPError as exc:
            return _HttpResponse(
                status_code=int(exc.code),
                text=exc.read().decode("utf-8", errors="replace"),
            )
        except (urllib_error.URLError, TimeoutError, OSError) as exc:
            raise ReplacementServiceError(
                f"补号服务请求失败: {type(exc).__name__}"
            ) from exc


def load_replacement_admin_password(
    *,
    env: dict[str, str] | None = None,
    env_file: str | Path | None = None,
) -> str:
    """读取运行时后台密码，不提供硬编码默认值。"""
    values = env if env is not None else os.environ
    direct = str(values.get("REPLACEMENT_ADMIN_PASSWORD") or "").strip()
    if direct:
        return direct

    configured_file = values.get("REPLACEMENT_SERVICE_ENV_FILE")
    candidates = []
    if env_file:
        candidates.append(Path(env_file))
    if configured_file:
        candidates.append(Path(configured_file))
    for parent in Path(__file__).resolve().parents:
        candidates.append(parent / "gmail_IMAP" / ".env")

    seen: set[Path] = set()
    for candidate in candidates:
        path = candidate.expanduser()
        if path in seen or not path.is_file():
            continue
        seen.add(path)
        try:
            for raw_line in path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                if key.strip() != "ADMIN_PASSWORD":
                    continue
                return value.strip().strip('"').strip("'")
        except OSError as exc:
            raise ReplacementServiceError(
                f"无法读取补号服务配置文件: {path.name}"
            ) from exc
    return ""


def select_replacement_account(accounts: list[dict]) -> dict:
    """从服务端列表中选择一个可继续注册的账号。"""
    candidates = [
        account for account in accounts
        if str(account.get("status") or "").strip() == "unregistered"
    ]
    if not candidates:
        raise ReplacementServiceError("补号账号列表没有可注册的 unregistered 邮箱")

    with_api = [
        account for account in candidates
        if str(account.get("email_code_api") or "").strip()
    ]
    return dict((with_api or candidates)[0])


class ReplacementServiceClient:
    """访问补号账号列表、验证码接口和状态回写 API。"""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        admin_password: str | None = None,
        account_id: int | str | None = None,
        request_fn=None,
        sleep_fn=time.sleep,
        monotonic_fn=time.monotonic,
    ):
        if base_url is None:
            from config import REPLACEMENT_API_BASE

            base_url = REPLACEMENT_API_BASE
        self.base_url = str(base_url or "").rstrip("/")
        if not self.base_url:
            raise ReplacementServiceError("补号服务 API 地址未配置")
        if admin_password is None:
            from config import REPLACEMENT_SERVICE_ENV_FILE

            self.admin_password = load_replacement_admin_password(
                env_file=REPLACEMENT_SERVICE_ENV_FILE or None,
            )
        else:
            self.admin_password = str(admin_password).strip()
        try:
            from config import REPLACEMENT_API_TIMEOUT

            self.api_timeout = float(REPLACEMENT_API_TIMEOUT)
        except (ImportError, TypeError, ValueError):
            self.api_timeout = 15.0
        self._request_fn = request_fn or _UrllibTransport()
        self._request_fn_injected = request_fn is not None
        self._sleep = sleep_fn
        self._monotonic = monotonic_fn
        self._authenticated = False
        self.selected_account: dict | None = None
        self.account_id = str(account_id).strip() if account_id not in (None, "") else ""
        self._roxy_cdp = None

    def _request(self, method, url, *, headers=None, data=None, timeout=15, use_roxy=False):
        try:
            if use_roxy and not self._request_fn_injected and self._should_use_roxy_for_url(url):
                response = self._request_via_roxy(
                    method,
                    url,
                    headers=headers,
                    data=data,
                    timeout=timeout,
                )
            else:
                response = self._request_fn(
                    method,
                    url,
                    headers=headers,
                    data=data,
                    timeout=timeout,
                )
        except ReplacementServiceError:
            raise
        except Exception as exc:
            raise ReplacementServiceError(
                f"补号服务请求异常: {type(exc).__name__}"
            ) from exc
        if not hasattr(response, "status_code") or not hasattr(response, "text"):
            raise ReplacementServiceError("补号服务返回格式错误")
        return response

    @staticmethod
    def _should_use_roxy_for_url(url: str) -> bool:
        from config import ROXY_CDP_ENABLED

        if not ROXY_CDP_ENABLED:
            return False
        hostname = str(urllib_parse.urlparse(url).hostname or "").lower()
        return hostname not in {"localhost", "127.0.0.1", "::1"}

    def _request_via_roxy(self, method, url, *, headers=None, data=None, timeout=15):
        if self._roxy_cdp is None:
            from core.roxy_cdp import RoxyCdpClient

            self._roxy_cdp = RoxyCdpClient()
        try:
            response = self._roxy_cdp.request(
                method,
                url,
                headers=headers,
                data=data,
                timeout=timeout,
            )
        except Exception as exc:
            raise ReplacementServiceError(
                f"Roxy 邮箱验证码接口请求失败: {type(exc).__name__}"
            ) from exc
        return _HttpResponse(
            status_code=response.status_code,
            text=response.text,
        )

    def _ensure_authenticated(self) -> None:
        if self._authenticated:
            return
        if not self.admin_password:
            raise ReplacementServiceError("未配置补号服务后台密码")

        body = urllib_parse.urlencode({"password": self.admin_password}).encode("utf-8")
        response = self._request(
            "POST",
            f"{self.base_url}/login",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data=body,
            timeout=self.api_timeout,
        )
        if not 200 <= int(response.status_code) < 400:
            raise ReplacementServiceError("补号服务后台登录失败")
        self._authenticated = True

    def list_unregistered_accounts(self) -> list[dict]:
        self._ensure_authenticated()
        query = urllib_parse.urlencode({
            "status": "unregistered",
            "page": 1,
            "pageSize": 100,
        })
        response = self._request(
            "GET",
            f"{self.base_url}/replacement-accounts?{query}",
            timeout=self.api_timeout,
        )
        if not 200 <= int(response.status_code) < 300:
            raise ReplacementServiceError("补号账号列表请求失败")
        try:
            payload = json.loads(response.text or "{}")
        except json.JSONDecodeError as exc:
            raise ReplacementServiceError("补号账号列表返回非 JSON") from exc
        accounts = payload.get("accounts") if isinstance(payload, dict) else None
        if not isinstance(accounts, list):
            raise ReplacementServiceError("补号账号列表格式错误")
        return [dict(account) for account in accounts if isinstance(account, dict)]

    def get_account(self, account_id: int | str | None = None) -> dict:
        """读取指定补号账号，供页面按当前行启动协议注册。"""
        raw_id = account_id if account_id not in (None, "") else self.account_id
        try:
            normalized_id = str(int(str(raw_id).strip()))
        except (TypeError, ValueError) as exc:
            raise ReplacementServiceError("补号账号 ID 无效") from exc

        self._ensure_authenticated()
        response = self._request(
            "GET",
            f"{self.base_url}/replacement-accounts/{normalized_id}",
            timeout=self.api_timeout,
        )
        if not 200 <= int(response.status_code) < 300:
            raise ReplacementServiceError("指定补号账号请求失败")
        try:
            payload = json.loads(response.text or "{}")
        except json.JSONDecodeError as exc:
            raise ReplacementServiceError("指定补号账号返回非 JSON") from exc
        account = payload.get("account") if isinstance(payload, dict) else None
        if not isinstance(account, dict):
            raise ReplacementServiceError("指定补号账号返回格式错误")
        return dict(account)

    def acquire_account(self) -> dict:
        account = self.get_account() if self.account_id else select_replacement_account(self.list_unregistered_accounts())
        if str(account.get("status") or "").strip() != "unregistered":
            raise ReplacementServiceError("指定补号账号不是 unregistered，不能协议注册")
        email = str(account.get("email") or "").strip()
        if not email:
            raise ReplacementServiceError("补号账号缺少邮箱地址")
        self.selected_account = account
        return dict(account)

    def fetch_otp_for_account(
        self,
        account: dict,
        *,
        after_ts: float | None = None,
        timeout: float | None = None,
    ) -> str:
        email = str(account.get("email") or "").strip()
        if not email:
            raise ReplacementServiceError("补号账号缺少邮箱地址")

        external_url = str(account.get("email_code_api") or "").strip()
        if external_url:
            from config import REPLACEMENT_CODE_REQUEST_TIMEOUT

            response = self._request(
                "GET",
                external_url,
                headers={"Accept": "application/json, text/plain, text/html"},
                timeout=timeout or REPLACEMENT_CODE_REQUEST_TIMEOUT,
                # 邮箱服务本身不走 Roxy；Roxy 仅用于 OpenAI 注册主请求。
                use_roxy=False,
            )
            if not 200 <= int(response.status_code) < 300:
                raise ReplacementServiceError("账号邮箱验证码接口请求失败")
            code = _extract_external_code(response.text, after_ts=after_ts)
            if code:
                return code
            raise ReplacementCodeNotFoundError("账号邮箱验证码接口未返回有效验证码")

        from config import REPLACEMENT_CODE_REQUEST_TIMEOUT

        path = (
            "/api/icloud-verification-code/latest"
            if email.lower().endswith("@icloud.com")
            else "/api/verification-code/latest"
        )
        response = self._request(
            "POST",
            f"{self.base_url}{path}",
            headers={"Content-Type": "application/json"},
            data=json.dumps({"account": email}, ensure_ascii=False).encode("utf-8"),
            timeout=timeout or REPLACEMENT_CODE_REQUEST_TIMEOUT,
        )
        try:
            payload = json.loads(response.text or "{}")
        except json.JSONDecodeError as exc:
            raise ReplacementServiceError("本地验证码接口返回非 JSON") from exc
        code = str(payload.get("code") or "").strip() if isinstance(payload, dict) else ""
        if (
            200 <= int(response.status_code) < 300
            and isinstance(payload, dict)
            and payload.get("ok") is True
            and _CODE_RE.fullmatch(code)
            and _is_message_new_enough(payload.get("date"), after_ts)
        ):
            return code
        raise ReplacementCodeNotFoundError("本地验证码接口未返回新的有效验证码")

    def wait_for_otp(
        self,
        account: dict | None = None,
        *,
        after_ts: float | None = None,
        max_wait: float | None = None,
        poll_interval: float | None = None,
        excluded_codes: set[str] | None = None,
    ) -> str:
        from config import REPLACEMENT_CODE_MAX_WAIT, REPLACEMENT_CODE_POLL_INTERVAL

        current = account or self.selected_account
        if not current:
            raise ReplacementServiceError("尚未选择补号邮箱")
        deadline = self._monotonic() + (
            max_wait if max_wait is not None else REPLACEMENT_CODE_MAX_WAIT
        )
        interval = poll_interval if poll_interval is not None else REPLACEMENT_CODE_POLL_INTERVAL
        last_error = "验证码未找到"
        excluded = {str(code) for code in (excluded_codes or set())}

        while True:
            try:
                code = self.fetch_otp_for_account(current, after_ts=after_ts)
                if code not in excluded:
                    return code
                last_error = "邮箱接口仍返回已拒绝的旧验证码"
            except ReplacementCodeNotFoundError as exc:
                last_error = str(exc)
            except ReplacementServiceError as exc:
                last_error = str(exc)

            if self._monotonic() >= deadline:
                raise TimeoutError(
                    f"补号邮箱验证码等待超时: {last_error}"
                )
            self._sleep(max(0, interval))

    def mark_registered(self, account: dict | None = None) -> None:
        current = account or self.selected_account
        if not current or not current.get("id"):
            raise ReplacementServiceError("补号账号缺少 ID，无法回写 registered")
        self._ensure_authenticated()
        response = self._request(
            "PATCH",
            f"{self.base_url}/replacement-accounts/{int(current['id'])}/status",
            headers={"Content-Type": "application/json"},
            data=json.dumps({
                "status": "registered",
                "status_note": "协议注册成功",
            }, ensure_ascii=False).encode("utf-8"),
            timeout=self.api_timeout,
        )
        if not 200 <= int(response.status_code) < 300:
            raise ReplacementServiceError("补号账号状态回写失败")

    def close(self) -> None:
        if self._roxy_cdp is None:
            return
        self._roxy_cdp.close()
        self._roxy_cdp = None


def _extract_external_code(raw_text: str, *, after_ts: float | None = None) -> str | None:
    text = str(raw_text or "")
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        payload = None

    if payload is not None:
        code = _extract_from_payload(payload, after_ts=after_ts)
        if code:
            return code

    cleaned = _html_to_text(text)
    match = _CODE_RE.search(cleaned)
    return match.group(0) if match else None


def _extract_from_payload(value, *, after_ts: float | None = None) -> str | None:
    if isinstance(value, list):
        for item in value:
            code = _extract_from_payload(item, after_ts=after_ts)
            if code:
                return code
        return None
    if not isinstance(value, dict):
        return None

    for key, item in value.items():
        if key in _CODE_FIELD_NAMES:
            code_match = _CODE_RE.search(str(item or ""))
            if code_match and _is_message_new_enough(_get_date(value), after_ts):
                return code_match.group(0)

    direct_code = extract_otp(value)
    if direct_code and _is_message_new_enough(_get_date(value), after_ts):
        return direct_code

    for item in value.values():
        code = _extract_from_payload(item, after_ts=after_ts)
        if code:
            return code
    return None


def _get_date(value: dict) -> str:
    for key in ("date", "received_at", "receivedAt", "created_at", "receivedDateTime"):
        candidate = value.get(key)
        if candidate:
            return str(candidate)
    return ""


def _is_message_new_enough(value, after_ts: float | None) -> bool:
    if after_ts is None or not value:
        return True
    parsed = _parse_timestamp(value)
    return parsed is not None and parsed > after_ts


def _parse_timestamp(value) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return parsedate_to_datetime(text).timestamp()
    except (TypeError, ValueError, OverflowError):
        pass
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError, OverflowError):
        return None


def _html_to_text(value: str) -> str:
    without_blocks = re.sub(
        r"<\s*(script|style)\b[^>]*>[\s\S]*?<\s*/\s*\1\s*>",
        " ",
        str(value or ""),
        flags=re.IGNORECASE,
    )
    without_tags = re.sub(r"<[^>]*>", " ", without_blocks)
    return html.unescape(without_tags)
