# Nanochat LLM Wiki Demo Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `demo-vault/` with a tracked, reproducible, source-backed Nanochat LLM wiki, then prove that the repository's VS Code extension can read and navigate it.

**Architecture:** The vault has three sequential layers: immutable raw arXiv evidence, a Nanochat Git submodule pinned to one commit, and an OKF v0.2 `wiki/` bundle compiled from those sources. Standard-library Python scripts own ingestion, deterministic index generation, and validation; the extension's existing Playwright/Extension Host harness gets a separate read-only demo-vault smoke suite. These are one plan rather than independent plans because the corpus is produced by the scripts, the wiki is grounded in that corpus and submodule, and the extension acceptance test consumes the finished vault.

**Tech Stack:** Python 3.11+ standard library, `pdftotext`/Poppler, Git LFS, Git submodules, Markdown with YAML 1.2 frontmatter, Node.js 20.19+, pnpm 10, TypeScript, Playwright, VS Code Extension Development Host.

## Global Constraints

- Replace `demo-vault/` in full; preserve the prior ignored directory only as `/private/tmp/human-learning-demo-vault-pre-okf-20260813` while implementation is in progress.
- Remove the root `.gitignore` rule that ignores `demo-vault/`; keep runtime state ignored inside `demo-vault/.gitignore`.
- Keep `raw/` flat: title-derived Markdown companions directly under `raw/`, matching PDFs under `raw/assets/`, and no `raw/index.md`.
- Derive raw basenames by Unicode NFKD normalization, removal of combining marks, ASCII lowercase retention, replacement of punctuation/whitespace runs with one hyphen, and trimming of edge hyphens.
- Store arXiv IDs and versions in frontmatter, not ordinary filenames; for example, a colliding `1508.07909v5` newcomer receives the suffix `-arxiv-1508.07909-v5`.
- Treat existing raw snapshots as immutable; identical re-ingestion is a no-op, while changed content or a different version must not overwrite an existing snapshot.
- Mirror only the eight exact versioned arXiv records listed below, and require `CC-BY-4.0` before publishing their PDFs.
- Track every file under `demo-vault/raw/assets/` with Git LFS; keep Markdown in ordinary Git.
- Use `wiki/` as the OKF v0.2 bundle root; keep `raw/` and `projects/` outside the OKF bundle.
- Give every substantive wiki page one allowed `type`, a registered tag list, explicit sources, `status`, and `generated.by`.
- Require at least two links to other substantive compiled pages from every substantive wiki page.
- Keep one project card at `projects/nanochat.md`; do not duplicate Nanochat as a wiki entity.
- Store Nanochat only as the Git submodule `projects/code/nanochat`, pinned to `92d63d4e8bb4df75c3b71618f31ddde2378b2bcd`.
- Do not add iWiki integration, a database, embeddings, a vector store, a raw catalog, copied Nanochat source, or committed extension runtime state.
- Do not change production extension behavior unless the demo smoke test reveals a concrete defect and the user separately authorizes that fix.
- Use JSON flow values inside the YAML frontmatter (`tags: ["tokenization"]`, `sources: [{"id": "arxiv-1508.07909v5"}]`). JSON flow values are valid YAML 1.2 and let the starter scripts remain dependency-free.
- Append material operations to the single `demo-vault/log.md`; never rewrite earlier log entries.

---

## File and Responsibility Map

### Repository boundary

- Modify `.gitignore` — stop ignoring `demo-vault/`.
- Create/modify `.gitmodules` — declare the Nanochat submodule.
- Preserve `.vscode/launch.json` — it already launches the extension against `demo-vault/`.

### Vault mechanics

- Create `demo-vault/.gitignore` — ignore `.llm_wiki/`, `.DS_Store`, temporary ingest directories, Python caches, and editor projections.
- Create `demo-vault/.gitattributes` — route `raw/assets/**` through Git LFS.
- Create `demo-vault/scripts/vaultlib.py` — shared types, constants, title slugging, deterministic YAML-subset frontmatter, hashing, and Markdown-link extraction.
- Create `demo-vault/scripts/ingest_arxiv.py` — exact-version arXiv metadata fetch, license gate, PDF download, text extraction, immutable pair publication.
- Create `demo-vault/scripts/rebuild_indexes.py` — pure index rendering plus `--check`/write CLI.
- Create `demo-vault/scripts/vault_checks.py` — structural, provenance, hash, link, conflict, submodule, LFS, and generated-index checks.
- Create `demo-vault/scripts/validate_vault.py` — thin CLI around `vault_checks.validate_vault`.
- Create `demo-vault/scripts/tests/test_vaultlib.py` — slug/frontmatter/hash/link unit tests.
- Create `demo-vault/scripts/tests/test_ingest_arxiv.py` — versioning, license, collision, idempotence, and failed-ingest tests.
- Create `demo-vault/scripts/tests/test_rebuild_indexes.py` — deterministic index tests.
- Create `demo-vault/scripts/tests/test_validate_vault.py` — validator fixture and failure-mode tests.
- Create `demo-vault/scripts/tests/test_operator_docs.py` — executable handbook and skill contract tests.
- Create `demo-vault/scripts/tests/test_sample_corpus.py` — exact eight-paper and 22-page acceptance inventory.

### Vault documentation and reusable workflow

- Create `demo-vault/README.md` — reader-first entry point and clone/submodule/LFS prerequisites.
- Create `demo-vault/SCHEMA.md` — authoritative raw, project, OKF page, conflict, tag, naming, and link contracts.
- Create `demo-vault/AGENTS.md` — normal orientation, ingest, compile, query, lint, conflict, submodule, and extension-smoke workflows.
- Create `demo-vault/CLAUDE.md` — pointer to `AGENTS.md` plus provider-specific context-window guidance only.
- Create `demo-vault/.agents/skills/llm-wiki/SKILL.md` — reusable setup/maintenance workflow.
- Create `demo-vault/.agents/skills/llm-wiki/references/arxiv-ingestion.md` — exact ingestion mechanics and failure policy.
- Create `demo-vault/.agents/skills/llm-wiki/references/frontmatter.md` — copyable metadata contracts.
- Create `demo-vault/log.md` — append-only operational history.

### Evidence and compiled knowledge

- Create the eight exact title-derived `demo-vault/raw/*.md` companions enumerated in Task 7 through `ingest_arxiv.py`.
- Create the eight exact same-basename `demo-vault/raw/assets/*.pdf` files enumerated in Task 7 through `ingest_arxiv.py`.
- Create `demo-vault/projects/nanochat.md` — pinned project card and code orientation.
- Create `demo-vault/projects/code/nanochat` — Git submodule gitlink.
- Create the 22 substantive pages listed under Tasks 8–10.
- Generate `demo-vault/index.md`, `demo-vault/projects/index.md`, `demo-vault/wiki/index.md`, and the five `demo-vault/wiki/*/index.md` files.

### Extension acceptance

- Modify `packages/vscode-extension/package.json` — add `test:vscode-e2e:demo-vault`.
- Modify `packages/vscode-extension/test/vscode-e2e/global-setup.mjs` — accept a workspace path and fixture-mutation flag from environment.
- Modify `packages/vscode-extension/test/vscode-e2e/global-teardown.mjs` — clean generated fixtures only for the fixture suite.
- Modify `packages/vscode-extension/test/vscode-e2e/playwright.config.mjs` — exclude the demo-only spec from the normal fixture suite.
- Create `packages/vscode-extension/test/vscode-e2e/demo-vault.playwright.config.mjs` — isolated test directory, report folder, and read-only workspace selection.
- Create `packages/vscode-extension/test/vscode-e2e/demo-vault.spec.ts` — root/wiki/raw/PDF/code/backlinks/outline smoke test and screenshots.
- Create `packages/vscode-extension/test/demoVaultE2eConfig.test.mjs` — unit-test the demo workspace/config boundary.

## Shared Interfaces and Constants

`demo-vault/scripts/vaultlib.py` owns these concrete data types:

```python
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

ALLOWED_PAGE_TYPES = frozenset({
    "summary", "entity", "concept", "comparison", "query",
})
ALLOWED_STATUSES = frozenset({"draft", "stable", "deprecated", "contested"})
TAG_REGISTRY = (
    "architecture",
    "attention",
    "data-curation",
    "datasets",
    "evaluation",
    "inference",
    "numerics",
    "optimization",
    "post-training",
    "pretraining",
    "project-nanochat",
    "reinforcement-learning",
    "small-models",
    "tokenization",
    "training-systems",
)

@dataclass(frozen=True)
class FrontmatterDocument:
    metadata: dict[str, Any]
    body: str

@dataclass(frozen=True)
class MarkdownTarget:
    target: str
    kind: Literal["markdown", "wiki"]

```

Its callable contracts are `slugify_title(title: str) -> str`,
`sha256_bytes(value: bytes) -> str`,
`parse_frontmatter(text: str, *, source: Path | None = None) -> FrontmatterDocument`,
`render_frontmatter(metadata: dict[str, Any], body: str) -> str`,
`markdown_targets(body: str) -> tuple[MarkdownTarget, ...]`, and
`resolve_local_target(source_file: Path, target: str, vault_root: Path) -> Path | None`.
Task 1 provides every concrete body and test.

`demo-vault/scripts/ingest_arxiv.py` owns:

```python
@dataclass(frozen=True)
class ArxivRef:
    paper_id: str
    version: int

    @property
    def versioned(self) -> str:
        return f"{self.paper_id}v{self.version}"

@dataclass(frozen=True)
class PaperMetadata:
    title: str
    authors: tuple[str, ...]
    submitted: str
    revised: str
    abstract: str
    license_id: str
    license_url: str

@dataclass(frozen=True)
class IngestResult:
    markdown_path: Path
    pdf_path: Path
    status: Literal["created", "unchanged"]


class IngestError(RuntimeError):
    pass

```

Its callable contracts are `parse_arxiv_ref(value: str) -> ArxivRef`,
`fetch_arxiv_metadata(ref: ArxivRef) -> PaperMetadata`, and
`ingest_paper(vault_root: Path, ref: ArxivRef, *, metadata_loader,
pdf_loader, extractor, ingested_date: date | None = None) -> IngestResult`.
The injected loaders use the defaults `fetch_arxiv_metadata`,
`download_arxiv_pdf`, and `extract_with_pdftotext` in production.

`demo-vault/scripts/rebuild_indexes.py` owns
`build_indexes(vault_root: Path) -> dict[Path, str]` and
`update_indexes(vault_root: Path, *, check: bool) -> tuple[Path, ...]`.

`demo-vault/scripts/vault_checks.py` owns:

```python
@dataclass(frozen=True, order=True)
class Issue:
    code: str
    path: str
    message: str

```

Its callable contract is
`validate_vault(vault_root: Path, *, git_state: GitStateReader | None = None) -> tuple[Issue, ...]`.

---

### Task 1: Replace the ignored demo and add dependency-free vault primitives

**Files:**
- Modify: `.gitignore`
- Create: `demo-vault/.gitignore`
- Create: `demo-vault/.gitattributes`
- Create: `demo-vault/scripts/__init__.py`
- Create: `demo-vault/scripts/vaultlib.py`
- Create: `demo-vault/scripts/tests/__init__.py`
- Create: `demo-vault/scripts/tests/test_vaultlib.py`

**Interfaces:**
- Consumes: Python 3 standard library only.
- Produces: `slugify_title`, `sha256_bytes`, `parse_frontmatter`, `render_frontmatter`, `markdown_targets`, `resolve_local_target`, and the shared constants/types above.

- [ ] **Step 1: Preserve the old ignored demo outside the worktree**

Run:

```bash
test ! -e /private/tmp/human-learning-demo-vault-pre-okf-20260813
mv demo-vault /private/tmp/human-learning-demo-vault-pre-okf-20260813
mkdir -p demo-vault/scripts/tests demo-vault/raw/assets demo-vault/projects/code demo-vault/wiki/summaries demo-vault/wiki/entities demo-vault/wiki/concepts demo-vault/wiki/comparisons demo-vault/wiki/queries
```

Expected: the prior ignored vault exists only at the explicit `/private/tmp` backup path, and the new tree contains no `.llm_wiki/`, `.omc/`, `notes/`, debug files, or legacy raw hierarchy.

- [ ] **Step 2: Write the failing primitive tests**

Create `demo-vault/scripts/tests/test_vaultlib.py` with these assertions:

```python
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from vaultlib import (
    FrontmatterError,
    markdown_targets,
    parse_frontmatter,
    render_frontmatter,
    resolve_local_target,
    sha256_bytes,
    slugify_title,
)


class VaultlibTests(unittest.TestCase):
    def test_slugify_title_matches_canonical_paper_filename(self) -> None:
        title = "SmolLM2: When Smol Goes Big -- Data-Centric Training of a Small Language Model"
        self.assertEqual(
            slugify_title(title),
            "smollm2-when-smol-goes-big-data-centric-training-of-a-small-language-model",
        )

    def test_slugify_title_removes_combining_marks_and_non_ascii(self) -> None:
        self.assertEqual(slugify_title("Café / 東京: LLMs"), "cafe-llms")

    def test_frontmatter_round_trip_preserves_nested_flow_values(self) -> None:
        metadata = {
            "title": "Byte-pair encoding",
            "type": "concept",
            "tags": ["tokenization", "project-nanochat"],
            "sources": [{
                "id": "arxiv-1508.07909v5",
                "resource": "../../raw/neural-machine-translation-of-rare-words-with-subword-units.md",
                "title": "Neural Machine Translation of Rare Words with Subword Units",
            }],
            "generated": {"by": "codex/gpt-5"},
        }
        rendered = render_frontmatter(metadata, "# Byte-pair encoding\n")
        parsed = parse_frontmatter(rendered)
        self.assertEqual(parsed.metadata, metadata)
        self.assertEqual(parsed.body, "# Byte-pair encoding\n")

    def test_frontmatter_rejects_indented_block_yaml(self) -> None:
        text = "---\ntitle: \"Bad\"\nsources:\n  - id: bad\n---\n\n# Bad\n"
        with self.assertRaisesRegex(FrontmatterError, "JSON flow values"):
            parse_frontmatter(text)

    def test_markdown_targets_find_local_markdown_and_wiki_links(self) -> None:
        body = (
            "[BPE](../concepts/byte-pair-encoding.md) "
            "[web](https://example.com) "
            "[[../entities/fineweb|FineWeb]]"
        )
        self.assertEqual(
            [(item.kind, item.target) for item in markdown_targets(body)],
            [
                ("markdown", "../concepts/byte-pair-encoding.md"),
                ("wiki", "../entities/fineweb"),
            ],
        )

    def test_resolve_local_target_rejects_workspace_escape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "wiki" / "concepts" / "page.md"
            source.parent.mkdir(parents=True)
            source.write_text("# page\n", encoding="utf-8")
            self.assertIsNone(resolve_local_target(source, "../../../outside.md", root))

    def test_sha256_bytes_is_lowercase_hex(self) -> None:
        self.assertEqual(
            sha256_bytes(b"nanochat"),
            "d550c60bac24e06d9ac899d37a97da4bbb26e29a52422a2b7fae89f5d7ef6cc0",
        )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run the tests and confirm the expected failure**

Run:

```bash
cd demo-vault
python3 -m unittest scripts.tests.test_vaultlib -v
```

Expected: FAIL because `vaultlib` does not exist.

- [ ] **Step 4: Implement the shared primitives**

Create `demo-vault/scripts/vaultlib.py`. Use these concrete rules:

```python
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
from urllib.parse import unquote

ALLOWED_PAGE_TYPES = frozenset({
    "summary", "entity", "concept", "comparison", "query",
})
ALLOWED_STATUSES = frozenset({"draft", "stable", "deprecated", "contested"})
TAG_REGISTRY = (
    "architecture",
    "attention",
    "data-curation",
    "datasets",
    "evaluation",
    "inference",
    "numerics",
    "optimization",
    "post-training",
    "pretraining",
    "project-nanochat",
    "reinforcement-learning",
    "small-models",
    "tokenization",
    "training-systems",
)
FRONTMATTER_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]*$")
MARKDOWN_LINK = re.compile(r"(?<!!)\\[[^\\]]+\\]\\(([^)]+)\\)")
WIKI_LINK = re.compile(r"(?<!!)\\[\\[([^\\]|#]+)(?:#[^\\]|]+)?(?:\\|[^\\]]+)?\\]\\]")


class FrontmatterError(ValueError):
    pass


@dataclass(frozen=True)
class FrontmatterDocument:
    metadata: dict[str, Any]
    body: str


@dataclass(frozen=True)
class MarkdownTarget:
    target: str
    kind: Literal["markdown", "wiki"]


def slugify_title(title: str) -> str:
    normalized = unicodedata.normalize("NFKD", title)
    ascii_text = "".join(
        character
        for character in normalized
        if character.isascii() and not unicodedata.combining(character)
    )
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _decode_scalar(raw: str, line_number: int) -> Any:
    value = raw.strip()
    if not value:
        raise FrontmatterError(
            f"line {line_number}: nested block YAML is unsupported; use JSON flow values"
        )
    if value[0] in '"[{':
        try:
            return json.loads(value)
        except json.JSONDecodeError as error:
            raise FrontmatterError(f"line {line_number}: {error.msg}") from error
    if value == "true":
        return True
    if value == "false":
        return False
    if value == "null":
        return None
    if re.fullmatch(r"-?[0-9]+", value):
        return int(value)
    return value


def parse_frontmatter(text: str, *, source: Path | None = None) -> FrontmatterDocument:
    normalized = text.replace("\r\n", "\n")
    if not normalized.startswith("---\n"):
        label = str(source) if source else "document"
        raise FrontmatterError(f"{label}: missing opening frontmatter delimiter")
    closing = normalized.find("\n---\n", 4)
    if closing < 0:
        raise FrontmatterError("missing closing frontmatter delimiter")
    raw_metadata = normalized[4:closing]
    body = normalized[closing + len("\n---\n"):]
    if body.startswith("\n"):
        body = body[1:]
    metadata: dict[str, Any] = {}
    for line_number, line in enumerate(raw_metadata.splitlines(), start=2):
        if not line.strip():
            continue
        if line[:1].isspace():
            raise FrontmatterError(
                f"line {line_number}: nested block YAML is unsupported; use JSON flow values"
            )
        key, separator, raw_value = line.partition(":")
        if not separator or not FRONTMATTER_KEY.fullmatch(key):
            raise FrontmatterError(f"line {line_number}: invalid frontmatter key")
        if key in metadata:
            raise FrontmatterError(f"line {line_number}: duplicate key {key}")
        metadata[key] = _decode_scalar(raw_value, line_number)
    return FrontmatterDocument(metadata=metadata, body=body)


def render_frontmatter(metadata: dict[str, Any], body: str) -> str:
    lines = ["---"]
    for key, value in metadata.items():
        if not FRONTMATTER_KEY.fullmatch(key):
            raise FrontmatterError(f"invalid frontmatter key: {key}")
        encoded = json.dumps(value, ensure_ascii=False, separators=(", ", ": "))
        lines.append(f"{key}: {encoded}")
    lines.extend(["---", "", body.rstrip(), ""])
    return "\n".join(lines)


def markdown_targets(body: str) -> tuple[MarkdownTarget, ...]:
    targets: list[MarkdownTarget] = []
    for match in MARKDOWN_LINK.finditer(body):
        destination = match.group(1).strip()
        if destination.startswith("<") and ">" in destination:
            destination = destination[1:destination.index(">")]
        else:
            destination = destination.split(maxsplit=1)[0]
        if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", destination):
            continue
        targets.append(MarkdownTarget(unquote(destination), "markdown"))
    for match in WIKI_LINK.finditer(body):
        targets.append(MarkdownTarget(unquote(match.group(1).strip()), "wiki"))
    return tuple(targets)


def resolve_local_target(source_file: Path, target: str, vault_root: Path) -> Path | None:
    path_part = target.split("#", 1)[0].split("?", 1)[0]
    if not path_part:
        return source_file.resolve()
    candidate = (source_file.parent / path_part).resolve()
    try:
        candidate.relative_to(vault_root.resolve())
    except ValueError:
        return None
    if candidate.suffix == "":
        candidate = candidate.with_suffix(".md")
    return candidate
```

Create `demo-vault/.gitattributes`:

```gitattributes
raw/assets/** filter=lfs diff=lfs merge=lfs -text
```

Create `demo-vault/.gitignore`:

```gitignore
.DS_Store
.llm_wiki/
.omc/
.cursor/
.claude/settings.local.json
.ingest-*/
scripts/__pycache__/
scripts/tests/__pycache__/
*.tmp
*.sqlite
*.sqlite-shm
*.sqlite-wal
```

Remove only the `demo-vault/` line from the root `.gitignore`. Add empty package markers at `demo-vault/scripts/__init__.py` and `demo-vault/scripts/tests/__init__.py`.

- [ ] **Step 5: Run primitive tests and repository-boundary checks**

Run:

```bash
cd demo-vault
python3 -m unittest scripts.tests.test_vaultlib -v
cd ..
if git check-ignore -q demo-vault/.gitattributes; then exit 1; fi
git diff --check
```

Expected: all seven tests PASS; `git check-ignore` exits 1 because the tracked sample is no longer ignored; `git diff --check` exits 0.

- [ ] **Step 6: Commit the clean vault foundation**

```bash
git add .gitignore demo-vault/.gitignore demo-vault/.gitattributes demo-vault/scripts
git commit -m "feat: establish tracked demo vault foundation"
```

---

### Task 2: Build exact-version, license-gated arXiv ingestion

**Files:**
- Create: `demo-vault/scripts/ingest_arxiv.py`
- Create: `demo-vault/scripts/tests/fixtures/arxiv-1508.07909v5.html`
- Create: `demo-vault/scripts/tests/test_ingest_arxiv.py`

**Interfaces:**
- Consumes: `slugify_title`, `sha256_bytes`, `parse_frontmatter`, and `render_frontmatter` from `vaultlib.py`; `pdftotext` on `PATH`.
- Produces: `ArxivRef`, `PaperMetadata`, `IngestResult`, `parse_arxiv_ref`, `fetch_arxiv_metadata`, `download_arxiv_pdf`, `extract_with_pdftotext`, and `ingest_paper`.

- [ ] **Step 1: Write failing ingestion tests**

The HTML fixture contains:

```html
<!doctype html>
<html>
<head>
  <meta name="citation_title" content="Neural Machine Translation of Rare Words with Subword Units">
  <meta name="citation_author" content="Rico Sennrich">
  <meta name="citation_author" content="Barry Haddow">
  <meta name="citation_author" content="Alexandra Birch">
  <meta name="citation_date" content="2016/06/10">
  <meta name="citation_abstract" content="We introduce a simpler and more effective approach.">
</head>
<body>
  <a rel="license" href="http://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>
  <div class="submission-history">
    [v1] Mon, 31 Aug 2015 19:00:41 UTC
    [v5] Fri, 10 Jun 2016 14:45:06 UTC
  </div>
</body>
</html>
```

Use a temporary vault in every test:

```python
class IngestArxivTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        (self.root / "raw/assets").mkdir(parents=True)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()
```

The core success method on that class is:

```python
def test_ingest_publishes_matching_companion_and_pdf_atomically(self) -> None:
    metadata = PaperMetadata(
        title="Neural Machine Translation of Rare Words with Subword Units",
        authors=("Rico Sennrich", "Barry Haddow", "Alexandra Birch"),
        submitted="2015-08-31",
        revised="2016-06-10",
        abstract="We introduce a simpler and more effective approach.",
        license_id="CC-BY-4.0",
        license_url="https://creativecommons.org/licenses/by/4.0/",
    )

    def load_metadata(ref: ArxivRef) -> PaperMetadata:
        self.assertEqual(ref.versioned, "1508.07909v5")
        return metadata

    def load_pdf(ref: ArxivRef, destination: Path) -> None:
        destination.write_bytes(b"%PDF-1.7\nfixture\n")

    def extract(pdf: Path, destination: Path) -> str:
        destination.write_text("mechanically extracted text\n", encoding="utf-8")
        return "pdftotext 26.04.0"

    result = ingest_paper(
        self.root,
        ArxivRef("1508.07909", 5),
        metadata_loader=load_metadata,
        pdf_loader=load_pdf,
        extractor=extract,
        ingested_date=date(2026, 8, 13),
    )

    self.assertEqual(result.status, "created")
    self.assertEqual(
        result.markdown_path.name,
        "neural-machine-translation-of-rare-words-with-subword-units.md",
    )
    document = parse_frontmatter(result.markdown_path.read_text(encoding="utf-8"))
    self.assertEqual(document.metadata["arxiv"], {"id": "1508.07909", "version": 5})
    self.assertEqual(
        document.metadata["attachment"]["sha256"],
        sha256_bytes(result.pdf_path.read_bytes()),
    )
    self.assertEqual(document.metadata["sha256"], sha256_bytes(document.body.encode()))
    self.assertIn("## Mechanically extracted full text", document.body)
    self.assertNotIn("## Summary", document.body)
```

Add these exact companion cases to the same file:

| Test | Input | Required assertion |
| --- | --- | --- |
| `test_parse_arxiv_ref_requires_version` | `1508.07909` | raises `ValueError` containing `versioned` |
| `test_parse_arxiv_ref_accepts_new_and_legacy_ids` | `2406.17557v2`, `hep-th/9901001v3` | returns the correct `paper_id` and integer `version` |
| `test_metadata_parser_reads_title_authors_abstract_and_license` | the checked-in HTML fixture | produces exact fixture metadata and normalized CC BY 4.0 URL |
| `test_ingest_rejects_non_cc_by_without_writing_files` | metadata with `license_id="ARXIV-NONEXCLUSIVE"` | raises `IngestError`; `raw/` remains empty except `assets/` |
| `test_extraction_failure_leaves_no_markdown_or_pdf` | extractor raises `CalledProcessError` | neither final target exists and no `.ingest-*` directory remains |
| `test_reingesting_identical_snapshot_is_a_noop` | call success fixture twice | second `IngestResult.status == "unchanged"` and mtimes do not change |
| `test_reingesting_same_id_with_different_hash_fails` | second loader returns changed PDF bytes | raises `IngestError` containing `immutable` |
| `test_title_collision_gets_source_suffix` | pre-create same title with a different arXiv ref | new basename ends in `-arxiv-1508.07909-v5` |

- [ ] **Step 2: Run ingestion tests and confirm the expected failure**

Run:

```bash
cd demo-vault
python3 -m unittest scripts.tests.test_ingest_arxiv -v
```

Expected: FAIL because `ingest_arxiv` does not exist.

- [ ] **Step 3: Implement parsing, fetching, staging, and publication**

Implement these concrete behaviors in `ingest_arxiv.py`:

```python
VERSIONED_ID = re.compile(
    r"^(?P<id>(?:[0-9]{4}\\.[0-9]{4,5}|[a-z-]+(?:\\.[A-Z]{2})?/[0-9]{7}))v(?P<version>[1-9][0-9]*)$",
    re.IGNORECASE,
)
ALLOWED_LICENSE_URLS = {
    "http://creativecommons.org/licenses/by/4.0/",
    "https://creativecommons.org/licenses/by/4.0/",
}


def parse_arxiv_ref(value: str) -> ArxivRef:
    match = VERSIONED_ID.fullmatch(value.strip())
    if not match:
        raise ValueError("arXiv ID must be versioned, for example 1508.07909v5")
    return ArxivRef(match.group("id"), int(match.group("version")))


def source_url(ref: ArxivRef) -> str:
    return f"https://arxiv.org/abs/{ref.versioned}"


def pdf_url(ref: ArxivRef) -> str:
    return f"https://arxiv.org/pdf/{ref.versioned}.pdf"
```

Use `html.parser.HTMLParser` to collect `citation_title`, repeated `citation_author`, `citation_date`, `citation_abstract`, the version rows in `div.submission-history`, and an `<a rel="license">` or Creative Commons license URL from the exact versioned abs page. The first submission-history row supplies `submitted`; the requested version's row supplies `revised`; a missing requested row is an ingestion error. Normalize the license URL by upgrading `http` to `https` and ignoring one trailing slash, require it to equal `https://creativecommons.org/licenses/by/4.0`, then record:

```python
license_id = "CC-BY-4.0"
license_url = "https://creativecommons.org/licenses/by/4.0/"
```

Fetch with:

```python
request = urllib.request.Request(
    source_url(ref),
    headers={"User-Agent": "delta-force-vault/1.0 (+local research archive)"},
)
with urllib.request.urlopen(request, timeout=30) as response:
    html = response.read().decode("utf-8")
```

Download the PDF from the exact `pdf_url(ref)`, require a `%PDF-` prefix, and extract with:

```python
version_result = subprocess.run(
    ["pdftotext", "-v"],
    check=True,
    capture_output=True,
    text=True,
)
subprocess.run(
    ["pdftotext", "-layout", str(pdf_path), str(text_path)],
    check=True,
    capture_output=True,
    text=True,
)
observed_version = (version_result.stderr or version_result.stdout).splitlines()[0].strip()
```

Render the raw body in this exact order:

```python
body = f"""# {paper.title}

## Source metadata

- **Authors:** {", ".join(paper.authors)}
- **arXiv:** [{ref.versioned}]({source_url(ref)})
- **Submitted:** {paper.submitted}
- **Revised:** {paper.revised}
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Local attachment:** [Open the archived PDF](assets/{basename}.pdf)

> Extraction notice: The text below was produced mechanically with the recorded
> `pdftotext` version. Reading order, equations, tables, figures, and footnotes
> may be lossy; use the archived PDF as the visual authority.

## Abstract

{paper.abstract}

## Mechanically extracted full text

{extracted_text}
"""
```

Use `TemporaryDirectory(prefix=".ingest-", dir=vault_root)` and do every network, extraction, metadata, and hash check before publishing. Publish the PDF first, then the Markdown; if publishing the Markdown raises, unlink only the just-published PDF. Never call `replace` on an existing final file.

Canonicalize the body before hashing:

```python
canonical_body = body.rstrip() + "\n"
body_sha256 = sha256_bytes(canonical_body.encode("utf-8"))
```

Then render this exact metadata dictionary:

```python
companion_metadata = {
    "title": paper.title,
    "source_type": "paper",
    "source_url": source_url(ref),
    "ingested": effective_date.isoformat(),
    "sha256": body_sha256,
    "arxiv": {"id": ref.paper_id, "version": ref.version},
    "license": {
        "id": "CC-BY-4.0",
        "url": "https://creativecommons.org/licenses/by/4.0/",
    },
    "attachment": {
        "path": f"assets/{basename}.pdf",
        "media_type": "application/pdf",
        "sha256": sha256_bytes(staged_pdf.read_bytes()),
    },
    "extraction": {
        "tool": "pdftotext",
        "version": observed_version,
    },
}
```

The CLI is:

```python
parser.add_argument("--id", required=True, dest="arxiv_id")
parser.add_argument("--vault", type=Path, default=Path(__file__).resolve().parents[1])
```

It prints one machine-readable line:

```text
created raw/neural-machine-translation-of-rare-words-with-subword-units.md raw/assets/neural-machine-translation-of-rare-words-with-subword-units.pdf
```

- [ ] **Step 4: Run all ingestion and primitive tests**

Run:

```bash
cd demo-vault
python3 -m unittest scripts.tests.test_vaultlib scripts.tests.test_ingest_arxiv -v
```

Expected: all tests PASS and no network is used by the unit tests.

- [ ] **Step 5: Commit the ingestion workflow**

```bash
git add demo-vault/scripts/ingest_arxiv.py demo-vault/scripts/tests
git commit -m "feat: add immutable arxiv ingestion workflow"
```

---

### Task 3: Generate deterministic navigation indexes

**Files:**
- Create: `demo-vault/scripts/rebuild_indexes.py`
- Create: `demo-vault/scripts/tests/test_rebuild_indexes.py`
- Create when the generator first runs: `demo-vault/index.md`
- Create when the generator first runs: `demo-vault/projects/index.md`
- Create when the generator first runs: `demo-vault/wiki/index.md`
- Create when the generator first runs: `demo-vault/wiki/summaries/index.md`
- Create when the generator first runs: `demo-vault/wiki/entities/index.md`
- Create when the generator first runs: `demo-vault/wiki/concepts/index.md`
- Create when the generator first runs: `demo-vault/wiki/comparisons/index.md`
- Create when the generator first runs: `demo-vault/wiki/queries/index.md`

**Interfaces:**
- Consumes: `parse_frontmatter`, `ALLOWED_PAGE_TYPES`, and `TAG_REGISTRY`.
- Produces: `PageRecord`, `IndexBuildError`, `build_indexes(vault_root)` as a pure byte renderer, and `update_indexes(vault_root, check=True|False)`.

- [ ] **Step 1: Write failing index tests**

The implementation record and error type are:

```python
@dataclass(frozen=True)
class PageRecord:
    path: Path
    title: str
    page_type: str
    description: str


class IndexBuildError(RuntimeError):
    pass
```

The tests use this concrete helper:

```python
def write_page(path: Path, *, title: str, page_type: str, description: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_frontmatter({
        "title": title,
        "type": page_type,
        "description": description,
        "tags": ["pretraining"],
        "sources": [{"id": "fixture", "resource": "../../raw/fixture.md", "title": "Fixture"}],
        "status": "stable",
        "generated": {"by": "test"},
    }, f"# {title}\n"), encoding="utf-8")
```

The tests create temporary pages and assert exact bytes:

```python
def test_build_indexes_is_sorted_and_never_creates_raw_index(self) -> None:
    write_page(
        self.root / "wiki/concepts/zeta.md",
        title="Zeta",
        page_type="concept",
        description="Later alphabetically.",
    )
    write_page(
        self.root / "wiki/concepts/alpha.md",
        title="Alpha",
        page_type="concept",
        description="Earlier alphabetically.",
    )
    outputs = build_indexes(self.root)
    concepts = outputs[self.root / "wiki/concepts/index.md"]
    self.assertLess(concepts.index("[Alpha](alpha.md)"), concepts.index("[Zeta](zeta.md)"))
    self.assertNotIn(self.root / "raw/index.md", outputs)
    self.assertEqual(outputs, build_indexes(self.root))
```

Add exact tests for:

- `wiki/index.md` frontmatter contains `okf_version == "0.2"` and the exact `TAG_REGISTRY`.
- root `index.md` links only to `wiki/index.md`, `projects/index.md`, `README.md`, and `log.md`.
- `projects/index.md` lists `projects/nanochat.md` when its title exists.
- `--check` reports stale and missing indexes without writing.
- write mode followed by `--check` returns an empty tuple.
- a page missing `title`, `description`, or `type` raises `IndexBuildError` instead of guessing.

- [ ] **Step 2: Run the index tests and confirm the expected failure**

Run:

```bash
cd demo-vault
python3 -m unittest scripts.tests.test_rebuild_indexes -v
```

Expected: FAIL because `rebuild_indexes` does not exist.

- [ ] **Step 3: Implement pure index rendering**

Use this fixed directory/type mapping and sort key:

```python
TYPE_DIRECTORIES = {
    "summary": "summaries",
    "entity": "entities",
    "concept": "concepts",
    "comparison": "comparisons",
    "query": "queries",
}


def page_sort_key(page: PageRecord) -> tuple[str, str]:
    return (page.title.casefold(), page.path.as_posix())
```

Each per-type index contains:

```markdown
<!-- Generated by scripts/rebuild_indexes.py; do not edit by hand. -->
# Concepts

- [Byte-Pair Encoding](byte-pair-encoding.md) — An open-vocabulary tokenization method that learns frequent symbol merges while preserving a fallback to smaller units.
```

`wiki/index.md` uses:

```yaml
---
okf_version: "0.2"
title: "Nanochat LLM Wiki"
description: "A source-backed guide to building a small language model end to end."
tag_registry: ["architecture", "attention", "data-curation", "datasets", "evaluation", "inference", "numerics", "optimization", "post-training", "pretraining", "project-nanochat", "reinforcement-learning", "small-models", "tokenization", "training-systems"]
generated: {"by": "demo-vault/scripts/rebuild_indexes.py"}
---
```

Its body links to all five typed indexes, `../projects/index.md`, and `../log.md`, and includes the generated warning. Root and project indexes also include that warning.

`update_indexes(vault_root, check=True)` returns every path whose current bytes differ and writes nothing. Write mode creates parents, writes UTF-8 with LF endings, and returns paths whose bytes changed.

- [ ] **Step 4: Run tests, then generate the empty navigation shell**

Run:

```bash
cd demo-vault
python3 -m unittest scripts.tests.test_rebuild_indexes -v
python3 scripts/rebuild_indexes.py
python3 scripts/rebuild_indexes.py --check
```

Expected: tests PASS; the write command lists the generated indexes; the check command exits 0 and prints `indexes up to date`.

- [ ] **Step 5: Commit deterministic indexes**

```bash
git add demo-vault/scripts/rebuild_indexes.py demo-vault/scripts/tests/test_rebuild_indexes.py demo-vault/index.md demo-vault/projects demo-vault/wiki
git commit -m "feat: generate deterministic vault indexes"
```

---

### Task 4: Validate schema, provenance, links, conflicts, artifacts, LFS, and the submodule

**Files:**
- Create: `demo-vault/scripts/vault_checks.py`
- Create: `demo-vault/scripts/validate_vault.py`
- Create: `demo-vault/scripts/tests/test_validate_vault.py`

**Interfaces:**
- Consumes: all shared parsing/constants, `build_indexes`, filesystem state, `.gitmodules`, and read-only Git commands.
- Produces: sorted `Issue` records and a CLI that prints one issue per line and exits 1 on any issue.

- [ ] **Step 1: Write a valid minimal-vault fixture and failing validator tests**

Build the fixture with one page of each type, local raw companion/PDF hashes, generated indexes, and a fake Git runner. The passing assertion is:

```python
issues = validate_vault(self.root, git_state=self.valid_git_state)
self.assertEqual(issues, ())
```

Add one isolated mutation per test and assert these exact issue codes:

| Test mutation | Expected code |
| --- | --- |
| create `raw/index.md` | `forbidden.raw-index` |
| remove `SCHEMA.md` | `layout.missing` |
| create `.llm_wiki/index.sqlite` | `forbidden.runtime-state` |
| change raw body after hashing | `raw.body-hash` |
| change PDF bytes after hashing | `raw.attachment-hash` |
| rename raw file away from title slug | `raw.title-path` |
| remove matching PDF | `raw.attachment-missing` |
| set page `type: "note"` | `page.type` |
| use unregistered tag | `page.tag` |
| remove one required type-specific heading | `page.headings` |
| remove a source resource | `page.source-missing` |
| add a broken Markdown link | `link.missing` |
| add an ambiguous basename-only wiki link | `link.ambiguous` |
| leave only one compiled-page link | `page.crosslinks` |
| add a one-way conflict | `conflict.asymmetric` |
| make an index stale | `index.stale` |
| set project card commit different from git state | `project.commit` |
| report Git mode other than `160000` | `project.gitlink` |
| report a PDF without LFS filter | `lfs.untracked` |

- [ ] **Step 2: Run the validator tests and confirm the expected failure**

Run:

```bash
cd demo-vault
python3 -m unittest scripts.tests.test_validate_vault -v
```

Expected: FAIL because `vault_checks` and `validate_vault` do not exist.

- [ ] **Step 3: Implement focused checks**

Implement one private function per responsibility and aggregate without early exit:

```python
from typing import Protocol


@dataclass(frozen=True)
class SubmoduleState:
    configured_path: str | None
    configured_url: str | None
    index_mode: str | None
    index_oid: str | None
    checkout_oid: str | None


class GitStateReader(Protocol):
    def nanochat_submodule(self) -> SubmoduleState:
        pass

    def lfs_filter(self, path: Path) -> str | None:
        pass


CHECKS = (
    check_required_layout,
    check_forbidden_state,
    check_raw_snapshots,
    check_wiki_pages,
    check_links,
    check_conflicts,
    check_generated_indexes,
    check_project_submodule,
    check_lfs_attributes,
)


def validate_vault(
    vault_root: Path,
    *,
    git_state: GitStateReader | None = None,
) -> tuple[Issue, ...]:
    state = git_state or RealGitState(vault_root)
    issues: list[Issue] = []
    for check in CHECKS:
        issues.extend(check(vault_root, state))
    return tuple(sorted(set(issues)))
```

Required structural rules:

- required root files: `.gitattributes`, `.gitignore`, `README.md`, `SCHEMA.md`, `AGENTS.md`, `CLAUDE.md`, `index.md`, and `log.md`;
- required workflow files: all four scripts, the bundled skill, and both skill references;
- required directories: `raw/assets`, `projects/code`, and the five typed `wiki/` directories;
- forbidden anywhere: `.llm_wiki`, `.omc`, `notes`, `*.sqlite`, `*.sqlite-shm`, `*.sqlite-wal`;
- forbidden under `raw/`: directories other than `assets/`, and any `index.md`;
- every `raw/*.md` must have the raw contract keys, exact title slug, CC BY 4.0, a relative attachment below `raw/assets/`, a matching body hash, and matching PDF hash;
- every non-index `wiki/*/*.md` must have `title`, allowed `type` matching its parent directory, one-sentence `description`, nonempty registered `tags`, nonempty structured `sources`, allowed `status`, and `generated.by`;
- every substantive page must contain the type-specific headings declared in `SCHEMA.md`;
- every `sources[].resource` must resolve inside the vault and exist; code sources must include the exact `commit`;
- every substantive body must link to at least two distinct non-index files under `wiki/`;
- every local Markdown/wiki link must resolve inside the vault; basename-only wiki links resolve only when exactly one candidate exists;
- `status: "contested"` requires nonempty `conflicts`; every `conflicts[].resource` must point back with a matching reverse conflict;
- generated bytes from `build_indexes` must equal files on disk;
- project card `pinned_commit`, `.gitmodules` URL/path, initialized submodule `HEAD`, and root index mode/OID must agree;
- `git check-attr filter -- demo-vault/raw/assets/neural-machine-translation-of-rare-words-with-subword-units.pdf` must report `lfs`, with the same rule applied to every archived PDF.

`RealGitState` discovers the repository root using the equivalent of
`git -C demo-vault rev-parse --show-toplevel`, parses `.gitmodules` with
`configparser.RawConfigParser`, reads the gitlink using the equivalent of
`git -C . ls-files --stage -- demo-vault/projects/code/nanochat`, reads the
initialized checkout using the equivalent of
`git -C demo-vault/projects/code/nanochat rev-parse HEAD`, and reads attributes
using the equivalent of
`git -C . check-attr filter -- demo-vault/raw/assets/neural-machine-translation-of-rare-words-with-subword-units.pdf`.

The thin CLI prints:

```text
ERROR raw.body-hash raw/example.md: recorded sha256 does not match Markdown body
```

and prints `vault valid` on success.

- [ ] **Step 4: Run all script tests and validate the empty shell**

Run:

```bash
cd demo-vault
python3 -m unittest discover -s scripts/tests -v
python3 scripts/validate_vault.py
```

Expected: unit tests PASS. Validation may report only actionable `layout.missing` issues for Task 5's not-yet-created documentation and `project.*` issues for Task 6's not-yet-added Nanochat project; it must report no raw, page, link, index, or forbidden-state errors.

- [ ] **Step 5: Commit validation**

```bash
git add demo-vault/scripts/vault_checks.py demo-vault/scripts/validate_vault.py demo-vault/scripts/tests/test_validate_vault.py
git commit -m "feat: validate demo vault integrity"
```

---

### Task 5: Document normal workflows and package the reusable LLM-wiki skill

**Files:**
- Create: `demo-vault/README.md`
- Create: `demo-vault/SCHEMA.md`
- Create: `demo-vault/AGENTS.md`
- Create: `demo-vault/CLAUDE.md`
- Create: `demo-vault/log.md`
- Create: `demo-vault/.agents/skills/llm-wiki/SKILL.md`
- Create: `demo-vault/.agents/skills/llm-wiki/references/arxiv-ingestion.md`
- Create: `demo-vault/.agents/skills/llm-wiki/references/frontmatter.md`
- Create: `demo-vault/scripts/tests/test_operator_docs.py`

**Interfaces:**
- Consumes: the exact CLI commands and schema from Tasks 1–4.
- Produces: the canonical operator handbook and a reusable vault setup/maintenance skill.

**Required sub-skills at execution time:** Read and follow `skill-creator` and `superpowers:writing-skills` before editing the skill files.

- [ ] **Step 1: Write failing documentation contract tests**

`test_operator_docs.py` must assert:

```python
REQUIRED_HEADINGS = (
    "## Initialize or audit a vault",
    "## Orientation",
    "## Ingest a source",
    "## Compile and update knowledge",
    "## Answer and file a query",
    "## Lint and rebuild",
    "## Handle conflicts",
    "## Maintain the Nanochat submodule",
    "## Test reading through the extension",
)
REQUIRED_COMMANDS = (
    "python3 scripts/ingest_arxiv.py --id 1508.07909v5",
    "python3 scripts/rebuild_indexes.py --check",
    "python3 scripts/rebuild_indexes.py",
    "python3 scripts/validate_vault.py",
    "python3 -m unittest discover -s scripts/tests",
    "git submodule update --init --recursive",
    "pnpm build:extension",
    "pnpm --filter llm-wiki-vscode test:vscode-e2e:demo-vault",
)


def test_agents_handbook_contains_executable_normal_workflows(self) -> None:
    text = (VAULT / "AGENTS.md").read_text(encoding="utf-8")
    for heading in REQUIRED_HEADINGS:
        self.assertIn(heading, text)
    for command in REQUIRED_COMMANDS:
        self.assertIn(command, text)


def test_claude_delegates_to_agents_without_copying_workflows(self) -> None:
    text = (VAULT / "CLAUDE.md").read_text(encoding="utf-8")
    self.assertIn("[AGENTS.md](AGENTS.md)", text)
    self.assertNotIn("## Ingest a source", text)


def test_skill_routes_to_both_reference_files(self) -> None:
    text = (VAULT / ".agents/skills/llm-wiki/SKILL.md").read_text(encoding="utf-8")
    self.assertIn("## Initialize or audit a vault", text)
    self.assertIn("references/arxiv-ingestion.md", text)
    self.assertIn("references/frontmatter.md", text)
    self.assertIn("Never hand-edit an existing raw snapshot", text)
```

- [ ] **Step 2: Run the documentation tests and confirm the expected failure**

Run:

```bash
cd demo-vault
python3 -m unittest scripts.tests.test_operator_docs -v
```

Expected: FAIL because the handbook and skill do not exist.

- [ ] **Step 3: Write the reader and schema documentation**

`README.md` must lead with:

```markdown
# Nanochat LLM Wiki

This tracked sample vault explains how a small language model moves from raw
text to a chat-capable model. It combines immutable arXiv evidence, a pinned
Nanochat source tree, and a compiled OKF v0.2 wiki.
```

Then provide:

- prerequisites: Git LFS, Git submodules, Python 3.11+, and Poppler `pdftotext`;
- fresh-clone commands `git lfs pull` and `git submodule update --init --recursive`;
- reading route `index.md` → `wiki/index.md` → summary/query → concept/entity/comparison → raw/project source → PDF/code;
- the four verification commands from `AGENTS.md`;
- explicit notes that raw files are immutable, `wiki/` is compiled, and runtime state is untracked.

`SCHEMA.md` must define:

- the exact directory boundary and absence of a raw index;
- title slug and collision algorithms;
- the raw frontmatter fields;
- project card fields `repository_url`, `default_branch`, `pinned_commit`, `license`, `source_path`;
- OKF page fields and the five allowed page types;
- the exact 15-value `TAG_REGISTRY`;
- required headings by type:
  - summary: `Scope`, `Pipeline`, `Evidence boundary`, `Related pages`;
  - entity: `What it is`, `Why it matters`, `Nanochat relevance`, `Related pages`;
  - concept: `Definition`, `Mechanism`, `Nanochat connection`, `Related pages`;
  - comparison: `Decision frame`, `Comparison`, `Takeaway`, `Related pages`;
  - query: `Answer`, `Evidence trail`, `Limits`, `Related pages`;
- source and code-commit extensions;
- `status: "contested"` plus symmetric entries shaped as `conflicts: [{"resource": "../concepts/other-page.md", "observed": "2026-08-13", "reason": "The sources make incompatible claims about the same condition."}]`;
- standard relative Markdown links as the preferred portable link syntax.

- [ ] **Step 4: Write `AGENTS.md`, `CLAUDE.md`, and the bundled skill**

`AGENTS.md` must make each required heading a numbered, executable workflow. In particular:

```markdown
## Orientation

1. Read `SCHEMA.md`.
2. Read `wiki/index.md` and `projects/index.md`.
3. Read the newest entries at the end of `log.md`.
4. Search existing compiled pages before creating a page.
5. Run `git submodule status projects/code/nanochat`; if it begins with `-`,
   run `git submodule update --init --recursive`.
```

The arXiv workflow uses the exact sample command:

```bash
python3 scripts/ingest_arxiv.py --id 1508.07909v5
python3 scripts/rebuild_indexes.py
python3 scripts/validate_vault.py
```

The handbook must also give concrete equivalent procedures for:

- a web clip: save a normalized immutable Markdown snapshot with URL, retrieval date, body hash, and license/usage note; keep binary assets under `raw/assets/`;
- a user-supplied local file: copy the immutable asset to `raw/assets/`, create a flat companion with origin and hashes, and never infer rights not supplied by the user;
- compilation: search before creating, create a concept/entity page only for a central or repeatedly sourced subject, keep evidence links beside claims, add meaningful reciprocal links, rebuild, validate, and log;
- queries: read compiled pages first, follow provenance only as needed, cite the pages and evidence used, file only expensive-to-rederive answers under `queries/` or `comparisons/`, then rebuild, validate, and log;
- conflicts: preserve both claims, add dated sources, set both pages to `contested`, add symmetric conflict resources, and ask a human rather than selecting a winner;
- submodule advances: fetch, inspect the exact new commit, update project card and code-source commit extensions together, log the advance, then validate;
- extension smoke: run from repository root, build, launch the dedicated demo test, and inspect the three screenshot artifacts.

`CLAUDE.md` contains only a link to `AGENTS.md` and the instruction to load source text in sections when a raw extraction exceeds the context window.

Start the skill with:

```yaml
---
name: llm-wiki
description: Initialize, audit, ingest, compile, query, and maintain a flat-source, OKF-compatible LLM wiki with immutable evidence and pinned project submodules.
---
```

The skill's decision flow is:

```text
orient
  -> identify ingest / compile / query / maintenance intent
  -> preserve or create immutable evidence
  -> edit typed compiled pages with nearby sources
  -> rebuild indexes
  -> validate
  -> append the operation log
  -> surface unresolved conflicts
```

The skill must begin with two explicit entry modes:

- **Initialize:** create or audit the flat `raw/`, `raw/assets/`, `projects/code/`, and five typed `wiki/` directories; install the LFS rule; create the schema/handbook/index/log contracts; add a project as a submodule when source code is in scope; run unit tests, rebuild, and validate.
- **Maintain:** orient from `SCHEMA.md`, indexes, and the log, then route to ingest, compile, query, conflict, or project maintenance without changing immutable evidence.

`references/arxiv-ingestion.md` must contain the exact versioned-ID/license gate,
temporary-staging transaction, title collision policy, `pdftotext -layout`
command, hash checks, no-overwrite behavior, and the eight-paper command pattern
from Task 7.

`references/frontmatter.md` must reproduce the exact raw metadata-building
dictionary from Task 2 and explicitly state that its body hash, PDF hash,
ingest date, canonical metadata, and observed extraction version are
script-generated rather than copied by hand. It must also include this
copyable compiled-page template:

```yaml
---
title: "Byte-Pair Encoding"
type: "concept"
description: "An open-vocabulary tokenization method that learns frequent symbol merges while preserving a fallback to smaller units."
tags: ["tokenization", "pretraining"]
sources: [{"id": "arxiv-1508.07909v5", "resource": "../../raw/neural-machine-translation-of-rare-words-with-subword-units.md", "title": "Neural Machine Translation of Rare Words with Subword Units"}]
status: "stable"
generated: {"by": "codex/gpt-5"}
---
```

- [ ] **Step 5: Initialize the append-only log and run documentation tests**

Start `log.md` with:

```markdown
# Vault operations log

Entries are append-only and newest entries are added at the bottom.

## 2026-08-13 — Replaced the development demo with a tracked OKF vault

- **Operation:** vault initialization
- **Scope:** schema, scripts, operator handbook, and reusable skill
- **Result:** established immutable `raw/`, pinned `projects/`, and compiled `wiki/` boundaries
- **Validation:** script unit tests and deterministic-index check
```

Run:

```bash
cd demo-vault
python3 -m unittest scripts.tests.test_operator_docs -v
python3 -m unittest discover -s scripts/tests -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit operator documentation and skill**

```bash
git add demo-vault/README.md demo-vault/SCHEMA.md demo-vault/AGENTS.md demo-vault/CLAUDE.md demo-vault/log.md demo-vault/.agents demo-vault/scripts/tests/test_operator_docs.py
git commit -m "docs: add demo vault operating workflows"
```

---

### Task 6: Add the real Nanochat submodule and pinned project card

**Files:**
- Create/modify: `.gitmodules`
- Create: `demo-vault/projects/nanochat.md`
- Create gitlink: `demo-vault/projects/code/nanochat`
- Regenerate: `demo-vault/projects/index.md`
- Modify: `demo-vault/log.md`

**Interfaces:**
- Consumes: validator project-card contract and exact commit `92d63d4e8bb4df75c3b71618f31ddde2378b2bcd`.
- Produces: an initialized submodule whose URL, gitlink, checkout, and card all agree.

- [ ] **Step 1: Create the project card and observe the validator's missing-submodule failure**

Use this frontmatter:

```yaml
---
title: "Nanochat"
type: "project"
description: "A minimal end-to-end harness for tokenization, pretraining, post-training, evaluation, and inference."
repository_url: "https://github.com/karpathy/nanochat.git"
default_branch: "master"
pinned_commit: "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"
license: "MIT"
source_path: "code/nanochat"
---
```

The body must orient readers to:

- `README.md`;
- `runs/speedrun.sh`;
- `scripts/tok_train.py`;
- `nanochat/tokenizer.py`;
- `scripts/base_train.py`;
- `nanochat/gpt.py`;
- `nanochat/loss_eval.py`;
- `scripts/chat_sft.py`;
- `scripts/chat_rl.py`;
- `nanochat/engine.py`.

Use this concrete body:

```markdown
# Nanochat

Nanochat is the pinned implementation project for this sample. The wiki uses
it to connect paper concepts to an inspectable end-to-end training system.

## Pin and license

- **Repository:** <https://github.com/karpathy/nanochat>
- **Pinned commit:** `92d63d4e8bb4df75c3b71618f31ddde2378b2bcd`
- **Default branch:** `master`
- **License:** [MIT](code/nanochat/LICENSE)

## Reading order

1. [Repository overview](code/nanochat/README.md)
2. [Reference speedrun](code/nanochat/runs/speedrun.sh)
3. [Tokenizer training](code/nanochat/scripts/tok_train.py) and [tokenizer implementation](code/nanochat/nanochat/tokenizer.py)
4. [Base-model training](code/nanochat/scripts/base_train.py) and [transformer implementation](code/nanochat/nanochat/gpt.py)
5. [Bits-per-byte evaluation](code/nanochat/nanochat/loss_eval.py)
6. [Supervised fine-tuning](code/nanochat/scripts/chat_sft.py)
7. [Chat reinforcement learning](code/nanochat/scripts/chat_rl.py)
8. [KV-cached inference](code/nanochat/nanochat/engine.py)

All code claims in `wiki/` are scoped to the pinned commit above.
```

Run:

```bash
cd demo-vault
python3 scripts/rebuild_indexes.py
python3 scripts/validate_vault.py
```

Expected: FAIL only with actionable `project.gitmodules`, `project.gitlink`, or `project.uninitialized` issues.

- [ ] **Step 2: Add and pin the submodule**

Run from repository root:

```bash
git submodule add https://github.com/karpathy/nanochat.git demo-vault/projects/code/nanochat
git -C demo-vault/projects/code/nanochat checkout --detach 92d63d4e8bb4df75c3b71618f31ddde2378b2bcd
git add .gitmodules demo-vault/projects/code/nanochat
```

Expected: `.gitmodules` declares path `demo-vault/projects/code/nanochat`; submodule `HEAD` prints the exact 40-character commit.

- [ ] **Step 3: Verify all four pin representations agree**

Run:

```bash
git -C demo-vault/projects/code/nanochat rev-parse HEAD
git config -f .gitmodules --get submodule.demo-vault/projects/code/nanochat.url
git ls-files --stage demo-vault/projects/code/nanochat
cd demo-vault
python3 scripts/rebuild_indexes.py --check
python3 scripts/validate_vault.py
```

Expected: exact commit; exact GitHub URL; mode `160000`; indexes current; `vault valid`.

- [ ] **Step 4: Append the project operation and commit**

Append:

```markdown
## 2026-08-13 — Pinned Nanochat project source

- **Operation:** project ingest
- **Repository:** `https://github.com/karpathy/nanochat.git`
- **Commit:** `92d63d4e8bb4df75c3b71618f31ddde2378b2bcd`
- **Result:** added `projects/code/nanochat` as a Git submodule and created the project card
- **Validation:** `.gitmodules`, gitlink, checkout, project card, and generated project index agree
```

Then:

```bash
git add .gitmodules demo-vault/projects demo-vault/log.md
git commit -m "feat: pin nanochat project source"
```

---

### Task 7: Ingest the eight-paper CC BY 4.0 research corpus through the delivered workflow

**Files:**
- Create: `demo-vault/scripts/tests/test_sample_corpus.py`
- Create: eight `demo-vault/raw/*.md` companions listed below
- Create: eight `demo-vault/raw/assets/*.pdf` files listed below
- Modify: `demo-vault/log.md`

**Interfaces:**
- Consumes: `ingest_arxiv.py`, Git LFS attributes, and exact arXiv versions.
- Produces: eight immutable, hash-matched, title-derived Markdown/PDF pairs.

- [ ] **Step 1: Write the failing exact-corpus acceptance test**

Use this exact map:

```python
EXPECTED_PAPERS = {
    "1508.07909v5": "neural-machine-translation-of-rare-words-with-subword-units",
    "2406.17557v2": "the-fineweb-datasets-decanting-the-web-for-the-finest-text-data-at-scale",
    "2406.11794v4": "datacomp-lm-in-search-of-the-next-generation-of-training-sets-for-language-models",
    "2502.02737v1": "smollm2-when-smol-goes-big-data-centric-training-of-a-small-language-model",
    "2305.13245v3": "gqa-training-generalized-multi-query-transformer-models-from-multi-head-checkpoints",
    "2407.08608v2": "flashattention-3-fast-and-accurate-attention-with-asynchrony-and-low-precision",
    "2209.05433v2": "fp8-formats-for-deep-learning",
    "2305.18290v3": "direct-preference-optimization-your-language-model-is-secretly-a-reward-model",
}
```

Use this test header and place the acceptance methods on the class:

```python
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
VAULT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SCRIPTS))

from vaultlib import parse_frontmatter, sha256_bytes, slugify_title


class SampleCorpusTests(unittest.TestCase):
    maxDiff = None
```

For every pair assert:

- companion and PDF exist;
- frontmatter `arxiv` reconstructs the exact map key;
- license is exactly CC BY 4.0;
- title slug equals the filename;
- body and attachment SHA-256 values match;
- body contains the local PDF link, abstract, extraction notice, and mechanically extracted full text;
- body contains no `## Summary`.

Assert the raw Markdown set equals the eight expected files exactly, `raw/index.md` does not exist, and no directory other than `raw/assets/` exists under `raw/`.

- [ ] **Step 2: Run the acceptance test and confirm all eight are absent**

Run:

```bash
cd demo-vault
python3 -m unittest scripts.tests.test_sample_corpus.SampleCorpusTests.test_exact_paper_inventory -v
```

Expected: FAIL with missing companion paths.

- [ ] **Step 3: Ingest all exact paper versions**

Run from `demo-vault/`:

```bash
python3 scripts/ingest_arxiv.py --id 1508.07909v5
python3 scripts/ingest_arxiv.py --id 2406.17557v2
python3 scripts/ingest_arxiv.py --id 2406.11794v4
python3 scripts/ingest_arxiv.py --id 2502.02737v1
python3 scripts/ingest_arxiv.py --id 2305.13245v3
python3 scripts/ingest_arxiv.py --id 2407.08608v2
python3 scripts/ingest_arxiv.py --id 2209.05433v2
python3 scripts/ingest_arxiv.py --id 2305.18290v3
```

Expected: eight `created` lines. If arXiv reports a different license or canonical title, stop and reconcile against the exact versioned abs page; do not bypass the gate or rename from memory.

- [ ] **Step 4: Verify corpus integrity and LFS routing**

Run:

```bash
python3 -m unittest scripts.tests.test_sample_corpus -v
python3 scripts/validate_vault.py
cd ..
git check-attr filter -- demo-vault/raw/assets/*.pdf
git lfs install --local
git add demo-vault/raw
git lfs ls-files
```

Expected: tests PASS; vault valid; every PDF reports `filter: lfs`; `git lfs ls-files` lists all eight title-derived PDF paths.

- [ ] **Step 5: Append corpus provenance and commit**

Append:

```markdown
## 2026-08-13 — Ingested the Nanochat research corpus

- **Operation:** arXiv ingest
- **Inputs:** `1508.07909v5`, `2406.17557v2`, `2406.11794v4`, `2502.02737v1`, `2305.13245v3`, `2407.08608v2`, `2209.05433v2`, `2305.18290v3`
- **Sources:** exact versioned `https://arxiv.org/abs/` metadata pages and `https://arxiv.org/pdf/` PDFs
- **Rights gate:** all eight records identified as CC BY 4.0
- **Extraction:** `pdftotext -layout`; observed tool version recorded per companion
- **Result:** eight flat title-derived Markdown companions and eight same-basename LFS PDFs
- **Validation:** companion body hashes, attachment hashes, license metadata, filenames, and LFS attributes agree
```

Then:

```bash
git add demo-vault/raw demo-vault/log.md demo-vault/scripts/tests/test_sample_corpus.py
git commit -m "data: ingest nanochat research corpus"
```

---

### Task 8: Compile the paper-grounded foundation pages

**Files:**
- Create: `demo-vault/wiki/summaries/research-corpus-overview.md`
- Create: `demo-vault/wiki/entities/fineweb.md`
- Create: `demo-vault/wiki/entities/datacomp-lm.md`
- Create: `demo-vault/wiki/entities/smollm2-and-smoltalk.md`
- Create: `demo-vault/wiki/concepts/byte-pair-encoding.md`
- Create: `demo-vault/wiki/concepts/grouped-query-attention.md`
- Create: `demo-vault/wiki/concepts/flash-attention.md`
- Create: `demo-vault/wiki/concepts/low-precision-training.md`
- Create: `demo-vault/wiki/concepts/pretraining-data-curation.md`
- Modify: `demo-vault/scripts/tests/test_sample_corpus.py`
- Regenerate: typed indexes and `demo-vault/wiki/index.md`
- Modify: `demo-vault/log.md`

**Interfaces:**
- Consumes: all eight raw companions.
- Produces: nine internally complete, source-backed pages that do not link to not-yet-created pages.

- [ ] **Step 1: Add the failing foundation-page inventory test**

Add:

```python
FOUNDATION_PAGES = {
    "wiki/summaries/research-corpus-overview.md": ("summary", "Research Corpus Overview"),
    "wiki/entities/fineweb.md": ("entity", "FineWeb"),
    "wiki/entities/datacomp-lm.md": ("entity", "DataComp-LM"),
    "wiki/entities/smollm2-and-smoltalk.md": ("entity", "SmolLM2 and SmolTalk"),
    "wiki/concepts/byte-pair-encoding.md": ("concept", "Byte-Pair Encoding"),
    "wiki/concepts/grouped-query-attention.md": ("concept", "Grouped-Query Attention"),
    "wiki/concepts/flash-attention.md": ("concept", "FlashAttention"),
    "wiki/concepts/low-precision-training.md": ("concept", "Low-Precision Training"),
    "wiki/concepts/pretraining-data-curation.md": ("concept", "Pretraining Data Curation"),
}
```

For each file, assert exact type/title, required headings for that type, nonempty sources, and at least two distinct compiled targets.

- [ ] **Step 2: Run the new inventory test and confirm it fails**

Run:

```bash
cd demo-vault
python3 -m unittest scripts.tests.test_sample_corpus.SampleCorpusTests.test_foundation_page_inventory -v
```

Expected: FAIL with the first missing foundation page.

- [ ] **Step 3: Author all nine pages from the coverage matrix**

Every page uses `status: "stable"` and `generated: {"by": "codex/gpt-5"}`. Use nearby Markdown links to a raw source when stating quantitative results or paper-specific design choices.

| Page | Primary source IDs | Required substance | Compiled links that must appear |
| --- | --- | --- | --- |
| Research corpus overview | all eight arXiv IDs | why each paper was selected; which training stage it informs; rights and extraction boundary | all eight foundation entity/concept pages |
| FineWeb | `arxiv-2406.17557v2` | crawl filtering, deduplication, quality ablations, FineWeb-Edu, limits of web-derived data | DataComp-LM; Pretraining data curation; Research corpus overview |
| DataComp-LM | `arxiv-2406.11794v4` | standardized data competition, DCLM-POOL, model-based filtering, CORE evaluation | FineWeb; Pretraining data curation; Research corpus overview |
| SmolLM2 and SmolTalk | `arxiv-2502.02737v1` | staged small-model data mixture, targeted synthetic data, SmolTalk/post-training role | Pretraining data curation; Byte-pair encoding; Research corpus overview |
| Byte-pair encoding | `arxiv-1508.07909v5` | iterative merges, open vocabulary, rare-word handling, difference between paper method and Nanochat implementation evidence | SmolLM2 and SmolTalk; Pretraining data curation; Research corpus overview |
| Grouped-query attention | `arxiv-2305.13245v3` | head grouping between MHA and MQA, checkpoint conversion, memory/bandwidth tradeoff | Flash attention; Low-precision training; Research corpus overview |
| Flash attention | `arxiv-2407.08608v2` | exact attention vs approximation, IO awareness, Hopper asynchrony and low precision, paper/code boundary | Grouped-query attention; Low-precision training; Research corpus overview |
| Low-precision training | `arxiv-2209.05433v2`, `arxiv-2407.08608v2` | E4M3/E5M2 roles, scaling/range, accumulation, hardware qualification, why format labels alone are insufficient | Flash attention; Grouped-query attention; Research corpus overview |
| Pretraining data curation | FineWeb, DataComp-LM, SmolLM2 | filtering, deduplication, quality classifiers, mixture staging, benchmark contamination caveat | FineWeb; DataComp-LM; SmolLM2 and SmolTalk; Research corpus overview |

Use this complete metadata shape, changing values per page:

```yaml
---
title: "Byte-Pair Encoding"
type: "concept"
description: "An open-vocabulary tokenization method that learns frequent symbol merges while preserving a fallback to smaller units."
tags: ["tokenization", "pretraining"]
sources: [{"id": "arxiv-1508.07909v5", "resource": "../../raw/neural-machine-translation-of-rare-words-with-subword-units.md", "title": "Neural Machine Translation of Rare Words with Subword Units"}]
status: "stable"
generated: {"by": "codex/gpt-5"}
---
```

Distinguish evidence from inference with prose such as “The paper establishes…”, “Nanochat relevance is an inference addressed by the code-backed page…”, and “This source does not establish…”. Do not claim that the paper's exact implementation is Nanochat's implementation.

- [ ] **Step 4: Rebuild, validate, and inspect the foundation**

Run:

```bash
python3 scripts/rebuild_indexes.py
python3 -m unittest scripts.tests.test_sample_corpus -v
python3 scripts/validate_vault.py
python3 scripts/rebuild_indexes.py --check
```

Expected: all tests PASS, vault valid, and indexes up to date.

- [ ] **Step 5: Log and commit the foundation knowledge**

Append:

```markdown
## 2026-08-13 — Compiled paper-grounded foundation pages

- **Operation:** wiki compilation
- **Pages:** Research Corpus Overview; FineWeb; DataComp-LM; SmolLM2 and SmolTalk; Byte-Pair Encoding; Grouped-Query Attention; FlashAttention; Low-Precision Training; Pretraining Data Curation
- **Evidence:** the eight immutable arXiv companions in `raw/`
- **Result:** nine stable, mutually linked summary/entity/concept pages with nearby source links
- **Validation:** `python3 -m unittest scripts.tests.test_sample_corpus -v`, `python3 scripts/validate_vault.py`, and deterministic-index check
```

Then:

```bash
git add demo-vault/wiki demo-vault/log.md demo-vault/scripts/tests/test_sample_corpus.py
git commit -m "docs: compile paper-grounded llm foundations"
```

---

### Task 9: Compile the Nanochat code-backed training and inference path

**Files:**
- Create: `demo-vault/wiki/summaries/nanochat-end-to-end-training-pipeline.md`
- Create: `demo-vault/wiki/concepts/bits-per-byte.md`
- Create: `demo-vault/wiki/concepts/decoder-only-transformers.md`
- Create: `demo-vault/wiki/concepts/kv-caching.md`
- Create: `demo-vault/wiki/concepts/compute-optimal-training.md`
- Create: `demo-vault/wiki/concepts/supervised-fine-tuning.md`
- Create: `demo-vault/wiki/concepts/preference-and-policy-optimization.md`
- Modify: selected Task 8 pages to add reciprocal Nanochat links where meaningful
- Modify: `demo-vault/scripts/tests/test_sample_corpus.py`
- Regenerate: typed indexes and `demo-vault/wiki/index.md`
- Modify: `demo-vault/log.md`

**Interfaces:**
- Consumes: the pinned project card/submodule plus the paper-grounded foundation.
- Produces: seven code-backed pages spanning tokenizer → pretraining → SFT → policy optimization → inference.

- [ ] **Step 1: Add the failing Nanochat-page inventory and code-source tests**

Add:

```python
NANOCHAT_PAGES = {
    "wiki/summaries/nanochat-end-to-end-training-pipeline.md": ("summary", "Nanochat End-to-End Training Pipeline"),
    "wiki/concepts/bits-per-byte.md": ("concept", "Bits per Byte"),
    "wiki/concepts/decoder-only-transformers.md": ("concept", "Decoder-Only Transformers"),
    "wiki/concepts/kv-caching.md": ("concept", "KV Caching"),
    "wiki/concepts/compute-optimal-training.md": ("concept", "Compute-Optimal Training"),
    "wiki/concepts/supervised-fine-tuning.md": ("concept", "Supervised Fine-Tuning"),
    "wiki/concepts/preference-and-policy-optimization.md": ("concept", "Preference and Policy Optimization"),
}
PINNED_COMMIT = "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"
```

Assert every code-backed `sources` item:

- resolves below `projects/code/nanochat/`;
- includes `commit == PINNED_COMMIT`;
- points to a file present at the pinned checkout.

- [ ] **Step 2: Run the new test and confirm it fails**

Run:

```bash
cd demo-vault
python3 -m unittest scripts.tests.test_sample_corpus.SampleCorpusTests.test_nanochat_page_inventory -v
```

Expected: FAIL with the first missing Nanochat page.

- [ ] **Step 3: Author all seven pages from the code/source matrix**

| Page | Exact code sources | Paper sources | Required substance | Required compiled links |
| --- | --- | --- | --- | --- |
| Nanochat end-to-end training pipeline | `README.md`, `runs/speedrun.sh`, `scripts/tok_train.py`, `scripts/base_train.py`, `scripts/chat_sft.py`, `scripts/chat_rl.py`, `scripts/chat_cli.py` | BPE, DataComp-LM, SmolLM2, DPO | ordered stages, artifacts passed between stages, evaluation gates, evidence boundaries | BPE; Decoder-only transformers; SFT; Preference and policy optimization; Pretraining data curation |
| Bits per byte | `nanochat/loss_eval.py`, `nanochat/tokenizer.py`, `scripts/base_eval.py` | BPE | nats-to-bits conversion, byte denominator, special-token masking, vocabulary-size comparability and remaining dataset dependence | BPE; Pretraining data curation; Pipeline |
| Decoder-only transformers | `nanochat/gpt.py`, `scripts/base_train.py` | GQA, FlashAttention-3 | causal next-token objective, residual blocks, attention/MLP path, architecture specifics verified from code | GQA; Flash attention; KV caching; Pipeline |
| KV caching | `nanochat/engine.py`, `nanochat/gpt.py`, `tests/test_engine.py` | GQA | prefill vs decode, cache tensor shape, `n_kv_head`, in-place advancement, memory/latency tradeoff | GQA; Flash attention; Decoder-only transformers |
| Compute-optimal training | `README.md`, `runs/scaling_laws.sh`, `runs/miniseries.sh`, `scripts/base_train.py` | DataComp-LM, SmolLM2 | depth as complexity dial, derived width/head/training horizon, empirical nature of optimality, data/compute coupling | Pretraining data curation; Low-precision training; Pipeline |
| Supervised fine-tuning | `scripts/chat_sft.py`, `nanochat/tokenizer.py`, `tasks/smoltalk.py` | SmolLM2 | conversation rendering, assistant-only loss mask, tool-call/output mask distinction, dataset mixture boundary | SmolLM2 and SmolTalk; Preference and policy optimization; Pipeline |
| Preference and policy optimization | `scripts/chat_rl.py`, `nanochat/tokenizer.py`, `nanochat/engine.py` | DPO | distinguish offline preference optimization from Nanochat's sampled policy optimization; reward/evaluation coupling; no claim that Nanochat implements DPO | SFT; Pipeline; Low-precision training |

Every code source frontmatter item has this shape:

```json
{"id": "nanochat-loss-eval", "resource": "../../projects/code/nanochat/nanochat/loss_eval.py", "title": "Nanochat bits-per-byte evaluation", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}
```

Each page also cites `../../projects/nanochat.md`. Near implementation claims, include ordinary relative links to the exact source file so the extension can open code directly.

- [ ] **Step 4: Rebuild and validate the complete foundation plus pipeline**

Run:

```bash
python3 scripts/rebuild_indexes.py
python3 -m unittest scripts.tests.test_sample_corpus -v
python3 scripts/validate_vault.py
python3 scripts/rebuild_indexes.py --check
```

Expected: all tests PASS, vault valid, indexes current.

- [ ] **Step 5: Log and commit the Nanochat path**

Append:

```markdown
## 2026-08-13 — Mapped Nanochat's training and inference path

- **Operation:** code-backed wiki compilation
- **Pages:** Nanochat End-to-End Training Pipeline; Bits per Byte; Decoder-Only Transformers; KV Caching; Compute-Optimal Training; Supervised Fine-Tuning; Preference and Policy Optimization
- **Project pin:** `92d63d4e8bb4df75c3b71618f31ddde2378b2bcd`
- **Result:** seven stable pages connect paper concepts to exact project-card and source-file evidence
- **Validation:** code resources resolve inside the submodule and every resource records the pinned commit
```

Then:

```bash
git add demo-vault/wiki demo-vault/log.md demo-vault/scripts/tests/test_sample_corpus.py
git commit -m "docs: map nanochat training and inference pipeline"
```

---

### Task 10: Add comparisons and durable query answers

**Files:**
- Create: `demo-vault/wiki/comparisons/fineweb-vs-datacomp-lm.md`
- Create: `demo-vault/wiki/comparisons/bf16-vs-fp8.md`
- Create: `demo-vault/wiki/comparisons/dpo-vs-on-policy-reinforcement-learning.md`
- Create: `demo-vault/wiki/queries/how-does-nanochat-turn-text-into-a-chat-model.md`
- Create: `demo-vault/wiki/queries/where-do-the-paper-ideas-appear-in-nanochat.md`
- Create: `demo-vault/wiki/queries/why-does-nanochat-use-bits-per-byte.md`
- Modify: selected earlier pages for reciprocal links
- Modify: `demo-vault/scripts/tests/test_sample_corpus.py`
- Regenerate: all generated indexes
- Modify: `demo-vault/log.md`

**Interfaces:**
- Consumes: the complete evidence, foundation, and code-backed path.
- Produces: the final six synthesis pages and exact 22-page inventory.

- [ ] **Step 1: Add the failing synthesis and exact-inventory tests**

Add the six exact paths, types, and titles:

```python
SYNTHESIS_PAGES = {
    "wiki/comparisons/fineweb-vs-datacomp-lm.md": ("comparison", "FineWeb vs DataComp-LM"),
    "wiki/comparisons/bf16-vs-fp8.md": ("comparison", "BF16 vs FP8"),
    "wiki/comparisons/dpo-vs-on-policy-reinforcement-learning.md": (
        "comparison",
        "DPO vs On-Policy Reinforcement Learning",
    ),
    "wiki/queries/how-does-nanochat-turn-text-into-a-chat-model.md": (
        "query",
        "How Does Nanochat Turn Text into a Chat Model?",
    ),
    "wiki/queries/where-do-the-paper-ideas-appear-in-nanochat.md": (
        "query",
        "Where Do the Paper Ideas Appear in Nanochat?",
    ),
    "wiki/queries/why-does-nanochat-use-bits-per-byte.md": (
        "query",
        "Why Does Nanochat Use Bits per Byte?",
    ),
}
```

Then assert:

```python
all_pages = {
    path.relative_to(VAULT).as_posix()
    for path in (VAULT / "wiki").glob("*/*.md")
    if path.name != "index.md"
}
self.assertEqual(all_pages, set(FOUNDATION_PAGES) | set(NANOCHAT_PAGES) | set(SYNTHESIS_PAGES))
self.assertEqual(len(all_pages), 22)
```

Also assert every one of the 22 pages has at least two compiled links and at least one source.

- [ ] **Step 2: Run the synthesis test and confirm it fails**

Run:

```bash
cd demo-vault
python3 -m unittest scripts.tests.test_sample_corpus.SampleCorpusTests.test_complete_wiki_inventory -v
```

Expected: FAIL with six missing paths and a count below 22.

- [ ] **Step 3: Author the three comparisons**

| Page | Decision frame | Required sources | Required compiled links |
| --- | --- | --- | --- |
| FineWeb vs DataComp-LM | choosing/understanding web-data curation recipes, not declaring a universal winner | FineWeb and DataComp-LM papers | FineWeb; DataComp-LM; Pretraining data curation |
| BF16 vs FP8 | storage/compute format choice by operation, hardware, range, scaling, and accumulation needs | FP8 and FlashAttention-3 papers; Nanochat `README.md` and `nanochat/common.py` | Low-precision training; Flash attention; Compute-optimal training |
| DPO vs on-policy reinforcement learning | offline preference pairs vs sampled trajectories/rewards, including stability and freshness tradeoffs | DPO paper; Nanochat `scripts/chat_rl.py` | Preference and policy optimization; SFT; Pipeline |

Use Markdown tables only for genuinely parallel dimensions. State that Nanochat at the pinned commit uses explicit hardware-dependent compute dtypes and an on-policy chat-RL path; do not imply its code implements the paper's DPO algorithm.

- [ ] **Step 4: Author the three query pages**

| Query | Answer structure | Required evidence trail | Required compiled links |
| --- | --- | --- | --- |
| How does Nanochat turn text into a chat model? | numbered path: curate → train tokenizer → pretrain → base eval → SFT → policy optimization → chat inference | project card, speedrun, tokenizer, base train, SFT, RL, engine plus BPE/SmolLM2/DPO papers | Pipeline; BPE; Decoder-only transformers; SFT; Preference and policy optimization |
| Where do the paper ideas appear in Nanochat? | evidence table with “directly visible”, “related but not identical”, and “background only” classifications | all eight papers plus exact code files | GQA; Flash attention; Low-precision training; Pretraining data curation; Pipeline |
| Why does Nanochat use bits per byte? | formula `total_nats / (ln(2) * total_bytes)`, masking behavior, comparison benefit, limitations | `nanochat/loss_eval.py`, `nanochat/tokenizer.py`, BPE paper | Bits per byte; BPE; Pretraining data curation; Pipeline |

Every answer must include `## Answer`, `## Evidence trail`, `## Limits`, and `## Related pages`. “Limits” must separate what is observed in the pinned code, what comes from papers, and what is synthesis.

- [ ] **Step 5: Rebuild, run the exact inventory, and validate**

Run:

```bash
python3 scripts/rebuild_indexes.py
python3 -m unittest discover -s scripts/tests -v
python3 scripts/validate_vault.py
python3 scripts/rebuild_indexes.py --check
```

Expected: every test PASS; exactly 22 substantive pages; vault valid; indexes current.

- [ ] **Step 6: Log and commit the completed wiki**

Append:

```markdown
## 2026-08-13 — Completed comparison and query synthesis

- **Operation:** durable synthesis
- **Comparisons:** FineWeb vs DataComp-LM; BF16 vs FP8; DPO vs On-Policy Reinforcement Learning
- **Queries:** How Does Nanochat Turn Text into a Chat Model?; Where Do the Paper Ideas Appear in Nanochat?; Why Does Nanochat Use Bits per Byte?
- **Result:** the compiled OKF bundle now contains exactly 22 substantive pages, each with at least two compiled cross-links
- **Validation:** all workflow tests, full vault validation, and deterministic-index check pass
```

Then:

```bash
git add demo-vault/wiki demo-vault/log.md demo-vault/scripts/tests/test_sample_corpus.py
git commit -m "docs: complete nanochat wiki synthesis"
```

---

### Task 11: Add a read-only Extension Host smoke suite for the actual demo vault

**Files:**
- Modify: `packages/vscode-extension/package.json`
- Modify: `packages/vscode-extension/test/vscode-e2e/global-setup.mjs`
- Modify: `packages/vscode-extension/test/vscode-e2e/global-teardown.mjs`
- Modify: `packages/vscode-extension/test/vscode-e2e/playwright.config.mjs`
- Create: `packages/vscode-extension/test/vscode-e2e/demo-vault.playwright.config.mjs`
- Create: `packages/vscode-extension/test/vscode-e2e/demo-vault.spec.ts`
- Create: `packages/vscode-extension/test/demoVaultE2eConfig.test.mjs`
- Modify: `demo-vault/log.md`

**Interfaces:**
- Consumes: the finished `demo-vault/`, existing VS Code CDP setup, Markdown custom editor, PDF custom editor, backlinks/forward-links views, and knowledge graph command.
- Produces: `pnpm --filter llm-wiki-vscode test:vscode-e2e:demo-vault` plus three evidence screenshots.

- [ ] **Step 1: Write the failing config-boundary test**

The test imports a new `resolveE2eWorkspace` export from `global-setup.mjs`:

```javascript
test('demo E2E workspace resolves to the tracked vault without fixture mutation', () => {
  const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
  const demoVault = resolve(repoRoot, 'demo-vault');
  assert.deepEqual(resolveE2eWorkspace({
    workspaceOverride: demoVault,
    mutateOverride: '0',
  }), {
    workspaceRoot: demoVault,
    mutateWorkspace: false,
  });
});
```

Also assert the default call returns the existing `fixtures/test-vault` and `mutateWorkspace: true`.

- [ ] **Step 2: Run the new unit test and confirm the expected failure**

Run:

```bash
pnpm --filter llm-wiki-vscode build
node --test packages/vscode-extension/test/demoVaultE2eConfig.test.mjs
```

Expected: FAIL because `resolveE2eWorkspace` is not exported.

- [ ] **Step 3: Parameterize setup/teardown without changing the default fixture suite**

Add:

```javascript
export function resolveE2eWorkspace({
  workspaceOverride = process.env.LLM_WIKI_VSCODE_E2E_WORKSPACE,
  mutateOverride = process.env.LLM_WIKI_VSCODE_E2E_MUTATE_WORKSPACE,
} = {}) {
  return {
    workspaceRoot: workspaceOverride ? resolve(workspaceOverride) : FIXTURES,
    mutateWorkspace: workspaceOverride
      ? mutateOverride === '1'
      : mutateOverride !== '0',
  };
}
```

In setup, replace `FIXTURES` in cleanup/preparation, folder URI, and logging with `workspaceRoot`; call `cleanupSandboxFixtures` and `prepareSandboxFixtures` only when `mutateWorkspace` is true.

In teardown, resolve the same pair and call `cleanupSandboxFixtures(workspaceRoot)` only when `mutateWorkspace` is true. The default fixture config must retain its existing behavior.

Add `testIgnore: 'demo-vault.spec.ts'` to the normal Playwright config.

- [ ] **Step 4: Add the isolated demo config and package command**

At module load, `demo-vault.playwright.config.mjs` sets:

```javascript
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
process.env.LLM_WIKI_VSCODE_E2E_WORKSPACE = path.resolve(repoRoot, 'demo-vault');
process.env.LLM_WIKI_VSCODE_E2E_MUTATE_WORKSPACE = '0';
process.env.LLM_WIKI_VSCODE_E2E_TEST_DIR = path.resolve(
  repoRoot,
  'e2e-report',
  '.vscode-test-demo-vault',
);
```

Its config uses:

```javascript
testMatch: 'demo-vault.spec.ts',
workers: 1,
fullyParallel: false,
globalSetup: path.resolve(__dirname, 'global-setup.mjs'),
globalTeardown: path.resolve(__dirname, 'global-teardown.mjs'),
reporter: [
  ['list'],
  ['html', {
    open: 'never',
    outputFolder: path.resolve(repoRoot, 'e2e-report', 'demo-vault'),
  }],
],
```

Add:

```json
"test:vscode-e2e:demo-vault": "playwright test --config test/vscode-e2e/demo-vault.playwright.config.mjs"
```

- [ ] **Step 5: Write the failing real-vault smoke test**

Create one serial test with these exact checkpoints:

1. Quick-open `index.md`; assert the Markdown webview source contains `# Nanochat LLM Wiki`.
2. Click the rendered link button whose title is `wiki/index.md`; assert the next source contains `# Nanochat LLM Wiki`.
3. Quick-open `nanochat-end-to-end-training-pipeline.md`; click the Byte-pair encoding link; assert the BPE source is active.
4. Open the LLM Wiki activity bar; run `LLM Wiki: Refresh Links`; assert the Backlinks pane contains `Nanochat End-to-End Training Pipeline`. Then open Explorer and assert the Markdown Outline contains `Definition`.
5. Open Quick Open, type the full canonical filename `neural-machine-translation-of-rare-words-with-subword-units.md`, and assert that exact raw companion appears in search.
6. Click BPE's raw-source link; assert the raw companion contains `## Mechanically extracted full text`.
7. Click the raw companion's `assets/neural-machine-translation-of-rare-words-with-subword-units.pdf` link; assert the PDF webview has a nonzero page count and a full-quality first canvas.
8. Quick-open `fineweb.md`, follow its raw companion, and open `assets/the-fineweb-datasets-decanting-the-web-for-the-finest-text-data-at-scale.pdf`. Open the PDF outline tab, click the first outline destination whose displayed page is greater than 1, and assert `#page-info` changes to that page and `.pdf-destination-focus` exists. The pinned FineWeb v2 PDF was selected for this checkpoint because it contains a LaTeX/hyperref document outline.
9. Quick-open `projects/nanochat.md`; click the `code/nanochat/nanochat/gpt.py` link; assert the workbench tab title is `gpt.py`.
10. Run `LLM Wiki: Show Knowledge Graph`; assert the graph panel contains nodes for `Byte-Pair Encoding`, `Nanochat End-to-End Training Pipeline`, and `Pretraining Data Curation`.

Write screenshots to:

```text
e2e-report/demo-vault-screenshots/01-root-knowledge-hub.png
e2e-report/demo-vault-screenshots/02-paper-pdf-reader.png
e2e-report/demo-vault-screenshots/03-code-backed-navigation.png
```

Before running, execute `git ls-files --stage -z demo-vault` from the repository root. Hash the bytes of every mode `100644`/`100755` path and record the index OID for the mode `160000` submodule path. Repeat after the smoke path and assert the map is identical, so ignored caches are irrelevant and the suite proves tracked content stayed read-only.

- [ ] **Step 6: Run the smoke test and use failures only to correct test/vault defects**

Run:

```bash
pnpm --filter llm-wiki-vscode test:vscode-e2e:demo-vault
```

Expected before the spec is complete: FAIL at the first unimplemented checkpoint. Implement the minimal harness/spec changes until all checkpoints PASS. If the failure demonstrates a production extension defect, stop and request separate authorization before changing production extension code.

- [ ] **Step 7: Run extension unit tests, record the smoke, and commit the acceptance harness**

Run:

```bash
pnpm --filter llm-wiki-vscode test
pnpm --filter llm-wiki-vscode test:vscode-e2e:demo-vault
git diff --check
```

Expected: unit tests PASS, demo smoke PASS, and no whitespace errors.

Append:

```markdown
## 2026-08-13 — Verified reading through the LLM Wiki extension

- **Operation:** Extension Development Host smoke test
- **Reading path:** root hub → compiled summary → Byte-Pair Encoding → raw companion → local PDF; FineWeb PDF outline; Nanochat project card → `nanochat/gpt.py`; backlinks and knowledge graph
- **Result:** the dedicated read-only demo-vault Playwright suite passed
- **Evidence:** `e2e-report/demo-vault-screenshots/01-root-knowledge-hub.png`, `02-paper-pdf-reader.png`, and `03-code-backed-navigation.png`
- **Integrity:** tracked vault hashes and the Nanochat gitlink were unchanged by the extension run
```

After appending the log, run:

```bash
python3 demo-vault/scripts/validate_vault.py
pnpm --filter llm-wiki-vscode test:vscode-e2e:demo-vault
```

Expected: `vault valid` and the smoke suite passes again with the logged bytes
included in its before/after integrity map.

Then:

```bash
git add packages/vscode-extension/package.json packages/vscode-extension/test demo-vault/log.md
git commit -m "test: exercise extension against demo vault"
```

---

### Task 12: Run the complete acceptance audit and capture handoff evidence

**Files:**
- Verify only; modify a prior task's owning file if and only if a check exposes a defect.

**Interfaces:**
- Consumes: every previous task.
- Produces: reproducible command evidence, clean tracked state, exact pin/LFS proof, and screenshots.

**Required sub-skill at execution time:** Read and follow `superpowers:verification-before-completion` before making any completion claim.

- [ ] **Step 1: Verify the vault mechanics and deterministic content**

Run:

```bash
cd demo-vault
python3 -m unittest discover -s scripts/tests -v
python3 scripts/validate_vault.py
python3 scripts/rebuild_indexes.py --check
cd ..
git diff --check
```

Expected: all tests PASS; `vault valid`; `indexes up to date`; no whitespace errors.

- [ ] **Step 2: Verify exact evidence inventory, LFS, and project pin**

Run:

```bash
find demo-vault/raw -maxdepth 1 -type f -name '*.md' | sort
find demo-vault/raw/assets -maxdepth 1 -type f -name '*.pdf' | sort
git lfs ls-files
git check-attr filter -- demo-vault/raw/assets/*.pdf
git -C demo-vault/projects/code/nanochat rev-parse HEAD
git ls-files --stage demo-vault/projects/code/nanochat
git config -f .gitmodules --get submodule.demo-vault/projects/code/nanochat.url
```

Expected: eight title-derived Markdown files, eight same-basename PDFs, eight LFS entries, `filter: lfs` for each PDF, exact commit `92d63d4e8bb4df75c3b71618f31ddde2378b2bcd`, gitlink mode `160000`, and exact Nanochat URL.

- [ ] **Step 3: Verify the entire extension and production build**

Run:

```bash
pnpm check
pnpm build:extension
pnpm --filter llm-wiki-vscode test:vscode-e2e:demo-vault
```

Expected: repository lint/typecheck/tests PASS, production extension bundle builds, and the real-vault Extension Host smoke passes.

- [ ] **Step 4: Inspect the three screenshots**

Open:

```text
e2e-report/demo-vault-screenshots/01-root-knowledge-hub.png
e2e-report/demo-vault-screenshots/02-paper-pdf-reader.png
e2e-report/demo-vault-screenshots/03-code-backed-navigation.png
```

Confirm:

- the hub renders meaningful navigation rather than raw source text;
- the archived arXiv PDF is visible with reader controls and page content;
- the code-backed route visibly lands on the pinned Nanochat source path.

- [ ] **Step 5: Audit every design requirement**

Check:

- no raw index or raw topic folders;
- no copied Nanochat files outside the submodule;
- no iWiki, database, embeddings, or committed runtime state;
- all 22 substantive pages exist and each has at least two compiled links;
- every paper/code claim has resolvable provenance;
- all normal workflows are in `AGENTS.md`;
- indexes are byte-for-byte reproducible;
- the extension run did not change tracked vault bytes.

Fix any discrepancy in the task that owns it and rerun Steps 1–4.

- [ ] **Step 6: Confirm final Git state and create a verification commit only if needed**

Run:

```bash
git status --short --branch
git log --oneline --decorate -12
```

Expected: no uncommitted tracked changes. If the acceptance audit required corrections, commit only those verified corrections:

```bash
git add -u -- demo-vault packages/vscode-extension .gitmodules .gitignore
git commit -m "fix: satisfy demo vault acceptance audit"
```

Do not commit `e2e-report/`; it remains ignored evidence for the local handoff.
