#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable, Literal

from vaultlib import (
    default_vault_root,
    parse_frontmatter,
    render_frontmatter,
    sha256_bytes,
    slugify_title,
)

VERSIONED_ID = re.compile(
    r"^(?P<id>(?:[0-9]{4}\.[0-9]{4,5}|"
    r"[a-z-]+(?:\.[A-Z]{2})?/[0-9]{7}))"
    r"v(?P<version>[1-9][0-9]*)$",
    re.IGNORECASE,
)
VERSION_HISTORY = re.compile(
    r"\[v(?P<version>[1-9][0-9]*)\]\s+"
    r"[A-Za-z]{3},\s+"
    r"(?P<date>[0-9]{1,2}\s+[A-Za-z]{3}\s+[0-9]{4})"
)
CANONICAL_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
USER_AGENT = "llm-wiki/1.0 (+local research archive)"


class IngestError(RuntimeError):
    """Raised when a source cannot safely become an immutable snapshot."""


@dataclass(frozen=True)
class ArxivRef:
    paper_id: str
    version: int

    @property
    def versioned(self) -> str:
        return f"{self.paper_id}v{self.version}"


@dataclass(frozen=True)
class PaperMetadata:
    title: str
    authors: tuple[str, ...]
    submitted: str
    revised: str
    abstract: str
    license_id: str
    license_url: str


@dataclass(frozen=True)
class IngestResult:
    markdown_path: Path
    pdf_path: Path
    status: Literal["created", "unchanged"]


class _ArxivHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, list[str]] = {}
        self.license_url: str | None = None
        self.in_license_block = False
        self.in_submission_history = False
        self.submission_history: list[str] = []

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        attributes = {
            key.lower(): value for key, value in attrs if value is not None
        }
        if tag.lower() == "meta":
            name = attributes.get("name", "").lower()
            content = attributes.get("content")
            if name.startswith("citation_") and content is not None:
                self.meta.setdefault(name, []).append(content)
        elif tag.lower() == "a":
            rel = attributes.get("rel", "").lower().split()
            href = attributes.get("href")
            if ("license" in rel or self.in_license_block) and href:
                self.license_url = href
        elif tag.lower() == "div":
            classes = attributes.get("class", "").split()
            if "abs-license" in classes:
                self.in_license_block = True
            if "submission-history" in classes:
                self.in_submission_history = True

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "div":
            if self.in_license_block:
                self.in_license_block = False
            if self.in_submission_history:
                self.in_submission_history = False

    def handle_data(self, data: str) -> None:
        if self.in_submission_history:
            self.submission_history.append(data)


def parse_arxiv_ref(value: str) -> ArxivRef:
    match = VERSIONED_ID.fullmatch(value.strip())
    if not match:
        raise ValueError(
            "arXiv ID must be versioned, for example 1508.07909v5"
        )
    return ArxivRef(match.group("id"), int(match.group("version")))


def source_url(ref: ArxivRef) -> str:
    return f"https://arxiv.org/abs/{ref.versioned}"


def pdf_url(ref: ArxivRef) -> str:
    return f"https://arxiv.org/pdf/{ref.versioned}.pdf"


def _normalized_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _iso_date(value: str) -> str:
    return datetime.strptime(value, "%d %b %Y").date().isoformat()


def _normalize_license_url(value: str) -> str:
    normalized = value.strip().replace("http://", "https://", 1).rstrip("/")
    if normalized != CANONICAL_LICENSE_URL.rstrip("/"):
        return value.strip()
    return CANONICAL_LICENSE_URL


def parse_arxiv_metadata_html(
    ref: ArxivRef, html: str
) -> PaperMetadata:
    parser = _ArxivHtmlParser()
    parser.feed(html)

    def one(name: str) -> str:
        values = parser.meta.get(name, [])
        if len(values) != 1 or not _normalized_text(values[0]):
            raise IngestError(f"arXiv metadata is missing canonical {name}")
        return _normalized_text(values[0])

    title = one("citation_title")
    abstract = one("citation_abstract")
    authors = tuple(
        _normalized_text(author)
        for author in parser.meta.get("citation_author", [])
        if _normalized_text(author)
    )
    if not authors:
        raise IngestError("arXiv metadata is missing canonical authors")

    history_text = _normalized_text(" ".join(parser.submission_history))
    version_dates = {
        int(match.group("version")): _iso_date(match.group("date"))
        for match in VERSION_HISTORY.finditer(history_text)
    }
    if not version_dates:
        raise IngestError("arXiv metadata is missing submission history")
    if ref.version not in version_dates:
        raise IngestError(
            f"arXiv metadata does not contain requested version v{ref.version}"
        )

    if not parser.license_url:
        raise IngestError("arXiv metadata is missing license information")
    license_url = _normalize_license_url(parser.license_url)
    license_id = (
        "CC-BY-4.0"
        if license_url == CANONICAL_LICENSE_URL
        else "ARXIV-NONEXCLUSIVE"
    )
    return PaperMetadata(
        title=title,
        authors=authors,
        submitted=version_dates[min(version_dates)],
        revised=version_dates[ref.version],
        abstract=abstract,
        license_id=license_id,
        license_url=license_url,
    )


def fetch_arxiv_metadata(ref: ArxivRef) -> PaperMetadata:
    request = urllib.request.Request(
        source_url(ref), headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        html = response.read().decode("utf-8")
    return parse_arxiv_metadata_html(ref, html)


def download_arxiv_pdf(ref: ArxivRef, destination: Path) -> None:
    request = urllib.request.Request(
        pdf_url(ref), headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        content = response.read()
    if not content.startswith(b"%PDF-"):
        raise IngestError(
            f"arXiv returned a non-PDF payload for {ref.versioned}"
        )
    destination.write_bytes(content)


def extract_with_pdftotext(pdf_path: Path, text_path: Path) -> str:
    version_result = subprocess.run(
        ["pdftotext", "-v"],
        check=True,
        capture_output=True,
        text=True,
    )
    subprocess.run(
        ["pdftotext", "-layout", str(pdf_path), str(text_path)],
        check=True,
        capture_output=True,
        text=True,
    )
    if not text_path.exists() or not text_path.read_text(
        encoding="utf-8", errors="replace"
    ).strip():
        raise IngestError("pdftotext produced no readable text")
    version_lines = (
        version_result.stderr or version_result.stdout
    ).splitlines()
    if not version_lines:
        raise IngestError("could not determine pdftotext version")
    return version_lines[0].strip()


def _body(
    paper: PaperMetadata,
    ref: ArxivRef,
    attachment_resource: str,
    extraction_version: str,
    extracted_text: str,
) -> str:
    return f"""# {paper.title}

## Source metadata

- **Authors:** {", ".join(paper.authors)}
- **arXiv:** [{ref.versioned}]({source_url(ref)})
- **Submitted:** {paper.submitted}
- **Revised:** {paper.revised}
- **License:** [CC BY 4.0]({CANONICAL_LICENSE_URL})
- **Local attachment:** [Open the archived PDF]({attachment_resource})

> Extraction notice: The text below was produced mechanically with
> `{extraction_version}`. Reading order, equations, tables, figures, and
> footnotes may be lossy; use the archived PDF as the visual authority.

## Abstract

{paper.abstract}

## Mechanically extracted full text

{extracted_text}
"""


def _existing_ref(markdown_path: Path) -> ArxivRef | None:
    if not markdown_path.exists():
        return None
    document = parse_frontmatter(
        markdown_path.read_text(encoding="utf-8"), source=markdown_path
    )
    arxiv = document.metadata.get("arxiv")
    if not isinstance(arxiv, dict):
        return None
    paper_id = arxiv.get("id")
    version = arxiv.get("version")
    if not isinstance(paper_id, str) or not isinstance(version, int):
        return None
    return ArxivRef(paper_id, version)


def _select_basename(
    raw_dir: Path,
    assets_dir: Path,
    title_slug: str,
    ref: ArxivRef,
    pdf_sha256: str,
) -> str:
    for existing in sorted(raw_dir.glob("*.md")):
        if _existing_ref(existing) == ref:
            return existing.stem
    ordinary = raw_dir / f"{title_slug}.md"
    ordinary_pdf = assets_dir / f"{title_slug}.pdf"
    if not ordinary.exists() and not ordinary_pdf.exists():
        return title_slug

    collision = f"{title_slug}-{pdf_sha256[:12]}"
    collision_md = raw_dir / f"{collision}.md"
    collision_pdf = assets_dir / f"{collision}.pdf"
    if not collision_md.exists() and not collision_pdf.exists():
        return collision
    if _existing_ref(collision_md) == ref:
        return collision
    raise IngestError(
        f"title collision target already exists for {ref.versioned}"
    )


def _same_snapshot(
    markdown_path: Path,
    pdf_path: Path,
    ref: ArxivRef,
    body_sha256: str,
    pdf_sha256: str,
) -> bool:
    if not markdown_path.exists() or not pdf_path.exists():
        return False
    document = parse_frontmatter(
        markdown_path.read_text(encoding="utf-8"), source=markdown_path
    )
    return (
        _existing_ref(markdown_path) == ref
        and sha256_bytes(document.body.encode("utf-8")) == body_sha256
        and sha256_bytes(pdf_path.read_bytes()) == pdf_sha256
    )


def _publish_without_overwrite(staged: Path, final: Path) -> None:
    try:
        os.link(staged, final)
    except FileExistsError as error:
        raise IngestError(
            f"refusing to overwrite immutable target {final}"
        ) from error


def _generated_timestamp(
    generated_at: datetime | None,
    ingested_date: date | None,
) -> str:
    if generated_at is None:
        if ingested_date is not None:
            generated_at = datetime.combine(
                ingested_date,
                datetime.min.time(),
                tzinfo=timezone.utc,
            )
        else:
            generated_at = datetime.now(timezone.utc)
    elif generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=timezone.utc)
    return (
        generated_at.astimezone(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def ingest_paper(
    vault_root: Path,
    ref: ArxivRef,
    *,
    metadata_loader: Callable[[ArxivRef], PaperMetadata] = fetch_arxiv_metadata,
    pdf_loader: Callable[[ArxivRef, Path], None] = download_arxiv_pdf,
    extractor: Callable[[Path, Path], str] = extract_with_pdftotext,
    ingested_date: date | None = None,
    generated_at: datetime | None = None,
) -> IngestResult:
    """Fetch and atomically publish one immutable Markdown/PDF pair."""
    vault_root = vault_root.resolve()
    raw_dir = vault_root / "raw"
    assets_dir = vault_root / "assets"
    if not raw_dir.is_dir() or not assets_dir.is_dir():
        raise IngestError("evidence directories are incomplete: vault root")

    paper = metadata_loader(ref)
    normalized_license = _normalize_license_url(paper.license_url)
    if (
        paper.license_id != "CC-BY-4.0"
        or normalized_license != CANONICAL_LICENSE_URL
    ):
        raise IngestError(
            f"{ref.versioned} is not licensed CC BY 4.0; refusing to mirror"
        )

    title_slug = slugify_title(paper.title)
    if not title_slug:
        raise IngestError("canonical title does not produce a safe filename")
    with tempfile.TemporaryDirectory(
        prefix=".ingest-", dir=vault_root
    ) as temporary_directory:
        stage = Path(temporary_directory)
        staged_pdf = stage / "paper.pdf"
        staged_text = stage / "paper.txt"
        staged_markdown = stage / "paper.md"

        pdf_loader(ref, staged_pdf)
        pdf_bytes = staged_pdf.read_bytes() if staged_pdf.exists() else b""
        if not pdf_bytes.startswith(b"%PDF-"):
            raise IngestError(
                f"download for {ref.versioned} is missing or is not a PDF"
            )
        extraction_version = extractor(staged_pdf, staged_text)
        if not staged_text.exists():
            raise IngestError("extractor did not create its text output")
        extracted_text = staged_text.read_text(
            encoding="utf-8", errors="replace"
        )
        if not extracted_text.strip():
            raise IngestError("extractor produced no readable text")

        pdf_sha256 = sha256_bytes(pdf_bytes)
        basename = _select_basename(
            raw_dir,
            assets_dir,
            title_slug,
            ref,
            pdf_sha256,
        )
        attachment_resource = f"../assets/{basename}.pdf"
        canonical_body = (
            _body(
                paper,
                ref,
                attachment_resource,
                extraction_version,
                extracted_text,
            ).rstrip()
            + "\n"
        )
        body_sha256 = sha256_bytes(canonical_body.encode("utf-8"))
        effective_date = ingested_date or date.today()
        companion_metadata = {
            "type": "Paper",
            "title": paper.title,
            "description": f"Immutable arXiv snapshot of {paper.title}.",
            "resource": source_url(ref),
            "tags": ["paper"],
            "status": "stable",
            "generated": {
                "by": "process:arxiv-ingest",
                "at": _generated_timestamp(generated_at, ingested_date),
            },
            "sources": [
                {
                    "id": "arxiv-record",
                    "resource": source_url(ref),
                    "title": f"arXiv record for {paper.title}",
                    "last_modified": paper.revised,
                }
            ],
            "authors": list(paper.authors),
            "source_type": "paper",
            "source_url": source_url(ref),
            "ingested": effective_date.isoformat(),
            "submitted": paper.submitted,
            "revised": paper.revised,
            "sha256": body_sha256,
            "arxiv": {"id": ref.paper_id, "version": ref.version},
            "license": {
                "id": "CC-BY-4.0",
                "url": CANONICAL_LICENSE_URL,
            },
            "attachment": {
                "resource": attachment_resource,
                "role": "original",
                "media_type": "application/pdf",
                "bytes": len(pdf_bytes),
                "sha256": pdf_sha256,
            },
            "extraction": {
                "tool": "pdftotext",
                "version": extraction_version,
            },
        }
        staged_markdown.write_text(
            render_frontmatter(companion_metadata, canonical_body),
            encoding="utf-8",
        )

        final_markdown = raw_dir / f"{basename}.md"
        final_pdf = assets_dir / f"{basename}.pdf"
        if _existing_ref(final_markdown) == ref:
            if _same_snapshot(
                final_markdown,
                final_pdf,
                ref,
                body_sha256,
                pdf_sha256,
            ):
                return IngestResult(
                    final_markdown, final_pdf, "unchanged"
                )
            raise IngestError(
                f"existing snapshot for {ref.versioned} is immutable "
                "and differs from the fetched source"
            )

        published_pdf = False
        try:
            _publish_without_overwrite(staged_pdf, final_pdf)
            published_pdf = True
            _publish_without_overwrite(staged_markdown, final_markdown)
        except Exception:
            if published_pdf:
                final_pdf.unlink(missing_ok=True)
            raise

    return IngestResult(final_markdown, final_pdf, "created")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Ingest one exact CC BY 4.0 arXiv paper version."
    )
    parser.add_argument("--id", required=True, dest="arxiv_id")
    parser.add_argument(
        "--vault",
        type=Path,
        default=default_vault_root(),
    )
    arguments = parser.parse_args(argv)
    try:
        result = ingest_paper(
            arguments.vault,
            parse_arxiv_ref(arguments.arxiv_id),
        )
    except (IngestError, OSError, subprocess.CalledProcessError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    vault_root = arguments.vault.resolve()
    print(
        result.status,
        result.markdown_path.relative_to(vault_root),
        result.pdf_path.relative_to(vault_root),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
