# Human Learning - Current Implementation Detail

This document reflects the current `main` implementation. It supersedes older
planning documents that described `hl://` as the generated user-facing link
scheme.

## 1. Packages

```text
packages/core
  SQLite schema, vault detection, source registry, chunks, search, links,
  anchors, web target records, context export, generated agent instructions.

packages/cli
  `hl` command surface for init/status/doctor/ingest/search/links/anchor/context.

packages/vscode-extension
  Combined VS Code extension with markdown editor, PDF viewer, side views, URI
  dispatch, and E2E webview fixtures.

packages/vscode-markdown-extension
  Split markdown-only extension build.

packages/vscode-pdf-extension
  Split PDF-only extension build.
```

## 2. Database Schema

Schema version is `3`.

Core tables:

| Table | Responsibility |
| --- | --- |
| `sources` | Registered markdown, PDF, HTML, code, image, and text files |
| `anchors` | Durable precise locators, currently including PDF selections |
| `links` | Parsed graph edges from markdown notes |
| `chunks` | Retrieval units with optional locator metadata |
| `search_index` | Token index for lexical search |
| `chunk_embeddings` | Deterministic local vectors for testable semantic search |
| `web_targets` | Durable web fallback records for `#hl-web=` links |
| `diagnostics` | Link and vault problems |
| `activity` | Future activity log events |

Migration 2 added `chunks.metadata_json` and embedding vectors. Migration 3
added `web_targets`.

## 3. Native Reference Targets

`packages/core/src/links/reference-target.ts` owns target classification and
href generation.

```ts
type ReferenceKind = 'note' | 'pdf' | 'code' | 'web' | 'image' | 'text' | 'unknown';
```

`classifyReferenceTarget()` returns:

```ts
interface ReferenceTarget {
  kind: ReferenceKind;
  uri: string;
  path?: string;
  url?: string;
  heading?: string;
  lines?: { start: number; end: number };
  page?: number;
  textFragment?: {
    textStart: string;
    textEnd?: string;
    prefix?: string;
    suffix?: string;
  };
  webTargetId?: string;
}
```

Helpers:

```ts
noteHref(path, heading?)
pdfHref(path, { page?, textFragment? })
codeHref(path, { start, end? }?)
```

Generated examples:

```md
[[Online Softmax#Why This Matters]]
[kernel](raw/code/attention.cu#L42-L57)
[paper p7](raw/pdf/flash-attention.pdf#page=7)
[selected text](raw/pdf/flash-attention.pdf#page=7:~:text=selected%20text)
[quote](https://example.com/article#:~:text=selected%20text)
[DOM block](https://example.com/article#hl-web=web_abc123)
```

## 4. Markdown Link Parsing

`packages/core/src/links/link-parser.ts` parses:

- standard markdown links
- folder-qualified Obsidian wikilinks
- basename-resolved wikilinks using known note paths
- same-note heading links
- same-note block references
- image embeds

It stores native `uri` strings and parsed `ReferenceTarget` metadata. It does not
generate `hl://` links for MVP output.

## 5. Link Graph Rebuild

`packages/core/src/links/graph.ts` handles rebuilds:

1. Delete existing parser-created links for the note.
2. Read the markdown file from disk.
3. Parse links with the current note path list.
4. Insert `links` rows with:
   - `from_note_path`
   - `from_line`
   - `to_uri`
   - optional `to_anchor_id`
   - `label`
   - `relation = references`
   - `created_by = parser`
   - `status = resolved`

Backlinks query by `links.to_uri`. Forward links query by source note path.

## 6. PDF Chunking

`packages/core/src/sources/chunks.ts` chunks PDFs into layout-ish blocks after
text extraction. Blocks are separated by blank lines and classified as:

```text
paragraph | heading | caption | table | list | formula
```

PDF chunk IDs use the `chk_pdf_` prefix and content hash. Chunk metadata stores
page, offsets, reading order, block type, source hash, chunk hash, and future
rectangle data.

Search results for PDF chunks currently emit portable page-only targets:

```md
raw/pdf/file.pdf#page=N
```

Chunks remain internal retrieval units. Their IDs are not exposed in the URL;
the current search layer does not reconstruct a precise selector from a chunk.
User-created selections and persisted annotations do include text fragments.

## 7. PDF Anchors

`packages/core/src/anchors/pdf.ts` creates anchors from quote search or trusted
webview selections.

Persisted annotation rows also store portable links:

```md
raw/pdf/file.pdf#page=N:~:text=exact%20selected%20text
```

The annotation row ID remains internal database identity. Quote-based anchors
store:

- page
- rects when available
- text item and character offsets when available
- quote offset and quote length
- strategy: `quote-search` or `webview-selection`
- text hash
- source hash
- status and confidence

Anchor creation appends records to the anchor sidecar through `appendAnchorToFile`.

## 8. Web Targets

`packages/core/src/web/targets.ts` stores durable fallback targets:

```ts
upsertWebTarget(db, {
  url,
  title,
  selectedText,
  textFragment,
  cssSelector,
  xpath,
  metadata
})
```

The generated id is deterministic from URL, selected text, selector, and XPath
unless the caller supplies an id. The dispatcher resolves `#hl-web=<id>` by
looking up `web_targets` and preferring `text_fragment` over the plain URL.

## 9. Search

`packages/core/src/search/search.ts` supports:

- `searchLexical`
- `searchSemantic`
- `searchHybrid`
- `searchNotes`

The current semantic implementation uses deterministic local embeddings for
offline repeatability. Agent instructions prefer `qmd` for stronger local hybrid
retrieval and reranking when it is installed/configured in the Human Learning
skill environment.

`SearchResult.anchor_uri` is a native link:

- PDF: `pdfHref(sourcePath, { page })`
- code: `codeHref(sourcePath, { start, end })`
- markdown/text: source path

## 10. VS Code URI Dispatch

`packages/vscode-extension/src/uriDispatcher.ts` dispatches native targets:

| Kind | Behavior |
| --- | --- |
| Note | `vscode.openWith(..., human-learning.markdownEditor)` and reveal heading/block/line |
| Code | Open native VS Code text editor and reveal `#Lx-Ly` |
| PDF | Execute `human-learning.openPdfTarget({pdfPath,page,textFragment})` |
| Web | Open Chrome first, then fall back to VS Code external opener |
| Image/Text | Open local file |
| Unknown | Show VS Code error |

It does not dispatch raw internal annotation IDs. Portable PDF targets are
classified directly from the Markdown destination.

## 11. Markdown Editor

`packages/vscode-extension/webview-src/markdown-editor.ts` owns the CodeMirror
editor shell. The hybrid rendering extensions live under:

```text
packages/vscode-extension/webview-src/extensions/
```

Important rendering/interaction details:

- active lines stay raw and editable
- inactive lines can render headings, properties, math, links, images, tables,
  code blocks, Mermaid, callouts, tags, footnotes, and comments
- display math keeps source rows and line numbers stable while hiding source
  text when inactive
- fenced code blocks keep syntax highlighting and alignment even when the cursor
  enters the block
- opening and closing fence lines reveal raw backticks when active
- Mermaid diagrams render at natural scale; wide diagrams scroll horizontally
  instead of shrinking unreadably
- Vim movement can enter rendered math/code widgets
- Vim ex commands send `save`, `close`, and `saveAndClose` messages to the host
- copy and paste preserve raw markdown source

Bundled editor libraries align with the Obsidian-like behavior where useful:

```text
CodeMirror 6
@replit/codemirror-vim
MathJax
Mermaid 11.4.1
Prism 1.29.0
DOMPurify
Turndown
YAML 2.7.0
```

## 12. PDF Viewer

The main extension and split PDF extension build a custom editor for PDFs using
EmbedPDF/PDFium packages. The webview bundle copies `pdfium.wasm` and
`sql-wasm.wasm` for offline extension-host use.

The PDF provider resolves:

- `#page=N`
- `#page=N:~:text=...`

The page and parsed text fragment are surfaced directly to the webview for
page-scoped matching and transient highlighting, without a database lookup.

## 13. Generated Agent Files

`generateAgentInstructions()` writes:

- `AGENTS.md`
- `CLAUDE.md`
- `.claude/commands/hl-*.md`
- `.agents/skills/human-learning/SKILL.md`
- `.codex/config.toml`

The generated rules now say:

- use native Markdown/Obsidian links
- do not invent coordinates, chunk IDs, anchor IDs, or web target IDs
- cite PDF chunks directly when search returns them
- create anchors only for arbitrary selections outside stable chunks
- use `hl search` before `hl anchor create-pdf --quote`
- prefer `qmd` when configured

## 14. Verification

Use these commands for the current implementation:

```bash
pnpm test
pnpm build:extension
node packages/vscode-extension/test/e2e/pure-e2e.mjs
npx playwright test --config playwright.config.ts
```

`pnpm test` covers core, CLI, and extension unit tests. Playwright covers the
markdown editor and PDF viewer webview behavior.
