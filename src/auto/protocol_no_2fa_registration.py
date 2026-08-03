#!/usr/bin/env python
"""Run the recorded OTP-first Roxy registration flow without enabling TOTP."""

from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path
import random
import string
import subprocess
import sys
from typing import Callable

AUTO_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = AUTO_ROOT.parent.parent
PROTOCOL_ROOT = AUTO_ROOT / "protocol_registration"
ROXY_PREPARER = AUTO_ROOT / "prepare_roxy_no_2fa.cjs"
DEFAULT_TOKEN_OUTPUT_DIR = AUTO_ROOT / "product_files" / "registration"


def load_project_env(env: dict[str, str] | None = None) -> None:
    """Load simple project .env assignments without overriding explicit process values."""
    values = os.environ if env is None else env
    env_file = PROJECT_ROOT / ".env"
    if not env_file.is_file():
        return
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key and key not in values:
            values[key] = value.strip().strip('"').strip("'")


def required_text(value: str | None, name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{name} is required")
    return normalized


def resolve_roxy_dir_id(env: dict[str, str]) -> str:
    return required_text(
        env.get("ROXY_NO_2FA_BROWSER_DIR_ID") or env.get("ROXY_PROTOCOL_BROWSER_DIR_ID"),
        "ROXY_NO_2FA_BROWSER_DIR_ID or ROXY_PROTOCOL_BROWSER_DIR_ID",
    )


def configure_runtime_env(env: dict[str, str]) -> str:
    """Force the Python CDP bridge to attach to the profile freshly prepared by Node."""
    dir_id = resolve_roxy_dir_id(env)
    env["ROXY_BROWSER_DIR_ID"] = dir_id
    env["ROXY_CDP_ENABLED"] = "1"
    env["ROXY_CDP_PREPARE"] = "0"
    env["ROXY_CDP_ORIGIN_ISOLATION"] = "1"
    env.pop("ROXY_CDP_ENDPOINT", None)
    env.setdefault("REGISTRATION_TOKEN_OUTPUT_DIR", str(DEFAULT_TOKEN_OUTPUT_DIR))
    env.setdefault("OTP_PROVIDER", "replacement")
    env.setdefault("EMAIL_SOURCE", "replacement")
    if not str(env.get("REPLACEMENT_API_BASE") or "").strip():
        port = str(env.get("PORT") or "3000").strip()
        env["REPLACEMENT_API_BASE"] = f"http://127.0.0.1:{port}"
    if not str(env.get("REPLACEMENT_ADMIN_PASSWORD") or "").strip():
        admin_password = str(env.get("ADMIN_PASSWORD") or "").strip()
        if admin_password:
            env["REPLACEMENT_ADMIN_PASSWORD"] = admin_password
    return dir_id


def run_roxy_preparer(env: dict[str, str]) -> str:
    """Run the Node lifecycle helper without forwarding its output or errors to logs."""
    node = str(env.get("NODE_EXECUTABLE") or "node").strip()
    configured_preparer = str(env.get("ROXY_NO_2FA_PREPARER") or "").strip()
    preparer = Path(configured_preparer) if configured_preparer else ROXY_PREPARER
    if not preparer.is_absolute():
        preparer = (PROJECT_ROOT / preparer).resolve()
    try:
        completed = subprocess.run(
            [node, str(preparer)],
            cwd=str(PROJECT_ROOT),
            env=dict(env),
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise RuntimeError("Roxy 准备失败") from exc
    raw_output = str(completed.stdout or "").strip()
    try:
        payload = json.loads(raw_output)
    except json.JSONDecodeError:
        payload = None
    if isinstance(payload, dict) and payload.get("ok") is True:
        return required_text(payload.get("dirId"), "Roxy prepared dirId")
    for line in reversed(raw_output.splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and payload.get("ok") is True:
            return required_text(payload.get("dirId"), "Roxy prepared dirId")
    raise RuntimeError("Roxy 准备未返回可用 profile")


def build_otp_reader(
    email: str,
    *,
    client_factory: Callable | None = None,
) -> tuple[Callable, Callable[[], None], Callable[[], None]]:
    """Bind OTP polling to the exact replacement account selected by email."""
    if str(PROTOCOL_ROOT) not in sys.path:
        sys.path.insert(0, str(PROTOCOL_ROOT))
    from core.replacement_client import ReplacementServiceClient

    client = (client_factory or ReplacementServiceClient)()
    normalized = required_text(email, "email").lower()
    accounts = client.list_unregistered_accounts()
    account = next(
        (
            item for item in accounts
            if str(item.get("email") or "").strip().lower() == normalized
        ),
        None,
    )
    if not account:
        raise RuntimeError("指定邮箱不是可用的 unregistered 补号账号")

    def reader(target_email: str, *, after_ts: float, excluded_codes: set[str]) -> str:
        if str(target_email or "").strip().lower() != normalized:
            raise RuntimeError("OTP 读取邮箱与已选择账号不一致")
        return client.wait_for_otp(
            account,
            after_ts=after_ts,
            excluded_codes=excluded_codes,
        )

    def mark_registered() -> None:
        client.mark_registered(account)

    return reader, mark_registered, client.close


def execute_registration(
    *,
    email: str,
    name: str,
    birthday: str,
    output_dir: str,
) -> str:
    """Persist the verified AT, then mark its selected replacement account registered."""
    if str(PROTOCOL_ROOT) not in sys.path:
        sys.path.insert(0, str(PROTOCOL_ROOT))
    from core.no_2fa_registration import run_and_save_no_2fa_registration

    reader, mark_registered, close_reader = build_otp_reader(email)
    try:
        output = run_and_save_no_2fa_registration(
            email=email,
            name=name,
            birthday=birthday,
            output_dir=output_dir,
            wait_for_otp_fn=reader,
        )
        mark_registered()
        return output
    finally:
        close_reader()


def generate_display_name() -> str:
    first = random.choice(string.ascii_uppercase) + "".join(random.choices(string.ascii_lowercase, k=5))
    last = random.choice(string.ascii_uppercase) + "".join(random.choices(string.ascii_lowercase, k=5))
    return f"{first} {last}"


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Roxy OTP-first registration without TOTP")
    parser.add_argument("--email", default=os.environ.get("ROXY_REGISTER_EMAIL", ""))
    parser.add_argument("--name", default=os.environ.get("ROXY_REGISTER_NAME", ""))
    parser.add_argument("--birthday", default=os.environ.get("ROXY_REGISTER_BIRTHDAY", "2000-01-01"))
    return parser.parse_args(argv)


def main(argv=None) -> int:
    load_project_env()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    args = parse_args(argv)
    try:
        email = required_text(args.email, "email").lower()
        name = str(args.name or "").strip() or generate_display_name()
        birthday = required_text(args.birthday, "birthday")
        if os.environ.get("ROXY_NO_2FA_PREPARER"):
            prepared_dir_id = run_roxy_preparer(os.environ)
            os.environ["ROXY_NO_2FA_BROWSER_DIR_ID"] = prepared_dir_id
            configure_runtime_env(os.environ)
        else:
            expected_dir_id = configure_runtime_env(os.environ)
            prepared_dir_id = run_roxy_preparer(os.environ)
            if prepared_dir_id != expected_dir_id:
                raise RuntimeError("Roxy 准备 profile 与目标 profile 不一致")
        print("[无2FA] Roxy 已准备，开始 OTP-first 协议")
        output = execute_registration(
            email=email,
            name=name,
            birthday=birthday,
            output_dir=os.environ["REGISTRATION_TOKEN_OUTPUT_DIR"],
        )
    except Exception as exc:
        print(f"[无2FA] 失败：{type(exc).__name__}", file=sys.stderr)
        return 1

    print(f"[无2FA] 已保存 AT 文件：{output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
