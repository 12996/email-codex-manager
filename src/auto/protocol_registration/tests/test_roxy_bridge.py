import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

from core.roxy_bridge import build_proxy_url, resolve_roxy_proxy
from core.roxy_cdp import RoxyCdpClient, RoxyResponse


class RoxyBridgeTests(unittest.TestCase):
    def test_builds_socks5h_proxy_url_from_roxy_fields(self):
        result = build_proxy_url({
            "proxyCategory": "SOCKS5",
            "host": "127.0.0.1",
            "port": "1080",
            "proxyUserName": "user",
            "proxyPassword": "pass",
        })

        self.assertEqual(result, "socks5h://user:pass@127.0.0.1:1080")

    def test_resolves_profile_by_sort_number_without_printing_credentials(self):
        result = resolve_roxy_proxy(
            api_base_url="http://127.0.0.1:50000",
            workspace_id=111070,
            sort_num=8,
            get_json=lambda url, token: {
                "code": 0,
                "data": {
                    "rows": [
                        {
                            "dirId": "target",
                            "windowSortNum": 8,
                            "proxyInfo": {
                                "protocol": "SOCKS5",
                                "host": "proxy.example",
                                "port": "3010",
                                "proxyUserName": "user:pass",
                                "proxyPassword": "pass",
                            },
                        }
                    ]
                },
            },
        )

        self.assertEqual(result, "socks5h://user:pass@proxy.example:3010")

    def test_raises_when_profile_has_no_proxy(self):
        with self.assertRaises(RuntimeError):
            resolve_roxy_proxy(
                api_base_url="http://127.0.0.1:50000",
                workspace_id=111070,
                sort_num=8,
                get_json=lambda url, token: {
                    "code": 0,
                    "data": {"rows": [{"windowSortNum": 8, "proxyInfo": {}}]},
                },
            )

    def test_browser_session_uses_roxy_proxy_when_enabled(self):
        from core.session import BrowserSession

        with patch("config.ROXY_PROXY_ENABLED", True), patch(
            "core.roxy_bridge.resolve_roxy_proxy",
            return_value="socks5h://user:pass@proxy.example:3010",
        ):
            session = BrowserSession()

        self.assertEqual(session.proxy, "socks5h://user:pass@proxy.example:3010")

    def test_cdp_request_returns_requests_like_response(self):
        calls = []

        def exchange(request):
            calls.append(request)
            return {
                "status_code": 200,
                "url": request["url"],
                "headers": {"content-type": "application/json"},
                "text": '{"ok": true}',
            }

        client = RoxyCdpClient(exchange=exchange)
        response = client.request(
            "GET",
            "https://example.test/ping",
            headers={"User-Agent": "ignored", "Accept": "application/json"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})
        self.assertTrue(response.ok)
        self.assertEqual(calls[0]["command"], "request")
        self.assertEqual(calls[0]["method"], "GET")
        self.assertEqual(calls[0]["url"], "https://example.test/ping")

    def test_cdp_navigation_and_fingerprint_use_dedicated_commands(self):
        commands = []

        def exchange(request):
            commands.append(request["command"])
            if request["command"] == "fingerprint":
                return {"userAgent": "Roxy Chrome", "timeZone": "Asia/Tokyo"}
            return {"status_code": 302, "url": "https://example.test/landing", "headers": {}, "text": ""}

        client = RoxyCdpClient(exchange=exchange)
        navigation = client.navigate("https://example.test/start")
        fingerprint = client.fingerprint()

        self.assertEqual(navigation.url, "https://example.test/landing")
        self.assertEqual(fingerprint["userAgent"], "Roxy Chrome")
        self.assertEqual(commands, ["navigate", "fingerprint"])

    def test_cdp_client_reads_selected_profile_exit_ip(self):
        calls = []

        def exchange(request):
            calls.append(request["command"])
            self.assertEqual(request["command"], "ip")
            return {"ip": "203.0.113.10"}

        client = RoxyCdpClient(exchange=exchange)

        self.assertEqual(client.ip(), {"ip": "203.0.113.10"})
        self.assertEqual(calls, ["ip"])

    def test_cdp_client_reads_sanitized_auth_workspace_metadata(self):
        calls = []

        def exchange(request):
            calls.append(request["command"])
            self.assertEqual(request["command"], "auth_workspaces")
            return [
                {"id": "personal-workspace", "kind": "personal", "name": ""},
                {"id": "team-workspace", "kind": "team", "name": "Team"},
            ]

        client = RoxyCdpClient(exchange=exchange)

        self.assertEqual(
            client.auth_workspaces(),
            [
                {"id": "personal-workspace", "kind": "personal", "name": ""},
                {"id": "team-workspace", "kind": "team", "name": "Team"},
            ],
        )
        self.assertEqual(calls, ["auth_workspaces"])

    def test_cdp_response_raises_for_http_error(self):
        response = RoxyResponse(
            status_code=403,
            url="https://example.test/blocked",
            headers={},
            text="blocked",
        )

        with self.assertRaises(RuntimeError):
            response.raise_for_status()

    def test_browser_session_can_route_requests_through_roxy_cdp(self):
        from core.session import BrowserSession

        class FakeCdpClient:
            def __init__(self):
                self.calls = []

            def fingerprint(self):
                self.calls.append(("fingerprint", "", {}))
                return {"userAgent": "Roxy Chrome", "timeZone": "Asia/Tokyo"}

            def navigate(self, url, headers=None, **kwargs):
                self.calls.append(("navigate", url, kwargs))
                return RoxyResponse(200, url, {}, "")

            def request(self, method, url, **kwargs):
                self.calls.append((method, url, kwargs))
                return RoxyResponse(200, url, {}, "{}")

            def close(self):
                self.calls.append(("close", "", {}))

        fake = FakeCdpClient()
        with patch("config.ROXY_CDP_ENABLED", True), patch(
            "core.session.RoxyCdpClient", return_value=fake
        ):
            session = BrowserSession(proxy=None)
            response = session.get("https://example.test/ping", headers={"Accept": "*/*"})
            session.close()

        self.assertEqual(response.status_code, 200)
        self.assertTrue(session.uses_roxy_cdp)
        self.assertEqual(session.user_agent, "Roxy Chrome")
        self.assertEqual(fake.calls[0][0:2], ("fingerprint", ""))
        self.assertEqual(fake.calls[1][0:2], ("navigate", "https://chatgpt.com/"))
        self.assertEqual(fake.calls[2][0:2], ("GET", "https://example.test/ping"))
        self.assertEqual(fake.calls[-1][0], "close")

    def test_browser_session_rejects_roxy_ip_change_before_next_request(self):
        class FakeCdpClient:
            def __init__(self):
                self.calls = []
                self.ips = iter(["203.0.113.10", "203.0.113.11"])

            def fingerprint(self):
                self.calls.append(("fingerprint", "", {}))
                return {"userAgent": "Roxy Chrome"}

            def navigate(self, url, headers=None, **kwargs):
                self.calls.append(("navigate", url, kwargs))
                return RoxyResponse(200, url, {}, "")

            def ip(self):
                value = next(self.ips)
                self.calls.append(("ip", value, {}))
                return {"ip": value}

            def request(self, method, url, **kwargs):
                self.calls.append((method, url, kwargs))
                return RoxyResponse(200, url, {}, "{}")

            def close(self):
                self.calls.append(("close", "", {}))

        from core.session import BrowserSession

        fake = FakeCdpClient()
        with patch("config.ROXY_CDP_ENABLED", True), patch(
            "config.ROXY_IP_CHECK_ENABLED", True
        ), patch("core.session.RoxyCdpClient", return_value=fake):
            session = BrowserSession(proxy=None)
            session.get("https://example.test/first")
            with self.assertRaisesRegex(RuntimeError, "IP"):
                session.get("https://example.test/second")

        request_urls = [call[1] for call in fake.calls if call[0] == "GET"]
        self.assertEqual(request_urls, ["https://example.test/first"])

    def test_browser_session_continues_when_roxy_ip_metadata_is_temporarily_unavailable(self):
        class FakeCdpClient:
            def fingerprint(self):
                return {"userAgent": "Roxy Chrome"}

            def navigate(self, url, headers=None, **kwargs):
                return RoxyResponse(200, url, {}, "")

            def ip(self):
                raise RuntimeError("Roxy API 502")

            def request(self, method, url, **kwargs):
                return RoxyResponse(200, url, {}, "{}")

            def close(self):
                return None

        from core.session import BrowserSession

        with patch("config.ROXY_CDP_ENABLED", True), patch(
            "config.ROXY_IP_CHECK_ENABLED", True
        ), patch("core.session.RoxyCdpClient", return_value=FakeCdpClient()):
            session = BrowserSession(proxy=None)
            response = session.get("https://example.test/ping")
            session.close()

        self.assertEqual(response.status_code, 200)

    def test_browser_session_warms_the_roxy_page_before_first_http_request(self):
        from core.session import BrowserSession

        class FakeCdpClient:
            def __init__(self):
                self.calls = []

            def fingerprint(self):
                self.calls.append(("fingerprint", "", {}))
                return {"userAgent": "Roxy Chrome"}

            def navigate(self, url, headers=None, **kwargs):
                self.calls.append(("navigate", url, kwargs))
                return RoxyResponse(200, url, {}, "")

            def request(self, method, url, **kwargs):
                self.calls.append((method, url, kwargs))
                return RoxyResponse(200, url, {}, "{}")

            def close(self):
                self.calls.append(("close", "", {}))

        fake = FakeCdpClient()
        with patch("config.ROXY_CDP_ENABLED", True), patch(
            "core.session.RoxyCdpClient", return_value=fake
        ):
            session = BrowserSession(proxy=None)
            session.get("https://chatgpt.com/api/auth/providers")

        self.assertEqual([call[0] for call in fake.calls[:3]], ["fingerprint", "navigate", "GET"])
        self.assertEqual(fake.calls[1][1], "https://chatgpt.com/")

    def test_browser_session_can_skip_chatgpt_warmup_for_auth_protocol(self):
        from core.session import BrowserSession

        class FakeCdpClient:
            def __init__(self):
                self.calls = []

            def fingerprint(self):
                self.calls.append(("fingerprint", "", {}))
                return {"userAgent": "Roxy Chrome"}

            def navigate(self, url, headers=None, **kwargs):
                self.calls.append(("navigate", url, kwargs))
                return RoxyResponse(200, url, {}, "")

            def request(self, method, url, **kwargs):
                self.calls.append((method, url, kwargs))
                return RoxyResponse(200, url, {}, "{}")

            def close(self):
                self.calls.append(("close", "", {}))

        fake = FakeCdpClient()
        with patch("config.ROXY_CDP_ENABLED", True), patch(
            "core.session.RoxyCdpClient", return_value=fake
        ):
            session = BrowserSession(proxy=None, roxy_warmup_url="")
            response = session.get("https://auth.openai.com/api/accounts/authorize/continue")
            session.close()

        self.assertEqual(response.status_code, 200)
        self.assertEqual([call[0] for call in fake.calls[:2]], ["fingerprint", "GET"])

    def test_cdp_client_round_trips_over_jsonl_child_process(self):
        bridge_source = r'''
const readline = require('readline');
const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  const request = JSON.parse(line);
  let result;
  if (request.command === 'fingerprint') {
    result = { userAgent: 'Fake Roxy', timeZone: 'Asia/Tokyo' };
  } else {
    result = {
      status_code: request.command === 'navigate' ? 302 : 200,
      url: request.url || 'about:blank',
      headers: {},
      text: request.command === 'request' ? '{"transport":"ok"}' : ''
    };
  }
  process.stdout.write(JSON.stringify({ id: request.id, ok: true, result }) + '\n');
  if (request.command === 'close') process.exit(0);
});
'''

        with tempfile.TemporaryDirectory() as temp_dir:
            bridge_path = Path(temp_dir) / "fake-roxy-bridge.cjs"
            bridge_path.write_text(bridge_source, encoding="utf-8")
            client = RoxyCdpClient(
                bridge_script=str(bridge_path),
                node_executable="node",
                request_timeout=5,
            )
            try:
                response = client.request("GET", "https://example.test/ping")
                fingerprint = client.fingerprint()
            finally:
                client.close()

        self.assertEqual(response.json(), {"transport": "ok"})
        self.assertEqual(fingerprint["userAgent"], "Fake Roxy")

    def test_cdp_client_waits_for_all_page_command_retry_attempts(self):
        client = RoxyCdpClient(request_timeout=60, exchange=lambda request: {})

        self.assertGreaterEqual(
            client._response_wait_timeout("navigate", {"timeout_ms": 60_000}),
            190,
        )
        self.assertGreaterEqual(
            client._response_wait_timeout("request", {"timeout_ms": 60_000}),
            190,
        )

    def test_cdp_client_can_request_browser_generated_sentinel_headers(self):
        calls = []

        def exchange(request):
            calls.append(request)
            self.assertEqual(request["command"], "sentinel")
            return {
                "header": '{"p":"proof","t":"turnstile","c":"challenge","id":"device-1","flow":"authorize_continue"}',
                "so_header": '{"so":"observer","c":"challenge","id":"device-1","flow":"authorize_continue"}',
            }

        client = RoxyCdpClient(exchange=exchange)
        result = client.sentinel_headers("authorize_continue", "device-1")

        self.assertIn('"flow":"authorize_continue"', result["header"])
        self.assertIn('"so":"observer"', result["so_header"])
        self.assertEqual(calls[0]["device_id"], "device-1")

    def test_authorize_redirect_uses_page_navigation_in_cdp_mode(self):
        from core.openai_auth import follow_authorize

        class FakeResponse:
            url = "https://auth.openai.com/email-verification"

            def raise_for_status(self):
                return None

        class FakeSession:
            uses_roxy_cdp = True

            def get_auth_navigate_headers(self, referer):
                return {"referer": referer}

            def navigate(self, url, headers=None, **kwargs):
                self.call = (url, headers, kwargs)
                return FakeResponse()

            def get(self, *args, **kwargs):
                raise AssertionError("CDP 模式不应使用 curl_cffi GET 跟随导航")

        session = FakeSession()
        follow_authorize(session, "https://auth.openai.com/api/accounts/authorize?x=1")
        self.assertEqual(session.call[0], "https://auth.openai.com/api/accounts/authorize?x=1")
        self.assertTrue(session.call[2]["allow_redirects"])

    def test_oauth_callback_uses_page_navigation_in_cdp_mode(self):
        from core.account_export import follow_oauth_callback

        class FakeResponse:
            url = "https://chatgpt.com/api/auth/callback/openai?code=ok"

            def raise_for_status(self):
                return None

        class FakeSession:
            uses_roxy_cdp = True

            def get_auth_navigate_headers(self, referer):
                return {"referer": referer}

            def navigate(self, url, headers=None, **kwargs):
                self.call = (url, headers, kwargs)
                return FakeResponse()

            def get(self, *args, **kwargs):
                raise AssertionError("CDP 模式不应使用 curl_cffi GET 跟随 OAuth 回调")

        session = FakeSession()
        result = follow_oauth_callback(session, "https://auth.openai.com/authorize/continue?x=1")
        self.assertIn("chatgpt.com", result)
        self.assertTrue(session.call[2]["allow_redirects"])

    def test_oauth_callback_rejects_a_failed_navigation_response(self):
        from core.account_export import follow_oauth_callback

        class FailedResponse:
            url = "https://chatgpt.com/api/auth/callback/openai"

            def raise_for_status(self):
                raise RuntimeError("HTTP 502")

        class FakeSession:
            uses_roxy_cdp = True

            def get_auth_navigate_headers(self, referer):
                return {"referer": referer}

            def navigate(self, url, headers=None, **kwargs):
                return FailedResponse()

        with self.assertRaisesRegex(RuntimeError, "HTTP 502"):
            follow_oauth_callback(
                FakeSession(),
                "https://auth.openai.com/authorize/continue?x=1",
            )

    def test_sentinel_runner_receives_the_active_cdp_user_agent(self):
        from core.openai_auth import build_sentinel_header

        class FakeSession:
            device_id = "device-1"
            user_agent = "Mozilla/5.0 Roxy Chrome"
            roxy_fingerprint = {
                "screen": {"width": 2560, "height": 1440},
                "hardwareConcurrency": 12,
            }

        with patch(
            "core.openai_auth.generate_sentinel_token",
            return_value='{"p":"proof","c":"challenge","id":"device-1","flow":"authorize_continue"}',
        ) as generate:
            build_sentinel_header(FakeSession(), {"token": "challenge"}, "authorize_continue")

        self.assertEqual(generate.call_args.kwargs["user_agent"], "Mozilla/5.0 Roxy Chrome")
        self.assertEqual(generate.call_args.kwargs["fingerprint"]["hardwareConcurrency"], 12)

    def test_cdp_sentinel_header_uses_page_sdk_so_token(self):
        from core.openai_auth import build_sentinel_header

        class FakeSession:
            uses_roxy_cdp = True
            device_id = "device-1"

            def ensure_fingerprint(self):
                return None

            def sentinel_headers(self, flow):
                self.flow = flow
                return {
                    "header": '{"p":"proof","t":"turnstile","c":"challenge","id":"device-1","flow":"authorize_continue"}',
                    "so_header": '{"so":"observer","c":"challenge","id":"device-1","flow":"authorize_continue"}',
                }

        with patch("core.openai_auth.generate_sentinel_token") as generate:
            header, so_header = build_sentinel_header(
                FakeSession(), {"token": "old-challenge"}, "authorize_continue"
            )

        generate.assert_not_called()
        self.assertIn('"t":"turnstile"', header)
        self.assertIn('"so":"observer"', so_header)

    def test_sentinel_fingerprint_data_can_follow_roxy_page_values(self):
        from core.sentinel import generate_fingerprint_data

        values = generate_fingerprint_data(
            "device-1",
            fingerprint={
                "userAgent": "Mozilla/5.0 Roxy Chrome",
                "language": "en-US",
                "languages": ["en-US", "en"],
                "hardwareConcurrency": 12,
                "screen": {"width": 2560, "height": 1440},
            },
        )

        self.assertEqual(values[0], 4000)
        self.assertEqual(values[4], "Mozilla/5.0 Roxy Chrome")
        self.assertEqual(values[7], "en-US")
        self.assertEqual(values[8], "en-US,en")
        self.assertEqual(values[16], 12)

    def test_sentinel_request_uses_the_active_roxy_fingerprint(self):
        from core.openai_auth import request_sentinel_token

        class FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {"token": "challenge", "persona": "test"}

        class FakeSession:
            device_id = "device-1"
            roxy_fingerprint = None

            def ensure_fingerprint(self):
                self.roxy_fingerprint = {
                    "userAgent": "Mozilla/5.0 Roxy Chrome",
                    "hardwareConcurrency": 12,
                }

            def get_sentinel_headers(self):
                return {}

            def post(self, *args, **kwargs):
                self.call = (args, kwargs)
                return FakeResponse()

        with patch("core.openai_auth.generate_requirements_token", return_value="p") as generate:
            request_sentinel_token(FakeSession(), "authorize_continue")

        self.assertEqual(generate.call_args.kwargs["fingerprint"]["hardwareConcurrency"], 12)

    def test_cdp_sentinel_request_uses_page_sdk_once(self):
        from core.openai_auth import request_sentinel_token

        class FakeSession:
            uses_roxy_cdp = True
            device_id = "device-1"
            roxy_fingerprint = None

            def ensure_fingerprint(self):
                self.roxy_fingerprint = {"userAgent": "Roxy"}

            def sentinel_headers(self, flow):
                self.call_count = getattr(self, "call_count", 0) + 1
                return {
                    "header": '{"p":"proof","t":"turnstile","c":"challenge","id":"device-1","flow":"authorize_continue"}',
                    "so_header": '{"so":"observer","c":"challenge","id":"device-1","flow":"authorize_continue"}',
                }

        session = FakeSession()
        result = request_sentinel_token(session, "authorize_continue")

        self.assertEqual(session.call_count, 1)
        self.assertEqual(result["_roxy_cdp_headers"]["so_header"].count("observer"), 1)

    def test_registration_closes_the_browser_session_on_early_failure(self):
        import main

        class FakeSession:
            proxy = ""
            device_id = "device-1"
            auth_session_logging_id = "log-1"

            def close(self):
                self.closed = True

        session = FakeSession()
        with patch("main.resolve_registration_password", return_value="AccountPass12!"), patch(
            "main.BrowserSession", return_value=session
        ), patch("main.get_providers", side_effect=RuntimeError("stop before network")), patch(
            "config.EMAIL_SOURCE", ""
        ):
            result = main.run_registration("user@example.test", "Test User")

        self.assertFalse(result["success"])
        self.assertTrue(session.closed)

    def test_registration_submits_password_from_verified_auth_page_before_otp_validation(self):
        import main

        class FakeSession:
            proxy = ""
            device_id = "device-1"
            auth_session_logging_id = "log-1"

            def close(self):
                self.closed = True

        session = FakeSession()
        with patch("main.resolve_registration_password", return_value="AccountPass12!"), patch(
            "main.BrowserSession", return_value=session
        ), patch("main.get_providers", return_value={}), patch(
            "main.get_csrf_token", return_value="csrf-token"
        ), patch("main.signin_openai", return_value="https://auth.openai.com/authorize"), patch(
            "main.follow_authorize"
        ), patch(
            "main.authorize_signup",
            return_value={"page": {"type": "email_otp_verification"}, "method": "GET", "continue_url": "https://auth.openai.com/api/accounts/email-otp/send"},
        ), patch(
            "main.follow_auth_continue"
        ), patch("main.request_sentinel_token", return_value={"token": "challenge"}) as sentinel, patch(
            "main.build_sentinel_header", return_value=("sentinel-token", None)
        ), patch(
            "main.get_create_account_page"
        ), patch("main.register_user", side_effect=RuntimeError("stop after password submission")) as register, patch(
            "main.time.sleep"
        ), patch("config.EMAIL_SOURCE", ""):
            result = main.run_registration("user@example.test", "Test User", otp_code="123456")

        self.assertFalse(result["success"])
        self.assertEqual(
            [call.args[1] for call in sentinel.call_args_list],
            ["authorize_continue", "username_password_create"],
        )
        self.assertEqual(
            register.call_args.args,
            (session, "user@example.test", "AccountPass12!", "sentinel-token", None),
        )


if __name__ == "__main__":
    unittest.main()
