import unittest

from core.email_provider import fetch_gmail_imap_otp


class GmailImapProviderTests(unittest.TestCase):
    def test_ignores_old_code_until_api_returns_a_newer_code(self):
        responses = iter([
            {
                "status": 200,
                "payload": {
                    "ok": True,
                    "code": "111111",
                    "date": "2026-07-16T08:59:00Z",
                },
            },
            {
                "status": 200,
                "payload": {
                    "ok": True,
                    "code": "222222",
                    "date": "2026-07-16T09:01:00Z",
                },
            },
        ])

        result = fetch_gmail_imap_otp(
            "user@example.com",
            after_ts=1784192400,
            post_json=lambda url, body, timeout: next(responses),
            sleep_fn=lambda seconds: None,
            max_wait=10,
            poll_interval=1,
        )

        self.assertEqual(result, "222222")

    def test_rejects_error_response_after_timeout(self):
        result = None

        with self.assertRaises(TimeoutError):
            result = fetch_gmail_imap_otp(
                "user@example.com",
                after_ts=1784192400,
                post_json=lambda url, body, timeout: {
                    "status": 404,
                    "payload": {"ok": False, "error": "CODE_NOT_FOUND"},
                },
                sleep_fn=lambda seconds: None,
                max_wait=0,
                poll_interval=1,
            )

        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
