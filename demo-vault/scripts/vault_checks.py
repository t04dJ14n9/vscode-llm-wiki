from __future__ import annotations

import configparser
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from rebuild_indexes import IndexBuildError, TYPE_DIRECTORIES, build_indexes
from vaultlib import (
    ALLOWED_PAGE_TYPES,
    ALLOWED_STATUSES,
    TAG_REGISTRY,
    FrontmatterDocument,
    markdown_targets,
    parse_frontmatter,
    resolve_local_target,
    sha256_bytes,
    slugify_title,
)

NANOCHAT_COMMIT = "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"
NANOCHAT_REPOSITORY = "https://github.com/karpathy/nanochat.git"
NANOCHAT_GITLINK = "demo-vault/projects/code/nanochat"
CANONICAL_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")
HEX_GIT_OID = re.compile(r"^[0-9a-f]{40}$")

REQUIRED_FILES = (
    ".gitattributes",
    ".gitignore",
    "README.md",
    "SCHEMA.md",
    "AGENTS.md",
    "CLAUDE.md",
    "index.md",
    "log.md",
    "scripts/ingest_arxiv.py",
    "scripts/rebuild_indexes.py",
    "scripts/validate_vault.py",
    "scripts/vault_checks.py",
    "scripts/vaultlib.py",
    ".agents/skills/llm-wiki/SKILL.md",
    ".agents/skills/llm-wiki/references/arxiv-ingestion.md",
    ".agents/skills/llm-wiki/references/frontmatter.md",
)
REQUIRED_DIRECTORIES = (
    "raw/assets",
    "projects/code",
    "wiki/summaries",
    "wiki/entities",
    "wiki/concepts",
    "wiki/comparisons",
    "wiki/queries",
)
TYPE_HEADINGS = {
    "summary": ("Scope", "Pipeline", "Evidence boundary", "Related pages"),
    "entity": ("What it is", "Why it matters", "Nanochat relevance", "Related pages"),
    "concept": ("Definition", "Mechanism", "Nanochat connection", "Related pages"),
    "comparison": ("Decision frame", "Comparison", "Takeaway", "Related pages"),
    "query": ("Answer", "Evidence trail", "Limits", "Related pages"),
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
                            section, "url", fallback=None
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
            match = re.match(r"^(?P<mode>[0-9]+) (?P<oid>[0-9a-f]+) [0-9]\t", stage)
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
            relative = path.resolve().relative_to(self.repository_root).as_posix()
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
    code: str, vault_root: Path, path: Path, message: str
) -> Issue:
    return Issue(code, _relative(vault_root, path), message)


def _read_document(
    vault_root: Path, path: Path, code: str
) -> tuple[FrontmatterDocument | None, list[Issue]]:
    try:
        return (
            parse_frontmatter(
                path.read_text(encoding="utf-8"), source=path
            ),
            [],
        )
    except (OSError, ValueError) as error:
        return None, [_issue(code, vault_root, path, str(error))]


def _walk_vault(vault_root: Path) -> tuple[Path, ...]:
    paths: list[Path] = []
    for current, directories, files in os.walk(vault_root):
        current_path = Path(current)
        try:
            relative = current_path.resolve().relative_to(vault_root.resolve())
        except ValueError:
            directories[:] = []
            continue
        if relative.as_posix() == "projects/code":
            directories[:] = [
                directory for directory in directories if directory != "nanochat"
            ]
        directories[:] = [
            directory for directory in directories if directory != ".git"
        ]
        paths.extend(current_path / directory for directory in directories)
        paths.extend(current_path / filename for filename in files)
    return tuple(paths)


def check_required_layout(
    vault_root: Path, _git_state: GitStateReader
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
    vault_root: Path, _git_state: GitStateReader
) -> list[Issue]:
    issues: list[Issue] = []
    forbidden_directories = {
        ".llm_wiki",
        ".omc",
        ".cursor",
        ".codex",
        ".claude",
        "notes",
    }
    for path in _walk_vault(vault_root):
        if path.is_dir() and path.name in forbidden_directories:
            issues.append(
                _issue(
                    "forbidden.runtime-state",
                    vault_root,
                    path,
                    "runtime/editor state must not be committed to the vault",
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
                    "database state is outside the flat Markdown design",
                )
            )

    raw_dir = vault_root / "raw"
    raw_index = raw_dir / "index.md"
    if raw_index.exists():
        issues.append(
            _issue(
                "forbidden.raw-index",
                vault_root,
                raw_index,
                "raw evidence is discovered through provenance, not a raw index",
            )
        )
    if raw_dir.is_dir():
        for child in raw_dir.iterdir():
            if child.is_dir() and child.name != "assets":
                issues.append(
                    _issue(
                        "forbidden.raw-layout",
                        vault_root,
                        child,
                        "raw evidence must remain flat except for raw/assets",
                    )
                )
    return issues


def _mapping(value: object) -> dict[str, object] | None:
    return value if isinstance(value, dict) else None


def check_raw_snapshots(
    vault_root: Path, _git_state: GitStateReader
) -> list[Issue]:
    issues: list[Issue] = []
    raw_dir = vault_root / "raw"
    companion_stems: set[str] = set()
    for path in sorted(raw_dir.glob("*.md")):
        if path.name == "index.md":
            continue
        companion_stems.add(path.stem)
        document, read_issues = _read_document(
            vault_root, path, "raw.frontmatter"
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
                    "arxiv must contain a string id and integer version",
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

        if metadata.get("source_type") != "paper":
            issues.append(
                _issue(
                    "raw.metadata",
                    vault_root,
                    path,
                    "source_type must be paper",
                )
            )
        expected_source_url = f"https://arxiv.org/abs/{paper_id}v{version}"
        if metadata.get("source_url") != expected_source_url:
            issues.append(
                _issue(
                    "raw.metadata",
                    vault_root,
                    path,
                    f"source_url must be {expected_source_url}",
                )
            )
        if not isinstance(metadata.get("ingested"), str):
            issues.append(
                _issue(
                    "raw.metadata",
                    vault_root,
                    path,
                    "ingested must be an ISO date string",
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
            or attachment.get("path") != expected_attachment
            or attachment.get("media_type") != "application/pdf"
        ):
            issues.append(
                _issue(
                    "raw.attachment",
                    vault_root,
                    path,
                    f"attachment must be {expected_attachment}",
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
            attachment_hash = attachment.get("sha256")
            if (
                not isinstance(attachment_hash, str)
                or not HEX_SHA256.fullmatch(attachment_hash)
                or attachment_hash
                != sha256_bytes(attachment_path.read_bytes())
            ):
                issues.append(
                    _issue(
                        "raw.attachment-hash",
                        vault_root,
                        attachment_path,
                        "recorded sha256 does not match PDF bytes",
                    )
                )
        required_body_fragments = (
            "## Source metadata",
            "## Abstract",
            "## Mechanically extracted full text",
            f"(assets/{path.stem}.pdf)",
            "Extraction notice:",
        )
        if any(fragment not in document.body for fragment in required_body_fragments):
            issues.append(
                _issue(
                    "raw.body-contract",
                    vault_root,
                    path,
                    "raw body is missing metadata, abstract, extraction notice, "
                    "full text, or its local PDF link",
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


def _substantive_pages(vault_root: Path) -> tuple[Path, ...]:
    pages: list[Path] = []
    for directory in TYPE_DIRECTORIES.values():
        pages.extend(
            path
            for path in (vault_root / "wiki" / directory).glob("*.md")
            if path.name != "index.md"
        )
    return tuple(sorted(pages))


def _resource_target(
    vault_root: Path, source_path: Path, resource: str
) -> Path | None:
    return resolve_local_target(source_path, resource, vault_root)


def check_wiki_pages(
    vault_root: Path, _git_state: GitStateReader
) -> list[Issue]:
    issues: list[Issue] = []
    expected_by_directory = {
        directory: page_type
        for page_type, directory in TYPE_DIRECTORIES.items()
    }
    for path in _substantive_pages(vault_root):
        document, read_issues = _read_document(
            vault_root, path, "page.frontmatter"
        )
        issues.extend(read_issues)
        if document is None:
            continue
        metadata = document.metadata
        page_type = metadata.get("type")
        expected_type = expected_by_directory[path.parent.name]
        if (
            not isinstance(page_type, str)
            or page_type not in ALLOWED_PAGE_TYPES
            or page_type != expected_type
        ):
            issues.append(
                _issue(
                    "page.type",
                    vault_root,
                    path,
                    f"type must be {expected_type}",
                )
            )
            page_type = expected_type

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
            rf"^# {re.escape(title)}\s*$", document.body, re.MULTILINE
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

        sources = metadata.get("sources")
        if not isinstance(sources, list) or not sources:
            issues.append(
                _issue(
                    "page.sources",
                    vault_root,
                    path,
                    "sources must be a nonempty list",
                )
            )
        else:
            for source in sources:
                if not isinstance(source, dict):
                    issues.append(
                        _issue(
                            "page.sources",
                            vault_root,
                            path,
                            "every source must be an object",
                        )
                    )
                    continue
                if not all(
                    isinstance(source.get(key), str)
                    and source.get(key, "").strip()
                    for key in ("id", "resource", "title")
                ):
                    issues.append(
                        _issue(
                            "page.sources",
                            vault_root,
                            path,
                            "source requires id, resource, and title",
                        )
                    )
                    continue
                target = _resource_target(
                    vault_root, path, source["resource"]
                )
                if target is None or not target.exists():
                    issues.append(
                        _issue(
                            "page.source-missing",
                            vault_root,
                            path,
                            f"source does not resolve: {source['resource']}",
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
                                "page.source-commit",
                                vault_root,
                                path,
                                "Nanochat code source must record the pinned commit",
                            )
                        )

        status = metadata.get("status")
        if status not in ALLOWED_STATUSES:
            issues.append(
                _issue(
                    "page.status",
                    vault_root,
                    path,
                    "status is not an allowed value",
                )
            )
        generated = _mapping(metadata.get("generated"))
        if not generated or not isinstance(generated.get("by"), str):
            issues.append(
                _issue(
                    "page.generated",
                    vault_root,
                    path,
                    "generated.by must identify the compiling agent",
                )
            )

        missing_headings = [
            heading
            for heading in TYPE_HEADINGS[page_type]
            if not re.search(
                rf"^## {re.escape(heading)}\s*$",
                document.body,
                re.MULTILINE,
            )
        ]
        if missing_headings:
            issues.append(
                _issue(
                    "page.headings",
                    vault_root,
                    path,
                    f"missing required headings: {', '.join(missing_headings)}",
                )
            )
    return issues


def _markdown_files(vault_root: Path) -> tuple[Path, ...]:
    return tuple(
        sorted(
            path
            for path in _walk_vault(vault_root)
            if path.is_file() and path.suffix.lower() == ".md"
        )
    )


def _resolve_link(
    vault_root: Path,
    source_path: Path,
    target: str,
    markdown_files: tuple[Path, ...],
) -> tuple[Path | None, bool]:
    path_part = target.split("#", 1)[0].split("?", 1)[0]
    if not path_part:
        return source_path.resolve(), False
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
    return (
        resolve_local_target(source_path, target, vault_root),
        False,
    )


def check_links(
    vault_root: Path, _git_state: GitStateReader
) -> list[Issue]:
    issues: list[Issue] = []
    markdown_files = _markdown_files(vault_root)
    generated_indexes = {
        (vault_root / "index.md").resolve(),
        (vault_root / "projects/index.md").resolve(),
        (vault_root / "wiki/index.md").resolve(),
        *(
            (vault_root / "wiki" / directory / "index.md").resolve()
            for directory in TYPE_DIRECTORIES.values()
        ),
    }
    substantive = {path.resolve() for path in _substantive_pages(vault_root)}
    for path in markdown_files:
        if path.resolve() in generated_indexes:
            continue
        text = path.read_text(encoding="utf-8")
        if text.startswith("---\n"):
            try:
                body = parse_frontmatter(text, source=path).body
            except ValueError:
                continue
        else:
            body = text
        compiled_targets: set[Path] = set()
        for link in markdown_targets(body):
            target, ambiguous = _resolve_link(
                vault_root, path, link.target, markdown_files
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
            if target.resolve() in substantive:
                compiled_targets.add(target.resolve())
        if path.resolve() in substantive and len(compiled_targets) < 2:
            issues.append(
                _issue(
                    "page.crosslinks",
                    vault_root,
                    path,
                    "substantive page must link to at least two compiled pages",
                )
            )
    return issues


def _conflict_entries(
    vault_root: Path, path: Path
) -> tuple[dict[str, object], ...]:
    try:
        metadata = parse_frontmatter(
            path.read_text(encoding="utf-8"), source=path
        ).metadata
    except (OSError, ValueError):
        return ()
    conflicts = metadata.get("conflicts")
    if not isinstance(conflicts, list):
        return ()
    return tuple(item for item in conflicts if isinstance(item, dict))


def check_conflicts(
    vault_root: Path, _git_state: GitStateReader
) -> list[Issue]:
    issues: list[Issue] = []
    for path in _substantive_pages(vault_root):
        document, _ = _read_document(vault_root, path, "page.frontmatter")
        if document is None:
            continue
        conflicts = document.metadata.get("conflicts")
        status = document.metadata.get("status")
        if status != "contested":
            if conflicts:
                issues.append(
                    _issue(
                        "conflict.malformed",
                        vault_root,
                        path,
                        "conflicts require status contested",
                    )
                )
            continue
        if not isinstance(conflicts, list) or not conflicts:
            issues.append(
                _issue(
                    "conflict.malformed",
                    vault_root,
                    path,
                    "contested page requires conflict entries",
                )
            )
            continue
        for conflict in conflicts:
            if (
                not isinstance(conflict, dict)
                or not isinstance(conflict.get("resource"), str)
                or not isinstance(conflict.get("observed"), str)
                or not isinstance(conflict.get("reason"), str)
            ):
                issues.append(
                    _issue(
                        "conflict.malformed",
                        vault_root,
                        path,
                        "conflict requires resource, observed, and reason",
                    )
                )
                continue
            target = _resource_target(
                vault_root, path, conflict["resource"]
            )
            if target is None or not target.is_file():
                issues.append(
                    _issue(
                        "conflict.malformed",
                        vault_root,
                        path,
                        f"conflict target does not resolve: {conflict['resource']}",
                    )
                )
                continue
            reverse = False
            for candidate in _conflict_entries(vault_root, target):
                resource = candidate.get("resource")
                if not isinstance(resource, str):
                    continue
                reverse_target = _resource_target(
                    vault_root, target, resource
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
                        f"conflict target does not link back: {conflict['resource']}",
                    )
                )
    return issues


def check_generated_indexes(
    vault_root: Path, _git_state: GitStateReader
) -> list[Issue]:
    try:
        expected = build_indexes(vault_root)
    except IndexBuildError as error:
        return [
            _issue(
                "index.build",
                vault_root,
                vault_root / "wiki",
                str(error),
            )
        ]
    issues: list[Issue] = []
    for path, content in expected.items():
        if not path.is_file() or path.read_text(encoding="utf-8") != content:
            issues.append(
                _issue(
                    "index.stale",
                    vault_root,
                    path,
                    "generated index differs from deterministic output",
                )
            )
    return issues


def check_project_submodule(
    vault_root: Path, git_state: GitStateReader
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
        vault_root, card_path, "project.card"
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
                "gitlink and initialized checkout must match the pinned commit",
            )
        )
    return issues


def check_lfs_attributes(
    vault_root: Path, git_state: GitStateReader
) -> list[Issue]:
    issues: list[Issue] = []
    assets_dir = vault_root / "raw/assets"
    if not assets_dir.is_dir():
        return issues
    for path in sorted(path for path in assets_dir.rglob("*") if path.is_file()):
        if git_state.lfs_filter(path) != "lfs":
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
    check_raw_snapshots,
    check_wiki_pages,
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
    """Return every independently actionable vault-integrity issue."""
    vault_root = vault_root.absolute()
    state = git_state or RealGitState(vault_root)
    issues: list[Issue] = []
    for check in CHECKS:
        issues.extend(check(vault_root, state))
    return tuple(sorted(set(issues)))
