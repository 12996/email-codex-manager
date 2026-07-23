"""Run the standalone CPA 2FA protocol for one existing replacement account."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Callable


class ProtocolReplacementError(RuntimeError):
    """Raised when protocol replacement inputs or execution are invalid."""


def run_replacement(
    *,
    account_id: int | str | None = None,
    workspace_id: str | None = None,
    output_dir: str | Path | None = None,
    env: dict[str, str] | None = None,
    client_factory: Callable | None = None,
    session_factory: Callable | None = None,
    protocol_factory: Callable | None = None,
):
    values = dict(os.environ)
    if env:
        values.update({str(key): str(value) for key, value in env.items()})

    normalized_id = str(account_id or values.get("REPLACEMENT_ACCOUNT_ID") or "").strip()
    if not normalized_id.isdigit() or int(normalized_id) <= 0:
        raise ProtocolReplacementError("REPLACEMENT_ACCOUNT_ID must be a positive integer")
    normalized_workspace = str(
        workspace_id or values.get("OPENAI_WORKSPACE_ID") or ""
    ).strip()
    if not normalized_workspace:
        raise ProtocolReplacementError(
            "OPENAI_WORKSPACE_ID is required for protocol replacement"
        )

    client_factory = client_factory or _default_client_factory
    session_factory = session_factory or _default_session_factory
    protocol_factory = protocol_factory or _default_protocol_factory

    client_kwargs = {"account_id": normalized_id}
    admin_password = str(
        values.get("REPLACEMENT_ADMIN_PASSWORD")
        or values.get("ADMIN_PASSWORD")
        or ""
    ).strip()
    if admin_password:
        client_kwargs["admin_password"] = admin_password

    client = client_factory(**client_kwargs)
    session = None
    try:
        account = client.get_account(normalized_id)
        email = _required_account_value(account, "email")
        password = _required_account_value(account, "password")
        mfa = _required_account_value(account, "codex_2fa")

        session = session_factory()
        protocol = protocol_factory(session=session)
        run_kwargs = {
            "email": email,
            "password": password,
            "mfa_code": mfa,
            "workspace_id": normalized_workspace,
            "phone_number": str(account.get("phone") or "").strip(),
            "sms_api_url": str(account.get("sms_api") or "").strip(),
            "sms_api_proxy": str(values.get("SMS_API_PROXY") or "").strip(),
            "output_dir": str(
                output_dir
                or values.get("CPA_OUTPUT_DIR")
                or Path(__file__).resolve().parent / "product_files" / "cpa"
            ),
        }
        _add_float_option(run_kwargs, "sms_timeout", values, "CPA_SMS_TIMEOUT")
        _add_float_option(run_kwargs, "sms_poll_timeout", values, "CPA_SMS_POLL_TIMEOUT")
        _add_float_option(run_kwargs, "sms_poll_interval", values, "CPA_SMS_POLL_INTERVAL")
        return protocol.run(**run_kwargs)
    finally:
        if session is not None:
            close = getattr(session, "close", None)
            if callable(close):
                close()
        close = getattr(client, "close", None)
        if callable(close):
            close()


def _required_account_value(account: dict, field: str) -> str:
    value = str(account.get(field) or "").strip()
    if not value:
        raise ProtocolReplacementError(f"replacement account field is required: {field}")
    return value


def _add_float_option(target: dict, key: str, values: dict[str, str], env_key: str) -> None:
    raw = str(values.get(env_key) or "").strip()
    if not raw:
        return
    try:
        target[key] = float(raw)
    except ValueError as exc:
        raise ProtocolReplacementError(f"{env_key} must be a number") from exc


def _default_client_factory(**kwargs):
    registration_dir = Path(__file__).resolve().parent / "protocol_registration"
    if str(registration_dir) not in sys.path:
        sys.path.insert(0, str(registration_dir))
    from core.replacement_client import ReplacementServiceClient

    return ReplacementServiceClient(**kwargs)


def _default_session_factory():
    from protocol_cpa_auth import create_default_session

    return create_default_session()


def _default_protocol_factory(*, session):
    from protocol_cpa_auth import CpaAuthProtocol

    return CpaAuthProtocol(session=session)


def _result_payload(result) -> dict:
    if isinstance(result, dict):
        return result
    return {
        "email": getattr(result, "email", ""),
        "cpa_path": getattr(result, "cpa_path", ""),
        "workspace_id": getattr(result, "workspace_id", ""),
        "phone_verified": bool(getattr(result, "phone_verified", False)),
        "token_exchanged": bool(getattr(result, "token_exchanged", False)),
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Run protocol CPA replacement for one account")
    parser.add_argument("--account-id", default=os.environ.get("REPLACEMENT_ACCOUNT_ID", ""))
    parser.add_argument("--workspace-id", default=os.environ.get("OPENAI_WORKSPACE_ID", ""))
    parser.add_argument("--output-dir", default=os.environ.get("CPA_OUTPUT_DIR", ""))
    args = parser.parse_args(argv)

    try:
        result = run_replacement(
            account_id=args.account_id,
            workspace_id=args.workspace_id,
            output_dir=args.output_dir or None,
        )
    except Exception as exc:
        print(f"protocol CPA replacement failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    print(json.dumps({"success": True, **_result_payload(result)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
