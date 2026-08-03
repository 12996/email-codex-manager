import importlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core.openai_auth import EmailOtpRejectedError


class _Response:
    def __init__(self, payload, status_code=200):
        self.status_code = status_code
        self.text = json.dumps(payload)

    def json(self):
        return json.loads(self.text)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _Session:
    def __init__(self):
        self.calls = []
        self.closed = False

    def get_auth_headers(self, referer):
        return {
            "referer": referer,
            "accept": "application/json",
            "content-type": "application/json",
            "origin": "https://auth.openai.com",
        }

    def post(self, url, headers=None, data=None):
        self.calls.append(("post", url, dict(headers or {}), data))
        if url.endswith("/email-otp/resend"):
            return _Response({"success": True})
        raise AssertionError(f"unexpected POST: {url}")

    def close(self):
        self.closed = True


class NoTwoFaRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.subject = importlib.import_module("core.no_2fa_registration")

    def test_captured_otp_first_flow_returns_access_token_without_password_or_mfa(self):
        session = _Session()
        steps = []
        provider_attempts = []

        def providers(_session):
            provider_attempts.append("providers")
            if len(provider_attempts) == 1:
                raise RuntimeError("net::ERR_CONNECTION_RESET")
            steps.append("providers")

        def sentinel(_session, flow):
            steps.append(f"sentinel:{flow}")
            return {"flow": flow}

        def sentinel_headers(_session, sentinel_response, flow):
            self.assertEqual(sentinel_response["flow"], flow)
            return f"token:{flow}", f"so:{flow}"

        with patch.multiple(
            self.subject,
            get_providers=providers,
            get_csrf_token=lambda _session: steps.append("csrf") or "csrf-value",
            signin_openai=lambda _session, csrf, email, **_kwargs: (
                steps.append("signin"),
                self.assertEqual(csrf, "csrf-value"),
                self.assertEqual(email, "new.user@example.test"),
                "https://auth.openai.com/api/accounts/authorize?state=opaque",
            )[-1],
            follow_authorize=lambda _session, _url: steps.append("authorize"),
            request_sentinel_token=sentinel,
            build_sentinel_header=sentinel_headers,
            validate_email_otp=lambda _session, code, token, so: (
                steps.append(f"validate:{code}:{token}:{so}"),
                {"page": {"type": "about_you"}, "method": "GET", "continue_url": "https://auth.openai.com/about-you"},
            )[-1],
            follow_auth_continue=lambda _session, result, expected: (
                steps.append(f"continue:{expected}"),
                self.assertEqual(result["page"]["type"], expected),
            ),
            create_account=lambda _session, name, birthday, token, so: (
                steps.append(f"create:{name}:{birthday}:{token}:{so}"),
                {"page": {"type": "external_url"}, "method": "GET", "continue_url": "https://auth.openai.com/authorize/continue?opaque"},
            )[-1],
            follow_oauth_callback=lambda _session, _url: steps.append("callback"),
            fetch_session=lambda _session: steps.append("session") or {"accessToken": "at-value"},
        ):
            access_token = self.subject.run_no_2fa_registration(
                email="new.user@example.test",
                name="New User",
                birthday="2000-01-01",
                session_factory=lambda: session,
                wait_for_otp_fn=lambda _email, after_ts, excluded_codes: "123456",
                sleep_fn=lambda _seconds: None,
            )

        self.assertEqual(access_token, "at-value")
        self.assertEqual(provider_attempts, ["providers", "providers"])
        self.assertEqual(
            steps,
            [
                "providers",
                "csrf",
                "signin",
                "authorize",
                "sentinel:authorize_continue",
                "validate:123456:token:authorize_continue:so:authorize_continue",
                "continue:about_you",
                "sentinel:oauth_create_account",
                "create:New User:2000-01-01:token:oauth_create_account:so:oauth_create_account",
                "callback",
                "session",
            ],
        )
        self.assertEqual(len(session.calls), 1)
        method, url, headers, body = session.calls[0]
        self.assertEqual(method, "post")
        self.assertEqual(url, "https://auth.openai.com/api/accounts/email-otp/resend")
        self.assertEqual(body, None)
        self.assertEqual(headers["referer"], "https://auth.openai.com/email-verification")
        self.assertNotIn("openai-sentinel-token", headers)
        self.assertTrue(session.closed)

    def test_retries_after_rejected_otp_with_a_new_sentinel_token(self):
        session = _Session()
        codes = iter(["111111", "222222"])
        sentinel_flows = []
        validate_calls = []

        def sentinel(_session, flow):
            sentinel_flows.append(flow)
            return {"flow": flow, "number": len(sentinel_flows)}

        def validate(_session, code, token, so):
            validate_calls.append((code, token, so))
            if code == "111111":
                raise EmailOtpRejectedError("wrong_email_otp_code")
            return {"page": {"type": "about_you"}, "method": "GET", "continue_url": "https://auth.openai.com/about-you"}

        with patch.multiple(
            self.subject,
            get_providers=lambda _session: None,
            get_csrf_token=lambda _session: "csrf-value",
            signin_openai=lambda *_args, **_kwargs: "https://auth.openai.com/api/accounts/authorize?state=opaque",
            follow_authorize=lambda *_args: None,
            request_sentinel_token=sentinel,
            build_sentinel_header=lambda _session, result, flow: (f"token-{result['number']}", f"so-{result['number']}"),
            validate_email_otp=validate,
            follow_auth_continue=lambda *_args: None,
            create_account=lambda *_args: {"page": {"type": "external_url"}, "method": "GET", "continue_url": "https://auth.openai.com/authorize/continue?opaque"},
            follow_oauth_callback=lambda *_args: None,
            fetch_session=lambda _session: {"accessToken": "at-value"},
        ):
            access_token = self.subject.run_no_2fa_registration(
                email="new.user@example.test",
                name="New User",
                birthday="2000-01-01",
                session_factory=lambda: session,
                wait_for_otp_fn=lambda _email, after_ts, excluded_codes: next(codes),
                sleep_fn=lambda _seconds: None,
            )

        self.assertEqual(access_token, "at-value")
        self.assertEqual(sentinel_flows, ["authorize_continue", "authorize_continue", "oauth_create_account"])
        self.assertEqual(validate_calls, [("111111", "token-1", "so-1"), ("222222", "token-2", "so-2")])

    def test_refuses_an_auth_response_that_does_not_reach_about_you(self):
        session = _Session()

        with patch.multiple(
            self.subject,
            get_providers=lambda _session: None,
            get_csrf_token=lambda _session: "csrf-value",
            signin_openai=lambda *_args, **_kwargs: "https://auth.openai.com/api/accounts/authorize?state=opaque",
            follow_authorize=lambda *_args: None,
            request_sentinel_token=lambda *_args: {"flow": "authorize_continue"},
            build_sentinel_header=lambda *_args: ("token", "so"),
            validate_email_otp=lambda *_args: {"page": {"type": "email_otp_verification"}, "method": "GET", "continue_url": "https://auth.openai.com/email-verification"},
            create_account=lambda *_args: self.fail("must not submit profile after an invalid Auth stage"),
        ):
            with self.assertRaisesRegex(RuntimeError, "about_you"):
                self.subject.run_no_2fa_registration(
                    email="new.user@example.test",
                    name="New User",
                    birthday="2000-01-01",
                    session_factory=lambda: session,
                    wait_for_otp_fn=lambda _email, after_ts, excluded_codes: "123456",
                    sleep_fn=lambda _seconds: None,
                )

        self.assertTrue(session.closed)

    def test_retries_session_before_writing_plain_access_token_file(self):
        session = _Session()
        session_responses = iter([RuntimeError("session not ready"), {"accessToken": "at-value"}])

        def fetch(_session):
            response = next(session_responses)
            if isinstance(response, Exception):
                raise response
            return response

        with patch.multiple(
            self.subject,
            get_providers=lambda _session: None,
            get_csrf_token=lambda _session: "csrf-value",
            signin_openai=lambda *_args, **_kwargs: "https://auth.openai.com/api/accounts/authorize?state=opaque",
            follow_authorize=lambda *_args: None,
            request_sentinel_token=lambda _session, flow: {"flow": flow},
            build_sentinel_header=lambda _session, _result, flow: (f"token:{flow}", f"so:{flow}"),
            validate_email_otp=lambda *_args: {"page": {"type": "about_you"}, "method": "GET", "continue_url": "https://auth.openai.com/about-you"},
            follow_auth_continue=lambda *_args: None,
            create_account=lambda *_args: {"page": {"type": "external_url"}, "method": "GET", "continue_url": "https://auth.openai.com/authorize/continue?opaque"},
            follow_oauth_callback=lambda *_args: None,
            fetch_session=fetch,
        ):
            with tempfile.TemporaryDirectory() as directory:
                output = self.subject.run_and_save_no_2fa_registration(
                    email="new.user@example.test",
                    name="New User",
                    birthday="2000-01-01",
                    output_dir=directory,
                    session_factory=lambda: session,
                    wait_for_otp_fn=lambda _email, after_ts, excluded_codes: "123456",
                    sleep_fn=lambda _seconds: None,
                )
                output_path = Path(output)
                self.assertEqual(output_path.name, "new.user@example.test.txt")
                self.assertEqual(output_path.read_text(encoding="utf-8"), "at-value")


if __name__ == "__main__":
    unittest.main()
