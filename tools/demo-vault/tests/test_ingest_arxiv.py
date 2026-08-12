import subprocess
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(SCRIPTS))

from ingest_arxiv import (
    ArxivRef,
    IngestError,
    PaperMetadata,
    ingest_paper,
    parse_arxiv_metadata_html,
    parse_arxiv_ref,
)
from vaultlib import parse_frontmatter, sha256_bytes


TITLE = "Neural Machine Translation of Rare Words with Subword Units"
SLUG = "neural-machine-translation-of-rare-words-with-subword-units"


def paper_metadata(
    *,
    title: str = TITLE,
    license_id: str = "CC-BY-4.0",
    license_url: str = "https://creativecommons.org/licenses/by/4.0/",
) -> PaperMetadata:
    return PaperMetadata(
        title=title,
        authors=("Rico Sennrich", "Barry Haddow", "Alexandra Birch"),
        submitted="2015-08-31",
        revised="2016-06-10",
        abstract="We introduce a simpler and more effective approach.",
        license_id=license_id,
        license_url=license_url,
    )


def pdf_loader_with(content: bytes):
    def load_pdf(_ref: ArxivRef, destination: Path) -> None:
        destination.write_bytes(content)

    return load_pdf


def successful_extractor(_pdf: Path, destination: Path) -> str:
    destination.write_text("mechanically extracted text\n", encoding="utf-8")
    return "pdftotext version 26.04.0"


class IngestArxivTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        (self.root / "raw" / "assets").mkdir(parents=True)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def ingest(
        self,
        ref: ArxivRef = ArxivRef("1508.07909", 5),
        *,
        metadata: PaperMetadata | None = None,
        pdf_bytes: bytes = b"%PDF-1.7\nfixture\n",
        extractor=successful_extractor,
    ):
        selected_metadata = metadata or paper_metadata()
        return ingest_paper(
            self.root,
            ref,
            metadata_loader=lambda _ref: selected_metadata,
            pdf_loader=pdf_loader_with(pdf_bytes),
            extractor=extractor,
            ingested_date=date(2026, 8, 13),
        )

    def test_parse_arxiv_ref_requires_version(self) -> None:
        with self.assertRaisesRegex(ValueError, "versioned"):
            parse_arxiv_ref("1508.07909")

    def test_parse_arxiv_ref_accepts_new_and_legacy_ids(self) -> None:
        modern = parse_arxiv_ref("2406.17557v2")
        legacy = parse_arxiv_ref("hep-th/9901001v3")
        self.assertEqual((modern.paper_id, modern.version), ("2406.17557", 2))
        self.assertEqual((legacy.paper_id, legacy.version), ("hep-th/9901001", 3))

    def test_metadata_parser_reads_canonical_fields_and_requested_version(self) -> None:
        html = (FIXTURES / "arxiv-1508.07909v5.html").read_text(
            encoding="utf-8"
        )
        metadata = parse_arxiv_metadata_html(
            ArxivRef("1508.07909", 5), html
        )
        self.assertEqual(metadata, paper_metadata())

    def test_ingest_publishes_matching_companion_and_pdf_atomically(self) -> None:
        result = self.ingest()

        self.assertEqual(result.status, "created")
        self.assertEqual(result.markdown_path.name, f"{SLUG}.md")
        self.assertEqual(result.pdf_path.name, f"{SLUG}.pdf")
        document = parse_frontmatter(
            result.markdown_path.read_text(encoding="utf-8")
        )
        self.assertEqual(
            document.metadata["arxiv"], {"id": "1508.07909", "version": 5}
        )
        self.assertEqual(
            document.metadata["attachment"]["sha256"],
            sha256_bytes(result.pdf_path.read_bytes()),
        )
        self.assertEqual(
            document.metadata["sha256"],
            sha256_bytes(document.body.encode("utf-8")),
        )
        self.assertIn("## Mechanically extracted full text", document.body)
        self.assertIn(f"(assets/{SLUG}.pdf)", document.body)
        self.assertNotIn("## Summary", document.body)

    def test_ingest_rejects_non_cc_by_without_writing_files(self) -> None:
        metadata = paper_metadata(
            license_id="ARXIV-NONEXCLUSIVE",
            license_url="https://arxiv.org/licenses/nonexclusive-distrib/1.0/",
        )
        with self.assertRaisesRegex(IngestError, "CC BY 4.0"):
            self.ingest(metadata=metadata)

        self.assertEqual(
            [path.relative_to(self.root).as_posix() for path in self.root.rglob("*")],
            ["raw", "raw/assets"],
        )

    def test_extraction_failure_leaves_no_markdown_or_pdf(self) -> None:
        def fail_extraction(_pdf: Path, _destination: Path) -> str:
            raise subprocess.CalledProcessError(1, ["pdftotext"])

        with self.assertRaises(subprocess.CalledProcessError):
            self.ingest(extractor=fail_extraction)

        self.assertEqual(tuple((self.root / "raw").glob("*.md")), ())
        self.assertEqual(tuple((self.root / "raw" / "assets").glob("*.pdf")), ())
        self.assertEqual(tuple(self.root.glob(".ingest-*")), ())

    def test_reingesting_identical_snapshot_is_a_noop(self) -> None:
        first = self.ingest()
        markdown_mtime = first.markdown_path.stat().st_mtime_ns
        pdf_mtime = first.pdf_path.stat().st_mtime_ns

        second = self.ingest()

        self.assertEqual(second.status, "unchanged")
        self.assertEqual(second.markdown_path.stat().st_mtime_ns, markdown_mtime)
        self.assertEqual(second.pdf_path.stat().st_mtime_ns, pdf_mtime)

    def test_reingesting_same_id_with_different_hash_fails(self) -> None:
        self.ingest()

        with self.assertRaisesRegex(IngestError, "immutable"):
            self.ingest(pdf_bytes=b"%PDF-1.7\nchanged\n")

        self.assertEqual(
            (self.root / "raw" / "assets" / f"{SLUG}.pdf").read_bytes(),
            b"%PDF-1.7\nfixture\n",
        )

    def test_title_collision_gets_source_suffix(self) -> None:
        first = self.ingest(ref=ArxivRef("9999.99999", 1))
        second = self.ingest(ref=ArxivRef("1508.07909", 5))

        self.assertEqual(first.markdown_path.name, f"{SLUG}.md")
        self.assertEqual(
            second.markdown_path.name,
            f"{SLUG}-arxiv-1508.07909-v5.md",
        )
        self.assertEqual(
            second.pdf_path.name,
            f"{SLUG}-arxiv-1508.07909-v5.pdf",
        )


if __name__ == "__main__":
    unittest.main()
