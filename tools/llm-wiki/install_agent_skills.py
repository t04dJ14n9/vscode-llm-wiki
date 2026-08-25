#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[2]
CANONICAL_ROOT = REPOSITORY / ".agents/skills"
DISCOVERY_ROOTS = (Path(".claude/skills"), Path(".cursor/skills"), Path(".codex/skills"))
CURSOR_COMMAND_ROOT = Path(".cursor/commands")
SKILL_NAMES = ("pdf", "humanizer", "arxiv", "grounded-citations", "research-paper-writing")
SKILL_NAME = re.compile(r"^name:\s*[\"']?([^\"'\s]+)", re.MULTILINE)


def same_location(path: Path, source: Path) -> bool:
    try:
        return path.exists() and os.path.samefile(path, source)
    except OSError:
        return False


def create_directory_link(source: Path, destination: Path, *, force: bool) -> None:
    if same_location(destination, source):
        return
    if destination.is_symlink():
        if not force:
            raise ValueError(f"preserving existing link at {destination}; rerun with --force")
        destination.unlink()
    elif destination.exists():
        if not force:
            raise ValueError(f"preserving existing path at {destination}; rerun with --force")
        if destination.is_dir():
            shutil.rmtree(destination)
        else:
            destination.unlink()
    destination.parent.mkdir(parents=True, exist_ok=True)
    relative_source = os.path.relpath(source, destination.parent)
    try:
        destination.symlink_to(relative_source, target_is_directory=True)
        return
    except OSError:
        if os.name != "nt":
            raise
    result = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(destination), str(source)],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise OSError(f"could not create directory junction {destination}: {detail}")


def public_skill_name(skill: Path) -> str:
    match = SKILL_NAME.search((skill / "SKILL.md").read_text(encoding="utf-8"))
    if not match:
        raise ValueError(f"skill has no frontmatter name: {skill}")
    return match.group(1)


def write_cursor_command(vault: Path, skill: Path, *, force: bool) -> Path:
    name = public_skill_name(skill)
    destination = vault / CURSOR_COMMAND_ROOT / f"{name}.md"
    target = Path("../../.agents/skills") / skill.name / "SKILL.md"
    content = (
        "---\n"
        f'description: "Run the canonical {name} skill"\n'
        "---\n\n"
        f"Read and follow [{name}]({target.as_posix()}) for this request. "
        "Do not duplicate its rules in this command adapter.\n"
    )
    if destination.exists() and destination.read_text(encoding="utf-8") != content and not force:
        raise ValueError(f"preserving customized Cursor command at {destination}; rerun with --force")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(content, encoding="utf-8", newline="\n")
    return destination


def install(vault: Path, *, force: bool, skill_names: tuple[str, ...] = SKILL_NAMES) -> tuple[Path, ...]:
    root = vault.expanduser().resolve(strict=True)
    if not root.is_dir():
        raise ValueError("vault must be an existing directory")
    selected = tuple(dict.fromkeys(skill_names))
    if not selected or any(name not in SKILL_NAMES for name in selected):
        raise ValueError(f"skill must be one of: {', '.join(SKILL_NAMES)}")
    installed: list[Path] = []
    for name in selected:
        canonical = CANONICAL_ROOT / name
        if not (canonical / "SKILL.md").is_file():
            raise ValueError(f"canonical skill is incomplete: {name}")
        for discovery_root in DISCOVERY_ROOTS:
            destination = root / discovery_root / name
            create_directory_link(canonical, destination, force=force)
            installed.append(destination)
        installed.append(write_cursor_command(root, canonical, force=force))
    return tuple(installed)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Expose canonical skills to Codex, Claude Code, and Cursor without copying packages"
    )
    parser.add_argument("--vault", required=True, type=Path)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--skill", action="append", choices=SKILL_NAMES, dest="skills")
    args = parser.parse_args()
    try:
        destinations = install(args.vault, force=args.force, skill_names=tuple(args.skills) if args.skills else SKILL_NAMES)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    for destination in destinations:
        print(destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
