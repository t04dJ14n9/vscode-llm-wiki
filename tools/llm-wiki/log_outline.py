from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

OUTLINE_SPLIT_FACTOR = 20
KINDS = {"learned": "Learned", "changed": "Changed", "maintained": "Maintained"}
EVENT_LEAF = re.compile(
    r"^- \[(\d{4}-\d{2}-\d{2})\] (learned|changed|maintained) \| (\S.*?) - \*\*(Learned|Changed|Maintained)\*\*: (\S.*)$",
    re.MULTILINE,
)
OUTLINE_HEADING = re.compile(r"^#{2,6} .+$", re.MULTILINE)
YEAR_HEADING = re.compile(r"^## (\d{4})$")
MONTH_HEADING = re.compile(r"^### (\d{4}-\d{2})$")
DAY_HEADING = re.compile(r"^#### (\d{4}-\d{2}-\d{2})$")


@dataclass(frozen=True)
class LogEvent:
    event_date: date
    kind: str
    subject: str
    body: str


def parse_log_events(text: str) -> tuple[str, tuple[LogEvent, ...]]:
    headings = tuple(OUTLINE_HEADING.finditer(text))
    first_outline = headings[0].start() if headings else len(text)
    prefix = text[:first_outline].rstrip()
    leaves = tuple(EVENT_LEAF.finditer(text))
    return prefix, tuple(
        LogEvent(
            date.fromisoformat(match.group(1)),
            match.group(2),
            match.group(3),
            f"- **{match.group(4)}**: {match.group(5)}",
        )
        for match in leaves
    )


def render_log_outline(prefix: str, events: tuple[LogEvent, ...]) -> str:
    lines = [prefix.rstrip()]
    prior_year: int | None = None
    prior_month: str | None = None
    prior_day: date | None = None
    for event in events:
        year = event.event_date.year
        month = event.event_date.strftime("%Y-%m")
        if year != prior_year:
            lines.extend(["", f"## {year}"])
            prior_year = year
            prior_month = None
            prior_day = None
        if month != prior_month:
            lines.extend(["", f"### {month}"])
            prior_month = month
            prior_day = None
        if event.event_date != prior_day:
            lines.extend(["", f"#### {event.event_date.isoformat()}"])
            prior_day = event.event_date
        lines.extend([
            "",
            f"- [{event.event_date.isoformat()}] {event.kind} | {event.subject} - {event.body.removeprefix('- ')}",
        ])
    return "\n".join(lines).rstrip() + "\n"


def validate_log_outline(text: str) -> tuple[str, ...]:
    errors: list[str] = []
    headings = tuple(OUTLINE_HEADING.finditer(text))
    year: int | None = None
    month: str | None = None
    day: date | None = None
    dates: list[date] = []
    for heading in headings:
        line = heading.group(0)
        if match := YEAR_HEADING.fullmatch(line):
            year = int(match.group(1))
            month = None
            day = None
            continue
        if match := MONTH_HEADING.fullmatch(line):
            if year is None or not match.group(1).startswith(f"{year:04d}-"):
                errors.append("month heading does not belong to its year")
            month = match.group(1)
            day = None
            continue
        if match := DAY_HEADING.fullmatch(line):
            try:
                parsed_day = date.fromisoformat(match.group(1))
            except ValueError:
                errors.append("day heading is not a real ISO date")
                continue
            if month is None or not parsed_day.isoformat().startswith(month + "-"):
                errors.append("day heading does not belong to its month")
            day = parsed_day
            continue
        errors.append(f"noncanonical outline heading: {line}")
    leaf_year: int | None = None
    leaf_month: str | None = None
    leaf_day: date | None = None
    for line in text.splitlines():
        if match := YEAR_HEADING.fullmatch(line):
            leaf_year = int(match.group(1))
            leaf_month = None
            leaf_day = None
            continue
        if match := MONTH_HEADING.fullmatch(line):
            leaf_month = match.group(1)
            leaf_day = None
            continue
        if match := DAY_HEADING.fullmatch(line):
            try:
                leaf_day = date.fromisoformat(match.group(1))
            except ValueError:
                leaf_day = None
            continue
        if not line.startswith("- ["):
            if re.match(r"^- \*\*(Learned|Changed|Maintained)\*\*:", line):
                errors.append("event must be one canonical list leaf")
            continue
        match = EVENT_LEAF.fullmatch(line)
        if not match:
            errors.append(f"malformed event list leaf: {line}")
            continue
        try:
            event_day = date.fromisoformat(match.group(1))
        except ValueError:
            errors.append("event list leaf has an invalid ISO date")
            continue
        if leaf_year is None or leaf_month is None or leaf_day is None or event_day != leaf_day:
            errors.append("event list leaf is outside its year/month/day hierarchy")
        dates.append(event_day)
    if dates != sorted(dates):
        errors.append("log events are not ordered oldest first")
    _, events = parse_log_events(text)
    if len(events) != len(dates):
        errors.append("every event must use one canonical list leaf")
    labels = KINDS
    for event in events:
        bullets = re.findall(r"^- \*\*(Learned|Changed|Maintained)\*\*:", event.body, re.MULTILINE)
        if bullets != [labels[event.kind]]:
            errors.append("event requires exactly one categorized bullet matching its kind")
    return tuple(errors)


def large_log_sections(text: str) -> tuple[tuple[str, int], ...]:
    _, events = parse_log_events(text)
    counts: dict[str, int] = {}
    for event in events:
        key = event.event_date.isoformat()
        counts[key] = counts.get(key, 0) + 1
    return tuple(
        (day, count) for day, count in sorted(counts.items())
        if count > OUTLINE_SPLIT_FACTOR
    )
