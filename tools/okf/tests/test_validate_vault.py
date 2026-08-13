import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))

from rebuild_indexes import update_indexes
from vault_checks import (
    NANOCHAT_COMMIT,
    NANOCHAT_REPOSITORY,
    SubmoduleState,
    validate_vault,
)
from vaultlib import parse_frontmatter, render_frontmatter, sha256_bytes


REQUIRED_HEADINGS = {
    "Summary": ("Scope", "Pipeline", "Evidence boundary", "Related pages"),
    "Entity": (
        "What it is",
        "Why it matters",
        "Nanochat relevance",
        "Related pages",
    ),
    "Concept": (
        "Definition",
        "Mechanism",
        "Nanochat connection",
        "Related pages",
    ),
    "Comparison": (
        "Decision frame",
        "Comparison",
        "Takeaway",
        "Related pages",
    ),
    "Query": ("Answer", "Evidence trail", "Limits", "Related pages"),
}
PAGE_PATHS = {
    "Summary": "summaries/summary.md",
    "Entity": "entities/entity.md",
    "Concept": "concepts/concept.md",
    "Comparison": "comparisons/comparison.md",
    "Query": "queries/query.md",
}


class FakeGitState:
    def __init__(
        self,
        *,
        submodule: SubmoduleState | None = None,
        binary_lfs: bool = True,
        markdown_lfs: bool = False,
    ) -> None:
        self._submodule = submodule or SubmoduleState(
            configured_path="projects/code/nanochat",
            configured_url=NANOCHAT_REPOSITORY,
            index_mode="160000",
            index_oid=NANOCHAT_COMMIT,
            checkout_oid=NANOCHAT_COMMIT,
        )
        self._binary_lfs = binary_lfs
        self._markdown_lfs = markdown_lfs

    def nanochat_submodule(self) -> SubmoduleState:
        return self._submodule

    def lfs_filter(self, path: Path) -> str | None:
        if path.suffix.lower() == ".md":
            return "lfs" if self._markdown_lfs else None
        return "lfs" if self._binary_lfs else None


def common_metadata(
    concept_type: str,
    title: str,
    description: str,
    *,
    tags: list[str] | None = None,
) -> dict[str, object]:
    return {
        "type": concept_type,
        "title": title,
        "description": description,
        "tags": tags or ["pretraining"],
        "status": "stable",
        "generated": {
            "by": "process:test-fixture",
            "at": "2026-08-13T00:00:00Z",
        },
    }


def page_body(
    page_type: str,
    title: str,
    links: tuple[str, ...],
) -> str:
    lines = [f"# {title}", ""]
    for heading in REQUIRED_HEADINGS[page_type]:
        lines.extend(
            [
                f"## {heading}",
                "",
                f"Evidence for {heading.lower()}.[^fixture-paper]",
                "",
            ]
        )
    lines.extend(
        [
            "Related: "
            + " ".join(
                f"[compiled page {index}]({target})"
                for index, target in enumerate(links, start=1)
            ),
            "",
            "[^fixture-paper]: Fixture Paper",
            "",
        ]
    )
    return "\n".join(lines)


class ValidateVaultTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.valid_git_state = FakeGitState()
        self._create_valid_vault()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def _create_valid_vault(self) -> None:
        for relative in (
            "raw/assets",
            "projects/code/nanochat",
            "summaries",
            "entities",
            "concepts",
            "comparisons",
            "queries",
        ):
            (self.root / relative).mkdir(parents=True, exist_ok=True)

        (self.root / ".gitattributes").write_text(
            "raw/assets/**/*.pdf filter=lfs diff=lfs merge=lfs -text\n",
            encoding="utf-8",
        )
        (self.root / ".gitignore").write_text(
            ".llm_wiki/\n.ingest-*/\n",
            encoding="utf-8",
        )
        self._write_root_concept(
            "README.md",
            "Reference",
            "Nanochat LLM Wiki",
            "Reader orientation for the Nanochat LLM wiki.",
        )
        self._write_root_concept(
            "SCHEMA.md",
            "Reference",
            "Nanochat wiki schema",
            "The strict OKF profile used by this bundle.",
        )
        self._write_root_concept(
            "AGENTS.md",
            "Playbook",
            "Nanochat wiki operator handbook",
            "Operational workflows for maintaining this bundle.",
        )
        (self.root / "log.md").write_text(
            render_frontmatter(
                {"type": "Log", "title": "Bundle history"},
                "# Bundle history\n\n"
                "## 2026-08-13\n\n"
                "* **Initialization**: Created the fixture bundle.\n",
            ),
            encoding="utf-8",
        )

        self._write_raw_snapshot()
        self._write_project_card()
        (self.root / "projects/code/nanochat/README.md").write_text(
            "# Upstream Nanochat\n",
            encoding="utf-8",
        )

        page_items = list(PAGE_PATHS.items())
        for index, (page_type, relative) in enumerate(page_items):
            targets: list[str] = []
            for offset in (1, 2):
                target_type, target_relative = page_items[
                    (index + offset) % len(page_items)
                ]
                del target_type
                targets.append(f"../{target_relative}")
            self._write_page(
                relative,
                page_type,
                links=tuple(targets),
            )

        update_indexes(self.root, check=False)

    def _write_root_concept(
        self,
        relative: str,
        concept_type: str,
        title: str,
        description: str,
    ) -> None:
        metadata = common_metadata(
            concept_type,
            title,
            description,
            tags=["operations"],
        )
        (self.root / relative).write_text(
            render_frontmatter(metadata, f"# {title}\n"),
            encoding="utf-8",
        )

    def _write_raw_snapshot(self) -> None:
        pdf = self.root / "raw/assets/fixture-paper.pdf"
        pdf.write_bytes(b"%PDF-1.7\nfixture\n")
        body = """# Fixture Paper

## Source metadata

- **Authors:** Test Author
- **arXiv:** [1508.07909v5](https://arxiv.org/abs/1508.07909v5)
- **Submitted:** 2015-08-31
- **Revised:** 2016-06-10
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Local attachment:** [Open the archived PDF](assets/fixture-paper.pdf)

> Extraction notice: This fixture was produced mechanically.

## Abstract

A fixture abstract.

## Mechanically extracted full text

Fixture paper text.
"""
        metadata = {
            **common_metadata(
                "Paper",
                "Fixture Paper",
                "Immutable arXiv snapshot of Fixture Paper.",
                tags=["paper"],
            ),
            "resource": "https://arxiv.org/abs/1508.07909v5",
            "sources": [
                {
                    "id": "arxiv-record",
                    "resource": "https://arxiv.org/abs/1508.07909v5",
                    "title": "arXiv record for Fixture Paper",
                    "last_modified": "2016-06-10",
                }
            ],
            "authors": ["Test Author"],
            "ingested": "2026-08-13",
            "submitted": "2015-08-31",
            "revised": "2016-06-10",
            "sha256": sha256_bytes(body.encode("utf-8")),
            "arxiv": {"id": "1508.07909", "version": 5},
            "license": {
                "id": "CC-BY-4.0",
                "url": "https://creativecommons.org/licenses/by/4.0/",
            },
            "attachment": {
                "resource": "assets/fixture-paper.pdf",
                "media_type": "application/pdf",
                "bytes": len(pdf.read_bytes()),
                "sha256": sha256_bytes(pdf.read_bytes()),
            },
            "extraction": {
                "tool": "pdftotext",
                "version": "pdftotext version 26.04.0",
            },
        }
        (self.root / "raw/fixture-paper.md").write_text(
            render_frontmatter(metadata, body),
            encoding="utf-8",
        )

    def _write_project_card(self) -> None:
        metadata = {
            **common_metadata(
                "Software Project",
                "Nanochat",
                "Pinned end-to-end LLM training project.",
                tags=["project-nanochat"],
            ),
            "resource": NANOCHAT_REPOSITORY,
            "repository_url": NANOCHAT_REPOSITORY,
            "default_branch": "master",
            "pinned_commit": NANOCHAT_COMMIT,
            "license": "MIT",
            "source_path": "code/nanochat",
            "sources": [
                {
                    "id": "nanochat-repository",
                    "resource": NANOCHAT_REPOSITORY,
                    "title": "Nanochat repository",
                }
            ],
        }
        (self.root / "projects/nanochat.md").write_text(
            render_frontmatter(metadata, "# Nanochat\n"),
            encoding="utf-8",
        )

    def _write_page(
        self,
        relative: str,
        page_type: str,
        *,
        links: tuple[str, ...],
        title: str | None = None,
    ) -> None:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        display_title = title or f"Fixture {page_type}"
        metadata = {
            **common_metadata(
                page_type,
                display_title,
                f"A fixture {page_type.lower()} page.",
            ),
            "sources": [
                {
                    "id": "fixture-paper",
                    "resource": "../raw/fixture-paper.md",
                    "title": "Fixture Paper",
                }
            ],
        }
        path.write_text(
            render_frontmatter(
                metadata,
                page_body(page_type, display_title, links),
            ),
            encoding="utf-8",
        )

    def _rewrite_document(
        self,
        relative: str,
        *,
        metadata_change=None,
        body_change=None,
    ) -> None:
        path = self.root / relative
        document = parse_frontmatter(path.read_text(encoding="utf-8"))
        metadata = dict(document.metadata)
        body = document.body
        if metadata_change:
            metadata = metadata_change(metadata)
        if body_change:
            body = body_change(body)
        path.write_text(
            render_frontmatter(metadata, body),
            encoding="utf-8",
        )

    def issue_codes(self, git_state: FakeGitState | None = None) -> set[str]:
        return {
            issue.code
            for issue in validate_vault(
                self.root,
                git_state=git_state or self.valid_git_state,
            )
        }

    def test_valid_profile_vault_has_no_issues(self) -> None:
        self.assertEqual(
            validate_vault(self.root, git_state=self.valid_git_state),
            (),
        )

    def test_every_non_reserved_markdown_must_be_an_okf_concept(self) -> None:
        (self.root / "README.md").write_text(
            "# Untyped reader guide\n",
            encoding="utf-8",
        )
        self.assertIn("okf.frontmatter", self.issue_codes())

    def test_unknown_okf_type_is_tolerated_outside_profile_directories(
        self,
    ) -> None:
        metadata = common_metadata(
            "Experiment Notebook",
            "Tokenizer experiment",
            "A custom extension concept type.",
        )
        (self.root / "tokenizer-experiment.md").write_text(
            render_frontmatter(metadata, "# Tokenizer experiment\n"),
            encoding="utf-8",
        )
        update_indexes(self.root, check=False)

        self.assertNotIn("page.type", self.issue_codes())

    def test_missing_raw_index_is_reported(self) -> None:
        (self.root / "raw/index.md").unlink()
        self.assertIn("index.missing", self.issue_codes())

    def test_added_unindexed_resource_makes_index_stale(self) -> None:
        (self.root / "raw/assets/other.pdf").write_bytes(
            b"%PDF-1.7\nother\n"
        )
        self.assertIn("index.stale", self.issue_codes())

    def test_nested_index_cannot_have_frontmatter(self) -> None:
        path = self.root / "raw/index.md"
        path.write_text(
            render_frontmatter({"type": "Index"}, "# Raw\n"),
            encoding="utf-8",
        )
        self.assertIn("index.frontmatter", self.issue_codes())

    def test_root_index_can_only_declare_okf_version(self) -> None:
        path = self.root / "index.md"
        document = parse_frontmatter(path.read_text(encoding="utf-8"))
        path.write_text(
            render_frontmatter(
                {**document.metadata, "title": "Extra"},
                document.body,
            ),
            encoding="utf-8",
        )
        self.assertIn("index.frontmatter", self.issue_codes())

    def test_log_dates_must_be_newest_first(self) -> None:
        path = self.root / "log.md"
        document = parse_frontmatter(path.read_text(encoding="utf-8"))
        path.write_text(
            render_frontmatter(
                document.metadata,
                "# Bundle history\n\n"
                "## 2026-08-12\n\n* Older.\n\n"
                "## 2026-08-13\n\n* Newer.\n",
            ),
            encoding="utf-8",
        )
        self.assertIn("log.order", self.issue_codes())

    def test_markdown_index_must_not_be_routed_through_lfs(self) -> None:
        self.assertIn(
            "lfs.markdown",
            self.issue_codes(FakeGitState(markdown_lfs=True)),
        )

    def test_archived_pdf_must_be_routed_through_lfs(self) -> None:
        self.assertIn(
            "lfs.untracked",
            self.issue_codes(FakeGitState(binary_lfs=False)),
        )

    def test_generated_at_is_required_by_the_profile(self) -> None:
        self._rewrite_document(
            PAGE_PATHS["Concept"],
            metadata_change=lambda metadata: {
                **metadata,
                "generated": {"by": "process:test-fixture"},
            },
        )
        self.assertIn("page.generated", self.issue_codes())

    def test_generated_actor_must_follow_actor_convention(self) -> None:
        self._rewrite_document(
            PAGE_PATHS["Concept"],
            metadata_change=lambda metadata: {
                **metadata,
                "generated": {
                    "by": "test",
                    "at": "2026-08-13T00:00:00Z",
                },
            },
        )
        self.assertIn("page.generated", self.issue_codes())

    def test_contested_is_not_an_okf_lifecycle_value(self) -> None:
        self._rewrite_document(
            PAGE_PATHS["Concept"],
            metadata_change=lambda metadata: {
                **metadata,
                "status": "contested",
            },
        )
        self.assertIn("page.status", self.issue_codes())

    def test_unregistered_tag_is_reported(self) -> None:
        self._rewrite_document(
            PAGE_PATHS["Concept"],
            metadata_change=lambda metadata: {
                **metadata,
                "tags": ["not-registered"],
            },
        )
        self.assertIn("page.tag", self.issue_codes())

    def test_claim_footnote_must_match_a_source_id(self) -> None:
        self._rewrite_document(
            PAGE_PATHS["Concept"],
            body_change=lambda body: (
                body
                + "\nUnsupported claim.[^unknown]\n\n"
                + "[^unknown]: Unknown source\n"
            ),
        )
        self.assertIn("source.footnote", self.issue_codes())

    def test_claim_footnote_requires_a_definition(self) -> None:
        self._rewrite_document(
            PAGE_PATHS["Concept"],
            body_change=lambda body: body.replace(
                "[^fixture-paper]: Fixture Paper",
                "",
            ),
        )
        self.assertIn("source.footnote", self.issue_codes())

    def test_footnote_examples_in_fenced_code_are_not_claims(self) -> None:
        self._rewrite_document(
            PAGE_PATHS["Concept"],
            body_change=lambda body: (
                body
                + "\n```markdown\n"
                + "Example claim.[^example-only]\n\n"
                + "[^example-only]: Example-only source\n"
                + "```\n"
            ),
        )
        self.assertNotIn("source.footnote", self.issue_codes())

    def test_bundle_relative_source_path_resolves(self) -> None:
        self._rewrite_document(
            PAGE_PATHS["Concept"],
            metadata_change=lambda metadata: {
                **metadata,
                "sources": [
                    {
                        "id": "fixture-paper",
                        "resource": "/raw/fixture-paper.md",
                        "title": "Fixture Paper",
                    }
                ],
            },
        )
        self.assertNotIn("source.missing", self.issue_codes())

    def test_missing_source_resource_is_reported(self) -> None:
        self._rewrite_document(
            PAGE_PATHS["Concept"],
            metadata_change=lambda metadata: {
                **metadata,
                "sources": [
                    {
                        "id": "fixture-paper",
                        "resource": "../raw/missing.md",
                        "title": "Missing",
                    }
                ],
            },
        )
        self.assertIn("source.missing", self.issue_codes())

    def test_broken_markdown_link_is_reported(self) -> None:
        self._rewrite_document(
            PAGE_PATHS["Concept"],
            body_change=lambda body: body + "\n[Missing](missing.md)\n",
        )
        self.assertIn("link.missing", self.issue_codes())

    def test_okf_concept_ids_and_directory_links_resolve(self) -> None:
        self._rewrite_document(
            "README.md",
            body_change=lambda body: (
                body
                + "\n[Concept ID](/concepts/concept)\n"
                + "[Raw index](raw/)\n"
            ),
        )
        self.assertNotIn("link.missing", self.issue_codes())

    def test_links_inside_mechanically_extracted_paper_text_are_ignored(
        self,
    ) -> None:
        self._rewrite_document(
            "raw/fixture-paper.md",
            body_change=lambda body: body.replace(
                "Fixture paper text.",
                "A PDF extraction token that resembles [slides](slides).",
            ),
        )

        self.assertNotIn("link.missing", self.issue_codes())

    def test_relative_markdown_link_wins_over_duplicate_basenames(
        self,
    ) -> None:
        self._rewrite_document(
            "README.md",
            body_change=lambda body: body + "\n[Root index](index.md)\n",
        )
        self.assertNotIn("link.ambiguous", self.issue_codes())

    def test_page_requires_two_compiled_crosslinks(self) -> None:
        relative = PAGE_PATHS["Concept"]
        title = "Fixture Concept"
        self._rewrite_document(
            relative,
            body_change=lambda _body: page_body(
                "Concept",
                title,
                ("../entities/entity.md",),
            ),
        )
        self.assertIn("page.crosslinks", self.issue_codes())

    def test_changed_raw_body_breaks_recorded_hash(self) -> None:
        path = self.root / "raw/fixture-paper.md"
        path.write_text(
            path.read_text(encoding="utf-8") + "\nchanged\n",
            encoding="utf-8",
        )
        self.assertIn("raw.body-hash", self.issue_codes())

    def test_changed_pdf_breaks_attachment_hash(self) -> None:
        (self.root / "raw/assets/fixture-paper.pdf").write_bytes(
            b"%PDF-1.7\nchanged\n"
        )
        self.assertIn("raw.attachment-hash", self.issue_codes())

    def test_raw_filename_must_match_title_slug(self) -> None:
        (self.root / "raw/fixture-paper.md").rename(
            self.root / "raw/wrong-name.md"
        )
        self.assertIn("raw.title-path", self.issue_codes())

    def test_conflicts_must_be_symmetric_without_changing_lifecycle(
        self,
    ) -> None:
        self._rewrite_document(
            PAGE_PATHS["Concept"],
            metadata_change=lambda metadata: {
                **metadata,
                "status": "draft",
                "conflicts": [
                    {
                        "resource": "../entities/entity.md",
                        "observed": "2026-08-13",
                        "reason": "The sources disagree about the fixture.",
                    }
                ],
            },
        )
        self.assertIn("conflict.asymmetric", self.issue_codes())
        self.assertNotIn("page.status", self.issue_codes())

    def test_project_card_commit_must_match_git_state(self) -> None:
        self._rewrite_document(
            "projects/nanochat.md",
            metadata_change=lambda metadata: {
                **metadata,
                "pinned_commit": "a" * 40,
            },
        )
        self.assertIn("project.commit", self.issue_codes())

    def test_project_source_must_be_a_gitlink(self) -> None:
        state = FakeGitState(
            submodule=SubmoduleState(
                configured_path="projects/code/nanochat",
                configured_url=NANOCHAT_REPOSITORY,
                index_mode="100644",
                index_oid=NANOCHAT_COMMIT,
                checkout_oid=NANOCHAT_COMMIT,
            )
        )
        self.assertIn("project.gitlink", self.issue_codes(state))

    def test_runtime_database_state_is_forbidden(self) -> None:
        path = self.root / ".llm_wiki/index.sqlite"
        path.parent.mkdir()
        path.write_bytes(b"sqlite")
        self.assertIn("forbidden.runtime-state", self.issue_codes())


if __name__ == "__main__":
    unittest.main()
