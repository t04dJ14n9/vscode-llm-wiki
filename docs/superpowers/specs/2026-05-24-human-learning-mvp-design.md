# Human Learning MVP Design

## Goal

Ship a local-first MVP that turns this repository into a usable Human Learning vault tool on a local MacBook: a working `hl` CLI, a VS Code PDF viewer backed by PDFium/EmbedPDF, a CodeMirror 6 markdown editor, deterministic local embedding search, and bidirectional links/backlinks over canonical `hl://` links.

## Scope

The MVP includes:

- Vault bootstrap and validation with `.hl/`, `raw/`, `notes/`, agent instruction files, and rebuildable SQLite state.
- Markdown/code/text ingestion into chunks with lexical search and deterministic local embeddings.
- PDF source registration and quote-based anchor creation with persisted `anchors` records.
- Link graph rebuild/check/backlinks/forward-links for standard markdown `hl://` links and wikilinks.
- CLI commands for `init`, `status`, `doctor`, `ingest`, `search`, `links`, `anchor`, `context`, and `embeddings`.
- VS Code custom PDF editor for local PDFs using EmbedPDF/PDFium, selection toolbar, link insertion, and note-to-PDF anchor jumps.
- VS Code custom markdown editor using CodeMirror 6 with source/hybrid visual editing, `hl://` link rendering, and command dispatch.
- Local verification on a sample/demo vault.

The MVP does not include cloud sync, Zotero import, HTML snapshot anchoring, learning/review scheduling, MCP, iPad ink sync, or production-grade semantic models. Embeddings are deterministic hash vectors so the feature works offline and is testable without API keys; remote/local model providers can replace the provider later without changing CLI shape.

## Architecture

`packages/core` is the authority for workspace layout, database schema, ingestion, links, anchors, context export, and embeddings. SQLite is an index derived from source files and sidecar metadata; markdown and raw sources remain the truth.

`packages/cli` is a thin Commander wrapper over `core`. It performs vault discovery, opens the database, runs migrations, calls core services, and prints human or JSON output.

`packages/vscode-extension` provides the interactive surfaces. It registers:

- `human-learning.pdfViewer` via `CustomReadonlyEditorProvider` for PDFs.
- `human-learning.markdownEditor` via `CustomTextEditorProvider` for markdown.
- Document links, URI dispatch, backlinks/forward-links/problems views, and context export commands.

The extension borrows the proven message-passing and webview patterns from `reference/paper-link`, but stores graph data in `.hl/index.sqlite` instead of PaperLink's JSON index.

## Data Model

Existing tables remain and the MVP adds the minimum needed fields/tables:

- `chunks` stores line/page metadata in `metadata_json`.
- `chunk_embeddings` stores provider/model metadata plus the vector JSON for deterministic local embeddings.
- `anchors` stores `pdf_rect`, `line_range`, and note anchors with `locator_json`, `text_quote`, `text_hash`, and `source_hash`.
- `links` stores parsed markdown links with `to_uri`, optional `to_anchor_id`, source line, label, relation, and status.

Canonical PDF links use:

```md
[quoted source](hl://pdf/raw/pdf/example.pdf?anchor=anc_pdf_abcd1234)
```

Page-only links are allowed as a fallback:

```md
[page source](hl://pdf/raw/pdf/example.pdf?page=3)
```

## PDF Flow

1. The user opens `raw/pdf/*.pdf` in the custom PDF editor.
2. The webview loads bundled `pdfium.wasm` through EmbedPDF and renders pages.
3. A text selection creates a page/selection anchor in the webview.
4. The extension sends the quote and locator to `core` to persist an anchor.
5. The user inserts or copies a markdown link using the returned `hl://pdf/...` URI.
6. `hl links rebuild` or the file watcher indexes the note.
7. Clicking the markdown link dispatches to the PDF editor, opens the PDF, scrolls to the page, and highlights the anchor.

For the MVP, quote-based CLI anchors use page-text search plus page-level locator when exact geometry is not available headlessly. Interactive selections from the webview can store selection indices from EmbedPDF.

## Markdown Flow

The CodeMirror document remains raw markdown. The editor sends full document edits back to VS Code's `TextDocument`, letting VS Code own dirty state, save, undo, and hot exit. Hybrid rendering is implemented with CodeMirror decorations/widgets on non-active lines; active lines remain raw markdown. `hl://` links and wikilinks can be clicked and dispatched through the extension.

## Embeddings

The MVP embedding provider is deterministic and local:

- Tokenize chunk text.
- Hash tokens into a fixed-size vector.
- L2-normalize the vector.
- Store vector JSON in SQLite.
- `hl embeddings refresh --changed` refreshes missing or stale vectors.
- `hl search --mode semantic|hybrid` ranks chunks by cosine similarity or reciprocal-rank fusion.

This validates the embedding pipeline, CLI, schema, and search UX without network keys or native dependencies.

## Error Handling

- CLI commands return nonzero for missing vaults, missing paths, invalid `hl://` URIs, and unresolved anchors.
- Link checks mark missing note/source/anchor targets as broken.
- PDF operations fall back to page-level anchors when precise rects are not available.
- The extension shows VS Code errors for invalid URIs, missing files, webview load failures, and anchor lookup failures.

## Testing

Core tests use Node's built-in `node:test` against temporary vaults. Tests cover init/migrations, ingestion, lexical/semantic/hybrid search, `hl://` parsing, link rebuild/check/backlinks, anchor creation/resolution, and context export.

CLI smoke tests build packages, create a temporary vault, run commands through `node packages/cli/dist/main.js`, and assert JSON output.

Extension verification builds webpack bundles and checks that the PDF and markdown webview assets are emitted, including `pdfium.wasm`.

## Local Acceptance Criteria

- `pnpm build` succeeds.
- `pnpm test` succeeds.
- A demo vault can run:

```bash
hl init
hl ingest notes --recursive
hl embeddings refresh --changed
hl search "attention" --mode hybrid --json
hl links rebuild
hl links check --json
hl anchor create-pdf raw/pdf/sample.pdf --quote "..."
hl context export --source notes/Concepts/Foo.md --json
```

- VS Code can open markdown through the CodeMirror editor and PDFs through the PDFium-backed custom editor.
