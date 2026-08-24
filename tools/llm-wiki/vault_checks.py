from __future__ import annotations

import os
import math
import re
import subprocess
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Literal, Protocol
from urllib.parse import urlparse

from rebuild_indexes import INDEX_FILE, LEGACY_INDEX_FILE, LOG_FILE, LEGACY_LOG_FILE, IndexBuildError, build_indexes, owned_directories
from vaultlib import (
    ALLOWED_STATUSES,
    RepositoryBinding,
    RepositoryRegistry,
    RepositoryRegistryError,
    markdown_targets,
    normalize_git_remote,
    parse_frontmatter,
    parse_repository_registry,
    resolve_local_target,
    sha256_bytes,
    strip_fenced_code_blocks,
)

NANOCHAT_COMMIT = "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"
NANOCHAT_REPOSITORY = "https://github.com/karpathy/nanochat.git"
LAYERS = frozenset({"okf-base", "karpathy-vault-v1", "project-policy"})
HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")
HEX_GIT_OID = re.compile(r"^[0-9a-f]{40}$")
ACTOR = re.compile(r"^(?:human:[^\s]+|process:[^\s]+|[A-Za-z0-9_.-]+/[A-Za-z0-9_.:+-]+)$")
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
ROOT_COLLECTIONS = ("summaries", "concepts", "entities", "playbooks", "comparisons", "queries")
ROOT_EVIDENCE_DIRECTORIES = ("raw", "assets", "examples")
WORKBENCH_DIRECTORIES = (
    "inbox", "raw", "assets", "tasks", "scratch", "summaries", "concepts",
    "entities", "playbooks", "comparisons", "queries", "output", "examples",
)
REQUIRED_FILES = (".gitattributes", ".gitignore", "README.md", "SCHEMA.md", "AGENTS.md", INDEX_FILE, LOG_FILE, "projects/repositories.yaml")
PROJECT_REQUIRED_FILES = (".gitattributes", ".gitignore", "README.md", "SCHEMA.md", "AGENTS.md", INDEX_FILE, LOG_FILE)
ROOT_TYPES = {"README.md": "Reference", "SCHEMA.md": "Reference", "AGENTS.md": "Playbook"}
COMPILED_COLLECTION_TYPES = {
    "summaries": "Summary", "concepts": "Concept", "entities": "Entity",
    "playbooks": "Playbook", "comparisons": "Comparison", "queries": "Query",
}


@dataclass(frozen=True, order=True)
class Issue:
    layer: str
    code: str
    path: str
    message: str


@dataclass(frozen=True)
class SourceBindingState:
    kind: Literal["missing", "in-place", "symlink", "broken-symlink", "non-git"]
    remote: str | None = None
    revision: str | None = None


class GitStateReader(Protocol):
    def source_binding(self, path: Path) -> SourceBindingState: ...
    def source_blob(self, path: Path, revision: str, repository_path: str) -> bytes | None: ...
    def lfs_filter(self, path: Path) -> str | None: ...


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

    def source_binding(self, path: Path) -> SourceBindingState:
        if path.is_symlink() and not path.exists():
            return SourceBindingState("broken-symlink")
        if not path.exists():
            return SourceBindingState("missing")
        kind: Literal["in-place", "symlink"] = "symlink" if path.is_symlink() else "in-place"
        if not path.is_dir() or self._run(["git", "-C", str(path), "rev-parse", "--is-inside-work-tree"]) != "true":
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


def _relative(root: Path, path: Path) -> str:
    try:
        return path.absolute().relative_to(root.absolute()).as_posix()
    except ValueError:
        return path.as_posix()


def _issue(layer: str, code: str, root: Path, path: Path, message: str) -> Issue:
    return Issue(layer, code, _relative(root, path), message)


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


def _walk(root: Path, *, hidden: bool = False) -> tuple[Path, ...]:
    paths: list[Path] = []
    for current, directories, files in os.walk(root, followlinks=False):
        current_path = Path(current)
        relative = current_path.relative_to(root)
        if len(relative.parts) == 3 and relative.parts[0] == "projects" and relative.parts[2] == "code":
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
    return (root / "raw").is_dir() and (root / "tasks").is_dir() and not (root / "projects/repositories.yaml").exists()


def _catalog_root(root: Path) -> Path | None:
    if (root / "projects/repositories.yaml").is_file():
        return root
    if (root.parent / "repositories.yaml").is_file():
        return root.parent.parent
    return None


def _load_registry(root: Path) -> tuple[RepositoryRegistry | None, list[Issue]]:
    catalog = _catalog_root(root)
    if catalog is None:
        if _is_project_vault(root):
            return None, []
        path = root / "projects/repositories.yaml"
        return None, [_issue("project-policy", "registry.schema", root, path, "repository registry is missing")]
    path = catalog / "projects/repositories.yaml"
    try:
        return parse_repository_registry(path.read_text(encoding="utf-8")), []
    except (OSError, RepositoryRegistryError) as error:
        return None, [_issue("project-policy", "registry.schema", root, path, str(error))]


def check_layout(root: Path, _state: GitStateReader) -> list[Issue]:
    issues: list[Issue] = []
    project_vault = _is_project_vault(root)
    for relative in PROJECT_REQUIRED_FILES if project_vault else REQUIRED_FILES:
        path = root / relative
        if not path.is_file():
            issues.append(_issue("karpathy-vault-v1", "layout.missing", root, path, f"required file is missing: {relative}"))
    required_directories = WORKBENCH_DIRECTORIES if project_vault else ("projects", *ROOT_COLLECTIONS, *ROOT_EVIDENCE_DIRECTORIES)
    for relative in required_directories:
        path = root / relative
        if not path.is_dir():
            issues.append(_issue("karpathy-vault-v1", "layout.missing", root, path, f"required directory is missing: {relative}"))
    forbidden_layouts = ("revisions", "raw/assets")
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
        if path.is_dir() and path.name in {".llm_wiki", ".cursor", ".codex", ".claude", ".omc"}:
            issues.append(_issue("karpathy-vault-v1", "forbidden.runtime-state", root, path, "runtime/editor state must not be committed"))
        if path.is_file() and any(path.name.endswith(suffix) for suffix in (".sqlite", ".sqlite-shm", ".sqlite-wal")):
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
    asset_roots = (*root.glob("projects/*/assets"), root / "assets")
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
        registered_roots: set[Path] = set()
        registry, _ = _load_registry(root)
        if registry:
            registered_roots = {root / binding.vault / INDEX_FILE for binding in registry.repositories.values()}
        if path != root_index and path not in registered_roots and path.is_file() and path.read_text(encoding="utf-8").startswith("---\n"):
            issues.append(_issue("okf-base", "index.frontmatter", root, path, "nested indexes must be frontmatter-free"))
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
        relative = path.relative_to(root)
        expected_type = ROOT_TYPES.get(path.name) if len(relative.parts) == 1 else None
        if len(relative.parts) >= 2:
            if relative.parts[0] in COMPILED_COLLECTION_TYPES:
                expected_type = COMPILED_COLLECTION_TYPES[relative.parts[0]]
            elif len(relative.parts) >= 4 and relative.parts[0] == "projects" and relative.parts[2] in COMPILED_COLLECTION_TYPES:
                expected_type = COMPILED_COLLECTION_TYPES[relative.parts[2]]
            elif len(relative.parts) == 2 and relative.parts[0] == "projects" and relative.suffix == ".md":
                expected_type = "Software Project"
            elif len(relative.parts) == 4 and relative.parts[:3:2] == ("projects", "raw"):
                expected_type = "Paper"
            elif len(relative.parts) == 2 and relative.parts[0] == "raw":
                expected_type = "Paper"
        if expected_type and page_type != expected_type:
            issues.append(_issue("project-policy", "placement.type", root, path, f"this path requires type {expected_type}"))
        if not project_vault and len(relative.parts) >= 2 and relative.parts[0] in COMPILED_COLLECTION_TYPES and data.get("scope") not in {"vault", "cross-project"}:
            issues.append(_issue("project-policy", "placement.scope", root, path, "root compiled pages require scope: vault or cross-project"))
        if project_vault and len(relative.parts) >= 2 and relative.parts[0] in COMPILED_COLLECTION_TYPES and data.get("code_scope") is not True:
            issues.append(_issue("project-policy", "placement.code-scope", root, path, "code-vault compiled pages require code_scope: true"))
        if page_type in {"Concept", "Entity"}:
            created = data.get("created")
            if not isinstance(created, dict) or not ACTOR.fullmatch(str(created.get("by", ""))) or not _iso_datetime(created.get("at")):
                issues.append(_issue("project-policy", "creation.metadata", root, path, "Concept and Entity pages require created.by and created.at"))
    return issues


def check_registry_and_sources(root: Path, state: GitStateReader) -> list[Issue]:
    if _is_project_vault(root):
        return []
    registry, issues = _load_registry(root)
    if registry is None:
        return issues
    ignore_file = root / ".gitignore"
    ignore_lines = {
        line.strip()
        for line in ignore_file.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    } if ignore_file.is_file() else set()
    if "projects/code/" not in ignore_lines and "/projects/code/" not in ignore_lines:
        issues.append(_issue("project-policy", "source.ignore", root, ignore_file, "projects/code/ must be ignored by the vault repository"))
    registered_sources = {binding.code for binding in registry.repositories.values()}
    for source in root.glob("projects/code/*"):
        if source.relative_to(root).as_posix() not in registered_sources:
            issues.append(_issue("project-policy", "source.unregistered", root, source, "code working copy is not registered"))
    for repository_id, binding in registry.repositories.items():
        card = root / binding.card
        studied_revision: str | None = None
        if not card.is_file():
            issues.append(_issue("project-policy", "registry.card", root, card, "registered project card is missing"))
            continue
        document, read_issues = _read(root, card)
        issues.extend(read_issues)
        if document:
            data = document.metadata
            candidate_revision = data.get("studied_revision")
            if isinstance(candidate_revision, str) and HEX_GIT_OID.fullmatch(candidate_revision):
                studied_revision = candidate_revision
            expected = {
                "repository": repository_id,
                "vcs": binding.vcs,
                "repository_url": binding.url,
                "default_ref": binding.default_ref,
                "vault_path": binding.vault.removeprefix("projects/"),
                "code_path": binding.code.removeprefix("projects/"),
            }
            for key, value in expected.items():
                actual = data.get(key)
                matches = actual == value
                if key == "repository_url" and isinstance(actual, str):
                    try:
                        matches = normalize_git_remote(actual) == binding.normalized_remote
                    except RepositoryRegistryError:
                        matches = False
                if not matches:
                    issues.append(_issue("project-policy", "registry.card", root, card, f"project card {key} does not match registry"))
            if not HEX_GIT_OID.fullmatch(str(data.get("studied_revision", ""))) or not _iso_datetime(data.get("studied_at")):
                issues.append(_issue("project-policy", "registry.card", root, card, "project card requires studied_revision and studied_at"))
        source_path = root / binding.code
        source_state = state.source_binding(source_path)
        if source_state.kind == "missing":
            continue
        valid = source_state.kind in {"in-place", "symlink"} and source_state.remote and source_state.revision
        if valid:
            try:
                valid = binding.vcs == "git" and normalize_git_remote(source_state.remote or "") == binding.normalized_remote
            except RepositoryRegistryError:
                valid = False
        if not valid:
            issues.append(_issue("project-policy", "source.binding", root, source_path, f"registered source is {source_state.kind} or has the wrong remote"))
        elif studied_revision is not None and source_state.revision != studied_revision:
            issues.append(_issue("project-policy", "source.currentness", root, source_path, f"checkout HEAD {source_state.revision} differs from studied revision {studied_revision}"))
    return issues


def _project_roots(root: Path, registry: RepositoryRegistry | None) -> tuple[Path, ...]:
    if _is_project_vault(root):
        return (root,)
    if not registry:
        return ()
    return tuple(root / binding.vault for binding in registry.repositories.values())


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
    registry, issues = _load_registry(root)
    if registry is None and not _is_project_vault(root):
        return issues
    project_roots = _project_roots(root, registry)
    for project in project_roots:
        for name in WORKBENCH_DIRECTORIES:
            path = project / name
            if not path.is_dir():
                issues.append(_issue("project-policy", "workbench.missing", root, path, f"project workbench requires {name}/"))
        current = list((project / "tasks").glob("current.md")) if (project / "tasks").is_dir() else []
        if len(current) != 1:
            issues.append(_issue("project-policy", "workbench.current-task", root, project / "tasks", "project requires exactly one tasks/current.md"))
    evidence_roots = project_roots if _is_project_vault(root) else (root, *project_roots)
    for evidence_root in evidence_roots:
        issues.extend(_check_evidence_root(root, evidence_root, state))
    attributes = root / ".gitattributes"
    if attributes.is_file():
        text = attributes.read_text(encoding="utf-8")
        required_lfs = (
            ("/assets/** filter=lfs",)
            if _is_project_vault(root)
            else ("/assets/** filter=lfs", "/projects/*/assets/** filter=lfs")
        )
        if any(pattern not in text for pattern in required_lfs) or re.search(r"(?:\.md|code).*filter=lfs", text):
            issues.append(_issue("project-policy", "lfs.attributes", root, attributes, "LFS must cover project assets, not Markdown or code"))
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
        try:
            relative_page = page.resolve().relative_to(root.resolve())
        except ValueError:
            return False
        root_query = len(relative_page.parts) >= 2 and relative_page.parts[0] == "queries"
        expected_assets = (
            root / "assets"
            if root_query or _is_project_vault(root)
            else root / "projects" / str(project_id) / "assets"
        )
        valid_scope = root_query or isinstance(project_id, str)
        return (
            valid_scope
            and target is not None
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
            and HEX_GIT_OID.fullmatch(str(anchor.get("revision", ""))) is not None
            and isinstance(anchor.get("path"), str)
            and bool(anchor.get("path"))
            and not Path(str(anchor.get("path"))).is_absolute()
            and ".." not in Path(str(anchor.get("path"))).parts
            and _line_range(anchor)
        )
    return False


def check_provenance_queries_links(root: Path, state: GitStateReader) -> list[Issue]:
    registry, issues = _load_registry(root)
    registered = registry.repositories if registry else {}
    catalog = _catalog_root(root) or root
    registered_source_roots = [catalog / binding.code for binding in registered.values()]
    project_vault = _is_project_vault(root)
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
                    base_valid = known_repository and HEX_GIT_OID.fullmatch(str(revision or "")) and safe_path
                    stable_valid = data.get("status") != "stable" or HEX_SHA256.fullmatch(str(digest or ""))
                    awaiting_valid = data.get("status") != "draft" or data.get("source_state") == "awaiting-source" or HEX_SHA256.fullmatch(str(digest or ""))
                    if not base_valid or not stable_valid or not awaiting_valid:
                        issues.append(_issue("project-policy", "code.provenance", root, path, "code source requires repository, immutable revision/path, and stable hash; draft omissions require awaiting-source"))
                    elif data.get("status") == "stable" and repository_id in registered:
                        binding = registered[str(repository_id)]
                        source_root = catalog / binding.code
                        binding_state = state.source_binding(source_root)
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
        if conflicts is not None and data.get("status") != "draft":
            issues.append(_issue("karpathy-vault-v1", "conflict.status", root, path, "unresolved conflicts require draft status"))
    return issues


CHECKS = (
    check_layout,
    check_indexes,
    check_okf_and_profile,
    check_registry_and_sources,
    check_workbench_raw_assets,
    check_provenance_queries_links,
)


def validate_vault(vault_root: Path, *, git_state: GitStateReader | None = None) -> tuple[Issue, ...]:
    """Return independently actionable, explicitly layered vault issues."""
    root = vault_root.absolute()
    state = git_state or RealGitState(root)
    issues: list[Issue] = []
    for check in CHECKS:
        issues.extend(check(root, state))
    return tuple(sorted(set(issues)))
