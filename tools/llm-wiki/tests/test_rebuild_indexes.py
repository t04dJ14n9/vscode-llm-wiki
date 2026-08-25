import tempfile
import unittest
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))

from rebuild_indexes import IndexBuildError, OUTLINE_SPLIT_FACTOR, build_indexes, update_indexes
from vaultlib import parse_frontmatter, render_frontmatter


def write_page(path: Path, page_type: str, title: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_frontmatter({
        "type": page_type,
        "title": title,
        "description": f"Fixture {title}.",
        "status": "draft",
        "scope": "vault",
        "generated": {"by": "process:test", "at": "2026-08-24T00:00:00Z"},
        "relations": [],
    }, f"# {title}\n"), encoding="utf-8")


class RebuildIndexesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        for relative in (
            "assets", "raw", "inbox", "output", "playbooks",
            "projects/code/demo", "scratch", "tasks", "templates",
            "wiki/summaries", "wiki/concepts", "wiki/comparisons", "wiki/entities", "wiki/queries", "wiki/daily",
        ):
            (self.root / relative).mkdir(parents=True)
        (self.root / "templates/concept.md.tmpl").write_text("{{title}}\n", encoding="utf-8")
        (self.root / "projects/code/demo/README.md").write_text("# ignored\n", encoding="utf-8")
        write_page(self.root / "projects/demo.md", "Software Project", "Demo")
        write_page(self.root / "wiki/concepts/zeta.md", "Concept", "Zeta")
        write_page(self.root / "wiki/concepts/alpha.md", "Concept", "Alpha")

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_builds_indexes_for_owned_directories_only(self) -> None:
        outputs = build_indexes(self.root)
        self.assertIn(self.root / "_index.md", outputs)
        self.assertIn(self.root / "wiki/_index.md", outputs)
        self.assertIn(self.root / "wiki/concepts/_index.md", outputs)
        self.assertIn(self.root / "projects/_index.md", outputs)
        self.assertNotIn(self.root / "assets/_index.md", outputs)
        self.assertNotIn(self.root / "templates/_index.md", outputs)
        self.assertNotIn(self.root / "projects/code/_index.md", outputs)

    def test_indexes_are_immediate_deterministic_and_sorted(self) -> None:
        outputs = build_indexes(self.root)
        root_index = outputs[self.root / "_index.md"]
        self.assertIn("- [wiki](wiki/) - Durable graph-ready knowledge", root_index)
        self.assertNotIn("alpha.md", root_index)
        concepts = outputs[self.root / "wiki/concepts/_index.md"]
        self.assertEqual(sum(line.startswith("# ") for line in concepts.splitlines()), 1)
        self.assertIn("# Concepts Index", concepts)
        self.assertLess(concepts.index("[Alpha](alpha.md)"), concepts.index("[Zeta](zeta.md)"))
        self.assertEqual(outputs, build_indexes(self.root))

    def test_large_topics_remain_compact_list_leaves(self) -> None:
        for number in range(OUTLINE_SPLIT_FACTOR + 1):
            write_page(self.root / f"wiki/entities/item-{number:02d}.md", "Entity", f"Item {number:02d}")
        index = build_indexes(self.root)[self.root / "wiki/entities/_index.md"]
        self.assertNotIn("Entries 001-020", index)
        self.assertEqual(index.count("- [Item"), OUTLINE_SPLIT_FACTOR + 1)
        self.assertNotIn("## [Item", index)

    def test_five_level_semantic_path_uses_h6_then_list_leaf(self) -> None:
        path = self.root / "wiki/concepts/alpha.md"
        document = parse_frontmatter(path.read_text(encoding="utf-8"))
        metadata = dict(document.metadata)
        metadata["index_topics"] = ["Systems", "Runtime", "Cluster", "Control", "Scheduling"]
        path.write_text(render_frontmatter(metadata, document.body), encoding="utf-8")

        index = build_indexes(self.root)[self.root / "wiki/concepts/_index.md"]

        self.assertIn("###### Scheduling", index)
        self.assertIn("- [Alpha](alpha.md) - Fixture Alpha.", index)

    def test_only_root_index_has_okf_frontmatter(self) -> None:
        outputs = build_indexes(self.root)
        self.assertEqual(parse_frontmatter(outputs[self.root / "_index.md"]).metadata, {"okf_version": "0.2"})
        self.assertFalse(outputs[self.root / "wiki/_index.md"].startswith("---\n"))

    def test_write_then_check_is_clean_and_check_does_not_write(self) -> None:
        update_indexes(self.root, check=False)
        index = self.root / "wiki/concepts/_index.md"
        index.write_text("stale\n", encoding="utf-8")
        self.assertIn(index, update_indexes(self.root, check=True))
        self.assertEqual(index.read_text(encoding="utf-8"), "stale\n")
        update_indexes(self.root, check=False)
        self.assertEqual(update_indexes(self.root, check=True), ())

    def test_missing_page_metadata_fails(self) -> None:
        path = self.root / "wiki/entities/bad.md"
        path.write_text(render_frontmatter({"type": "Entity", "description": "Missing title."}, "# Bad\n"), encoding="utf-8")
        with self.assertRaisesRegex(IndexBuildError, "title"):
            build_indexes(self.root)


if __name__ == "__main__":
    unittest.main()
