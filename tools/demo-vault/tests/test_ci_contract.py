import unittest
from pathlib import Path


REPOSITORY = Path(__file__).resolve().parents[3]
WORKFLOW = REPOSITORY / ".github/workflows/quality.yml"


class DemoVaultCiContractTests(unittest.TestCase):
    def test_quality_workflow_validates_the_distributable_demo_vault(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")

        for required_command in (
            "lfs: true",
            "submodules: recursive",
            "astral-sh/setup-uv@v6",
            "python3 -m unittest discover -s tools/demo-vault/tests -v",
            "python3 tools/demo-vault/rebuild_indexes.py --vault demo-vault --check",
            "python3 tools/demo-vault/validate_vault.py --vault demo-vault",
            "git submodule status -- demo-vault/projects/code/nanochat",
        ):
            with self.subTest(required_command=required_command):
                self.assertIn(required_command, workflow)


if __name__ == "__main__":
    unittest.main()
