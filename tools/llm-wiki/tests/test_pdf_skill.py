import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[3]
VAULT = REPOSITORY / "demo-vault"
SKILL = REPOSITORY / ".agents/skills/pdf"
HELPER = SKILL / "scripts/extract_selection.py"
INSTALLER = REPOSITORY / "tools/llm-wiki/install_agent_skills.py"
PDF_NAME = "direct-preference-optimization-your-language-model-is-secretly-a-reward-model.pdf"
PDF_RELATIVE = f"assets/{PDF_NAME}"
PDF_PATH = VAULT / PDF_RELATIVE


def load_helper():
    if not HELPER.is_file():
        raise AssertionError(f"missing PDF skill helper: {HELPER}")
    spec = importlib.util.spec_from_file_location("pdf_extract_selection", HELPER)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load PDF skill helper")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class PdfSkillTests(unittest.TestCase):
    def test_parse_portable_viewrect_link(self) -> None:
        helper = load_helper()
        target = helper.parse_pdf_link(
            "assets/paper.pdf#page=2&viewrect=90%2C45%2C432%2C140"
        )
        self.assertEqual(target.source, "assets/paper.pdf")
        self.assertEqual(target.page, 2)
        self.assertEqual(target.view_rect, (90.0, 45.0, 432.0, 140.0))

    def test_rejects_unsafe_or_ambiguous_links(self) -> None:
        helper = load_helper()
        invalid = (
            "/tmp/paper.pdf#page=1&viewrect=1,2,3,4",
            "../paper.pdf#page=1&viewrect=1,2,3,4",
            "%2e%2e/paper.pdf#page=1&viewrect=1,2,3,4",
            "file:///tmp/paper.pdf#page=1&viewrect=1,2,3,4",
            "https://example.com/paper.pdf#page=1&viewrect=1,2,3,4",
            "paper.pdf#page=0&viewrect=1,2,3,4",
            "paper.pdf#page=1&page=2&viewrect=1,2,3,4",
            "paper.pdf#page=1&viewrect=1,2,0,4",
            "paper.pdf#page=1&viewrect=1,2,3,-4",
            "paper.pdf#page=1",
            "paper.pdf#viewrect=1,2,3,4",
            "paper.txt#page=1&viewrect=1,2,3,4",
        )
        for link in invalid:
            with self.subTest(link=link), self.assertRaises(ValueError):
                helper.parse_pdf_link(link)

    def test_resolve_source_rejects_symlink_components_and_mixed_sources(self) -> None:
        helper = load_helper()
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory)
            (vault / "raw").mkdir()
            (vault / "outside.pdf").write_bytes(b"%PDF-test")
            (vault / "raw/link").symlink_to(vault)
            target = helper.PdfTarget("raw/link/outside.pdf", 1, (1, 2, 3, 4))
            with self.assertRaises(ValueError):
                helper.resolve_pdf_source(vault, (target,))

            other = helper.PdfTarget("other.pdf", 1, (1, 2, 3, 4))
            with self.assertRaises(ValueError):
                helper.resolve_pdf_source(vault, (target, other))

    def test_extracts_and_renders_complete_dpo_region(self) -> None:
        if not PDF_PATH.is_file():
            self.skipTest("DPO Git LFS object is unavailable")
        sha256 = hashlib.sha256(PDF_PATH.read_bytes()).hexdigest()
        link = f"{PDF_RELATIVE}#page=2&viewrect=90%2C45%2C432%2C140"
        result = subprocess.run(
            [
                sys.executable,
                HELPER,
                "extract",
                "--vault",
                VAULT,
                "--link",
                link,
                "--sha256",
                sha256,
                "--quote",
                "Figure 1: DPO optimizes",
                "--render",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["extracted_text"].startswith("Figure 1: DPO optimizes"))
        self.assertEqual(payload["quote_status"], "match")
        self.assertEqual(len(payload["images"]), 1)
        image = Path(payload["images"][0])
        self.assertEqual(image.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")
        self.assertGreater(image.stat().st_size, 1000)
        cleanup = subprocess.run(
            [sys.executable, HELPER, "cleanup", "--path", payload["cleanup_path"]],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(cleanup.returncode, 0, cleanup.stderr)
        self.assertFalse(Path(payload["cleanup_path"]).exists())

    def test_cross_page_targets_preserve_link_order(self) -> None:
        if not PDF_PATH.is_file():
            self.skipTest("DPO Git LFS object is unavailable")
        helper = load_helper()
        sha256 = hashlib.sha256(PDF_PATH.read_bytes()).hexdigest()
        result = helper.extract_selection(
            VAULT,
            (
                helper.parse_pdf_link(
                    f"{PDF_RELATIVE}#page=1&viewrect=90%2C720%2C432%2C35"
                ),
                helper.parse_pdf_link(
                    f"{PDF_RELATIVE}#page=2&viewrect=90%2C150%2C432%2C100"
                ),
            ),
            sha256,
            quote=None,
            render=False,
        )
        self.assertEqual([target.page for target in result.targets], [1, 2])
        self.assertIn("37th Conference", result.extracted_text)
        self.assertIn("Figure 1", result.extracted_text)

    def test_cleanup_rejects_unowned_paths(self) -> None:
        helper = load_helper()
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                helper.cleanup_render_directory(Path(directory))

    def test_installer_preserves_custom_skills_unless_forced(self) -> None:
        self.assertTrue(INSTALLER.is_file(), f"missing installer: {INSTALLER}")
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory)
            first = subprocess.run(
                [sys.executable, INSTALLER, "--vault", vault],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(first.returncode, 0, first.stderr)
            installed = vault / ".agents/skills/pdf"
            self.assertEqual(
                (installed / "SKILL.md").read_bytes(),
                (SKILL / "SKILL.md").read_bytes(),
            )
            (installed / "SKILL.md").write_text("custom\n", encoding="utf-8")
            refused = subprocess.run(
                [sys.executable, INSTALLER, "--vault", vault],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(refused.returncode, 0)
            self.assertEqual((installed / "SKILL.md").read_text(), "custom\n")
            forced = subprocess.run(
                [sys.executable, INSTALLER, "--vault", vault, "--force"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(forced.returncode, 0, forced.stderr)
            self.assertEqual(
                (installed / "SKILL.md").read_bytes(),
                (SKILL / "SKILL.md").read_bytes(),
            )


if __name__ == "__main__":
    unittest.main()
