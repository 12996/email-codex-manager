import json
import unittest

from core.account_export import setup_2fa


class _FakeResponse:
    def __init__(self, payload, status_code=200, url="https://chatgpt.com/"):
        self.status_code = status_code
        self.url = url
        self.text = json.dumps(payload)

    def json(self):
        return json.loads(self.text)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _DirectMfaSession:
    device_id = "device-1"

    def __init__(self, uses_roxy_cdp=True):
        self.uses_roxy_cdp = uses_roxy_cdp
        self.calls = []
        self._mfa_info_calls = 0

    def get_chatgpt_headers(self, referer="https://chatgpt.com/"):
        return {"referer": referer}

    def get(self, url, headers=None, **kwargs):
        self.calls.append(("GET", url, headers, kwargs))
        if url.endswith("/backend-api/accounts/mfa_info"):
            self._mfa_info_calls += 1
            return _FakeResponse(
                {"mfa_enabled_v2": self._mfa_info_calls > 1},
                url=url,
            )
        raise AssertionError(f"unexpected GET: {url}")

    def post(self, url, headers=None, **kwargs):
        self.calls.append(("POST", url, headers, kwargs))
        if url.endswith("/backend-api/accounts/mfa/enroll"):
            return _FakeResponse(
                {"secret": "JBSWY3DPEHPK3PXP", "session_id": "enroll-1"},
                url=url,
            )
        if url.endswith("/backend-api/accounts/mfa/user/activate_enrollment"):
            return _FakeResponse({"success": True}, url=url)
        if "email-otp/validate" in url or "/api/auth/signin/openai" in url:
            raise AssertionError("Roxy MFA must not start a second email re-auth flow")
        raise AssertionError(f"unexpected POST: {url}")


class RegistrationMfaTests(unittest.TestCase):
    def test_roxy_registration_mfa_reuses_access_token_without_email_reauth(self):
        session = _DirectMfaSession()

        secret = setup_2fa(
            session,
            "new-user@icloud.com",
            access_token="registration-access-token",
        )

        self.assertEqual(secret, "JBSWY3DPEHPK3PXP")
        paths = [call[1] for call in session.calls]
        self.assertEqual(
            paths,
            [
                "https://chatgpt.com/backend-api/accounts/mfa_info",
                "https://chatgpt.com/backend-api/accounts/mfa/enroll",
                "https://chatgpt.com/backend-api/accounts/mfa/user/activate_enrollment",
                "https://chatgpt.com/backend-api/accounts/mfa_info",
            ],
        )
        for call in session.calls:
            self.assertEqual(call[2]["authorization"], "Bearer registration-access-token")

    def test_registration_mfa_never_uses_email_reauth_without_roxy_flag(self):
        session = _DirectMfaSession(uses_roxy_cdp=False)

        secret = setup_2fa(
            session,
            "new-user@icloud.com",
            access_token="registration-access-token",
        )

        self.assertEqual(secret, "JBSWY3DPEHPK3PXP")
        self.assertFalse(any("email-otp/validate" in call[1] for call in session.calls))
        self.assertFalse(any("/api/auth/signin/openai" in call[1] for call in session.calls))


if __name__ == "__main__":
    unittest.main()
