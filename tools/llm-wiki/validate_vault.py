#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from vault_checks import validate_vault
from vaultlib import default_vault_root


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate project-scoped LLM Wiki structure, provenance, and integrity."
    )
    parser.add_argument(
        "--vault",
        type=Path,
        default=default_vault_root(),
    )
    arguments = parser.parse_args(argv)
    issues = validate_vault(arguments.vault)
    for issue in issues:
        print(f"{issue.severity.upper()} [{issue.layer}] {issue.code} {issue.path}: {issue.message}")
    errors = tuple(issue for issue in issues if issue.severity == "error")
    warnings = tuple(issue for issue in issues if issue.severity == "warning")
    if errors:
        return 1
    suffix = f" with {len(warnings)} warning(s)" if warnings else ""
    print(f"vault valid{suffix}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
