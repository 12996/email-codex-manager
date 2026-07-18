"""Optional post-registration Flow configuration.

Flow is disabled by default. Secrets and the target URL must be supplied through
environment variables when this optional side effect is intentionally enabled.
"""

import json
import os


def _env_bool(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    try:
        value = float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


def _payload() -> dict:
    raw = os.environ.get("FLOW_TRIGGER_PAYLOAD", "{}").strip()
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


ENABLE_FLOW_TRIGGER = _env_bool("ENABLE_FLOW_TRIGGER")
FLOW_TRIGGER_URL = os.environ.get("FLOW_TRIGGER_URL", "").strip()
FLOW_TRIGGER_BEARER = os.environ.get("FLOW_TRIGGER_BEARER", "").strip()
FLOW_TRIGGER_COOKIE = os.environ.get("FLOW_TRIGGER_COOKIE", "").strip()
FLOW_TRIGGER_PAYLOAD = _payload()
FLOW_TRIGGER_TIMEOUT = _env_float("FLOW_TRIGGER_TIMEOUT", 30.0)

