import sys
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))

from vaultlib import default_vault_root


class CliPathTests(unittest.TestCase):
    def test_default_vault_is_repository_demo_vault(self) -> None:
        expected = Path(__file__).resolve().parents[3] / "demo-vault"

        self.assertEqual(default_vault_root(), expected)


if __name__ == "__main__":
    unittest.main()
