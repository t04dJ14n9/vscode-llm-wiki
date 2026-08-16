# Inferred PDF Outline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a conservative, nested, locally inferred PDF outline only when the document has no usable embedded bookmarks.

**Architecture:** Add a pure inference module that consumes normalized page text runs and returns bounded `PdfOutlineEntry` values. The PDF viewer remains responsible for background page extraction, cancellation, rendering, and posting the final snapshot; the extension host continues to own the Explorer outline tree and receives an explicit inferred/authored flag.

**Tech Stack:** TypeScript, EmbedPDF/PDFium text extraction, VS Code custom editors and tree views, Node test runner, Playwright.

## Global Constraints

- Embedded PDF bookmarks always win; inference does not run for a non-empty valid bookmark tree.
- Inference is deterministic, local, network-free, and does not modify PDF bytes or vault files.
- Only high-confidence headings are emitted; weak documents retain `(no PDF outline)`.
- Numbering determines nesting before recurring typography tiers.
- Image-only PDFs remain unsupported; OCR is out of scope.
- Existing outline depth, title-length, destination, and entry-count bounds remain enforced.
- Text extraction uses bounded concurrency and is cancelled when the loaded document changes.
- Inference must not change selectable-text, search, or graph-reading order.

---

### Task 1: Pure conservative heading detector

**Files:**
- Create: `packages/pdf-editor/src/webview/domain/pdfInferredOutline.ts`
- Create: `packages/vscode-extension/test/pdfInferredOutline.test.mjs`
- Modify: `packages/pdf-editor/src/webview/domain/pdfOutline.ts`

**Interfaces:**
- Consumes: `PdfTextLayerItem` from `packages/pdf-editor/src/webview/pdfTextLayer.ts` and `PdfOutlineEntry` from `packages/pdf-editor/src/webview/domain/pdfOutline.ts`.
- Produces:

```ts
export interface PdfOutlineTextPage {
  pageIndex: number;
  width: number;
  height: number;
  items: readonly PdfTextLayerItem[];
}

export interface PdfInferredOutlineResult {
  entries: PdfOutlineEntry[];
  candidateCount: number;
}

export function inferPdfOutline(
  pages: readonly PdfOutlineTextPage[],
): PdfInferredOutlineResult;
```

- Adds the shared destination helper:

```ts
export function pdfOutlineXyzDestination(
  pageIndex: number,
  x: number,
  y: number,
): PdfOutlineDestination | undefined;
```

- [ ] **Step 1: Write failing line-reconstruction and numbered-nesting tests**

Create fixtures whose text is split across runs and columns:

```js
const pages = [{
  pageIndex: 0,
  width: 612,
  height: 792,
  items: [
    item('1', 72, 120, 8, 14, { size: 14, weight: 700 }),
    item('Introduction', 86, 120, 90, 14, { size: 14, weight: 700 }),
    item('Body text repeated enough to establish the body style.', 72, 150, 320, 10),
    item('1.1', 72, 220, 18, 12, { size: 12, weight: 700 }),
    item('Motivation', 96, 220, 70, 12, { size: 12, weight: 700 }),
  ],
}];

assert.deepEqual(inferPdfOutline(pages).entries, [{
  title: '1 Introduction',
  destination: xyz(0, 72, 672),
  children: [{
    title: '1.1 Motivation',
    destination: xyz(0, 72, 572),
    children: [],
  }],
}]);
```

Also assert `2.1.1` attaches to the nearest visible compatible ancestor and malformed hierarchy never creates an invisible node.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test packages/vscode-extension/test/pdfInferredOutline.test.mjs
```

Expected: FAIL because `pdfInferredOutline.ts` and `inferPdfOutline` do not exist.

- [ ] **Step 3: Implement normalized visual lines and numbered hierarchy**

Implement focused internal types:

```ts
interface PdfOutlineLine {
  pageIndex: number;
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
}

interface PdfHeadingCandidate extends PdfOutlineLine {
  numbering?: number[];
  score: number;
  styleKey: string;
}
```

Group runs only when their vertical overlap/baseline, horizontal gap, and typography are compatible. Normalize whitespace and cap candidate text before classification. Parse decimal section prefixes with:

```ts
/^(\d+(?:\.\d+){0,4})[.)]?\s+(\S.*)$/u
```

Build the tree with a stack of visible numbered ancestors. Use `pdfOutlineXyzDestination` and pass the result through `normalizePdfOutlineEntries` before returning it.
Convert the text layer's top-origin coordinate to the PDF destination's
bottom-origin coordinate with `page.height - line.top`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --test packages/vscode-extension/test/pdfInferredOutline.test.mjs
```

Expected: PASS for fragmented lines and numbered nesting.

- [ ] **Step 5: Add failing document-profile and false-positive tests**

Add fixtures that establish a 10-point body style and assert:

- recurring 14-point bold unnumbered headings pass;
- a one-off 18-point author/title line fails;
- repeated top/bottom headers, page numbers, `Figure 1:`, `Table 2`, `Algorithm 1`, bullets, equations, email addresses, and bibliography entries fail;
- long sentence-like lines fail;
- `Abstract`, `Introduction`, `Conclusion`, and `References` boost but do not independently force acceptance;
- low-confidence and image-only pages return no entries.

Use explicit assertions such as:

```js
assert.deepEqual(
  flattenTitles(inferPdfOutline(falsePositivePages).entries),
  ['1 Introduction', '2 Method', '3 Results'],
);
```

- [ ] **Step 6: Run the expanded test and verify RED**

Run the same Node command.

Expected: at least one false positive is present or one recurring unnumbered heading is absent.

- [ ] **Step 7: Implement conservative profiling, scoring, and rejection**

Compute a character-weighted body-size median from prose-like lines. Detect repeated header/footer strings by normalized text and page-relative vertical bands. Score candidates with deterministic weights:

```ts
const HEADING_ACCEPT_SCORE = 7;
const NUMBERED_SCORE = 5;
const LARGER_FONT_SCORE = 2;
const BOLD_SCORE = 2;
const WHITESPACE_SCORE = 1;
const RECURRING_STYLE_SCORE = 2;
const CONVENTIONAL_LABEL_SCORE = 1;
```

Reject a candidate before scoring when it matches the explicit false-positive categories. Require unnumbered headings to have a recurring style plus at least one independent size, weight, or spacing signal.

- [ ] **Step 8: Verify detector GREEN and existing text-order tests GREEN**

Run:

```bash
node --test packages/vscode-extension/test/pdfInferredOutline.test.mjs
node --test packages/vscode-extension/test/pdfTextExtraction.test.mjs packages/vscode-extension/test/pdfSelectionDomain.test.mjs
```

Expected: all tests pass and text ordering remains unchanged.

- [ ] **Step 9: Commit the pure detector**

```bash
git add packages/pdf-editor/src/webview/domain/pdfInferredOutline.ts \
  packages/pdf-editor/src/webview/domain/pdfOutline.ts \
  packages/vscode-extension/test/pdfInferredOutline.test.mjs
git commit -m "feat(pdf): infer conservative document outlines"
```

---

### Task 2: Background viewer inference and labelled outline surfaces

**Files:**
- Modify: `packages/pdf-editor/src/webview/pdf-viewer.ts`
- Modify: `packages/vscode-extension/src/pdfEditorProvider.ts`
- Modify: `packages/vscode-extension/src/markdownSymbols.ts`
- Modify: `packages/vscode-extension/test/pdfSelectionContext.test.mjs`
- Modify: `packages/vscode-extension/test/markdownSymbols.test.mjs`
- Modify: `packages/vscode-extension/test/e2e/pdf-viewer.spec.ts`

**Interfaces:**
- Consumes: `inferPdfOutline(pages)` from Task 1.
- Produces webview message:

```ts
{
  type: 'pdfOutline';
  items: PdfOutlineEntry[];
  inferred: boolean;
  loading: boolean;
}
```

- Adds provider query:

```ts
isPdfOutlineInferred(uri: vscode.Uri): boolean;
```

- [ ] **Step 1: Write failing embedded-precedence and inferred-label tests**

In the host test, send both authored and inferred outline messages and assert normalization stores the `inferred` flag only when the payload contains valid entries.

In the tree test, make `isPdfOutlineInferred()` return `true` and assert a non-clickable `Inferred outline` status item precedes the actual root entries.

In Playwright, use a no-bookmarks fixture and assert the PDF sidebar first shows `Preparing inferred outline…`, then `Inferred outline`, while the authored-outline fixture never shows that label.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test packages/vscode-extension/test/pdfSelectionContext.test.mjs \
  packages/vscode-extension/test/markdownSymbols.test.mjs
pnpm exec playwright test --config playwright.config.ts \
  packages/vscode-extension/test/e2e/pdf-viewer.spec.ts \
  --grep "inferred outline|embedded outline"
```

Expected: FAIL because the viewer and host do not expose inferred/loading state.

- [ ] **Step 3: Refactor outline loading into authored-first orchestration**

In `PdfViewer`, add:

```ts
private pdfOutlineInferred = false;
private pdfOutlineInferenceRunId = 0;

private async loadEmbeddedPdfOutline(): Promise<boolean>;
private async loadInferredPdfOutline(runId: number): Promise<void>;
private postPdfOutline(loading = false): void;
```

Change `loadPdf()` to:

```ts
const hasEmbeddedOutline = await this.loadEmbeddedPdfOutline();
await this.layoutPages();
if (!hasEmbeddedOutline) {
  const runId = ++this.pdfOutlineInferenceRunId;
  this.postPdfOutline(true);
  void this.loadInferredPdfOutline(runId);
}
```

Extract page text with a fixed concurrency of four using the existing
`loadTextRects(state)` promises. Before publishing, verify the run ID still
matches and `pdfDoc` is unchanged. Do not render page canvases merely to infer
the outline.

- [ ] **Step 4: Render inferred/loading labels without changing entry behavior**

Add a `.pdf-outline-kind` status element in `renderPdfOutline()`:

- `Preparing inferred outline…` while loading;
- `Inferred outline` before inferred entries;
- no label for embedded entries;
- `No document outline` after a completed empty result.

Post the same state to the host. Store `outlineInferred` in `ActivePdfWebview`,
fire the existing outline event, and let the Explorer provider prepend a
non-collapsible informational `TreeItem('Inferred outline')`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the commands from Step 2.

Expected: all focused host, tree, and browser tests pass.

- [ ] **Step 6: Add cancellation and failure-closed regressions**

Add tests that:

- replace the loaded document while page extraction is pending and assert the stale result is never posted;
- reject one page extraction and assert the viewer posts a completed empty outline instead of an error page;
- provide no text and assert no inferred entries;
- verify exact inferred destination page and `y` are passed to existing navigation.

- [ ] **Step 7: Run affected PDF suites**

Run:

```bash
node --test packages/vscode-extension/test/pdfOutline.test.mjs \
  packages/vscode-extension/test/pdfInferredOutline.test.mjs \
  packages/vscode-extension/test/pdfSelectionContext.test.mjs \
  packages/vscode-extension/test/markdownSymbols.test.mjs
pnpm exec playwright test --config playwright.config.ts \
  packages/vscode-extension/test/e2e/pdf-viewer.spec.ts \
  packages/vscode-extension/test/e2e/pdf-navigation-preview.spec.ts
```

Expected: all tests pass.

- [ ] **Step 8: Commit viewer integration**

```bash
git add packages/pdf-editor/src/webview/pdf-viewer.ts \
  packages/vscode-extension/src/pdfEditorProvider.ts \
  packages/vscode-extension/src/markdownSymbols.ts \
  packages/vscode-extension/test/pdfSelectionContext.test.mjs \
  packages/vscode-extension/test/markdownSymbols.test.mjs \
  packages/vscode-extension/test/e2e/pdf-viewer.spec.ts
git commit -m "feat(pdf): show inferred outlines when bookmarks are absent"
```

---

### Task 3: Real-document acceptance and final outline verification

**Files:**
- Modify: `packages/vscode-extension/test/e2e/pdf-manual-smoke.spec.ts`
- Create: `.superpowers/sdd/2026-08-16-inferred-pdf-outline/task-report.md`

**Interfaces:**
- Consumes: completed viewer inference and the real no-bookmarks PDF selected by the user.
- Produces: repeatable acceptance evidence for headings, nesting, destinations, and false-positive exclusions.

- [ ] **Step 1: Add a real PDF smoke test guarded by an environment path**

Use `LLM_WIKI_PDF_SMOKE_PATH` and assert the Sennrich paper produces high-confidence entries including `2 Neural Machine Translation` and `4 Evaluation`. Assert no title, author, `Algorithm 1`, or `Figure 1` entry appears.

- [ ] **Step 2: Run the real PDF test**

```bash
LLM_WIKI_PDF_SMOKE_PATH=/Users/t04dj14n9/Code/human-learning/demo-vault/raw/assets/neural-machine-translation-of-rare-words-with-subword-units.pdf \
  pnpm exec playwright test --config playwright.config.ts \
  packages/vscode-extension/test/e2e/pdf-manual-smoke.spec.ts \
  --grep "inferred outline"
```

Expected: PASS, with a nested, conservative outline and clickable destinations.

- [ ] **Step 3: Run static and full extension gates**

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 4: Record evidence and commit**

Write exact RED/GREEN commands, counts, real-PDF entries, exclusions, and any
environment warnings to the task report, then commit:

```bash
git add packages/vscode-extension/test/e2e/pdf-manual-smoke.spec.ts \
  .superpowers/sdd/2026-08-16-inferred-pdf-outline/task-report.md
git commit -m "test(pdf): verify inferred outlines on real papers"
```
