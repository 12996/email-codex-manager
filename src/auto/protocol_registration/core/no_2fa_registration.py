"""Roxy OTP-first registration flow without password or TOTP enrollment."""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Callable

from core.account_export import (
    fetch_session,
    follow_oauth_callback,
    save_registration_access_token_file,
)
from core.chatgpt_auth import get_csrf_token, get_providers, signin_openai
from core.email_provider import wait_for_otp
from core.openai_auth import (
    EmailOtpRejectedError,
    build_sentinel_header,
    create_account,
    follow_auth_continue,
    follow_authorize,
    request_sentinel_token,
    validate_email_otp,
)
from core.session import BrowserSession

logger = logging.getLogger(__name__)

_AUTH_ORIGIN = "https://auth.openai.com"
_EMAIL_VERIFICATION_URL = f"{_AUTH_ORIGIN}/email-verification"
_RESEND_OTP_URL = f"{_AUTH_ORIGIN}/api/accounts/email-otp/resend"
_FINALIZE_SESSION_MAX_ATTEMPTS = 5
_FINALIZE_SESSION_BACKOFF_BASE = 2.0
_INITIAL_AUTH_MAX_ATTEMPTS = 3
_INITIAL_AUTH_BACKOFF_BASE = 2.0


def _is_transient_network_error(exc: Exception) -> bool:
    message = str(exc or "").lower()
    return any(marker in message for marker in (
        "err_connection_reset",
        "connection reset",
        "err_connection_closed",
        "err_connection_timed_out",
        "err_proxy_connection_failed",
        "err_name_not_resolved",
        "err_internet_disconnected",
        "timed out",
    ))


def _retry_initial_auth_request(
    stage: str,
    request_fn: Callable[[], object],
    *,
    sleep_fn: Callable[[float], None],
) -> object:
    """Retry only idempotent pre-transaction ChatGPT reads after a transport reset."""
    last_error: Exception | None = None
    for attempt in range(1, _INITIAL_AUTH_MAX_ATTEMPTS + 1):
        try:
            return request_fn()
        except Exception as exc:
            last_error = exc
            if not _is_transient_network_error(exc) or attempt >= _INITIAL_AUTH_MAX_ATTEMPTS:
                raise
            delay = _INITIAL_AUTH_BACKOFF_BASE ** (attempt - 1)
            logger.warning(
                "[无2FA] %s 连接暂时重置，%.1fs 后重试 (%d/%d)",
                stage,
                delay,
                attempt + 1,
                _INITIAL_AUTH_MAX_ATTEMPTS,
            )
            sleep_fn(delay)
    raise RuntimeError(f"{stage} 重试耗尽") from last_error


def _require_auth_transition(result: dict, expected_page: str) -> str:
    """Reject incomplete Auth JSON before a continuation can mutate page state."""
    page_type = str((result or {}).get("page", {}).get("type") or "")
    method = str((result or {}).get("method") or "").upper()
    continue_url = str((result or {}).get("continue_url") or "")
    if page_type != expected_page or method != "GET" or not continue_url:
        raise RuntimeError(
            "Auth 阶段错误："
            f"期望 page.type={expected_page}、method=GET 且包含 continue_url；"
            f"实际 page.type={page_type or 'unknown'}、method={method or 'unknown'}"
        )
    return continue_url


def _sentinel_headers(session: BrowserSession, flow: str) -> tuple[str, str]:
    """Generate request-scoped Sentinel headers in the active Roxy context."""
    sentinel_response = request_sentinel_token(session, flow)
    sentinel_header, so_header = build_sentinel_header(session, sentinel_response, flow)
    if not sentinel_header or not so_header:
        raise RuntimeError(f"{flow} 缺少当前 Roxy Sentinel 或 SO token")
    return sentinel_header, so_header


def resend_initial_email_otp(session: BrowserSession) -> None:
    """Send exactly one OTP request from the recorded email-verification stage."""
    headers = session.get_auth_headers(referer=_EMAIL_VERIFICATION_URL)
    # The observed resend request has no body or Sentinel header.
    headers.pop("content-type", None)
    headers.pop("origin", None)
    logger.info("[无2FA] 请求发送邮箱验证码")
    response = session.post(_RESEND_OTP_URL, headers=headers)
    if response.status_code != 200:
        response.raise_for_status()
        raise RuntimeError("邮箱验证码发送接口返回非 200")
    try:
        payload = response.json()
    except Exception as exc:
        raise RuntimeError("邮箱验证码发送接口返回非 JSON") from exc
    if not isinstance(payload, dict) or payload.get("success") is not True:
        raise RuntimeError("邮箱验证码发送接口未确认 success=true")


def validate_initial_email_otp(
    session: BrowserSession,
    email: str,
    *,
    after_ts: float,
    wait_for_otp_fn: Callable = wait_for_otp,
    now_fn: Callable[[], float] = time.time,
) -> dict:
    """Submit fresh OTP values until Auth advances to about-you or the reader fails."""
    marker = after_ts
    rejected_codes: set[str] = set()
    while True:
        code = wait_for_otp_fn(email, after_ts=marker, excluded_codes=rejected_codes)
        sentinel_header, so_header = _sentinel_headers(session, "authorize_continue")
        try:
            result = validate_email_otp(session, code, sentinel_header, so_header)
        except EmailOtpRejectedError:
            rejected_codes.add(code)
            marker = now_fn()
            logger.warning("[无2FA] 邮箱验证码被拒绝，等待新邮件")
            continue
        _require_auth_transition(result, "about_you")
        return result


def submit_about_you(session: BrowserSession, name: str, birthday: str) -> dict:
    """Submit only the recorded profile payload and validate its external callback transition."""
    sentinel_header, so_header = _sentinel_headers(session, "oauth_create_account")
    result = create_account(session, name, birthday, sentinel_header, so_header)
    _require_auth_transition(result, "external_url")
    return result


def finalize_session(
    session: BrowserSession,
    continue_url: str,
    *,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> str:
    """Follow the one-time callback, then wait for the session cookie to expose an AT."""
    follow_oauth_callback(session, continue_url)
    last_error: Exception | None = None
    for attempt in range(1, _FINALIZE_SESSION_MAX_ATTEMPTS + 1):
        try:
            session_data = fetch_session(session)
            access_token = str((session_data or {}).get("accessToken") or "").strip()
            if not access_token:
                raise RuntimeError("session 响应缺少 accessToken")
            logger.info("[无2FA] ChatGPT session 已建立")
            return access_token
        except Exception as exc:
            last_error = exc
            if attempt >= _FINALIZE_SESSION_MAX_ATTEMPTS:
                break
            delay = _FINALIZE_SESSION_BACKOFF_BASE ** (attempt - 1)
            logger.warning(
                "[无2FA] session 尚未就绪，%.1fs 后重试 (%d/%d)",
                delay,
                attempt + 1,
                _FINALIZE_SESSION_MAX_ATTEMPTS,
            )
            sleep_fn(delay)
    raise RuntimeError("OAuth callback 后未取得 accessToken") from last_error


def run_no_2fa_registration(
    email: str,
    name: str,
    birthday: str,
    *,
    session_factory: Callable[[], BrowserSession] = BrowserSession,
    wait_for_otp_fn: Callable = wait_for_otp,
    now_fn: Callable[[], float] = time.time,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> str:
    """Run the captured OTP-first state machine and return its access token."""
    session = session_factory()
    try:
        _retry_initial_auth_request(
            "providers",
            lambda: get_providers(session),
            sleep_fn=sleep_fn,
        )
        csrf_token = _retry_initial_auth_request(
            "csrf",
            lambda: get_csrf_token(session),
            sleep_fn=sleep_fn,
        )
        authorize_url = signin_openai(
            session,
            csrf_token,
            email,
            screen_hint="login_or_signup",
            prompt="login",
            include_login_hint=True,
        )
        follow_authorize(session, authorize_url)

        otp_started_at = now_fn()
        resend_initial_email_otp(session)
        otp_result = validate_initial_email_otp(
            session,
            email,
            after_ts=otp_started_at,
            wait_for_otp_fn=wait_for_otp_fn,
            now_fn=now_fn,
        )
        follow_auth_continue(session, otp_result, "about_you")

        create_result = submit_about_you(session, name, birthday)
        continue_url = _require_auth_transition(create_result, "external_url")
        return finalize_session(session, continue_url, sleep_fn=sleep_fn)
    finally:
        session.close()


def run_and_save_no_2fa_registration(
    *,
    email: str,
    name: str,
    birthday: str,
    output_dir: str | Path | None = None,
    session_factory: Callable[[], BrowserSession] = BrowserSession,
    wait_for_otp_fn: Callable = wait_for_otp,
    now_fn: Callable[[], float] = time.time,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> str:
    """Run the flow, then persist only its verified AT in the configured output directory."""
    access_token = run_no_2fa_registration(
        email,
        name,
        birthday,
        session_factory=session_factory,
        wait_for_otp_fn=wait_for_otp_fn,
        now_fn=now_fn,
        sleep_fn=sleep_fn,
    )
    output = save_registration_access_token_file(
        email=email,
        access_token=access_token,
        output_dir=output_dir,
    )
    if not output:
        raise RuntimeError("REGISTRATION_TOKEN_OUTPUT_DIR 未配置，拒绝丢弃 accessToken")
    return output
