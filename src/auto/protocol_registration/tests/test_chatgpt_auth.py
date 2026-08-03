import unittest

from core.chatgpt_auth import get_csrf_token


class _Response:
    def json(self):
        return {"csrfToken": "csrf-secret-value"}

    def raise_for_status(self):
        return None


class _Session:
    def get_chatgpt_headers(self):
        return {}

    def get(self, _url, headers=None):
        return _Response()


class ChatgptAuthTests(unittest.TestCase):
    def test_get_csrf_token_does_not_log_its_value(self):
        with self.assertLogs("core.chatgpt_auth", level="INFO") as captured:
            token = get_csrf_token(_Session())

        self.assertEqual(token, "csrf-secret-value")
        self.assertNotIn("csrf-secret-value", "\n".join(captured.output))


if __name__ == "__main__":
    unittest.main()
