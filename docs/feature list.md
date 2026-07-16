# Human Learning - Current Feature List

Human Learning is a local-first VS Code learning workspace. It keeps raw
sources, markdown notes, citations, link graph data, PDF/web locators, search
chunks, and agent context in one inspectable vault.

This document describes the current implementation direction after the native
reference-model update. Older planning docs may still contain `hl://` examples;
those examples are historical, not the current generated user-facing format.

## 1. Vault Model

```text
vault/
  raw/
    pdf/
    web/
    code/
    images/
    text/
  notes/
    Concepts/
    Papers/
    Projects/
    Daily Notes/
    Literature Notes/
    assets/
  .hl/
    index.sqlite
    embeddings/
    cache/
    agent/
      selection.md
      selection.json
      related.md
      today.md
      context.md
      context.json
  AGENTS.md
  CLAUDE.md
  .agents/skills/human-learning/SKILL.md
  .claude/commands/
  .codex/config.toml
```

Canonical knowledge remains in `raw/` and `notes/`. SQLite is a runtime index
that can be rebuilt from markdown, source files, and durable metadata.

## 2. Link Formats

Human Learning no longer generates `hl://` links for notes, code, PDFs, or web
targets. User-facing links are Obsidian/native markdown-compatible.

| Target | Format |
| --- | --- |
| Note | `[[Online Softmax#Why This Matters]]` |
| Code line range | `[kernel](raw/code/attention.cu#L42-L57)` |
| PDF page | `[paper p7](raw/pdf/flash-attention.pdf#page=7)` |
| PDF text selection | `[selected text](raw/pdf/flash-attention.pdf#page=7:~:text=selected%20text)` |
| Web native section | `[section](https://example.com/article#results)` |
| Web text fragment | `[quote](https://example.com/article#:~:text=selected%20text)` |
| Web DOM fallback | `[DOM block](https://example.com/article#hl-web=web_abc123)` |

The parser stores every resolved edge in SQLite with the native target string in
`links.to_uri`. Wikilinks are resolved to native vault paths for graph lookup,
but remain readable and portable in markdown.

## 3. Reference Classification

The core reference classifier maps link destinations into:

```text
note | pdf | code | web | image | text | unknown
```

Classification uses scheme, file extension, path, and fragment:

- `*.md` paths are notes.
- `*.pdf` paths and `raw/pdf/...` paths are PDFs.
- Code extensions or `#Lx-Ly` fragments are code links.
- `http://` and `https://` links are web links.
- `#hl-web=<id>` resolves a durable web fallback target.
- Image and text extensions open as ordinary files.

## 4. Link Graph

The graph supports:

- markdown links: `[label](target)`
- Obsidian wikilinks: `[[Note]]`, `[[Note#Heading]]`, `[[Note|Alias]]`
- same-note heading links: `[[#Heading]]`
- same-note block references: `[[#^block-id]]`
- image embeds: `![[image.png]]`

Graph rebuild deletes previous parser edges for the note, reparses the raw
markdown file, and inserts resolved edges into `links`. Backlinks and forward
links are read directly from SQLite.

## 5. PDF Chunks And Anchors

PDF chunks and PDF anchors coexist.

| Object | Purpose | Created When |
| --- | --- | --- |
| Chunk | Retrieval and citation unit | PDF ingestion/search |
| Anchor | Durable arbitrary selection | User or agent cites a selection outside a stable chunk |

PDF ingestion creates layout-ish chunk blocks:

```text
paragraph
heading
caption
table
list
formula
```

Each chunk stores locator metadata in `chunks.metadata_json`, including:

```json
{
  "source_path": "raw/pdf/flash-attention.pdf",
  "page_start": 7,
  "page_end": 7,
  "block_type": "paragraph",
  "reading_order": 3,
  "text_offset_start": 1204,
  "text_offset_end": 1518,
  "bbox_rects": [],
  "section_path": [],
  "source_hash": "sha256...",
  "chunk_hash": "sha256..."
}
```

Search results emit portable links such as:

```md
[selected text](raw/pdf/flash-attention.pdf#page=7:~:text=selected%20text)
```

Anchors are sparse. They are created only when the user or agent needs a durable
annotation for a selection that is not already represented by a stable chunk.
Their stored URI uses the same portable format:

```md
[selected text](raw/pdf/flash-attention.pdf#page=7:~:text=selected%20text)
```

Internal anchor IDs remain in SQLite and `.hl/anchors/` sidecar state; they are
not exposed in Markdown destinations.

## 6. Web References

Human Learning uses normal web URLs whenever possible:

- native URL fragments
- browser text fragments
- plain `https://` links

When the web page has no stable native target, the system stores a durable
fallback record in `web_targets`:

```json
{
  "id": "web_abc123",
  "url": "https://example.com/article",
  "title": "Article title",
  "selected_text": "selected text",
  "text_fragment": "https://example.com/article#:~:text=selected%20text",
  "css_selector": "main article p:nth-of-type(4)",
  "xpath": "/html/body/main/article/p[4]",
  "text_hash": "sha256..."
}
```

User-facing markdown uses:

```md
[DOM block](https://example.com/article#hl-web=web_abc123)
```

The VS Code dispatcher resolves `hl-web` metadata from SQLite. It opens Chrome
first and falls back to VS Code's external URL opener if Chrome is unavailable.

## 7. Search And Retrieval

Current built-in search supports:

- lexical search through `search_index`
- deterministic local semantic vectors for offline tests
- hybrid fusion over lexical and semantic results
- note-only search
- PDF chunk links in `SearchResult.anchor_uri`

The generated Human Learning agent skill tells agents to prefer `tobi/qmd` for
local hybrid retrieval and reranking when available. Human Learning still owns
the citation links and locator metadata for notes, code, PDFs, and web targets.

## 8. Markdown Editor

The markdown custom editor is CodeMirror-based and keeps the document as raw
markdown. Rendering is decoration/widget state.

Implemented editor behavior includes:

- Obsidian-like document title and YAML properties surface
- active lines show raw markdown syntax
- inactive headings, math, links, callouts, tables, images, comments, tags, and
  footnotes render visually
- MathJax display/inline math rendering
- Prism-highlighted fenced code
- Mermaid diagrams with natural-scale rendering and scrollable wide diagrams
- Obsidian callouts, task lists, tables, image embeds, reference links, and
  footnote rendering
- raw markdown copy/paste preservation through rendered widgets
- Turndown-based HTML paste conversion
- Vim mode support, including movement into math/code blocks and `:w`, `:q`,
  `:wq`, and `:x` host messages
- editor typography inherited from VS Code editor settings

## 9. PDF Viewer

The bundled extension uses EmbedPDF/PDFium for the current custom PDF viewer.
The viewer can open local PDFs, render pages, expose text selection actions,
insert markdown links into the active markdown editor, and resolve page and
text-fragment targets.

The current dispatcher sends PDF targets to:

```ts
human-learning.openPdfTarget({pdfPath,page,textFragment})
```

If the custom PDF command is unavailable, it falls back to VS Code's default file
open behavior.

## 10. VS Code Extension

The main extension contributes:

- custom editor: `human-learning.markdownEditor`
- custom editor: `human-learning.pdfViewer`
- commands for context export, link refresh, current-file ingest, markdown open,
  PDF navigation, and Vim mode toggle
- Human Learning activity-bar views:
  - Backlinks
  - Forward Links
  - Outline
  - Agent Context
  - Problems
- split-package builds for the markdown and PDF extensions

## 11. Agent Instructions

Generated `AGENTS.md`, `CLAUDE.md`, and `.agents/skills/human-learning/SKILL.md`
now instruct agents to:

- use native Markdown/Obsidian links
- avoid inventing PDF rectangle coordinates, chunk IDs, anchor IDs, or web target
  IDs
- cite PDF chunks directly when search returns a stable chunk link
- create anchors only for arbitrary selections not covered by chunks
- use `hl search` before creating quote-based PDF anchors
- run `hl links check --fix` after note edits
- prefer `qmd` for local hybrid retrieval/reranking when configured

## 12. Verification Baseline

The current reference-model/editor work is covered by:

```bash
pnpm test
pnpm build:extension
node packages/vscode-extension/test/e2e/pure-e2e.mjs
npx playwright test --config playwright.config.ts
```

The Playwright suite covers markdown editor rendering, Obsidian-style navigation,
Vim behavior, math/code/Mermaid parity, PDF viewer smoke behavior, and link
click dispatch.
