# Portable PDF Text Fragments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace database-bound PDF anchor/chunk links with Chrome/WICG-compatible page-plus-text-fragment links that work without `.llm_wiki` in both standalone editors.

**Architecture:** `@llm-wiki/core` owns the portable URL type, parser, and serializer. PDF webviews add selection context and resolve selectors against their existing page text index. Providers and URI dispatchers transport the typed selector without database lookup. Annotation persistence remains separate and stores a portable URI.

**Tech Stack:** TypeScript, Node test runner, VS Code custom editors, `@embedpdf/pdfium`, Playwright, pnpm workspace builds.

## Global Constraints

- Preserve unrelated uncommitted work in the current checkout.
- Treat this as a clean pre-release cutover: do not retain `anchor=` or `chunk=` PDF-link compatibility paths.
- Keep `packages/vscode-extension` and `packages/vscode-pdf-extension` behavior identical.
- Keep page-only PDF links and PDF++ rectangle embeds unchanged.
- Follow red-green-refactor for every behavior change.

---

## Task 1: Define and test the core URL contract

- [ ] In `packages/core/test/core.test.mjs`, add failing assertions for `pdfHref` output and `classifyReferenceTarget` parsing of page plus `:~:text` with prefix, start, end, suffix, reserved characters, angle-wrapped paths, and malformed directives.
- [ ] Update existing PDF anchor creation assertions to require portable text-fragment URIs and update native-reference fixtures to remove `anchor=`/`chunk=` expectations.
- [ ] Run `pnpm --filter @llm-wiki/core test` and confirm the new tests fail for the missing contract.
- [ ] In `packages/core/src/links/reference-target.ts`, add exported `PdfTextFragment`, add `textFragment` to `ReferenceTarget`, replace `pdfHref` anchor/chunk options with `textFragment`, and add grammar-safe term encoding/decoding.
- [ ] In `packages/core/src/anchors/pdf.ts`, add optional prefix/suffix selection context, store it in the locator, and create portable row URIs without exposing the internal anchor ID.
- [ ] Update PDF semantic-search link generation to page-plus-text-fragment or page-only URLs so no new `chunk=` URL is emitted.
- [ ] Re-run the core tests until green.

## Task 2: Make provider link actions database-free

- [ ] In `packages/vscode-extension/test/pdfSelectionContext.test.mjs`, add failing tests showing that agent context and copy/insert link actions produce `page + :~:text` URLs and never call database functions; retain a test that direct highlight persists an annotation.
- [ ] Run that test file and confirm the expected failures.
- [ ] In both `packages/vscode-extension/src/pdfEditorProvider.ts` and `packages/vscode-pdf-extension/src/pdfEditorProvider.ts`, add prefix/suffix fields to normalized selections and construct portable links with `pdfHref`.
- [ ] Change `getActiveSelectionContext` and non-highlight selection actions to avoid persistence and highlight refreshes. Keep persistence only in the `highlight` action and pass prefix/suffix into it.
- [ ] Make the standalone PDF extension activate from the workspace root without `.llm_wiki`; in that mode skip automatic highlight database reads and reject explicit annotation persistence with a clear message instead of creating `.llm_wiki`.
- [ ] Re-run provider tests until green.

## Task 3: Transport selectors through every dispatcher

- [ ] In `packages/vscode-extension/test/uriDispatcher.test.mjs` and `packages/vscode-extension/test/navigationHistory.test.mjs`, replace legacy anchor fixtures with failing text-fragment payload assertions.
- [ ] Run those tests and confirm they fail before production changes.
- [ ] Update the PDF command argument and navigation target in `packages/vscode-extension/src/extension.ts`, `packages/vscode-extension/src/navigationHistory.ts`, `packages/vscode-extension/src/uriDispatcher.ts`, `packages/vscode-pdf-extension/src/extension.ts`, `packages/vscode-pdf-extension/src/uriDispatcher.ts`, and `packages/vscode-markdown-extension/src/uriDispatcher.ts` to carry `textFragment` instead of anchor/chunk IDs.
- [ ] Rename the internal provider method and command from `openPdfAtAnchor`/`llm-wiki.openPdfAtAnchor` to `openPdfAtTarget`/`llm-wiki.openPdfTarget`; do not retain an alias.
- [ ] Change both providers' open methods to post `{ page, textFragment }` directly and remove database resolution from navigation.
- [ ] Remove direct `anc_*` dispatch branches from the three dispatchers.
- [ ] Make the standalone Markdown dispatcher route relative PDF text-fragment links even when no vault exists, falling back to the default PDF editor when the standalone PDF command is unavailable.
- [ ] Re-run dispatcher and navigation-history tests until green.

## Task 4: Generate and resolve PDF text selectors in the webview

- [ ] In `packages/vscode-extension/test/e2e/pdf-viewer.spec.ts`, add failing browser tests that a native selection message includes prefix/suffix context and that a `goToAnchor` message with a page-scoped text fragment flashes the intended text; add a miss case that still changes page.
- [ ] Run the focused Playwright tests and confirm they fail for the missing selector behavior.
- [ ] In both `packages/vscode-extension/webview-src/pdf-viewer.ts` and `packages/vscode-pdf-extension/webview-src/pdf-viewer.ts`, extend `PdfAnchor` with a `textFragment` selector and selection prefix/suffix fields.
- [ ] Derive bounded prefix/suffix context from `buildPdfSearchIndex` for native selections.
- [ ] Add page-local selector matching that supports start/end ranges and prefix/suffix disambiguation, returns `PdfSearchSegment[]`, and reuses transient anchor highlighting.
- [ ] Make `goToAnchor` load page text, resolve the selector, scroll to the matched highlight, and fall back to page navigation on a miss.
- [ ] Re-run focused Playwright tests until green.

## Task 5: Remove remaining LLM Wiki-specific PDF URL production

- [ ] Search literal `anchor=` and `chunk=` PDF URL production and test fixtures with `rg`; classify any remaining occurrence as internal annotation identity, obsolete compatibility code, or unrelated protocol.
- [ ] Remove obsolete URL producers and update agent-context/search outputs to portable URLs. Do not remove internal database row IDs used solely for annotation storage.
- [ ] Build `@llm-wiki/core`, `llm-wiki-vscode`, `llm-wiki-pdf`, and `llm-wiki-markdown` to catch shared contract drift.

## Task 6: Full verification

- [ ] Run the full core test suite.
- [ ] Run the full Node test suite for `packages/vscode-extension`.
- [ ] Run the complete PDF Playwright suite.
- [ ] Build the combined, standalone PDF, and standalone Markdown extensions.
- [ ] Inspect `git diff --check` and the scoped diff; confirm no unrelated user changes were overwritten.
- [ ] Record any remaining intentionally internal anchor-ID use in the final handoff.
