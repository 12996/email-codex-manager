# -*- coding: utf-8 -*-
"""
curl_cffi Session 封装
统一管理 Cookie、请求头和 TLS 指纹
"""
import uuid
from curl_cffi.requests import Session
from core.roxy_cdp import RoxyCdpClient

from config import (
    USER_AGENT, SEC_CH_UA, SEC_CH_UA_PLATFORM, SEC_CH_UA_MOBILE,
    IMPERSONATE, REQUEST_TIMEOUT, pick_proxy,
)


class BrowserSession:
    """
    模拟 Chrome 浏览器的 HTTP 会话管理器。
    使用 curl_cffi 的 impersonate 功能绕过 Cloudflare TLS 指纹检测。
    """

    def __init__(self, proxy: str = None, roxy_warmup_url: str | None = None):
        """
        初始化会话。

        Args:
            proxy: 代理地址，如 "socks5h://user:pass@host:port"。
                   不传则从 config.PROXY_POOL 随机抽一个。
                   显式传 "" 表示禁用代理。
        """
        from config import ROXY_CDP_ENABLED, ROXY_PROXY_ENABLED

        self._roxy_cdp = None
        self.roxy_fingerprint = None
        self.roxy_ip = None
        self.roxy_warmup_url = (
            "https://chatgpt.com/"
            if roxy_warmup_url is None
            else str(roxy_warmup_url).strip()
        )
        self.user_agent = USER_AGENT

        # CDP 模式不把 Roxy proxyInfo 误当成普通代理，而是直接复用页面上下文。
        if proxy is None and ROXY_CDP_ENABLED:
            from config import (
                ROXY_BROWSER_DIR_ID,
                ROXY_BROWSER_SORT_NUM,
                ROXY_BROWSER_WINDOW_NAME,
            )

            profile = ROXY_BROWSER_DIR_ID or ROXY_BROWSER_SORT_NUM or ROXY_BROWSER_WINDOW_NAME or "default"
            self.proxy = f"roxy-cdp://{profile}"
            self._roxy_cdp = RoxyCdpClient()
        # proxy=None  → 从池里随机抽（默认行为）
        # proxy=""    → 禁用代理（直连）
        # proxy="..." → 使用指定代理
        elif proxy is None:
            if ROXY_PROXY_ENABLED:
                from core.roxy_bridge import resolve_roxy_proxy
                self.proxy = resolve_roxy_proxy()
            else:
                self.proxy = pick_proxy()
        else:
            self.proxy = proxy

        # 生成设备ID（oai-did），整个注册流程复用
        self.device_id = str(uuid.uuid4())

        # 生成 auth_session_logging_id
        self.auth_session_logging_id = str(uuid.uuid4())

        # 创建 curl_cffi 会话；CDP 模式下请求由 Roxy 页面上下文负责。
        self.session = None if self._roxy_cdp else Session(impersonate=IMPERSONATE)

        # 设置代理
        if self.session is not None and self.proxy and not self.proxy.startswith("roxy-cdp://"):
            self.session.proxies = {
                "http": self.proxy,
                "https": self.proxy,
            }

        # 设置超时
        if self.session is not None:
            self.session.timeout = REQUEST_TIMEOUT

    @property
    def uses_roxy_cdp(self) -> bool:
        return self._roxy_cdp is not None

    def _ensure_roxy_fingerprint(self) -> None:
        if not self._roxy_cdp or self.roxy_fingerprint is not None:
            return
        fingerprint = self._roxy_cdp.fingerprint()
        # Keep the legacy ChatGPT warmup for registration; standalone CPA can
        # disable it so its first visible navigation is the Auth authorize URL.
        if self.roxy_warmup_url:
            self._roxy_cdp.navigate(self.roxy_warmup_url, timeout=REQUEST_TIMEOUT)
        self.roxy_fingerprint = fingerprint
        self.user_agent = str(fingerprint.get("userAgent") or self.user_agent)

    def _ensure_roxy_ip(self) -> None:
        if not self._roxy_cdp:
            return
        from config import ROXY_IP_CHECK_ENABLED
        if not ROXY_IP_CHECK_ENABLED:
            return
        ip_reader = getattr(self._roxy_cdp, "ip", None)
        if not callable(ip_reader):
            return
        info = ip_reader() or {}
        current_ip = str(info.get("ip") or "").strip() if isinstance(info, dict) else ""
        if not current_ip:
            return
        if self.roxy_ip and self.roxy_ip != current_ip:
            raise RuntimeError(
                f"Roxy 出口 IP 发生变化: {self.roxy_ip} -> {current_ip}，终止当前 OAuth 会话"
            )
        self.roxy_ip = current_ip

    def ensure_fingerprint(self) -> None:
        """确保 CDP 指纹已读取，供 Sentinel 生成器在首个请求前调用。"""
        self._ensure_roxy_fingerprint()

    def _get_common_headers(self) -> dict:
        """获取通用请求头"""
        return {
            "User-Agent": self.user_agent,
            "sec-ch-ua": SEC_CH_UA,
            "sec-ch-ua-platform": SEC_CH_UA_PLATFORM,
            "sec-ch-ua-mobile": SEC_CH_UA_MOBILE,
            "accept-language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
        }

    def get_chatgpt_headers(self, referer: str = "https://chatgpt.com/login") -> dict:
        """
        获取 chatgpt.com 域名的请求头。
        用于步骤1-3。
        """
        headers = self._get_common_headers()
        headers.update({
            "accept": "*/*",
            "content-type": "application/json",
            "sec-fetch-site": "same-origin",
            "sec-fetch-mode": "cors",
            "sec-fetch-dest": "empty",
            "referer": referer,
            "priority": "u=1, i",
        })
        return headers

    def get_auth_headers(self, referer: str = "https://auth.openai.com/create-account/password") -> dict:
        """
        获取 auth.openai.com 域名的请求头。
        用于步骤7、10、12。
        """
        headers = self._get_common_headers()
        headers.update({
            "accept": "application/json",
            "content-type": "application/json",
            "sec-fetch-site": "same-origin",
            "sec-fetch-mode": "cors",
            "sec-fetch-dest": "empty",
            "referer": referer,
            "priority": "u=1, i",
            "origin": "https://auth.openai.com",
        })
        return headers

    def get_auth_navigate_headers(self, referer: str = "https://chatgpt.com/") -> dict:
        """
        获取 auth.openai.com 导航请求头（用于GET页面请求）。
        用于步骤4、5、8。
        """
        headers = self._get_common_headers()
        headers.update({
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "sec-fetch-site": "cross-site",
            "sec-fetch-mode": "navigate",
            "sec-fetch-dest": "document",
            "referer": referer,
            "priority": "u=0, i",
            "upgrade-insecure-requests": "1",
        })
        return headers

    def get_sentinel_headers(self) -> dict:
        """
        获取 sentinel.openai.com 的请求头。
        用于步骤6、9、11。
        """
        from config import SENTINEL_SV
        headers = self._get_common_headers()
        headers.update({
            "accept": "*/*",
            "content-type": "text/plain;charset=UTF-8",
            "origin": "https://sentinel.openai.com",
            "referer": f"https://sentinel.openai.com/backend-api/sentinel/frame.html?sv={SENTINEL_SV}",
            "sec-fetch-site": "same-origin",
            "sec-fetch-mode": "cors",
            "sec-fetch-dest": "empty",
            "priority": "u=1, i",
        })
        return headers

    def get(self, url: str, headers: dict = None, **kwargs):
        """发送 GET 请求"""
        if self._roxy_cdp:
            self._ensure_roxy_fingerprint()
            self._ensure_roxy_ip()
            return self._roxy_cdp.request("GET", url, headers=headers, **kwargs)
        return self.session.get(url, headers=headers, **kwargs)

    def post(self, url: str, headers: dict = None, **kwargs):
        """发送 POST 请求"""
        if self._roxy_cdp:
            self._ensure_roxy_fingerprint()
            self._ensure_roxy_ip()
            return self._roxy_cdp.request("POST", url, headers=headers, **kwargs)
        return self.session.post(url, headers=headers, **kwargs)

    def navigate(self, url: str, headers: dict = None, **kwargs):
        """在 CDP 页面中执行真实导航；curl_cffi 模式退化为普通 GET。"""
        if self._roxy_cdp:
            self._ensure_roxy_fingerprint()
            self._ensure_roxy_ip()
            return self._roxy_cdp.navigate(url, headers=headers, **kwargs)
        return self.session.get(url, headers=headers, **kwargs)

    def sentinel_headers(self, flow: str) -> dict:
        """在 Roxy 页面中运行 Sentinel SDK，补齐浏览器 SO token。"""
        if not self._roxy_cdp:
            raise RuntimeError("Sentinel 页面 SDK 只在 Roxy CDP 模式可用")
        self._ensure_roxy_fingerprint()
        self._ensure_roxy_ip()
        return self._roxy_cdp.sentinel_headers(flow, self.device_id, timeout=REQUEST_TIMEOUT)

    def auth_workspaces(self) -> list[dict]:
        """读取当前 Auth 会话的脱敏 workspace 元数据，不返回 Cookie 或 Token。"""
        if not self._roxy_cdp:
            return []
        reader = getattr(self._roxy_cdp, "auth_workspaces", None)
        if not callable(reader):
            return []
        self._ensure_roxy_fingerprint()
        self._ensure_roxy_ip()
        result = reader()
        return result if isinstance(result, list) else []

    def close(self) -> None:
        """关闭协议会话；CDP 模式只断开桥接，不关闭 Roxy profile。"""
        if self._roxy_cdp:
            self._roxy_cdp.close()
            return
        if self.session is not None:
            self.session.close()
