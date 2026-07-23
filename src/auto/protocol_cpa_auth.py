"""Standalone CPA auth protocol for an existing OpenAI account.

This module is intentionally separate from ``protocol_registration``. It replays
the observed Auth, optional phone verification, Codex consent, and OAuth token
exchange requests, then writes one CPA credential file.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit
from urllib.request import ProxyHandler, Request, build_opener


AUTH_ORIGIN = "https://auth.openai.com"
OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
OAUTH_REDIRECT_URI = "http://localhost:1455/auth/callback"
OAUTH_SCOPE = "openid profile email offline_access"
AUTHORIZE_CONTINUE_URL = f"{AUTH_ORIGIN}/api/accounts/authorize/continue"
PASSWORD_VERIFY_URL = f"{AUTH_ORIGIN}/api/accounts/password/verify"
MFA_ISSUE_URL = f"{AUTH_ORIGIN}/api/accounts/mfa/issue_challenge"
MFA_VERIFY_URL = f"{AUTH_ORIGIN}/api/accounts/mfa/verify"
ADD_PHONE_URL = f"{AUTH_ORIGIN}/api/accounts/add-phone/send"
PHONE_OTP_VALIDATE_URL = f"{AUTH_ORIGIN}/api/accounts/phone-otp/validate"
CONSENT_PAGE_URL = f"{AUTH_ORIGIN}/sign-in-with-chatgpt/codex/consent"
CONSENT_DATA_URL = (
    f"{AUTH_ORIGIN}/sign-in-with-chatgpt/codex/consent.data"
    "?_routes=SIGN_IN_WITH_CHATGPT_CODEX_CONSENT"
)
ACCOUNT_CONSENT_URL = f"{AUTH_ORIGIN}/api/accounts/consent"
TOKEN_URL = f"{AUTH_ORIGIN}/oauth/token"

logger = logging.getLogger(__name__)


class CpaAuthProtocolError(RuntimeError):
    """Raised when the standalone CPA auth flow cannot continue."""


class SmsCodeError(CpaAuthProtocolError):
    """Raised when the configured local SMS API has no usable code."""


@dataclass(frozen=True)
class PkcePair:
    verifier: str
    challenge: str


@dataclass(frozen=True)
class CpaAuthResult:
    email: str
    cpa_path: str
    workspace_id: str
    phone_verified: bool
    token_exchanged: bool


class CpaAuthProtocol:
    """Replay the standalone login-to-CPA request chain."""

    def __init__(
        self,
        *,
        session,
        sentinel_header_factory: Callable[[str], str] | None = None,
        phone_code_factory: Callable[[], str] | None = None,
        invocation_id_factory: Callable[[], object] | None = None,
    ):
        self.session = session
        self.sentinel_header_factory = sentinel_header_factory
        self.phone_code_factory = phone_code_factory
        self.invocation_id_factory = invocation_id_factory or uuid.uuid4

    def run(
        self,
        *,
        email: str,
        password: str,
        mfa_code: str,
        workspace_id: str,
        phone_number: str = "",
        sms_api_url: str = "",
        sms_api_proxy: str = "",
        sms_timeout: float = 15,
        sms_poll_timeout: float = 90,
        sms_poll_interval: float = 5,
        output_dir: str | Path | None = None,
    ) -> CpaAuthResult:
        normalized_email = str(email or "").strip()
        normalized_password = str(password or "").strip()
        normalized_workspace = str(workspace_id or "").strip()
        normalized_mfa = resolve_mfa_code(mfa_code)
        if not normalized_email:
            raise CpaAuthProtocolError("email is required")
        if not normalized_password:
            raise CpaAuthProtocolError("password is required")
        if not normalized_workspace:
            raise CpaAuthProtocolError(
                "OpenAI workspace id is required; do not use ROXY_WORKSPACE_ID"
            )

        pkce = generate_pkce()
        state = secrets.token_hex(16)
        authorize_url = build_authorize_url(
            challenge=pkce.challenge,
            state=state,
        )
        self.session.navigate(
            authorize_url,
            headers=self.session.get_auth_navigate_headers(referer="https://chatgpt.com/"),
        )

        authorize_payload = self._post_json(
            AUTHORIZE_CONTINUE_URL,
            {"username": {"kind": "email", "value": normalized_email}},
            referer=f"{AUTH_ORIGIN}/log-in",
            sentinel_flow="authorize_continue",
        )
        password_payload = self._post_json(
            PASSWORD_VERIFY_URL,
            {"password": normalized_password},
            referer=f"{AUTH_ORIGIN}/log-in/password",
            sentinel_flow="authorize_continue",
        )

        challenge_id = extract_challenge_id(password_payload) or extract_challenge_id(
            authorize_payload
        )
        if not challenge_id:
            raise CpaAuthProtocolError("password response did not expose MFA challenge id")
        factor_type = extract_factor_type(password_payload) or "totp"

        self._post_json(
            MFA_ISSUE_URL,
            {
                "force_fresh_challenge": True,
                "id": challenge_id,
                "type": factor_type,
            },
            referer=f"{AUTH_ORIGIN}/log-in/password",
        )
        verify_payload = self._post_json(
            MFA_VERIFY_URL,
            {"code": normalized_mfa, "id": challenge_id, "type": factor_type},
            referer=f"{AUTH_ORIGIN}/mfa-challenge/{challenge_id}",
        )

        next_stage = extract_next_stage(verify_payload)
        continue_url = extract_continue_url(verify_payload)
        payload_keys = ",".join(sorted(str(key) for key in verify_payload)) if isinstance(verify_payload, dict) else type(verify_payload).__name__
        logger.warning(
            "MFA verify next_stage=%s continue_path=%s payload_keys=%s",
            next_stage,
            _safe_path(continue_url) or "-",
            payload_keys or "-",
        )
        phone_verified = False
        if needs_phone_stage(next_stage):
            self._navigate_continue_url(continue_url, referer=f"{AUTH_ORIGIN}/")
            phone_verified, phone_continue_url = self._complete_phone_stage(
                next_stage=next_stage,
                phone_number=phone_number,
                sms_api_url=sms_api_url,
                sms_api_proxy=sms_api_proxy,
                sms_timeout=sms_timeout,
                sms_poll_timeout=sms_poll_timeout,
                sms_poll_interval=sms_poll_interval,
            )
            continue_url = phone_continue_url
        else:
            logger.warning("MFA verify did not expose a phone stage; skipping phone flow")

        resolved_workspace = resolve_workspace_id(self.session, normalized_workspace)
        tokens = self._complete_oauth(
            state=state,
            verifier=pkce.verifier,
            workspace_id=resolved_workspace,
            continue_url=continue_url,
        )
        cpa_path = write_cpa_auth_file(
            email=normalized_email,
            tokens=tokens,
            output_dir=output_dir,
        )
        return CpaAuthResult(
            email=normalized_email,
            cpa_path=str(cpa_path),
            workspace_id=resolved_workspace,
            phone_verified=phone_verified,
            token_exchanged=True,
        )

    def _post_json(
        self,
        url: str,
        payload: dict,
        *,
        referer: str,
        sentinel_flow: str | None = None,
        invocation_id: bool = True,
    ) -> dict:
        headers = self.session.get_auth_headers(referer=referer)
        if invocation_id:
            headers["x-access-flow-invocation-id"] = str(self.invocation_id_factory())
        if sentinel_flow:
            sentinel_header = self._get_sentinel_header(sentinel_flow)
            if sentinel_header:
                headers["openai-sentinel-token"] = sentinel_header

        response = self.session.post(
            url,
            headers=headers,
            data=json.dumps(payload, separators=(",", ":")),
        )
        require_success(response, _safe_path(url))
        return response_json(response, url)

    def _get_sentinel_header(self, flow: str) -> str:
        if self.sentinel_header_factory:
            return str(self.sentinel_header_factory(flow) or "")

        registration_dir = Path(__file__).resolve().parent / "protocol_registration"
        if str(registration_dir) not in sys.path:
            sys.path.insert(0, str(registration_dir))
        from core.openai_auth import build_sentinel_header, request_sentinel_token

        challenge = request_sentinel_token(self.session, flow)
        header, _ = build_sentinel_header(self.session, challenge, flow)
        return header

    def _complete_phone_stage(
        self,
        *,
        next_stage: str,
        phone_number: str,
        sms_api_url: str,
        sms_api_proxy: str,
        sms_timeout: float,
        sms_poll_timeout: float,
        sms_poll_interval: float,
    ) -> tuple[bool, str]:
        if not phone_number:
            raise CpaAuthProtocolError("phone number is required for phone verification")
        logger.warning("phone stage=%s; requesting add-phone/send before SMS polling", next_stage)
        status = self._send_phone(phone_number)
        if status >= 500:
            raise CpaAuthProtocolError(f"add-phone returned HTTP {status}")
        logger.warning("phone stage=%s; add-phone/send returned HTTP %s, continue to SMS polling", next_stage, status)

        if self.phone_code_factory:
            code = str(self.phone_code_factory() or "").strip()
        else:
            if not sms_api_url:
                raise CpaAuthProtocolError("sms_api_url is required for phone verification")
            sms_fetcher = None
            if getattr(self.session, "uses_roxy_cdp", False) and not sms_api_proxy:
                sms_fetcher = self._fetch_sms_code_via_roxy
            logger.warning(
                "SMS polling transport=%s timeout=%gs interval=%gs",
                "roxy-browser" if sms_fetcher else "direct-http",
                sms_poll_timeout,
                sms_poll_interval,
            )
            code = wait_for_sms_code(
                sms_api_url,
                proxy=sms_api_proxy,
                request_timeout=sms_timeout,
                poll_timeout=sms_poll_timeout,
                poll_interval=sms_poll_interval,
                fetcher=sms_fetcher,
            )
        if not re.fullmatch(r"\d{6}", code):
            raise CpaAuthProtocolError("phone verification code must be six digits")

        headers = self.session.get_auth_headers(
            referer=f"{AUTH_ORIGIN}/phone-verification"
        )
        headers["x-access-flow-invocation-id"] = str(self.invocation_id_factory())
        response = self.session.post(
            PHONE_OTP_VALIDATE_URL,
            headers=headers,
            data=json.dumps({"code": code}, separators=(",", ":")),
        )
        require_success(response, "phone-otp/validate")
        payload = response_json(response, PHONE_OTP_VALIDATE_URL)
        if payload.get("success") is False:
            raise CpaAuthProtocolError("phone OTP was rejected")
        return True, extract_continue_url(payload)

    def _fetch_sms_code_via_roxy(self, url: str, *, proxy: str = "", timeout: float = 15) -> str:
        del proxy
        return fetch_sms_code_via_browser(self.session, url, timeout=timeout)

    def _send_phone(self, phone_number: str) -> int:
        response = self.session.post(
            ADD_PHONE_URL,
            headers=self.session.get_auth_headers(referer=f"{AUTH_ORIGIN}/add-phone"),
            data=json.dumps(
                {"channel": "sms", "phone_number": str(phone_number).strip()},
                separators=(",", ":"),
            ),
        )
        status = int(getattr(response, "status_code", 0) or 0)
        if 400 <= status < 500:
            logger.info(
                "add-phone returned HTTP %s; phone may already be added, continue to phone OTP stage",
                status,
            )
            return status
        require_success(response, "add-phone/send")
        return status

    def _navigate_continue_url(self, continue_url: str, *, referer: str) -> str:
        resolved = resolve_auth_continue_url(continue_url)
        if not resolved:
            return ""
        self.session.navigate(
            resolved,
            headers=self.session.get_auth_navigate_headers(referer=referer),
        )
        return resolved

    def _complete_oauth(
        self,
        *,
        state: str,
        verifier: str,
        workspace_id: str,
        continue_url: str = "",
    ) -> dict:
        consent_page_url = resolve_auth_continue_url(continue_url) or CONSENT_PAGE_URL
        self.session.navigate(
            consent_page_url,
            headers=self.session.get_auth_navigate_headers(referer=f"{AUTH_ORIGIN}/"),
        )
        consent_response = self.session.get(
            CONSENT_DATA_URL,
            headers=self.session.get_auth_headers(referer=consent_page_url),
        )
        consent_data = response_json_value(consent_response, CONSENT_DATA_URL)
        if not isinstance(consent_data, (dict, list)):
            raise CpaAuthProtocolError(
                f"unsupported JSON shape from {_safe_path(CONSENT_DATA_URL)}: {type(consent_data).__name__}"
            )
        consent_challenge = extract_consent_challenge(consent_data)

        workspace_headers = self.session.get_auth_headers(referer=consent_page_url)
        workspace_headers["x-access-flow-invocation-id"] = str(self.invocation_id_factory())
        workspace_response = self.session.post(
            f"{AUTH_ORIGIN}/api/accounts/workspace/select",
            headers=workspace_headers,
            data=json.dumps({"workspace_id": workspace_id}, separators=(",", ":")),
        )
        require_success(workspace_response, "workspace/select")

        consent_url = ACCOUNT_CONSENT_URL
        if consent_challenge:
            consent_url = f"{consent_url}?{urlencode({'consent_challenge': consent_challenge})}"
        consent_result = self.session.get(
            consent_url,
            headers=self.session.get_auth_headers(referer=consent_page_url),
            allow_redirects=False,
        )
        oauth_location = location_header(consent_result)
        if not oauth_location:
            raise CpaAuthProtocolError("accounts/consent did not return OAuth location")

        oauth_result = self.session.get(
            urljoin(f"{AUTH_ORIGIN}/", oauth_location),
            headers=self.session.get_auth_headers(referer=consent_page_url),
            allow_redirects=False,
        )
        callback_url = location_header(oauth_result)
        if not callback_url:
            raise CpaAuthProtocolError("OAuth authorization did not return callback location")
        callback_url = urljoin(f"{AUTH_ORIGIN}/", callback_url)
        query = parse_qs(urlsplit(callback_url).query)
        code = str((query.get("code") or [""])[0]).strip()
        callback_state = str((query.get("state") or [""])[0]).strip()
        if not code:
            raise CpaAuthProtocolError("OAuth callback did not contain authorization code")
        if callback_state != state:
            raise CpaAuthProtocolError("OAuth callback state mismatch")

        token_response = self.session.post(
            TOKEN_URL,
            headers=self.session.get_auth_headers(referer=f"{AUTH_ORIGIN}/"),
            data=json.dumps(
                {
                    "client_id": OAUTH_CLIENT_ID,
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": OAUTH_REDIRECT_URI,
                    "code_verifier": verifier,
                },
                separators=(",", ":"),
            ),
        )
        tokens = response_json(token_response, TOKEN_URL)
        require_success(token_response, "oauth/token")
        if not str(tokens.get("access_token") or "").strip():
            raise CpaAuthProtocolError("oauth/token response did not contain access token")
        return tokens


def generate_pkce() -> PkcePair:
    verifier = secrets.token_urlsafe(32)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return PkcePair(verifier=verifier, challenge=challenge)


def build_authorize_url(*, challenge: str, state: str) -> str:
    params = {
        "client_id": OAUTH_CLIENT_ID,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "codex_cli_simplified_flow": "true",
        "id_token_add_organizations": "true",
        "redirect_uri": OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": OAUTH_SCOPE,
        "state": state,
        "prompt": "login",
    }
    return f"{AUTH_ORIGIN}/oauth/authorize?{urlencode(params)}"


def resolve_mfa_code(value: str) -> str:
    normalized = str(value or "").strip()
    if re.fullmatch(r"\d{6,8}", normalized):
        return normalized
    if not normalized:
        raise CpaAuthProtocolError("mfa code or TOTP secret is required")
    return generate_totp(normalized)


def generate_totp(secret: str, *, timestamp: int | None = None) -> str:
    normalized = re.sub(r"\s+", "", str(secret or "").upper())
    try:
        padded = normalized + "=" * (-len(normalized) % 8)
        key = base64.b32decode(padded, casefold=True)
    except (ValueError, base64.binascii.Error) as exc:
        raise CpaAuthProtocolError("invalid TOTP secret") from exc
    counter = int((timestamp if timestamp is not None else time.time()) // 30)
    digest = hmac.new(key, counter.to_bytes(8, "big"), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = int.from_bytes(digest[offset:offset + 4], "big") & 0x7FFFFFFF
    return f"{number % 1_000_000:06d}"


def fetch_sms_code(url: str, *, proxy: str = "", timeout: float = 15) -> str:
    if str(proxy or "").lower().startswith("socks"):
        raise SmsCodeError("urllib SMS transport only supports HTTP proxies")
    handlers = [ProxyHandler({"http": proxy, "https": proxy})] if proxy else []
    opener = build_opener(*handlers)
    request = Request(
        str(url).strip(),
        headers={"Accept": "application/json", "User-Agent": "protocol-cpa-auth"},
    )
    try:
        with opener.open(request, timeout=float(timeout)) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except Exception as exc:
        raise SmsCodeError(f"SMS API request failed: {type(exc).__name__}") from exc
    code = find_six_digit_code(raw)
    if not code:
        raise SmsCodeError("SMS API returned no six-digit code")
    return code


def fetch_sms_code_via_browser(session, url: str, *, timeout: float = 15) -> str:
    """Read the SMS endpoint through the active Roxy page exit when direct HTTP is restricted."""
    try:
        response = session.navigate(str(url).strip(), timeout=timeout)
    except Exception as exc:
        raise SmsCodeError(f"Roxy SMS navigation failed: {type(exc).__name__}") from exc

    status = int(getattr(response, "status_code", 0) or 0)
    if not 200 <= status < 300:
        raise SmsCodeError(f"SMS API returned HTTP {status}")
    code = find_six_digit_code(getattr(response, "text", ""))
    if not code:
        raise SmsCodeError("SMS API returned no six-digit code")
    return code


def wait_for_sms_code(
    url: str,
    *,
    proxy: str = "",
    request_timeout: float = 15,
    poll_timeout: float = 90,
    poll_interval: float = 5,
    fetcher: Callable[..., str] | None = None,
    sleep_fn: Callable[[float], None] | None = None,
) -> str:
    """Poll the SMS API after add-phone until a six-digit code is available."""
    request_timeout = max(0.0, float(request_timeout))
    poll_timeout = max(0.0, float(poll_timeout))
    poll_interval = max(0.0, float(poll_interval))
    read_code = fetcher or fetch_sms_code
    sleep_fn = sleep_fn or time.sleep
    deadline = time.monotonic() + poll_timeout
    last_error: SmsCodeError | None = None

    while True:
        try:
            return read_code(url, proxy=proxy, timeout=request_timeout)
        except SmsCodeError as exc:
            last_error = exc

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise SmsCodeError(
                f"SMS API polling timed out after {poll_timeout:g}s"
            ) from last_error
        sleep_fn(min(poll_interval, remaining))


def find_six_digit_code(value) -> str:
    if isinstance(value, dict):
        for item in value.values():
            found = find_six_digit_code(item)
            if found:
                return found
        return ""
    if isinstance(value, (list, tuple)):
        for item in value:
            found = find_six_digit_code(item)
            if found:
                return found
        return ""
    match = re.search(r"(?<!\d)(\d{6})(?!\d)", str(value or ""))
    return match.group(1) if match else ""


def write_cpa_auth_file(*, email: str, tokens: dict, output_dir=None) -> Path:
    normalized_email = str(email or "").strip().lower()
    access_token = str(tokens.get("access_token") or "").strip()
    if not normalized_email or not access_token:
        raise CpaAuthProtocolError("CPA export requires email and access token")
    if not re.fullmatch(r"[^<>:\"/\\|?*\x00-\x1f]+", normalized_email):
        raise CpaAuthProtocolError("email contains unsupported filename characters")

    access_payload = decode_jwt_payload(access_token)
    auth_payload = access_payload.get("https://api.openai.com/auth") or {}
    output_root = Path(output_dir or Path(__file__).resolve().parent / "product_files" / "cpa")
    output_root.mkdir(parents=True, exist_ok=True)
    output_path = output_root / f"{normalized_email}.json"
    payload = {
        "type": "codex",
        "email": normalized_email,
        "expired": format_expiry(access_payload.get("exp")),
        "id_token": str(tokens.get("id_token") or ""),
        "account_id": auth_payload.get("chatgpt_account_id") or "",
        "access_token": access_token,
        "last_refresh": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "refresh_token": str(tokens.get("refresh_token") or ""),
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return output_path


def decode_jwt_payload(token: str) -> dict:
    try:
        encoded = str(token).split(".")[1]
        padded = encoded + "=" * (-len(encoded) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
        return payload if isinstance(payload, dict) else {}
    except (IndexError, ValueError, TypeError, UnicodeDecodeError):
        return {}


def format_expiry(timestamp) -> str:
    try:
        value = float(timestamp)
    except (TypeError, ValueError):
        return ""
    if value <= 0:
        return ""
    return datetime.fromtimestamp(value, timezone.utc).isoformat(timespec="milliseconds")


def response_json_value(response, url: str):
    try:
        payload = response.json()
    except (AttributeError, TypeError, ValueError) as exc:
        raise CpaAuthProtocolError(f"invalid JSON from {_safe_path(url)}") from exc
    return payload


def response_json(response, url: str) -> dict:
    payload = response_json_value(response, url)
    if not isinstance(payload, dict):
        raise CpaAuthProtocolError(f"non-object JSON from {_safe_path(url)}")
    return payload


def require_success(response, step: str) -> None:
    status = int(getattr(response, "status_code", 0) or 0)
    if not 200 <= status < 300:
        raise CpaAuthProtocolError(f"{step} returned HTTP {status}")


def location_header(response) -> str:
    headers = getattr(response, "headers", {}) or {}
    for key, value in headers.items():
        if str(key).lower() == "location":
            return str(value or "").strip()
    return ""


def extract_challenge_id(payload) -> str:
    if isinstance(payload, dict):
        for key in ("challenge_id", "challengeId", "factor_id", "factorId"):
            value = str(payload.get(key) or "").strip()
            if value:
                return value
        for key, value in payload.items():
            if key == "id" and isinstance(value, str) and len(value) >= 16:
                return value
            found = extract_challenge_id(value)
            if found:
                return found
    elif isinstance(payload, list):
        for value in payload:
            found = extract_challenge_id(value)
            if found:
                return found
    return ""


def extract_factor_type(payload) -> str:
    if isinstance(payload, dict):
        for key in ("factor_type", "factorType", "type"):
            value = str(payload.get(key) or "").strip().lower()
            if value in {"totp", "otp"}:
                return "totp"
        for value in payload.values():
            found = extract_factor_type(value)
            if found:
                return found
    elif isinstance(payload, list):
        for value in payload:
            found = extract_factor_type(value)
            if found:
                return found
    return ""


def extract_next_stage(payload) -> str:
    if isinstance(payload, dict):
        page = payload.get("page")
        if isinstance(page, dict):
            value = normalize_stage(page.get("type"))
            if value:
                return value
        for key in ("next_stage", "nextStage", "stage"):
            value = normalize_stage(payload.get(key))
            if value:
                return value
    return "unknown"


def normalize_stage(value) -> str:
    normalized = str(value or "").strip().lower().replace("_", "-")
    return {
        "add-phone": "phone-add",
        "phone-add": "phone-add",
        "phone-verification": "phone-verify",
        "phone-code": "phone-code",
    }.get(normalized, normalized)


def extract_continue_url(payload) -> str:
    if isinstance(payload, dict):
        for key in ("continue_url", "continueUrl", "next_url", "nextUrl"):
            value = str(payload.get(key) or "").strip()
            if value:
                return value
        for value in payload.values():
            found = extract_continue_url(value)
            if found:
                return found
    elif isinstance(payload, list):
        for value in payload:
            found = extract_continue_url(value)
            if found:
                return found
    return ""


def resolve_auth_continue_url(value: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    resolved = urljoin(f"{AUTH_ORIGIN}/", normalized)
    if urlsplit(resolved).scheme != "https" or urlsplit(resolved).netloc != "auth.openai.com":
        raise CpaAuthProtocolError("auth continue_url must stay on auth.openai.com")
    return resolved


def extract_consent_challenge(payload) -> str:
    if isinstance(payload, dict):
        for key in ("consent_challenge", "consentChallenge", "challenge"):
            value = str(payload.get(key) or "").strip()
            if value:
                return value
        for value in payload.values():
            found = extract_consent_challenge(value)
            if found:
                return found
    elif isinstance(payload, list):
        for value in payload:
            found = extract_consent_challenge(value)
            if found:
                return found
    return ""


def resolve_workspace_id(session, requested_workspace: str) -> str:
    requested = str(requested_workspace or "").strip()
    reader = getattr(session, "auth_workspaces", None)
    available = []
    if callable(reader):
        try:
            raw_workspaces = reader()
        except Exception as exc:
            logger.warning("unable to read current Auth workspaces: %s", type(exc).__name__)
            raw_workspaces = []
        if isinstance(raw_workspaces, dict):
            raw_workspaces = raw_workspaces.get("workspaces") or []
        if isinstance(raw_workspaces, list):
            for item in raw_workspaces:
                if isinstance(item, str):
                    workspace_id = item.strip()
                    kind = ""
                elif isinstance(item, dict):
                    workspace_id = str(item.get("id") or "").strip()
                    kind = str(item.get("kind") or "").strip().lower()
                else:
                    continue
                if workspace_id and not any(candidate["id"] == workspace_id for candidate in available):
                    available.append({"id": workspace_id, "kind": kind})

    if available:
        if requested:
            for candidate in available:
                if candidate["id"] == requested:
                    return requested
        for candidate in available:
            if candidate["kind"] in {"personal", "user", "individual"}:
                logger.info("using current Auth personal workspace for workspace/select")
                return candidate["id"]
        logger.info("using first current Auth workspace for workspace/select")
        return available[0]["id"]

    if requested:
        return requested
    raise CpaAuthProtocolError(
        "OpenAI workspace id is unavailable in the current Auth session"
    )


def needs_phone_stage(stage: str) -> bool:
    return str(stage or "").strip().lower().replace("_", "-") in {
        "phone-add",
        "phone-verify",
        "phone-code",
    }


def _safe_path(url: str) -> str:
    parsed = urlsplit(str(url or ""))
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"


def create_default_session():
    registration_dir = Path(__file__).resolve().parent / "protocol_registration"
    if str(registration_dir) not in sys.path:
        sys.path.insert(0, str(registration_dir))
    from core.session import BrowserSession

    return BrowserSession(proxy=None, roxy_warmup_url="")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Run standalone CPA auth protocol")
    parser.add_argument("--email", default=os.environ.get("CPA_EMAIL", ""))
    parser.add_argument("--password", default=os.environ.get("CPA_PASSWORD", ""))
    parser.add_argument("--mfa", default=os.environ.get("CPA_MFA", ""))
    parser.add_argument(
        "--workspace-id",
        default=os.environ.get("OPENAI_WORKSPACE_ID", ""),
        help="OpenAI workspace id; never use the Roxy API workspace id",
    )
    parser.add_argument("--phone", default=os.environ.get("CPA_PHONE", ""))
    parser.add_argument("--sms-api", default=os.environ.get("CPA_SMS_API", ""))
    parser.add_argument("--sms-proxy", default=os.environ.get("SMS_API_PROXY", ""))
    parser.add_argument(
        "--sms-timeout",
        type=float,
        default=float(os.environ.get("CPA_SMS_TIMEOUT", "15")),
        help="SMS API 单次 HTTP 请求超时（秒）",
    )
    parser.add_argument(
        "--sms-poll-timeout",
        type=float,
        default=float(os.environ.get("CPA_SMS_POLL_TIMEOUT", "90")),
        help="add-phone 后等待短信验证码的总超时（秒）",
    )
    parser.add_argument(
        "--sms-poll-interval",
        type=float,
        default=float(os.environ.get("CPA_SMS_POLL_INTERVAL", "5")),
        help="SMS API 轮询间隔（秒）",
    )
    parser.add_argument("--output-dir", default=os.environ.get("CPA_OUTPUT_DIR", ""))
    args = parser.parse_args(argv)

    session = create_default_session()
    try:
        result = CpaAuthProtocol(session=session).run(
            email=args.email,
            password=args.password,
            mfa_code=args.mfa,
            workspace_id=args.workspace_id,
            phone_number=args.phone,
            sms_api_url=args.sms_api,
            sms_api_proxy=args.sms_proxy,
            sms_timeout=args.sms_timeout,
            sms_poll_timeout=args.sms_poll_timeout,
            sms_poll_interval=args.sms_poll_interval,
            output_dir=args.output_dir or None,
        )
        print(json.dumps({
            "success": True,
            "email": result.email,
            "cpa_path": result.cpa_path,
            "workspace_id": result.workspace_id,
            "phone_verified": result.phone_verified,
            "token_exchanged": result.token_exchanged,
        }, ensure_ascii=False))
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
