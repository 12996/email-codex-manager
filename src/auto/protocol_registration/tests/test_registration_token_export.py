import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core.account_export import save_account_data, save_registration_access_token_file


class RegistrationTokenExportTests(unittest.TestCase):
    def test_registration_status_requires_activated_mfa_when_mfa_is_enabled(self):
        from main import registration_status_ready

        with patch("main.ENABLE_2FA", True):
            self.assertFalse(registration_status_ready(None))
            self.assertTrue(registration_status_ready("JBSWY3DPEHPK3PXP"))

    def test_registration_status_does_not_require_mfa_when_mfa_is_disabled(self):
        from main import registration_status_ready

        with patch("main.ENABLE_2FA", False):
            self.assertTrue(registration_status_ready(None))

    def test_emit_registration_result_json_exposes_only_mfa_metadata_when_enabled(self):
        from main import emit_registration_result

        output = io.StringIO()
        with patch.dict(os.environ, {"REGISTRATION_RESULT_JSON": "1"}, clear=False), \
                patch("sys.stdout", output):
            emit_registration_result([{
                "success": True,
                "totp_secret": "JBSWY3DPEHPK3PXP",
                "access_token": "must-not-be-emitted",
            }])

        prefix, payload_text = output.getvalue().strip().split("=", 1)
        self.assertEqual(prefix, "ROXY_REGISTER_RESULT_JSON")
        self.assertEqual(
            json.loads(payload_text),
            {
                "registrationMfa": {
                    "secret": "JBSWY3DPEHPK3PXP",
                    "enabled": True,
                },
            },
        )
        self.assertNotIn("must-not-be-emitted", output.getvalue())

    def test_emit_registration_result_json_is_disabled_by_default(self):
        from main import emit_registration_result

        output = io.StringIO()
        with patch.dict(os.environ, {"REGISTRATION_RESULT_JSON": "0"}, clear=False), \
                patch("sys.stdout", output):
            emit_registration_result([{
                "success": True,
                "totp_secret": "JBSWY3DPEHPK3PXP",
            }])

        self.assertEqual(output.getvalue(), "")

    def test_save_registration_access_token_file_writes_raw_token_txt(self):
        with tempfile.TemporaryDirectory() as directory:
            output = save_registration_access_token_file(
                email="New.User@icloud.com",
                access_token="access-token-value",
                output_dir=directory,
            )

            output_path = Path(output)
            self.assertEqual(
                output_path,
                Path(directory) / "new.user@icloud.com.txt",
            )
            self.assertEqual(output_path.read_text(encoding="utf-8"), "access-token-value")

    def test_save_account_data_exports_token_when_output_directory_is_configured(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"REGISTRATION_TOKEN_OUTPUT_DIR": directory}, clear=False), \
                    patch("core.db.insert_account", return_value=7), \
                    patch("core.account_export._append_batch_archive", return_value=Path(directory)):
                save_account_data(
                    email="configured.user@icloud.com",
                    access_token="configured-access-token",
                    email_source="replacement",
                )

            output_path = Path(directory) / "configured.user@icloud.com.txt"
            self.assertTrue(output_path.is_file())
            self.assertEqual(output_path.read_text(encoding="utf-8"), "configured-access-token")


if __name__ == "__main__":
    unittest.main()
