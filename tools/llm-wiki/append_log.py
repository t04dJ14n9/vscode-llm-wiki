#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from vaultlib import default_vault_root

LOG_FILE = "_log.md"
KINDS = {"learned": "Learned", "changed": "Changed", "maintained": "Maintained"}
EVENT_HEADING = re.compile(
    r"^## \[(\d{4}-\d{2}-\d{2})\] (learned|changed|maintained) \| (\S.*)$",
    re.MULTILINE,
)


class LogAppendError(RuntimeError):
    """Raised when an event cannot be safely appended to the vault log."""


def _single_line(value: str, field: str, maximum: int) -> str:
    normalized = value.strip()
    if not normalized or "\n" in normalized or "\r" in normalized or len(normalized) > maximum:
        raise LogAppendError(f"{field} must be one nonempty line of at most {maximum} code points")
    return normalized


def append_event(
    vault_root: Path,
    *,
    event_date: date,
    kind: str,
    subject: str,
    message: str,
) -> Path:
    root = vault_root.resolve()
    log = root / LOG_FILE
    if log.is_symlink() or not log.is_file():
        raise LogAppendError(f"{LOG_FILE} must be an existing regular file")
    normalized_kind = kind.lower()
    label = KINDS.get(normalized_kind)
    if label is None:
        raise LogAppendError(f"kind must be one of: {', '.join(KINDS)}")
    safe_subject = _single_line(subject, "subject", 160)
    safe_message = _single_line(message, "message", 2000)
    existing = log.read_text(encoding="utf-8")
    headings = tuple(line for line in existing.splitlines() if line.startswith("## "))
    matches = tuple(EVENT_HEADING.finditer(existing))
    if len(matches) != len(headings):
        raise LogAppendError(f"{LOG_FILE} contains a noncanonical event heading")
    try:
        prior_dates = tuple(date.fromisoformat(match.group(1)) for match in matches)
    except ValueError as error:
        raise LogAppendError(f"{LOG_FILE} contains an invalid event date") from error
    if prior_dates != tuple(sorted(prior_dates)):
        raise LogAppendError(f"{LOG_FILE} events are not ordered oldest first")
    if prior_dates and event_date < prior_dates[-1]:
        raise LogAppendError(
            f"event date {event_date.isoformat()} precedes the latest logged date {prior_dates[-1].isoformat()}"
        )
    prefix = "" if not existing or existing.endswith("\n") else "\n"
    event = (
        f"{prefix}\n## [{event_date.isoformat()}] {normalized_kind} | {safe_subject}\n\n"
        f"- **{label}**: {safe_message}\n"
    )
    with log.open("a", encoding="utf-8", newline="\n") as stream:
        stream.write(event)
    return log


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Append one immutable event to an LLM Wiki log.")
    parser.add_argument("--vault", type=Path, default=default_vault_root())
    parser.add_argument("--date", dest="event_date", type=date.fromisoformat)
    parser.add_argument("--kind", required=True, choices=tuple(KINDS))
    parser.add_argument("--subject", required=True)
    parser.add_argument("--message", required=True)
    arguments = parser.parse_args(argv)
    event_date = arguments.event_date or datetime.now(ZoneInfo("Asia/Shanghai")).date()
    try:
        log = append_event(
            arguments.vault,
            event_date=event_date,
            kind=arguments.kind,
            subject=arguments.subject,
            message=arguments.message,
        )
    except (LogAppendError, OSError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"appended {log.relative_to(arguments.vault.resolve())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
