Below is the updated implementation plan and design philosophy for the **PDF viewer** and **markdown system** in LLM Wiki.

> Historical/obsolete design note: this assessment predates the native
> reference-model update. The current generated link format is native
> Markdown/Obsidian, not `llm-wiki://`. See
> [reference model.md](reference%20model.md) and
> [implementation detail.md](implementation%20detail.md) for current behavior.

The core direction is:

```text
PDF viewer:
  source selection → stable anchor → markdown link → graph edge → agent context

Markdown editor:
  raw markdown remains source of truth
  visual rendering is an editor/view-layer enhancement
  links are parsed, indexed, repaired, and navigable
```

This follows the current LLM Wiki plan: local-first VS Code workspace, `.llm_wiki/` metadata, SQLite index, source anchors, hybrid CodeMirror markdown, PDF/web/code anchors, backlinks, agent context files, and Claude/Codex compatibility.  [oai_citation:0‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

---

# 1. Design philosophy

## 1.1 Source files are truth; SQLite is an index

Do **not** treat SQLite as the canonical knowledge base.

Canonical data:

```text
notes/*.md
raw/pdf/*.pdf
raw/web/*
raw/code/*
.llm_wiki/annotations/*
.llm_wiki/anchors/*     optional durable sidecars
```

Derived/rebuildable data:

```text
.llm_wiki/index.sqlite
.llm_wiki/references/*
.llm_wiki/cache/*
.llm_wiki/embeddings/*
```

This is important because both humans and agents can edit markdown. The safest model is:

```text
human or agent edits markdown
→ file watcher / CLI hook detects changes
→ parser rebuilds links/anchors/index
→ SQLite updates automatically
```

So agents should not write SQLite directly. They should write markdown or call `llm_wiki` tools that write markdown/sidecars and then trigger indexing.

The existing plan already treats the index as rebuildable, and the MVP requires source registry, source-link parser, backlinks/forward-links, `llm_wiki links check`, and agent context export.  [oai_citation:1‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

---

## 1.2 PDF engines are replaceable; anchors are permanent

The PDF engine should not own the product model.

PDF engine owns:

```text
rendering
text extraction
selection geometry
page coordinate conversion
maybe annotation drawing primitives
```

LLM Wiki owns:

```text
llm-wiki:// URI scheme
anchor IDs
SQLite graph
reference sidecars
annotation sidecars
PDF → note backlinks
note → PDF jump
agent context export
anchor repair
```

This lets us start with **EmbedPDF/PDFium**, keep **PDF.js** as fallback, and keep **MuPDF** optional. EmbedPDF’s PDFium docs describe high-fidelity rendering, text extraction/search, forms, annotation support, signatures, and PDF modification/creation through a WebAssembly PDFium build.  [oai_citation:2‡EmbedPDF](https://www.embedpdf.com/docs/pdfium/introduction?utm_source=chatgpt.com) Its viewer engine docs also warn that direct engine operations are stateless and UI-visible operations should go through plugins, so our design should integrate through viewer/plugin state while using engine access mostly for read-only extraction.  [oai_citation:3‡EmbedPDF](https://www.embedpdf.com/docs/react/viewer/engine?utm_source=chatgpt.com)

---

## 1.3 Precise references require anchors

For whole files and headings, links can be simple:

```md
[[FlashAttention]]
[Online Softmax](llm-wiki://note/notes/Concepts/FlashAttention.md#online-softmax)
```

For precise PDF regions, links carry the exact quoted text with an explicit
page:

```md
[FlashAttention uses tiling](raw/pdf/fa.pdf#page=3:~:text=FlashAttention%20uses%20tiling)
```

The agent should **not** hallucinate geometry like:

```md
[source](llm-wiki://pdf/raw/pdf/fa.pdf?page=3&rect=120,240,530,310)
```

Instead:

```text
agent searches or quotes text
→ llm_wiki tool validates against source
→ llm_wiki tool creates anchor
→ agent inserts returned URI
```

This is the central reliability rule.

---

## 1.4 Markdown remains raw markdown

The markdown editor must preserve plain `.md` files. Rendering is not the data model.

The current plan states the correct invariant:

```text
The CodeMirror document remains raw markdown.
Rendered output is decoration/widget state.
```

That keeps notes portable and agent-readable.  [oai_citation:4‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f) CodeMirror 6 decorations support marks, widgets, replacing decorations, and line decorations, which map well to hybrid editing where active lines show raw markdown and inactive lines render visually.  [oai_citation:5‡EmbedPDF](https://www.embedpdf.com/docs/pdfium/introduction?utm_source=chatgpt.com)

---

## 1.5 The UI should expose the graph

LLM Wiki is not just a PDF reader or markdown editor. It is a source-addressable graph workspace.

The VS Code side panel should expose:

```text
Outline
Forward Links
Backlinks
Referenced By
Agent Context
Problems / stale links
```

The uploaded feature plan already includes Hybrid Markdown Editor, PDF Viewer, Backlinks Panel, Forward Links Panel, Agent Context Panel, Raw Corpus Panel, Activity Panel, Problems Panel, and Mobile Inbox Panel.  [oai_citation:6‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

# 2. PDF viewer implementation plan

## 2.1 PDF engine decision

### Default candidate: EmbedPDF / PDFium

Use **EmbedPDF** as the primary PDF prototype.

Why:

```text
PDFium/WASM
modern TypeScript viewer ecosystem
headless/custom integration path
selection plugin
annotation plugin
better licensing path than MuPDF
```

EmbedPDF/PDFium gives us the best chance to avoid MuPDF’s AGPL/commercial constraints while still getting a strong rendering engine. EmbedPDF’s PDFium layer is a WebAssembly build and requires explicit initialization and memory management at the raw PDFium layer.  [oai_citation:7‡EmbedPDF](https://www.embedpdf.com/docs/pdfium/getting-started?utm_source=chatgpt.com)

### Fallback: PDF.js

Keep PDF.js fallback because it is mature and webview-friendly.

Use PDF.js if:

```text
EmbedPDF cannot run cleanly in VS Code webview
EmbedPDF selection geometry is insufficient
WASM packaging becomes problematic
plugin model blocks our overlays
```

### Optional backend: MuPDF

Keep MuPDF as optional only.

Why:

```text
good AI/text/annotation story
but license/deployment risk
not default for permissive OSS
```

### Do not start with raw PDFium

Raw PDFium gives maximum control, but it forces us to build the viewer, text layer, selection layer, annotation layer, and plugin model ourselves. Use EmbedPDF first.

---

## 2.2 PDF viewer package structure

```text
packages/
  core/
    anchors/
    links/
    references/
    context/
    diagnostics/

  pdf/
    src/
      types.ts
      PdfEngine.ts
      PdfViewerAdapter.ts
      PdfAnchorService.ts
      PdfReferenceOverlay.ts
      PdfCoordinate.ts
      PdfSelection.ts
      PdfAnnotationSidecar.ts

  pdf-engine-embedpdf/
    src/
      EmbedPdfEngine.ts
      EmbedPdfViewerAdapter.ts
      selection.ts
      annotations.ts
      overlays.ts

  pdf-engine-pdfjs/
    src/
      PdfJsEngine.ts
      PdfJsViewerAdapter.ts
      textLayer.ts
      overlays.ts

  pdf-engine-mupdf/
    src/
      MupdfEngine.ts
      MupdfViewerAdapter.ts
    README.md  # optional AGPL/commercial warning

  vscode-extension/
    src/
      editors/pdf/
        PdfCustomEditorProvider.ts
        PdfWebviewHost.ts
        pdfMessageProtocol.ts
```

The extension must use webview message passing: VS Code webviews are sandboxed, and communication between webview and extension host uses `postMessage` / `acquireVsCodeApi().postMessage()`.  [oai_citation:8‡VS Code API](https://www.vscodeapi.com/interfaces/vscode.webview?utm_source=chatgpt.com)

---

## 2.3 PDF engine interfaces

Define the engine boundary before binding to EmbedPDF.

```ts
export type PdfRect = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  space: "pdf-page";
};

export type PdfTextItem = {
  text: string;
  page: number;
  rect: PdfRect;
  lineIndex?: number;
  charStart?: number;
  charEnd?: number;
};

export type PdfSelection = {
  sourcePath: string;
  page: number;
  rects: PdfRect[];
  textQuote: string;
  engine: "embedpdf" | "pdfjs" | "mupdf";
};

export interface PdfEngine {
  open(input: { sourcePath: string; bytes: Uint8Array }): Promise<PdfDocumentHandle>;
  getPageCount(doc: PdfDocumentHandle): Promise<number>;
  getPageText(doc: PdfDocumentHandle, page: number): Promise<PdfTextItem[]>;
  getTextInRects(doc: PdfDocumentHandle, page: number, rects: PdfRect[]): Promise<string>;
  searchText(doc: PdfDocumentHandle, query: string): Promise<PdfSearchHit[]>;
}
```

Viewer adapter:

```ts
export interface PdfViewerAdapter {
  mount(el: HTMLElement, input: PdfOpenInput): Promise<void>;
  jumpToAnchor(anchor: PdfAnchor): Promise<void>;
  getCurrentSelection(): Promise<PdfSelection | null>;

  setReferenceOverlays(overlays: PdfReferenceOverlay[]): void;
  setUserAnnotations(annotations: PdfUserAnnotation[]): void;

  onSelectionChanged(cb: (selection: PdfSelection) => void): void;
  onReferenceClicked(cb: (anchorUri: string) => void): void;
  onPageChanged(cb: (page: number) => void): void;
}
```

---

## 2.4 PDF anchor model

Use anchor IDs for durable precise references.

```json
{
  "id": "anc_pdf_8f21",
  "kind": "pdf_rect",
  "source": "raw/pdf/fa.pdf",
  "page": 3,
  "rects": [
    [120, 240, 530, 310]
  ],
  "text_quote": "FlashAttention uses tiling...",
  "text_hash": "sha256:...",
  "source_hash": "sha256:...",
  "created_by": "human_selection | agent_quote | repair",
  "created_at": "2026-05-23T..."
}
```

Preferred markdown link:

```md
[FlashAttention uses tiling](raw/pdf/fa.pdf#page=3:~:text=FlashAttention%20uses%20tiling)
```

Internal annotation IDs are storage identity only and are not link targets.

Only treat raw geometry links as transitional/debug syntax:

```md
[source](llm-wiki://pdf/raw/pdf/fa.pdf?page=3&rect=120,240,530,310)
```

The existing feature list already defines PDF anchors as page number, bounding rectangles, source hash, and text quote.  [oai_citation:9‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

## 2.5 PDF reference sidecar

Generate this from SQLite links. Do not hand-edit it normally.

```text
.llm_wiki/references/pdf/fa.references.json
```

```json
{
  "source": "raw/pdf/fa.pdf",
  "source_hash": "sha256:...",
  "references": [
    {
      "anchor_uri": "raw/pdf/fa.pdf#page=3:~:text=FlashAttention%20uses%20tiling",
      "anchor_id": "anc_pdf_8f21",
      "page": 3,
      "rects": [[120, 240, 530, 310]],
      "text_quote": "FlashAttention uses tiling...",
      "referenced_by": [
        {
          "kind": "note",
          "path": "notes/Concepts/FlashAttention.md",
          "line": 42,
          "label": "source"
        }
      ]
    }
  ]
}
```

PDF viewer behavior:

```text
open PDF
→ load references sidecar
→ draw reference overlays
→ click overlay
→ show referenced-by popup
→ open note at line
```

The existing plan’s PDF acceptance test is exactly this: select text, insert source reference into markdown, click note link to open PDF region, then click highlighted PDF region to see referencing note.  [oai_citation:10‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

---

## 2.6 PDF annotation sidecar

Keep user annotations separate from generated reference highlights.

```text
.llm_wiki/annotations/pdf/fa.annotations.json
```

```json
{
  "source": "raw/pdf/fa.pdf",
  "source_hash": "sha256:...",
  "annotations": [
    {
      "id": "ann_001",
      "kind": "highlight",
      "anchor_id": "anc_pdf_8f21",
      "page": 3,
      "rects": [[120, 240, 530, 310]],
      "comment": "Important for online softmax",
      "created_at": "..."
    }
  ]
}
```

Two separate layers:

```text
reference highlight:
  generated from notes that cite source region

user annotation:
  human-created reading mark / comment / ink
```

This distinction is already in the plan: user highlights and reference highlights are semantically different.  [oai_citation:11‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

## 2.7 PDF commands

VS Code commands:

```text
LLM Wiki: Open PDF Source
LLM Wiki: Insert PDF Source Reference
LLM Wiki: Create Anchor from Current PDF Selection
LLM Wiki: Add PDF Selection to Agent Context
LLM Wiki: Copy PDF Anchor URI
LLM Wiki: Show References to This Region
LLM Wiki: Show User Annotations
LLM Wiki: Validate PDF Anchors
LLM Wiki: Repair PDF Anchors
```

CLI commands:

```bash
llm_wiki anchor create-pdf --source raw/pdf/fa.pdf --quote "..." --page-hint 3 --json
llm_wiki anchor resolve 'raw/pdf/fa.pdf#page=3:~:text=FlashAttention%20uses%20tiling' --json
llm_wiki anchor validate 'raw/pdf/fa.pdf#page=3:~:text=FlashAttention%20uses%20tiling' --json
llm_wiki references rebuild --source raw/pdf/fa.pdf
llm_wiki links check --fix
```

Agent/MCP tools:

```ts
llm_wiki.anchor.createFromQuote({
  source: "raw/pdf/fa.pdf",
  quote: "...",
  pageHint: 3
})

llm_wiki.anchor.resolve({
  uri: "raw/pdf/fa.pdf#page=3:~:text=FlashAttention%20uses%20tiling"
})

llm_wiki.get_backlinks({
  uri: "raw/pdf/fa.pdf#page=3:~:text=FlashAttention%20uses%20tiling"
})
```

---

## 2.8 PDF implementation phases

### Phase PDF-0 — Prototype engine viability

Goal: verify EmbedPDF inside VS Code webview.

To-dos:

```text
[ ] Create PDF webview shell.
[ ] Bundle EmbedPDF/PDFium WASM locally, no CDN.
[ ] Open local PDF from raw/pdf.
[ ] Render pages.
[ ] Select text.
[ ] Get selected text.
[ ] Get selection rects.
[ ] Convert screen coords to page coords.
[ ] Draw overlay from saved rects.
[ ] Reopen PDF and redraw overlay.
[ ] Click overlay and emit anchor URI to extension host.
[ ] Repeat same test with PDF.js fallback.
```

Pass condition:

```text
Select paragraph → create anchor → insert note link → reopen PDF → overlay appears → click overlay → open note.
```

### Phase PDF-1 — Anchor creation

```text
[ ] Define PdfAnchor schema.
[ ] Create anchors table.
[ ] Create optional .llm_wiki/anchors/*.json sidecar.
[ ] Implement createFromSelection.
[ ] Implement createFromQuote.
[ ] Implement resolveAnchor.
[ ] Implement validateAnchor.
[ ] Implement text quote normalization.
[ ] Implement source hash validation.
```

### Phase PDF-2 — Note ↔ PDF navigation

```text
[ ] Parse portable PDF page/text-fragment links.
[ ] Implement DocumentLinkProvider routing.
[ ] Implement openPdfAtTarget.
[ ] Implement PDF webview page/text-fragment navigation.
[ ] Implement PDF reference overlay.
[ ] Implement referenced-by popup.
[ ] Implement open note at line.
```

### Phase PDF-3 — Reference sidecars

```text
[ ] Query SQLite links where to_uri targets PDF anchors.
[ ] Generate .llm_wiki/references/pdf/*.json.
[ ] Load sidecar in PDF viewer.
[ ] Refresh sidecar on markdown changes.
[ ] Implement overlay hit-testing.
[ ] Implement overlapping-region query.
```

### Phase PDF-4 — User annotations

```text
[ ] Add user highlight tool.
[ ] Add comment/margin-note tool.
[ ] Store annotations in .llm_wiki/annotations/pdf/*.json.
[ ] Keep annotation sidecar separate from reference sidecar.
[ ] Add optional EmbedPDF annotation plugin integration.
[ ] Add future ink/freehand support.
```

### Phase PDF-5 — Repair and validation

```text
[ ] If source moved, recover by source_hash.
[ ] If rect stale, search by text_quote.
[ ] If quote appears once, repair automatically.
[ ] If ambiguous, show diagnostic.
[ ] If missing, mark stale.
[ ] Add Problems panel diagnostics.
```

---

# 3. Markdown implementation plan

## 3.1 Markdown system design

Use two layers:

### MVP: native VS Code markdown

Use normal VS Code markdown editor first.

Add:

```text
DocumentLinkProvider for llm-wiki:// links
HoverProvider for note/PDF/code previews
CodeLens or inline badges later
Selection export command
Backlinks / Forward Links panel
Problems diagnostics
```

This gets us working fast.

### First serious release: CodeMirror hybrid editor

Build CodeMirror custom editor after the source-anchor workflow is proven.

The plan already lists CodeMirror deliverables: source mode, reading mode, live preview, active-line raw syntax, inactive-line rendered syntax, link rendering, Cmd-click link open, selection bridge, and agent context export.  [oai_citation:12‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

VS Code custom editors can use webviews, and `CustomTextEditorProvider` is appropriate when the backing data is text; this fits the requirement that `.md` remains the source document.  [oai_citation:13‡EmbedPDF](https://www.embedpdf.com/docs/pdfium/introduction?utm_source=chatgpt.com)

---

## 3.2 Markdown link types

Support these link classes.

### Note-level

```md
[[FlashAttention]]
```

Canonical internal target:

```text
llm-wiki://note/notes/Concepts/FlashAttention.md
```

No anchor ID required.

### Heading-level

```md
[[FlashAttention#Online Softmax]]
```

Better canonical target:

```md
[Online Softmax](llm-wiki://note/notes/Concepts/FlashAttention.md#online-softmax)
```

Prefer stable heading IDs:

```md
## Online Softmax {#online-softmax}
```

Anchor ID optional.

### Block-level / paragraph-level

Use stable anchor.

```md
[source](llm-wiki://anchor/anc_note_8f21)
```

Anchor record:

```json
{
  "id": "anc_note_8f21",
  "kind": "note_block",
  "source": "notes/Concepts/FlashAttention.md",
  "heading": "Online Softmax",
  "block_id": "online-softmax-merge-rule",
  "line_start": 42,
  "line_end": 46,
  "text_quote": "The merge rule combines local softmax statistics...",
  "text_hash": "sha256:..."
}
```

### PDF-level / source-level

```md
[source](raw/pdf/fa.pdf#page=3)
```

No precise anchor, only source-level.

### PDF region

```md
[FlashAttention uses tiling](raw/pdf/fa.pdf#page=3:~:text=FlashAttention%20uses%20tiling)
```

Precise page/text selector required.

### Code range

```md
[kernel](llm-wiki://code/src/kernel.cu?lines=80-145)
```

Later add symbol anchors:

```md
[kernel](llm-wiki://code/src/kernel.cu?symbol=flash_attention_forward)
```

---

## 3.3 Markdown indexer

Every markdown file change triggers parsing.

Parser extracts:

```text
frontmatter
note id
aliases
headings
stable heading IDs
block IDs
wikilinks
markdown links
llm-wiki:// links
outgoing links
inline source anchors
```

Index update:

```sql
DELETE FROM links WHERE from_note_path = :path AND created_by = 'parser';

INSERT INTO links (...);
```

This ensures both human-created and agent-created links enter SQLite automatically.

Recommended debounce:

```text
on text change:
  500–1500 ms

on save:
  immediate

on external file watcher burst:
  1–3 seconds

CLI:
  explicit llm_wiki links rebuild --changed
```

---

## 3.4 Markdown editor features

### Source mode

Raw markdown everywhere.

Use native VS Code or CodeMirror source mode.

### Hybrid mode

Active line or active selection shows raw markdown. Inactive lines render visually.

Examples:

```md
**online softmax**
```

inactive rendering:

```text
online softmax
```

but active line shows:

```md
**online softmax**
```

### Reading mode

Fully rendered, minimal raw syntax.

### Link rendering

Inactive line:

```md
[FlashAttention uses tiling](raw/pdf/fa.pdf#page=3:~:text=FlashAttention%20uses%20tiling)
```

renders as:

```text
source  [PDF p.3]
```

Click opens the target.

### Inline badges

Show small badges:

```text
3 backlinks
PDF p.3
stale?
agent-context
```

### Selection export

Selecting a markdown block and running command writes:

```text
.llm_wiki/agent/selection.md
.llm_wiki/agent/selection.json
```

This is already required in the current plan.  [oai_citation:14‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

---

## 3.5 CodeMirror implementation

Use CodeMirror only after the native editor workflow works.

CodeMirror modules:

```text
Markdown parser extension
Hybrid rendering extension
Link decoration extension
Source-anchor chip extension
Backlink badge extension
Diagnostics extension
Selection export extension
Command bridge extension
```

Message protocol:

```ts
type WebviewToHost =
  | { type: "ready" }
  | { type: "docChanged"; changes: CMChange[] }
  | { type: "selectionChanged"; payload: SelectionPayload }
  | { type: "openLink"; href: string }
  | { type: "addSelectionToContext"; payload: SelectionPayload }
  | { type: "createNoteBlockAnchor"; payload: SelectionPayload };

type HostToWebview =
  | { type: "init"; text: string; path: string; config: EditorConfig }
  | { type: "update"; text: string; version: number }
  | { type: "diagnostics"; diagnostics: DiagnosticPayload[] }
  | { type: "linksUpdated"; links: LinkPayload[] };
```

Important implementation rule:

```text
VS Code TextDocument remains source of truth.
CodeMirror mirrors it.
Webview sends edits to extension host.
Extension applies WorkspaceEdit.
External file changes update webview.
```

---

# 4. Side panels: outline, forward links, backlinks

## 4.1 Do not depend only on built-in Outline

VS Code’s built-in Outline is good for text documents and symbols, but not enough for PDF anchors, backlinks, reference overlays, and graph edges.

Use a LLM Wiki view container:

```text
LLM Wiki
├── Navigation
├── Links
├── Agent Context
└── Problems / Activity maybe later
```

VS Code’s Tree View API is intended for structured extension views and can be contributed to the sidebar/panel using a `TreeDataProvider`.  [oai_citation:15‡EmbedPDF](https://www.embedpdf.com/docs/pdfium/introduction?utm_source=chatgpt.com)

## 4.2 Navigation panel

For markdown:

```text
Outline
├── # FlashAttention
│   ├── ## Online Softmax
│   ├── ## IO Complexity
│   └── ## CUDA Kernel
```

For PDF:

```text
PDF Outline
├── Abstract
├── Introduction
├── Method
└── Experiments

Referenced Regions
├── p3 · FlashAttention tiling · 2 refs
├── p5 · Online softmax recurrence · 1 ref
└── p7 · IO theorem · 3 refs
```

For code:

```text
Symbols
├── flash_attention_forward()
└── online_softmax_update()

Referenced Ranges
├── L80-L145 · cited by FlashAttention.md
```

## 4.3 Links panel

```text
Links
├── Forward Links
│   ├── [[Online Softmax]]
│   ├── PDF · fa.pdf p3
│   └── Code · kernel.cu L80-L145
├── Backlinks
│   ├── CUDA Shared Memory.md
│   └── Daily Notes/2026-05-23.md
└── Broken / Stale Links
    ├── missing heading
    └── stale PDF anchor
```

---

# 5. SQLite schema additions

Core tables:

```sql
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  title TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE anchors (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  uri TEXT NOT NULL UNIQUE,
  locator_json TEXT NOT NULL,
  text_quote TEXT,
  text_hash TEXT,
  source_hash TEXT,
  status TEXT NOT NULL DEFAULT 'resolved',
  created_by TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE links (
  id TEXT PRIMARY KEY,
  from_uri TEXT,
  from_note_path TEXT,
  from_line INTEGER,
  to_uri TEXT NOT NULL,
  to_anchor_id TEXT,
  label TEXT,
  relation TEXT NOT NULL DEFAULT 'references',
  created_by TEXT NOT NULL DEFAULT 'parser',
  status TEXT NOT NULL DEFAULT 'resolved',
  confidence REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE outline_items (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  level INTEGER,
  anchor_uri TEXT,
  locator_json TEXT NOT NULL,
  sort_key TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE diagnostics (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_path TEXT,
  line INTEGER,
  message TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
```

The implementation plan already calls for SQLite tables around sources, anchors, links, chunks, activity, jobs, and diagnostics.  [oai_citation:16‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

---

# 6. Agent reliability rules

Put this in `AGENTS.md` / `CLAUDE.md`.

```md
## Source-link rules

Do not invent PDF rectangle coordinates.

When citing PDFs:
1. Prefer existing anchors returned by `llm_wiki search`.
2. If no anchor exists, call `llm_wiki anchor create-pdf --quote ... --source ...`.
3. Insert only the canonical URI returned by the tool.
4. If the tool reports ambiguous or not_found, do not fabricate geometry.
5. After note edits, run `llm_wiki links check --fix`.

When citing markdown:
1. Whole-note links may use `[[Note]]`.
2. Heading links may use `[[Note#Heading]]` or `llm-wiki://note/...#heading-id`.
3. Specific paragraph links require `llm_wiki anchor create-note-block`.
```

Rationale:

```text
agent supplies semantic intent
LLM Wiki tool validates against source
LLM Wiki tool returns canonical anchor
agent inserts canonical link
indexer updates SQLite
```

---

# 7. Implementation roadmap

## MVP

Goal: prove the core invariant.

```text
Every meaningful selection can become:
  stable anchor
  markdown link
  graph edge
  agent context bundle
```

Tasks:

```text
[ ] .llm_wiki workspace layout
[ ] SQLite schema
[ ] llm-wiki:// URI parser
[ ] markdown link parser
[ ] native VS Code DocumentLinkProvider
[ ] Backlinks / Forward Links view
[ ] Add Selection to Agent Context command
[ ] PDF webview prototype with EmbedPDF
[ ] PDF.js fallback adapter skeleton
[ ] create PDF anchor from selection
[ ] insert PDF source link into markdown
[ ] note → PDF jump
[ ] basic PDF reference sidecar generation
[ ] llm_wiki links check
[ ] AGENTS.md / CLAUDE.md rules
```

This matches the planned MVP scope: workspace, SQLite, markdown/code ingestion, PDF text ingestion, URI parser, link parser, backlinks/outgoing links, context export, DocumentLinkProvider, and agent instruction generation.  [oai_citation:17‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

---

## First serious release

Tasks:

```text
[ ] CodeMirror hybrid markdown editor
[ ] PDF reference highlights
[ ] PDF → note referenced-by popup
[ ] PDF user highlights/comments
[ ] Markdown heading/block anchors
[ ] Anchor repair by quote/hash
[ ] Navigation side panel
[ ] Activity tracking
[ ] MCP read-only tools
[ ] Search over notes + PDF anchors
```

The existing plan lists CodeMirror hybrid editor, PDF text selection, page/rect anchors, PDF reference highlights, note → PDF jump, PDF → note popup, embeddings, MCP, and daily activity as first serious release items.  [oai_citation:18‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

## Advanced release

Tasks:

```text
[ ] HTML snapshot viewer with DOM anchors
[ ] iPad/mobile annotation import
[ ] handwritten PDF annotations
[ ] markdown handwriting image insertion
[ ] symbol-aware code anchors
[ ] graph visualization
[ ] review queue / spaced repetition
[ ] Zotero import/export only as adapter
[ ] annotated PDF export copy
```

---

# 8. Test plan

## PDF tests

```text
[ ] Open local PDF offline.
[ ] Render 20 arXiv papers.
[ ] Render long textbook PDF.
[ ] Select text across line wraps.
[ ] Select text in two-column PDF.
[ ] Extract text_quote from selection.
[ ] Store page + rects + quote + hash.
[ ] Reopen PDF and draw same overlay.
[ ] Click markdown source link and jump to PDF rect.
[ ] Click PDF overlay and show referencing notes.
[ ] Validate anchor after PDF move.
[ ] Detect stale anchor after PDF content change.
[ ] Repair anchor by quote search.
```

## Markdown tests

```text
[ ] Parse [[Note]].
[ ] Parse [[Note#Heading]].
[ ] Parse [label](llm-wiki://note/...).
[ ] Parse [source](llm-wiki://anchor/...).
[ ] Rename note and repair link.
[ ] Rename heading and repair if heading ID exists.
[ ] Move paragraph and resolve by block ID.
[ ] Detect deleted block anchor.
[ ] Agent creates link, file watcher indexes it.
[ ] Backlinks panel updates.
[ ] Forward links panel updates.
[ ] CodeMirror active line shows raw syntax.
[ ] Inactive line renders source link chip.
[ ] Selection export writes .llm_wiki/agent/selection.md/json.
```

## Engine swap test

```text
[ ] Create PDF anchor with EmbedPDF.
[ ] Open same anchor with PDF.js adapter.
[ ] Overlay appears at same page/rect.
[ ] Graph/backlinks still work.
```

This validates the most important architecture claim:

```text
PDF engine is replaceable.
Source anchors are permanent.
```

---

# 9. Final recommended design

## PDF viewer

Use:

```text
EmbedPDF/PDFium as primary implementation
PDF.js as fallback
MuPDF as optional advanced backend
```

Store:

```text
anchors in SQLite / optional anchor sidecars
reference highlights in generated sidecars
user annotations in annotation sidecars
raw PDFs immutable
```

Expose:

```text
note → PDF jump
PDF → note referenced-by popup
agent-safe anchor creation
```

## Markdown

Use:

```text
native VS Code markdown first
CodeMirror hybrid editor second
plain markdown as canonical source
llm-wiki:// links as semantic source links
wikilinks as authoring sugar
```

Support:

```text
note links
heading links
block anchors
PDF anchors
code anchors
backlinks
forward links
outline
diagnostics
agent context export
```

## Core rule

```text
Do not build a PDF editor.
Do not build a generic note app.
Build a source-addressable learning graph.

PDF and markdown are just two frontends over:
  anchors
  links
  graph
  context
  repair
  agent handoff
```
