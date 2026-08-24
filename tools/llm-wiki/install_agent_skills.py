#!/usr/bin/env python3
from __future__ import annotations

import argparse
import filecmp
import shutil
import sys
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[2]
CANONICAL_ROOT = REPOSITORY / ".agents/skills"
DESTINATION_ROOT = Path(".agents/skills")
SKILL_NAMES = (
    "pdf",
    "humanizer",
    "arxiv",
    "grounded-citations",
    "research-paper-writing",
)


def same_tree(left: Path, right: Path) -> bool:
    comparison = filecmp.dircmp(left, right)
    if comparison.left_only or comparison.right_only or comparison.funny_files:
        return False
    if any(not filecmp.cmp(left / name, right / name, shallow=False) for name in comparison.common_files):
        return False
    return all(same_tree(left / name, right / name) for name in comparison.common_dirs)


def install(vault: Path, *, force: bool, skill_names: tuple[str, ...] = SKILL_NAMES) -> tuple[Path, ...]:
    root = vault.expanduser().resolve(strict=True)
    if not root.is_dir():
        raise ValueError("vault must be an existing directory")
    selected = tuple(dict.fromkeys(skill_names))
    if not selected or any(name not in SKILL_NAMES for name in selected):
        raise ValueError(f"skill must be one of: {', '.join(SKILL_NAMES)}")

    current = root
    for part in DESTINATION_ROOT.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("skill destination may not contain symlinks")

    plans: list[tuple[Path, Path, bool]] = []
    for name in selected:
        canonical = CANONICAL_ROOT / name
        destination = root / DESTINATION_ROOT / name
        if not (canonical / "SKILL.md").is_file():
            raise ValueError(f"canonical skill is incomplete: {name}")
        if destination.is_symlink():
            raise ValueError("skill destination may not be a symlink")
        unchanged = destination.is_dir() and same_tree(canonical, destination)
        if destination.exists() and not unchanged:
            if not destination.is_dir():
                raise ValueError("skill destination must be a directory")
            if not force:
                raise ValueError(
                    f"preserving customized skill at {destination}; rerun with --force to replace it"
                )
        plans.append((canonical, destination, unchanged))

    installed: list[Path] = []
    for canonical, destination, unchanged in plans:
        if not unchanged:
            if destination.exists():
                shutil.rmtree(destination)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(canonical, destination)
        installed.append(destination)
    return tuple(installed)


def main() -> int:
    parser = argparse.ArgumentParser(description="Install default agent skills into a vault")
    parser.add_argument("--vault", required=True, type=Path)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--skill", action="append", choices=SKILL_NAMES, dest="skills")
    args = parser.parse_args()
    try:
        destinations = install(
            args.vault,
            force=args.force,
            skill_names=tuple(args.skills) if args.skills else SKILL_NAMES,
        )
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    for destination in destinations:
        print(destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
