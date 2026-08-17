# Cross-Page PDF Area Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one PDF area marquee cross page boundaries and let `Shift`-drag add disjoint page regions while preserving portable screenshot-free agent handoff.

**Architecture:** Move marquee/page intersection and rectangle merging into pure functions in `pdfAreaSelection.ts`. The viewer stores container-space drag endpoints, renders temporary intersections per page, commits an ordered multi-page area selection, and serializes it through the existing `pages[]` payload. Host validation is relaxed only for well-formed ordered multi-page area payloads.

**Tech Stack:** TypeScript, DOM Pointer Events, PDFium webview rendering, Node test runner, Playwright, VS Code/Cursor extension host, Computer Use via `node_repl` and `@oai/sky`.

## Global Constraints

- Keep automatic text-versus-area intent; `Alt` forces area at pointer-down.
- A normal area drag replaces the existing selection; `Shift`-drag adds to an existing area selection.
- Emit ordered portable `page` plus `viewrect` links and one PDF SHA-256; never create or attach screenshots.
- Preserve text selection, zoom/rerender restoration, Cursor/VS Code action differences, and the vault PDF skill interface.
- Use Computer Use only after automated verification to validate the real Cursor Extension Development Host.

---

### Task 1: Pure Multi-Page Marquee Geometry

**Files:**
- Modify: `packages/pdf-editor/src/webview/pdfAreaSelection.ts`
- Modify: `packages/vscode-extension/test/pdfSelectionDomain.test.mjs`

**Interfaces:**
- Produces: `pdfAreaPageIntersections(marquee, pages): PdfAreaPageIntersection[]`
- Produces: `mergePdfAreaPageSelections(existing, added): PdfAreaPageSelection[]`
- Consumes later: container-space CSS rectangles and page wrapper bounds.

- [ ] **Step 1: Write failing geometry tests**

Add direct tests for the exported pure helpers:

```js
assert.deepEqual(pdfAreaSelection.pdfAreaPageIntersections(
  { left: 40, top: 80, right: 240, bottom: 760 },
  [
    { page: 1, left: 20, top: 20, right: 620, bottom: 400 },
    { page: 2, left: 20, top: 420, right: 620, bottom: 800 },
  ],
), [
  { page: 1, rect: [20, 60, 220, 380] },
  { page: 2, rect: [20, 0, 220, 340] },
]);

assert.deepEqual(pdfAreaSelection.mergePdfAreaPageSelections(
  [{ page: 2, rects: [[10, 10, 40, 40]] }],
  [
    { page: 1, rects: [[5, 5, 20, 20]] },
    { page: 2, rects: [[35, 35, 60, 60]] },
  ],
), [
  { page: 1, rects: [[5, 5, 20, 20]] },
  { page: 2, rects: [[10, 10, 60, 60]] },
]);
```

Also cover reverse drags via a normalized marquee, page gaps, horizontal page layouts, no intersection, and non-touching rectangles on the same page.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --test-name-pattern='area page intersections|merge area page selections' packages/vscode-extension/test/pdfSelectionDomain.test.mjs
```

Expected: FAIL because `pdfAreaPageIntersections` and `mergePdfAreaPageSelections` are undefined.

- [ ] **Step 3: Implement minimal pure geometry**

Add these exported types and functions:

```ts
export interface PdfAreaCssRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PdfAreaPageBounds extends PdfAreaCssRect {
  page: number;
}

export interface PdfAreaPageSelection {
  page: number;
  rects: PdfRect[];
}

export function pdfAreaPageIntersections(
  marquee: PdfAreaCssRect,
  pages: readonly PdfAreaPageBounds[],
): Array<{ page: number; rect: PdfRect }>;

export function mergePdfAreaPageSelections(
  existing: readonly PdfAreaPageSelection[],
  added: readonly PdfAreaPageSelection[],
): PdfAreaPageSelection[];
```

Intersections return page-local CSS coordinates, sorted by page. Merge rectangles that overlap or touch on both axes; preserve disjoint rectangles and sort them by top then left.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit geometry**

```bash
git add packages/pdf-editor/src/webview/pdfAreaSelection.ts packages/vscode-extension/test/pdfSelectionDomain.test.mjs
git commit -m "feat(pdf): compute cross-page area intersections"
```

---

### Task 2: Multi-Page Area Payload Validation and Formatting

**Files:**
- Modify: `packages/vscode-extension/src/agentClipboard.ts`
- Modify: `packages/vscode-extension/test/agentClipboard.test.mjs`

**Interfaces:**
- Consumes: `PdfAgentClipboardSelection` with `kind: "area"`, ordered `pages[]`, and consistent `startPage`/`endPage`.
- Produces: stable normalized selection keys and ordered `Sources:` Markdown links for multi-page areas.

- [ ] **Step 1: Write failing payload tests**

Add a context test whose area selection spans pages 2 and 3:

```js
const context = createPdfAgentClipboardContext({
  selectionKey: 'multi-area',
  relativePath: 'raw/paper.pdf',
  sourceSha256: 'a'.repeat(64),
  selection: {
    kind: 'area',
    startPage: 2,
    endPage: 3,
    pages: [
      { page: 2, rects: [[90, 700, 522, 792]] },
      { page: 3, rects: [[90, 0, 522, 120]] },
    ],
  },
});
assert.match(context.plainText, /^Sources:\n/);
assert.match(context.plainText, /page=2&viewrect=/);
assert.match(context.plainText, /page=3&viewrect=/);
```

Add rejection assertions for duplicate pages, missing boundary pages, inconsistent start/end values, selected text on an area payload, and invalid rectangles.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
node --test --test-name-pattern='multi-page PDF area|malformed clipboard inputs' packages/vscode-extension/test/agentClipboard.test.mjs
```

Expected: FAIL because multi-page areas are currently rejected.

- [ ] **Step 3: Relax only the one-page area restriction**

Replace the current `startPage === endPage` and `pages.length === 1` guard with only the `selectedText === undefined` requirement. Keep the shared page uniqueness, range, boundary, rectangle-count, and rectangle normalization checks.

- [ ] **Step 4: Run payload tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit payload support**

```bash
git add packages/vscode-extension/src/agentClipboard.ts packages/vscode-extension/test/agentClipboard.test.mjs
git commit -m "feat(pdf): format multi-page area selections"
```

---

### Task 3: Cross-Page Drag, Auto-Scroll, and Shift-Add Viewer State

**Files:**
- Modify: `packages/pdf-editor/src/webview/pdfAreaSelection.ts`
- Modify: `packages/pdf-editor/src/webview/pdf-viewer.ts`
- Modify: `packages/vscode-extension/test/e2e/pdf-viewer.spec.ts`
- Modify: `packages/vscode-extension/test/e2e/pdf-preview-selection.spec.ts`

**Interfaces:**
- Consumes: pure page-intersection and merge helpers from Task 1.
- Produces: `PdfAreaSelection { pages: PdfAreaPageSelection[] }`, temporary per-page overlays, multi-page `selectionChanged` payloads, and `Shift` additive behavior.

- [ ] **Step 1: Write a failing continuous cross-page browser test**

Use `fixture=two-page&host=cursor`, continuous mode, and a drag that starts near the bottom of page 1 and ends near the top of page 2. Assert:

```ts
await expect(page.locator('#page-1 .pdf-area-selection')).toBeVisible();
await expect(page.locator('#page-2 .pdf-area-selection')).toBeVisible();
expect(change.clipboardSelection).toMatchObject({
  kind: 'area',
  startPage: 1,
  endPage: 2,
});
expect(change.clipboardSelection.pages.map(entry => entry.page)).toEqual([1, 2]);
```

Assert the toolbar still contains only `Add to Chat` and `Copy for Agent`.

- [ ] **Step 2: Run the cross-page browser test and verify RED**

```bash
pnpm --filter llm-wiki-vscode build
pnpm exec playwright test --config playwright.config.ts packages/vscode-extension/test/e2e/pdf-viewer.spec.ts --grep='cross-page area marquee' --reporter=line
```

Expected: FAIL because the drag is clamped to page 1 and only one committed overlay exists.

- [ ] **Step 3: Convert drag state to container coordinates**

Update `PdfAreaDrag` to store:

```ts
interface PdfAreaDrag {
  pointerId: number;
  captureTarget: HTMLElement;
  startContainerX: number;
  startContainerY: number;
  currentContainerX: number;
  currentContainerY: number;
  clientX: number;
  clientY: number;
  additive: boolean;
  overlays: HTMLDivElement[];
}
```

Compute container coordinates as `client + container.scroll - container.getBoundingClientRect().origin`. Update per-page temporary overlays from intersections with the current page wrapper bounds. Do not clamp to the starting wrapper.

- [ ] **Step 4: Commit ordered multi-page area state**

Change committed state to `PdfAreaSelection { pages: PdfAreaPageSelection[] }`. Convert each CSS intersection to PDF coordinates using its page width/height and wrapper bounds. A replacing drag uses only new pages; an additive drag calls `mergePdfAreaPageSelections(existing.pages, added)`.

Create one clipboard selection:

```ts
{
  kind: 'area',
  startPage: pages[0].page,
  endPage: pages.at(-1).page,
  pages,
}
```

Use the first page and its rectangles for the editor anchor while retaining the complete clipboard selection for agent context.

- [ ] **Step 5: Add area auto-scroll**

Reuse `selectionAutoScrollDelta(clientX, clientY)` in a dedicated area animation frame. On every scrolled frame, recompute container coordinates from the stored client position and redraw temporary intersections. Stop the frame on pointer-up, cancel, or lost capture.

- [ ] **Step 6: Run cross-page browser test and verify GREEN**

Run the Step 2 commands. Expected: PASS.

- [ ] **Step 7: Write a failing paginated Shift-add test**

Select an area on page 1, switch to single-page paginated mode, navigate to page 2, and `Shift`-drag a second area. Assert both committed pages remain in the payload and navigating back restores the page-1 overlay.

- [ ] **Step 8: Run Shift-add test and verify RED**

```bash
pnpm exec playwright test --config playwright.config.ts packages/vscode-extension/test/e2e/pdf-viewer.spec.ts --grep='Shift-adds a paginated area' --reporter=line
```

Expected: FAIL because starting the second drag clears the first area.

- [ ] **Step 9: Implement Shift-add and rerender restoration**

Capture `event.shiftKey` at pointer-down. Skip `clearSelection()` for additive area drags, but clear any native text selection. Draw every committed rectangle for the requested page in `drawSelectionOverlay(page)`. `Escape` and explicit clear remove all pages.

- [ ] **Step 10: Run area and text-selection regression tests**

```bash
pnpm exec playwright test --config playwright.config.ts \
  packages/vscode-extension/test/e2e/pdf-preview-selection.spec.ts \
  packages/vscode-extension/test/e2e/pdf-viewer.spec.ts \
  --grep='cross-page area marquee|Shift-adds a paginated area|automatically selects a retained|Alt forces|cross a page boundary' \
  --reporter=line
```

Expected: PASS.

- [ ] **Step 11: Commit viewer behavior**

```bash
git add packages/pdf-editor/src/webview/pdfAreaSelection.ts packages/pdf-editor/src/webview/pdf-viewer.ts packages/vscode-extension/test/e2e/pdf-viewer.spec.ts packages/vscode-extension/test/e2e/pdf-preview-selection.spec.ts
git commit -m "feat(pdf): select areas across pages"
```

---

### Task 4: Full Verification and Cursor Computer-Use Acceptance

**Files:**
- Verify: all files modified in Tasks 1-3
- Modify tests only if real-host evidence exposes an untested defect.

**Interfaces:**
- Consumes: built extension and existing Cursor Extension Development Host.
- Produces: automated and real-UI evidence for continuous cross-page drag and paginated additive selection.

- [ ] **Step 1: Run full automated verification**

```bash
pnpm check
pnpm exec playwright test --config playwright.config.ts \
  packages/vscode-extension/test/e2e/pdf-preview-selection.spec.ts \
  packages/vscode-extension/test/e2e/pdf-viewer.spec.ts \
  --reporter=line
```

Expected: all commands exit zero.

- [ ] **Step 2: Rebuild and reload the Cursor development host**

Build with `pnpm --filter llm-wiki-vscode build`. Use `node_repl` plus `@oai/sky` to focus the running Cursor Extension Development Host and invoke `Developer: Reload Window`. Reopen the DPO PDF with `LLM Wiki PDF Viewer` if necessary.

- [ ] **Step 3: Verify continuous cross-page area drag with Computer Use**

Use the PDF toolbar to show continuous pages. With `Alt` held, drag from the lower blank/text-adjacent region of page 1 into page 2. Inspect fresh app state and screenshot after the gesture. Verify overlays are visible on both pages and the selection toolbar exposes `Add to Chat` and `Copy for Agent` only.

- [ ] **Step 4: Verify paginated Shift-add with Computer Use**

Switch to single-page mode, select a page-1 region, navigate to page 2, hold `Shift`, and drag a second region. Navigate back and verify the first overlay persists. Use `Copy for Agent`, then inspect the copied payload in a local temporary text field or agent composer without submitting; verify ordered page-1 and page-2 source links and no screenshot path.

- [ ] **Step 5: Final repository checks**

```bash
rg -n "persistPdfAgentClipboardImage|action: 'copyLink'|action: 'copyRectEmbed'" \
  packages/pdf-editor/src packages/vscode-extension/src || true
git diff --check
git status --short
```

Expected: no legacy selection paths, no whitespace errors, and a clean worktree after commits.
