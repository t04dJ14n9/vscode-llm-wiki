import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path, PurePosixPath


TOOLS = Path(__file__).resolve().parents[1]
REPOSITORY = Path(__file__).resolve().parents[3]
SOURCE = REPOSITORY / "starter-vault"
BUNDLE = REPOSITORY / "packages/vscode-extension/resources/llm-wiki-empty-vault.zip"
BUILDER = TOOLS / "build_starter_bundle.py"
sys.path.insert(0, str(TOOLS))

from vault_checks import validate_vault


class StarterBundleTests(unittest.TestCase):
    def test_canonical_source_is_an_empty_valid_vault(self) -> None:
        errors = tuple(
            issue for issue in validate_vault(SOURCE) if issue.severity == "error"
        )
        self.assertEqual(errors, ())
        collections = (
            "summaries", "concepts", "comparisons", "entities", "queries", "daily"
        )
        self.assertFalse(
            any(
                path.name != "_index.md"
                for name in collections
                for path in (SOURCE / "wiki" / name).glob("*.md")
            )
        )
        self.assertFalse(
            any(path.name != "_index.md" for path in (SOURCE / "projects").glob("*.md"))
        )
        self.assertFalse(
            any(path.name != "_index.md" for path in (SOURCE / "raw").glob("*.md"))
        )

    def test_distributed_zip_unpacks_directly_to_a_valid_vault(self) -> None:
        self.assertTrue(BUNDLE.is_file())
        with zipfile.ZipFile(BUNDLE) as archive:
            names = archive.namelist()
            required = {
                "_index.md",
                "_log.md",
                "AGENTS.md",
                "SCHEMA.md",
                "TAGS.md",
                "playbooks/bulk-corpus-ingestion.md",
                "templates/bulk-ingestion-manifest.json.tmpl",
                "templates/query.md.tmpl",
                "wiki/queries/_index.md",
                "projects/code/",
                "assets/",
            }
            self.assertTrue(required.issubset(names))
            for name in names:
                path = PurePosixPath(name)
                self.assertFalse(path.is_absolute())
                self.assertNotIn("..", path.parts)

            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory) / "vault"
                root.mkdir()
                archive.extractall(root)
                errors = tuple(
                    issue
                    for issue in validate_vault(root)
                    if issue.severity == "error"
                )
                self.assertEqual(errors, ())

    def test_checked_in_bundle_is_deterministic_and_current(self) -> None:
        result = subprocess.run(
            [sys.executable, BUILDER, "--check"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("starter bundle is up to date", result.stdout)


if __name__ == "__main__":
    unittest.main()
