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
            "assets",
            "raw",
            "examples",
            "projects/nanochat/assets",
            "projects/code/nanochat",
            "projects/nanochat/inbox",
            "projects/nanochat/raw",
            "projects/nanochat/tasks",
            "projects/nanochat/scratch",
            "projects/nanochat/summaries",
            "projects/nanochat/concepts",
            "projects/nanochat/entities",
            "projects/nanochat/playbooks",
            "projects/nanochat/comparisons",
            "projects/nanochat/queries",
            "projects/nanochat/output",
            "projects/nanochat/examples",
            "summaries",
            "entities",
            "concepts",
            "comparisons",
            "queries",
        ):
            (self.root / relative).mkdir(parents=True)

        write_concept(
            self.root / "projects/nanochat/raw/fixture-paper.md",
            title="Fixture Paper",
            concept_type="Paper",
            description="A local immutable paper snapshot.",
            extra={
                "attachment": {
                    "resource": "../assets/fixture-paper.pdf",
                    "media_type": "application/pdf",
                }
            },
        )
        (self.root / "projects/nanochat/assets/fixture-paper.pdf").write_bytes(
            b"%PDF-1.7\nfixture\n"
        )
        write_concept(
            self.root / "projects/nanochat.md",
            title="Nanochat",
            concept_type="Software Project",
            description="Pinned end-to-end LLM training project.",
            extra={
                "repository": "nanochat",
                "code_path": "code/nanochat",
                "studied_revision": (
                    "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"
                ),
            },
        )
        (self.root / "projects/code/nanochat/README.md").write_text(
            "# Upstream Nanochat\n",
            encoding="utf-8",
        )
        (self.root / "projects/repositories.yaml").write_text(
            """version: 1
repositories:
  nanochat:
    vcs: git
    url: https://github.com/karpathy/nanochat.git
    default_ref: master
    card: projects/nanochat.md
    vault: projects/nanochat
    code: projects/code/nanochat
    workspace: in-place
    update_strategy: review
    lfs: auto
""",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_builds_index_for_every_owned_directory_but_not_opaque_roots(
        self,
    ) -> None:
        outputs = build_indexes(self.root)

        expected = {
            self.root / "_index.md",
            self.root / "examples/_index.md",
            self.root / "raw/_index.md",
            self.root / "projects/_index.md",
            self.root / "projects/nanochat/_index.md",
            self.root / "projects/nanochat/inbox/_index.md",
            self.root / "projects/nanochat/raw/_index.md",
            self.root / "projects/nanochat/tasks/_index.md",
            self.root / "projects/nanochat/scratch/_index.md",
            self.root / "projects/nanochat/summaries/_index.md",
            self.root / "projects/nanochat/concepts/_index.md",
            self.root / "projects/nanochat/entities/_index.md",
            self.root / "projects/nanochat/playbooks/_index.md",
            self.root / "projects/nanochat/comparisons/_index.md",
            self.root / "projects/nanochat/queries/_index.md",
            self.root / "projects/nanochat/output/_index.md",
            self.root / "projects/nanochat/examples/_index.md",
            self.root / "summaries/_index.md",
            self.root / "entities/_index.md",
            self.root / "concepts/_index.md",
            self.root / "comparisons/_index.md",
            self.root / "queries/_index.md",
        }
        self.assertEqual(set(outputs), expected)
        self.assertNotIn(self.root / "projects/nanochat/assets/_index.md", outputs)
        self.assertNotIn(self.root / "projects/code/nanochat/_index.md", outputs)

    def test_indexes_form_an_immediate_child_hierarchy(self) -> None:
        outputs = build_indexes(self.root)

        root_index = outputs[self.root / "_index.md"]
        self.assertIn(
            "[projects](projects/) - Repository cards paired with self-contained code vaults.",
            root_index,
        )
        self.assertNotIn("fixture-paper.md", root_index)

        raw_index = outputs[self.root / "projects/nanochat/raw/_index.md"]
        self.assertIn(
            "[Fixture Paper](fixture-paper.md) - "
            "A local immutable paper snapshot.",
            raw_index,
        )
        projects_index = outputs[self.root / "projects/_index.md"]
        self.assertIn("[Nanochat](nanochat.md)", projects_index)
        self.assertIn("[nanochat](nanochat/)", projects_index)
        self.assertIn("[code](code/) - Ignored in-place VCS working copies registered by repository ID.", projects_index)
        project_index = outputs[self.root / "projects/nanochat/_index.md"]
        self.assertIn("[assets](assets/) - Flat binary evidence for this project.", project_index)
        self.assertNotIn("[code](code/)", project_index)
        self.assertEqual(parse_frontmatter(project_index).metadata, {"okf_version": "0.2"})

    def test_root_index_declares_only_okf_version_frontmatter(self) -> None:
        root_index = parse_frontmatter(
            build_indexes(self.root)[self.root / "_index.md"]
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

        index = build_indexes(self.root)[self.root / "concepts/_index.md"]

        self.assertIn("# Concept", index)
        self.assertLess(
            index.index("[Alpha](alpha.md)"),
            index.index("[Zeta](zeta.md)"),
        )

    def test_empty_owned_directory_still_has_progressive_disclosure(
        self,
    ) -> None:
        queries = build_indexes(self.root)[self.root / "queries/_index.md"]

        self.assertIn("# Contents", queries)
        self.assertIn("* No entries yet.", queries)

    def test_generation_is_byte_for_byte_deterministic(self) -> None:
        self.assertEqual(build_indexes(self.root), build_indexes(self.root))

    def test_check_reports_stale_indexes_without_writing(self) -> None:
        update_indexes(self.root, check=False)
        index = self.root / "projects/nanochat/raw/_index.md"
        index.write_text("stale\n", encoding="utf-8")

        stale = update_indexes(self.root, check=True)

        self.assertIn(index, stale)
        self.assertEqual(index.read_text(encoding="utf-8"), "stale\n")

    def test_write_mode_then_check_is_clean(self) -> None:
        changed = update_indexes(self.root, check=False)

        self.assertIn(self.root / "projects/nanochat/raw/_index.md", changed)
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
