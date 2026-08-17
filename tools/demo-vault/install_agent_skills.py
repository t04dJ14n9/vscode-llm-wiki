#!/usr/bin/env python3
from __future__ import annotations

import argparse
import filecmp
import shutil
import sys
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[2]
CANONICAL = REPOSITORY / ".agents/skills/pdf"
DESTINATION = Path(".agents/skills/pdf")


def same_tree(left: Path, right: Path) -> bool:
    comparison = filecmp.dircmp(left, right)
    if comparison.left_only or comparison.right_only or comparison.funny_files:
        return False
    if any(not filecmp.cmp(left / name, right / name, shallow=False) for name in comparison.common_files):
        return False
    return all(same_tree(left / name, right / name) for name in comparison.common_dirs)


def install(vault: Path, *, force: bool) -> Path:
    root = vault.expanduser().resolve(strict=True)
    if not root.is_dir():
        raise ValueError("vault must be an existing directory")
    if not (CANONICAL / "SKILL.md").is_file() or not (CANONICAL / "scripts/extract_selection.py").is_file():
        raise ValueError("canonical PDF skill is incomplete")
    destination = root / DESTINATION
    try:
        destination.relative_to(root)
    except ValueError as error:
        raise ValueError("skill destination escapes the vault") from error
    current = root
    for part in DESTINATION.parts[:-1]:
        current = current / part
        if current.is_symlink():
            raise ValueError("skill destination may not contain symlinks")
    if destination.is_symlink():
        raise ValueError("skill destination may not be a symlink")
    if destination.exists():
        if destination.is_dir() and same_tree(CANONICAL, destination):
            return destination
        if not force:
            raise ValueError(
                f"preserving customized skill at {destination}; rerun with --force to replace it"
            )
        if not destination.is_dir():
            raise ValueError("skill destination must be a directory")
        shutil.rmtree(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(CANONICAL, destination)
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description="Install default agent skills into a vault")
    parser.add_argument("--vault", required=True, type=Path)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    try:
        destination = install(args.vault, force=args.force)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
