import json
import unittest
from unittest.mock import patch

from core import email_provider
from core.replacement_client import (
    ReplacementServiceClient,
    ReplacementServiceError,
    select_replacement_account,
)


class FakeResponse:
    def __init__(self, status_code=200, text=""):
        self.status_code = status_code
        self.text = text


class FakeRequest:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    def __call__(self, method, url, *, headers=None, data=None, timeout=None):
        self.calls.append({
            "method": method,
            "url": url,
            "headers": headers or {},
            "data": data,
            "timeout": timeout,
        })
        return next(self.responses)


class FakeReplacementClient:
    def __init__(self):
        self.account = {
            "id": 42,
            "email": "ready@example.com",
            "status": "unregistered",
            "email_code_api": "https://example.invalid/code",
        }
        self.calls = []

    def acquire_account(self):
        self.calls.append(("acquire_account",))
        return dict(self.account)

    def wait_for_otp(self, account, *, after_ts):
        self.calls.append(("wait_for_otp", account["id"], after_ts))
        return "654321"

    def mark_registered(self, account):
        self.calls.append(("mark_registered", account["id"]))


class ReplacementEmailProviderTests(unittest.TestCase):
    def test_prefers_unregistered_account_with_external_email_api(self):
        accounts = [
            {"id": 1, "email": "registered@example.com", "status": "registered", "email_code_api": "https://api/1"},
            {"id": 2, "email": "retry@example.com", "status": "unregistered", "email_code_api": ""},
            {"id": 3, "email": "ready@example.com", "status": "unregistered", "email_code_api": "https://api/3"},
        ]

        selected = select_replacement_account(accounts)

        self.assertEqual(selected["id"], 3)

    def test_external_json_mail_response_returns_code(self):
        request = FakeRequest([
            FakeResponse(200, json.dumps({
                "messages": [{"subject": "OpenAI verification code is 654321"}],
            })),
        ])
        client = ReplacementServiceClient(
            base_url="http://127.0.0.1:13100",
            admin_password="admin",
            request_fn=request,
        )

        code = client.fetch_otp_for_account({
            "email": "user@example.com",
            "email_code_api": "https://example.invalid/code",
        })

        self.assertEqual(code, "654321")
        self.assertEqual(request.calls[0]["method"], "GET")
        self.assertEqual(request.calls[0]["url"], "https://example.invalid/code")

    def test_external_email_api_bypasses_roxy_page_context_when_cdp_is_enabled(self):
        request = FakeRequest([
            FakeResponse(200, '{"code":"654321"}'),
        ])
        client = ReplacementServiceClient(
            base_url="http://127.0.0.1:13100",
            admin_password="admin",
        )
        # Keep the production transport-selection branch active while replacing
        # only the direct transport with a deterministic test double.
        client._request_fn = request

        with patch("config.ROXY_CDP_ENABLED", True), patch.object(
            client,
            "_request_via_roxy",
            side_effect=AssertionError("邮箱验证码接口不应经过 Roxy"),
        ):
            code = client.fetch_otp_for_account({
                "email": "user@example.com",
                "email_code_api": "http://5.253.38.136:8080/code?email=user%40example.com",
            })

        self.assertEqual(code, "654321")
        self.assertEqual(request.calls[0]["method"], "GET")
        self.assertEqual(
            request.calls[0]["url"],
            "http://5.253.38.136:8080/code?email=user%40example.com",
        )

    def test_external_html_and_text_responses_return_code(self):
        for payload, expected in (
            ("<style>.x{color:#123456}</style><p>Your verification code is 789012</p>", "789012"),
            ("OpenAI one-time code: 345678", "345678"),
        ):
            with self.subTest(expected=expected):
                request = FakeRequest([FakeResponse(200, payload)])
                client = ReplacementServiceClient(
                    base_url="http://127.0.0.1:13100",
                    admin_password="admin",
                    request_fn=request,
                )
                self.assertEqual(
                    client.fetch_otp_for_account({
                        "email": "user@example.com",
                        "email_code_api": "https://example.invalid/code",
                    }),
                    expected,
                )

    def test_local_icloud_and_gmail_endpoints_are_selected_by_domain(self):
        for email, path in (
            ("user@icloud.com", "/api/icloud-verification-code/latest"),
            ("user@gmail.com", "/api/verification-code/latest"),
        ):
            with self.subTest(email=email):
                request = FakeRequest([
                    FakeResponse(200, json.dumps({"ok": True, "code": "112233"})),
                ])
                client = ReplacementServiceClient(
                    base_url="http://127.0.0.1:13100",
                    admin_password="admin",
                    request_fn=request,
                )
                self.assertEqual(
                    client.fetch_otp_for_account({"email": email, "email_code_api": ""}),
                    "112233",
                )
                self.assertEqual(request.calls[0]["method"], "POST")
                self.assertTrue(request.calls[0]["url"].endswith(path))
                self.assertEqual(json.loads(request.calls[0]["data"])["account"], email)

    def test_list_requires_a_runtime_admin_password(self):
        client = ReplacementServiceClient(
            base_url="http://127.0.0.1:13100",
            admin_password="",
            request_fn=FakeRequest([]),
        )

        with self.assertRaises(ReplacementServiceError) as context:
            client.list_unregistered_accounts()

        self.assertIn("后台密码", str(context.exception))
        self.assertNotIn("admin", str(context.exception))

    def test_acquire_account_logs_in_before_listing_accounts(self):
        request = FakeRequest([
            FakeResponse(302),
            FakeResponse(200, json.dumps({
                "accounts": [{
                    "id": 9,
                    "email": "ready@example.com",
                    "status": "unregistered",
                    "email_code_api": "https://example.invalid/code",
                }],
            })),
        ])
        client = ReplacementServiceClient(
            base_url="http://127.0.0.1:13100",
            admin_password="admin",
            request_fn=request,
        )

        account = client.acquire_account()

        self.assertEqual(account["id"], 9)
        self.assertEqual([call["method"] for call in request.calls], ["POST", "GET"])
        self.assertIn("status=unregistered", request.calls[1]["url"])

    def test_acquire_account_can_use_a_configured_account_id(self):
        request = FakeRequest([
            FakeResponse(302),
            FakeResponse(200, json.dumps({
                "ok": True,
                "account": {
                    "id": 42,
                    "email": "selected@example.com",
                    "status": "unregistered",
                    "email_code_api": "https://example.invalid/code",
                },
            })),
        ])
        client = ReplacementServiceClient(
            base_url="http://127.0.0.1:13100",
            admin_password="admin",
            account_id=42,
            request_fn=request,
        )

        account = client.acquire_account()

        self.assertEqual(account["id"], 42)
        self.assertEqual(request.calls[1]["method"], "GET")
        self.assertTrue(request.calls[1]["url"].endswith("/replacement-accounts/42"))

    def test_configured_account_id_rejects_a_non_unregistered_account(self):
        request = FakeRequest([
            FakeResponse(302),
            FakeResponse(200, json.dumps({
                "ok": True,
                "account": {
                    "id": 42,
                    "email": "already@example.com",
                    "status": "registered",
                },
            })),
        ])
        client = ReplacementServiceClient(
            base_url="http://127.0.0.1:13100",
            admin_password="admin",
            account_id=42,
            request_fn=request,
        )

        with self.assertRaises(ReplacementServiceError) as context:
            client.acquire_account()

        self.assertIn("unregistered", str(context.exception))

    def test_mark_registered_uses_status_patch_after_login(self):
        request = FakeRequest([
            FakeResponse(302),
            FakeResponse(200, "{}"),
        ])
        client = ReplacementServiceClient(
            base_url="http://127.0.0.1:13100",
            admin_password="admin",
            request_fn=request,
        )

        client.mark_registered({"id": 9, "email": "ready@example.com"})

        self.assertEqual(request.calls[1]["method"], "PATCH")
        self.assertEqual(json.loads(request.calls[1]["data"])["status"], "registered")

    def test_email_provider_uses_replacement_client_for_email_and_otp(self):
        fake_client = FakeReplacementClient()
        email_provider._replacement_accounts.clear()

        with patch.object(email_provider, "_get_replacement_client", return_value=fake_client):
            email = email_provider.acquire_email()
            code = email_provider.wait_for_otp(email, after_ts=123.0)

        self.assertEqual(email, "ready@example.com")
        self.assertEqual(code, "654321")
        self.assertEqual(fake_client.calls[0], ("acquire_account",))
        self.assertEqual(fake_client.calls[1], ("wait_for_otp", 42, 123.0))

    def test_email_provider_marks_the_selected_replacement_account_registered(self):
        fake_client = FakeReplacementClient()
        email_provider._replacement_accounts.clear()

        with patch.object(email_provider, "_get_replacement_client", return_value=fake_client):
            email_provider.acquire_email()
            email_provider.mark_registration_success("ready@example.com")

        self.assertEqual(fake_client.calls[-1], ("mark_registered", 42))

    def test_registration_status_helper_delegates_without_exposing_credentials(self):
        from main import _sync_replacement_registration_status

        with patch("main.mark_registration_success") as mark_success:
            _sync_replacement_registration_status("ready@example.com")

        mark_success.assert_called_once_with("ready@example.com")


if __name__ == "__main__":
    unittest.main()
