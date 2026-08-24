import tempfile
import unittest
import sys
from datetime import date
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))

from append_log import LogAppendError, append_event


HEADER = """---
type: "Log"
title: "History"
description: "Append-only history."
---

# History
"""


class AppendLogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.log = self.root / "_log.md"
        self.log.write_text(HEADER, encoding="utf-8")

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_each_event_preserves_the_existing_byte_prefix(self):
        prefix = self.log.read_bytes()
        append_event(
            self.root,
            event_date=date(2026, 8, 23),
            kind="learned",
            subject="first subject",
            message="First message.",
        )
        after_first = self.log.read_bytes()
        self.assertTrue(after_first.startswith(prefix))
        append_event(
            self.root,
            event_date=date(2026, 8, 24),
            kind="maintained",
            subject="second subject",
            message="Second message.",
        )
        after_second = self.log.read_bytes()
        self.assertTrue(after_second.startswith(after_first))
        self.assertIn(b"## [2026-08-24] maintained | second subject", after_second)

    def test_rejects_backdated_events(self):
        append_event(
            self.root,
            event_date=date(2026, 8, 24),
            kind="changed",
            subject="newer",
            message="Newer event.",
        )
        with self.assertRaises(LogAppendError):
            append_event(
                self.root,
                event_date=date(2026, 8, 23),
                kind="changed",
                subject="older",
                message="Older event.",
            )

    def test_rejects_multiline_fields_and_log_symlinks(self):
        with self.assertRaises(LogAppendError):
            append_event(
                self.root,
                event_date=date(2026, 8, 24),
                kind="changed",
                subject="two\nlines",
                message="Message.",
            )
        real_log = self.root / "history.md"
        self.log.rename(real_log)
        self.log.symlink_to(real_log.name)
        with self.assertRaises(LogAppendError):
            append_event(
                self.root,
                event_date=date(2026, 8, 24),
                kind="changed",
                subject="subject",
                message="Message.",
            )

    def test_rejects_noncanonical_existing_history(self):
        self.log.write_text(HEADER + "\n## 2026-08-24\n", encoding="utf-8")
        with self.assertRaises(LogAppendError):
            append_event(
                self.root,
                event_date=date(2026, 8, 24),
                kind="changed",
                subject="subject",
                message="Message.",
            )


if __name__ == "__main__":
    unittest.main()
