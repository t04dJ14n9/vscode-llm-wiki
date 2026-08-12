import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from rebuild_indexes import update_indexes
from vault_checks import (
    NANOCHAT_COMMIT,
    NANOCHAT_REPOSITORY,
    SubmoduleState,
    validate_vault,
)
from vaultlib import parse_frontmatter, render_frontmatter, sha256_bytes


REQUIRED_HEADINGS = {
    "summary": ("Scope", "Pipeline", "Evidence boundary", "Related pages"),
    "entity": ("What it is", "Why it matters", "Nanochat relevance", "Related pages"),
    "concept": ("Definition", "Mechanism", "Nanochat connection", "Related pages"),
    "comparison": ("Decision frame", "Comparison", "Takeaway", "Related pages"),
    "query": ("Answer", "Evidence trail", "Limits", "Related pages"),
}
PAGE_PATHS = {
    "summary": "wiki/summaries/summary.md",
    "entity": "wiki/entities/entity.md",
    "concept": "wiki/concepts/concept.md",
    "comparison": "wiki/comparisons/comparison.md",
    "query": "wiki/queries/query.md",
}


class FakeGitState:
    def __init__(
        self,
        *,
        submodule: SubmoduleState | None = None,
        lfs_filter: str | None = "lfs",
    ) -> None:
        self._submodule = submodule or SubmoduleState(
            configured_path="demo-vault/projects/code/nanochat",
            configured_url=NANOCHAT_REPOSITORY,
            index_mode="160000",
            index_oid=NANOCHAT_COMMIT,
            checkout_oid=NANOCHAT_COMMIT,
        )
        self._lfs_filter = lfs_filter

    def nanochat_submodule(self) -> SubmoduleState:
        return self._submodule

    def lfs_filter(self, _path: Path) -> str | None:
        return self._lfs_filter


def page_body(page_type: str, *, links: tuple[str, ...] | None = None) -> str:
    selected_links = links or (
        "../summaries/summary.md",
        "../entities/entity.md",
        "../concepts/concept.md",
    )
    lines = [f"# Fixture {page_type.title()}", ""]
    for heading in REQUIRED_HEADINGS[page_type]:
        lines.extend([f"## {heading}", "", f"Evidence for {heading.lower()}.", ""])
    lines.append(
        "Related: "
        + " ".join(
            f"[compiled page {index}]({target})"
            for index, target in enumerate(selected_links, start=1)
        )
    )
    return "\n".join(lines) + "\n"


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
            ".gitattributes",
            ".gitignore",
            "README.md",
            "SCHEMA.md",
            "AGENTS.md",
            "CLAUDE.md",
            "log.md",
            "scripts/ingest_arxiv.py",
            "scripts/rebuild_indexes.py",
            "scripts/validate_vault.py",
            "scripts/vault_checks.py",
            "scripts/vaultlib.py",
            ".agents/skills/llm-wiki/SKILL.md",
            ".agents/skills/llm-wiki/references/arxiv-ingestion.md",
            ".agents/skills/llm-wiki/references/frontmatter.md",
        ):
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"# {path.name}\n", encoding="utf-8")
        (self.root / ".gitattributes").write_text(
            "raw/assets/** filter=lfs diff=lfs merge=lfs -text\n",
            encoding="utf-8",
        )
        for relative in (
            "raw/assets",
            "projects/code/nanochat",
            "wiki/summaries",
            "wiki/entities",
            "wiki/concepts",
            "wiki/comparisons",
            "wiki/queries",
        ):
            (self.root / relative).mkdir(parents=True, exist_ok=True)
        self._write_raw_snapshot()
        self._write_project_card()
        for page_type, relative in PAGE_PATHS.items():
            links = tuple(
                target
                for target in (
                    "../summaries/summary.md",
                    "../entities/entity.md",
                    "../concepts/concept.md",
                )
                if target != f"../{Path(relative).parent.name}/{Path(relative).name}"
            )
            self._write_page(relative, page_type, links=links[:2])
        update_indexes(self.root, check=False)

    def _write_raw_snapshot(self) -> None:
        pdf = self.root / "raw/assets/fixture-paper.pdf"
        pdf.write_bytes(b"%PDF-1.7\nfixture\n")
        body = """# Fixture Paper

## Source metadata

- **Local attachment:** [Open the archived PDF](assets/fixture-paper.pdf)

> Extraction notice: This fixture was produced mechanically.

## Abstract

A fixture abstract.

## Mechanically extracted full text

Fixture paper text.
"""
        metadata = {
            "title": "Fixture Paper",
            "source_type": "paper",
            "source_url": "https://arxiv.org/abs/1508.07909v5",
            "ingested": "2026-08-13",
            "sha256": sha256_bytes(body.encode("utf-8")),
            "arxiv": {"id": "1508.07909", "version": 5},
            "license": {
                "id": "CC-BY-4.0",
                "url": "https://creativecommons.org/licenses/by/4.0/",
            },
            "attachment": {
                "path": "assets/fixture-paper.pdf",
                "media_type": "application/pdf",
                "sha256": sha256_bytes(pdf.read_bytes()),
            },
            "extraction": {
                "tool": "pdftotext",
                "version": "pdftotext version 26.04.0",
            },
        }
        (self.root / "raw/fixture-paper.md").write_text(
            render_frontmatter(metadata, body), encoding="utf-8"
        )

    def _write_project_card(self) -> None:
        metadata = {
            "title": "Nanochat",
            "type": "project",
            "description": "Pinned end-to-end LLM training project.",
            "repository_url": NANOCHAT_REPOSITORY,
            "default_branch": "master",
            "pinned_commit": NANOCHAT_COMMIT,
            "license": "MIT",
            "source_path": "code/nanochat",
        }
        (self.root / "projects/nanochat.md").write_text(
            render_frontmatter(metadata, "# Nanochat\n"), encoding="utf-8"
        )

    def _write_page(
        self,
        relative: str,
        page_type: str,
        *,
        links: tuple[str, ...] | None = None,
        title: str | None = None,
    ) -> None:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        metadata = {
            "title": title or f"Fixture {page_type.title()}",
            "type": page_type,
            "description": f"A fixture {page_type} page.",
            "tags": ["pretraining"],
            "sources": [
                {
                    "id": "arxiv-1508.07909v5",
                    "resource": "../../raw/fixture-paper.md",
                    "title": "Fixture Paper",
                }
            ],
            "status": "stable",
            "generated": {"by": "test"},
        }
        path.write_text(
            render_frontmatter(metadata, page_body(page_type, links=links)),
            encoding="utf-8",
        )

    def _rewrite_page(
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
            render_frontmatter(metadata, body), encoding="utf-8"
        )

    def issue_codes(self, git_state: FakeGitState | None = None) -> set[str]:
        return {
            issue.code
            for issue in validate_vault(
                self.root, git_state=git_state or self.valid_git_state
            )
        }

    def test_valid_minimal_vault_has_no_issues(self) -> None:
        self.assertEqual(
            validate_vault(self.root, git_state=self.valid_git_state), ()
        )

    def test_raw_index_is_forbidden(self) -> None:
        (self.root / "raw/index.md").write_text("# Raw\n", encoding="utf-8")
        self.assertIn("forbidden.raw-index", self.issue_codes())

    def test_missing_required_layout_file_is_reported(self) -> None:
        (self.root / "SCHEMA.md").unlink()
        self.assertIn("layout.missing", self.issue_codes())

    def test_runtime_database_state_is_forbidden(self) -> None:
        path = self.root / ".llm_wiki/index.sqlite"
        path.parent.mkdir()
        path.write_bytes(b"sqlite")
        self.assertIn("forbidden.runtime-state", self.issue_codes())

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

    def test_missing_raw_attachment_is_reported(self) -> None:
        (self.root / "raw/assets/fixture-paper.pdf").unlink()
        self.assertIn("raw.attachment-missing", self.issue_codes())

    def test_unknown_page_type_is_rejected(self) -> None:
        self._rewrite_page(
            PAGE_PATHS["concept"],
            metadata_change=lambda metadata: {**metadata, "type": "note"},
        )
        self.assertIn("page.type", self.issue_codes())

    def test_unregistered_tag_is_rejected(self) -> None:
        self._rewrite_page(
            PAGE_PATHS["concept"],
            metadata_change=lambda metadata: {
                **metadata,
                "tags": ["unregistered"],
            },
        )
        self.assertIn("page.tag", self.issue_codes())

    def test_required_type_heading_is_enforced(self) -> None:
        self._rewrite_page(
            PAGE_PATHS["concept"],
            body_change=lambda body: body.replace("## Mechanism", "## Operation"),
        )
        self.assertIn("page.headings", self.issue_codes())

    def test_missing_source_resource_is_reported(self) -> None:
        self._rewrite_page(
            PAGE_PATHS["concept"],
            metadata_change=lambda metadata: {
                **metadata,
                "sources": [
                    {
                        "id": "missing",
                        "resource": "../../raw/missing.md",
                        "title": "Missing",
                    }
                ],
            },
        )
        self.assertIn("page.source-missing", self.issue_codes())

    def test_broken_markdown_link_is_reported(self) -> None:
        self._rewrite_page(
            PAGE_PATHS["concept"],
            body_change=lambda body: body + "\n[Missing](missing.md)\n",
        )
        self.assertIn("link.missing", self.issue_codes())

    def test_ambiguous_basename_wiki_link_is_reported(self) -> None:
        self._write_page(
            "wiki/entities/shared.md",
            "entity",
            links=("../summaries/summary.md", "../concepts/concept.md"),
            title="Shared Entity",
        )
        self._write_page(
            "wiki/concepts/shared.md",
            "concept",
            links=("../summaries/summary.md", "../entities/entity.md"),
            title="Shared Concept",
        )
        self._rewrite_page(
            PAGE_PATHS["query"],
            body_change=lambda body: body + "\n[[shared]]\n",
        )
        update_indexes(self.root, check=False)
        self.assertIn("link.ambiguous", self.issue_codes())

    def test_page_requires_two_compiled_crosslinks(self) -> None:
        self._rewrite_page(
            PAGE_PATHS["concept"],
            body_change=lambda _body: page_body(
                "concept", links=("../entities/entity.md",)
            ),
        )
        self.assertIn("page.crosslinks", self.issue_codes())

    def test_conflicts_must_be_symmetric(self) -> None:
        self._rewrite_page(
            PAGE_PATHS["concept"],
            metadata_change=lambda metadata: {
                **metadata,
                "status": "contested",
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

    def test_stale_generated_index_is_reported(self) -> None:
        (self.root / "wiki/index.md").write_text("stale\n", encoding="utf-8")
        self.assertIn("index.stale", self.issue_codes())

    def test_project_card_commit_must_match_git_state(self) -> None:
        self._rewrite_page(
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
                configured_path="demo-vault/projects/code/nanochat",
                configured_url=NANOCHAT_REPOSITORY,
                index_mode="100644",
                index_oid=NANOCHAT_COMMIT,
                checkout_oid=NANOCHAT_COMMIT,
            )
        )
        self.assertIn("project.gitlink", self.issue_codes(state))

    def test_archived_pdf_must_be_routed_through_lfs(self) -> None:
        self.assertIn(
            "lfs.untracked",
            self.issue_codes(FakeGitState(lfs_filter=None)),
        )


if __name__ == "__main__":
    unittest.main()
