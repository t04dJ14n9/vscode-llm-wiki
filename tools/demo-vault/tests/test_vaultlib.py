import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from vaultlib import (
    FrontmatterError,
    markdown_targets,
    parse_frontmatter,
    render_frontmatter,
    resolve_local_target,
    sha256_bytes,
    slugify_title,
)


class VaultlibTests(unittest.TestCase):
    def test_slugify_title_matches_canonical_paper_filename(self) -> None:
        title = (
            "SmolLM2: When Smol Goes Big -- Data-Centric Training of a "
            "Small Language Model"
        )
        self.assertEqual(
            slugify_title(title),
            "smollm2-when-smol-goes-big-data-centric-training-of-a-small-language-model",
        )

    def test_slugify_title_removes_combining_marks_and_non_ascii(self) -> None:
        self.assertEqual(slugify_title("Café / 東京: LLMs"), "cafe-llms")

    def test_frontmatter_round_trip_preserves_nested_flow_values(self) -> None:
        metadata = {
            "title": "Byte-Pair Encoding",
            "type": "concept",
            "tags": ["tokenization", "project-nanochat"],
            "sources": [
                {
                    "id": "arxiv-1508.07909v5",
                    "resource": (
                        "../../raw/neural-machine-translation-of-rare-words-"
                        "with-subword-units.md"
                    ),
                    "title": (
                        "Neural Machine Translation of Rare Words with "
                        "Subword Units"
                    ),
                }
            ],
            "generated": {"by": "codex/gpt-5"},
        }
        rendered = render_frontmatter(metadata, "# Byte-Pair Encoding\n")
        parsed = parse_frontmatter(rendered)
        self.assertEqual(parsed.metadata, metadata)
        self.assertEqual(parsed.body, "# Byte-Pair Encoding\n")

    def test_frontmatter_rejects_indented_block_yaml(self) -> None:
        text = "---\ntitle: \"Bad\"\nsources:\n  - id: bad\n---\n\n# Bad\n"
        with self.assertRaisesRegex(FrontmatterError, "JSON flow values"):
            parse_frontmatter(text)

    def test_markdown_targets_find_local_markdown_and_wiki_links(self) -> None:
        body = (
            "[BPE](../concepts/byte-pair-encoding.md) "
            "[web](https://example.com) "
            "[[../entities/fineweb|FineWeb]]"
        )
        self.assertEqual(
            [(item.kind, item.target) for item in markdown_targets(body)],
            [
                ("markdown", "../concepts/byte-pair-encoding.md"),
                ("wiki", "../entities/fineweb"),
            ],
        )

    def test_resolve_local_target_rejects_workspace_escape(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "wiki" / "concepts" / "page.md"
            source.parent.mkdir(parents=True)
            source.write_text("# page\n", encoding="utf-8")
            self.assertIsNone(
                resolve_local_target(source, "../../../outside.md", root)
            )

    def test_resolve_local_target_supports_bundle_relative_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "concepts" / "page.md"
            target = root / "raw" / "paper.md"
            source.parent.mkdir(parents=True)
            target.parent.mkdir(parents=True)
            source.write_text("# page\n", encoding="utf-8")
            target.write_text("# paper\n", encoding="utf-8")

            self.assertEqual(
                resolve_local_target(source, "/raw/paper.md", root),
                target.resolve(),
            )

    def test_sha256_bytes_is_lowercase_hex(self) -> None:
        self.assertEqual(
            sha256_bytes(b"nanochat"),
            "d550c60bac24e06d9ac899d37a97da4bbb26e29a52422a2b7fae89f5d7ef6cc0",
        )


if __name__ == "__main__":
    unittest.main()
