import json
import unittest
from urllib.parse import parse_qs, urlparse

from core.chatgpt_auth import signin_openai
from core.openai_auth import authorize_signup, get_create_account_page, register_user, send_email_otp
from main import resolve_registration_password


class _FakeResponse:
    status_code = 200
    text = '{"page":{"type":"email_otp_send"}}'

    def json(self):
        return json.loads(self.text)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _FakeResponseWithUrl(_FakeResponse):
    def __init__(self, payload):
        self.text = json.dumps(payload)


class _Session:
    def __init__(self):
        self.calls = []

    def get_auth_headers(self, referer):
        self.calls.append(("headers", referer))
        return {"referer": referer}

    def get_auth_navigate_headers(self, referer):
        self.calls.append(("headers", referer))
        return {
            "referer": referer,
            "sec-fetch-site": "cross-site",
            "sec-fetch-mode": "navigate",
            "sec-fetch-dest": "document",
        }

    def post(self, url, headers=None, data=None):
        self.calls.append(("post", url, headers, data))
        return _FakeResponse()

    def get(self, url, headers=None, **kwargs):
        self.calls.append(("get", url, headers, kwargs))
        return _FakeResponse()


class PasswordRegistrationTests(unittest.TestCase):
    def test_get_create_account_page_uses_browser_navigation(self):
        class PasswordPageResponse(_FakeResponse):
            url = "https://auth.openai.com/create-account/password"

        class PasswordPageSession(_Session):
            uses_roxy_cdp = True

            def navigate(self, url, headers=None, **kwargs):
                self.calls.append(("navigate", url, headers, kwargs))
                return PasswordPageResponse()

        session = PasswordPageSession()
        get_create_account_page(session)

        method, url, headers, kwargs = session.calls[-1]
        self.assertEqual(method, "navigate")
        self.assertEqual(url, "https://auth.openai.com/create-account/password")
        self.assertEqual(headers["referer"], "https://auth.openai.com/email-verification")
        self.assertTrue(kwargs["allow_redirects"])

    def test_authorize_signup_submits_username_and_signup_hint_before_password(self):
        class SignupSession(_Session):
            def post(self, url, headers=None, data=None):
                self.calls.append(("post", url, headers, data))
                return _FakeResponseWithUrl({"page": {"type": "create_account_password"}})

        session = SignupSession()

        result = authorize_signup(session, "new-user@icloud.com", "authorize-sentinel")

        self.assertEqual(result["page"]["type"], "create_account_password")
        method, url, headers, data = session.calls[-1]
        self.assertEqual(method, "post")
        self.assertEqual(url, "https://auth.openai.com/api/accounts/authorize/continue")
        self.assertEqual(json.loads(data), {
            "username": {"kind": "email", "value": "new-user@icloud.com"},
            "screen_hint": "signup",
        })
        self.assertEqual(headers["openai-sentinel-token"], "authorize-sentinel")
        self.assertEqual(headers["referer"], "https://auth.openai.com/log-in")
        self.assertIn("x-access-flow-invocation-id", headers)

    def test_signin_openai_uses_signup_screen_hint_for_password_registration(self):
        class SigninSession:
            device_id = "device-1"
            auth_session_logging_id = "log-1"

            def get_chatgpt_headers(self):
                return {}

            def post(self, url, headers=None, data=None):
                self.url = url
                return _FakeResponseWithUrl({"url": "https://auth.openai.com/authorize?state=state-1"})

        session = SigninSession()
        signin_openai(
            session,
            "csrf-token",
            "new-user@icloud.com",
            screen_hint="signup",
            prompt="",
            include_login_hint=False,
        )

        query = parse_qs(urlparse(session.url).query)
        self.assertEqual(query["screen_hint"], ["signup"])
        self.assertNotIn("prompt", query)
        self.assertNotIn("login_hint", query)

    def test_resolve_registration_password_uses_protocol_environment_value(self):
        self.assertEqual(
            resolve_registration_password({"ROXY_REGISTER_PASSWORD": " AccountPass12! "}),
            "AccountPass12!",
        )
        with self.assertRaisesRegex(RuntimeError, "ROXY_REGISTER_PASSWORD"):
            resolve_registration_password({})

    def test_register_user_posts_database_password_to_current_auth_endpoint(self):
        session = _Session()

        result = register_user(
            session,
            email="new-user@icloud.com",
            password="AccountPass12!",
            sentinel_header="sentinel-token",
        )

        self.assertEqual(result["page"]["type"], "email_otp_send")
        method, url, headers, body = session.calls[-1]
        self.assertEqual(method, "post")
        self.assertEqual(url, "https://auth.openai.com/api/accounts/user/register")
        self.assertEqual(headers["referer"], "https://auth.openai.com/create-account/password")
        self.assertEqual(headers["openai-sentinel-token"], "sentinel-token")
        self.assertIn("x-access-flow-invocation-id", headers)
        self.assertEqual(json.loads(body), {"password": "AccountPass12!", "username": "new-user@icloud.com"})

    def test_send_email_otp_uses_registration_password_page_as_referrer(self):
        session = _Session()

        send_email_otp(session)

        self.assertEqual(
            session.calls,
            [
                ("headers", "https://auth.openai.com/create-account/password"),
                (
                    "get",
                    "https://auth.openai.com/api/accounts/email-otp/send",
                    {
                        "referer": "https://auth.openai.com/create-account/password",
                        "sec-fetch-site": "same-origin",
                        "sec-fetch-mode": "navigate",
                        "sec-fetch-dest": "document",
                        "sec-fetch-user": "?1",
                    },
                    {"allow_redirects": True},
                ),
            ],
        )



if __name__ == "__main__":
    unittest.main()
