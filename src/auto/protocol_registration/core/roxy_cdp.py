"""同步 Python 封装：通过持久 Node JSONL 进程复用 Roxy 的 CDP 页面。"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
from pathlib import Path


class RoxyResponse:
    """提供当前协议代码所需的 requests/curl_cffi Response 最小兼容面。"""

    def __init__(
        self,
        status_code: int,
        url: str,
        headers: dict | None,
        text: str,
        reason: str = "",
    ):
        self.status_code = int(status_code or 0)
        self.url = str(url or "")
        self.headers = dict(headers or {})
        self.text = text if isinstance(text, str) else str(text or "")
        self.reason = str(reason or "")

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 400

    @property
    def content(self) -> bytes:
        return self.text.encode("utf-8")

    def json(self):
        return json.loads(self.text)

    def raise_for_status(self) -> None:
        if self.status_code >= 400 or self.status_code == 0:
            detail = f" {self.reason}" if self.reason else ""
            raise RuntimeError(
                f"Roxy 页面请求失败: HTTP {self.status_code}{detail} {self.url}".strip()
            )

    @classmethod
    def from_result(cls, result: dict) -> "RoxyResponse":
        if not isinstance(result, dict):
            raise RuntimeError(f"Roxy bridge 返回格式错误: {result!r}")
        return cls(
            status_code=result.get("status_code", result.get("status", 0)),
            url=result.get("url", ""),
            headers=result.get("headers") or {},
            text=result.get("text", ""),
            reason=result.get("status_text", result.get("reason", "")),
        )


class RoxyCdpClient:
    """把同步 HTTP 风格调用转成 Roxy 页面上下文中的 fetch/navigation。"""

    def __init__(
        self,
        *,
        bridge_script: str | None = None,
        node_executable: str | None = None,
        request_timeout: float = 60,
        exchange=None,
        popen_factory=None,
        env: dict | None = None,
        cwd: str | None = None,
    ):
        # exchange 是测试和嵌入场景的窄接口；正式运行时使用 JSONL 子进程。
        self._exchange = exchange
        self._bridge_script = bridge_script
        self._node_executable = node_executable
        self._request_timeout = float(request_timeout)
        self._popen_factory = popen_factory or subprocess.Popen
        self._env_override = dict(env or {})
        self._cwd = cwd
        self._process = None
        self._reader_thread = None
        self._responses: queue.Queue = queue.Queue()
        self._lock = threading.RLock()
        self._next_id = 1
        self._closed = False

    def _build_request(self, command: str, **payload) -> dict:
        request = {"id": self._next_id, "command": command}
        self._next_id += 1
        request.update(payload)
        return request

    def _resolve_bridge_script(self) -> str:
        configured = self._bridge_script or os.environ.get("ROXY_CDP_BRIDGE_SCRIPT")
        if configured:
            return str(Path(configured).expanduser())
        return str(Path(__file__).resolve().parent.parent / "scripts" / "roxy_cdp_bridge.cjs")

    def _resolve_node_executable(self) -> str:
        configured = self._node_executable or os.environ.get("NODE_EXECUTABLE")
        if configured:
            return configured
        return "node.exe" if sys.platform.startswith("win") else "node"

    def _build_process_env(self) -> dict:
        env = os.environ.copy()
        env.update(self._env_override)

        # 把 config 中的 Roxy 选择传给 Node；显式环境变量优先。
        try:
            from config import (
                ROXY_API_BASE_URL,
                ROXY_API_TOKEN,
                ROXY_BROWSER_DIR_ID,
                ROXY_BROWSER_SORT_NUM,
                ROXY_BROWSER_WINDOW_NAME,
                ROXY_CDP_ENDPOINT,
                ROXY_WORKSPACE_ID,
            )

            values = {
                "ROXY_API_BASE_URL": ROXY_API_BASE_URL,
                "ROXY_API_TOKEN": ROXY_API_TOKEN,
                "ROXY_BROWSER_DIR_ID": ROXY_BROWSER_DIR_ID,
                "ROXY_BROWSER_SORT_NUM": ROXY_BROWSER_SORT_NUM,
                "ROXY_BROWSER_WINDOW_NAME": ROXY_BROWSER_WINDOW_NAME,
                "ROXY_CDP_ENDPOINT": ROXY_CDP_ENDPOINT,
                "ROXY_WORKSPACE_ID": ROXY_WORKSPACE_ID,
            }
            for key, value in values.items():
                if key not in self._env_override and value not in (None, ""):
                    env[key] = str(value)
        except ImportError:
            # 允许在独立测试中不加载项目 config。
            pass
        return env

    def _read_stdout(self) -> None:
        process = self._process
        if process is None or process.stdout is None:
            return
        try:
            while True:
                line = process.stdout.readline()
                if not line:
                    self._responses.put({"_eof": True})
                    return
                try:
                    self._responses.put(json.loads(line))
                except json.JSONDecodeError as exc:
                    self._responses.put({"_protocol_error": str(exc), "line": line[:500]})
        except Exception as exc:
            self._responses.put({"_reader_error": f"{type(exc).__name__}: {exc}"})

    def _ensure_process(self) -> None:
        if self._process is not None:
            return
        if self._closed:
            raise RuntimeError("Roxy CDP client 已关闭")

        script = self._resolve_bridge_script()
        if not Path(script).exists():
            raise FileNotFoundError(f"找不到 Roxy CDP bridge: {script}")
        try:
            self._process = self._popen_factory(
                [self._resolve_node_executable(), script],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=None,
                text=True,
                encoding="utf-8",
                bufsize=1,
                cwd=self._cwd or str(Path(__file__).resolve().parent.parent),
                env=self._build_process_env(),
            )
        except FileNotFoundError as exc:
            raise RuntimeError(
                "未找到 Node 可执行文件，请确认 Node.js 已加入 PATH，"
                "或设置 NODE_EXECUTABLE。"
            ) from exc

        self._reader_thread = threading.Thread(
            target=self._read_stdout,
            name="roxy-cdp-reader",
            daemon=True,
        )
        self._reader_thread.start()

    def _call(self, command: str, **payload):
        request = self._build_request(command, **payload)
        with self._lock:
            if self._exchange is not None:
                result = self._exchange(request)
                if isinstance(result, dict) and "ok" in result and "result" in result:
                    if not result.get("ok"):
                        error = result.get("error") or {}
                        raise RuntimeError(error.get("message") or str(error))
                    return result.get("result")
                return result

            self._ensure_process()
            if self._process.stdin is None:
                raise RuntimeError("Roxy CDP bridge stdin 不可用")
            try:
                self._process.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
                self._process.stdin.flush()
            except (BrokenPipeError, OSError) as exc:
                raise RuntimeError("Roxy CDP bridge 进程已断开") from exc

            deadline = self._request_timeout
            while True:
                try:
                    response = self._responses.get(timeout=deadline)
                except queue.Empty as exc:
                    raise TimeoutError(
                        f"Roxy CDP bridge 等待 {command} 响应超时（>{deadline:g}s）"
                    ) from exc
                if response.get("_eof"):
                    raise RuntimeError("Roxy CDP bridge 已退出且没有返回结果")
                if response.get("_protocol_error"):
                    raise RuntimeError(f"Roxy CDP bridge 输出异常: {response}")
                if response.get("_reader_error"):
                    raise RuntimeError(f"Roxy CDP bridge 读取失败: {response['_reader_error']}")
                if response.get("id") != request["id"]:
                    raise RuntimeError(
                        f"Roxy CDP bridge 响应 id 不匹配: expected={request['id']} got={response.get('id')}"
                    )
                if not response.get("ok"):
                    error = response.get("error") or {}
                    raise RuntimeError(error.get("message") or str(error))
                return response.get("result")

    @staticmethod
    def _timeout_ms(timeout) -> int:
        if timeout is None:
            return 60000
        if isinstance(timeout, (tuple, list)):
            timeout = max(timeout)
        return max(1, int(float(timeout) * 1000))

    def request(self, method: str, url: str, headers: dict | None = None, **kwargs) -> RoxyResponse:
        body = kwargs.pop("data", None)
        json_body = kwargs.pop("json", None)
        if json_body is not None:
            body = json.dumps(json_body, ensure_ascii=False, separators=(",", ":"))
        result = self._call(
            "request",
            method=str(method).upper(),
            url=url,
            headers=dict(headers or {}),
            body=body,
            params=kwargs.pop("params", None),
            allow_redirects=bool(kwargs.pop("allow_redirects", True)),
            timeout_ms=self._timeout_ms(kwargs.pop("timeout", None)),
        )
        return RoxyResponse.from_result(result)

    def navigate(self, url: str, headers: dict | None = None, **kwargs) -> RoxyResponse:
        result = self._call(
            "navigate",
            url=url,
            headers=dict(headers or {}),
            allow_redirects=bool(kwargs.pop("allow_redirects", True)),
            timeout_ms=self._timeout_ms(kwargs.pop("timeout", None)),
        )
        return RoxyResponse.from_result(result)

    def fingerprint(self) -> dict:
        result = self._call("fingerprint")
        if not isinstance(result, dict):
            raise RuntimeError(f"Roxy fingerprint 返回格式错误: {result!r}")
        return result

    def ip(self) -> dict:
        result = self._call("ip")
        if not isinstance(result, dict):
            raise RuntimeError(f"Roxy IP 返回格式错误: {result!r}")
        return {"ip": str(result.get("ip") or "").strip()}

    def auth_workspaces(self) -> list[dict]:
        result = self._call("auth_workspaces")
        if not isinstance(result, list):
            raise RuntimeError(f"Roxy Auth workspace 返回格式错误: {result!r}")
        return [
            {
                "id": str(item.get("id") or "").strip(),
                "kind": str(item.get("kind") or "").strip(),
                "name": str(item.get("name") or "").strip(),
            }
            for item in result
            if isinstance(item, dict) and str(item.get("id") or "").strip()
        ]

    def sentinel_headers(
        self,
        flow: str,
        device_id: str,
        sdk_path: str | None = None,
        timeout=None,
    ) -> dict:
        """让 Roxy 页面中的 Sentinel SDK 生成 token 与可选 SO token。"""
        selected_sdk = sdk_path or str(Path(__file__).resolve().parent.parent / "sentinel" / "sdk.js")
        result = self._call(
            "sentinel",
            flow=flow,
            device_id=device_id,
            sdk_path=selected_sdk,
            timeout_ms=self._timeout_ms(timeout),
        )
        if not isinstance(result, dict) or not result.get("header"):
            raise RuntimeError(f"Roxy Sentinel bridge 返回格式错误: {result!r}")
        return result

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            if self._exchange is not None:
                return
            process = self._process
            if process is None:
                return
            try:
                self._call("close")
            except Exception:
                pass
            try:
                if process.stdin:
                    process.stdin.close()
            except Exception:
                pass
            try:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)
            except Exception:
                try:
                    process.kill()
                except Exception:
                    pass
            for stream in (getattr(process, "stdout", None), getattr(process, "stderr", None)):
                try:
                    if stream is not None:
                        stream.close()
                except Exception:
                    pass
            self._process = None
