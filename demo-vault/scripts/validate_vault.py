#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from vault_checks import validate_vault


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate demo-vault structure, provenance, and integrity."
    )
    parser.add_argument(
        "--vault",
        type=Path,
        default=Path(__file__).resolve().parents[1],
    )
    arguments = parser.parse_args(argv)
    issues = validate_vault(arguments.vault)
    if issues:
        for issue in issues:
            print(f"ERROR {issue.code} {issue.path}: {issue.message}")
        return 1
    print("vault valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
