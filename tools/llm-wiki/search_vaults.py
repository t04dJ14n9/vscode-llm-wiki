#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

from vaultlib import FrontmatterError, parse_frontmatter


@dataclass(frozen=True)
class VaultTarget:
    vault_id: str
    root: Path
    search_roots: tuple[str, ...]
    ownership: str
    observed_revision: str
    card: str


def safe_relative_root(value: str) -> str:
    candidate = PurePosixPath(value)
    if not value or value.startswith("/") or "\\" in value or candidate.is_absolute() or any(part in {"", ".", ".."} for part in candidate.parts):
        raise ValueError(f"unsafe search root: {value!r}")
    return candidate.as_posix()


def load_targets(vault: Path, *, include_root: bool) -> tuple[VaultTarget, ...]:
    targets: list[VaultTarget] = []
    if include_root:
        targets.append(VaultTarget("root", vault, ("wiki",), "current vault", "working tree", ""))
    cards = vault / "vaults"
    if not cards.is_dir():
        return tuple(targets)
    for card in sorted(cards.glob("*.md")):
        if card.name == "_index.md" or card.is_symlink():
            continue
        try:
            document = parse_frontmatter(card.read_text(encoding="utf-8"), source=card)
        except (OSError, UnicodeDecodeError, FrontmatterError) as error:
            raise ValueError(f"cannot read vault card {card}: {error}") from error
        metadata: dict[str, Any] = document.metadata
        if metadata.get("type") != "Knowledge Vault":
            raise ValueError(f"vault card must use type Knowledge Vault: {card}")
        vault_id = metadata.get("vault_id")
        if not isinstance(vault_id, str) or vault_id != card.stem:
            raise ValueError(f"vault_id must match card filename: {card}")
        if metadata.get("vault_status") != "active":
            continue
        values = metadata.get("search_roots")
        if not isinstance(values, list) or not values or not all(isinstance(value, str) for value in values):
            raise ValueError(f"search_roots must be a nonempty string list: {card}")
        binding = vault / "vaults" / "bindings" / vault_id
        try:
            root = binding.resolve(strict=True)
        except OSError as error:
            raise ValueError(f"active vault binding is unavailable: {binding}") from error
        if not root.is_dir():
            raise ValueError(f"active vault binding is not a directory: {binding}")
        ownership = metadata.get("ownership")
        observed = metadata.get("observed_revision")
        targets.append(VaultTarget(
            vault_id,
            root,
            tuple(safe_relative_root(value) for value in values),
            ownership if isinstance(ownership, str) else "",
            observed if isinstance(observed, str) else "",
            str(card.relative_to(vault)),
        ))
    return tuple(targets)


def markdown_files(target: VaultTarget) -> Iterable[Path]:
    for relative in target.search_roots:
        root = target.root / relative
        if not root.is_dir() or root.is_symlink():
            continue
        for path in sorted(root.rglob("*.md")):
            if path.is_file() and not path.is_symlink():
                yield path


def search(targets: tuple[VaultTarget, ...], pattern: re.Pattern[str], limit: int) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    for target in targets:
        for path in markdown_files(target):
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except (OSError, UnicodeDecodeError):
                continue
            for number, line in enumerate(lines, start=1):
                if pattern.search(line):
                    matches.append({
                        "vault_id": target.vault_id,
                        "path": str(path.relative_to(target.root)),
                        "line": number,
                        "text": line.strip()[:500],
                        "ownership": target.ownership,
                        "observed_revision": target.observed_revision,
                        "card": target.card or None,
                    })
                    if len(matches) >= limit:
                        return matches
    return matches


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Search active registered knowledge vaults without writing them")
    parser.add_argument("--vault", required=True, type=Path)
    parser.add_argument("--query", required=True)
    parser.add_argument("--include-root", action="store_true")
    parser.add_argument("--ignore-case", action="store_true")
    parser.add_argument("--regex", action="store_true")
    parser.add_argument("--max-results", type=int, default=100)
    arguments = parser.parse_args(argv)
    try:
        vault = arguments.vault.expanduser().resolve(strict=True)
        if not vault.is_dir() or arguments.max_results <= 0:
            raise ValueError("vault must be a directory and max-results must be positive")
        expression = arguments.query if arguments.regex else re.escape(arguments.query)
        flags = re.IGNORECASE if arguments.ignore_case else 0
        results = search(load_targets(vault, include_root=arguments.include_root), re.compile(expression, flags), arguments.max_results)
    except (OSError, ValueError, re.error) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    for result in results:
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
