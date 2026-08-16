# Dockable PDF Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let readers dock the PDF toolbar at the top or left, hide it, and reliably restore it with `Shift+T` or a Command Palette command.

**Architecture:** A pure toolbar-state module validates persisted values, toggles visibility, and resolves top/left drag targets. The extension host owns global persistence and broadcasts one preference to all open PDF webviews; the viewer owns layout, grip-only pointer interaction, menu parity, and the focus-aware shortcut.

**Tech Stack:** TypeScript, VS Code `globalState`, custom-editor webview messaging, pointer events, CSS Grid/Flexbox, Node test runner, Playwright.

## Global Constraints

- Visible positions are exactly `top` and `left`; there is no floating state.
- Both positions occupy layout space and never cover PDF content or the internal sidebar.
- Only a dedicated grip starts dragging.
- Menu actions provide complete non-drag parity.
- Hidden state restores the last visible dock, defaulting to `top`.
- State persists across PDFs and restarts and synchronizes to all open PDF webviews.
- `Shift+T` is ignored in input, textarea, select, and content-editable controls.
- Malformed state/messages fail closed to the last valid layout.

---

### Task 1: Pure toolbar preference and docking state

**Files:**
- Create: `packages/pdf-editor/src/webview/domain/pdfToolbarLayout.ts`
- Modify: `packages/pdf-editor/package.json`
- Create: `packages/vscode-extension/test/pdfToolbarLayout.test.mjs`

**Interfaces:**
- Produces:

```ts
export type PdfToolbarDock = 'top' | 'left';

export interface PdfToolbarPreference {
  dock: PdfToolbarDock;
  hidden: boolean;
}

export const DEFAULT_PDF_TOOLBAR_PREFERENCE: PdfToolbarPreference;

export function normalizePdfToolbarPreference(
  value: unknown,
  fallback?: PdfToolbarPreference,
): PdfToolbarPreference;

export function togglePdfToolbarPreference(
  value: PdfToolbarPreference,
): PdfToolbarPreference;

export function pdfToolbarDockAtPoint(
  point: { clientX: number; clientY: number },
  viewport: { width: number; height: number },
  edgeSize?: number,
): PdfToolbarDock | undefined;
```

- [ ] **Step 1: Write failing normalization, toggle, and docking tests**

Assert:

```js
assert.deepEqual(normalizePdfToolbarPreference(undefined), {
  dock: 'top',
  hidden: false,
});
assert.deepEqual(togglePdfToolbarPreference({ dock: 'left', hidden: true }), {
  dock: 'left',
  hidden: false,
});
assert.equal(pdfToolbarDockAtPoint({ clientX: 4, clientY: 300 }, viewport), 'left');
assert.equal(pdfToolbarDockAtPoint({ clientX: 300, clientY: 4 }, viewport), 'top');
assert.equal(pdfToolbarDockAtPoint({ clientX: 300, clientY: 300 }, viewport), undefined);
```

Include malformed objects, non-finite points, top-left tie-breaking by nearest normalized edge, and custom edge-size bounds.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
node --test packages/vscode-extension/test/pdfToolbarLayout.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure state helpers**

Return fresh validated objects. Preserve `dock` while hiding/restoring. Clamp the
docking edge to a finite range of 16–160 CSS pixels and resolve top-left overlap
by the smaller edge distance. Export this DOM-free module to the extension host
through a package subpath:

```json
{
  "exports": {
    "./webview": "./src/webview/pdf-viewer.ts",
    "./toolbar-layout": "./src/webview/domain/pdfToolbarLayout.ts"
  }
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command.

Expected: all state-domain tests pass.

- [ ] **Step 5: Commit the pure state module**

```bash
git add packages/pdf-editor/src/webview/domain/pdfToolbarLayout.ts \
  packages/pdf-editor/package.json \
  packages/vscode-extension/test/pdfToolbarLayout.test.mjs
git commit -m "feat(pdf): define toolbar docking preferences"
```

---

### Task 2: Host persistence, broadcast, and recovery command

**Files:**
- Modify: `packages/vscode-extension/src/pdfEditorProvider.ts`
- Modify: `packages/vscode-extension/src/extension.ts`
- Modify: `packages/vscode-extension/package.json`
- Modify: `packages/vscode-extension/test/pdfSelectionContext.test.mjs`
- Modify: `packages/vscode-extension/test/extensionActivation.test.mjs`
- Modify: `packages/vscode-extension/test/buildArtifacts.test.mjs`

**Interfaces:**
- Consumes: `PdfToolbarPreference` and normalization/toggle helpers from Task 1.
- Uses global-state key: `llmWiki.pdf.toolbarPreference.v1`.
- Adds provider methods:

```ts
getPdfToolbarPreference(): PdfToolbarPreference;
setPdfToolbarPreference(value: unknown): Promise<PdfToolbarPreference>;
togglePdfToolbar(): Promise<PdfToolbarPreference>;
```

- Adds messages:

```ts
{ type: 'pdfToolbarPreference'; preference: PdfToolbarPreference }
{ type: 'pdfToolbarPreferenceChanged'; preference: PdfToolbarPreference }
```

- Adds public command: `llm-wiki.togglePdfToolbar`.

- [ ] **Step 1: Write failing provider persistence and synchronization tests**

Construct a context with a fake `globalState`, open two fake webviews, and assert:

- `ready` posts the persisted preference before or with document load;
- a valid `pdfToolbarPreferenceChanged` message updates `globalState`;
- both webviews receive the normalized preference;
- malformed changes do not overwrite valid state;
- toggling hidden restores the stored dock.

- [ ] **Step 2: Write failing command and manifest tests**

Assert activation registers `llm-wiki.togglePdfToolbar`, the command contribution
title is `LLM Wiki: Toggle PDF Toolbar`, and its enablement/visibility is limited
to `llmWikiPdfOpen` or the active PDF custom editor.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
node --test packages/vscode-extension/test/pdfSelectionContext.test.mjs \
  packages/vscode-extension/test/extensionActivation.test.mjs \
  packages/vscode-extension/test/buildArtifacts.test.mjs
```

Expected: FAIL because the preference protocol and command do not exist.

- [ ] **Step 4: Implement persistence and broadcast**

Read and normalize global state in the provider constructor. On `ready`, post:

```ts
active.postMessage({
  type: 'pdfToolbarPreference',
  preference: this.pdfToolbarPreference,
});
```

On a valid webview change, update the in-memory value first, apply it to the
originating webview immediately, broadcast it to every open webview, and await
`context.globalState.update()`. Persistence failure must not roll back the
in-memory layout.

- [ ] **Step 5: Register the recovery command**

Register:

```ts
vscode.commands.registerCommand('llm-wiki.togglePdfToolbar', async () => {
  await pdfEditorProvider?.togglePdfToolbar();
});
```

Contribute the command in `package.json`. Do not add a global VS Code keybinding;
the focus-aware webview owns `Shift+T`.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 3 command.

Expected: all host and manifest tests pass.

- [ ] **Step 7: Commit host persistence**

```bash
git add packages/vscode-extension/src/pdfEditorProvider.ts \
  packages/vscode-extension/src/extension.ts \
  packages/vscode-extension/package.json \
  packages/vscode-extension/test/pdfSelectionContext.test.mjs \
  packages/vscode-extension/test/extensionActivation.test.mjs \
  packages/vscode-extension/test/buildArtifacts.test.mjs
git commit -m "feat(pdf): persist toolbar visibility and dock"
```

---

### Task 3: Top/left viewer layout, menu controls, dragging, and shortcut

**Files:**
- Modify: `packages/vscode-extension/src/pdfEditorProvider.ts`
- Modify: `packages/pdf-editor/src/webview/pdf-viewer.ts`
- Modify: `packages/vscode-extension/test/e2e/pdf-viewer.spec.ts`
- Modify: `packages/vscode-extension/test/pdfSelectionDomain.test.mjs`

**Interfaces:**
- Consumes host preference messages from Task 2.
- Adds viewer methods:

```ts
private applyPdfToolbarPreference(preference: unknown): void;
private requestPdfToolbarPreference(preference: PdfToolbarPreference): void;
private beginPdfToolbarDrag(event: PointerEvent): void;
private updatePdfToolbarDrag(event: PointerEvent): void;
private endPdfToolbarDrag(event: PointerEvent): void;
private cancelPdfToolbarDrag(): void;
```

- [ ] **Step 1: Write failing layout and menu Playwright tests**

Assert:

- initial top state has `data-toolbar-dock="top"` and the toolbar is above `#viewer-shell`;
- choosing **Move toolbar to left** changes the root state, produces a narrow
  toolbar column, and shifts the sidebar/content right without rectangle
  overlap;
- choosing **Move toolbar to top** restores the row;
- all existing controls remain visible, named, and operable in both positions;
- display/search menus remain inside the viewport.

- [ ] **Step 2: Run the focused browser tests and verify RED**

```bash
pnpm build
pnpm exec playwright test --config playwright.config.ts \
  packages/vscode-extension/test/e2e/pdf-viewer.spec.ts \
  --grep "toolbar dock|toolbar menu position"
```

Expected: FAIL because no dock state or menu items exist.

- [ ] **Step 3: Implement responsive layout and menu parity**

Wrap `#toolbar` and `#viewer-shell` in `#pdf-reader-layout`. Apply:

```css
#pdf-reader-layout[data-toolbar-dock="top"] {
  grid-template: auto minmax(0, 1fr) / minmax(0, 1fr);
}
#pdf-reader-layout[data-toolbar-dock="left"] {
  grid-template: minmax(0, 1fr) / auto minmax(0, 1fr);
}
```

Give the left toolbar a vertical axis, vertical separators, bounded width, and
scrolling for short viewports. Add a grip button with accessible name
`Move PDF toolbar`. Add the three display-menu actions and post normalized
preference changes to the host.

- [ ] **Step 4: Write failing grip-only drag tests**

Use Playwright pointer coordinates to assert:

- grip drag top→left and left→top commits;
- releasing in the middle restores the previous dock;
- `Escape` cancels;
- dragging zoom/page buttons does not dock;
- the active target preview is visible only during a grip drag.

- [ ] **Step 5: Implement pointer drag state**

Use pointer capture on the grip and a single drag record:

```ts
interface PdfToolbarDrag {
  pointerId: number;
  origin: PdfToolbarDock;
  candidate?: PdfToolbarDock;
}
```

Call `pdfToolbarDockAtPoint()` on movement. Render two inert drop indicators,
commit only a valid candidate on pointerup, and clean up capture/classes on
pointercancel or `Escape`.

- [ ] **Step 6: Write failing hide and shortcut tests**

Assert:

- **Hide toolbar** removes it from layout;
- `Shift+T` restores the last dock and pressing it again hides;
- `Shift+T` inside zoom/page/search inputs does nothing;
- a host `pdfToolbarPreference` message restores a hidden toolbar;
- hiding preserves current page, zoom, sidebar, search, selection, and history
  state.

- [ ] **Step 7: Implement hide and focus-aware shortcut**

Install one viewer-level `keydown` handler:

```ts
if (
  event.key.toLowerCase() === 't'
  && event.shiftKey
  && !event.metaKey
  && !event.ctrlKey
  && !event.altKey
  && !isEditablePdfToolbarTarget(event.target)
) {
  event.preventDefault();
  this.requestPdfToolbarPreference(
    togglePdfToolbarPreference(this.pdfToolbarPreference),
  );
}
```

Hidden state uses the HTML `hidden` attribute and a root data attribute; it does
not recreate the viewer or reset document state.

- [ ] **Step 8: Run focused unit and browser tests**

```bash
node --test packages/vscode-extension/test/pdfToolbarLayout.test.mjs \
  packages/vscode-extension/test/pdfSelectionDomain.test.mjs
pnpm build
pnpm exec playwright test --config playwright.config.ts \
  packages/vscode-extension/test/e2e/pdf-viewer.spec.ts \
  --grep "toolbar dock|toolbar drag|hide toolbar|Shift.T"
```

Expected: all focused tests pass.

- [ ] **Step 9: Commit viewer interaction**

```bash
git add packages/vscode-extension/src/pdfEditorProvider.ts \
  packages/pdf-editor/src/webview/pdf-viewer.ts \
  packages/vscode-extension/test/e2e/pdf-viewer.spec.ts \
  packages/vscode-extension/test/pdfSelectionDomain.test.mjs
git commit -m "feat(pdf): dock and hide the navigation toolbar"
```

---

### Task 4: Toolbar regression and live acceptance

**Files:**
- Create: `.superpowers/sdd/2026-08-16-dockable-pdf-toolbar/task-report.md`

**Interfaces:**
- Consumes: completed toolbar state, host persistence, and viewer interaction.
- Produces: verification evidence that docking and hiding do not regress PDF workflows.

- [ ] **Step 1: Run the full affected PDF browser suites**

```bash
pnpm exec playwright test --config playwright.config.ts \
  packages/vscode-extension/test/e2e/pdf-viewer.spec.ts \
  packages/vscode-extension/test/e2e/pdf-navigation-preview.spec.ts \
  packages/vscode-extension/test/e2e/pdf-selection-preview-parity.spec.ts
```

Expected: all non-environment-skipped cases pass.

- [ ] **Step 2: Run complete repository gates**

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 3: Verify in an Extension Development Host**

Open a PDF and confirm:

1. Grip drag moves top→left and left→top.
2. The page and internal sidebar are never obscured.
3. Menu actions move and hide the toolbar.
4. `Shift+T` restores the last position after hiding.
5. The Command Palette command restores it when focus is elsewhere.
6. A second PDF uses the same preference.
7. Reloading the host preserves position and hidden state.
8. Zoom, page navigation, search, selection, links, Copy for Agent, and outline
   navigation still work in both orientations.

- [ ] **Step 4: Record evidence and commit**

Write exact test counts and live observations to the task report, then:

```bash
git add .superpowers/sdd/2026-08-16-dockable-pdf-toolbar/task-report.md
git commit -m "test(pdf): verify dockable toolbar workflows"
```
