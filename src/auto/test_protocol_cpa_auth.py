import json
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

from protocol_cpa_auth import CpaAuthProtocol


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
            FakeResponse(200, {"consent_challenge": "consent-value"}),
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

        with tempfile.TemporaryDirectory() as directory:
            result = CpaAuthProtocol(
                session=session,
                sentinel_header_factory=lambda flow: "sentinel-value",
            ).run(
                email="user@example.com",
                password="account-password",
                mfa_code="123456",
                workspace_id="openai-workspace",
                output_dir=directory,
            )

            self.assertTrue(result.token_exchanged)
            self.assertEqual(result.workspace_id, "openai-workspace")
            self.assertEqual(Path(result.cpa_path).name, "user@example.com.json")
            payload = json.loads(Path(result.cpa_path).read_text(encoding="utf-8"))
            self.assertEqual(payload["account_id"], "acct-1")
            self.assertEqual(payload["refresh_token"], "refresh-value")

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


if __name__ == "__main__":
    unittest.main()
