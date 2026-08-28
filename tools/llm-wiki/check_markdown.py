#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

MARKDOWNLINT_VERSION = "0.23.2"
REPOSITORY = Path(__file__).resolve().parents[2]
SKILL_GLOBS = (
    ".agents/skills/**/*.md",
    "starter-vault/.agents/skills/**/*.md",
    "demo-vault/.agents/skills/**/*.md",
)


def executable_command() -> list[str]:
    executable = REPOSITORY / "node_modules" / ".bin" / (
        "markdownlint-cli2.cmd" if os.name == "nt" else "markdownlint-cli2"
    )
    if executable.is_file():
        return [str(executable)]
    else:
        runner = shutil.which("pnpm") or shutil.which("pnpm.cmd")
        if not runner:
            raise RuntimeError(
                "markdownlint requires the repository dependency; run pnpm install"
            )
        return [runner, "exec", "markdownlint-cli2"]


def commands(*, fix: bool) -> tuple[list[str], ...]:
    base = executable_command()
    skills = [
        *executable_command(),
        *SKILL_GLOBS,
        "--no-globs",
        "--config",
        str(REPOSITORY / ".markdownlint.skills.jsonc"),
    ]
    if fix:
        base.append("--fix")
        skills.append("--fix")
    return base, skills


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Check repository-owned Markdown with pinned markdownlint profiles."
    )
    parser.add_argument("--fix", action="store_true")
    arguments = parser.parse_args(argv)
    try:
        for command in commands(fix=arguments.fix):
            result = subprocess.run(
                command,
                cwd=REPOSITORY,
                check=False,
            )
            if result.returncode:
                return result.returncode
    except (OSError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
