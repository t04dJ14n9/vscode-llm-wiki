import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))

from rebuild_indexes import update_indexes
from vault_checks import NANOCHAT_COMMIT, NANOCHAT_REPOSITORY, SourceBindingState, validate_vault
from vaultlib import parse_frontmatter, render_frontmatter, sha256_bytes


class FakeGitState:
    def __init__(self, *, source=None, binary_lfs=True, markdown_lfs=False, historical=None, tracked=False):
        self.source = source or SourceBindingState("missing")
        self.binary_lfs = binary_lfs
        self.markdown_lfs = markdown_lfs
        self.historical = historical or {}
        self.tracked = tracked

    def source_binding(self, _path: Path) -> SourceBindingState:
        return self.source

    def lfs_filter(self, path: Path) -> str | None:
        if path.suffix.lower() == ".md":
            return "lfs" if self.markdown_lfs else None
        return "lfs" if self.binary_lfs else None

    def source_blob(self, _path: Path, revision: str, repository_path: str) -> bytes | None:
        return self.historical.get((revision, repository_path))

    def is_tracked(self, _path: Path) -> bool:
        return self.tracked


def metadata(page_type: str, title: str, *, scope=None) -> dict[str, object]:
    result = {
        "type": page_type,
        "title": title,
        "description": f"Fixture {title}.",
        "tags": ["project-nanochat"] if scope is None else ["language-models"],
        "status": "stable",
        "generated": {"by": "process:test", "at": "2026-08-23T00:00:00Z"},
    }
    if scope is not None:
        result["scope"] = scope
    if page_type in {"Concept", "Entity"}:
        result["created"] = {"by": "process:test", "at": "2026-08-23T00:00:00Z"}
    return result


class ValidateVaultTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.git_state = FakeGitState()
        self.create_valid_vault()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write_page(self, relative, page_type, title, *, extra=None, body=None, scope=None):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        values = metadata(page_type, title, scope=scope)
        values.update(extra or {})
        path.write_text(render_frontmatter(values, body or f"# {title}\n"), encoding="utf-8")

    def rewrite(self, relative, change) -> None:
        path = self.root / relative
        document = parse_frontmatter(path.read_text(encoding="utf-8"))
        path.write_text(render_frontmatter(change(dict(document.metadata)), document.body), encoding="utf-8")

    def create_valid_vault(self) -> None:
        roots = ("summaries", "concepts", "entities", "playbooks", "comparisons", "queries", "raw", "assets", "examples")
        workbench = ("inbox", "raw", "assets", "tasks", "scratch", "summaries", "concepts", "entities", "playbooks", "comparisons", "queries", "output", "examples")
        for relative in roots:
            (self.root / relative).mkdir(parents=True)
        for relative in workbench:
            (self.root / "projects/nanochat" / relative).mkdir(parents=True)
        (self.root / ".gitattributes").write_text("/assets/** filter=lfs diff=lfs merge=lfs -text\n/projects/*/assets/** filter=lfs diff=lfs merge=lfs -text\n", encoding="utf-8")
        (self.root / ".gitignore").write_text(".llm_wiki/\n.ingest-*/\nprojects/code/\n", encoding="utf-8")
        for filename, page_type in (("README.md", "Reference"), ("SCHEMA.md", "Reference"), ("AGENTS.md", "Playbook")):
            self.write_page(filename, page_type, filename.removesuffix(".md"), scope="cross-project")
        self.write_page("_log.md", "Log", "History", body="# History\n\n## 2026-08-23\n\n* Fixture.\n")
        (self.root / "projects/repositories.yaml").write_text("""version: 1
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
""", encoding="utf-8")
        self.write_page("projects/nanochat.md", "Software Project", "Nanochat", extra={
            "repository": "nanochat", "repository_url": NANOCHAT_REPOSITORY,
            "vcs": "git", "default_ref": "master", "studied_revision": NANOCHAT_COMMIT,
            "studied_at": "2026-08-23T00:00:00Z", "vault_path": "nanochat", "code_path": "code/nanochat",
        })
        self.write_page("projects/nanochat/tasks/current.md", "Task", "Current task")
        (self.root / "projects/nanochat/.gitattributes").write_text("/assets/** filter=lfs diff=lfs merge=lfs -text\n", encoding="utf-8")
        (self.root / "projects/nanochat/.gitignore").write_text(".llm_wiki/\n", encoding="utf-8")
        for filename, page_type in (("README.md", "Reference"), ("SCHEMA.md", "Reference"), ("AGENTS.md", "Playbook")):
            self.write_page(f"projects/nanochat/{filename}", page_type, f"Nanochat {filename.removesuffix('.md')}")
        self.write_page("projects/nanochat/_log.md", "Log", "Nanochat history", body="# Nanochat history\n")
        outer_pdf = self.root / "assets/outer-paper.pdf"
        outer_pdf.write_bytes(b"%PDF-1.7\nouter fixture\n")
        outer_body = "# Outer Paper\n\n[Open PDF](../assets/outer-paper.pdf)\n"
        self.write_page("raw/outer-paper.md", "Paper", "Outer Paper", extra={
            "sha256": sha256_bytes(outer_body.encode()),
            "attachment": {"resource": "../assets/outer-paper.pdf", "role": "original", "media_type": "application/pdf", "bytes": len(outer_pdf.read_bytes()), "sha256": sha256_bytes(outer_pdf.read_bytes())},
        }, body=outer_body)
        pdf = self.root / "projects/nanochat/assets/fixture-paper.pdf"
        pdf.write_bytes(b"%PDF-1.7\nfixture\n")
        paper_body = "# Fixture Paper\n\n[Open PDF](../assets/fixture-paper.pdf)\n"
        self.write_page("projects/nanochat/raw/fixture-paper.md", "Paper", "Fixture Paper", extra={
            "sha256": sha256_bytes(paper_body.encode()),
            "attachment": {"resource": "../assets/fixture-paper.pdf", "role": "original", "media_type": "application/pdf", "bytes": len(pdf.read_bytes()), "sha256": sha256_bytes(pdf.read_bytes())},
        }, body=paper_body)
        self.write_page("concepts/reusable.md", "Concept", "Reusable", scope="vault")
        self.write_page("entities/reusable.md", "Entity", "Reusable entity", scope="vault")
        self.write_page("projects/nanochat/concepts/code-backed.md", "Concept", "Code backed", extra={
            "status": "draft", "source_state": "awaiting-source", "code_scope": True,
            "sources": [{"id": "code", "resource": "../../code/nanochat/nanochat/gpt.py", "title": "GPT", "repository": "nanochat", "revision": NANOCHAT_COMMIT, "path": "nanochat/gpt.py"}],
        })
        self.write_page("projects/nanochat/queries/fixture.md", "Query", "Fixture query", extra={
            "condensed_summary": "A concise durable answer.", "project": "nanochat", "code_scope": True,
            "conversation": {"selection_id": "selection-1"},
            "sources": [{"id": "code-page", "resource": "../concepts/code-backed.md", "title": "Code page"}],
            "anchors": [{"source_id": "code-page", "kind": "markdown", "resource": "../concepts/code-backed.md", "start_line": 1, "end_line": 1}],
        }, body="# Fixture query\n\n## Answer\n\nAnswer.\n\n## Evidence\n\nEvidence.\n\n## Limitations\n\nLimits.\n\n## Related durable pages\n\n[Code](../concepts/code-backed.md)\n")
        self.write_page("queries/outer-pdf.md", "Query", "Outer PDF query", scope="vault", extra={
            "condensed_summary": "A durable answer grounded in an outer-vault paper.",
            "conversation": {"selection_id": "outer-pdf-selection"},
            "sources": [{"id": "paper", "resource": "../assets/outer-paper.pdf", "title": "Outer Paper PDF"}],
            "anchors": [{"source_id": "paper", "kind": "pdf", "resource": "../assets/outer-paper.pdf", "page": 1, "viewrect": [1, 2, 3, 4]}],
        }, body="# Outer PDF query\n\n## Answer\n\nAnswer.\n\n## Evidence\n\nEvidence.\n\n## Limitations\n\nLimits.\n\n## Related durable pages\n\n[Paper](../raw/outer-paper.md)\n")
        update_indexes(self.root, check=False)

    def codes(self, state=None):
        return {issue.code for issue in validate_vault(self.root, git_state=state or self.git_state)}

    def test_valid_project_scoped_vault_has_no_issues_and_layers_are_explicit(self):
        self.assertEqual(validate_vault(self.root, git_state=self.git_state), ())
        (self.root / "concepts/reusable.md").write_text("# broken\n", encoding="utf-8")
        issues = validate_vault(self.root, git_state=self.git_state)
        self.assertIn("okf.frontmatter", {issue.code for issue in issues})
        self.assertTrue(all(issue.layer in {"okf-base", "karpathy-vault-v1", "project-policy"} for issue in issues))

    def test_registered_project_directory_is_valid_as_a_standalone_vault(self):
        self.assertEqual(
            validate_vault(self.root / "projects/nanochat", git_state=self.git_state),
            (),
        )

    def test_underscore_navigation_files_are_canonical_regular_files(self):
        for relative in (
            "_index.md",
            "_log.md",
            "projects/nanochat/_index.md",
            "projects/nanochat/_log.md",
        ):
            with self.subTest(relative=relative):
                path = self.root / relative
                self.assertTrue(path.is_file())
                self.assertFalse(path.is_symlink())
        for legacy in ("index.md", "log.md"):
            path = self.root / legacy
            path.write_text("legacy\n", encoding="utf-8")
            self.assertIn("layout.forbidden", self.codes())
            path.unlink()
        index = self.root / "_index.md"
        index.unlink()
        index.symlink_to("README.md")
        self.assertIn("layout.forbidden", self.codes())

    def test_only_underscore_index_is_generated_and_assets_source_are_opaque(self):
        (self.root / "projects/nanochat/raw/_index.md").unlink()
        (self.root / "projects/nanochat/assets/_index.md").write_text("bad\n", encoding="utf-8")
        self.assertIn("index.missing", self.codes())
        self.assertIn("assets.index", self.codes())

    def test_underscore_index_inside_registered_source_is_opaque(self):
        source = self.root / "projects/code/nanochat"
        source.mkdir(parents=True)
        (source / "_index.md").write_text("# Upstream legacy file\n", encoding="utf-8")
        (source / "README.md").write_text("# Upstream README without OKF frontmatter\n", encoding="utf-8")
        (source / ".claude").mkdir()
        state = FakeGitState(source=SourceBindingState("in-place", remote=NANOCHAT_REPOSITORY, revision=NANOCHAT_COMMIT))
        codes = self.codes(state)
        self.assertNotIn("layout.forbidden", codes)
        self.assertNotIn("okf.frontmatter", codes)
        self.assertNotIn("forbidden.runtime-state", codes)

    def test_registry_is_strict_and_project_card_must_match_it(self):
        registry = self.root / "projects/repositories.yaml"
        registry.write_text(registry.read_text().replace("update_strategy: review", "extra: yes"), encoding="utf-8")
        self.assertIn("registry.schema", self.codes())

    def test_missing_registered_source_is_valid(self):
        self.assertNotIn("source.binding", self.codes(FakeGitState(source=SourceBindingState("missing"))))

    def test_wrong_remote_broken_symlink_and_non_git_source_fail(self):
        states = (
            SourceBindingState("in-place", remote="https://example.com/wrong.git", revision=NANOCHAT_COMMIT),
            SourceBindingState("broken-symlink"), SourceBindingState("non-git"),
        )
        for state in states:
            with self.subTest(state=state):
                self.assertIn("source.binding", self.codes(FakeGitState(source=state)))

    def test_equivalent_remote_and_registered_revision_are_valid(self):
        state = SourceBindingState("symlink", remote="git@github.com:karpathy/nanochat.git", revision=NANOCHAT_COMMIT)
        self.assertNotIn("source.binding", self.codes(FakeGitState(source=state)))

    def test_unregistered_source_directory_is_rejected(self):
        (self.root / "projects/code/other").mkdir(parents=True)
        self.assertIn("source.unregistered", self.codes())

    def test_central_code_directory_must_be_git_ignored(self):
        ignore = self.root / ".gitignore"
        ignore.write_text(ignore.read_text(encoding="utf-8").replace("projects/code/\n", ""), encoding="utf-8")
        self.assertIn("source.ignore", self.codes())

    def test_stable_code_claim_requires_revision_path_and_hash(self):
        self.rewrite("projects/nanochat/concepts/code-backed.md", lambda data: {**data, "status": "stable", "source_state": "verified"})
        self.assertIn("code.provenance", self.codes())

    def test_current_registered_source_hash_is_verified(self):
        source = self.root / "projects/code/nanochat/nanochat/gpt.py"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"current source\n")
        self.rewrite(
            "projects/nanochat/concepts/code-backed.md",
            lambda data: {
                **data,
                "status": "stable",
                "source_state": "verified",
                "sources": [{**data["sources"][0], "sha256": "0" * 64}],
            },
        )
        state = FakeGitState(source=SourceBindingState("in-place", remote=NANOCHAT_REPOSITORY, revision=NANOCHAT_COMMIT))
        self.assertIn("code.hash", self.codes(state))

    def test_untracked_worktree_file_cannot_satisfy_commit_bound_hash(self):
        untracked = b"untracked working tree source\n"
        source = self.root / "projects/code/nanochat/nanochat/gpt.py"
        source.parent.mkdir(parents=True)
        source.write_bytes(untracked)
        self.rewrite(
            "projects/nanochat/concepts/code-backed.md",
            lambda data: {
                **data,
                "status": "stable",
                "source_state": "verified",
                "sources": [{**data["sources"][0], "sha256": sha256_bytes(untracked)}],
            },
        )
        state = FakeGitState(
            source=SourceBindingState("in-place", remote=NANOCHAT_REPOSITORY, revision=NANOCHAT_COMMIT),
            historical={},
        )
        self.assertIn("code.hash", self.codes(state))

    def test_historical_code_hash_is_verified_after_checkout_advances(self):
        historical = b"historical source\n"
        advanced = "a" * 40
        source = self.root / "projects/code/nanochat/nanochat/gpt.py"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"new head source\n")
        state = FakeGitState(
            source=SourceBindingState("in-place", remote=NANOCHAT_REPOSITORY, revision=advanced),
            historical={(NANOCHAT_COMMIT, "nanochat/gpt.py"): historical},
        )
        self.rewrite(
            "projects/nanochat/concepts/code-backed.md",
            lambda data: {
                **data,
                "status": "stable",
                "source_state": "verified",
                "sources": [{**data["sources"][0], "sha256": "0" * 64}],
            },
        )
        self.assertIn("code.hash", self.codes(state))
        self.assertIn("source.currentness", self.codes(state))

        self.rewrite(
            "projects/nanochat/concepts/code-backed.md",
            lambda data: {
                **data,
                "sources": [{**data["sources"][0], "sha256": sha256_bytes(historical)}],
            },
        )
        self.assertNotIn("code.hash", self.codes(state))
        self.assertIn("source.currentness", self.codes(state))

    def test_draft_awaiting_source_code_claim_may_omit_hash(self):
        self.assertNotIn("code.provenance", self.codes())

    def test_root_compiled_pages_require_explicit_vault_scope(self):
        self.rewrite("concepts/reusable.md", lambda data: {key: value for key, value in data.items() if key != "scope"})
        self.assertIn("placement.scope", self.codes())

    def test_nested_root_compiled_page_requires_explicit_vault_scope(self):
        self.write_page("concepts/nested/page.md", "Concept", "Nested reusable")
        update_indexes(self.root, check=False)
        self.assertIn("placement.scope", self.codes())

    def test_code_vault_compiled_pages_require_explicit_code_scope(self):
        self.rewrite("projects/nanochat/concepts/code-backed.md", lambda data: {key: value for key, value in data.items() if key != "code_scope"})
        codes = {
            issue.code
            for issue in validate_vault(
                self.root / "projects/nanochat",
                git_state=self.git_state,
            )
        }
        self.assertIn("placement.code-scope", codes)

    def test_assets_are_flat_binary_only_and_require_lfs(self):
        (self.root / "projects/nanochat/assets/nested").mkdir()
        (self.root / "projects/nanochat/assets/note.md").write_text("bad\n", encoding="utf-8")
        codes = self.codes(FakeGitState(binary_lfs=False))
        self.assertIn("assets.flat", codes)
        self.assertIn("assets.binary", codes)
        self.assertIn("lfs.untracked", codes)

    def test_outer_raw_and_assets_receive_the_same_integrity_checks(self):
        path = self.root / "raw/outer-paper.md"
        path.write_text(path.read_text(encoding="utf-8") + "changed\n", encoding="utf-8")
        self.assertIn("raw.body-hash", self.codes())
        self.assertIn("lfs.untracked", self.codes(FakeGitState(binary_lfs=False)))

    def test_attachment_requires_role_and_exact_integrity(self):
        self.rewrite("projects/nanochat/raw/fixture-paper.md", lambda data: {**data, "attachment": {key: value for key, value in data["attachment"].items() if key != "role"}})
        self.assertIn("raw.attachment", self.codes())

    def test_attachment_enforces_media_bytes_and_same_project_assets(self):
        relative = "projects/nanochat/raw/fixture-paper.md"
        original = parse_frontmatter((self.root / relative).read_text(encoding="utf-8")).metadata["attachment"]
        invalid = (
            {**original, "media_type": "text/plain"},
            {**original, "bytes": -1},
            {**original, "bytes": True},
            {**original, "resource": "../../../other/assets/fixture-paper.pdf"},
        )
        other = self.root / "projects/other/assets/fixture-paper.pdf"
        other.parent.mkdir(parents=True)
        other.write_bytes(b"%PDF-1.7\nfixture\n")
        for attachment in invalid:
            with self.subTest(attachment=attachment):
                self.rewrite(relative, lambda data, value=attachment: {**data, "attachment": value})
                self.assertIn("raw.attachment", self.codes())

    def test_assets_reject_non_binary_suffixes(self):
        for name in ("notes.txt", "metadata.yaml", "source"):
            with self.subTest(name=name):
                path = self.root / "projects/nanochat/assets" / name
                path.write_bytes(b"not binary evidence\n")
                self.assertIn("assets.binary", self.codes())
                path.unlink()

    def test_project_requires_exact_workbench_and_single_current_task(self):
        (self.root / "projects/nanochat/tasks/current.md").unlink()
        self.assertIn("workbench.current-task", self.codes())

    def test_query_contract_requires_condensed_summary_selection_and_anchors(self):
        self.rewrite("projects/nanochat/queries/fixture.md", lambda data: {key: value for key, value in data.items() if key not in {"condensed_summary", "conversation", "anchors"}})
        self.assertIn("query.contract", self.codes())

    def test_query_anchors_require_unique_source_binding_and_kind_locations(self):
        relative = "projects/nanochat/queries/fixture.md"
        malformed = (
            None,
            [],
            [{"kind": "markdown", "resource": "../concepts/code-backed.md", "start_line": 1, "end_line": 1}],
            [{"source_id": "missing", "kind": "markdown", "resource": "../concepts/code-backed.md", "start_line": 1, "end_line": 1}],
            [{"source_id": "code-page", "kind": "markdown", "resource": "../concepts/code-backed.md", "start_line": 2, "end_line": 1}],
            [{"source_id": "code-page", "kind": "pdf", "resource": "../concepts/code-backed.md", "page": 1}],
            [{"source_id": "code-page", "kind": "code", "resource": "../concepts/code-backed.md", "start_line": 1, "end_line": 1}],
        )
        for anchors in malformed:
            with self.subTest(anchors=anchors):
                self.rewrite(relative, lambda data, value=anchors: {**data, "anchors": value})
                self.assertIn("query.anchor", self.codes())

    def test_query_accepts_exact_markdown_pdf_and_code_anchors(self):
        relative = "projects/nanochat/queries/fixture.md"
        sources = [
            {"id": "markdown", "resource": "../concepts/code-backed.md", "title": "Code page"},
            {"id": "pdf", "resource": "../assets/fixture-paper.pdf", "title": "Fixture PDF"},
            {"id": "code", "resource": "../../code/nanochat/nanochat/gpt.py", "title": "GPT", "repository": "nanochat", "revision": NANOCHAT_COMMIT, "path": "nanochat/gpt.py"},
        ]
        anchors = [
            {"source_id": "markdown", "kind": "markdown", "resource": "../concepts/code-backed.md", "start_line": 1, "end_line": 2},
            {"source_id": "pdf", "kind": "pdf", "resource": "../assets/fixture-paper.pdf", "page": 1, "viewrect": [1, 2, 3, 4]},
            {"source_id": "code", "kind": "code", "resource": "../../code/nanochat/nanochat/gpt.py", "repository": "nanochat", "revision": NANOCHAT_COMMIT, "path": "nanochat/gpt.py", "start_line": 1, "end_line": 2},
        ]
        self.rewrite(relative, lambda data: {**data, "sources": sources, "anchors": anchors, "status": "draft", "source_state": "awaiting-source"})
        self.assertNotIn("query.anchor", self.codes())

    def test_entity_and_concept_require_creation_metadata(self):
        self.rewrite("concepts/reusable.md", lambda data: {key: value for key, value in data.items() if key != "created"})
        self.assertIn("creation.metadata", self.codes())

    def test_forbidden_legacy_layout_and_runtime_state_are_reported(self):
        (self.root / "revisions").mkdir()
        path = self.root / ".llm_wiki/index.sqlite"
        path.parent.mkdir()
        path.write_bytes(b"sqlite")
        codes = self.codes(FakeGitState(tracked=True))
        self.assertIn("layout.forbidden", codes)
        self.assertIn("forbidden.runtime-state", codes)

    def test_ignored_runtime_state_and_empty_absent_assets_are_valid(self):
        runtime = self.root / ".llm_wiki/agent/selection.json"
        runtime.parent.mkdir(parents=True)
        runtime.write_text("{}\n", encoding="utf-8")
        (self.root / "projects/nanochat/raw/fixture-paper.md").unlink()
        (self.root / "projects/nanochat/assets/fixture-paper.pdf").unlink()
        (self.root / "projects/nanochat/assets").rmdir()
        codes = self.codes(FakeGitState(tracked=False))
        self.assertNotIn("forbidden.runtime-state", codes)
        self.assertNotIn("workbench.missing", codes)
        project_codes = {
            issue.code
            for issue in validate_vault(
                self.root / "projects/nanochat",
                git_state=FakeGitState(tracked=False),
            )
        }
        self.assertNotIn("layout.missing", project_codes)


if __name__ == "__main__":
    unittest.main()
