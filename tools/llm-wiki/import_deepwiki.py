#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import tempfile
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, urlparse

from vaultlib import default_vault_root, parse_frontmatter, render_frontmatter, slugify_title


DEFAULT_URL = "https://deepwiki.com/karpathy/nanochat"
TEXT_HEADER = re.compile(r"(?:^|\n)([0-9a-f]+):T([0-9a-f]+),$")
PAGE_PLAN = re.compile(
    r'"page_plan":\{"id":"([^"]+)","title":"([^"]+)"\},'
    r'"content":"\$([0-9a-f]+)"'
)
MARKDOWN_LINK = re.compile(r"(?<!!)\[([^\]]+)\]\(([^)]*)\)")
DANGLING_EMPTY_LINK = re.compile(
    r"`?((?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+"
    r"\.(?:py|md|sh|toml|lock|json|ya?ml|txt|cfg|ini):\d+(?:-\d+)?)\]\(\)"
)
REPOSITORY_REFERENCE = re.compile(
    r"^(?P<path>(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+"
    r"(?:\.(?:py|md|sh|toml|lock|json|ya?ml|txt|cfg|ini)|Makefile|LICENSE))"
    r"(?::(?P<start>\d+)(?:-(?P<end>\d+))?)?$"
)


class DeepWikiImportError(RuntimeError):
    pass


@dataclass(frozen=True)
class DeepWikiPage:
    page_id: str
    title: str
    content: str
    source_url: str


@dataclass(frozen=True)
class DeepWikiSnapshot:
    repository: str
    commit: str
    generated_at: str
    pages: tuple[DeepWikiPage, ...]


class _ScriptParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._inside_script = False
        self._buffer: list[str] = []
        self.scripts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        del attrs
        if tag == "script":
            self._inside_script = True
            self._buffer = []

    def handle_data(self, data: str) -> None:
        if self._inside_script:
            self._buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._inside_script:
            self.scripts.append("".join(self._buffer))
            self._inside_script = False


def _next_payloads(document: str) -> tuple[str, ...]:
    parser = _ScriptParser()
    parser.feed(document)
    payloads: list[str] = []
    prefix = "self.__next_f.push("
    for script in parser.scripts:
        if not script.startswith(prefix) or not script.endswith(")"):
            continue
        try:
            value = json.loads(script[len(prefix) : -1])
        except json.JSONDecodeError:
            continue
        if (
            isinstance(value, list)
            and len(value) > 1
            and isinstance(value[1], str)
        ):
            payloads.append(value[1])
    return tuple(payloads)


def _text_records(payloads: tuple[str, ...]) -> dict[str, str]:
    records: dict[str, str] = {}
    index = 0
    while index < len(payloads):
        match = TEXT_HEADER.search(payloads[index])
        if not match:
            index += 1
            continue
        expected_bytes = int(match.group(2), 16)
        encoded = b""
        cursor = index + 1
        while cursor < len(payloads) and len(encoded) < expected_bytes:
            encoded += payloads[cursor].encode("utf-8")
            cursor += 1
        if len(encoded) < expected_bytes:
            raise DeepWikiImportError(
                f"truncated DeepWiki text record {match.group(1)}"
            )
        try:
            records[match.group(1)] = encoded[:expected_bytes].decode("utf-8")
        except UnicodeDecodeError as error:
            raise DeepWikiImportError(
                f"invalid UTF-8 in DeepWiki text record {match.group(1)}"
            ) from error
        index = cursor
    return records


def _page_routes(document: str, base_url: str) -> dict[str, str]:
    parsed = urlparse(base_url)
    prefix = f"/{parsed.path.strip('/')}"
    routes: dict[str, str] = {}
    for escaped in re.findall(r'href="([^"]+)"', document):
        route = html.unescape(escaped)
        if not route.startswith(f"{prefix}/"):
            continue
        tail = route[len(prefix) + 1 :]
        match = re.match(r"(\d+(?:\.\d+)?)-", tail)
        if match:
            routes[match.group(1)] = f"{parsed.scheme}://{parsed.netloc}{route}"
    return routes


def extract_snapshot(document: str, base_url: str = DEFAULT_URL) -> DeepWikiSnapshot:
    payloads = _next_payloads(document)
    if not payloads:
        raise DeepWikiImportError("DeepWiki page has no Next.js wiki payload")
    records = _text_records(payloads)
    payload_text = "\n".join(payloads)
    repository_match = re.search(r'"repo_name":"([^"]+)"', payload_text)
    commit_match = re.search(r'"commit_hash":"([0-9a-f]+)"', payload_text)
    generated_match = re.search(r'"generated_at":"([^"]+)"', payload_text)
    if not repository_match or not commit_match or not generated_match:
        raise DeepWikiImportError("DeepWiki wiki metadata is incomplete")
    routes = _page_routes(document, base_url)
    pages: list[DeepWikiPage] = []
    for page_id, title, record_id in PAGE_PLAN.findall(payload_text):
        content = records.get(record_id)
        if content is None:
            raise DeepWikiImportError(
                f"DeepWiki page {page_id} references missing record {record_id}"
            )
        pages.append(
            DeepWikiPage(
                page_id=page_id,
                title=title,
                content=content,
                source_url=routes.get(page_id, f"{base_url}/{page_id}"),
            )
        )
    if not pages:
        raise DeepWikiImportError("DeepWiki wiki contains no pages")
    if len({page.page_id for page in pages}) != len(pages):
        raise DeepWikiImportError("DeepWiki wiki contains duplicate page IDs")
    return DeepWikiSnapshot(
        repository=repository_match.group(1),
        commit=commit_match.group(1),
        generated_at=generated_match.group(1),
        pages=tuple(pages),
    )


def page_filename(page: DeepWikiPage) -> str:
    parts = page.page_id.split(".")
    try:
        numeric = "-".join(f"{int(part):02d}" for part in parts)
    except ValueError as error:
        raise DeepWikiImportError(f"unsafe DeepWiki page ID: {page.page_id}") from error
    slug = slugify_title(page.title)
    if not slug:
        raise DeepWikiImportError(f"unsafe DeepWiki page title: {page.title}")
    return f"deepwiki-{numeric}-{slug}.md"


def _repository_url(label: str, revision: str) -> str | None:
    match = REPOSITORY_REFERENCE.fullmatch(label.strip("`"))
    if not match:
        return None
    path = quote(match.group("path"), safe="/._-")
    fragment = ""
    if match.group("start"):
        fragment = f"#L{match.group('start')}"
        if match.group("end"):
            fragment += f"-L{match.group('end')}"
    return f"https://github.com/karpathy/nanochat/blob/{revision}/{path}{fragment}"


def rewrite_links(
    content: str,
    pages: tuple[DeepWikiPage, ...],
    revision: str,
) -> str:
    title_targets = {page.title.casefold(): page_filename(page) for page in pages}
    id_targets = {page.page_id: page_filename(page) for page in pages}

    def replace(match: re.Match[str]) -> str:
        label, destination = match.groups()
        title_target = title_targets.get(label.strip().casefold())
        if not destination and title_target:
            return f"[{label}]({title_target})"
        normalized_id = destination.lstrip("#")
        if normalized_id in id_targets:
            return f"[{label}]({id_targets[normalized_id]})"
        if destination.startswith(("http://", "https://", "mailto:")):
            return match.group(0)
        repository_target = _repository_url(label, revision)
        if repository_target:
            return f"[{label}]({repository_target})"
        if destination:
            path_target = _repository_url(destination.split("#", 1)[0], revision)
            if path_target:
                return f"[{label}]({path_target})"
        return label

    rewritten = MARKDOWN_LINK.sub(replace, content)

    def replace_dangling(match: re.Match[str]) -> str:
        label = match.group(1)
        repository_target = _repository_url(label, revision)
        return f"[{label}]({repository_target})" if repository_target else label

    return DANGLING_EMPTY_LINK.sub(replace_dangling, rewritten).strip() + "\n"


def _iso_timestamp(value: str) -> str:
    candidate = value
    if not re.search(r"(?:Z|[+-]\d\d:\d\d)$", candidate):
        candidate += "Z"
    datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    return candidate


def render_page(
    page: DeepWikiPage,
    snapshot: DeepWikiSnapshot,
    full_revision: str,
    retrieved_at: str,
) -> str:
    raw_sha256 = hashlib.sha256(page.content.encode("utf-8")).hexdigest()
    body = rewrite_links(page.content, snapshot.pages, full_revision)
    notice = (
        "> [!WARNING]\n"
        "> Imported from DeepWiki as generated, unverified repository documentation. "
        "Verify code-behavior claims against the revision below before stabilization.\n\n"
    )
    metadata = {
        "type": "Summary",
        "title": f"DeepWiki: {page.title}",
        "description": f"Imported DeepWiki page {page.page_id} about {page.title}.",
        "tags": ["project-nanochat", "repository-documentation", "provenance"],
        "status": "draft",
        "code_scope": True,
        "generated": {
            "by": "process:deepwiki-import",
            "at": _iso_timestamp(snapshot.generated_at),
        },
        "project": "nanochat",
        "provenance_state": "unverified",
        "repository": "nanochat",
        "revision": full_revision,
        "retrieved_at": retrieved_at,
        "deepwiki": {
            "page_id": page.page_id,
            "source_url": page.source_url,
            "indexed_revision": snapshot.commit,
            "content_sha256": raw_sha256,
        },
        "sources": [
            {
                "id": "deepwiki-page",
                "resource": page.source_url,
                "title": f"DeepWiki: {page.title}",
                "last_modified": snapshot.generated_at,
            }
        ],
    }
    return render_frontmatter(metadata, notice + body)


def import_snapshot(
    vault: Path,
    project: str,
    snapshot: DeepWikiSnapshot,
    retrieved_at: str,
) -> tuple[Path, ...]:
    card = vault / "projects" / f"{project}.md"
    if not card.is_file():
        raise DeepWikiImportError(f"project card is missing: {card}")
    card_document = parse_frontmatter(card.read_text(encoding="utf-8"), source=card)
    revision = card_document.metadata.get("studied_revision")
    if not isinstance(revision, str) or not revision.startswith(snapshot.commit):
        raise DeepWikiImportError(
            f"DeepWiki revision {snapshot.commit} does not match studied revision {revision}"
        )
    expected_repository = card_document.metadata.get("repository")
    if expected_repository != project or snapshot.repository != "karpathy/nanochat":
        raise DeepWikiImportError("DeepWiki repository does not match the project card")
    destination = vault / "projects" / project / "summaries"
    if not destination.is_dir():
        raise DeepWikiImportError(f"summary directory is missing: {destination}")
    outputs: list[Path] = []
    for page in snapshot.pages:
        target = destination / page_filename(page)
        content = render_page(page, snapshot, revision, retrieved_at)
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=destination,
            prefix=f".{target.name}.",
            delete=False,
        ) as temporary:
            temporary.write(content)
            temporary_path = Path(temporary.name)
        temporary_path.replace(target)
        outputs.append(target)
    return tuple(outputs)


def fetch(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "LLM-Wiki-for-VS-Code/0.2 DeepWiki importer"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Import every embedded DeepWiki page as an unverified code-vault Summary."
    )
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--project", default="nanochat")
    parser.add_argument("--vault", type=Path, default=default_vault_root())
    parser.add_argument(
        "--retrieved-at",
        default=datetime.now(timezone.utc).date().isoformat(),
    )
    arguments = parser.parse_args(argv)
    snapshot = extract_snapshot(fetch(arguments.url), arguments.url)
    outputs = import_snapshot(
        arguments.vault.resolve(),
        arguments.project,
        snapshot,
        arguments.retrieved_at,
    )
    print(
        f"imported {len(outputs)} DeepWiki pages at {snapshot.commit} into "
        f"{outputs[0].parent if outputs else arguments.vault}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
