import importlib.util
import os
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).resolve().parents[2] / "protocol_no_2fa_registration.py"


def load_subject():
    spec = importlib.util.spec_from_file_location("protocol_no_2fa_registration", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class NoTwoFaCliTests(unittest.TestCase):
    def test_runtime_environment_reuses_local_admin_password_for_replacement_otp(self):
        subject = load_subject()
        env = {
            "ROXY_PROTOCOL_BROWSER_DIR_ID": "profile-1",
            "PORT": "13400",
            "ADMIN_PASSWORD": "test-admin-password",
        }

        subject.configure_runtime_env(env)

        self.assertEqual(env["REPLACEMENT_API_BASE"], "http://127.0.0.1:13400")
        self.assertEqual(env["REPLACEMENT_ADMIN_PASSWORD"], "test-admin-password")

    def test_roxy_preparer_uses_the_src_auto_node_helper_without_exposing_output(self):
        subject = load_subject()
        calls = []

        class Completed:
            returncode = 0
            stdout = '{\n  "ok": true,\n  "dirId": "profile-1"\n}\n'
            stderr = ""

        with patch.object(subject.subprocess, "run", side_effect=lambda *args, **kwargs: calls.append((args, kwargs)) or Completed()):
            prepared_dir_id = subject.run_roxy_preparer({"NODE_EXECUTABLE": "node.exe"})

        command, kwargs = calls[0]
        self.assertEqual(prepared_dir_id, "profile-1")
        self.assertEqual(command[0], ["node.exe", str(SCRIPT_PATH.parent / "prepare_roxy_no_2fa.cjs")])
        self.assertTrue(kwargs["check"])
        self.assertTrue(kwargs["capture_output"])
        self.assertNotIn("stdout", command[1] if len(command) > 1 else {})

    def test_build_otp_reader_uses_the_selected_unregistered_replacement_account(self):
        subject = load_subject()
        calls = []

        class FakeClient:
            def list_unregistered_accounts(self):
                return [
                    {"id": 8, "email": "other@example.test", "status": "unregistered"},
                    {"id": 9, "email": "new.user@example.test", "status": "unregistered", "email_code_api": "https://mail.example.test/code"},
                ]

            def wait_for_otp(self, account, *, after_ts, excluded_codes):
                calls.append((account["id"], after_ts, set(excluded_codes)))
                return "654321"

            def mark_registered(self, account):
                calls.append(("mark_registered", account["id"]))

            def close(self):
                calls.append(("close",))

        reader, mark_registered, closer = subject.build_otp_reader(
            "new.user@example.test",
            client_factory=FakeClient,
        )
        self.assertEqual(reader("new.user@example.test", after_ts=123.0, excluded_codes={"111111"}), "654321")
        mark_registered()
        closer()
        self.assertEqual(calls, [(9, 123.0, {"111111"}), ("mark_registered", 9), ("close",)])

    def test_execute_registration_marks_the_selected_account_registered_after_saving_at(self):
        subject = load_subject()
        events = []

        class FakeClient:
            def list_unregistered_accounts(self):
                events.append(("list",))
                return [{"id": 9, "email": "new.user@example.test", "status": "unregistered"}]

            def wait_for_otp(self, _account, *, after_ts, excluded_codes):
                return "654321"

            def mark_registered(self, account):
                events.append(("mark_registered", account["id"]))

            def close(self):
                events.append(("close",))

        from core import no_2fa_registration, replacement_client

        with patch.object(replacement_client, "ReplacementServiceClient", FakeClient), \
                patch.object(
                    no_2fa_registration,
                    "run_and_save_no_2fa_registration",
                    side_effect=lambda **_kwargs: events.append(("save_at",)) or "C:/tokens/new.user@example.test.txt",
                ):
            output = subject.execute_registration(
                email="new.user@example.test",
                name="New User",
                birthday="2000-01-01",
                output_dir="C:/tokens",
            )

        self.assertEqual(output, "C:/tokens/new.user@example.test.txt")
        self.assertEqual(events, [
            ("list",),
            ("save_at",),
            ("mark_registered", 9),
            ("close",),
        ])

    def test_main_prepares_roxy_before_running_and_saving_the_protocol(self):
        subject = load_subject()
        events = []
        environment = {
            "ROXY_PROTOCOL_BROWSER_DIR_ID": "profile-1",
            "PORT": "13400",
        }

        with patch.dict(os.environ, environment, clear=True), \
                patch.object(subject, "load_project_env", return_value=None), \
                patch.object(subject, "run_roxy_preparer", side_effect=lambda env: events.append(("prepare", env["ROXY_BROWSER_DIR_ID"])) or "profile-1"), \
                patch.object(subject, "execute_registration", side_effect=lambda **kwargs: events.append(("register", kwargs["email"], kwargs["output_dir"])) or "C:/tokens/new.user@example.test.txt"):
            exit_code = subject.main([
                "--email", "new.user@example.test",
                "--name", "New User",
                "--birthday", "2000-01-01",
            ])

        self.assertEqual(exit_code, 0)
        self.assertEqual(events[0], ("prepare", "profile-1"))
        self.assertEqual(events[1][0:2], ("register", "new.user@example.test"))
        self.assertTrue(events[1][2].endswith("src\\auto\\product_files\\registration"))


if __name__ == "__main__":
    unittest.main()
