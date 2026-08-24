import json
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))

from import_deepwiki import (
    DeepWikiImportError,
    extract_snapshot,
    import_snapshot,
    page_filename,
    rewrite_links,
)
from vaultlib import parse_frontmatter, render_frontmatter


REVISION = "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"


def push(payload: str) -> str:
    return f"<script>self.__next_f.push({json.dumps([1, payload])})</script>"


def fixture_html() -> str:
    overview = (
        "# Overview\n\n"
        "Read [Getting Started]() and [README.md:1-2]().\n"
        "Repair `scripts/chat_sft.py:10-12]().\n"
        "Use `[[tool.uv.index]]` literally.\n"
    )
    getting_started = "# Getting Started\n\nRun [runs/runcpu.sh](runs/runcpu.sh).\n"
    wiki = (
        '5:{"wiki":{"metadata":{"repo_name":"karpathy/nanochat",'
        '"commit_hash":"92d63d4e","generated_at":"2026-08-07T09:40:41"},'
        '"pages":[{"page_plan":{"id":"1","title":"Overview"},"content":"$17"},'
        '{"page_plan":{"id":"2","title":"Getting Started"},"content":"$18"}]}}'
    )
    return "".join(
        (
            '<a href="/karpathy/nanochat/1-overview">Overview</a>',
            '<a href="/karpathy/nanochat/2-getting-started">Getting Started</a>',
            push(f"17:T{len(overview.encode()):x},"),
            push(overview),
            push(f"18:T{len(getting_started.encode()):x},"),
            push(getting_started),
            push(wiki),
        )
    )


class ImportDeepWikiTests(unittest.TestCase):
    def test_extracts_every_page_and_canonical_route(self) -> None:
        snapshot = extract_snapshot(fixture_html())
        self.assertEqual(snapshot.repository, "karpathy/nanochat")
        self.assertEqual(snapshot.commit, "92d63d4e")
        self.assertEqual(len(snapshot.pages), 2)
        self.assertEqual(snapshot.pages[0].source_url, "https://deepwiki.com/karpathy/nanochat/1-overview")
        self.assertEqual(page_filename(snapshot.pages[1]), "deepwiki-02-getting-started.md")

    def test_rewrites_page_and_revision_links_but_preserves_inline_code(self) -> None:
        snapshot = extract_snapshot(fixture_html())
        rewritten = rewrite_links(snapshot.pages[0].content, snapshot.pages, REVISION)
        self.assertIn("[Getting Started](deepwiki-02-getting-started.md)", rewritten)
        self.assertIn(f"README.md#L1-L2", rewritten)
        self.assertIn("scripts/chat_sft.py#L10-L12", rewritten)
        self.assertNotIn("]()", rewritten)
        self.assertIn("`[[tool.uv.index]]`", rewritten)

    def test_imports_draft_code_scoped_summaries(self) -> None:
        snapshot = extract_snapshot(fixture_html())
        with tempfile.TemporaryDirectory() as temporary_directory:
            vault = Path(temporary_directory)
            (vault / "projects/nanochat/summaries").mkdir(parents=True)
            card = {
                "type": "Software Project",
                "title": "Nanochat",
                "description": "Fixture.",
                "repository": "nanochat",
                "studied_revision": REVISION,
            }
            (vault / "projects/nanochat.md").write_text(
                render_frontmatter(card, "# Nanochat\n"), encoding="utf-8"
            )
            outputs = import_snapshot(vault, "nanochat", snapshot, "2026-08-24")
            self.assertEqual(len(outputs), 2)
            document = parse_frontmatter(outputs[0].read_text(encoding="utf-8"))
            self.assertEqual(document.metadata["type"], "Summary")
            self.assertEqual(document.metadata["status"], "draft")
            self.assertTrue(document.metadata["code_scope"])
            self.assertEqual(document.metadata["revision"], REVISION)
            self.assertEqual(document.metadata["deepwiki"]["page_id"], "1")

    def test_rejects_revision_mismatch(self) -> None:
        snapshot = extract_snapshot(fixture_html())
        with tempfile.TemporaryDirectory() as temporary_directory:
            vault = Path(temporary_directory)
            (vault / "projects/nanochat/summaries").mkdir(parents=True)
            card = {
                "type": "Software Project",
                "title": "Nanochat",
                "description": "Fixture.",
                "repository": "nanochat",
                "studied_revision": "0" * 40,
            }
            (vault / "projects/nanochat.md").write_text(
                render_frontmatter(card, "# Nanochat\n"), encoding="utf-8"
            )
            with self.assertRaisesRegex(DeepWikiImportError, "does not match"):
                import_snapshot(vault, "nanochat", snapshot, "2026-08-24")


if __name__ == "__main__":
    unittest.main()
