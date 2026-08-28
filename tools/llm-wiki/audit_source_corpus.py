#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

from vaultlib import FrontmatterError, parse_frontmatter, sha256_bytes

INDEX_NAMES = {"_index.md"}
MARKDOWN_IMAGE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
WIKI_IMAGE = re.compile(r"!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]")
SECRET_PATTERNS = {
    "authorization": re.compile(
        r"(?i)\bauthorization\s*[:=]\s*[\"']?(?:bearer\s+)?[^\s\"']{8,}"
    ),
    "api-key": re.compile(
        r"(?i)\b(?:api[_-]?key|access[_-]?key)\s*[:=]\s*[\"']?[^\s\"']{8,}"
    ),
    "password": re.compile(
        r"(?i)\b(?:password|passwd|pwd)\s*[:=]\s*[\"']?[^\s\"']{8,}"
    ),
    "private-key": re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----"),
    "token": re.compile(
        r"(?i)\b(?:token|secret)\s*[:=]\s*[\"']?[A-Za-z0-9_./+=-]{16,}"
    ),
}


@dataclass(frozen=True)
class ExistingIdentity:
    path: str
    sha256: str
    source_urls: tuple[str, ...]


def canonical_url(value: str) -> str:
    return value.strip().rstrip("/")


def metadata_urls(metadata: dict[str, Any]) -> tuple[str, ...]:
    values: set[str] = set()
    for key in ("source_url", "resource"):
        value = metadata.get(key)
        if isinstance(value, str) and value.startswith(("http://", "https://")):
            values.add(canonical_url(value))
    sources = metadata.get("sources")
    if isinstance(sources, list):
        for source in sources:
            if not isinstance(source, dict):
                continue
            resource = source.get("resource")
            if isinstance(resource, str) and resource.startswith(
                ("http://", "https://")
            ):
                values.add(canonical_url(resource))
    return tuple(sorted(values))


def normalized_attachment_name(value: str) -> str:
    candidate = value.strip()
    if candidate.startswith("<") and ">" in candidate:
        candidate = candidate[1 : candidate.index(">")]
    parsed = urlsplit(candidate)
    if parsed.scheme in {"http", "https"}:
        return ""
    path = unquote(parsed.path).split("#", 1)[0]
    path = re.sub(r"&(?:amp;)?primitive=\d+$", "", path)
    return Path(path).name


def attachment_values(metadata: dict[str, Any], body: str) -> tuple[str, ...]:
    values: set[str] = set()
    attachments = metadata.get("attachments")
    if isinstance(attachments, list):
        for attachment in attachments:
            if not isinstance(attachment, dict):
                continue
            for key in ("resource", "path"):
                value = attachment.get(key)
                if isinstance(value, str):
                    values.add(value)
    attachment = metadata.get("attachment")
    if isinstance(attachment, dict):
        for key in ("resource", "path"):
            value = attachment.get(key)
            if isinstance(value, str):
                values.add(value)
    values.update(match.group(1) for match in MARKDOWN_IMAGE.finditer(body))
    values.update(match.group(1) for match in WIKI_IMAGE.finditer(body))
    return tuple(sorted(values))


def secret_findings(text: str) -> dict[str, list[int]]:
    findings: dict[str, list[int]] = {}
    for line_number, line in enumerate(text.splitlines(), start=1):
        for category, pattern in SECRET_PATTERNS.items():
            if pattern.search(line):
                findings.setdefault(category, []).append(line_number)
    return findings


def scan_existing(roots: tuple[Path, ...]) -> tuple[ExistingIdentity, ...]:
    identities: list[ExistingIdentity] = []
    for root in roots:
        if not root.is_dir():
            raise ValueError(f"existing root is not a directory: {root}")
        for path in sorted(root.rglob("*.md")):
            if path.name in INDEX_NAMES or path.is_symlink():
                continue
            data = path.read_bytes()
            try:
                document = parse_frontmatter(
                    data.decode("utf-8"), source=path
                )
                urls = metadata_urls(document.metadata)
            except (UnicodeDecodeError, FrontmatterError):
                urls = ()
            identities.append(
                ExistingIdentity(
                    path=str(path),
                    sha256=sha256_bytes(data),
                    source_urls=urls,
                )
            )
    return tuple(identities)


def audit(
    source_root: Path,
    *,
    asset_root: Path | None,
    existing: tuple[ExistingIdentity, ...],
) -> tuple[dict[str, Any], ...]:
    if not source_root.is_dir():
        raise ValueError(f"source is not a directory: {source_root}")
    by_hash: dict[str, list[str]] = {}
    by_url: dict[str, list[str]] = {}
    for identity in existing:
        by_hash.setdefault(identity.sha256, []).append(identity.path)
        for url in identity.source_urls:
            by_url.setdefault(url, []).append(identity.path)

    records: list[dict[str, Any]] = []
    for path in sorted(source_root.rglob("*.md")):
        if path.name in INDEX_NAMES or path.is_symlink():
            continue
        data = path.read_bytes()
        digest = sha256_bytes(data)
        parse_error = ""
        metadata: dict[str, Any] = {}
        body = ""
        try:
            text = data.decode("utf-8")
            document = parse_frontmatter(text, source=path)
            metadata = document.metadata
            body = document.body
        except (UnicodeDecodeError, FrontmatterError) as error:
            text = data.decode("utf-8", errors="replace")
            parse_error = str(error)

        urls = metadata_urls(metadata)
        duplicates = {
            "source_url": sorted(
                {match for url in urls for match in by_url.get(url, [])}
            ),
            "sha256": sorted(by_hash.get(digest, [])),
        }
        security = secret_findings(text)
        attachments: list[dict[str, Any]] = []
        missing: list[str] = []
        for raw_value in attachment_values(metadata, body):
            name = normalized_attachment_name(raw_value)
            if not name:
                continue
            candidate = (
                asset_root / name
                if asset_root is not None
                else path.parent / unquote(urlsplit(raw_value).path)
            )
            exists = candidate.is_file()
            if not exists:
                missing.append(name)
            attachments.append(
                {
                    "source": raw_value,
                    "normalized_name": name,
                    "exists": exists,
                    "bytes": candidate.stat().st_size if exists else None,
                    "sha256": (
                        sha256_bytes(candidate.read_bytes()) if exists else None
                    ),
                }
            )

        if security:
            disposition = "blocked-secret"
        elif parse_error:
            disposition = "blocked-invalid-frontmatter"
        elif missing:
            disposition = "blocked-missing-attachment"
        elif duplicates["source_url"] or duplicates["sha256"]:
            disposition = "already-represented"
        else:
            disposition = "candidate-review"

        records.append(
            {
                "schema_version": "llm-wiki-source-audit/v1",
                "source_path": str(path.relative_to(source_root)),
                "bytes": len(data),
                "sha256": digest,
                "title": metadata.get("title"),
                "description": metadata.get("description"),
                "source_type": metadata.get("source_type"),
                "source_urls": list(urls),
                "parse_error": parse_error or None,
                "security": {
                    "blocked": bool(security),
                    "categories": sorted(security),
                    "line_numbers": sorted(
                        {line for lines in security.values() for line in lines}
                    ),
                },
                "duplicates": duplicates,
                "attachments": attachments,
                "missing_attachments": sorted(set(missing)),
                "proposed_disposition": disposition,
                "decision": {
                    "disposition": None,
                    "destination": None,
                    "target": None,
                    "reason": None,
                },
            }
        )
    return tuple(records)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Audit a Markdown source corpus for identity, secrets, "
            "duplicates, and attachment closure without migrating it."
        )
    )
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--asset-root", type=Path)
    parser.add_argument(
        "--existing", action="append", default=[], type=Path
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument("--fail-on-blocked", action="store_true")
    arguments = parser.parse_args(argv)
    try:
        identities = scan_existing(tuple(arguments.existing))
        records = audit(
            arguments.source,
            asset_root=arguments.asset_root,
            existing=identities,
        )
    except (OSError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    rendered = "".join(
        json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
        for record in records
    )
    if arguments.output is None:
        sys.stdout.write(rendered)
    else:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(rendered, encoding="utf-8", newline="\n")
        print(f"wrote {arguments.output}")

    blocked = sum(
        record["proposed_disposition"].startswith("blocked-")
        for record in records
    )
    candidates = sum(
        record["proposed_disposition"] == "candidate-review"
        for record in records
    )
    represented = sum(
        record["proposed_disposition"] == "already-represented"
        for record in records
    )
    print(
        f"records={len(records)} blocked={blocked} "
        f"already_represented={represented} candidate_review={candidates}",
        file=sys.stderr,
    )
    return 1 if arguments.fail_on_blocked and blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())
