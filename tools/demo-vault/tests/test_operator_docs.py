import subprocess
import sys
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
REPOSITORY = Path(__file__).resolve().parents[3]
VAULT = REPOSITORY / "demo-vault"
SKILL = REPOSITORY / ".agents/skills/llm-wiki"
SKILL_VALIDATOR = (
    Path.home()
    / ".codex/skills/.system/skill-creator/scripts/quick_validate.py"
)
sys.path.insert(0, str(TOOLS))

from vaultlib import markdown_targets, parse_frontmatter


class OperatorDocumentationTests(unittest.TestCase):
    def test_operator_documents_are_okf_concepts(self) -> None:
        expected_types = {
            "README.md": "Reference",
            "SCHEMA.md": "Reference",
            "AGENTS.md": "Playbook",
        }

        for relative, expected_type in expected_types.items():
            path = VAULT / relative
            document = parse_frontmatter(
                path.read_text(encoding="utf-8"),
                source=path,
            )
            self.assertEqual(document.metadata["type"], expected_type)
            self.assertTrue(document.metadata["title"])
            self.assertTrue(document.metadata["description"])
            self.assertIn(
                f"# {document.metadata['title']}",
                document.body,
            )

    def test_skill_passes_official_structural_validation(self) -> None:
        if not SKILL_VALIDATOR.is_file():
            self.skipTest("official Codex skill validator is not installed")

        result = subprocess.run(
            [
                "uv",
                "run",
                "--with",
                "pyyaml",
                "python",
                SKILL_VALIDATOR,
                SKILL,
            ],
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_skill_routes_to_each_direct_reference(self) -> None:
        path = SKILL / "SKILL.md"
        document = parse_frontmatter(
            path.read_text(encoding="utf-8"),
            source=path,
        )
        self.assertEqual(document.metadata["name"], "llm-wiki")
        self.assertTrue(
            document.metadata["description"].startswith("Use when")
        )
        targets = markdown_targets(document.body)
        reference_targets = {
            target.target
            for target in targets
            if target.target.startswith("references/")
        }
        self.assertEqual(
            reference_targets,
            {
                "references/arxiv-ingestion.md",
                "references/authoring-workflow.md",
                "references/okf-profile.md",
            },
        )
        for target in reference_targets:
            self.assertTrue((SKILL / target).is_file())

    def test_documented_producer_clis_are_runnable(self) -> None:
        for script in (
            "ingest_arxiv.py",
            "rebuild_indexes.py",
            "validate_vault.py",
        ):
            result = subprocess.run(
                [sys.executable, TOOLS / script, "--help"],
                cwd=VAULT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("usage:", result.stdout)


if __name__ == "__main__":
    unittest.main()
