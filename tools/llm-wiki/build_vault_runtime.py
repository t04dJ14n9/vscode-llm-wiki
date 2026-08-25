#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[2]
TOOLS = Path(__file__).resolve().parent
TARGETS = (
    REPOSITORY / "starter-vault/tools/llm-wiki/vault.py",
    REPOSITORY / "demo-vault/tools/llm-wiki/vault.py",
)
MODULES = (
    "vaultlib",
    "log_outline",
    "rebuild_indexes",
    "vault_checks",
)


def render_runtime() -> str:
    sources = {
        name: (TOOLS / f"{name}.py").read_text(encoding="utf-8")
        for name in MODULES
    }
    return f'''#!/usr/bin/env python3
"""Generated self-contained LLM Wiki vault runtime; do not edit."""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import types
from pathlib import Path

MARKDOWNLINT_VERSION = "0.23.2"
_SOURCES = {sources!r}


def _install_module(name: str) -> types.ModuleType:
    module = types.ModuleType(name)
    module.__file__ = str(Path(__file__).with_name(f"{{name}}.py"))
    module.__package__ = ""
    sys.modules[name] = module
    exec(compile(_SOURCES[name], module.__file__, "exec"), module.__dict__)
    return module


for _name in {MODULES!r}:
    _install_module(_name)

from rebuild_indexes import IndexBuildError, update_indexes
from log_outline import parse_log_events, render_log_outline, validate_log_outline
from vault_checks import validate_vault


def vault_root() -> Path:
    return Path(__file__).resolve().parents[2]


def expected_log(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    prefix, events = parse_log_events(text)
    if not events and any(line.startswith(("## ", "##### ", "###### ", "- [")) for line in text.splitlines()):
        raise ValueError("log contains headings but no canonical event records")
    rendered = render_log_outline(prefix, events)
    errors = validate_log_outline(rendered)
    if errors:
        raise ValueError(errors[0])
    return rendered


def markdownlint_command(root: Path) -> list[str]:
    executable = root / "node_modules/.bin" / (
        "markdownlint-cli2.cmd" if os.name == "nt" else "markdownlint-cli2"
    )
    if executable.is_file():
        return [str(executable)]
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx:
        raise RuntimeError("markdownlint requires npm/npx; run npm install in the vault root")
    return [npx, "--yes", f"markdownlint-cli2@{{MARKDOWNLINT_VERSION}}"]


def rebuild(*, check: bool) -> int:
    root = vault_root()
    try:
        changed = list(update_indexes(root, check=check))
        log = root / "_log.md"
        expected = expected_log(log)
        if log.read_text(encoding="utf-8") != expected:
            if check:
                changed.append(log)
            else:
                log.write_text(expected, encoding="utf-8", newline="\\n")
    except (OSError, ValueError, IndexBuildError) as error:
        print(f"ERROR: {{error}}", file=sys.stderr)
        return 1
    if check and changed:
        for path in changed:
            print(f"stale {{path.relative_to(root)}}", file=sys.stderr)
        return 1
    if check:
        print("vault navigation is up to date")
    elif changed:
        for path in changed:
            print(f"updated {{path.relative_to(root)}}")
    else:
        print("vault navigation is already up to date")
    return 0


def validate() -> int:
    root = vault_root()
    try:
        lint = subprocess.run(markdownlint_command(root), cwd=root, check=False)
    except (OSError, RuntimeError) as error:
        print(f"ERROR: {{error}}", file=sys.stderr)
        return 1
    if lint.returncode:
        return lint.returncode
    issues = validate_vault(root)
    for issue in issues:
        print(f"{{issue.severity.upper()}} [{{issue.layer}}] {{issue.code}} {{issue.path}}: {{issue.message}}")
    errors = tuple(issue for issue in issues if issue.severity == "error")
    warnings = tuple(issue for issue in issues if issue.severity == "warning")
    if errors:
        return 1
    suffix = f" with {{len(warnings)}} warning(s)" if warnings else ""
    print(f"vault valid{{suffix}}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Rebuild or validate this LLM Wiki vault.")
    commands = parser.add_subparsers(dest="command", required=True)
    validate_parser = commands.add_parser("validate", help="Validate the vault and its Markdown.")
    validate_parser.set_defaults(action=lambda _args: validate())
    rebuild_parser = commands.add_parser("rebuild", help="Rebuild indexes and normalize the log outline.")
    rebuild_parser.add_argument("--check", action="store_true", help="Report stale generated files without writing.")
    rebuild_parser.set_defaults(action=lambda args: rebuild(check=args.check))
    arguments = parser.parse_args(argv)
    return arguments.action(arguments)


if __name__ == "__main__":
    raise SystemExit(main())
'''


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate the self-contained initialized-vault runtime.")
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args(argv)
    expected = render_runtime()
    stale = tuple(path for path in TARGETS if not path.is_file() or path.read_text(encoding="utf-8") != expected)
    if arguments.check and stale:
        for path in stale:
            print(f"stale {path.relative_to(REPOSITORY)}")
        return 1
    if not arguments.check:
        for path in stale:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(expected, encoding="utf-8", newline="\n")
    print("vault runtime is up to date" if not stale else "vault runtime written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
