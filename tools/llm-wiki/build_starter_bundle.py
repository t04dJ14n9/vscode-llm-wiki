#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import shutil
import tempfile
import zipfile
from pathlib import Path

from build_vault_runtime import render_runtime
from rebuild_indexes import update_indexes
from vault_checks import validate_vault


REPOSITORY = Path(__file__).resolve().parents[2]
SOURCE = REPOSITORY / "starter-vault"
DEFAULT_OUTPUT = REPOSITORY / "packages/vscode-extension/resources/llm-wiki-empty-vault.zip"
EMPTY_RUNTIME_DIRECTORIES = ("assets", "projects/code")
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def _raise_for_invalid_vault(root: Path) -> None:
    errors = tuple(issue for issue in validate_vault(root) if issue.severity == "error")
    if errors:
        details = "\n".join(
            f"[{issue.layer}] {issue.code} {issue.path}: {issue.message}"
            for issue in errors
        )
        raise ValueError(f"starter vault is invalid:\n{details}")


def _zip_info(relative: Path, *, directory: bool) -> zipfile.ZipInfo:
    name = relative.as_posix() + ("/" if directory else "")
    info = zipfile.ZipInfo(name, ZIP_TIMESTAMP)
    info.create_system = 3
    info.compress_type = zipfile.ZIP_STORED
    info.external_attr = ((0o40755 if directory else 0o100644) << 16)
    if directory:
        info.external_attr |= 0x10
    return info


def build_bundle_bytes(source: Path = SOURCE) -> bytes:
    root = source.resolve(strict=True)
    if not root.is_dir() or root.is_symlink():
        raise ValueError("starter source must be a real directory")
    for path in root.rglob("*"):
        if "node_modules" in path.relative_to(root).parts:
            continue
        if path.is_symlink():
            raise ValueError(f"starter source may not contain symlinks: {path}")

    with tempfile.TemporaryDirectory(prefix="llm-wiki-starter-") as directory:
        staging = Path(directory) / "vault"
        shutil.copytree(
            root,
            staging,
            ignore=shutil.ignore_patterns("node_modules", "__pycache__"),
        )
        (staging / "tools/llm-wiki/vault.py").write_text(
            render_runtime(), encoding="utf-8", newline="\n"
        )
        for relative in EMPTY_RUNTIME_DIRECTORIES:
            (staging / relative).mkdir(parents=True, exist_ok=True)
        update_indexes(staging, check=False)
        _raise_for_invalid_vault(staging)

        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            directories = sorted(
                (path for path in staging.rglob("*") if path.is_dir()),
                key=lambda path: path.relative_to(staging).as_posix(),
            )
            files = sorted(
                (path for path in staging.rglob("*") if path.is_file()),
                key=lambda path: path.relative_to(staging).as_posix(),
            )
            for path in directories:
                archive.writestr(
                    _zip_info(path.relative_to(staging), directory=True), b""
                )
            for path in files:
                archive.writestr(
                    _zip_info(path.relative_to(staging), directory=False),
                    path.read_bytes(),
                )
        return output.getvalue()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build the deterministic, ready-to-unpack empty vault bundle."
    )
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args(argv)

    try:
        expected = build_bundle_bytes(arguments.source)
    except (OSError, ValueError) as error:
        print(str(error))
        return 1

    output = arguments.output.resolve()
    if arguments.check:
        if not output.is_file() or output.read_bytes() != expected:
            print(f"starter bundle is stale: {output}")
            return 1
        print("starter bundle is up to date")
        return 0

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(expected)
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
