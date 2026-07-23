#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH="${CPA_PROXY_CONFIG_PATH:-/opt/cliproxyapi/config.yaml}"
SERVICE_NAME="${CPA_PROXY_SERVICE_NAME:-cliproxyapi.service}"
HOME_PROXY_URL="${CPA_PROXY_HOME_URL:-http://127.0.0.1:7891}"
SUDO_CMD="${CPA_PROXY_SUDO-sudo}"
SKIP_RESTART="${CPA_PROXY_SKIP_RESTART:-0}"
SKIP_HOME_CHECK="${CPA_PROXY_SKIP_HOME_CHECK:-0}"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

run_privileged() {
  if [[ -n "$SUDO_CMD" ]]; then
    "$SUDO_CMD" "$@"
  else
    "$@"
  fi
}

require_config() {
  [[ -f "$CONFIG_PATH" ]] || die "config file not found: $CONFIG_PATH"

  local count
  count="$(run_privileged grep -Ec '^proxy-url:[[:space:]]*' "$CONFIG_PATH" || true)"
  [[ "$count" == '1' ]] || die "expected exactly one top-level proxy-url, found $count"
}

current_proxy_url() {
  run_privileged sed -nE 's/^proxy-url:[[:space:]]*(.*)$/\1/p' "$CONFIG_PATH"
}

create_backup() {
  local stamp backup
  stamp="$(date +%Y%m%d-%H%M%S)"
  backup="${CONFIG_PATH}.bak-${stamp}"
  if run_privileged test -e "$backup"; then
    backup="${backup}-$$"
  fi
  run_privileged cp -a "$CONFIG_PATH" "$backup"
  printf '%s\n' "$backup"
}

restart_cpa() {
  [[ "$SKIP_RESTART" == '1' ]] && return

  run_privileged systemctl restart "$SERVICE_NAME"
  for _ in {1..20}; do
    if run_privileged systemctl is-active --quiet "$SERVICE_NAME"; then
      return
    fi
    sleep 1
  done
  die "CPA service did not become active: $SERVICE_NAME"
}

check_home_proxy() {
  [[ "$SKIP_HOME_CHECK" == '1' ]] && return
  command -v ss >/dev/null 2>&1 || return
  ss -lnt 2>/dev/null | grep -Eq '127\.0\.0\.1:7891([[:space:]]|$)' \
    || die 'mihomo is not listening on 127.0.0.1:7891'
}

set_proxy_url() {
  local mode="$1"
  local desired label backup actual

  case "$mode" in
    direct)
      desired='""'
      label='direct VPS egress'
      ;;
    home)
      check_home_proxy
      desired="$HOME_PROXY_URL"
      label="home proxy ($HOME_PROXY_URL)"
      ;;
    *)
      die "usage: $0 {direct|home|status|rollback}"
      ;;
  esac

  require_config
  backup="$(create_backup)"
  run_privileged sed -i -E "s|^proxy-url:[[:space:]]*.*$|proxy-url: ${desired}|" "$CONFIG_PATH"

  actual="$(current_proxy_url)"
  if [[ "$actual" != "$desired" ]]; then
    run_privileged cp -a "$backup" "$CONFIG_PATH"
    die "proxy-url verification failed; restored $backup"
  fi

  restart_cpa
  printf 'CPA proxy mode: %s\n' "$label"
  printf 'config: %s\n' "$CONFIG_PATH"
  printf 'backup: %s\n' "$backup"
}

latest_backup() {
  run_privileged find "$(dirname "$CONFIG_PATH")" \
    -maxdepth 1 \
    -type f \
    -name "$(basename "$CONFIG_PATH").bak-*" \
    -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr \
    | head -n 1 \
    | cut -d ' ' -f 2-
}

rollback() {
  local backup pre_rollback
  require_config
  backup="$(latest_backup)"
  [[ -n "$backup" ]] || die "no config backup found next to $CONFIG_PATH"

  pre_rollback="${CONFIG_PATH}.pre-rollback-$(date +%Y%m%d-%H%M%S)"
  run_privileged cp -a "$CONFIG_PATH" "$pre_rollback"
  run_privileged cp -a "$backup" "$CONFIG_PATH"
  restart_cpa
  printf 'CPA config restored from: %s\n' "$backup"
  printf 'pre-rollback backup: %s\n' "$pre_rollback"
}

status() {
  require_config
  printf 'config: %s\n' "$CONFIG_PATH"
  printf 'proxy-url: %s\n' "$(current_proxy_url)"

  if command -v systemctl >/dev/null 2>&1; then
    printf 'cpa-service: '
    if run_privileged systemctl is-active --quiet "$SERVICE_NAME"; then
      printf 'active\n'
    else
      printf 'inactive\n'
    fi
  fi

  if command -v ss >/dev/null 2>&1; then
    if ss -lnt 2>/dev/null | grep -Eq '127\.0\.0\.1:7891([[:space:]]|$)'; then
      printf 'home-proxy-7891: listening\n'
    else
      printf 'home-proxy-7891: not-listening\n'
    fi
  fi
}

case "${1:-status}" in
  direct|home)
    set_proxy_url "$1"
    ;;
  rollback)
    rollback
    ;;
  status)
    status
    ;;
  *)
    die "usage: $0 {direct|home|status|rollback}"
    ;;
esac
