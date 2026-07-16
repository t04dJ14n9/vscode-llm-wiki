# PDF Appearance and Context Menu Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the VS Code PDF viewer preserve the PDF's original white page by default, make Markdown/PDF secondary-click menus behave and look like Obsidian/PDF++ menus, and prove a fresh Markdown-to-PDF-to-Markdown link round trip in the live extension.

**Architecture:** Keep "Adapt to theme" as an explicit PDF display option but default it off everywhere, including reset/default actions. Add one small webview menu primitive, mirrored into the combined and standalone packages, then route existing Markdown commands and PDF selection actions through vertical, keyboard-accessible context menus. PDF page-only actions are handled by the host provider so copied page links have the same wikilink form as PDF++. The final live gate creates uniquely named Markdown/PDF artifacts, inserts a persisted PDF-selection link into Markdown, follows it to the anchored PDF selection, then follows the PDF reference popover back to the originating Markdown line.

**Tech Stack:** TypeScript, CodeMirror 6, VS Code custom webviews, Playwright, Node test runner.

## Global Constraints

- Preserve every unrelated change in the existing dirty worktree.
- Do not stage or commit unless the user explicitly requests it.
- Combined and standalone webview sources must remain byte-identical for their shared files.
- A fresh PDF view in a dark VS Code theme must render the original canvas colors; theme inversion remains available only after the user enables it.
- Context menus must be vertical, clamped to the viewport, dismiss on Escape/outside pointer input, expose `role="menu"`/`role="menuitem"`, and support ArrowUp/ArrowDown/Home/End keyboard navigation.
- Markdown and PDF menu actions must reuse existing command/action paths instead of duplicating editing or anchor persistence logic.
- Every production behavior change must first be covered by a focused failing test.
- The live round trip must use newly created artifacts and prove both navigation directions: Markdown link to anchored PDF selection, then PDF reference item back to the originating Markdown line.

---

### Task 1: Preserve original PDF colors by default

**Files:**
- Modify: `packages/vscode-extension/webview-src/pdf-viewer.ts`
- Modify: `packages/vscode-pdf-extension/webview-src/pdf-viewer.ts`
- Modify: `packages/vscode-extension/src/pdfEditorProvider.ts`
- Modify: `packages/vscode-pdf-extension/src/pdfEditorProvider.ts`
- Modify: `packages/vscode-extension/test/e2e/pdf-viewer.html`
- Test: `packages/vscode-extension/test/e2e/pdf-viewer.spec.ts`

**Interfaces:**
- Consumes: existing `PdfViewer.applyDisplayAction('adapt-theme' | 'defaults')` and `updateToolbarState()`.
- Produces: fresh/default state `adaptToTheme === false`; opt-in toggle still adds `pdf-adapt-theme`.

- [x] **Step 1: Replace the existing theme test with a failing default-state test**

  In a dark host, assert a fresh viewer has no `pdf-adapt-theme` class, the menu item is unchecked, and canvas/thumbnail filters are `none`. Then enable the menu item and assert the class/filter appear. Finally invoke `Defaults` and assert the class/filter are removed again.

- [x] **Step 2: Run the focused test and verify RED**

  Run: `pnpm exec playwright test packages/vscode-extension/test/e2e/pdf-viewer.spec.ts --grep "original PDF colors" --workers=1`

  Expected: FAIL because current production code initializes `adaptToTheme` to `true`.

- [x] **Step 3: Implement the minimal default-state change**

  Set `private adaptToTheme = false`, make the `defaults` action remove `pdf-adapt-theme`, and make all generated/fixture menu markup start with `aria-checked="false"`. Mirror the changes exactly in the standalone provider/viewer.

- [x] **Step 4: Run the focused test and verify GREEN**

  Run the same Playwright command. Expected: PASS.

---

### Task 2: Add an Obsidian-style accessible webview context-menu primitive

**Files:**
- Create: `packages/vscode-extension/webview-src/obsidianContextMenu.ts`
- Create: `packages/vscode-markdown-extension/webview-src/obsidianContextMenu.ts`
- Create: `packages/vscode-pdf-extension/webview-src/obsidianContextMenu.ts`
- Modify: `packages/vscode-extension/webview-src/markdown-editor.ts`
- Modify: `packages/vscode-markdown-extension/webview-src/markdown-editor.ts`
- Test: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts`

**Interfaces:**
- Produces: `showObsidianContextMenu(options): HTMLElement` and `closeObsidianContextMenu(): void`.
- `options.items` accepts action entries (`label`, optional `icon`, `onSelect`) and separator entries.

- [x] **Step 1: Write a failing Markdown secondary-click test**

  Select text, dispatch `contextmenu`, and assert a single vertical menu with `role="menu"`, menuitems for Copy, Bold, Italic, Strikethrough, Inline code, Highlight, Link, and Look Up. Assert computed `flex-direction` is `column`, Escape dismisses it, and clicking Bold still produces `**selection**`.

- [x] **Step 2: Run the focused test and verify RED**

  Run: `pnpm exec playwright test packages/vscode-extension/test/e2e/markdown-editor.spec.ts --grep "Obsidian-style context menu" --workers=1`

  Expected: FAIL because the current right-click surface is a horizontal selection toolbar.

- [x] **Step 3: Add the generic menu primitive and route Markdown actions through it**

  The helper creates a fixed-position `.obsidian-context-menu`, renders separators and menuitem buttons, clamps after layout, focuses the first item, handles ArrowUp/ArrowDown/Home/End/Escape, and unregisters document listeners on close. Replace the Markdown toolbar builder with calls to the helper and existing `obsidianLikeCommands`, `copySelectionToClipboard`, and lookup messaging.

- [x] **Step 4: Run the focused test and verify GREEN**

  Run the same Markdown Playwright command. Expected: PASS.

---

### Task 3: Add PDF++-style PDF secondary-click menus

**Files:**
- Modify: `packages/vscode-extension/webview-src/pdf-viewer.ts`
- Modify: `packages/vscode-pdf-extension/webview-src/pdf-viewer.ts`
- Modify: `packages/vscode-extension/src/pdfEditorProvider.ts`
- Modify: `packages/vscode-pdf-extension/src/pdfEditorProvider.ts`
- Test: `packages/vscode-extension/test/e2e/pdf-viewer.spec.ts`
- Test: `packages/vscode-extension/test/pdfSelectionContext.test.mjs`

**Interfaces:**
- Consumes: `showObsidianContextMenu`, existing `selectionAction` messages, `formatPdfLinkLabel`, and `formatPdfRectangleEmbed` patterns.
- Produces host messages `{ type: 'copyText', text }`, `{ type: 'lookupSelection', text }`, and `{ type: 'copyPageLink', page }`.
- Produces `formatPdfPageLink(relPath, page)` with exact output `[[path/to/file.pdf#page=N|file, p.N]]`.

- [x] **Step 1: Write failing PDF menu and page-link tests**

  For selected text, right-click and assert menuitems `Look up ...`, `Copy link to selection`, `Highlight selection`, `Copy selected text`, `Copy quote and link`, `Insert link`, and `Insert quote and link`. For an unselected page, assert `Copy link to page`. Add a Node assertion for exact PDF++ page-link wikilink formatting.

- [x] **Step 2: Run focused tests and verify RED**

  Run: `pnpm exec playwright test packages/vscode-extension/test/e2e/pdf-viewer.spec.ts --grep "PDF\+\+-style context menu" --workers=1`

  Run: `node --test packages/vscode-extension/test/pdfSelectionContext.test.mjs`

  Expected: the Playwright test fails because no PDF `contextmenu` handler exists; the Node test fails because `formatPdfPageLink` is absent.

- [x] **Step 3: Implement the menu and host actions**

  Store the latest valid text-selection anchor, install a `contextmenu` listener on `pageContainer`, and show selection or page actions with the shared helper. Keep the existing mouseup selection toolbar behavior. Add provider cases for clipboard text, Dictionary lookup, and page-link copying; mirror all source changes in the standalone package.

- [x] **Step 4: Run focused tests and verify GREEN**

  Run both focused commands again. Expected: PASS.

---

### Task 4: Full verification and live-app audit

**Files:**
- Verify all files above; do not add unrelated changes.

- [x] **Step 1: Run complete automated verification**

  Run the full Markdown and PDF Playwright suites, extension Node tests, core tests, combined/standalone builds, `git diff --check`, and byte-for-byte source parity diffs.

  Verified 2026-07-12: Markdown/PDF Playwright `214/214`; extension Node `103/103`; core `17/17`; pure bidirectional E2E `2/2`; all three production builds; source and generated-bundle parity; `git diff --check`; final scoped review approved with no findings. The optional deterministic fuzz run's aggregate timeout was isolated to the fixture appending 15,412 log DOM nodes; the same 7,680 editor operations passed in 26.8 seconds with only fixture logging suppressed.

- [ ] **Step 2: Audit with Computer Use**

  In actual Obsidian/PDF++ and the VS Code Extension Development Host, capture: a white page 1 in both PDF viewers, the selected-text Markdown menus, the selected-text PDF menus, and the page-only PDF menus. Compare appearance, labels, ordering, dismissal, and action behavior.

  Current environment blocker (2026-07-12): Computer Use 1.0.1000366 cannot start on macOS 15.7.2. Its client and service binaries both fail during dynamic linking with missing symbol `_swift_task_addPriorityEscalationHandler`. A compatible Computer Use build or Swift runtime is required before this gate can produce valid current-run screenshots.

- [ ] **Step 3: Complete only with direct evidence**

  Keep the goal active if Computer Use remains unavailable or any visible/menu-action mismatch remains.

---

### Task 5: Create fresh artifacts and prove bidirectional Markdown/PDF navigation

**Files:**
- Create temporarily in the Extension Development Host test vault: `notes/Link Round Trip 2026-07-12.md`
- Create temporarily in the same vault: `raw/Link Round Trip 2026-07-12.pdf`
- Inspect without retaining unrelated changes: the vault database/link index generated by the extension.

**Interfaces:**
- Consumes: PDF `Insert link`, persisted `human-learning://pdf/...` anchors, Markdown link activation, PDF referenced-highlight popover, and `openMarkdownAtLocation`.
- Produces: direct UI evidence that the inserted Markdown link reopens the exact PDF selection and that the PDF reference entry reopens the originating Markdown line.

- [ ] **Step 1: Create unique Markdown and PDF artifacts**

  Create a Markdown note whose first line is `# Link Round Trip 2026-07-12` and a PDF containing the unique sentence `Human Learning round-trip anchor 2026-07-12.` Open both through the Extension Development Host, not through source-editor fallbacks.

  Prepared and independently verified: the Markdown source is 22 lines with the menu check on line 9 and strikethrough on line 20; the searchable one-page PDF renders with its original white background. Copies exist in the Obsidian vault and the Extension Development Host fixture. Opening them through both live app surfaces remains part of this unchecked gate.

- [ ] **Step 2: Insert a persisted PDF-selection link into Markdown**

  Select the unique PDF sentence, open the PDF++-style secondary-click menu, choose `Insert link`, and save the Markdown note. Verify the note contains one Markdown link with a `human-learning://pdf/` destination and that the PDF selection becomes a referenced highlight after indexing.

- [ ] **Step 3: Follow Markdown to the exact PDF anchor**

  Activate the inserted link from the custom Markdown editor. Verify the PDF opens on the expected page and reveals the selected unique sentence, rather than merely opening page 1 without an anchor.

- [ ] **Step 4: Follow the PDF reference back to Markdown**

  Activate the referenced PDF highlight, open its reference entry, and verify `Link Round Trip 2026-07-12.md` reopens at the line containing the inserted link.

- [ ] **Step 5: Capture and retain evidence**

  Capture screenshots of the created Markdown note with the persisted link, the anchored PDF with its original white background/reference highlight, and the reopened Markdown source line. Record the artifact paths and exact navigation observations in the final verification report.
