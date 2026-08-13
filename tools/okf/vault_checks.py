from __future__ import annotations

import configparser
import os
import re
import subprocess
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Protocol
from urllib.parse import urlparse

from rebuild_indexes import IndexBuildError, build_indexes, owned_directories
from vaultlib import (
    ALLOWED_STATUSES,
    TAG_REGISTRY,
    FrontmatterDocument,
    markdown_targets,
    parse_frontmatter,
    resolve_local_target,
    sha256_bytes,
    slugify_title,
    strip_fenced_code_blocks,
)

NANOCHAT_COMMIT = "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"
NANOCHAT_REPOSITORY = "https://github.com/karpathy/nanochat.git"
NANOCHAT_GITLINK = "projects/code/nanochat"
CANONICAL_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")
HEX_GIT_OID = re.compile(r"^[0-9a-f]{40}$")
ACTOR = re.compile(
    r"^(?:human:[^\s]+|process:[^\s]+|"
    r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.:+-]+)$"
)
FOOTNOTE_REFERENCE = re.compile(r"\[\^([A-Za-z0-9_.:-]+)\](?!:)")
FOOTNOTE_DEFINITION = re.compile(
    r"^\[\^([A-Za-z0-9_.:-]+)\]:",
    re.MULTILINE,
)
BINARY_LFS_SUFFIXES = frozenset(
    {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
)
FORBIDDEN_STATE_DIRECTORIES = frozenset(
    {".llm_wiki", ".omc", ".cursor", ".codex", ".claude", "notes"}
)
REQUIRED_FILES = (
    ".gitattributes",
    ".gitignore",
    "README.md",
    "SCHEMA.md",
    "AGENTS.md",
    "index.md",
    "log.md",
)
REQUIRED_DIRECTORIES = (
    "raw",
    "raw/assets",
    "projects",
    "projects/code",
    "summaries",
    "entities",
    "concepts",
    "comparisons",
    "queries",
)
ROOT_TYPES = {
    "README.md": "Reference",
    "SCHEMA.md": "Reference",
    "AGENTS.md": "Playbook",
}
DIRECTORY_TYPES = {
    "summaries": "Summary",
    "entities": "Entity",
    "concepts": "Concept",
    "comparisons": "Comparison",
    "queries": "Query",
}
TYPE_HEADINGS = {
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


@dataclass(frozen=True, order=True)
class Issue:
    code: str
    path: str
    message: str


@dataclass(frozen=True)
class SubmoduleState:
    configured_path: str | None
    configured_url: str | None
    index_mode: str | None
    index_oid: str | None
    checkout_oid: str | None


class GitStateReader(Protocol):
    def nanochat_submodule(self) -> SubmoduleState:
        pass

    def lfs_filter(self, path: Path) -> str | None:
        pass


class RealGitState:
    def __init__(self, vault_root: Path) -> None:
        self.vault_root = vault_root.resolve()
        output = self._run(
            ["git", "-C", str(self.vault_root), "rev-parse", "--show-toplevel"]
        )
        self.repository_root = (
            Path(output).resolve() if output is not None else self.vault_root.parent
        )

    @staticmethod
    def _run(arguments: list[str]) -> str | None:
        try:
            result = subprocess.run(
                arguments,
                check=True,
                capture_output=True,
                text=True,
            )
        except (OSError, subprocess.CalledProcessError):
            return None
        return result.stdout.strip()

    def nanochat_submodule(self) -> SubmoduleState:
        configured_path: str | None = None
        configured_url: str | None = None
        modules_path = self.repository_root / ".gitmodules"
        if modules_path.exists():
            parser = configparser.RawConfigParser()
            try:
                parser.read(modules_path, encoding="utf-8")
                for section in parser.sections():
                    path = parser.get(section, "path", fallback=None)
                    if path == NANOCHAT_GITLINK:
                        configured_path = path
                        configured_url = parser.get(
                            section,
                            "url",
                            fallback=None,
                        )
                        break
            except configparser.Error:
                configured_path = None
                configured_url = None

        index_mode: str | None = None
        index_oid: str | None = None
        stage = self._run(
            [
                "git",
                "-C",
                str(self.repository_root),
                "ls-files",
                "--stage",
                "--",
                NANOCHAT_GITLINK,
            ]
        )
        if stage:
            match = re.match(
                r"^(?P<mode>[0-9]+) (?P<oid>[0-9a-f]+) [0-9]\t",
                stage,
            )
            if match:
                index_mode = match.group("mode")
                index_oid = match.group("oid")

        checkout = self.repository_root / NANOCHAT_GITLINK
        checkout_oid = (
            self._run(["git", "-C", str(checkout), "rev-parse", "HEAD"])
            if checkout.exists()
            else None
        )
        return SubmoduleState(
            configured_path=configured_path,
            configured_url=configured_url,
            index_mode=index_mode,
            index_oid=index_oid,
            checkout_oid=checkout_oid,
        )

    def lfs_filter(self, path: Path) -> str | None:
        try:
            relative = path.resolve().relative_to(
                self.repository_root
            ).as_posix()
        except ValueError:
            return None
        output = self._run(
            [
                "git",
                "-C",
                str(self.repository_root),
                "check-attr",
                "filter",
                "--",
                relative,
            ]
        )
        if not output:
            return None
        value = output.rsplit(":", 1)[-1].strip()
        return None if value in {"unspecified", "unset"} else value


def _relative(vault_root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(vault_root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def _issue(
    code: str,
    vault_root: Path,
    path: Path,
    message: str,
) -> Issue:
    return Issue(code, _relative(vault_root, path), message)


def _mapping(value: object) -> dict[str, object] | None:
    return value if isinstance(value, dict) else None


def _is_url(value: str) -> bool:
    return urlparse(value).scheme.lower() in {"http", "https"}


def _is_iso_date(value: object) -> bool:
    try:
        date.fromisoformat(str(value))
    except (TypeError, ValueError):
        return False
    return True


def _is_iso_datetime(value: object) -> bool:
    if not isinstance(value, str) or "T" not in value:
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def _read_document(
    vault_root: Path,
    path: Path,
    code: str,
) -> tuple[FrontmatterDocument | None, list[Issue]]:
    try:
        return (
            parse_frontmatter(
                path.read_text(encoding="utf-8"),
                source=path,
            ),
            [],
        )
    except (OSError, ValueError) as error:
        return None, [_issue(code, vault_root, path, str(error))]


def _walk_paths(
    vault_root: Path,
    *,
    include_hidden: bool,
) -> tuple[Path, ...]:
    paths: list[Path] = []
    for current, directories, files in os.walk(vault_root):
        current_path = Path(current)
        relative = _relative(vault_root, current_path)
        if relative == ".":
            directories[:] = [
                name
                for name in directories
                if name in REQUIRED_DIRECTORIES
                or any(
                    required.startswith(f"{name}/")
                    for required in REQUIRED_DIRECTORIES
                )
            ]
        if relative == "projects/code":
            directories[:] = [
                name for name in directories if name != "nanochat"
            ]
        directories[:] = [
            name
            for name in directories
            if name != ".git"
            and (include_hidden or not name.startswith("."))
            and name != "__pycache__"
        ]
        paths.extend(current_path / name for name in directories)
        paths.extend(
            current_path / name
            for name in files
            if include_hidden or not name.startswith(".")
        )
    return tuple(paths)


def _markdown_files(vault_root: Path) -> tuple[Path, ...]:
    return tuple(
        sorted(
            path
            for path in _walk_paths(vault_root, include_hidden=False)
            if path.is_file() and path.suffix.lower() == ".md"
        )
    )


def _concept_files(vault_root: Path) -> tuple[Path, ...]:
    return tuple(
        path
        for path in _markdown_files(vault_root)
        if path.name not in {"index.md", "log.md"}
    )


def _compiled_pages(vault_root: Path) -> tuple[Path, ...]:
    pages: list[Path] = []
    for directory in DIRECTORY_TYPES:
        pages.extend(
            path
            for path in (vault_root / directory).glob("*.md")
            if path.name not in {"index.md", "log.md"}
        )
    return tuple(sorted(pages))


def check_required_layout(
    vault_root: Path,
    _git_state: GitStateReader,
) -> list[Issue]:
    issues: list[Issue] = []
    for relative in REQUIRED_FILES:
        path = vault_root / relative
        if not path.is_file():
            issues.append(
                _issue(
                    "layout.missing",
                    vault_root,
                    path,
                    f"required file is missing: {relative}",
                )
            )
    for relative in REQUIRED_DIRECTORIES:
        path = vault_root / relative
        if not path.is_dir():
            issues.append(
                _issue(
                    "layout.missing",
                    vault_root,
                    path,
                    f"required directory is missing: {relative}",
                )
            )
    return issues


def check_forbidden_state(
    vault_root: Path,
    _git_state: GitStateReader,
) -> list[Issue]:
    issues: list[Issue] = []
    for path in _walk_paths(vault_root, include_hidden=True):
        if path.is_dir() and path.name in FORBIDDEN_STATE_DIRECTORIES:
            issues.append(
                _issue(
                    "forbidden.runtime-state",
                    vault_root,
                    path,
                    "runtime or editor state must not be committed",
                )
            )
        if path.is_file() and (
            path.name.endswith(".sqlite")
            or path.name.endswith(".sqlite-shm")
            or path.name.endswith(".sqlite-wal")
        ):
            issues.append(
                _issue(
                    "forbidden.runtime-state",
                    vault_root,
                    path,
                    "database state is outside the plain-file design",
                )
            )

    raw_dir = vault_root / "raw"
    if raw_dir.is_dir():
        for child in raw_dir.iterdir():
            if child.is_dir() and child.name != "assets":
                issues.append(
                    _issue(
                        "raw.layout",
                        vault_root,
                        child,
                        "raw companions must remain flat except for raw/assets",
                    )
                )
    return issues


def _index_body(
    vault_root: Path,
    path: Path,
) -> tuple[str | None, list[Issue]]:
    text = path.read_text(encoding="utf-8")
    if path == vault_root / "index.md":
        document, issues = _read_document(
            vault_root,
            path,
            "index.frontmatter",
        )
        if document is None:
            return None, issues
        if document.metadata != {"okf_version": "0.2"}:
            issues.append(
                _issue(
                    "index.frontmatter",
                    vault_root,
                    path,
                    'root index frontmatter must contain only okf_version: "0.2"',
                )
            )
        return document.body, issues
    if text.startswith("---\n"):
        return (
            text,
            [
                _issue(
                    "index.frontmatter",
                    vault_root,
                    path,
                    "only the bundle-root index may contain frontmatter",
                )
            ],
        )
    return text, []


def check_reserved_files(
    vault_root: Path,
    _git_state: GitStateReader,
) -> list[Issue]:
    issues: list[Issue] = []
    for path in _markdown_files(vault_root):
        if path.name != "index.md":
            continue
        body, index_issues = _index_body(vault_root, path)
        issues.extend(index_issues)
        if body is not None and not re.search(r"^# .+", body, re.MULTILINE):
            issues.append(
                _issue(
                    "index.structure",
                    vault_root,
                    path,
                    "index must contain at least one level-one section",
                )
            )

    for path in (
        candidate
        for candidate in _markdown_files(vault_root)
        if candidate.name == "log.md"
    ):
        text = path.read_text(encoding="utf-8")
        if text.startswith("---\n"):
            document, read_issues = _read_document(
                vault_root,
                path,
                "log.frontmatter",
            )
            issues.extend(read_issues)
            if document is None:
                continue
            body = document.body
            if document.metadata.get("type") != "Log":
                issues.append(
                    _issue(
                        "log.frontmatter",
                        vault_root,
                        path,
                        "log frontmatter type must be Log when present",
                    )
                )
        else:
            body = text
        dates = re.findall(r"^## (\d{4}-\d{2}-\d{2})\s*$", body, re.MULTILINE)
        if not dates or not all(_is_iso_date(value) for value in dates):
            issues.append(
                _issue(
                    "log.structure",
                    vault_root,
                    path,
                    "log requires ISO YYYY-MM-DD date headings",
                )
            )
        elif dates != sorted(dates, reverse=True):
            issues.append(
                _issue(
                    "log.order",
                    vault_root,
                    path,
                    "log date groups must be newest first",
                )
            )
    return issues


def check_okf_conformance(
    vault_root: Path,
    _git_state: GitStateReader,
) -> list[Issue]:
    issues: list[Issue] = []
    for path in _concept_files(vault_root):
        document, read_issues = _read_document(
            vault_root,
            path,
            "okf.frontmatter",
        )
        issues.extend(read_issues)
        if document is None:
            continue
        concept_type = document.metadata.get("type")
        if not isinstance(concept_type, str) or not concept_type.strip():
            issues.append(
                _issue(
                    "okf.type",
                    vault_root,
                    path,
                    "OKF concept requires a nonempty type",
                )
            )
    return issues


def check_generated_indexes(
    vault_root: Path,
    _git_state: GitStateReader,
) -> list[Issue]:
    issues: list[Issue] = []
    for directory in owned_directories(vault_root):
        path = directory / "index.md"
        if not path.is_file():
            issues.append(
                _issue(
                    "index.missing",
                    vault_root,
                    path,
                    "every visible bundle-owned directory requires index.md",
                )
            )
    try:
        expected = build_indexes(vault_root)
    except IndexBuildError as error:
        issues.append(
            _issue(
                "index.build",
                vault_root,
                vault_root,
                str(error),
            )
        )
        return issues
    for path, content in expected.items():
        if not path.is_file() or path.read_text(encoding="utf-8") != content:
            issues.append(
                _issue(
                    "index.stale",
                    vault_root,
                    path,
                    "index differs from deterministic hierarchical output",
                )
            )
    return issues


def _expected_type(vault_root: Path, path: Path) -> str | None:
    relative = path.relative_to(vault_root)
    if len(relative.parts) == 1:
        return ROOT_TYPES.get(path.name)
    if relative.parent == Path("raw"):
        return "Paper"
    if relative == Path("projects/nanochat.md"):
        return "Software Project"
    if len(relative.parts) == 2:
        return DIRECTORY_TYPES.get(relative.parts[0])
    return None


def _source_ids(
    vault_root: Path,
    path: Path,
    metadata: dict[str, object],
    *,
    required: bool,
) -> tuple[set[str], list[Issue]]:
    issues: list[Issue] = []
    value = metadata.get("sources")
    if not isinstance(value, list) or not value:
        if required:
            issues.append(
                _issue(
                    "source.metadata",
                    vault_root,
                    path,
                    "substantive concept requires a nonempty sources list",
                )
            )
        return set(), issues

    ids: set[str] = set()
    for source in value:
        if not isinstance(source, dict):
            issues.append(
                _issue(
                    "source.metadata",
                    vault_root,
                    path,
                    "every source must be a mapping",
                )
            )
            continue
        source_id = source.get("id")
        resource = source.get("resource")
        title = source.get("title")
        if not all(
            isinstance(item, str) and item.strip()
            for item in (source_id, resource, title)
        ):
            issues.append(
                _issue(
                    "source.metadata",
                    vault_root,
                    path,
                    "source requires nonempty id, resource, and title",
                )
            )
            continue
        source_id = str(source_id)
        resource = str(resource)
        if source_id in ids:
            issues.append(
                _issue(
                    "source.metadata",
                    vault_root,
                    path,
                    f"duplicate source id: {source_id}",
                )
            )
        ids.add(source_id)
        if _is_url(resource):
            continue
        target = resolve_local_target(path, resource, vault_root)
        if target is None or not target.exists():
            issues.append(
                _issue(
                    "source.missing",
                    vault_root,
                    path,
                    f"source does not resolve: {resource}",
                )
            )
            continue
        code_root = (vault_root / "projects/code/nanochat").resolve()
        try:
            target.resolve().relative_to(code_root)
        except ValueError:
            pass
        else:
            if source.get("commit") != NANOCHAT_COMMIT:
                issues.append(
                    _issue(
                        "source.commit",
                        vault_root,
                        path,
                        "Nanochat code source must record the pinned commit",
                    )
                )
    return ids, issues


def _check_footnotes(
    vault_root: Path,
    path: Path,
    body: str,
    source_ids: set[str],
    *,
    require_each_source: bool,
) -> list[Issue]:
    issues: list[Issue] = []
    body = strip_fenced_code_blocks(body)
    references = set(FOOTNOTE_REFERENCE.findall(body))
    definitions = set(FOOTNOTE_DEFINITION.findall(body))
    for label in sorted(references):
        if label not in source_ids:
            issues.append(
                _issue(
                    "source.footnote",
                    vault_root,
                    path,
                    f"footnote {label!r} has no matching sources[].id",
                )
            )
        if label not in definitions:
            issues.append(
                _issue(
                    "source.footnote",
                    vault_root,
                    path,
                    f"footnote {label!r} has no definition",
                )
            )
    if require_each_source:
        for source_id in sorted(source_ids - references):
            issues.append(
                _issue(
                    "source.footnote",
                    vault_root,
                    path,
                    f"source {source_id!r} is not attributed in the body",
                )
            )
    return issues


def check_profile_documents(
    vault_root: Path,
    _git_state: GitStateReader,
) -> list[Issue]:
    issues: list[Issue] = []
    compiled = {path.resolve() for path in _compiled_pages(vault_root)}
    for path in _concept_files(vault_root):
        document, read_issues = _read_document(
            vault_root,
            path,
            "page.frontmatter",
        )
        issues.extend(read_issues)
        if document is None:
            continue
        metadata = document.metadata
        concept_type = metadata.get("type")
        expected_type = _expected_type(vault_root, path)
        if expected_type is not None and concept_type != expected_type:
            issues.append(
                _issue(
                    "page.type",
                    vault_root,
                    path,
                    f"type must be {expected_type}",
                )
            )

        for key in ("title", "description"):
            if not isinstance(metadata.get(key), str) or not str(
                metadata.get(key)
            ).strip():
                issues.append(
                    _issue(
                        f"page.{key}",
                        vault_root,
                        path,
                        f"{key} must be a nonempty string",
                    )
                )
        title = metadata.get("title")
        if isinstance(title, str) and not re.search(
            rf"^# {re.escape(title)}\s*$",
            document.body,
            re.MULTILINE,
        ):
            issues.append(
                _issue(
                    "page.heading",
                    vault_root,
                    path,
                    "level-one heading must match frontmatter title",
                )
            )

        tags = metadata.get("tags")
        if not isinstance(tags, list) or not tags:
            issues.append(
                _issue(
                    "page.tag",
                    vault_root,
                    path,
                    "tags must be a nonempty registered list",
                )
            )
        else:
            for tag in tags:
                if not isinstance(tag, str) or tag not in TAG_REGISTRY:
                    issues.append(
                        _issue(
                            "page.tag",
                            vault_root,
                            path,
                            f"unregistered tag: {tag!r}",
                        )
                    )

        if metadata.get("status") not in ALLOWED_STATUSES:
            issues.append(
                _issue(
                    "page.status",
                    vault_root,
                    path,
                    "status must be draft, stable, or deprecated",
                )
            )

        generated = _mapping(metadata.get("generated"))
        generated_by = generated.get("by") if generated else None
        generated_at = generated.get("at") if generated else None
        if (
            not isinstance(generated_by, str)
            or not ACTOR.fullmatch(generated_by)
            or not _is_iso_datetime(generated_at)
        ):
            issues.append(
                _issue(
                    "page.generated",
                    vault_root,
                    path,
                    "generated requires a valid actor and ISO datetime",
                )
            )

        is_compiled = path.resolve() in compiled
        requires_sources = is_compiled or expected_type in {
            "Paper",
            "Software Project",
        }
        source_ids, source_issues = _source_ids(
            vault_root,
            path,
            metadata,
            required=requires_sources,
        )
        issues.extend(source_issues)
        issues.extend(
            _check_footnotes(
                vault_root,
                path,
                document.body,
                source_ids,
                require_each_source=is_compiled,
            )
        )

        if is_compiled and concept_type in TYPE_HEADINGS:
            missing = [
                heading
                for heading in TYPE_HEADINGS[str(concept_type)]
                if not re.search(
                    rf"^## {re.escape(heading)}\s*$",
                    document.body,
                    re.MULTILINE,
                )
            ]
            if missing:
                issues.append(
                    _issue(
                        "page.headings",
                        vault_root,
                        path,
                        f"missing required headings: {', '.join(missing)}",
                    )
                )
    return issues


def check_raw_snapshots(
    vault_root: Path,
    _git_state: GitStateReader,
) -> list[Issue]:
    issues: list[Issue] = []
    raw_dir = vault_root / "raw"
    companion_stems: set[str] = set()
    for path in sorted(raw_dir.glob("*.md")):
        if path.name == "index.md":
            continue
        companion_stems.add(path.stem)
        document, read_issues = _read_document(
            vault_root,
            path,
            "raw.frontmatter",
        )
        issues.extend(read_issues)
        if document is None:
            continue
        metadata = document.metadata
        title = metadata.get("title")
        arxiv = _mapping(metadata.get("arxiv"))
        paper_id = arxiv.get("id") if arxiv else None
        version = arxiv.get("version") if arxiv else None
        if not isinstance(title, str) or not title.strip():
            issues.append(
                _issue("raw.metadata", vault_root, path, "missing title")
            )
            continue
        if not isinstance(paper_id, str) or not isinstance(version, int):
            issues.append(
                _issue(
                    "raw.metadata",
                    vault_root,
                    path,
                    "arxiv requires a string id and integer version",
                )
            )
            continue

        expected_stem = slugify_title(title)
        collision_stem = (
            f"{expected_stem}-arxiv-{paper_id.replace('/', '-')}-v{version}"
        )
        if path.stem not in {expected_stem, collision_stem}:
            issues.append(
                _issue(
                    "raw.title-path",
                    vault_root,
                    path,
                    f"filename must derive from title as {expected_stem}.md",
                )
            )

        expected_resource = f"https://arxiv.org/abs/{paper_id}v{version}"
        if metadata.get("resource") != expected_resource:
            issues.append(
                _issue(
                    "raw.metadata",
                    vault_root,
                    path,
                    f"resource must be {expected_resource}",
                )
            )

        body_hash = metadata.get("sha256")
        if (
            not isinstance(body_hash, str)
            or not HEX_SHA256.fullmatch(body_hash)
            or body_hash != sha256_bytes(document.body.encode("utf-8"))
        ):
            issues.append(
                _issue(
                    "raw.body-hash",
                    vault_root,
                    path,
                    "recorded sha256 does not match Markdown body",
                )
            )

        license_metadata = _mapping(metadata.get("license"))
        if (
            not license_metadata
            or license_metadata.get("id") != "CC-BY-4.0"
            or license_metadata.get("url") != CANONICAL_LICENSE_URL
        ):
            issues.append(
                _issue(
                    "raw.license",
                    vault_root,
                    path,
                    "mirrored paper must record CC BY 4.0",
                )
            )

        extraction = _mapping(metadata.get("extraction"))
        if (
            not extraction
            or extraction.get("tool") != "pdftotext"
            or not isinstance(extraction.get("version"), str)
        ):
            issues.append(
                _issue(
                    "raw.extraction",
                    vault_root,
                    path,
                    "extraction must record pdftotext and its version",
                )
            )

        attachment = _mapping(metadata.get("attachment"))
        expected_attachment = f"assets/{path.stem}.pdf"
        if (
            not attachment
            or attachment.get("resource") != expected_attachment
            or attachment.get("media_type") != "application/pdf"
        ):
            issues.append(
                _issue(
                    "raw.attachment",
                    vault_root,
                    path,
                    f"attachment resource must be {expected_attachment}",
                )
            )
            continue
        attachment_path = raw_dir / expected_attachment
        if not attachment_path.is_file():
            issues.append(
                _issue(
                    "raw.attachment-missing",
                    vault_root,
                    attachment_path,
                    "recorded PDF attachment does not exist",
                )
            )
        else:
            attachment_bytes = attachment_path.read_bytes()
            if attachment.get("bytes") != len(attachment_bytes):
                issues.append(
                    _issue(
                        "raw.attachment-size",
                        vault_root,
                        attachment_path,
                        "recorded byte size does not match PDF",
                    )
                )
            attachment_hash = attachment.get("sha256")
            if (
                not isinstance(attachment_hash, str)
                or not HEX_SHA256.fullmatch(attachment_hash)
                or attachment_hash != sha256_bytes(attachment_bytes)
            ):
                issues.append(
                    _issue(
                        "raw.attachment-hash",
                        vault_root,
                        attachment_path,
                        "recorded sha256 does not match PDF bytes",
                    )
                )

        required_fragments = (
            "## Source metadata",
            "## Abstract",
            "## Mechanically extracted full text",
            f"(assets/{path.stem}.pdf)",
            "Extraction notice:",
        )
        if any(
            fragment not in document.body for fragment in required_fragments
        ):
            issues.append(
                _issue(
                    "raw.body-contract",
                    vault_root,
                    path,
                    "raw body is missing source, abstract, extraction, or PDF sections",
                )
            )

    assets_dir = raw_dir / "assets"
    if assets_dir.is_dir():
        for attachment in assets_dir.glob("*.pdf"):
            if attachment.stem not in companion_stems:
                issues.append(
                    _issue(
                        "raw.orphan-attachment",
                        vault_root,
                        attachment,
                        "PDF has no same-basename raw companion",
                    )
                )
    return issues


def _resolve_link(
    vault_root: Path,
    source_path: Path,
    target: str,
    kind: str,
    markdown_files: tuple[Path, ...],
) -> tuple[Path | None, bool]:
    path_part = target.split("#", 1)[0].split("?", 1)[0]
    if not path_part:
        return source_path.resolve(), False
    direct = resolve_local_target(source_path, target, vault_root)
    if kind == "markdown":
        return direct, False
    if "/" not in path_part and "\\" not in path_part:
        stem = Path(path_part).stem.casefold()
        candidates = [
            path.resolve()
            for path in markdown_files
            if path.stem.casefold() == stem
        ]
        if len(candidates) == 1:
            return candidates[0], False
        if len(candidates) > 1:
            return None, True
    return direct, False


def check_links(
    vault_root: Path,
    _git_state: GitStateReader,
) -> list[Issue]:
    issues: list[Issue] = []
    markdown_files = _markdown_files(vault_root)
    compiled = {path.resolve() for path in _compiled_pages(vault_root)}
    for path in markdown_files:
        text = path.read_text(encoding="utf-8")
        metadata: dict[str, object] = {}
        if text.startswith("---\n"):
            try:
                document = parse_frontmatter(text, source=path)
                metadata = document.metadata
                body = document.body
            except ValueError:
                continue
        else:
            body = text
        if metadata.get("type") == "Paper":
            body = body.partition(
                "\n## Mechanically extracted full text"
            )[0]
        compiled_targets: set[Path] = set()
        for link in markdown_targets(body):
            target, ambiguous = _resolve_link(
                vault_root,
                path,
                link.target,
                link.kind,
                markdown_files,
            )
            if ambiguous:
                issues.append(
                    _issue(
                        "link.ambiguous",
                        vault_root,
                        path,
                        f"basename link is ambiguous: {link.target}",
                    )
                )
                continue
            if target is None or not target.exists():
                issues.append(
                    _issue(
                        "link.missing",
                        vault_root,
                        path,
                        f"local link does not resolve: {link.target}",
                    )
                )
                continue
            if target.resolve() in compiled:
                compiled_targets.add(target.resolve())
        if path.resolve() in compiled and len(compiled_targets) < 2:
            issues.append(
                _issue(
                    "page.crosslinks",
                    vault_root,
                    path,
                    "substantive page must link to at least two compiled pages",
                )
            )
    return issues


def _conflict_entries(path: Path) -> tuple[dict[str, object], ...]:
    try:
        metadata = parse_frontmatter(
            path.read_text(encoding="utf-8"),
            source=path,
        ).metadata
    except (OSError, ValueError):
        return ()
    conflicts = metadata.get("conflicts")
    if not isinstance(conflicts, list):
        return ()
    return tuple(
        item for item in conflicts if isinstance(item, dict)
    )


def check_conflicts(
    vault_root: Path,
    _git_state: GitStateReader,
) -> list[Issue]:
    issues: list[Issue] = []
    for path in _compiled_pages(vault_root):
        for conflict in _conflict_entries(path):
            resource = conflict.get("resource")
            observed = conflict.get("observed")
            reason = conflict.get("reason")
            if (
                not isinstance(resource, str)
                or not _is_iso_date(observed)
                or not isinstance(reason, str)
                or not reason.strip()
            ):
                issues.append(
                    _issue(
                        "conflict.malformed",
                        vault_root,
                        path,
                        "conflict requires resource, ISO observed date, and reason",
                    )
                )
                continue
            target = resolve_local_target(path, resource, vault_root)
            if target is None or not target.is_file():
                issues.append(
                    _issue(
                        "conflict.malformed",
                        vault_root,
                        path,
                        f"conflict target does not resolve: {resource}",
                    )
                )
                continue
            reverse = False
            for candidate in _conflict_entries(target):
                reverse_resource = candidate.get("resource")
                if not isinstance(reverse_resource, str):
                    continue
                reverse_target = resolve_local_target(
                    target,
                    reverse_resource,
                    vault_root,
                )
                if reverse_target and reverse_target.resolve() == path.resolve():
                    reverse = True
                    break
            if not reverse:
                issues.append(
                    _issue(
                        "conflict.asymmetric",
                        vault_root,
                        path,
                        f"conflict target does not link back: {resource}",
                    )
                )
    return issues


def check_project_submodule(
    vault_root: Path,
    git_state: GitStateReader,
) -> list[Issue]:
    issues: list[Issue] = []
    card_path = vault_root / "projects/nanochat.md"
    if not card_path.is_file():
        return [
            _issue(
                "project.card",
                vault_root,
                card_path,
                "Nanochat project card is missing",
            )
        ]
    document, read_issues = _read_document(
        vault_root,
        card_path,
        "project.card",
    )
    issues.extend(read_issues)
    if document is None:
        return issues
    metadata = document.metadata
    pinned_commit = metadata.get("pinned_commit")
    if (
        pinned_commit != NANOCHAT_COMMIT
        or not isinstance(pinned_commit, str)
        or not HEX_GIT_OID.fullmatch(pinned_commit)
    ):
        issues.append(
            _issue(
                "project.commit",
                vault_root,
                card_path,
                f"project card must pin {NANOCHAT_COMMIT}",
            )
        )
    for key, expected in (
        ("repository_url", NANOCHAT_REPOSITORY),
        ("default_branch", "master"),
        ("license", "MIT"),
        ("source_path", "code/nanochat"),
    ):
        if metadata.get(key) != expected:
            issues.append(
                _issue(
                    "project.card",
                    vault_root,
                    card_path,
                    f"{key} must be {expected}",
                )
            )

    state = git_state.nanochat_submodule()
    if (
        state.configured_path != NANOCHAT_GITLINK
        or state.configured_url != NANOCHAT_REPOSITORY
    ):
        issues.append(
            _issue(
                "project.gitmodules",
                vault_root,
                vault_root / "projects/code/nanochat",
                "submodule path and URL must match the project card",
            )
        )
    if state.index_mode != "160000":
        issues.append(
            _issue(
                "project.gitlink",
                vault_root,
                vault_root / "projects/code/nanochat",
                "Nanochat source must be stored as a 160000 gitlink",
            )
        )
    if (
        state.index_oid != NANOCHAT_COMMIT
        or state.checkout_oid != NANOCHAT_COMMIT
    ):
        issues.append(
            _issue(
                "project.commit",
                vault_root,
                vault_root / "projects/code/nanochat",
                "gitlink and checkout must match the pinned commit",
            )
        )
    return issues


def check_lfs_attributes(
    vault_root: Path,
    git_state: GitStateReader,
) -> list[Issue]:
    issues: list[Issue] = []
    assets = vault_root / "raw/assets"
    if not assets.is_dir():
        return issues
    for path in sorted(candidate for candidate in assets.rglob("*") if candidate.is_file()):
        filter_name = git_state.lfs_filter(path)
        if path.suffix.lower() == ".md":
            if filter_name == "lfs":
                issues.append(
                    _issue(
                        "lfs.markdown",
                        vault_root,
                        path,
                        "Markdown indexes must remain ordinary Git files",
                    )
                )
        elif path.suffix.lower() in BINARY_LFS_SUFFIXES and filter_name != "lfs":
            issues.append(
                _issue(
                    "lfs.untracked",
                    vault_root,
                    path,
                    "raw binary asset is not routed through Git LFS",
                )
            )
    return issues


CHECKS = (
    check_required_layout,
    check_forbidden_state,
    check_reserved_files,
    check_okf_conformance,
    check_profile_documents,
    check_raw_snapshots,
    check_links,
    check_conflicts,
    check_generated_indexes,
    check_project_submodule,
    check_lfs_attributes,
)


def validate_vault(
    vault_root: Path,
    *,
    git_state: GitStateReader | None = None,
) -> tuple[Issue, ...]:
    """Return independently actionable base-OKF and profile issues."""
    vault_root = vault_root.absolute()
    state = git_state or RealGitState(vault_root)
    issues: list[Issue] = []
    for check in CHECKS:
        issues.extend(check(vault_root, state))
    return tuple(sorted(set(issues)))
