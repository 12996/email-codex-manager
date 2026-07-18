"""从 RoxyBrowser profile 读取代理出口，供协议会话使用。"""

import json
from urllib import parse as urllib_parse
from urllib import request as urllib_request


def _get_json(url: str, token: str = "") -> dict:
    headers = {"Accept": "application/json"}
    if token:
        headers["token"] = token
    request = urllib_request.Request(url, headers=headers, method="GET")
    with urllib_request.urlopen(request, timeout=10) as response:
        raw = response.read().decode("utf-8", errors="replace")
    return json.loads(raw) if raw else {}


def _rows_from_response(response: dict) -> list[dict]:
    data = response.get("data") if isinstance(response, dict) else None
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("rows", "list", "data"):
            rows = data.get(key)
            if isinstance(rows, list):
                return rows
    rows = response.get("rows") if isinstance(response, dict) else None
    return rows if isinstance(rows, list) else []


def build_proxy_url(proxy_info: dict) -> str:
    """把 Roxy API 的 proxyInfo 转成 curl_cffi 可用的代理 URL。"""
    info = proxy_info or {}
    host = str(info.get("host") or "").strip()
    port = str(info.get("port") or "").strip()
    if not host or not port:
        raise RuntimeError("Roxy profile 没有可用的代理 host/port")

    protocol = str(info.get("protocol") or info.get("proxyCategory") or "http").lower()
    scheme = "socks5h" if protocol.startswith("socks") else protocol
    if scheme not in {"http", "https", "socks5h"}:
        scheme = "http"

    username = str(info.get("proxyUserName") or info.get("username") or "")
    password = str(info.get("proxyPassword") or info.get("password") or "")
    if password and username.endswith(f":{password}"):
        username = username[: -(len(password) + 1)]

    auth = ""
    if username or password:
        auth = (
            f"{urllib_parse.quote(username, safe='')}"
            f":{urllib_parse.quote(password, safe='')}@"
        )
    return f"{scheme}://{auth}{host}:{port}"


def resolve_roxy_proxy(
    *,
    api_base_url: str | None = None,
    workspace_id: int | str | None = None,
    dir_id: str | None = None,
    sort_num: int | str | None = None,
    window_name: str | None = None,
    token: str | None = None,
    get_json=None,
) -> str:
    """按 profile 标识查询 Roxy 代理并返回代理 URL。"""
    from config import (
        ROXY_API_BASE_URL,
        ROXY_API_TOKEN,
        ROXY_BROWSER_DIR_ID,
        ROXY_BROWSER_SORT_NUM,
        ROXY_BROWSER_WINDOW_NAME,
        ROXY_WORKSPACE_ID,
    )

    base = (api_base_url or ROXY_API_BASE_URL).rstrip("/")
    workspace = workspace_id if workspace_id is not None else ROXY_WORKSPACE_ID
    selected_dir_id = dir_id or ROXY_BROWSER_DIR_ID
    selected_sort_num = sort_num if sort_num is not None else ROXY_BROWSER_SORT_NUM
    selected_window_name = window_name or ROXY_BROWSER_WINDOW_NAME
    auth_token = token if token is not None else ROXY_API_TOKEN

    if not selected_dir_id and selected_sort_num in (None, "") and not selected_window_name:
        raise RuntimeError("Roxy profile 缺少 dirId、窗口序号或窗口名称")

    query = urllib_parse.urlencode({
        "workspaceId": workspace,
        "pageIndex": 1,
        "pageSize": 100,
    })
    response = (get_json or _get_json)(f"{base}/browser/list?{query}", auth_token)
    if response.get("code") not in (None, 0):
        raise RuntimeError(f"RoxyBrowser 查询 profile 失败: {response.get('msg') or response}")

    rows = _rows_from_response(response)
    target = None
    if selected_dir_id:
        target = next((row for row in rows if str(row.get("dirId")) == str(selected_dir_id)), None)
    if target is None and selected_sort_num not in (None, ""):
        target = next(
            (
                row for row in rows
                if str(row.get("windowSortNum", row.get("sortNum", ""))) == str(selected_sort_num)
            ),
            None,
        )
    if target is None and selected_window_name:
        target = next(
            (
                row for row in rows
                if str(row.get("windowName") or "").strip() == str(selected_window_name).strip()
            ),
            None,
        )
    if target is None:
        raise RuntimeError("RoxyBrowser 没有找到目标 profile")

    return build_proxy_url(target.get("proxyInfo") or {})
