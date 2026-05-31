# Human Learning - PDF Viewer And Locator Detail

This document describes the current PDF model after the native reference-model
update.

## 1. Principle

The PDF engine renders and exposes selection data. Human Learning owns locators,
links, chunks, anchors, graph edges, and agent context.

```text
PDF engine:
  render pages
  expose text selection
  expose page coordinates when available
  support zoom/navigation

Human Learning:
  chunk PDFs for retrieval
  create durable anchors for arbitrary selections
  store locator metadata in SQLite
  generate native markdown links
  resolve note -> PDF jumps
  expose context to agents
```

## 2. Link Formats

PDF links are plain markdown links to vault-relative PDF paths.

```md
[paper p7](raw/pdf/flash-attention.pdf#page=7)
[quote](raw/pdf/flash-attention.pdf#page=7&chunk=chk_pdf_abc123)
[selection](raw/pdf/flash-attention.pdf#page=7&anchor=anc_pdf_abc123)
```

`hl://pdf/...` is no longer the generated user-facing format.

## 3. Chunks Versus Anchors

PDF chunks and PDF anchors are different objects.

| Object | Role | Cardinality |
| --- | --- | --- |
| Chunk | Search and retrieval unit | Many per PDF |
| Anchor | Durable arbitrary selection | Sparse |

Chunks are created during ingestion. Anchors are created only when a user or
agent explicitly needs to cite a selection outside an existing stable chunk.

This keeps retrieval rich without forcing every chunk to become an anchor.

## 4. PDF Chunk Metadata

PDF text is split into layout-ish blocks:

```text
paragraph
heading
caption
table
list
formula
```

Each PDF chunk stores metadata in `chunks.metadata_json`:

```json
{
  "line_start": 12,
  "line_end": 18,
  "source_path": "raw/pdf/flash-attention.pdf",
  "page_start": 7,
  "page_end": 7,
  "block_type": "paragraph",
  "reading_order": 4,
  "text_offset_start": 1502,
  "text_offset_end": 1844,
  "bbox_rects": [],
  "section_path": [],
  "source_hash": "sha256...",
  "chunk_hash": "sha256..."
}
```

Search emits PDF chunk citations through `SearchResult.anchor_uri`:

```text
raw/pdf/flash-attention.pdf#page=7&chunk=chk_pdf_abc123
```

## 5. PDF Anchor Metadata

Anchors are stored in the `anchors` table with `kind = 'pdf_rect'`.

Quote-created anchors use `strategy = 'quote-search'`. Webview-created anchors
use `strategy = 'webview-selection'`.

Locator data includes:

```json
{
  "page": 7,
  "rects": [[120, 240, 530, 310]],
  "textItemIndex": 82,
  "charOffset": 4,
  "endTextItemIndex": 85,
  "endCharOffset": 19,
  "quote_offset": 1502,
  "quote_length": 342,
  "strategy": "webview-selection"
}
```

The persisted URI uses native PDF syntax:

```text
raw/pdf/flash-attention.pdf#page=7&anchor=anc_pdf_abc123
```

## 6. Viewer Jump Resolution

The VS Code dispatcher classifies PDF links and calls:

```ts
human-learning.openPdfAtAnchor({
  pdfPath,
  page,
  chunkId,
  anchorId
})
```

The PDF provider resolves:

| Fragment | Resolution |
| --- | --- |
| `#page=N` | Open page `N` |
| `#page=N&chunk=chk_pdf_...` | Load chunk locator metadata from `chunks` |
| `#page=N&anchor=anc_pdf_...` | Load anchor locator metadata from `anchors` |

The viewer should highlight resolved chunk/anchor regions consistently. When
geometry is not available, page-level navigation still works.

## 7. Source Of Truth

Raw PDFs remain immutable. Locator metadata is stored outside the PDF:

```text
.hl/index.sqlite
.hl/anchors/
.hl/references/pdf/      future/reference overlay output
.hl/annotations/pdf/     future/manual annotation sidecars
```

SQLite is the runtime index. Sidecars and markdown links are rebuildable or
inspectable sources of truth depending on the data type.

## 8. Agent Rules

Agents must not invent:

- PDF rectangles
- chunk IDs
- anchor IDs
- page-specific quotes not found in the source

Preferred workflow:

```text
1. Use hl search to find relevant chunks.
2. Cite the returned chunk link if it is precise enough.
3. Use hl anchor create-pdf --quote only when an arbitrary quote needs a durable anchor.
4. Insert only returned native markdown links.
```

## 9. Current Engine

The current extension uses EmbedPDF/PDFium packages and bundles `pdfium.wasm`.
PDF.js remains a reasonable fallback strategy for future work, but the current
main extension is wired through the EmbedPDF/PDFium bundle.

## 10. Test Coverage

PDF behavior is covered by:

```bash
npx playwright test --config playwright.config.ts --grep "pdf viewer"
```

The broader editor/PDF integration is covered by:

```bash
pnpm test
node packages/vscode-extension/test/e2e/pure-e2e.mjs
npx playwright test --config playwright.config.ts
```
