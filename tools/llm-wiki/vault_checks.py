from __future__ import annotations

import os
import math
import re
import subprocess
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path, PurePosixPath
from typing import Literal, Protocol
from urllib.parse import urlparse

from rebuild_indexes import INDEX_FILE, LEGACY_INDEX_FILE, LOG_FILE, LEGACY_LOG_FILE, IndexBuildError, build_indexes, owned_directories
from vaultlib import (
    ALLOWED_STATUSES,
    RemoteIdentityError,
    markdown_targets,
    normalize_git_remote,
    parse_frontmatter,
    resolve_local_target,
    sha256_bytes,
    strip_fenced_code_blocks,
)

LAYERS = frozenset({"okf-base", "karpathy-vault-v1", "project-policy"})
HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")
HEX_GIT_OID = re.compile(r"^[0-9a-f]{40}$")
ACTOR = re.compile(r"^(?:human:[^\s]+|process:[^\s]+|[A-Za-z0-9_.-]+/[A-Za-z0-9_.:+-]+)$")
LOG_EVENT_HEADING = re.compile(
    r"^## \[(\d{4}-\d{2}-\d{2})\] (learned|changed|maintained) \| (\S.*)$",
    re.MULTILINE,
)
TAG_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
TAG_HEADING = re.compile(r"^## ([a-z0-9]+(?:-[a-z0-9]+)*)$", re.MULTILINE)
FOOTNOTE_REFERENCE = re.compile(r"\[\^([A-Za-z0-9_.:-]+)\](?!:)")
FOOTNOTE_DEFINITION = re.compile(r"^\[\^([A-Za-z0-9_.:-]+)\]:", re.MULTILINE)
BINARY_SUFFIXES = frozenset({".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".zip", ".tar", ".gz"})
BINARY_MEDIA_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".zip": "application/zip",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
}
WIKI_COLLECTIONS = ("summaries", "concepts", "comparisons", "entities", "queries")
ROOT_COLLECTIONS = ("playbooks",)
ROOT_EVIDENCE_DIRECTORIES = ("raw",)
WORKBENCH_DIRECTORIES = (
    "inbox", "raw", "assets", "tasks", "scratch", "summaries", "concepts",
    "entities", "playbooks", "comparisons", "queries", "output",
)
REQUIRED_FILES = (".gitattributes", ".gitignore", "README.md", "SCHEMA.md", "TAGS.md", "AGENTS.md", INDEX_FILE, LOG_FILE)
PROJECT_REQUIRED_FILES = (".gitattributes", ".gitignore", "README.md", "SCHEMA.md", "TAGS.md", "AGENTS.md", INDEX_FILE, LOG_FILE)
TEMPLATE_FILES = (
    "_index.md.tmpl", "_log.md.tmpl",
    "daily.md.tmpl", "concept.md.tmpl", "entity.md.tmpl",
    "comparison.md.tmpl", "query.md.tmpl", "summary.md.tmpl",
    "playbook.md.tmpl", "project-card.md.tmpl", "vault-card.md.tmpl",
    "task.md.tmpl", "raw-source.md.tmpl",
)
TAGLESS_TEMPLATE_FILES = frozenset({"_index.md.tmpl", "_log.md.tmpl"})
TAGGED_TEMPLATE_FILES = frozenset(TEMPLATE_FILES) - TAGLESS_TEMPLATE_FILES
DURABLE_TEMPLATE_FILES = frozenset({"summary.md.tmpl", "concept.md.tmpl", "entity.md.tmpl", "comparison.md.tmpl", "query.md.tmpl"})
ROOT_TYPES = {
    "README.md": "Reference",
    "SCHEMA.md": "Reference",
    "TAGS.md": "Reference",
    "AGENTS.md": "Playbook",
    "CLAUDE.md": "Playbook",
}
UNTAGGED_ROOT_FILES = frozenset(ROOT_TYPES)
COMPILED_COLLECTION_TYPES = {
    "summaries": "Summary", "concepts": "Concept", "entities": "Entity",
    "playbooks": "Playbook", "comparisons": "Comparison", "queries": "Query",
}
RELATION_KINDS = frozenset({
    "references", "depends-on", "supported-by", "contrasts-with",
    "extends", "supersedes", "applies-to", "example-of",
})
DURABLE_KNOWLEDGE_TYPES = frozenset({"Summary", "Concept", "Entity", "Comparison", "Query"})
REVIEW_INTERVALS = (1, 3, 7, 14, 30, 60, 90)
DAILY_MARKERS = (
    ("<!-- human:goals:start -->", "<!-- human:goals:end -->"),
    ("<!-- llm-wiki:reviews:start -->", "<!-- llm-wiki:reviews:end -->"),
    ("<!-- llm-wiki:learned:start -->", "<!-- llm-wiki:learned:end -->"),
    ("<!-- llm-wiki:review-plan:start -->", "<!-- llm-wiki:review-plan:end -->"),
    ("<!-- human:notes:start -->", "<!-- human:notes:end -->"),
)


@dataclass(frozen=True, order=True)
class Issue:
    layer: str
    code: str
    path: str
    message: str
    severity: Literal["error", "warning"] = "error"


@dataclass(frozen=True)
class SourceBindingState:
    kind: Literal["missing", "in-place", "symlink", "broken-symlink", "non-git"]
    remote: str | None = None
    revision: str | None = None


class GitStateReader(Protocol):
    def source_binding(self, path: Path, vcs: str = "git") -> SourceBindingState: ...
    def source_blob(self, path: Path, revision: str, repository_path: str) -> bytes | None: ...
    def lfs_filter(self, path: Path) -> str | None: ...
    def is_tracked(self, path: Path) -> bool: ...


class RealGitState:
    def __init__(self, vault_root: Path) -> None:
        self.vault_root = vault_root.resolve()
        root = self._run(["git", "-C", str(vault_root), "rev-parse", "--show-toplevel"])
        self.repository_root = Path(root).resolve() if root else vault_root.parent.resolve()

    @staticmethod
    def _run(arguments: list[str]) -> str | None:
        try:
            result = subprocess.run(arguments, check=True, capture_output=True, text=True)
        except (OSError, subprocess.CalledProcessError):
            return None
        return result.stdout.strip()

    def source_binding(self, path: Path, vcs: str = "git") -> SourceBindingState:
        if path.is_symlink() and not path.exists():
            return SourceBindingState("broken-symlink")
        if not path.exists():
            return SourceBindingState("missing")
        kind: Literal["in-place", "symlink"] = "symlink" if path.is_symlink() else "in-place"
        if not path.is_dir():
            return SourceBindingState("non-git")
        if vcs == "svn":
            remote = self._run(["svn", "info", "--show-item", "url", str(path)])
            revision = self._run(["svn", "info", "--show-item", "revision", str(path)])
            return SourceBindingState(kind, remote=remote, revision=revision) if remote and revision else SourceBindingState("non-git")
        if vcs == "p4":
            output = self._run(["p4", "-d", str(path), "-ztag", "where", str(path / "...")])
            depot = next((line.removeprefix("... depotFile ") for line in (output or "").splitlines() if line.startswith("... depotFile ")), None)
            return SourceBindingState(kind, remote=depot, revision="workspace") if depot else SourceBindingState("non-git")
        if self._run(["git", "-C", str(path), "rev-parse", "--is-inside-work-tree"]) != "true":
            return SourceBindingState("non-git")
        return SourceBindingState(
            kind,
            remote=self._run(["git", "-C", str(path), "remote", "get-url", "origin"]),
            revision=self._run(["git", "-C", str(path), "rev-parse", "HEAD"]),
        )

    def source_blob(self, path: Path, revision: str, repository_path: str) -> bytes | None:
        if not HEX_GIT_OID.fullmatch(revision) or Path(repository_path).is_absolute() or ".." in Path(repository_path).parts:
            return None
        try:
            result = subprocess.run(
                ["git", "-C", str(path), "show", f"{revision}:{repository_path}"],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
            )
        except (OSError, subprocess.CalledProcessError):
            return None
        return result.stdout

    def lfs_filter(self, path: Path) -> str | None:
        try:
            relative = path.resolve().relative_to(self.repository_root).as_posix()
        except ValueError:
            return None
        output = self._run(["git", "-C", str(self.repository_root), "check-attr", "filter", "--", relative])
        if not output:
            return None
        value = output.rsplit(":", 1)[-1].strip()
        return None if value in {"unspecified", "unset"} else value

    def is_tracked(self, path: Path) -> bool:
        try:
            relative = path.resolve().relative_to(self.repository_root).as_posix()
        except ValueError:
            return False
        return bool(self._run(["git", "-C", str(self.repository_root), "ls-files", "--", relative]))


def _relative(root: Path, path: Path) -> str:
    try:
        return path.absolute().relative_to(root.absolute()).as_posix()
    except ValueError:
        return path.as_posix()


def _issue(
    layer: str,
    code: str,
    root: Path,
    path: Path,
    message: str,
    *,
    severity: Literal["error", "warning"] = "error",
) -> Issue:
    return Issue(layer, code, _relative(root, path), message, severity)


def _iso_datetime(value: object) -> bool:
    if not isinstance(value, str) or "T" not in value:
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def _is_url(value: str) -> bool:
    return urlparse(value).scheme.lower() in {"http", "https"}


def _is_portable_agent_adapter(relative: Path) -> bool:
    parts = relative.parts
    if not parts or parts[0] not in {".claude", ".codex", ".cursor"}:
        return False
    if len(parts) == 1:
        return True
    if parts[0] in {".claude", ".codex"}:
        return (
            parts[1] == "skills"
            and (
                len(parts) in {2, 3}
                or (len(parts) == 4 and parts[3] == "SKILL.md")
            )
        )
    if parts[1] == "skills":
        return (
            len(parts) in {2, 3}
            or (len(parts) == 4 and parts[3] == "SKILL.md")
        )
    if parts[1] == "commands":
        return len(parts) == 2 or (len(parts) == 3 and relative.suffix == ".md")
    if parts[1] == "rules":
        return len(parts) == 2 or (len(parts) == 3 and parts[2] == "vault-workflow.mdc")
    return False


def _walk(root: Path, *, hidden: bool = False) -> tuple[Path, ...]:
    paths: list[Path] = []
    for current, directories, files in os.walk(root, followlinks=False):
        current_path = Path(current)
        relative = current_path.relative_to(root)
        if relative.parts[:2] in {("projects", "code"), ("vaults", "bindings")} or "templates" in relative.parts:
            directories[:] = []
            continue
        directories[:] = [
            name for name in directories
            if name != "__pycache__" and (hidden or not name.startswith("."))
        ]
        paths.extend(current_path / name for name in directories)
        paths.extend(current_path / name for name in files if hidden or not name.startswith("."))
    return tuple(paths)


def _markdown_files(root: Path) -> tuple[Path, ...]:
    return tuple(sorted(path for path in _walk(root) if path.is_file() and path.suffix.lower() == ".md"))


def _concept_files(root: Path) -> tuple[Path, ...]:
    return tuple(path for path in _markdown_files(root) if path.name not in {INDEX_FILE, LEGACY_INDEX_FILE, LOG_FILE, LEGACY_LOG_FILE})


def _read(root: Path, path: Path, *, code: str = "okf.frontmatter"):
    try:
        return parse_frontmatter(path.read_text(encoding="utf-8"), source=path), []
    except (OSError, ValueError) as error:
        return None, [_issue("okf-base", code, root, path, str(error))]


def _is_project_vault(root: Path) -> bool:
    return not ((root / "projects").is_dir() and (root / "wiki").is_dir())


def check_layout(root: Path, state: GitStateReader) -> list[Issue]:
    issues: list[Issue] = []
    project_vault = _is_project_vault(root)
    for relative in PROJECT_REQUIRED_FILES if project_vault else REQUIRED_FILES:
        path = root / relative
        if not path.is_file():
            issues.append(_issue("karpathy-vault-v1", "layout.missing", root, path, f"required file is missing: {relative}"))
    required_directories = (
        tuple(name for name in WORKBENCH_DIRECTORIES if name != "assets")
        if project_vault
        else (
            "projects", "vaults", "wiki", *(f"wiki/{name}" for name in (*WIKI_COLLECTIONS, "daily")),
            *ROOT_COLLECTIONS, *ROOT_EVIDENCE_DIRECTORIES,
            "inbox", "tasks", "scratch", "output", "templates",
        )
    )
    for relative in required_directories:
        path = root / relative
        if not path.is_dir():
            issues.append(_issue("karpathy-vault-v1", "layout.missing", root, path, f"required directory is missing: {relative}"))
    if not project_vault:
        for filename in TEMPLATE_FILES:
            path = root / "templates" / filename
            if not path.is_file():
                issues.append(_issue("karpathy-vault-v1", "template.missing", root, path, f"required template is missing: {filename}"))
                continue
            declares_tags = re.search(r"^tags:", path.read_text(encoding="utf-8"), re.MULTILINE) is not None
            if filename in TAGLESS_TEMPLATE_FILES and declares_tags:
                issues.append(_issue("project-policy", "template.tags", root, path, "operational and navigation templates must be tagless"))
            if filename in TAGGED_TEMPLATE_FILES and not declares_tags:
                issues.append(_issue("project-policy", "template.tags", root, path, "substantive content templates must require canonical registered tags"))
            if filename in DURABLE_TEMPLATE_FILES:
                text = path.read_text(encoding="utf-8")
                required_fragments = (
                    'sources: [{"id": "{{source_id}}", "resource": "{{relative_path_or_url}}", "title": "{{source_title}}"}]',
                    'relations: [{"target": "{{wiki_root_relative_markdown_target}}", "kind": "{{allowed_relation_kind}}", "caption": "{{direct_caption_under_160_code_points}}"}]',
                )
                if any(fragment not in text for fragment in required_fragments):
                    issues.append(_issue("project-policy", "template.fields", root, path, "durable templates must demonstrate complete JSON-flow source and relation items"))
    forbidden_layouts = (
        "revisions", "raw/assets", "projects/repositories.yaml",
        *(name for name in WIKI_COLLECTIONS),
    )
    for relative in forbidden_layouts:
        path = root / relative
        if path.exists():
            issues.append(_issue("project-policy", "layout.forbidden", root, path, f"legacy layout is forbidden: {relative}"))
    for path in _walk(root):
        if path.name in {LEGACY_INDEX_FILE, LEGACY_LOG_FILE}:
            issues.append(_issue("project-policy", "layout.forbidden", root, path, f"legacy {path.name} is forbidden; use {INDEX_FILE if path.name == LEGACY_INDEX_FILE else LOG_FILE}"))
        if path.name in {INDEX_FILE, LOG_FILE} and path.is_symlink():
            issues.append(_issue("project-policy", "layout.forbidden", root, path, f"{path.name} must be a regular canonical file, not a symlink"))
    for path in _walk(root, hidden=True):
        relative = path.relative_to(root)
        if (
            relative.parts
            and relative.parts[0] in {".cursor", ".codex", ".claude"}
            and state.is_tracked(path)
            and not _is_portable_agent_adapter(relative)
        ):
            issues.append(_issue("karpathy-vault-v1", "forbidden.runtime-state", root, path, "only generated portable agent adapters may be committed under host directories"))
        elif path.is_dir() and path.name in {".llm_wiki", ".omc"} and state.is_tracked(path):
            issues.append(_issue("karpathy-vault-v1", "forbidden.runtime-state", root, path, "runtime/editor state must not be committed"))
        if path.is_file() and any(path.name.endswith(suffix) for suffix in (".sqlite", ".sqlite-shm", ".sqlite-wal")) and state.is_tracked(path):
            issues.append(_issue("karpathy-vault-v1", "forbidden.runtime-state", root, path, "database state is outside the vault"))
    repository_root = root.parent
    if not project_vault and (repository_root / ".gitmodules").exists():
        issues.append(_issue("project-policy", "layout.forbidden", root, repository_root / ".gitmodules", "submodules are forbidden for project sources"))
    return issues


def check_indexes(root: Path, _state: GitStateReader) -> list[Issue]:
    issues: list[Issue] = []
    for directory in owned_directories(root):
        index = directory / INDEX_FILE
        if not index.is_file():
            issues.append(_issue("okf-base", "index.missing", root, index, "every owned directory requires _index.md"))
    asset_roots = (root / "assets",)
    for assets in asset_roots:
        if (assets / INDEX_FILE).exists():
            issues.append(_issue("project-policy", "assets.index", root, assets / INDEX_FILE, "assets are opaque and must not have an index"))
    try:
        expected = build_indexes(root)
    except IndexBuildError as error:
        return issues + [_issue("okf-base", "index.build", root, root, str(error))]
    for path, text in expected.items():
        if not path.is_file():
            issues.append(_issue("okf-base", "index.missing", root, path, "every owned directory requires _index.md"))
        elif path.read_text(encoding="utf-8") != text:
            issues.append(_issue("karpathy-vault-v1", "index.stale", root, path, "index differs from deterministic output"))
    root_index = root / INDEX_FILE
    if root_index.is_file():
        document, read_issues = _read(root, root_index, code="index.frontmatter")
        issues.extend(read_issues)
        if document and document.metadata != {"okf_version": "0.2"}:
            issues.append(_issue("okf-base", "index.frontmatter", root, root_index, 'root index must contain only okf_version: "0.2"'))
    for path in expected:
        if path != root_index and path.is_file() and path.read_text(encoding="utf-8").startswith("---\n"):
            issues.append(_issue("okf-base", "index.frontmatter", root, path, "nested indexes must be frontmatter-free"))
    return issues


def check_tag_registry(root: Path, _state: GitStateReader) -> list[Issue]:
    issues: list[Issue] = []
    registry_path = root / "TAGS.md"
    if not registry_path.is_file():
        return issues
    registry, read_issues = _read(root, registry_path)
    issues.extend(read_issues)
    if not registry:
        return issues

    matches = tuple(TAG_HEADING.finditer(registry.body))
    canonical = [match.group(1) for match in matches]
    canonical_set = set(canonical)
    if not canonical or len(canonical) != len(canonical_set):
        issues.append(_issue("project-policy", "tag.registry", root, registry_path, "TAGS.md requires unique canonical tag headings"))
    section_ends = [match.start() for match in matches[1:]] + [len(registry.body)]
    for match, end in zip(matches, section_ends):
        section = registry.body[match.end():end]
        prose = [
            line.strip()
            for line in section.splitlines()
            if line.strip() and not line.lstrip().startswith("-")
        ]
        if not prose:
            issues.append(_issue("project-policy", "tag.registry", root, registry_path, f"tag {match.group(1)} requires a prose description"))

    for path in _concept_files(root):
        document, page_issues = _read(root, path)
        issues.extend(page_issues)
        if not document:
            continue
        relative = path.relative_to(root)
        if len(relative.parts) == 1 and path.name in UNTAGGED_ROOT_FILES:
            if "tags" in document.metadata:
                issues.append(_issue("project-policy", "tag.operational", root, path, "root operational and navigation documents must not declare tags"))
            continue
        if "tags" not in document.metadata:
            issues.append(_issue("project-policy", "tag.required", root, path, "substantive content pages require registered tags"))
            continue
        tags = document.metadata.get("tags")
        if (
            not isinstance(tags, list)
            or len(tags) != len(set(str(tag) for tag in tags))
            or any(not isinstance(tag, str) or TAG_NAME.fullmatch(tag) is None for tag in tags)
        ):
            issues.append(_issue("project-policy", "tag.metadata", root, path, "tags must be a unique list of lowercase kebab-case names"))
            continue
        for tag in tags:
            if tag in canonical_set:
                continue
            issues.append(_issue("project-policy", "tag.unknown", root, path, f"tag {tag} is not registered in TAGS.md", severity="warning"))
    return issues


def check_okf_and_profile(root: Path, _state: GitStateReader) -> list[Issue]:
    issues: list[Issue] = []
    project_vault = _is_project_vault(root)
    for path in _concept_files(root):
        document, read_issues = _read(root, path)
        issues.extend(read_issues)
        if not document:
            continue
        data = document.metadata
        page_type = data.get("type")
        if not isinstance(page_type, str) or not page_type.strip():
            issues.append(_issue("okf-base", "okf.type", root, path, "concept requires a nonempty type"))
            continue
        for key in ("title", "description"):
            if not isinstance(data.get(key), str) or not str(data[key]).strip():
                issues.append(_issue("karpathy-vault-v1", f"page.{key}", root, path, f"page requires nonempty {key}"))
        if data.get("status") not in ALLOWED_STATUSES:
            issues.append(_issue("karpathy-vault-v1", "page.status", root, path, "status must be draft, stable, or deprecated"))
        generated = data.get("generated")
        if not isinstance(generated, dict) or not ACTOR.fullmatch(str(generated.get("by", ""))) or not _iso_datetime(generated.get("at")):
            issues.append(_issue("karpathy-vault-v1", "page.generated", root, path, "generated requires a conventional actor and ISO timestamp"))
        verified = data.get("verified")
        if verified is not None:
            verification_events = [verified] if isinstance(verified, dict) else verified
            valid_verified = (
                isinstance(verification_events, list)
                and bool(verification_events)
                and all(
                    isinstance(event, dict)
                    and ACTOR.fullmatch(str(event.get("by", ""))) is not None
                    and _iso_datetime(event.get("at"))
                    for event in verification_events
                )
            )
            if not valid_verified:
                issues.append(_issue("okf-base", "verification.metadata", root, path, "verified must contain one or more {by, at} events using OKF actors and ISO timestamps"))
        relative = path.relative_to(root)
        expected_type = ROOT_TYPES.get(path.name) if len(relative.parts) == 1 else None
        if len(relative.parts) >= 2:
            if project_vault and relative.parts[0] in COMPILED_COLLECTION_TYPES:
                expected_type = COMPILED_COLLECTION_TYPES[relative.parts[0]]
            elif not project_vault and relative.parts[0] == "playbooks":
                expected_type = COMPILED_COLLECTION_TYPES[relative.parts[0]]
            elif not project_vault and len(relative.parts) >= 3 and relative.parts[:2] == ("wiki", "summaries"):
                expected_type = "Summary"
            elif not project_vault and len(relative.parts) >= 3 and relative.parts[:2] == ("wiki", "concepts"):
                expected_type = "Concept"
            elif not project_vault and len(relative.parts) >= 3 and relative.parts[:2] == ("wiki", "entities"):
                expected_type = "Entity"
            elif not project_vault and len(relative.parts) >= 3 and relative.parts[:2] == ("wiki", "comparisons"):
                expected_type = "Comparison"
            elif not project_vault and len(relative.parts) >= 3 and relative.parts[:2] == ("wiki", "queries"):
                expected_type = "Query"
            elif not project_vault and len(relative.parts) == 3 and relative.parts[:2] == ("wiki", "daily"):
                expected_type = "Daily Note"
            elif len(relative.parts) == 2 and relative.parts[0] == "projects" and relative.suffix == ".md":
                expected_type = "Software Project"
            elif len(relative.parts) == 2 and relative.parts[0] == "vaults" and relative.suffix == ".md":
                expected_type = "Knowledge Vault"
            elif len(relative.parts) == 2 and relative.parts[0] == "raw":
                expected_type = "Paper"
        if expected_type and page_type != expected_type:
            issues.append(_issue("project-policy", "placement.type", root, path, f"this path requires type {expected_type}"))
        if not project_vault and len(relative.parts) >= 3 and relative.parts[0] == "wiki" and relative.parts[1] in WIKI_COLLECTIONS and data.get("scope") not in {"vault", "cross-project"}:
            issues.append(_issue("project-policy", "placement.scope", root, path, "root compiled pages require scope: vault or cross-project"))
        if project_vault and len(relative.parts) >= 2 and relative.parts[0] in COMPILED_COLLECTION_TYPES and data.get("code_scope") is not True:
            issues.append(_issue("project-policy", "placement.code-scope", root, path, "code-vault compiled pages require code_scope: true"))
        if page_type in {"Concept", "Entity"}:
            created = data.get("created")
            if not isinstance(created, dict) or not ACTOR.fullmatch(str(created.get("by", ""))) or not _iso_datetime(created.get("at")):
                issues.append(_issue("project-policy", "creation.metadata", root, path, "Concept and Entity pages require created.by and created.at"))
        if page_type in DURABLE_KNOWLEDGE_TYPES:
            conflicts = data.get("conflicts")
            has_section = "contradictions" in {
                match.group(1).strip().lower()
                for match in re.finditer(r"^## (.+)$", document.body, re.MULTILINE)
            }
            if conflicts is None:
                if has_section:
                    issues.append(_issue("project-policy", "conflict.metadata", root, path, "a Contradictions section requires nonempty conflicts metadata"))
            else:
                valid_conflicts = (
                    isinstance(conflicts, list)
                    and bool(conflicts)
                    and all(isinstance(item, str) and item.strip() for item in conflicts)
                    and len(conflicts) == len(set(conflicts))
                )
                if not valid_conflicts:
                    issues.append(_issue("project-policy", "conflict.metadata", root, path, "conflicts, when present, must be a nonempty unique string list"))
                elif not has_section:
                    issues.append(_issue("project-policy", "conflict.section", root, path, "nonempty conflicts metadata requires a Contradictions section"))
    return issues


def check_registry_and_sources(root: Path, state: GitStateReader) -> list[Issue]:
    if _is_project_vault(root):
        return []
    issues: list[Issue] = []
    ignore_file = root / ".gitignore"
    ignore_lines = {
        line.strip()
        for line in ignore_file.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    } if ignore_file.is_file() else set()
    if "projects/code/" not in ignore_lines and "/projects/code/" not in ignore_lines:
        issues.append(_issue("project-policy", "source.ignore", root, ignore_file, "projects/code/ must be ignored by the vault repository"))
    cards: dict[str, tuple[Path, dict[str, object]]] = {}
    for card in sorted((root / "projects").glob("*.md")):
        if card.name == INDEX_FILE:
            continue
        document, read_issues = _read(root, card)
        issues.extend(read_issues)
        if not document:
            continue
        data = document.metadata
        project_id = data.get("project_id")
        required = ("vcs", "repository_url", "tracked_ref", "observed_revision", "observed_at", "project_status", "ongoing_change")
        if (
            not isinstance(project_id, str)
            or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", project_id)
            or card.stem != project_id
            or data.get("type") != "Software Project"
            or any(not isinstance(data.get(key), str) or not str(data[key]).strip() for key in required)
            or data.get("vcs") not in {"git", "p4", "svn"}
            or not _iso_datetime(data.get("observed_at"))
        ):
            issues.append(_issue("project-policy", "project.card", root, card, "project card requires canonical ID, VCS identity, tracked ref, observed revision/time, status, and ongoing change"))
            continue
        forbidden = {"local_path", "code_path", "vault_path", "workspace", "binding_state", "studied_revision", "studied_at", "default_ref"}
        if forbidden.intersection(data):
            issues.append(_issue("project-policy", "project.card-local", root, card, "project card must not store local or legacy binding fields"))
        if project_id in cards:
            issues.append(_issue("project-policy", "project.duplicate", root, card, f"duplicate project ID: {project_id}"))
        cards[project_id] = (card, data)
    registered_sources = {f"projects/code/{project_id}" for project_id in cards}
    for source in root.glob("projects/code/*"):
        if source.relative_to(root).as_posix() not in registered_sources:
            issues.append(_issue("project-policy", "source.unregistered", root, source, "code binding has no matching project card"))
    for project_id, (card, data) in cards.items():
        source_path = root / "projects" / "code" / project_id
        vcs = str(data.get("vcs"))
        source_state = state.source_binding(source_path, vcs)
        if source_state.kind == "missing":
            continue
        valid = source_state.kind in {"in-place", "symlink"}
        if valid and vcs == "git":
            try:
                valid = bool(source_state.remote and source_state.revision) and normalize_git_remote(source_state.remote or "") == normalize_git_remote(str(data["repository_url"]))
            except RemoteIdentityError:
                valid = False
        elif valid and vcs in {"p4", "svn"}:
            valid = bool(source_state.remote) and str(source_state.remote).rstrip("/") == str(data["repository_url"]).rstrip("/")
        if not valid:
            issues.append(_issue("project-policy", "source.binding", root, source_path, f"derived binding is {source_state.kind} or has the wrong VCS identity"))
    return issues


def _portable_vault_path(value: object, *, markdown: bool = False) -> bool:
    if not isinstance(value, str) or not value or value.startswith("/") or "\\" in value:
        return False
    path = PurePosixPath(value)
    return (
        not path.is_absolute()
        and all(part not in {"", ".", ".."} for part in path.parts)
        and (not markdown or path.suffix.lower() == ".md")
    )


def _contained_existing_path(root: Path, relative: str, *, directory: bool) -> bool:
    candidate = root / relative
    try:
        resolved_root = root.resolve(strict=True)
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(resolved_root)
    except (OSError, ValueError):
        return False
    return resolved.is_dir() if directory else resolved.is_file()


def check_vault_registry(root: Path, _state: GitStateReader) -> list[Issue]:
    if _is_project_vault(root):
        return []
    issues: list[Issue] = []
    ignore_file = root / ".gitignore"
    ignore_lines = {
        line.strip()
        for line in ignore_file.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    } if ignore_file.is_file() else set()
    if "vaults/bindings/" not in ignore_lines and "/vaults/bindings/" not in ignore_lines:
        issues.append(_issue("project-policy", "vault.ignore", root, ignore_file, "vaults/bindings/ must be ignored by the vault repository"))

    cards: dict[str, tuple[Path, dict[str, object]]] = {}
    vaults_root = root / "vaults"
    for card in sorted(vaults_root.glob("*.md")):
        if card.name == INDEX_FILE:
            continue
        document, read_issues = _read(root, card)
        issues.extend(read_issues)
        if not document:
            continue
        data = document.metadata
        vault_id = data.get("vault_id")
        required_strings = (
            "repository_url", "tracked_ref", "observed_revision",
            "observed_at", "ownership", "entrypoint",
        )
        search_roots = data.get("search_roots")
        valid_roots = (
            isinstance(search_roots, list)
            and bool(search_roots)
            and len(search_roots) == len(set(str(item) for item in search_roots))
            and all(_portable_vault_path(item) for item in search_roots)
        )
        valid_card = (
            isinstance(vault_id, str)
            and re.fullmatch(r"[a-z0-9][a-z0-9-]*", vault_id) is not None
            and card.stem == vault_id
            and data.get("type") == "Knowledge Vault"
            and all(isinstance(data.get(key), str) and str(data[key]).strip() for key in required_strings)
            and data.get("vault_status") in {"active", "reference"}
            and _iso_datetime(data.get("observed_at"))
            and _portable_vault_path(data.get("entrypoint"), markdown=True)
            and valid_roots
        )
        if not valid_card:
            issues.append(_issue("project-policy", "vault.card", root, card, "Knowledge Vault card requires a canonical ID and identity, tracked ref, observed revision/time, active/reference status, ownership, contained Markdown entrypoint, and contained search roots"))
            continue
        forbidden = {
            "local_path", "vault_path", "binding_path", "workspace",
            "workspace_path", "checkout_path", "code_path", "binding_state",
        }
        if forbidden.intersection(data):
            issues.append(_issue("project-policy", "vault.card-local", root, card, "Knowledge Vault card must not store a local path or device binding state"))
        if vault_id in cards:
            issues.append(_issue("project-policy", "vault.duplicate", root, card, f"duplicate vault ID: {vault_id}"))
        cards[vault_id] = (card, data)

    bindings_root = vaults_root / "bindings"
    registered = set(cards)
    if bindings_root.is_dir():
        for binding in bindings_root.iterdir():
            if binding.name not in registered:
                issues.append(_issue("project-policy", "vault.unregistered", root, binding, "vault binding has no matching Knowledge Vault card"))
    for vault_id, (card, data) in cards.items():
        binding = bindings_root / vault_id
        if binding.is_symlink() and not binding.exists():
            issues.append(_issue("project-policy", "vault.binding", root, binding, "vault binding is a broken symlink"))
            continue
        if not binding.exists():
            continue
        if not binding.is_dir():
            issues.append(_issue("project-policy", "vault.binding", root, binding, "vault binding must be a directory or directory symlink"))
            continue
        entrypoint = str(data["entrypoint"])
        if not _contained_existing_path(binding, entrypoint, directory=False):
            issues.append(_issue("project-policy", "vault.entrypoint", root, card, "bound vault entrypoint must exist and remain contained in the bound vault"))
        for search_root in data["search_roots"]:
            if not _contained_existing_path(binding, str(search_root), directory=True):
                issues.append(_issue("project-policy", "vault.search-root", root, card, f"bound vault search root must exist and remain contained: {search_root}"))
    return issues


def _check_evidence_root(
    root: Path,
    evidence_root: Path,
    state: GitStateReader,
) -> list[Issue]:
    issues: list[Issue] = []
    raw = evidence_root / "raw"
    if raw.is_dir():
        for child in raw.iterdir():
            if child.is_dir():
                issues.append(_issue("project-policy", "raw.flat", root, child, "raw companions must be flat"))
        for path in sorted(raw.glob("*.md")):
            if path.name == INDEX_FILE:
                continue
            document, read_issues = _read(root, path)
            issues.extend(read_issues)
            if not document:
                continue
            if sha256_bytes(document.body.encode("utf-8")) != document.metadata.get("sha256"):
                issues.append(_issue("karpathy-vault-v1", "raw.body-hash", root, path, "raw body hash does not match"))
            attachment = document.metadata.get("attachment")
            required = {"resource", "role", "media_type", "bytes", "sha256"}
            resource = attachment.get("resource") if isinstance(attachment, dict) else None
            suffix = Path(resource).suffix.lower() if isinstance(resource, str) else ""
            valid_attachment = (
                isinstance(attachment, dict)
                and required.issubset(attachment)
                and isinstance(resource, str)
                and bool(resource)
                and attachment.get("role") in {"original", "derived"}
                and suffix in BINARY_MEDIA_TYPES
                and attachment.get("media_type") == BINARY_MEDIA_TYPES.get(suffix)
                and type(attachment.get("bytes")) is int
                and attachment.get("bytes", -1) >= 0
                and HEX_SHA256.fullmatch(str(attachment.get("sha256", ""))) is not None
            )
            if not valid_attachment:
                issues.append(_issue("project-policy", "raw.attachment", root, path, "attachment requires a contained binary resource, matching media type, nonnegative integer bytes, role, and lowercase SHA-256"))
                continue
            target = resolve_local_target(path, resource, root)
            expected_assets = (evidence_root / "assets").resolve()
            if target is None or not target.is_file() or target.parent.resolve() != expected_assets:
                issues.append(_issue("project-policy", "raw.attachment", root, path, "attachment must resolve directly inside the same vault scope's assets directory"))
            elif target.stat().st_size != attachment["bytes"] or sha256_bytes(target.read_bytes()) != attachment["sha256"]:
                issues.append(_issue("karpathy-vault-v1", "raw.attachment-hash", root, path, "attachment bytes or hash differ"))
    assets = evidence_root / "assets"
    if assets.is_dir():
        for child in assets.iterdir():
            if child.is_dir():
                issues.append(_issue("project-policy", "assets.flat", root, child, "assets must be flat"))
            elif child.suffix.lower() not in BINARY_SUFFIXES:
                issues.append(_issue("project-policy", "assets.binary", root, child, "assets require an allowed binary suffix"))
            elif state.lfs_filter(child) != "lfs":
                issues.append(_issue("karpathy-vault-v1", "lfs.untracked", root, child, "binary asset must be routed through Git LFS"))
    return issues


def check_workbench_raw_assets(root: Path, state: GitStateReader) -> list[Issue]:
    issues: list[Issue] = []
    issues.extend(_check_evidence_root(root, root, state))
    attributes = root / ".gitattributes"
    if attributes.is_file():
        text = attributes.read_text(encoding="utf-8")
        required_lfs = ("/assets/** filter=lfs",)
        if any(pattern not in text for pattern in required_lfs) or re.search(r"(?:\.md|code).*filter=lfs", text):
            issues.append(_issue("project-policy", "lfs.attributes", root, attributes, "LFS must cover vault assets, not Markdown or code"))
    for path in _markdown_files(root):
        if state.lfs_filter(path) == "lfs":
            issues.append(_issue("karpathy-vault-v1", "lfs.markdown", root, path, "Markdown must not be routed through LFS"))
    return issues


def _line_range(anchor: dict[str, object]) -> bool:
    start = anchor.get("start_line")
    end = anchor.get("end_line")
    return type(start) is int and type(end) is int and 1 <= start <= end


def _query_anchor_valid(
    root: Path,
    page: Path,
    project_id: object,
    anchor: object,
    source_entries: dict[str, dict[str, object]],
    duplicate_source_ids: set[str],
) -> bool:
    if not isinstance(anchor, dict):
        return False
    source_id = anchor.get("source_id")
    if not isinstance(source_id, str) or source_id in duplicate_source_ids:
        return False
    source = source_entries.get(source_id)
    resource = anchor.get("resource")
    if source is None or not isinstance(resource, str) or resource != source.get("resource"):
        return False
    kind = anchor.get("kind")
    if kind == "markdown":
        target = resolve_local_target(page, resource, root)
        return target is not None and target.is_file() and target.suffix.lower() == ".md" and _line_range(anchor)
    if kind == "pdf":
        target = resolve_local_target(page, resource, root)
        page_number = anchor.get("page")
        viewrect = anchor.get("viewrect")
        text_fragment = anchor.get("text_fragment")
        exact_region = (
            isinstance(viewrect, list)
            and len(viewrect) == 4
            and all(type(value) in {int, float} and math.isfinite(value) for value in viewrect)
            and viewrect[0] >= 0
            and viewrect[1] >= 0
            and viewrect[2] > 0
            and viewrect[3] > 0
        ) or (isinstance(text_fragment, str) and bool(text_fragment.strip()))
        expected_assets = root / "assets"
        return (
            target is not None
            and target.is_file()
            and target.suffix.lower() == ".pdf"
            and target.parent.resolve() == expected_assets.resolve()
            and type(page_number) is int
            and page_number >= 1
            and exact_region
        )
    if kind == "code":
        return (
            anchor.get("repository") == source.get("repository")
            and anchor.get("revision") == source.get("revision")
            and anchor.get("path") == source.get("path")
            and isinstance(anchor.get("repository"), str)
            and (anchor.get("revision") == "same-tree" or HEX_GIT_OID.fullmatch(str(anchor.get("revision", ""))) is not None)
            and isinstance(anchor.get("path"), str)
            and bool(anchor.get("path"))
            and not Path(str(anchor.get("path"))).is_absolute()
            and ".." not in Path(str(anchor.get("path"))).parts
            and _line_range(anchor)
        )
    return False


def check_provenance_queries_links(root: Path, state: GitStateReader) -> list[Issue]:
    issues: list[Issue] = []
    project_vault = _is_project_vault(root)
    registered: dict[str, dict[str, object]] = {}
    if not project_vault:
        for card in sorted((root / "projects").glob("*.md")):
            if card.name == INDEX_FILE:
                continue
            document, _ = _read(root, card)
            project_id = document.metadata.get("project_id") if document else None
            if isinstance(project_id, str):
                registered[project_id] = document.metadata
    catalog = root
    registered_source_roots = [root / "projects" / "code" / project_id for project_id in registered]
    for path in _concept_files(root):
        document, read_issues = _read(root, path)
        issues.extend(read_issues)
        if not document:
            continue
        data, body = document.metadata, document.body
        sources = data.get("sources")
        source_ids: set[str] = set()
        source_entries: dict[str, dict[str, object]] = {}
        duplicate_source_ids: set[str] = set()
        if isinstance(sources, list):
            for source in sources:
                if not isinstance(source, dict):
                    issues.append(_issue("karpathy-vault-v1", "source.metadata", root, path, "source entries must be mappings"))
                    continue
                source_id = source.get("id")
                resource = source.get("resource")
                title = source.get("title")
                if not all(isinstance(value, str) and value.strip() for value in (source_id, resource, title)):
                    issues.append(_issue("karpathy-vault-v1", "source.metadata", root, path, "source requires id, resource, and title"))
                    continue
                normalized_source_id = str(source_id)
                if normalized_source_id in source_entries:
                    duplicate_source_ids.add(normalized_source_id)
                else:
                    source_entries[normalized_source_id] = source
                source_ids.add(normalized_source_id)
                repository_id = source.get("repository")
                if repository_id is not None:
                    revision, code_path, digest = source.get("revision"), source.get("path"), source.get("sha256")
                    safe_path = isinstance(code_path, str) and code_path and not Path(code_path).is_absolute() and ".." not in Path(code_path).parts
                    known_repository = repository_id in registered or (project_vault and isinstance(repository_id, str) and bool(repository_id))
                    valid_revision = revision == "same-tree" or HEX_GIT_OID.fullmatch(str(revision or "")) is not None
                    base_valid = known_repository and valid_revision and safe_path
                    stable_valid = data.get("status") != "stable" or HEX_SHA256.fullmatch(str(digest or ""))
                    awaiting_valid = data.get("status") != "draft" or data.get("source_state") == "awaiting-source" or HEX_SHA256.fullmatch(str(digest or ""))
                    if not base_valid or not stable_valid or not awaiting_valid:
                        issues.append(_issue("project-policy", "code.provenance", root, path, "code source requires repository, immutable revision/path, and stable hash; draft omissions require awaiting-source"))
                    elif data.get("status") == "stable" and repository_id in registered and revision != "same-tree":
                        source_root = root / "projects" / "code" / str(repository_id)
                        binding_state = state.source_binding(source_root, "git")
                        blob_reader = getattr(state, "source_blob", None)
                        blob = (
                            blob_reader(source_root, str(revision), str(code_path))
                            if callable(blob_reader) and binding_state.kind != "missing"
                            else None
                        )
                        if binding_state.kind != "missing" and (
                            blob is None or sha256_bytes(blob) != digest
                        ):
                            issues.append(_issue("project-policy", "code.hash", root, path, f"code source hash differs: {code_path}"))
                elif not _is_url(str(resource)):
                    target = resolve_local_target(path, str(resource), catalog)
                    if target is None or not target.exists():
                        issues.append(_issue("karpathy-vault-v1", "source.missing", root, path, f"source does not resolve: {resource}"))
        stripped = strip_fenced_code_blocks(body)
        references = set(FOOTNOTE_REFERENCE.findall(stripped))
        definitions = set(FOOTNOTE_DEFINITION.findall(stripped))
        if not references.issubset(source_ids) or not references.issubset(definitions):
            issues.append(_issue("karpathy-vault-v1", "source.footnote", root, path, "footnote claims must match source ids and definitions"))
        if data.get("type") == "Query":
            summary = data.get("condensed_summary")
            conversation = data.get("conversation")
            anchors = data.get("anchors")
            headings = {match.group(1).strip().lower() for match in re.finditer(r"^## (.+)$", body, re.MULTILINE)}
            required_headings = (
                {"answer", "evidence", "limitations", "related durable pages"}.issubset(headings)
                or {"answer", "evidence trail", "limits", "related pages"}.issubset(headings)
            )
            valid = (
                isinstance(summary, str) and 0 < len(summary) <= 360
                and isinstance(conversation, dict) and isinstance(conversation.get("selection_id"), str) and conversation.get("selection_id")
                and isinstance(anchors, list) and bool(anchors)
                and required_headings
            )
            if not valid:
                issues.append(_issue("project-policy", "query.contract", root, path, "Query requires condensed summary, selection id, source anchors, and answer/evidence/limitations/related sections"))
            if not isinstance(anchors, list) or not anchors or any(
                not _query_anchor_valid(
                    catalog,
                    path,
                    data.get("project"),
                    anchor,
                    source_entries,
                    duplicate_source_ids,
                )
                for anchor in anchors
            ):
                issues.append(_issue("project-policy", "query.anchor", root, path, "each Query anchor must bind a unique source_id and provide a valid Markdown, PDF, or code location"))
        link_body = body.split("## Mechanically extracted full text", 1)[0] if data.get("type") == "Paper" else body
        for target in markdown_targets(link_body):
            resolved = resolve_local_target(path, target.target, catalog)
            if resolved is not None and resolved.exists():
                continue
            if resolved is not None and any(resolved == source_root or source_root in resolved.parents for source_root in registered_source_roots):
                continue
            issues.append(_issue("okf-base", "link.missing", root, path, f"link does not resolve: {target.target}"))
        conflicts = data.get("conflicts")
        if isinstance(conflicts, list) and conflicts and data.get("status") != "draft":
            issues.append(_issue("karpathy-vault-v1", "conflict.status", root, path, "unresolved conflicts require draft status"))
    return issues


def _wiki_root(root: Path) -> Path:
    return root if _is_project_vault(root) else root / "wiki"


def _graph_pages(root: Path) -> tuple[Path, ...]:
    wiki_root = _wiki_root(root)
    if not wiki_root.is_dir():
        return ()
    allowed_roots = (
        (*WIKI_COLLECTIONS, "daily")
        if not _is_project_vault(root)
        else tuple(COMPILED_COLLECTION_TYPES) + ("daily",)
    )
    return tuple(sorted(
        path for path in wiki_root.rglob("*.md")
        if path.name != INDEX_FILE
        and path.relative_to(wiki_root).parts
        and path.relative_to(wiki_root).parts[0] in allowed_roots
        and "templates" not in path.parts
    ))


def check_relations_and_daily(root: Path, _state: GitStateReader) -> list[Issue]:
    issues: list[Issue] = []
    wiki_root = _wiki_root(root)
    query_titles: dict[str, str] = {}
    queries_root = wiki_root / "queries"
    if queries_root.is_dir():
        for query_path in queries_root.glob("*.md"):
            if query_path.name == INDEX_FILE:
                continue
            query_document, _ = _read(root, query_path)
            conversation = query_document.metadata.get("conversation") if query_document else None
            selection_id = conversation.get("selection_id") if isinstance(conversation, dict) else None
            title = query_document.metadata.get("title") if query_document else None
            if isinstance(selection_id, str) and isinstance(title, str):
                query_titles[selection_id] = title
    for path in _graph_pages(root):
        document, read_issues = _read(root, path)
        issues.extend(read_issues)
        if not document:
            continue
        relations = document.metadata.get("relations")
        if not isinstance(relations, list):
            issues.append(_issue("project-policy", "graph.relations", root, path, "graph-visible Markdown requires relations: []"))
            continue
        seen: set[tuple[str, str]] = set()
        for relation in relations:
            if not isinstance(relation, dict):
                issues.append(_issue("project-policy", "graph.relation", root, path, "relation entries must be mappings"))
                continue
            target, kind, caption = relation.get("target"), relation.get("kind"), relation.get("caption")
            valid_target = (
                isinstance(target, str)
                and target.endswith(".md")
                and not Path(target).is_absolute()
                and ".." not in Path(target).parts
                and "\\" not in target
            )
            target_path = wiki_root / str(target) if valid_target else None
            if target_path is not None:
                try:
                    target_path.resolve(strict=True).relative_to(wiki_root.resolve(strict=True))
                except (OSError, ValueError):
                    valid_target = False
            key = (str(target), str(kind))
            valid = (
                valid_target
                and kind in RELATION_KINDS
                and isinstance(caption, str)
                and 0 < len(caption) <= 160
                and target_path is not None
                and target_path.is_file()
                and target_path.resolve() != path.resolve()
                and key not in seen
            )
            if not valid:
                issues.append(_issue("project-policy", "graph.relation", root, path, "relation requires a unique contained target, allowed kind, and caption of at most 160 code points"))
            seen.add(key)

        if path.parent.name != "daily":
            continue
        date_key = path.stem
        try:
            learned_date = date.fromisoformat(date_key)
        except ValueError:
            issues.append(_issue("project-policy", "daily.filename", root, path, "daily filename must be YYYY-MM-DD.md"))
            continue
        data, body = document.metadata, document.body
        expected_dates = [(learned_date + timedelta(days=days)).isoformat() for days in REVIEW_INTERVALS]
        if (
            data.get("type") != "Daily Note"
            or data.get("date") != date_key
            or data.get("timezone") != "Asia/Shanghai"
            or data.get("review_dates") != expected_dates
        ):
            issues.append(_issue("project-policy", "daily.frontmatter", root, path, "daily metadata must match filename, Asia/Shanghai, and the fixed review schedule"))
        for start, end in DAILY_MARKERS:
            if body.count(start) != 1 or body.count(end) != 1 or body.index(start) > body.index(end):
                issues.append(_issue("project-policy", "daily.markers", root, path, f"daily note requires one ordered marker pair: {start} / {end}"))
        review_ids = re.findall(r'<!-- llm-wiki:review id="([^"]+)"', body)
        if len(review_ids) > 10 or len(review_ids) != len(set(review_ids)):
            issues.append(_issue("project-policy", "daily.reviews", root, path, "daily note permits at most ten unique review occurrences"))
        for review_id in review_ids:
            identity, separator, scheduled = review_id.rpartition("@")
            try:
                date.fromisoformat(scheduled)
            except ValueError:
                separator = ""
            prompt_type = identity.partition(":")[0]
            if not separator or not identity.partition(":")[2] or prompt_type not in {"query", "concept", "comparison", "entity", "statement"}:
                issues.append(_issue("project-policy", "daily.review-id", root, path, "review ID must combine a stable typed prompt identity and scheduled YYYY-MM-DD date"))
        answer_starts = re.findall(r'<!-- human:review-answer:start id="([^"]+)" -->', body)
        answer_ends = re.findall(r'<!-- human:review-answer:end id="([^"]+)" -->', body)
        if sorted(answer_starts) != sorted(answer_ends) or len(answer_starts) != len(set(answer_starts)):
            issues.append(_issue("project-policy", "daily.answers", root, path, "review answer markers must be uniquely paired by ID"))
        query_review_ids = {review_id for review_id in review_ids if review_id.startswith("query:")}
        if set(answer_starts) != query_review_ids:
            issues.append(_issue("project-policy", "daily.answers", root, path, "each Query review needs exactly one human answer region and other prompt types must not use one"))
        review_positions = [match.start() for match in re.finditer(r'<!-- llm-wiki:review id="', body)] + [len(body)]
        for review_id, start, end in zip(review_ids, review_positions, review_positions[1:]):
            block = body[start:end]
            selected = re.findall(r"^- \[[xX]\] Outcome: (?:Again|Hard|Good|Easy)$", block, re.MULTILINE)
            if len(selected) > 1:
                issues.append(_issue("project-policy", "daily.outcome", root, path, "a review occurrence may select at most one outcome"))
            if review_id.startswith("query:"):
                selection_id = review_id.removeprefix("query:").rpartition("@")[0]
                expected_title = query_titles.get(selection_id)
                valid_query_block = (
                    expected_title is not None
                    and f"### {expected_title}" in block
                    and any(
                        marker in block
                        for marker in (
                            "- [ ] Attempted before opening source",
                            "- [x] Attempted before opening source",
                            "- [X] Attempted before opening source",
                        )
                    )
                )
                outcome_labels = re.findall(r"^- \[[ xX]\] Outcome: (Again|Hard|Good|Easy)$", block, re.MULTILINE)
                if not valid_query_block or sorted(outcome_labels) != ["Again", "Easy", "Good", "Hard"]:
                    issues.append(_issue("project-policy", "daily.query", root, path, "Query reviews must repeat the exact title, preserve an answer region, and provide attempted plus four outcome checkboxes"))
        expected_plan = [f"- [ ] {(learned_date + timedelta(days=days)).isoformat()} (+{days})" for days in REVIEW_INTERVALS]
        if any(line not in body for line in expected_plan) or "## Carried forward" not in body:
            issues.append(_issue("project-policy", "daily.plan", root, path, "daily note requires the fixed review-plan lines and carried-forward section"))

    log = root / LOG_FILE
    if log.is_file():
        document, read_issues = _read(root, log)
        issues.extend(read_issues)
        if document:
            headings = tuple(line for line in document.body.splitlines() if line.startswith("## "))
            events = tuple(LOG_EVENT_HEADING.finditer(document.body))
            if len(events) != len(headings):
                issues.append(_issue("project-policy", "log.event", root, log, "every level-two heading must be a canonical dated log event"))
            event_dates: list[date] = []
            for event in events:
                try:
                    event_dates.append(date.fromisoformat(event.group(1)))
                except ValueError:
                    issues.append(_issue("project-policy", "log.event", root, log, "log event headings require real ISO calendar dates"))
            if event_dates != sorted(event_dates):
                issues.append(_issue("project-policy", "log.order", root, log, "append-only log events must be ordered oldest first"))
            event_starts = [event.start() for event in events] + [len(document.body)]
            labels = {"learned": "Learned", "changed": "Changed", "maintained": "Maintained"}
            for event, start, end in zip(events, event_starts, event_starts[1:]):
                bullets = re.findall(r"^- \*\*(Learned|Changed|Maintained)\*\*:", document.body[start:end], re.MULTILINE)
                if bullets != [labels[event.group(2)]]:
                    issues.append(_issue("project-policy", "log.category", root, log, "each event requires exactly one categorized bullet matching its heading kind"))
            for line in document.body.splitlines():
                if line.startswith("- ") and not re.match(r"^- \*\*(?:Learned|Changed|Maintained)\*\*:", line):
                    issues.append(_issue("project-policy", "log.category", root, log, "log bullets must begin with **Learned**, **Changed**, or **Maintained**"))
    return issues


CHECKS = (
    check_layout,
    check_indexes,
    check_tag_registry,
    check_okf_and_profile,
    check_registry_and_sources,
    check_vault_registry,
    check_workbench_raw_assets,
    check_provenance_queries_links,
    check_relations_and_daily,
)


def validate_vault(vault_root: Path, *, git_state: GitStateReader | None = None) -> tuple[Issue, ...]:
    """Return independently actionable, explicitly layered vault issues."""
    root = vault_root.absolute()
    state = git_state or RealGitState(root)
    issues: list[Issue] = []
    for check in CHECKS:
        issues.extend(check(root, state))
    return tuple(sorted(set(issues)))
