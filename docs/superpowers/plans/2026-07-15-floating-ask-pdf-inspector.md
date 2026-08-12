# Floating Ask PDF Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed Ask PDF sidebar with a movable, resizable, minimizable floating inspector whose geometry belongs to each PDF discussion annotation, while eliminating toolbar/page drift during annotation navigation.

**Architecture:** Keep the existing host protocol and durable sidecar unchanged. Extend the shared webview panel with annotation-keyed geometry stored through `vscode.getState`/`setState`, and supply selection viewport rectangles from the viewer so an attached inspector can follow its anchor. Stabilize continuous-page reporting by retaining intersection ratios for every page. The combined and standalone sources remain byte-identical.

**Tech Stack:** TypeScript, DOM Pointer Events, VS Code webview state, EmbedPDF/PDFium, Playwright.

## Global Constraints

- The floating window belongs to an annotation; document-level panel geometry must not leak between annotations.
- Default size is 380 × 520 CSS pixels; minimum is 320 × 260; maximum is 560 × 720 and is additionally clamped to the viewport.
- Attached windows follow the selection; dragging detaches them; minimizing preserves the marker and transcript.
- Below 620 CSS pixels, use a clamped near-full-width overlay with drag and pointer resize disabled.
- Preserve safe Markdown, host-routed links, keyboard accessibility, ARIA streaming announcements, and reduced motion.
- Keep `packages/vscode-extension` and `packages/vscode-pdf-extension` behaviorally and byte-for-byte identical for shared viewer sources.
- Preserve the dirty worktree. Do not reset, stash, broadly format, stage, or commit unrelated changes.

---

### Task 1: Lock the interaction contract with browser tests

**Files:**
- Modify: `packages/vscode-extension/test/e2e/ask-pdf.spec.ts`
- Modify: `packages/vscode-extension/test/e2e/pdf-viewer.spec.ts`

**Interfaces:**
- Consumes: current `.ask-pdf-panel`, `.pdf-discussion-marker`, Ask PDF snapshots, and page navigation helpers.
- Produces: regression tests that require annotation-keyed floating geometry and stable page visibility state.

- [ ] **Step 1: Write a failing anchored-placement test**

Create a PDF selection, open Ask PDF, and assert `getComputedStyle(panel).position === 'absolute'`, the panel overlaps neither the toolbar nor the selected rectangle, and its bounding box stays inside `#viewer-shell`.

- [ ] **Step 2: Write failing drag, resize, minimize, and restore tests**

Drag `.ask-pdf-header`, resize from the southeast handle, minimize with `Minimize Ask PDF`, click the annotation marker, and assert the restored annotation keeps its moved rectangle and transcript.

- [ ] **Step 3: Write a failing annotation-ownership test**

Open two annotations, assign different panel rectangles, switch between their markers, and assert each annotation restores its own geometry and minimized state.

- [ ] **Step 4: Write failing responsive and keyboard tests**

At widths below 620 pixels, assert the window is viewport-clamped and pointer drag/resize does not move it. At desktop width, use the resize separator's arrow keys and assert its accessible values and panel dimensions change.

- [ ] **Step 5: Write a failing continuous-scroll page-state test**

Feed separate `IntersectionObserver` callback batches where page 2 remains most visible but only page 3 changes in the second batch. Assert the toolbar remains on page 2, then open the page-2 annotation and assert source, portable page, marker, and toolbar all agree.

- [ ] **Step 6: Run the focused tests and record the expected failures**

Run `pnpm --filter llm-wiki-vscode exec playwright test --config ../../playwright.config.ts test/e2e/ask-pdf.spec.ts test/e2e/pdf-viewer.spec.ts`. Expected: the new floating-window and visibility assertions fail against the docked implementation.

### Task 2: Implement annotation-owned floating geometry

**Files:**
- Modify: `packages/vscode-extension/webview-src/pdfAskPanel.ts`
- Modify: `packages/vscode-extension/webview-src/pdf-viewer.ts`
- Mirror: `packages/vscode-pdf-extension/webview-src/pdfAskPanel.ts`
- Mirror: `packages/vscode-pdf-extension/webview-src/pdf-viewer.ts`

**Interfaces:**
- Consumes: `PdfAskSelection`, `PdfDiscussionAnnotationSnapshot`, `viewerShell`, page wrappers, and `vscode.getState`/`setState`.
- Produces: `getAnchorViewportRect(page, rects)`, annotation-keyed `AskPdfWindowState`, pointer/keyboard move and resize behavior, and minimize/restore behavior.

- [ ] **Step 1: Extend panel options with anchor viewport geometry**

Add `getAnchorViewportRect(page: number, rects: PdfRect[]): { left: number; top: number; right: number; bottom: number } | undefined`. Compute it from the rendered page wrapper, PDF coordinates, current scale, and `viewerShell.getBoundingClientRect()`.

- [ ] **Step 2: Add annotation-keyed webview state**

Replace `askPdfPanelWidth` with `askPdfWindows: Record<string, { left: number; top: number; width: number; height: number; detached: boolean; minimized: boolean }>` while tolerating old state. Use an ephemeral selection key for drafts and migrate it to `annotation.id` on prepare/snapshot adoption.

- [ ] **Step 3: Implement attached placement and viewport clamping**

Prefer right, left, below, then above. Clamp every rectangle to a 12-pixel inset inside `viewerShell`. Recompute attached placement on captured scroll and resize events through one animation-frame scheduler.

- [ ] **Step 4: Implement drag, pointer resize, and keyboard resize**

Use the header as a drag handle, detach on the first intentional move, expose edge/corner resize handles, and keep a keyboard-accessible separator. Save bounded geometry only for the active annotation key.

- [ ] **Step 5: Implement annotation minimize/restore**

Add `Minimize Ask PDF`, map Escape to minimize, retain marker and outline, and restore the annotation's geometry from marker/overview activation. Keep overview closing document-scoped.

- [ ] **Step 6: Replace docked styles with floating scholarly-marginalia styles**

Use an absolute window, four-sided border, restrained shadow, draggable header, blue attached leader, and responsive narrow overlay. Preserve the existing transcript/source/composer styling and accessibility rules.

- [ ] **Step 7: Mirror exact sources and run focused tests**

Copy the two shared sources byte-for-byte to the standalone package, run the focused Playwright command, and expect all new tests to pass.

### Task 3: Stabilize continuous-scroll page reporting

**Files:**
- Modify: `packages/vscode-extension/webview-src/pdf-viewer.ts`
- Mirror: `packages/vscode-pdf-extension/webview-src/pdf-viewer.ts`
- Test: `packages/vscode-extension/test/e2e/pdf-viewer.spec.ts`

**Interfaces:**
- Consumes: per-page `IntersectionObserverEntry` values and `currentPage`.
- Produces: a retained `Map<number, number>` of visibility ratios and deterministic most-visible-page selection.

- [ ] **Step 1: Retain visibility for all pages**

Update the ratio map for every observer entry, setting non-intersecting pages to zero. Select the maximum ratio across the complete map, preferring the current page on ties.

- [ ] **Step 2: Reset visibility state when loading a PDF**

Clear ratios when the document/page wrappers are rebuilt so state cannot cross documents.

- [ ] **Step 3: Run the page-state regression**

Run `pnpm --filter llm-wiki-vscode exec playwright test --config ../../playwright.config.ts test/e2e/pdf-viewer.spec.ts -g 'continuous-scroll page state'`. Expected: pass with Page 2 retained.

### Task 4: Documentation, parity, and verification

**Files:**
- Modify: `docs/PDF viewer detail.md`
- Verify all files named above.

**Interfaces:**
- Consumes: completed behavior from Tasks 1–3.
- Produces: documented UX and verified combined/standalone parity.

- [ ] **Step 1: Document floating annotation ownership**

Replace the fixed-right-panel description with the attached, detached, minimized, and per-annotation persistence behavior.

- [ ] **Step 2: Run focused and full automated verification**

Run the Ask PDF/PDF Playwright suites, package tests, VS Code E2E suite, and both production builds. Expect zero failures.

- [ ] **Step 3: Verify mirror and patch hygiene**

Run `cmp` for shared panel/viewer/controller/protocol/client sources and `git diff --check`. Expect exit code 0.

- [ ] **Step 4: Perform the real textbook smoke test**

Reload only the isolated test-app bundle, open the persisted page-2 annotation, move and resize it, minimize and restore from marker, switch through the overview, and verify the toolbar stays on page 2. Leave the isolated window open for inspection.

- [ ] **Step 5: Do not commit**

Leave all changes unstaged and uncommitted so the user's pre-existing dirty worktree remains intact.
