import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))

from rebuild_indexes import IndexBuildError, build_indexes, update_indexes
from vaultlib import parse_frontmatter, render_frontmatter


def write_concept(
    path: Path,
    *,
    title: str,
    concept_type: str,
    description: str,
    extra: dict[str, object] | None = None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    metadata: dict[str, object] = {
        "type": concept_type,
        "title": title,
        "description": description,
    }
    metadata.update(extra or {})
    path.write_text(
        render_frontmatter(metadata, f"# {title}\n"),
        encoding="utf-8",
    )


class RebuildIndexesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        for relative in (
            "raw/assets",
            "projects/code/nanochat",
            "summaries",
            "entities",
            "concepts",
            "comparisons",
            "queries",
        ):
            (self.root / relative).mkdir(parents=True)

        write_concept(
            self.root / "raw/fixture-paper.md",
            title="Fixture Paper",
            concept_type="Paper",
            description="A local immutable paper snapshot.",
            extra={
                "attachment": {
                    "resource": "assets/fixture-paper.pdf",
                    "media_type": "application/pdf",
                }
            },
        )
        (self.root / "raw/assets/fixture-paper.pdf").write_bytes(
            b"%PDF-1.7\nfixture\n"
        )
        write_concept(
            self.root / "projects/nanochat.md",
            title="Nanochat",
            concept_type="Software Project",
            description="Pinned end-to-end LLM training project.",
            extra={
                "source_path": "code/nanochat",
                "pinned_commit": (
                    "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"
                ),
            },
        )
        (self.root / "projects/code/nanochat/README.md").write_text(
            "# Upstream Nanochat\n",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_builds_index_for_every_owned_directory_but_not_submodule(
        self,
    ) -> None:
        outputs = build_indexes(self.root)

        expected = {
            self.root / "index.md",
            self.root / "raw/index.md",
            self.root / "raw/assets/index.md",
            self.root / "projects/index.md",
            self.root / "projects/code/index.md",
            self.root / "summaries/index.md",
            self.root / "entities/index.md",
            self.root / "concepts/index.md",
            self.root / "comparisons/index.md",
            self.root / "queries/index.md",
        }
        self.assertEqual(set(outputs), expected)
        self.assertNotIn(
            self.root / "projects/code/nanochat/index.md",
            outputs,
        )

    def test_indexes_form_an_immediate_child_hierarchy(self) -> None:
        outputs = build_indexes(self.root)

        root_index = outputs[self.root / "index.md"]
        self.assertIn(
            "[raw](raw/) - Immutable source evidence and local assets.",
            root_index,
        )
        self.assertNotIn("fixture-paper.md", root_index)

        raw_index = outputs[self.root / "raw/index.md"]
        self.assertIn(
            "[Fixture Paper](fixture-paper.md) - "
            "A local immutable paper snapshot.",
            raw_index,
        )
        self.assertIn(
            "[assets](assets/) - Archived PDFs and source media.",
            raw_index,
        )

        assets_index = outputs[self.root / "raw/assets/index.md"]
        self.assertIn(
            "[Fixture Paper — PDF](fixture-paper.pdf) - "
            "Archived PDF for Fixture Paper.",
            assets_index,
        )

    def test_code_index_describes_project_gitlink_without_descending(
        self,
    ) -> None:
        code_index = build_indexes(self.root)[
            self.root / "projects/code/index.md"
        ]

        self.assertIn("# Code Resources", code_index)
        self.assertIn(
            "[Nanochat source](nanochat/README.md) - "
            "Pinned Nanochat source at 92d63d4e8bb4.",
            code_index,
        )

    def test_root_index_declares_only_okf_version_frontmatter(self) -> None:
        root_index = parse_frontmatter(
            build_indexes(self.root)[self.root / "index.md"]
        )

        self.assertEqual(root_index.metadata, {"okf_version": "0.2"})
        self.assertIn("# Subdirectories", root_index.body)

    def test_concepts_are_grouped_by_exact_type_and_sorted_by_title(
        self,
    ) -> None:
        write_concept(
            self.root / "concepts/zeta.md",
            title="Zeta",
            concept_type="Concept",
            description="Later alphabetically.",
        )
        write_concept(
            self.root / "concepts/alpha.md",
            title="Alpha",
            concept_type="Concept",
            description="Earlier alphabetically.",
        )

        index = build_indexes(self.root)[self.root / "concepts/index.md"]

        self.assertIn("# Concept", index)
        self.assertLess(
            index.index("[Alpha](alpha.md)"),
            index.index("[Zeta](zeta.md)"),
        )

    def test_empty_owned_directory_still_has_progressive_disclosure(
        self,
    ) -> None:
        queries = build_indexes(self.root)[self.root / "queries/index.md"]

        self.assertIn("# Contents", queries)
        self.assertIn("* No entries yet.", queries)

    def test_generation_is_byte_for_byte_deterministic(self) -> None:
        self.assertEqual(build_indexes(self.root), build_indexes(self.root))

    def test_check_reports_stale_indexes_without_writing(self) -> None:
        update_indexes(self.root, check=False)
        index = self.root / "raw/index.md"
        index.write_text("stale\n", encoding="utf-8")

        stale = update_indexes(self.root, check=True)

        self.assertIn(index, stale)
        self.assertEqual(index.read_text(encoding="utf-8"), "stale\n")

    def test_write_mode_then_check_is_clean(self) -> None:
        changed = update_indexes(self.root, check=False)

        self.assertIn(self.root / "raw/assets/index.md", changed)
        self.assertEqual(update_indexes(self.root, check=True), ())

    def test_generator_refuses_to_guess_concept_metadata(self) -> None:
        path = self.root / "concepts/missing-title.md"
        path.write_text(
            render_frontmatter(
                {
                    "type": "Concept",
                    "description": "This page has no title.",
                },
                "# Missing title\n",
            ),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(IndexBuildError, "title"):
            build_indexes(self.root)


if __name__ == "__main__":
    unittest.main()
