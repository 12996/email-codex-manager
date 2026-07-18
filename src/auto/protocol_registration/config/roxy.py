# -*- coding: utf-8 -*-
"""RoxyBrowser 代理桥接配置。

这里只把 Roxy profile 的代理出口接入 Python 协议请求；不会让 curl_cffi 继承
Roxy 浏览器的 Canvas/WebGL 等运行时指纹。完整浏览器指纹仍需要 CDP 页面上下文。
"""

import os


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default

# Roxy 返回的 proxyInfo 目前不能直接作为 curl_cffi 的标准代理端点使用；
# 保持关闭，避免协议主链误走失效代理。完整 Roxy IP/指纹应通过 CDP 页面上下文接入。
ROXY_PROXY_ENABLED = os.environ.get("ROXY_PROXY_ENABLED", "0") == "1"
# 仅在确认 Roxy CDP/Playwright 桥接可用后显式打开；默认仍走 curl_cffi。
ROXY_CDP_ENABLED = os.environ.get("ROXY_CDP_ENABLED", "0") == "1"
ROXY_CDP_ENDPOINT = os.environ.get("ROXY_CDP_ENDPOINT", "")
ROXY_API_BASE_URL = os.environ.get("ROXY_API_BASE_URL", "http://127.0.0.1:50000")
ROXY_API_TOKEN = os.environ.get("ROXY_API_TOKEN", "")
ROXY_WORKSPACE_ID = _env_int("ROXY_WORKSPACE_ID", 111070)
ROXY_BROWSER_DIR_ID = os.environ.get("ROXY_BROWSER_DIR_ID", "")
ROXY_BROWSER_SORT_NUM = os.environ.get("ROXY_BROWSER_SORT_NUM", "3")
ROXY_BROWSER_WINDOW_NAME = os.environ.get("ROXY_BROWSER_WINDOW_NAME", "test")
