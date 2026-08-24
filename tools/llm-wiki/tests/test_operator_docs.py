import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
REPOSITORY = Path(__file__).resolve().parents[3]
VAULT = REPOSITORY / "demo-vault"
SKILLS_ROOT = REPOSITORY / ".agents/skills"
SKILL_FILES = {
    "pdf": ("SKILL.md", "scripts/extract_selection.py"),
    "humanizer": ("SKILL.md", "LICENSE"),
    "arxiv": ("SKILL.md", "LICENSE"),
    "grounded-citations": ("SKILL.md", "LICENSE"),
    "research-paper-writing": ("SKILL.md", "LICENSE"),
}
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
            "TAGS.md": "Reference",
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
            self.assertNotIn("tags", document.metadata)
            self.assertIn(
                f"# {document.metadata['title']}",
                document.body,
            )

    def test_skill_passes_official_structural_validation(self) -> None:
        if not SKILL_VALIDATOR.is_file():
            self.skipTest("official Codex skill validator is not installed")
        if importlib.util.find_spec("yaml") is None:
            self.skipTest("PyYAML is unavailable for the official skill validator")
        for name in SKILL_FILES:
            skill = SKILLS_ROOT / name
            result = subprocess.run(
                [
                    sys.executable,
                    SKILL_VALIDATOR,
                    skill,
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_default_skills_are_installed_as_hidden_operational_metadata(self) -> None:
        for name, relatives in SKILL_FILES.items():
            canonical = SKILLS_ROOT / name
            installed = VAULT / ".agents/skills" / canonical.name
            self.assertTrue(installed.is_dir())
            self.assertFalse(any(installed.rglob("_index.md")))
            for relative in relatives:
                self.assertEqual(
                    (installed / relative).read_bytes(),
                    (canonical / relative).read_bytes(),
                )

    def test_humanizer_has_no_framework_specific_content(self) -> None:
        humanizer_skill = SKILLS_ROOT / "humanizer"
        text = (humanizer_skill / "SKILL.md").read_text(encoding="utf-8")
        self.assertNotIn("Hermes", text)
        self.assertNotIn("read_file", text)
        self.assertNotIn("write_file", text)
        self.assertIn("tags: [writing, editing, humanize, voice, prose]", text)

    def test_research_skills_are_framework_neutral(self) -> None:
        prohibited = (
            "Hermes Tools",
            "web_extract",
            "cronjob",
            "read_file",
            "write_file",
        )
        expected_tags = {
            "arxiv": "tags: [research, arxiv, papers, academic, provenance]",
            "grounded-citations": (
                "tags: [research, citations, grounding, sources, fact-checking]"
            ),
            "research-paper-writing": (
                "tags: [research, paper-writing, experiments, academic, latex]"
            ),
        }
        for name, tags in expected_tags.items():
            text = (SKILLS_ROOT / name / "SKILL.md").read_text(encoding="utf-8")
            for term in prohibited:
                self.assertNotIn(term, text)
            self.assertIn(tags, text)

    def test_documented_producer_clis_are_runnable(self) -> None:
        for script in (
            "append_log.py",
            "install_agent_skills.py",
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
