import unittest

from protocol_cpa_replacement import ProtocolReplacementError, run_replacement


class FakeClient:
    instances = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.closed = False
        self.__class__.instances.append(self)

    def get_account(self, account_id=None):
        self.requested_id = account_id
        return {
            "id": 109,
            "email": "account@example.com",
            "password": "account-password",
            "codex_2fa": "JBSWY3DPEHPK3PXP",
            "phone": "+10000000000",
            "sms_api": "https://sms.example.invalid/code",
        }

    def close(self):
        self.closed = True


class FakeSession:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


class FakeProtocol:
    calls = []

    def __init__(self, *, session):
        self.session = session

    def run(self, **kwargs):
        self.__class__.calls.append(kwargs)
        return {"ok": True, "cpa_path": "cpa.json"}


class ProtocolReplacementTests(unittest.TestCase):
    def setUp(self):
        FakeClient.instances.clear()
        FakeProtocol.calls.clear()

    def test_loads_current_account_and_passes_protocol_inputs(self):
        session = FakeSession()

        result = run_replacement(
            account_id="109",
            workspace_id="openai-workspace",
            output_dir="cpa-output",
            env={"SMS_API_PROXY": "http://127.0.0.1:7890"},
            client_factory=FakeClient,
            session_factory=lambda: session,
            protocol_factory=FakeProtocol,
        )

        self.assertEqual(result["ok"], True)
        self.assertEqual(FakeClient.instances[0].requested_id, "109")
        self.assertEqual(FakeClient.instances[0].kwargs["account_id"], "109")
        self.assertEqual(FakeProtocol.calls, [{
            "email": "account@example.com",
            "password": "account-password",
            "mfa_code": "JBSWY3DPEHPK3PXP",
            "workspace_id": "openai-workspace",
            "phone_number": "+10000000000",
            "sms_api_url": "https://sms.example.invalid/code",
            "sms_api_proxy": "http://127.0.0.1:7890",
            "output_dir": "cpa-output",
        }])
        self.assertTrue(session.closed)
        self.assertTrue(FakeClient.instances[0].closed)

    def test_requires_openai_workspace_id(self):
        with self.assertRaisesRegex(ProtocolReplacementError, "OPENAI_WORKSPACE_ID"):
            run_replacement(
                account_id="109",
                workspace_id="",
                env={},
                client_factory=FakeClient,
                session_factory=FakeSession,
                protocol_factory=FakeProtocol,
            )


if __name__ == "__main__":
    unittest.main()
