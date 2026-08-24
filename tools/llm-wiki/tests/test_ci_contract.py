import unittest
from pathlib import Path


REPOSITORY = Path(__file__).resolve().parents[3]
WORKFLOW = REPOSITORY / ".github/workflows/quality.yml"


class DemoVaultCiContractTests(unittest.TestCase):
    def test_central_code_tree_is_ignored_without_submodule_metadata(self) -> None:
        self.assertIn(
            "/demo-vault/projects/code/",
            (REPOSITORY / ".gitignore").read_text(encoding="utf-8"),
        )
        self.assertIn(
            "projects/code/",
            (REPOSITORY / "demo-vault/.gitignore").read_text(encoding="utf-8"),
        )
        self.assertFalse((REPOSITORY / ".gitmodules").exists())

    def test_quality_workflow_validates_the_distributable_demo_vault(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")

        for required_command in (
            "lfs: true",
            "python3 -m pip install 'pdfplumber>=0.11,<0.12'",
            "python3 -m unittest discover -s tools/llm-wiki/tests -v",
            "python3 tools/llm-wiki/rebuild_indexes.py --vault demo-vault --check",
            "python3 tools/llm-wiki/validate_vault.py --vault demo-vault",
        ):
            with self.subTest(required_command=required_command):
                self.assertIn(required_command, workflow)
        self.assertNotIn("submodules:", workflow)
        self.assertNotIn("git submodule", workflow)
        self.assertNotIn("tools/demo-vault", workflow)


if __name__ == "__main__":
    unittest.main()
