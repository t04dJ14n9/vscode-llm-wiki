import tempfile
import unittest
import sys
from contextlib import redirect_stdout
from datetime import date, timedelta
from io import StringIO
from pathlib import Path
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))

from rebuild_indexes import update_indexes
import validate_vault as validate_cli
from vault_checks import Issue, SourceBindingState, validate_vault
from vaultlib import parse_frontmatter, render_frontmatter

DURABLE_TYPES = {"Summary", "Concept", "Entity", "Comparison", "Query"}


class FakeGitState:
    def __init__(self, source=SourceBindingState("missing"), *, tracked=False, lfs=True):
        self.source = source
        self.tracked = tracked
        self.lfs = lfs

    def source_binding(self, _path: Path, _vcs: str = "git") -> SourceBindingState:
        return self.source

    def source_blob(self, _path: Path, _revision: str, _repository_path: str):
        return None

    def lfs_filter(self, path: Path):
        return "lfs" if self.lfs and path.suffix.lower() != ".md" else None

    def is_tracked(self, _path: Path) -> bool:
        return self.tracked


def metadata(page_type: str, title: str, *, relations=None, scope="vault"):
    result = {
        "type": page_type,
        "title": title,
        "description": f"Fixture {title}.",
        "tags": ["open-knowledge-format"],
        "status": "draft",
        "generated": {"by": "process:test", "at": "2026-08-24T00:00:00Z"},
    }
    if scope is not None:
        result["scope"] = scope
    if relations is not None:
        result["relations"] = relations
    if page_type in {"Concept", "Entity"}:
        result["created"] = {"by": "process:test", "at": "2026-08-24T00:00:00Z"}
    return result


class ValidateVaultTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        for relative in (
            "raw", "inbox", "output", "playbooks", "projects",
            "scratch", "tasks", "templates",
            "wiki/summaries", "wiki/concepts", "wiki/comparisons", "wiki/entities", "wiki/queries", "wiki/daily",
        ):
            (self.root / relative).mkdir(parents=True)
        (self.root / ".gitattributes").write_text("/assets/** filter=lfs diff=lfs merge=lfs -text\n", encoding="utf-8")
        (self.root / ".gitignore").write_text(".llm_wiki/\nprojects/code/\n", encoding="utf-8")
        for filename, page_type in (("README.md", "Reference"), ("SCHEMA.md", "Reference"), ("AGENTS.md", "Playbook")):
            root_metadata = metadata(page_type, filename.removesuffix(".md"))
            root_metadata.pop("tags")
            self.write_page(filename, root_metadata)
        tag_registry_metadata = metadata("Reference", "Tag registry")
        tag_registry_metadata.pop("tags")
        self.write_page("TAGS.md", tag_registry_metadata, "# Tag registry\n\n## open-knowledge-format\n\nKnowledge represented using the Open Knowledge Format.\n")
        self.write_page("_log.md", {"type": "Log", "title": "History", "description": "Fixture history."}, "# History\n")
        self.write_page("tasks/current.md", metadata("Task", "Current task"))
        self.write_page("projects/demo.md", {
            **metadata("Software Project", "Demo", scope=None),
            "project_id": "demo", "vcs": "git", "repository_url": "https://github.com/example/demo.git",
            "tracked_ref": "main", "observed_revision": "1" * 40,
            "observed_at": "2026-08-24T00:00:00Z", "project_status": "reference", "ongoing_change": "None",
        })
        self.write_page("wiki/concepts/target.md", metadata("Concept", "Target", relations=[]))
        self.write_page("wiki/concepts/source.md", metadata("Concept", "Source", relations=[{
            "target": "concepts/target.md", "kind": "depends-on", "caption": "Builds on the target concept",
        }]), "# Source\n\n[Target](target.md)\n")
        query = metadata("Query", "Why target?", relations=[{
            "target": "concepts/target.md", "kind": "references", "caption": "Reviews the target concept",
        }])
        query.update({
            "condensed_summary": "The target is useful.",
            "conversation": {"selection_id": "selection-1"},
            "sources": [{"id": "target", "resource": "../concepts/target.md", "title": "Target"}],
            "anchors": [{"source_id": "target", "kind": "markdown", "resource": "../concepts/target.md", "start_line": 1, "end_line": 1}],
        })
        self.write_page("wiki/queries/why-target.md", query, "# Why target?\n\n## Answer\n\nAnswer.\n\n## Evidence\n\nEvidence.\n\n## Limitations\n\nLimits.\n\n## Related durable pages\n\n[Target](../concepts/target.md)\n")
        self.write_daily("2026-08-24")
        tagless_templates = {"_index.md.tmpl", "_log.md.tmpl", "AGENTS.md.tmpl", "SCHEMA.md.tmpl", "TAGS.md.tmpl"}
        durable_templates = {"summary.md.tmpl", "concept.md.tmpl", "entity.md.tmpl", "comparison.md.tmpl", "query.md.tmpl"}
        for filename in (
            "_index.md.tmpl", "_log.md.tmpl", "AGENTS.md.tmpl", "SCHEMA.md.tmpl",
            "daily.md.tmpl", "concept.md.tmpl", "entity.md.tmpl",
            "comparison.md.tmpl", "query.md.tmpl", "summary.md.tmpl",
            "playbook.md.tmpl", "project-card.md.tmpl", "raw-source.md.tmpl",
            "TAGS.md.tmpl",
        ):
            if filename in tagless_templates:
                content = "{{title}}\n"
            else:
                content = "tags: {{canonical_registered_tags}}\n{{title}}\n"
            if filename in durable_templates:
                content += (
                    'sources: [{"id": "{{source_id}}", "resource": "{{relative_path_or_url}}", "title": "{{source_title}}"}]\n'
                    'relations: [{"target": "{{wiki_root_relative_markdown_target}}", "kind": "{{allowed_relation_kind}}", "caption": "{{direct_caption_under_160_code_points}}"}]\n'
                )
            (self.root / "templates" / filename).write_text(content, encoding="utf-8")
        update_indexes(self.root, check=False)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write_page(self, relative: str, values: dict, body: str | None = None):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        content = body or f"# {values.get('title', path.stem)}\n"
        path.write_text(render_frontmatter(values, content), encoding="utf-8")

    def write_daily(self, key: str):
        learned = date.fromisoformat(key)
        values = metadata("Daily Note", key, relations=[{
            "target": "queries/why-target.md", "kind": "references", "caption": f"Reviewed on {key}",
        }])
        values.update({
            "date": key,
            "timezone": "Asia/Shanghai",
            "review_dates": [(learned + timedelta(days=days)).isoformat() for days in (1, 3, 7, 14, 30, 60, 90)],
        })
        body = f"""# {key}

## Goals
<!-- human:goals:start -->
<!-- human:goals:end -->

<!-- llm-wiki:reviews:start -->
## Reviews due
<!-- llm-wiki:review id="query:selection-1@{key}" -->
### Why target?
<!-- human:review-answer:start id="query:selection-1@{key}" -->
<!-- human:review-answer:end id="query:selection-1@{key}" -->
- [ ] Attempted before opening source
- [ ] Outcome: Again
- [ ] Outcome: Hard
- [ ] Outcome: Good
- [ ] Outcome: Easy
<!-- llm-wiki:reviews:end -->

<!-- llm-wiki:learned:start -->
## Learned today
<!-- llm-wiki:learned:end -->

<!-- llm-wiki:review-plan:start -->
## Review plan
{chr(10).join(f'- [ ] {(learned + timedelta(days=days)).isoformat()} (+{days})' for days in (1, 3, 7, 14, 30, 60, 90))}
<!-- llm-wiki:review-plan:end -->

## Carried forward

No unfinished tasks.

## Notes
<!-- human:notes:start -->
<!-- human:notes:end -->
"""
        self.write_page(f"wiki/daily/{key}.md", values, body)

    def codes(self, state=None):
        return {issue.code for issue in validate_vault(self.root, git_state=state or FakeGitState())}

    def test_valid_graph_ready_catalog(self):
        self.assertEqual(validate_vault(self.root, git_state=FakeGitState()), ())

    def test_templates_and_missing_assets_are_valid(self):
        self.assertNotIn("okf.frontmatter", self.codes())
        self.assertNotIn("layout.missing", self.codes())

    def test_old_registry_and_root_collections_are_forbidden(self):
        (self.root / "projects/repositories.yaml").write_text("version: 1\n", encoding="utf-8")
        (self.root / "concepts").mkdir()
        self.assertIn("layout.forbidden", self.codes())

    def test_project_card_rejects_local_fields(self):
        path = self.root / "projects/demo.md"
        document = parse_frontmatter(path.read_text())
        values = dict(document.metadata)
        values["local_path"] = "/private/demo"
        path.write_text(render_frontmatter(values, document.body))
        self.assertIn("project.card-local", self.codes())

    def test_binding_is_derived_and_remote_checked(self):
        wrong = FakeGitState(SourceBindingState("in-place", remote="https://example.com/wrong.git", revision="1" * 40))
        self.assertIn("source.binding", self.codes(wrong))
        right = FakeGitState(SourceBindingState("symlink", remote="git@github.com:example/demo.git", revision="2" * 40))
        self.assertNotIn("source.binding", self.codes(right))

    def test_p4_and_svn_bindings_compare_portable_identity(self):
        path = self.root / "projects/demo.md"
        document = parse_frontmatter(path.read_text())
        for vcs, remote in (("p4", "//depot/demo"), ("svn", "https://svn.example.com/demo")):
            values = dict(document.metadata)
            values.update({"vcs": vcs, "repository_url": remote})
            path.write_text(render_frontmatter(values, document.body))
            state = FakeGitState(SourceBindingState("in-place", remote=remote, revision="1"))
            self.assertNotIn("source.binding", self.codes(state))
            wrong = FakeGitState(SourceBindingState("in-place", remote=f"{remote}-wrong", revision="1"))
            self.assertIn("source.binding", self.codes(wrong))

    def test_complete_template_set_is_required_but_opaque(self):
        (self.root / "templates/query.md.tmpl").unlink()
        self.assertIn("template.missing", self.codes())

    def test_template_tag_boundary_matches_published_page_policy(self):
        agents = self.root / "templates/_log.md.tmpl"
        agents.write_text("tags: [\"operations\"]\n", encoding="utf-8")
        self.assertIn("template.tags", self.codes())
        agents.write_text("{{title}}\n", encoding="utf-8")
        concept = self.root / "templates/concept.md.tmpl"
        concept.write_text("{{title}}\n", encoding="utf-8")
        self.assertIn("template.tags", self.codes())

    def test_durable_templates_document_source_and_relation_shapes(self):
        concept = self.root / "templates/concept.md.tmpl"
        concept.write_text(
            "tags: {{canonical_registered_tags}}\nsources: []\nrelations: []\n",
            encoding="utf-8",
        )
        self.assertIn("template.fields", self.codes())

    def test_relation_requires_contained_existing_unique_target(self):
        path = self.root / "wiki/concepts/source.md"
        document = parse_frontmatter(path.read_text())
        values = dict(document.metadata)
        values["relations"] = [{"target": "../outside.md", "kind": "made-up", "caption": ""}]
        path.write_text(render_frontmatter(values, document.body))
        self.assertIn("graph.relation", self.codes())

    def test_graph_visible_page_requires_relations(self):
        path = self.root / "wiki/entities/no-relations.md"
        self.write_page(str(path.relative_to(self.root)), metadata("Entity", "No relations"))
        self.assertIn("graph.relations", self.codes())

    def test_conflicts_are_optional_but_require_matching_metadata_and_section(self):
        path = self.root / "wiki/concepts/target.md"
        document = parse_frontmatter(path.read_text())
        self.assertNotIn("conflict.metadata", self.codes())
        self.assertNotIn("conflict.section", self.codes())

        values = dict(document.metadata)
        values["conflicts"] = []
        path.write_text(render_frontmatter(values, document.body))
        self.assertIn("conflict.metadata", self.codes())

        values["conflicts"] = ["A source disagrees about the mechanism"]
        path.write_text(render_frontmatter(values, document.body))
        self.assertIn("conflict.section", self.codes())

        values.pop("conflicts")
        path.write_text(render_frontmatter(values, document.body + "\n## Contradictions\n\nA source disagrees.\n"))
        codes = self.codes()
        self.assertIn("conflict.metadata", codes)

    def test_unresolved_conflicts_require_draft_status(self):
        path = self.root / "wiki/concepts/target.md"
        document = parse_frontmatter(path.read_text())
        values = dict(document.metadata)
        values.update({"status": "stable", "conflicts": ["An unresolved source disagreement"]})
        path.write_text(render_frontmatter(values, document.body + "\n## Contradictions\n\nThe sources disagree.\n"))
        self.assertIn("conflict.status", self.codes())

    def test_machine_and_human_verification_events_are_valid(self):
        path = self.root / "wiki/concepts/target.md"
        document = parse_frontmatter(path.read_text())
        values = dict(document.metadata)
        values["verified"] = {"by": "process:test-suite", "at": "2026-08-24T01:00:00Z"}
        path.write_text(render_frontmatter(values, document.body))
        self.assertNotIn("verification.metadata", self.codes())
        values["verified"] = [
            {"by": "process:test-suite", "at": "2026-08-24T01:00:00Z"},
            {"by": "human:reviewer", "at": "2026-08-24T02:00:00Z"},
        ]
        path.write_text(render_frontmatter(values, document.body))
        self.assertNotIn("verification.metadata", self.codes())

    def test_invalid_verification_event_is_rejected(self):
        path = self.root / "wiki/concepts/target.md"
        document = parse_frontmatter(path.read_text())
        values = dict(document.metadata)
        values["verified"] = [{"by": "human reviewer", "at": "yesterday"}]
        path.write_text(render_frontmatter(values, document.body))
        self.assertIn("verification.metadata", self.codes())

    def test_unknown_tags_are_advisory_warnings(self):
        path = self.root / "wiki/concepts/target.md"
        document = parse_frontmatter(path.read_text())
        values = dict(document.metadata)
        values["tags"] = ["not-registered"]
        path.write_text(render_frontmatter(values, document.body))
        issues = validate_vault(self.root, git_state=FakeGitState())
        warning_codes = {issue.code for issue in issues if issue.severity == "warning"}
        self.assertEqual(warning_codes, {"tag.unknown"})
        self.assertFalse(any(issue.code in warning_codes and issue.severity == "error" for issue in issues))

    def test_substantive_pages_require_tags(self):
        path = self.root / "wiki/concepts/target.md"
        document = parse_frontmatter(path.read_text())
        values = dict(document.metadata)
        values.pop("tags")
        path.write_text(render_frontmatter(values, document.body))
        self.assertIn("tag.required", self.codes())

    def test_root_operational_documents_must_be_tagless(self):
        path = self.root / "AGENTS.md"
        document = parse_frontmatter(path.read_text())
        values = dict(document.metadata)
        values["tags"] = ["open-knowledge-format"]
        path.write_text(render_frontmatter(values, document.body))
        self.assertIn("tag.operational", self.codes())

    def test_hidden_skill_tags_follow_the_skill_schema_not_the_vault_registry(self):
        skill = self.root / ".agents/skills/research/SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text(
            "---\nname: research\ndescription: Research workflow.\ntags: [Research, Citations]\n---\n\n# Research\n",
            encoding="utf-8",
        )
        self.assertEqual(validate_vault(self.root, git_state=FakeGitState()), ())

    def test_warning_only_validation_keeps_cli_successful(self):
        warning = Issue("project-policy", "tag.unknown", "page.md", "unknown tag", "warning")
        output = StringIO()
        with patch.object(validate_cli, "validate_vault", return_value=(warning,)), redirect_stdout(output):
            result = validate_cli.main(["--vault", str(self.root)])
        self.assertEqual(result, 0)
        self.assertIn("WARNING", output.getvalue())
        self.assertIn("vault valid with 1 warning(s)", output.getvalue())

    def test_tag_registry_requires_descriptions(self):
        path = self.root / "TAGS.md"
        document = parse_frontmatter(path.read_text())
        path.write_text(render_frontmatter(document.metadata, "# Tag registry\n\n## open-knowledge-format\n"))
        codes = self.codes()
        self.assertIn("tag.registry", codes)

    def test_daily_schedule_markers_answers_and_review_cap_are_validated(self):
        path = self.root / "wiki/daily/2026-08-24.md"
        text = path.read_text().replace("<!-- human:goals:end -->", "")
        path.write_text(text)
        codes = self.codes()
        self.assertIn("daily.markers", codes)

    def test_daily_review_ids_and_query_titles_are_validated(self):
        path = self.root / "wiki/daily/2026-08-24.md"
        text = path.read_text().replace("query:selection-1@2026-08-24", "query:selection-1@not-a-date").replace("### Why target?", "### Paraphrased title")
        path.write_text(text)
        codes = self.codes()
        self.assertIn("daily.review-id", codes)
        self.assertIn("daily.query", codes)

    def test_root_index_only_has_okf_frontmatter(self):
        self.assertEqual(parse_frontmatter((self.root / "_index.md").read_text()).metadata, {"okf_version": "0.2"})
        self.assertFalse((self.root / "wiki/_index.md").read_text().startswith("---\n"))

    def test_log_events_are_oldest_first_and_match_their_category(self):
        path = self.root / "_log.md"
        document = parse_frontmatter(path.read_text())
        body = """# History

## [2026-08-24] learned | newer event

- **Changed**: Wrong category.

## [2026-08-23] maintained | older event

- **Maintained**: Out of order.
"""
        path.write_text(render_frontmatter(document.metadata, body))
        codes = self.codes()
        self.assertIn("log.order", codes)
        self.assertIn("log.category", codes)

    def test_log_rejects_noncanonical_event_headings(self):
        path = self.root / "_log.md"
        document = parse_frontmatter(path.read_text())
        path.write_text(render_frontmatter(document.metadata, "# History\n\n## 2026-08-24\n"))
        self.assertIn("log.event", self.codes())


if __name__ == "__main__":
    unittest.main()
