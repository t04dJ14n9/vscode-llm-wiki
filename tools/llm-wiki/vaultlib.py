from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
from urllib.parse import unquote

ALLOWED_PAGE_TYPES = frozenset(
    {"Summary", "Entity", "Concept", "Comparison", "Query"}
)
ALLOWED_STATUSES = frozenset({"draft", "stable", "deprecated"})
TAG_REGISTRY = (
    "alignment",
    "architecture",
    "attention",
    "data",
    "data-curation",
    "datasets",
    "distributed-training",
    "evaluation",
    "inference",
    "language-models",
    "numerics",
    "open-knowledge-format",
    "operations",
    "optimization",
    "paper",
    "post-training",
    "pretraining",
    "project-nanochat",
    "provenance",
    "reinforcement-learning",
    "reproducibility",
    "sampling",
    "small-models",
    "tokenization",
    "training-systems",
)

FRONTMATTER_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]*$")
MARKDOWN_LINK = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")
WIKI_LINK = re.compile(r"(?<!!)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]")


class FrontmatterError(ValueError):
    """Raised when the vault's dependency-free YAML subset is malformed."""


class RepositoryRegistryError(ValueError):
    """Raised when projects/repositories.yaml is outside the supported subset."""


@dataclass(frozen=True)
class RepositoryBinding:
    vcs: str
    url: str
    default_ref: str
    card: str
    vault: str
    code: str
    workspace: str
    update_strategy: str
    lfs: str

    @property
    def normalized_remote(self) -> str:
        return normalize_git_remote(self.url) if self.vcs == "git" else self.url.rstrip("/")


@dataclass(frozen=True)
class RepositoryRegistry:
    version: int
    repositories: dict[str, RepositoryBinding]


@dataclass(frozen=True)
class FrontmatterDocument:
    metadata: dict[str, Any]
    body: str


@dataclass(frozen=True)
class MarkdownTarget:
    target: str
    kind: Literal["markdown", "wiki"]


def default_vault_root() -> Path:
    """Return the repository's distributable demo-vault bundle root."""
    return Path(__file__).resolve().parents[2] / "demo-vault"


def normalize_git_remote(remote: str) -> str:
    """Normalize supported HTTPS, SSH, and scp-style Git remotes for comparison."""
    value = remote.strip().rstrip("/")
    scp = re.fullmatch(r"(?:[^@/]+@)?([^:/]+):(.+)", value)
    if scp and "://" not in value:
        host, repository = scp.groups()
    else:
        match = re.fullmatch(
            r"(?:https?|ssh|git)://(?:[^@/]+@)?([^/:]+)(?::[0-9]+)?/(.+)",
            value,
        )
        if not match:
            raise RepositoryRegistryError(f"unsupported repository remote: {remote}")
        host, repository = match.groups()
    repository = repository.removesuffix(".git").strip("/")
    if not host or not repository or ".." in Path(repository).parts:
        raise RepositoryRegistryError(f"unsupported repository remote: {remote}")
    return f"{host.lower()}/{repository}"


def parse_repository_registry(text: str) -> RepositoryRegistry:
    """Parse the intentionally small projects/repositories.yaml schema."""
    lines = text.replace("\r\n", "\n").splitlines()
    while lines and (not lines[-1].strip() or lines[-1].lstrip().startswith("#")):
        lines.pop()
    if len(lines) < 3 or lines[0] != "version: 1" or lines[1] != "repositories:":
        raise RepositoryRegistryError(
            "registry must start with version: 1 and repositories:"
        )

    fields = (
        "vcs",
        "url",
        "default_ref",
        "card",
        "vault",
        "code",
        "workspace",
        "update_strategy",
        "lfs",
    )
    repositories: dict[str, RepositoryBinding] = {}
    repository_id: str | None = None
    values: dict[str, str] = {}

    def publish() -> None:
        nonlocal values
        if repository_id is None:
            return
        missing = [field for field in fields if field not in values]
        if missing:
            raise RepositoryRegistryError(
                f"repository {repository_id} missing fields: {', '.join(missing)}"
            )
        if values["vcs"] not in {"git", "p4", "svn"}:
            raise RepositoryRegistryError(
                f"repository {repository_id} has unsupported vcs {values['vcs']}"
            )
        if values["workspace"] != "in-place" or values["update_strategy"] != "review" or values["lfs"] != "auto":
            raise RepositoryRegistryError(
                f"repository {repository_id} requires in-place workspace, review updates, and automatic LFS"
            )
        if (
            values["card"] != f"projects/{repository_id}.md"
            or values["vault"] != f"projects/{repository_id}"
            or values["code"] != f"projects/code/{repository_id}"
        ):
            raise RepositoryRegistryError(
                f"repository {repository_id} requires canonical card, vault, and code paths"
            )
        if values["vcs"] == "git":
            normalize_git_remote(values["url"])
        elif not values["url"].strip():
            raise RepositoryRegistryError(f"repository {repository_id} requires a VCS URL")
        repositories[repository_id] = RepositoryBinding(
            **{field: values[field] for field in fields}
        )
        values = {}

    for line_number, line in enumerate(lines[2:], start=3):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        repository_match = re.fullmatch(r"  ([a-z0-9][a-z0-9-]*):", line)
        if repository_match:
            publish()
            repository_id = repository_match.group(1)
            if repository_id in repositories:
                raise RepositoryRegistryError(
                    f"line {line_number}: duplicate repository {repository_id}"
                )
            continue
        field_match = re.fullmatch(r"    ([a-z_]+):\s*(\S(?:.*\S)?)", line)
        if repository_id is None or not field_match:
            raise RepositoryRegistryError(f"line {line_number}: unsupported YAML")
        key, value = field_match.groups()
        if key not in fields:
            raise RepositoryRegistryError(f"line {line_number}: unsupported field {key}")
        if key in values:
            raise RepositoryRegistryError(f"line {line_number}: duplicate field {key}")
        if value[:1] in {'"', "'", "[", "{"} or " #" in value or "\t" in value:
            raise RepositoryRegistryError(f"line {line_number}: unsupported scalar")
        values[key] = value
    publish()
    if not repositories:
        raise RepositoryRegistryError("registry requires at least one repository")
    return RepositoryRegistry(version=1, repositories=repositories)


def slugify_title(title: str) -> str:
    """Normalize a canonical source title into its immutable raw basename."""
    normalized = unicodedata.normalize("NFKD", title)
    ascii_text = "".join(
        character
        for character in normalized
        if character.isascii() and not unicodedata.combining(character)
    )
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _decode_scalar(raw: str, line_number: int) -> Any:
    value = raw.strip()
    if not value:
        raise FrontmatterError(
            f"line {line_number}: nested block YAML is unsupported; "
            "use JSON flow values"
        )
    if value[0] in '"[{':
        try:
            return json.loads(value)
        except json.JSONDecodeError as error:
            raise FrontmatterError(f"line {line_number}: {error.msg}") from error
    if value == "true":
        return True
    if value == "false":
        return False
    if value == "null":
        return None
    if re.fullmatch(r"-?[0-9]+", value):
        return int(value)
    return value


def parse_frontmatter(
    text: str, *, source: Path | None = None
) -> FrontmatterDocument:
    """Parse the vault's one-key-per-line, JSON-flow YAML 1.2 subset."""
    normalized = text.replace("\r\n", "\n")
    if not normalized.startswith("---\n"):
        label = str(source) if source else "document"
        raise FrontmatterError(
            f"{label}: missing opening frontmatter delimiter"
        )
    closing = normalized.find("\n---\n", 4)
    if closing < 0:
        raise FrontmatterError("missing closing frontmatter delimiter")
    raw_metadata = normalized[4:closing]
    body = normalized[closing + len("\n---\n") :]
    if body.startswith("\n"):
        body = body[1:]

    metadata: dict[str, Any] = {}
    for line_number, line in enumerate(raw_metadata.splitlines(), start=2):
        if not line.strip():
            continue
        if line[:1].isspace():
            raise FrontmatterError(
                f"line {line_number}: nested block YAML is unsupported; "
                "use JSON flow values"
            )
        key, separator, raw_value = line.partition(":")
        if not separator or not FRONTMATTER_KEY.fullmatch(key):
            raise FrontmatterError(
                f"line {line_number}: invalid frontmatter key"
            )
        if key in metadata:
            raise FrontmatterError(
                f"line {line_number}: duplicate key {key}"
            )
        metadata[key] = _decode_scalar(raw_value, line_number)
    return FrontmatterDocument(metadata=metadata, body=body)


def render_frontmatter(metadata: dict[str, Any], body: str) -> str:
    """Render stable YAML 1.2 using JSON-compatible flow values."""
    lines = ["---"]
    for key, value in metadata.items():
        if not FRONTMATTER_KEY.fullmatch(key):
            raise FrontmatterError(f"invalid frontmatter key: {key}")
        encoded = json.dumps(
            value, ensure_ascii=False, separators=(", ", ": ")
        )
        lines.append(f"{key}: {encoded}")
    lines.extend(["---", "", body.rstrip(), ""])
    return "\n".join(lines)


def strip_fenced_code_blocks(body: str) -> str:
    """Blank CommonMark fenced blocks while preserving surrounding lines."""
    output: list[str] = []
    fence_character: str | None = None
    fence_length = 0
    for line in body.splitlines(keepends=True):
        candidate = line.rstrip("\r\n")
        stripped = candidate.lstrip(" ")
        indentation = len(candidate) - len(stripped)
        marker_character: str | None = None
        marker_length = 0
        marker_rest = ""
        if indentation <= 3 and stripped[:1] in {"`", "~"}:
            marker_character = stripped[0]
            marker_length = len(stripped) - len(
                stripped.lstrip(marker_character)
            )
            marker_rest = stripped[marker_length:]

        is_marker = marker_character is not None and marker_length >= 3
        if fence_character is None:
            if is_marker and not (
                marker_character == "`" and "`" in marker_rest
            ):
                fence_character = marker_character
                fence_length = marker_length
                output.append("\n" if line.endswith(("\n", "\r")) else "")
            else:
                output.append(line)
            continue

        closes_fence = (
            is_marker
            and marker_character == fence_character
            and marker_length >= fence_length
            and not marker_rest.strip()
        )
        output.append("\n" if line.endswith(("\n", "\r")) else "")
        if closes_fence:
            fence_character = None
            fence_length = 0
    return "".join(output)


def strip_inline_code(body: str) -> str:
    """Blank Markdown inline-code spans while preserving line structure."""
    output = list(body)
    cursor = 0
    while cursor < len(body):
        if body[cursor] != "`":
            cursor += 1
            continue
        run_end = cursor
        while run_end < len(body) and body[run_end] == "`":
            run_end += 1
        fence = body[cursor:run_end]
        closing = body.find(fence, run_end)
        if closing < 0:
            cursor = run_end
            continue
        for index in range(cursor, closing + len(fence)):
            if output[index] != "\n":
                output[index] = " "
        cursor = closing + len(fence)
    return "".join(output)


def markdown_targets(body: str) -> tuple[MarkdownTarget, ...]:
    """Extract local standard Markdown and wiki-link destinations."""
    body = strip_inline_code(strip_fenced_code_blocks(body))
    targets: list[MarkdownTarget] = []
    for match in MARKDOWN_LINK.finditer(body):
        destination = match.group(1).strip()
        if destination.startswith("<") and ">" in destination:
            destination = destination[1 : destination.index(">")]
        else:
            destination = destination.split(maxsplit=1)[0]
        if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", destination):
            continue
        targets.append(MarkdownTarget(unquote(destination), "markdown"))
    for match in WIKI_LINK.finditer(body):
        targets.append(MarkdownTarget(unquote(match.group(1).strip()), "wiki"))
    return tuple(targets)


def resolve_local_target(
    source_file: Path, target: str, vault_root: Path
) -> Path | None:
    """Resolve a local target without allowing a vault-root escape."""
    path_part = target.split("#", 1)[0].split("?", 1)[0]
    if not path_part:
        return source_file.resolve()
    if path_part.startswith("/"):
        candidate = (vault_root / path_part.lstrip("/")).resolve()
    else:
        candidate = (source_file.parent / path_part).resolve()
    try:
        candidate.relative_to(vault_root.resolve())
    except ValueError:
        return None
    if candidate.exists():
        return candidate
    if candidate.suffix == "":
        candidate = candidate.with_suffix(".md")
    return candidate
