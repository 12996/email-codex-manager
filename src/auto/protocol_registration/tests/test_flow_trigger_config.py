import unittest


class FlowTriggerConfigTests(unittest.TestCase):
    def test_missing_flow_configuration_is_a_safe_noop(self):
        from core.flow_trigger import trigger_flow

        result = trigger_flow("placeholder-access-token")

        self.assertEqual(result["status"], "skipped")
        self.assertFalse(result["ok"])


if __name__ == "__main__":
    unittest.main()
