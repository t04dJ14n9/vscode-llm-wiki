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


def markdown_targets(body: str) -> tuple[MarkdownTarget, ...]:
    """Extract local standard Markdown and wiki-link destinations."""
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
    if candidate.suffix == "":
        candidate = candidate.with_suffix(".md")
    return candidate
