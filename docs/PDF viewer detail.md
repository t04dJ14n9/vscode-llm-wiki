## Bottom-line recommendation

Use **EmbedPDF / PDFium as the primary PDF prototype**, keep **PDF.js as a fallback**, and keep **MuPDF optional / non-core** because of licensing and production-key constraints.

The Human Learning PDF layer should be **engine-independent**. The package should only provide rendering, selection, text extraction, coordinates, and maybe annotation primitives. Human Learning should own the important product model:

```text
hl://pdf anchors
.hl/references/pdf/*.json
.hl/annotations/pdf/*.json
PDF -> referenced notes popup
note -> PDF jump
agent context export
anchor repair
```

This matches the existing Human Learning architecture: PDFs need page/rect anchors, reference highlights, note → PDF jump, PDF → note jump, user highlights, annotation sidecars, and raw PDF immutability.  [oai_citation:0‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f) The core invariant is broader than PDF: every selected fragment should become a stable anchor, markdown link, graph edge, optional embedding chunk, activity event, agent context bundle, and optional MCP resource.  [oai_citation:1‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

# 1. Functionality we need

## A. Core PDF viewer features

| Need | Description | Required phase |
|---|---|---|
| Open local PDF in VS Code webview | Load from `raw/pdf/*.pdf`, local-first/offline | MVP |
| Render pages | Accurate page rendering, zoom, scroll, rotate | MVP |
| Page virtualization | Efficient large papers/books | Serious release |
| Text layer / selectable text | User can select text like normal PDF reader | MVP |
| Selection coordinates | Convert selection to page-space rectangles | MVP |
| Rect → text extraction | Given rectangle, recover text quote | MVP |
| Text search | Search within current PDF | Serious release |
| Page navigation | Jump to page, page thumbnails optional | MVP / serious |
| Coordinate conversion | Screen ↔ page ↔ PDF user coordinates | MVP |
| Offline packaging | Bundle WASM/assets inside extension, no CDN | MVP |

## B. Source-anchor features

| Need | Description | Required phase |
|---|---|---|
| Create `pdf_rect` anchor | Store `page`, `rects`, `text_quote`, `text_hash`, `source_hash` | MVP |
| Insert markdown source link | Insert `[label](hl://pdf/...)` into active note | MVP |
| Note → PDF jump | Click link, open PDF at page/rect | MVP |
| PDF → note jump | Click referenced region, show notes that cite it | Serious release |
| Reference highlights | Auto-highlight PDF regions cited by markdown notes | Serious release |
| Reference sidecar | Generate `.hl/references/pdf/foo.references.json` | Serious release |
| Overlap hit-testing | Click/selection near a rect resolves matching anchor | Serious release |
| Stale-anchor repair | Repair by `text_quote` / `text_hash` if rect changes | Advanced |
| Multi-engine anchor model | Same anchor schema across EmbedPDF/PDF.js/MuPDF | MVP |

## C. Annotation features

| Need | Description | Required phase |
|---|---|---|
| User highlights | Human-created highlights, separate from reference highlights | Serious release |
| Comments/margin notes | Attach comment to page/rect anchor | Serious release |
| Ink/freehand | Pen annotations, iPad-compatible later | Advanced |
| Annotation sidecar | Store annotations outside raw PDF | Serious release |
| Import/export annotations | Import/export sidecar, maybe PDF copy later | Advanced |
| Burn/export annotated PDF | Optional annotated PDF copy, not raw mutation | Advanced |

The existing plan already states that **user annotations** and **reference highlights** must be separate layers: user highlights mean “I highlighted this,” while reference highlights mean “this region is cited by the wiki.”  [oai_citation:2‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

## D. Agent / graph features

| Need | Description | Required phase |
|---|---|---|
| Selection export | Export selected PDF fragment to `.hl/agent/selection.md/json` | MVP |
| Backlink graph query | `PDF anchor -> links.to_uri -> referencing notes` | MVP / serious |
| Context bundle | Selected text + source metadata + backlinks + related chunks | MVP |
| Activity tracking | Viewed page, selected region, exported context | Serious release |
| MCP resource | Expose `hl://anchor/{id}` or `hl.get_anchor` | Advanced |

The implementation plan already defines the PDF webview responsibility as rendering pages, displaying text layer, handling text/rect selection, creating PDF anchors, displaying reference highlights, user annotations, clicking reference highlight → referenced-by popup, and note → PDF jump.  [oai_citation:3‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

---

# 2. Package comparison matrix

Legend:

```text
✅ good / available
🟡 possible but needs custom work or prototype
🔴 weak / not suitable
⚠️ risk
```

## High-level fit

| Capability | EmbedPDF / PDFium | Raw PDFium | MuPDF WebViewer | PDF.js |
|---|---:|---:|---:|---:|
| VS Code webview fit | ✅ | 🟡 | ✅ | ✅ |
| Browser/WASM rendering | ✅ | 🟡 | ✅ | ✅ |
| Drop-in viewer | ✅ | 🔴 | ✅ | ✅ |
| Headless/custom UI | ✅ | 🟡 | 🟡 | ✅ |
| Rendering quality | ✅ | ✅ | ✅ | 🟡/✅ |
| Text selection | ✅ | 🟡 | ✅ | ✅ |
| Text extraction | ✅ | ✅ | ✅ | ✅ |
| Word/rect coordinates | 🟡 needs prototype | ✅ low-level | ✅ likely | 🟡 doable |
| Annotation UI | ✅ | 🔴 | ✅ | 🟡/🔴 |
| Programmatic annotations | ✅ | 🟡 | ✅ | 🟡 |
| Source-anchor overlay layer | ✅ custom | ✅ custom | ✅ custom | ✅ custom |
| PDF → note popup | ✅ custom | ✅ custom | ✅ custom | ✅ custom |
| License fit for permissive OSS | ✅ likely | ✅ likely | ⚠️ AGPL/commercial / production key | ✅ |
| Maturity | 🟡 newer | ✅ engine mature, integration costly | 🟡 productized but license risk | ✅ mature |
| Best role | **Default prototype** | Engine/backend only | Optional advanced backend | Fallback baseline |

---

# 3. EmbedPDF / PDFium assessment

## What it satisfies

EmbedPDF is currently the best candidate for your default PDF viewer because it wraps **PDFium through WebAssembly** and exposes a modern viewer/plugin architecture. Its PDFium docs say the library supports high-fidelity rendering, text extraction and search, form filling/manipulation, annotation support, digital signature verification, and PDF modification/creation.  [oai_citation:4‡EmbedPDF](https://www.embedpdf.com/docs/pdfium/introduction?utm_source=chatgpt.com)

EmbedPDF also has a selection plugin. The docs say it enables normal PDF text selection, provides a `SelectionLayer`, and exposes an API to get selected content.  [oai_citation:5‡EmbedPDF](https://www.embedpdf.com/docs/react/headless/plugins/plugin-selection?utm_source=chatgpt.com) That directly maps to:

```text
select PDF text
-> get selected content
-> create hl://pdf anchor
-> export to agent context
```

The annotation plugin is also strong on paper. It supports highlight, underline, strikeout, squiggly, ink, ink highlighter, shapes, free text, and image stamps.  [oai_citation:6‡EmbedPDF](https://www.embedpdf.com/docs/react/headless/plugins/plugin-annotation?utm_source=chatgpt.com) That is already more aligned with Human Learning than raw PDF.js annotation work.

## Main risk

The critical risk is whether EmbedPDF exposes enough stable geometry for Human Learning anchors:

```text
selection -> page index
selection -> one or more rects
rect -> text quote
text item -> bounding boxes
screen coordinate -> page coordinate
page coordinate -> stable serialized coordinate
```

The docs establish selection and text extraction support, but the exact quality of rectangle-level anchor extraction must be prototyped. The engine docs also warn that direct engine operations are stateless and should mostly be used for read-only operations like metadata/text extraction; UI-visible operations should go through plugins.  [oai_citation:7‡EmbedPDF](https://www.embedpdf.com/docs/vue/viewer/engine?utm_source=chatgpt.com) That means Human Learning should integrate with EmbedPDF’s plugin model, not bypass it for interactive state.

## EmbedPDF scorecard

| Need | Fit | Notes |
|---|---:|---|
| Local PDF render | ✅ | PDFium/WASM viewer architecture |
| VS Code webview | 🟡/✅ | Should work, must test WASM bundling and local URI loading |
| Text selection | ✅ | Selection plugin exists |
| Selected content API | ✅ | Docs mention rich API for selected content |
| Rects for selection | 🟡 | Must verify exact API shape |
| Rect → text | 🟡 | Could use selection API or engine text extraction |
| Reference overlays | ✅ custom | Draw own overlay layer on page |
| Annotation UI | ✅ | Annotation plugin supports many tools |
| Ink/highlight | ✅ | Built-in tools include highlight and ink |
| Export/import annotations | 🟡 | Docs mention programmatic control; exact persistence model needs prototype |
| License | ✅ likely | Viewer reported MIT, PDFium permissive; verify package-level licenses before release |
| Maturity | 🟡 | Newer than PDF.js; prototype with real PDFs |

## Recommendation

Use EmbedPDF as:

```text
packages/pdf-engine-embedpdf/
  render
  selection
  text extraction
  coordinate conversion
  optional annotation plugin integration
```

Do **not** let it own:

```text
anchors
references
backlinks
agent context
annotation sidecar schema
```

---

# 4. Raw PDFium assessment

## What it satisfies

Raw PDFium is the underlying engine. It is powerful and mature, but using it directly means you must build far more:

```text
WASM packaging
viewer UI
page virtualization
text layer
selection layer
annotation layer
coordinate transforms
plugin/event model
React/Vue integration
```

PDFium is attractive because it is the engine behind Chrome and has comprehensive PDF capabilities according to the EmbedPDF docs.  [oai_citation:8‡EmbedPDF](https://www.embedpdf.com/docs/pdfium/introduction?utm_source=chatgpt.com) But raw PDFium is not a product-level viewer.

## Raw PDFium scorecard

| Need | Fit | Notes |
|---|---:|---|
| Rendering | ✅ | Strong engine capability |
| Text extraction | ✅ | Engine-level support |
| Search | ✅ | Engine-level support |
| Word/char boxes | ✅/🟡 | Likely available through C APIs; JS/WASM wrapper matters |
| Selection UI | 🔴 | You build it |
| Annotation UI | 🔴 | You build it |
| VS Code webview packaging | 🟡 | You own the WASM integration |
| Fast implementation | 🔴 | Too much work |
| License | ✅ likely | Need exact PDFium/build-wrapper license validation |
| Long-term control | ✅ | Maximum control |

## Recommendation

Do **not** start with raw PDFium. Use EmbedPDF first. Drop to raw PDFium only if:

```text
EmbedPDF blocks a core feature
EmbedPDF API is unstable
EmbedPDF licensing changes
EmbedPDF plugin model prevents custom source-anchor overlays
```

---

# 5. MuPDF WebViewer assessment

## What it satisfies

MuPDF WebViewer is the strongest **feature-fit** product. Its product page explicitly advertises text extraction that preserves structure, formatting, metadata, plus annotation/highlight/markup support.  [oai_citation:9‡MuPDF WebViewer](https://webviewer.mupdf.com/?utm_source=chatgpt.com) Its docs say it is built for AI, supports viewing annotations/markups, advanced search, responsive design, and high performance.  [oai_citation:10‡MuPDF WebViewer](https://webviewer-docs.mupdf.com/?utm_source=chatgpt.com)

The document API includes `getText`, `getPages`, `getPageCount`, rotation, export, and page/bounding-box types.  [oai_citation:11‡MuPDF WebViewer](https://webviewer-docs.mupdf.com/api-reference/document?utm_source=chatgpt.com) That maps very directly to Human Learning’s PDF anchor and text extraction requirements.

## Main risk

The risk is licensing and production deployment. The getting-started docs say local development does not require a license key, but production deployment does require a license key registered to a domain.  [oai_citation:12‡MuPDF WebViewer](https://webviewer-docs.mupdf.com/getting-started?utm_source=chatgpt.com) Separately, MuPDF-family licensing is generally AGPL/commercial, which is not ideal for a permissive open-source VS Code extension.

## MuPDF scorecard

| Need | Fit | Notes |
|---|---:|---|
| Rendering | ✅ | Strong |
| Text extraction | ✅ | Strong AI-oriented positioning |
| Structured extraction | ✅/🟡 | Marketed strongly, still validate |
| Page/rect anchors | ✅ | BBox/page APIs appear aligned |
| Annotations/highlights | ✅ | Built-in support |
| Full browser viewer | ✅ | Drop-in web component |
| VS Code webview | 🟡/✅ | Likely technically possible |
| Production OSS distribution | ⚠️ | Production key / AGPL-commercial issue |
| Permissive-core compatibility | 🔴/⚠️ | Do not make core dependency |
| Best role | Optional advanced plugin | Especially if user accepts license |

## Recommendation

Do not use MuPDF as default. Use it only as:

```text
packages/pdf-engine-mupdf/
  optional AGPL/commercial backend
  not installed by default
  clearly isolated from MIT/Apache core
```

---

# 6. PDF.js assessment

## What it satisfies

PDF.js is the mature, safe fallback. The official API exposes `getDocument(src)` as the main loading entry point and supports document loading from URL/data, worker use, WASM, range loading, fonts, and other web concerns.  [oai_citation:13‡Mozilla GitHub Pages](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html) The same API docs include annotation parameters and rendering annotation modes, indicating PDF.js can read/render annotations and forms to some extent.  [oai_citation:14‡Mozilla GitHub Pages](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)

PDF.js is a proven web viewer foundation, but you will need to implement more of the product layer yourself.

## Main risk

PDF.js is good for rendering and text extraction, but weaker for polished custom annotation workflows. The source-anchor overlay layer is fine because Human Learning owns it anyway, but user annotation editing is more work.

## PDF.js scorecard

| Need | Fit | Notes |
|---|---:|---|
| Rendering | ✅ | Mature |
| Webview fit | ✅ | Very good |
| Local/offline packaging | ✅ | Good |
| Text selection | ✅ | Viewer/text layer supports it |
| Text extraction | ✅ | `getTextContent` commonly used; API has text-content pipeline |
| Rect → text | 🟡 | Implement by intersecting text items with rect |
| Annotation rendering | 🟡 | Can read/render existing annotations |
| Annotation editing | 🔴/🟡 | More custom work |
| Reference overlays | ✅ custom | Straightforward overlay layer |
| License fit | ✅ | Best safe baseline |
| Maturity | ✅ | Best mature fallback |

## Recommendation

Keep PDF.js as:

```text
packages/pdf-engine-pdfjs/
  fallback viewer
  baseline engine
  regression comparator for EmbedPDF
```

PDF.js is also useful as a safety net: if EmbedPDF’s newer plugin model or VS Code webview packaging fails, PDF.js will still get the MVP done.

---

# 7. Detailed functionality checklist by engine

## Rendering and viewer UX

| Functionality | EmbedPDF | Raw PDFium | MuPDF WebViewer | PDF.js | Decision |
|---|---:|---:|---:|---:|---|
| Open local PDF file | ✅ | 🟡 | ✅ | ✅ | Test local VS Code URI handling |
| Render page canvas/layer | ✅ | ✅ | ✅ | ✅ | Any works |
| Zoom/pan/scroll | ✅ | 🔴 custom | ✅ | ✅ | EmbedPDF/PDF.js/MuPDF |
| Page virtualization | ✅ docs mention large-doc virtualization | 🔴 custom | 🟡 likely | 🟡 custom/viewer | Prefer EmbedPDF |
| Rotation | 🟡 | ✅ | ✅ | ✅ | Not hard |
| Thumbnails | 🟡 | 🔴 custom | 🟡 | ✅ viewer | Nice-to-have |
| Dark mode/invert | 🟡 | 🔴 custom | 🟡 | 🟡 | Later |

## Text / selection / anchors

| Functionality | EmbedPDF | Raw PDFium | MuPDF WebViewer | PDF.js | Decision |
|---|---:|---:|---:|---:|---|
| Select text visually | ✅ selection plugin | 🔴 custom | ✅ | ✅ | EmbedPDF strong |
| Get selected text | ✅ | ✅ engine, UI custom | ✅ | ✅ | All feasible |
| Get selection rects | 🟡 prototype | ✅ low-level | ✅ likely | 🟡 compute | Must prototype |
| Rect → text quote | 🟡 | ✅ low-level | ✅ | 🟡 compute | Must prototype |
| Word/char boxes | 🟡 | ✅ | ✅ likely | 🟡 | Must prototype |
| Multi-rect selection | 🟡 | ✅ custom | ✅ | ✅/🟡 | Needed for line wraps |
| Search text | ✅ | ✅ | ✅ | ✅ | All ok |
| Structured paragraphs | 🟡 | 🟡 | ✅ likely | 🟡 | MuPDF may win |
| Equation/table extraction | 🔴/🟡 | 🔴/🟡 | 🟡 | 🔴/🟡 | Use specialized extraction later |

Academic PDF extraction remains inherently hard: a benchmark of PDF information extraction tools found that all tools struggle with lists, footers, and equations, and table extraction quality remains much lower than other elements.  [oai_citation:15‡arXiv](https://arxiv.org/abs/2303.09957?utm_source=chatgpt.com) So do not overfit the MVP around perfect structure extraction.

## Highlights, annotations, and sidecars

| Functionality | EmbedPDF | Raw PDFium | MuPDF WebViewer | PDF.js | Decision |
|---|---:|---:|---:|---:|---|
| Reference highlights | ✅ custom overlay | ✅ custom | ✅ custom | ✅ custom | Engine-independent |
| User text highlights | ✅ annotation plugin | 🔴 custom | ✅ | 🟡 custom |
| Ink annotations | ✅ plugin | 🔴 custom | ✅ | 🔴/🟡 custom |
| Shapes/free text | ✅ plugin | 🔴 custom | ✅ | 🔴/🟡 custom |
| Annotation import/export | 🟡 prototype | 🟡 custom | ✅ likely | 🟡 custom |
| Burn into PDF copy | 🟡 | 🟡 | ✅ | 🟡 | Later |
| Keep raw PDF immutable | ✅ | ✅ | ✅ | ✅ | Product rule |

## Human Learning graph features

These are **not engine features**. All four engines can support them if they provide page/rect coordinates.

| Functionality | EmbedPDF | Raw PDFium | MuPDF | PDF.js | Owner |
|---|---:|---:|---:|---:|---|
| `hl://pdf` URI | ✅ | ✅ | ✅ | ✅ | Human Learning |
| Anchor table | ✅ | ✅ | ✅ | ✅ | Human Learning core |
| Links table | ✅ | ✅ | ✅ | ✅ | Human Learning core |
| Reference sidecar | ✅ | ✅ | ✅ | ✅ | Human Learning core |
| PDF → notes popup | ✅ | ✅ | ✅ | ✅ | Human Learning extension |
| Note → PDF jump | ✅ | ✅ | ✅ | ✅ | Human Learning extension |
| Agent context export | ✅ | ✅ | ✅ | ✅ | Human Learning core |
| Anchor repair | ✅ | ✅ | ✅ | ✅ | Human Learning core |

---

# 8. Recommended package architecture

Use an interface boundary:

```ts
export interface PdfEngine {
  open(input: PdfOpenInput): Promise<PdfDocumentHandle>;
  renderPage(pageIndex: number, viewport: PdfViewport): Promise<RenderedPage>;
  getPageText(pageIndex: number): Promise<PdfTextItem[]>;
  getTextInRects(pageIndex: number, rects: PdfRect[]): Promise<string>;
  search(query: string): Promise<PdfSearchHit[]>;
  screenToPage(point: ScreenPoint): PdfPoint;
  pageToScreen(point: PdfPoint): ScreenPoint;
}

export interface PdfViewerAdapter {
  mount(el: HTMLElement, input: PdfOpenInput): Promise<void>;
  jumpToAnchor(anchor: PdfAnchor): Promise<void>;
  getCurrentSelection(): Promise<PdfSelection | null>;
  setReferenceOverlays(overlays: PdfReferenceOverlay[]): void;
  onSelectionChanged(cb: (selection: PdfSelection) => void): void;
  onReferenceClicked(cb: (anchorUri: string) => void): void;
}
```

Then packages:

```text
packages/
  core/
    anchors/
    links/
    references/
    context/

  pdf/
    schema.ts
    engine-interface.ts
    reference-overlay.ts
    coordinate-utils.ts
    selection-to-anchor.ts

  pdf-engine-embedpdf/
    EmbedPDF adapter

  pdf-engine-pdfjs/
    PDF.js fallback adapter

  pdf-engine-mupdf/
    optional MuPDF adapter, not core

  vscode-extension/
    PDF custom editor webview host
```

Important: the persisted anchor must be engine-neutral:

```json
{
  "kind": "pdf_rect",
  "source": "raw/pdf/flash-attention.pdf",
  "page": 3,
  "rects": [[120, 240, 530, 310]],
  "text_quote": "FlashAttention uses tiling...",
  "text_hash": "sha256:...",
  "source_hash": "sha256:...",
  "engine_created_by": "embedpdf"
}
```

`engine_created_by` can be diagnostic metadata, but resolving the anchor must not require the same engine.

---

# 9. Implementation to-dos

## Phase 0 — decision spike

Build one small PDF adapter playground in the VS Code webview.

### To-do

```text
[ ] Create packages/pdf with engine interfaces
[ ] Create packages/pdf-engine-embedpdf
[ ] Create packages/pdf-engine-pdfjs
[ ] Build VS Code webview that opens one local PDF
[ ] Test WASM asset bundling for EmbedPDF
[ ] Test PDF.js fallback loading from local extension/webview URI
[ ] Prepare 20-PDF test corpus:
    - arXiv ML papers
    - two-column papers
    - long textbook
    - equations-heavy paper
    - table-heavy paper
    - scanned PDF
    - PDF with existing annotations
```

### Pass/fail criteria

```text
[ ] Opens local PDF offline
[ ] Renders correctly
[ ] Selects paragraph text
[ ] Returns selected text
[ ] Returns page + rects
[ ] Draws overlay exactly on selected rect
[ ] Reopens PDF and redraws overlay
[ ] Runs inside VS Code extension host/webview without CDN
```

## Phase 1 — EmbedPDF adapter

### To-do

```text
[ ] Integrate EmbedPDF headless viewer, not only drop-in viewer
[ ] Register selection plugin
[ ] Register interaction-manager plugin
[ ] Register annotation plugin only after selection works
[ ] Implement getCurrentSelection()
[ ] Map EmbedPDF selection result -> PdfSelection
[ ] Implement page-space coordinate serialization
[ ] Implement selected text normalization:
    - whitespace collapse
    - line-break repair
    - hyphenation repair
[ ] Implement jumpToAnchor()
[ ] Implement overlay layer for HL reference highlights
[ ] Implement hit-testing for reference overlays
[ ] Implement onReferenceClicked(anchorUri)
```

### Prototype questions

```text
[ ] Does selection API expose rects?
[ ] Are rects in stable PDF/page coordinates or viewport coordinates?
[ ] Can we access word/line boxes for rect->text extraction?
[ ] Can annotation plugin export data without mutating raw PDF?
[ ] Can we disable built-in annotation storage and use sidecars?
[ ] Does the viewer work under VS Code webview CSP?
```

## Phase 2 — PDF.js fallback adapter

### To-do

```text
[ ] Load PDF.js worker correctly in VS Code webview
[ ] Render page canvas
[ ] Render text layer or use viewer text layer
[ ] Implement text selection
[ ] Use page.getTextContent() to build text item boxes
[ ] Implement rect -> text by intersecting text boxes
[ ] Implement jumpToAnchor()
[ ] Implement same HL overlay layer
[ ] Make PDF.js pass same adapter tests as EmbedPDF
```

PDF.js’s official API exposes `getDocument(src)` for loading and interacting with a PDF, including `data`/`url`, worker, WASM, range loading, and rendering options.  [oai_citation:16‡Mozilla GitHub Pages](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html) This makes it a safe fallback for local/offline webview usage.

## Phase 3 — core anchor/link implementation

### To-do

```text
[ ] Define PdfAnchor schema
[ ] Define PdfSelection schema
[ ] Define PdfReferenceSidecar schema
[ ] Add anchors table rows for PDF rects
[ ] Add links table rows from markdown hl:// links
[ ] Parse markdown links that target hl://pdf
[ ] Generate .hl/references/pdf/<source-id>.json
[ ] Implement getReferencesForPdf(sourcePath)
[ ] Implement getBacklinks(anchorUri)
[ ] Implement overlap matching:
    - exact anchor URI
    - same page + IoU threshold
    - same text_hash fallback
[ ] Implement stale anchor diagnostic
```

The current plan already defines the desired reference sidecar structure and acceptance test: select text in PDF, insert source reference, markdown receives `[label](hl://pdf/...)`, click the link, PDF opens at page/rect, click highlighted region, popover shows referencing note.  [oai_citation:17‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

## Phase 4 — VS Code integration

### To-do

```text
[ ] Register PDF custom editor / readonly editor
[ ] Register hl:// URI dispatcher
[ ] Register DocumentLinkProvider for hl://pdf links
[ ] Add command: Human Learning: Insert PDF Source Reference
[ ] Add command: Human Learning: Add PDF Selection to Agent Context
[ ] Add command: Human Learning: Open Anchor
[ ] Implement webview postMessage protocol:
    - selectionChanged
    - anchorCreated
    - referenceClicked
    - openLink
    - addSelectionToContext
[ ] Implement open note at path + line
[ ] Implement open PDF at anchor
[ ] Add Backlinks / Referenced By panel
```

The plan already expects the VS Code extension to handle custom URI dispatch, custom PDF viewer, diagnostics, file watchers, activity tracking, and agent context export.  [oai_citation:18‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

## Phase 5 — user annotations

### To-do

```text
[ ] Decide whether EmbedPDF annotation plugin is used for user annotations
[ ] Store annotations in .hl/annotations/pdf/*.json
[ ] Keep generated reference highlights separate
[ ] Implement user highlight tool
[ ] Implement comment tool
[ ] Implement export/import sidecar
[ ] Add optional “export annotated PDF copy”
[ ] Do not mutate raw/pdf/*.pdf by default
```

## Phase 6 — evaluation and fallback decision

### To-do

```text
[ ] Run same 20-PDF test corpus through EmbedPDF and PDF.js
[ ] Score rendering fidelity
[ ] Score text selection correctness
[ ] Score rect alignment
[ ] Score rect -> text_quote quality
[ ] Score webview packaging friction
[ ] Score annotation API usability
[ ] Make final default-engine decision
```

---

# 10. Concrete test plan

## Test 1 — Selection to anchor

```text
Given:
  raw/pdf/fa.pdf page 3

When:
  user selects a paragraph

Expected:
  PdfSelection {
    sourcePath,
    page,
    rects,
    textQuote
  }

Then:
  anchor URI can be generated:
  hl://pdf/raw/pdf/fa.pdf?page=3&rect=...
```

## Test 2 — Anchor persistence

```text
Given:
  anchor saved to SQLite and references sidecar

When:
  PDF is reopened

Expected:
  reference overlay appears exactly over original region
```

## Test 3 — Note → PDF

```text
Given:
  notes/FlashAttention.md contains [source](hl://pdf/...)

When:
  user Cmd-clicks source link

Expected:
  PDF opens at page and pulses target rect
```

## Test 4 — PDF → Note

```text
Given:
  PDF page has reference overlay

When:
  user clicks overlay

Expected:
  popup shows all referencing notes and line numbers
```

## Test 5 — Rect → text

```text
Given:
  a saved rect from a previous selection

When:
  engine extracts text inside rect

Expected:
  extracted text matches saved text_quote within normalized similarity threshold
```

## Test 6 — Engine swap

```text
Given:
  anchor created by EmbedPDF

When:
  opened with PDF.js adapter

Expected:
  same page/rect overlay appears, even if text extraction differs
```

This test is important because it validates that **HL anchors are engine-independent**.

---

# 11. Final decision table

| Decision | Recommendation |
|---|---|
| Default prototype engine | **EmbedPDF / PDFium** |
| Fallback engine | **PDF.js** |
| Avoid as default | **MuPDF WebViewer** |
| Optional advanced backend | MuPDF, only isolated because of license/production constraints |
| Avoid for now | Raw PDFium directly |
| Annotation storage | Human Learning sidecars, not raw PDF mutation |
| Reference highlights | Human Learning generated overlays |
| Source-anchor schema | Engine-independent `page + rects + text_quote + source_hash` |
| Must prototype first | Selection rects, rect→text, VS Code webview WASM packaging |

## Final answer

Yes, use **EmbedPDF**, but only behind an internal `PdfEngine` / `PdfViewerAdapter` interface.

The implementation plan should be:

```text
1. Build Human Learning PDF abstraction first.
2. Implement EmbedPDF adapter.
3. Implement PDF.js fallback adapter.
4. Store all anchors and references in Human Learning core.
5. Keep MuPDF optional.
6. Never let the PDF engine own the source graph.
```

The core principle is:

```text
PDF engine is replaceable.
Source anchors are permanent.
```