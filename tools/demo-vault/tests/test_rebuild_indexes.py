import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from rebuild_indexes import (
    IndexBuildError,
    build_indexes,
    update_indexes,
)
from vaultlib import (
    TAG_REGISTRY,
    markdown_targets,
    parse_frontmatter,
    render_frontmatter,
)


def write_page(
    path: Path, *, title: str, page_type: str, description: str
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        render_frontmatter(
            {
                "title": title,
                "type": page_type,
                "description": description,
                "tags": ["pretraining"],
                "sources": [
                    {
                        "id": "fixture",
                        "resource": "../../raw/fixture.md",
                        "title": "Fixture",
                    }
                ],
                "status": "stable",
                "generated": {"by": "test"},
            },
            f"# {title}\n",
        ),
        encoding="utf-8",
    )


class RebuildIndexesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        (self.root / "projects").mkdir()
        for directory in (
            "summaries",
            "entities",
            "concepts",
            "comparisons",
            "queries",
        ):
            (self.root / "wiki" / directory).mkdir(parents=True)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_build_indexes_is_sorted_and_never_creates_raw_index(self) -> None:
        write_page(
            self.root / "wiki/concepts/zeta.md",
            title="Zeta",
            page_type="concept",
            description="Later alphabetically.",
        )
        write_page(
            self.root / "wiki/concepts/alpha.md",
            title="Alpha",
            page_type="concept",
            description="Earlier alphabetically.",
        )

        outputs = build_indexes(self.root)

        concepts = outputs[self.root / "wiki/concepts/index.md"]
        self.assertLess(
            concepts.index("[Alpha](alpha.md)"),
            concepts.index("[Zeta](zeta.md)"),
        )
        self.assertNotIn(self.root / "raw/index.md", outputs)
        self.assertEqual(outputs, build_indexes(self.root))

    def test_bundle_index_declares_okf_and_exact_tag_registry(self) -> None:
        bundle = parse_frontmatter(
            build_indexes(self.root)[self.root / "wiki/index.md"]
        )

        self.assertEqual(bundle.metadata["okf_version"], "0.2")
        self.assertEqual(bundle.metadata["tag_registry"], list(TAG_REGISTRY))

    def test_root_index_links_only_to_reader_entry_points(self) -> None:
        root_index = build_indexes(self.root)[self.root / "index.md"]

        self.assertEqual(
            [target.target for target in markdown_targets(root_index)],
            [
                "README.md",
                "wiki/index.md",
                "projects/index.md",
                "log.md",
            ],
        )

    def test_project_index_lists_project_cards(self) -> None:
        (self.root / "projects/nanochat.md").write_text(
            render_frontmatter(
                {
                    "title": "Nanochat",
                    "type": "project",
                    "description": "Pinned end-to-end LLM training project.",
                },
                "# Nanochat\n",
            ),
            encoding="utf-8",
        )

        projects = build_indexes(self.root)[self.root / "projects/index.md"]

        self.assertIn(
            "[Nanochat](nanochat.md) — Pinned end-to-end LLM training project.",
            projects,
        )

    def test_check_reports_stale_indexes_without_writing(self) -> None:
        index = self.root / "index.md"
        index.write_text("stale\n", encoding="utf-8")

        stale = update_indexes(self.root, check=True)

        self.assertIn(index, stale)
        self.assertEqual(index.read_text(encoding="utf-8"), "stale\n")

    def test_write_mode_then_check_is_clean(self) -> None:
        changed = update_indexes(self.root, check=False)

        self.assertIn(self.root / "wiki/index.md", changed)
        self.assertEqual(update_indexes(self.root, check=True), ())

    def test_generator_refuses_to_guess_required_page_metadata(self) -> None:
        path = self.root / "wiki/concepts/missing-title.md"
        path.write_text(
            render_frontmatter(
                {
                    "type": "concept",
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
