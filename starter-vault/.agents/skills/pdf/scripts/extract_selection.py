#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import stat
import sys
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath
from typing import Sequence
from urllib.parse import parse_qs, unquote, urlsplit

TEMP_PREFIX = "llm-wiki-pdf-selection-"
OWNER_MARKER = ".llm-wiki-pdf-selection"


@dataclass(frozen=True)
class PdfTarget:
    source: str
    page: int
    view_rect: tuple[float, float, float, float]


@dataclass(frozen=True)
class ExtractionResult:
    source: str
    sha256: str
    targets: tuple[PdfTarget, ...]
    raw_text: tuple[str, ...]
    extracted_text: str
    quote_status: str
    images: tuple[str, ...]
    cleanup_path: str | None


def parse_pdf_link(link: str) -> PdfTarget:
    if not isinstance(link, str) or not link.strip():
        raise ValueError("PDF link must be non-empty")
    parsed = urlsplit(link.strip())
    if parsed.scheme or parsed.netloc or parsed.query:
        raise ValueError("PDF source must be a vault-relative path")
    source = unquote(parsed.path)
    path = PurePosixPath(source)
    if (
        not source
        or source.startswith("/")
        or "\\" in source
        or path.is_absolute()
        or any(part in {"", ".", ".."} for part in path.parts)
        or ":" in path.parts[0]
        or path.suffix.lower() != ".pdf"
    ):
        raise ValueError("PDF source must be a safe relative .pdf path")
    try:
        values = parse_qs(
            parsed.fragment,
            keep_blank_values=True,
            strict_parsing=True,
        )
    except ValueError as error:
        raise ValueError("invalid PDF fragment") from error
    if set(values) != {"page", "viewrect"}:
        raise ValueError("PDF link requires only page and viewrect")
    if len(values["page"]) != 1 or len(values["viewrect"]) != 1:
        raise ValueError("PDF fragment parameters must be unique")
    try:
        page = int(values["page"][0])
    except (TypeError, ValueError) as error:
        raise ValueError("PDF page must be a positive integer") from error
    if page <= 0 or str(page) != values["page"][0]:
        raise ValueError("PDF page must be a positive integer")
    pieces = values["viewrect"][0].split(",")
    if len(pieces) != 4:
        raise ValueError("viewrect must contain left,top,width,height")
    try:
        view_rect = tuple(float(value) for value in pieces)
    except ValueError as error:
        raise ValueError("viewrect coordinates must be numbers") from error
    left, top, width, height = view_rect
    if (
        not all(math.isfinite(value) for value in view_rect)
        or left < 0
        or top < 0
        or width <= 0
        or height <= 0
    ):
        raise ValueError("viewrect must have finite non-negative origin and positive size")
    return PdfTarget(source=path.as_posix(), page=page, view_rect=view_rect)


def resolve_pdf_source(vault: Path, targets: Sequence[PdfTarget]) -> Path:
    if not targets:
        raise ValueError("at least one PDF target is required")
    sources = {target.source for target in targets}
    if len(sources) != 1:
        raise ValueError("all PDF targets must use the same source")
    root = vault.expanduser().resolve(strict=True)
    if not root.is_dir():
        raise ValueError("vault must be a directory")
    relative = PurePosixPath(targets[0].source)
    current = root
    for part in relative.parts:
        current = current / part
        try:
            mode = current.lstat().st_mode
        except OSError as error:
            raise ValueError(f"PDF source does not exist: {relative}") from error
        if stat.S_ISLNK(mode):
            raise ValueError("PDF source may not contain symlinks")
    try:
        current.relative_to(root)
    except ValueError as error:
        raise ValueError("PDF source escapes the vault") from error
    mode = current.stat().st_mode
    if not stat.S_ISREG(mode) or current.suffix.lower() != ".pdf":
        raise ValueError("PDF source must be an ordinary .pdf file")
    return current


def extract_selection(
    vault: Path,
    targets: Sequence[PdfTarget],
    expected_sha256: str,
    *,
    quote: str | None,
    render: bool,
) -> ExtractionResult:
    source_path = resolve_pdf_source(Path(vault), targets)
    expected = expected_sha256.strip().lower()
    if len(expected) != 64 or any(character not in "0123456789abcdef" for character in expected):
        raise ValueError("SHA-256 must be exactly 64 hexadecimal characters")
    actual = hashlib.sha256(source_path.read_bytes()).hexdigest()
    if actual != expected:
        raise ValueError(f"PDF source SHA-256 mismatch: expected {expected}, got {actual}")
    try:
        import pdfplumber
    except ImportError as error:
        raise RuntimeError(
            "pdfplumber is required. Run: uv run --with 'pdfplumber>=0.11,<0.12' "
            "python <script> ..."
        ) from error

    temporary: Path | None = None
    images: list[str] = []
    raw_text: list[str] = []
    try:
        if render:
            temporary = Path(tempfile.mkdtemp(prefix=TEMP_PREFIX))
            (temporary / OWNER_MARKER).write_text("owned\n", encoding="utf-8")
        with pdfplumber.open(source_path) as pdf:
            for index, target in enumerate(targets, start=1):
                if target.page > len(pdf.pages):
                    raise ValueError(
                        f"PDF page {target.page} exceeds document page count {len(pdf.pages)}"
                    )
                left, top, width, height = target.view_rect
                page = pdf.pages[target.page - 1]
                bbox = (left, top, left + width, top + height)
                cropped = page.crop(bbox, strict=True)
                raw_text.append(
                    cropped.extract_text(x_tolerance=2, y_tolerance=2) or ""
                )
                if temporary is not None:
                    image_path = temporary / f"selection-{index:03d}-page-{target.page}.png"
                    cropped.to_image(resolution=180, antialias=True).save(
                        image_path,
                        format="PNG",
                    )
                    images.append(str(image_path))
    except Exception:
        if temporary is not None:
            cleanup_render_directory(temporary)
        raise
    extracted = "\n\n".join(text.strip() for text in raw_text if text.strip())
    normalized_extracted = normalize_text(extracted)
    normalized_quote = normalize_text(quote or "")
    quote_status = (
        "not-requested"
        if not normalized_quote
        else "match"
        if normalized_quote in normalized_extracted
        else "mismatch"
    )
    return ExtractionResult(
        source=targets[0].source,
        sha256=actual,
        targets=tuple(targets),
        raw_text=tuple(raw_text),
        extracted_text=extracted,
        quote_status=quote_status,
        images=tuple(images),
        cleanup_path=str(temporary) if temporary is not None else None,
    )


def cleanup_render_directory(path: Path) -> None:
    candidate = Path(path).expanduser()
    temporary_root = Path(tempfile.gettempdir()).resolve(strict=True)
    if candidate.is_symlink():
        raise ValueError("cleanup path may not be a symlink")
    resolved = candidate.resolve(strict=True)
    if resolved.parent != temporary_root or not resolved.name.startswith(TEMP_PREFIX):
        raise ValueError("cleanup path is not an owned PDF selection directory")
    marker = resolved / OWNER_MARKER
    if marker.is_symlink() or not marker.is_file():
        raise ValueError("cleanup path is missing its ownership marker")
    for current, directories, files in os.walk(resolved, followlinks=False):
        for name in (*directories, *files):
            if (Path(current) / name).is_symlink():
                raise ValueError("cleanup path may not contain symlinks")
    shutil.rmtree(resolved)


def normalize_text(value: str) -> str:
    return " ".join(value.split())


def result_payload(result: ExtractionResult) -> dict[str, object]:
    payload = asdict(result)
    payload["targets"] = [asdict(target) for target in result.targets]
    return payload


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Extract portable LLM Wiki PDF selections")
    commands = parser.add_subparsers(dest="command", required=True)
    extract = commands.add_parser("extract", help="extract one or more page regions")
    extract.add_argument("--vault", required=True, type=Path)
    extract.add_argument("--link", required=True, action="append")
    extract.add_argument("--sha256", required=True)
    extract.add_argument("--quote")
    extract.add_argument("--render", action="store_true")
    cleanup = commands.add_parser("cleanup", help="remove a helper-owned render directory")
    cleanup.add_argument("--path", required=True, type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "cleanup":
            cleanup_render_directory(args.path)
            print(json.dumps({"cleaned": str(args.path)}))
            return 0
        targets = tuple(parse_pdf_link(link) for link in args.link)
        result = extract_selection(
            args.vault,
            targets,
            args.sha256,
            quote=args.quote,
            render=args.render,
        )
        print(json.dumps(result_payload(result), ensure_ascii=False))
        return 0 if result.quote_status != "mismatch" else 2
    except (OSError, RuntimeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
