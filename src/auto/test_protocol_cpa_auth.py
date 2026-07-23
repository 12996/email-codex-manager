import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

from protocol_cpa_auth import (
    CpaAuthProtocol,
    SmsCodeError,
    create_default_session,
    resolve_workspace_id,
)


def fake_jwt(payload):
    import base64

    def encode(value):
        raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")

    return f"{encode({'alg': 'none'})}.{encode(payload)}.signature"


class FakeResponse:
    def __init__(self, status_code, payload=None, *, headers=None, url="https://auth.openai.com/"):
        self.status_code = status_code
        self.headers = headers or {}
        self.url = url
        self.text = json.dumps(payload or {})

    def json(self):
        return json.loads(self.text)


class FakeSession:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    def get_auth_headers(self, referer):
        return {"referer": referer}

    def get_auth_navigate_headers(self, referer):
        return {"referer": referer}

    def navigate(self, url, **kwargs):
        query = parse_qs(urlsplit(url).query)
        state = str((query.get("state") or [""])[0])
        if state:
            self.state = state
        self.calls.append(("navigate", url, kwargs))
        return next(self.responses)

    def get(self, url, **kwargs):
        self.calls.append(("get", url, kwargs))
        response = next(self.responses)
        if response.status_code == 303 and self.state:
            location = response.headers.get("location", "")
            parsed = urlsplit(location)
            query = parse_qs(parsed.query)
            query["state"] = [self.state]
            response.headers["location"] = urlunsplit(
                (parsed.scheme, parsed.netloc, parsed.path, urlencode(query, doseq=True), "")
            )
        return response

    def post(self, url, headers=None, data=None, **kwargs):
        self.calls.append(("post", url, headers, data, kwargs))
        return next(self.responses)


class CpaAuthProtocolTests(unittest.TestCase):
    def test_default_session_disables_chatgpt_warmup_for_cpa(self):
        import sys

        registration_dir = str(Path(__file__).resolve().parent / "protocol_registration")
        if registration_dir not in sys.path:
            sys.path.insert(0, registration_dir)
        from core import session as session_module

        with patch.object(session_module, "BrowserSession") as browser_session:
            create_default_session()

        browser_session.assert_called_once_with(proxy=None, roxy_warmup_url="")

    def test_replays_login_mfa_consent_and_token_exchange_without_registration_state(self):
        access_token = fake_jwt({
            "exp": 1_900_000_000,
            "https://api.openai.com/auth": {"chatgpt_account_id": "acct-1"},
        })
        session = FakeSession([
            FakeResponse(200),
            FakeResponse(200, {"page": {"type": "password"}}),
            FakeResponse(200, {"challenge": {"id": "a" * 32, "type": "totp"}}),
            FakeResponse(200, {"ok": True}),
            FakeResponse(200, {"page": {"type": "consent"}}),
            FakeResponse(200),
            # consent.data may return a route-data array when no challenge is needed.
            FakeResponse(200, [{"consent_challenge": "consent-value"}]),
            FakeResponse(200, {"ok": True}),
            FakeResponse(302, headers={"location": "/api/oauth/oauth2/auth?consent_verifier=redacted"}),
            FakeResponse(303, headers={
                "location": "http://localhost:1455/auth/callback?code=auth-code&state=state-value"
            }),
            FakeResponse(200, {
                "access_token": access_token,
                "refresh_token": "refresh-value",
                "id_token": "id-value",
            }),
        ])
        session.auth_workspaces = lambda: [
            {"id": "personal-workspace", "kind": "personal"},
        ]

        with tempfile.TemporaryDirectory() as directory:
            result = CpaAuthProtocol(
                session=session,
                sentinel_header_factory=lambda flow: "sentinel-value",
            ).run(
                email="user@example.com",
                password="account-password",
                mfa_code="123456",
                workspace_id="stale-org-workspace",
                output_dir=directory,
            )

            self.assertTrue(result.token_exchanged)
            self.assertEqual(result.workspace_id, "personal-workspace")
            self.assertEqual(Path(result.cpa_path).name, "user@example.com.json")
            payload = json.loads(Path(result.cpa_path).read_text(encoding="utf-8"))
            self.assertEqual(payload["account_id"], "acct-1")
            self.assertEqual(payload["refresh_token"], "refresh-value")

        workspace_call = next(
            call for call in session.calls
            if call[0] == "post" and "workspace/select" in call[1]
        )
        self.assertTrue(workspace_call[2].get("x-access-flow-invocation-id"))
        self.assertEqual(json.loads(workspace_call[3]), {"workspace_id": "personal-workspace"})

        post_urls = [call[1] for call in session.calls if call[0] == "post"]
        self.assertEqual(
            post_urls,
            [
                "https://auth.openai.com/api/accounts/authorize/continue",
                "https://auth.openai.com/api/accounts/password/verify",
                "https://auth.openai.com/api/accounts/mfa/issue_challenge",
                "https://auth.openai.com/api/accounts/mfa/verify",
                "https://auth.openai.com/api/accounts/workspace/select",
                "https://auth.openai.com/oauth/token",
            ],
        )

    def test_phone_add_4xx_continues_to_phone_otp_validation(self):
        access_token = fake_jwt({"exp": 1_900_000_000})
        session = FakeSession([
            FakeResponse(200),
            FakeResponse(200, {"page": {"type": "password"}}),
            FakeResponse(200, {"challenge": {"id": "b" * 32, "type": "totp"}}),
            FakeResponse(200, {"ok": True}),
            FakeResponse(200, {"page": {"type": "phone-add"}}),
            FakeResponse(400, {"error": "already pending"}),
            FakeResponse(200, {"ok": True}),
            FakeResponse(200),
            FakeResponse(200, {"consent_challenge": "consent-value"}),
            FakeResponse(200, {"ok": True}),
            FakeResponse(302, headers={"location": "/api/oauth/oauth2/auth?x=1"}),
            FakeResponse(303, headers={"location": "http://localhost:1455/auth/callback?code=c&state=s"}),
            FakeResponse(200, {"access_token": access_token}),
        ])

        with tempfile.TemporaryDirectory() as directory:
            result = CpaAuthProtocol(
                session=session,
                sentinel_header_factory=lambda flow: "sentinel-value",
                phone_code_factory=lambda: "654321",
            ).run(
                email="phone@example.com",
                password="account-password",
                mfa_code="123456",
                workspace_id="openai-workspace",
                phone_number="+10000000000",
                output_dir=directory,
            )

        self.assertTrue(result.phone_verified)
        phone_call = next(
            call for call in session.calls if call[0] == "post" and "phone-otp/validate" in call[1]
        )
        self.assertEqual(json.loads(phone_call[3]), {"code": "654321"})

    def test_phone_code_stage_requests_add_phone_before_phone_otp(self):
        access_token = fake_jwt({"exp": 1_900_000_000})

        class PhoneStageSession(FakeSession):
            def post(self, url, headers=None, data=None, **kwargs):
                if url.endswith("/api/accounts/add-phone/send"):
                    self.calls.append(("post", url, headers, data, kwargs))
                    return FakeResponse(400, {"error": "phone already added"})
                return super().post(url, headers=headers, data=data, **kwargs)

        session = PhoneStageSession([
            FakeResponse(200),
            FakeResponse(200, {"page": {"type": "password"}}),
            FakeResponse(200, {"challenge": {"id": "p" * 32, "type": "totp"}}),
            FakeResponse(200, {"ok": True}),
            FakeResponse(200, {"page": {"type": "phone-code"}}),
            FakeResponse(200),
            FakeResponse(200),
            FakeResponse(200, {"consent_challenge": "consent-value"}),
            FakeResponse(200),
            FakeResponse(302, headers={"location": "/api/oauth/oauth2/auth?x=1"}),
            FakeResponse(303, headers={
                "location": "http://localhost:1455/auth/callback?code=c&state=s"
            }),
            FakeResponse(200, {"access_token": access_token}),
        ])

        with self.assertLogs("protocol_cpa_auth", level="WARNING") as logs:
            with tempfile.TemporaryDirectory() as directory:
                result = CpaAuthProtocol(
                    session=session,
                    sentinel_header_factory=lambda flow: "sentinel-value",
                    phone_code_factory=lambda: "654321",
                ).run(
                    email="phone-code@example.com",
                    password="account-password",
                    mfa_code="123456",
                    workspace_id="openai-workspace",
                    phone_number="+10000000000",
                    output_dir=directory,
                )

        self.assertTrue(result.phone_verified)
        self.assertTrue(any("MFA verify next_stage=phone-code" in message for message in logs.output))
        post_urls = [call[1] for call in session.calls if call[0] == "post"]
        self.assertLess(
            post_urls.index("https://auth.openai.com/api/accounts/add-phone/send"),
            post_urls.index("https://auth.openai.com/api/accounts/phone-otp/validate"),
        )

    def test_phone_add_4xx_polls_sms_after_add_phone_before_validating(self):
        access_token = fake_jwt({"exp": 1_900_000_000})
        session = FakeSession([
            FakeResponse(200),
            FakeResponse(200, {"page": {"type": "password"}}),
            FakeResponse(200, {"challenge": {"id": "d" * 32, "type": "totp"}}),
            FakeResponse(200, {"ok": True}),
            FakeResponse(200, {"page": {"type": "phone-add"}}),
            FakeResponse(400, {"error": "phone already added"}),
            FakeResponse(200, {"ok": True}),
            FakeResponse(200),
            FakeResponse(200, {"consent_challenge": "consent-value"}),
            FakeResponse(200, {"ok": True}),
            FakeResponse(302, headers={"location": "/api/oauth/oauth2/auth?x=1"}),
            FakeResponse(303, headers={
                "location": "http://localhost:1455/auth/callback?code=c&state=s"
            }),
            FakeResponse(200, {"access_token": access_token}),
        ])
        sms_reads = []

        def read_sms(url, *, proxy="", timeout=15):
            sms_reads.append((url, proxy, timeout))
            if len(sms_reads) == 1:
                raise SmsCodeError("SMS API returned no six-digit code")
            return "654321"

        with patch("protocol_cpa_auth.fetch_sms_code", side_effect=read_sms), patch(
            "protocol_cpa_auth.time.sleep"
        ) as sleep:
            with tempfile.TemporaryDirectory() as directory:
                result = CpaAuthProtocol(
                    session=session,
                    sentinel_header_factory=lambda flow: "sentinel-value",
                ).run(
                    email="phone-poll@example.com",
                    password="account-password",
                    mfa_code="123456",
                    workspace_id="openai-workspace",
                    phone_number="+10000000000",
                    sms_api_url="https://sms.example/code",
                    sms_poll_timeout=1,
                    sms_poll_interval=0,
                    output_dir=directory,
                )

        self.assertTrue(result.phone_verified)
        self.assertEqual(sms_reads, [("https://sms.example/code", "", 15), ("https://sms.example/code", "", 15)])
        self.assertGreaterEqual(sleep.call_count, 1)
        post_urls = [call[1] for call in session.calls if call[0] == "post"]
        self.assertLess(
            post_urls.index("https://auth.openai.com/api/accounts/add-phone/send"),
            post_urls.index("https://auth.openai.com/api/accounts/phone-otp/validate"),
        )

    def test_roxy_cdp_session_reads_sms_api_through_browser_navigation(self):
        access_token = fake_jwt({"exp": 1_900_000_000})
        session = FakeSession([
            FakeResponse(200),
            FakeResponse(200, {"page": {"type": "password"}}),
            FakeResponse(200, {"challenge": {"id": "e" * 32, "type": "totp"}}),
            FakeResponse(200, {"ok": True}),
            FakeResponse(200, {"page": {"type": "phone-add"}}),
            FakeResponse(200),
            FakeResponse(200, {"message": "no sms"}),
            FakeResponse(200, {"text": "Your OpenAI verification code is: 654321"}),
            FakeResponse(200),
            FakeResponse(200, {"consent_challenge": "consent-value"}),
            FakeResponse(200, {"ok": True}),
            FakeResponse(200, {"ok": True}),
            FakeResponse(302, headers={"location": "/api/oauth/oauth2/auth?x=1"}),
            FakeResponse(303, headers={
                "location": "http://localhost:1455/auth/callback?code=c&state=s"
            }),
            FakeResponse(200, {"access_token": access_token}),
        ])
        session.uses_roxy_cdp = True

        with patch("protocol_cpa_auth.fetch_sms_code", side_effect=AssertionError("direct SMS transport should not run")):
            with tempfile.TemporaryDirectory() as directory:
                result = CpaAuthProtocol(
                    session=session,
                    sentinel_header_factory=lambda flow: "sentinel-value",
                ).run(
                    email="roxy-sms@example.com",
                    password="account-password",
                    mfa_code="123456",
                    workspace_id="openai-workspace",
                    phone_number="+10000000000",
                    sms_api_url="https://sms.example/code",
                    sms_poll_timeout=1,
                    sms_poll_interval=0,
                    output_dir=directory,
                )

        self.assertTrue(result.phone_verified)
        sms_navigations = [
            call for call in session.calls
            if call[0] == "navigate" and call[1] == "https://sms.example/code"
        ]
        self.assertEqual(len(sms_navigations), 2)
        phone_call = next(
            call for call in session.calls if call[0] == "post" and "phone-otp/validate" in call[1]
        )
        self.assertEqual(json.loads(phone_call[3]), {"code": "654321"})

    def test_mfa_add_phone_stage_follows_continue_urls_before_consent(self):
        access_token = fake_jwt({"exp": 1_900_000_000})
        session = FakeSession([
            FakeResponse(200),
            FakeResponse(200, {"page": {"type": "password"}}),
            FakeResponse(200, {"challenge": {"id": "c" * 32, "type": "totp"}}),
            FakeResponse(200),
            FakeResponse(200, {
                "page": {"type": "add_phone"},
                "continue_url": "https://auth.openai.com/add-phone",
            }),
            FakeResponse(200),
            FakeResponse(200),
            FakeResponse(200, {
                "ok": True,
                "continue_url": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
            }),
            FakeResponse(200),
            FakeResponse(200, {"consent_challenge": "consent-value"}),
            FakeResponse(200),
            FakeResponse(302, headers={"location": "/api/oauth/oauth2/auth?x=1"}),
            FakeResponse(303, headers={
                "location": "http://localhost:1455/auth/callback?code=c&state=s"
            }),
            FakeResponse(200, {"access_token": access_token}),
        ])

        with tempfile.TemporaryDirectory() as directory:
            result = CpaAuthProtocol(
                session=session,
                sentinel_header_factory=lambda flow: "sentinel-value",
                phone_code_factory=lambda: "654321",
            ).run(
                email="phone@example.com",
                password="account-password",
                mfa_code="123456",
                workspace_id="openai-workspace",
                phone_number="+10000000000",
                output_dir=directory,
            )

        self.assertTrue(result.phone_verified)
        navigations = [call[1] for call in session.calls if call[0] == "navigate"]
        self.assertIn("https://auth.openai.com/add-phone", navigations)
        self.assertIn(
            "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
            navigations,
        )

    def test_resolve_workspace_id_keeps_explicit_value_only_when_current_session_has_it(self):
        class Session:
            def auth_workspaces(self):
                return [
                    {"id": "personal-workspace", "kind": "personal"},
                    {"id": "team-workspace", "kind": "team"},
                ]

        session = Session()
        self.assertEqual(resolve_workspace_id(session, "team-workspace"), "team-workspace")
        self.assertEqual(resolve_workspace_id(session, "stale-org-workspace"), "personal-workspace")


if __name__ == "__main__":
    unittest.main()
