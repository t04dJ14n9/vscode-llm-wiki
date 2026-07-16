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
  generate portable page/text-fragment markdown links
  resolve note -> PDF jumps
  expose context to agents
```

## 2. Link Formats

PDF links are plain markdown links to vault-relative PDF paths.

```md
[paper p7](raw/pdf/flash-attention.pdf#page=7)
[selected text](raw/pdf/flash-attention.pdf#page=7:~:text=selected%20text)
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

This keeps retrieval rich without forcing every chunk to become an anchor. Both
objects produce portable links; their internal IDs are never URL parameters.

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

Search currently emits portable page-only PDF citations through
`SearchResult.anchor_uri`:

```text
raw/pdf/flash-attention.pdf#page=7
```

Exact text fragments are emitted for explicit PDF selections and persisted
annotations, not for retrieval chunks.

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
raw/pdf/flash-attention.pdf#page=7:~:text=FlashAttention%20uses%20tiling
```

The annotation row keeps its internal ID only in storage.

## 6. Viewer Jump Resolution

The VS Code dispatcher classifies PDF links and calls:

```ts
human-learning.openPdfTarget({pdfPath,page,textFragment})
```

The PDF provider resolves:

| Fragment | Resolution |
| --- | --- |
| `#page=N` | Open page `N` |
| `#page=N:~:text=...` | Match the text on page `N`, scroll to it, and flash it |

When selector matching fails, page-level navigation still works.

## 7. Source Of Truth

Raw PDFs remain immutable. Ask PDF never modifies PDF bytes. Locator, reference,
and discussion metadata is stored outside the PDF.

Vault-backed Ask PDF discussions use the full PDF SHA-256 as their source
identity:

```text
.hl/annotations/pdf/<pdf-sha256>.json
.hl/annotations/pdf/assets/<annotation-id>/selection.png
```

When a PDF is outside a vault, including when it is opened by the PDF-only
extension without any `.hl` directory, the same data lives under VS Code's
extension-global storage:

```text
<extension-global-storage>/pdf-annotations/<pdf-sha256>/annotations.json
<extension-global-storage>/pdf-annotations/<pdf-sha256>/assets/<annotation-id>/selection.png
```

Global discussion storage is local to that extension installation. It is not
encrypted or synchronized. If the same PDF is later opened inside a vault, its
global discussions are imported non-destructively into the vault sidecar; the
global copy remains as a backup.

Other PDF locator data remains separate:

```text
.hl/index.sqlite
.hl/anchors/
.hl/references/pdf/      future/reference overlay output
.hl/annotations/pdf/     Ask PDF and future/manual annotation sidecars
```

SQLite is the runtime index. Sidecars and markdown links are rebuildable or
inspectable sources of truth depending on the data type.

## 8. Ask PDF Discussions

Ask PDF is available in both the combined Human Learning extension and the
standalone PDF extension. Select text on one page, right-click, and choose
**Ask about selection…**. The first submitted question creates the durable
annotation; simply opening and closing the panel does not create empty data.

Each annotation owns a floating Ask PDF inspector rather than sharing a docked
document sidebar. The inspector opens beside its selected passage and follows
that passage while attached. Dragging its header detaches it; its edges and
corners resize it within the PDF viewport. Position, size, draft, and minimized
state are retained per annotation, so switching markers restores that
discussion's own window. Minimizing or pressing Escape collapses the inspector
back into its blue numbered marker without cancelling a running turn. On narrow
screens the same annotation-owned inspector becomes a clamped near-full-width
overlay with pointer movement and resizing disabled.

The extension host launches the local `codex app-server`, reuses the user's
existing Codex authentication, and never stores an API key. The supported
development baseline is Codex CLI 0.144.1 or newer. The executable defaults to
`codex` and can be changed with `humanLearning.pdf.codexCommand`.

Lightweight discussion tasks use:

```text
ephemeral: true
sandbox: read-only
approvalPolicy: never
web_search: cached
```

After first-use consent, the selected quote, nearby context, portable page/text
link, question, and optional PNG crop are sent to the local Codex runtime. The
visible answer streams in memory. Only a successfully completed answer is
committed to the annotation by the extension host; cancellation and failure
retain the question but never persist a partial assistant answer. Diagnostics
include runtime lifecycle and request metadata, but never PDF text, crops,
questions, or answers.

**Continue in Codex** creates a normal, persistent Codex task using the user's
usual permission defaults. It is a one-time, one-way handoff of the visible
source context and transcript. The annotation retains the task ID, but later
turns in that task are not synchronized back into the PDF discussion.

## 9. Agent Rules

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

## 10. Current Engine

The current extension uses EmbedPDF/PDFium packages and bundles `pdfium.wasm`.
PDF.js remains a reasonable fallback strategy for future work, but the current
main extension is wired through the EmbedPDF/PDFium bundle.

## 11. Test Coverage

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

For a manual smoke test against the installed Codex runtime:

```bash
codex --version       # must be 0.144.1 or newer
codex login status
pnpm build:extension
pnpm build:pdf-extension
```

Then select text on one PDF page, ask a question, and verify that the answer
streams. Close and reopen the PDF to confirm the numbered marker and transcript
persist, ask a follow-up, and verify the PDF SHA-256 is unchanged. Repeat from a
folder without `.hl` using the PDF-only extension. Finally, promote the
discussion and confirm that the persistent Codex task opens.
