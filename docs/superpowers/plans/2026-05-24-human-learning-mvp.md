# Human Learning MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working Human Learning MVP with CLI, PDFium PDF editor, CodeMirror 6 markdown editor, embeddings, anchors, and bidirectional links.

**Architecture:** Keep `packages/core` as the canonical service layer over `.hl/index.sqlite`; expose it through `packages/cli`; adapt `paper-link` webview/editor patterns into `packages/vscode-extension` while using `hl://` links and the core database. Raw files and markdown remain the source of truth, while SQLite and embeddings are rebuildable indexes.

**Tech Stack:** TypeScript, pnpm workspaces, SQL.js, Commander, VS Code Extension API, EmbedPDF/PDFium, CodeMirror 6, Node built-in test runner.

---

### Task 1: Core Test Harness And Schema

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/core/src/db/schema.ts`
- Modify: `packages/core/src/db/connection.ts`
- Create: `packages/core/test/core.test.mjs`

- [ ] **Step 1: Write failing tests**

Create tests that initialize a temp vault, ingest notes, rebuild links, refresh embeddings, and assert search/backlinks/anchor/context behavior through core APIs.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @human-learning/core test`

Expected: fails because embedding, anchor, and context APIs are missing.

- [ ] **Step 3: Implement schema updates**

Add `metadata_json` to chunks and vector storage to `chunk_embeddings`, plus migration-safe column creation.

- [ ] **Step 4: Run tests to verify progress**

Run: `pnpm --filter @human-learning/core test`

Expected: still fails on missing APIs.

### Task 2: Core Anchors, Context, Embeddings, Search

**Files:**
- Create: `packages/core/src/anchors/pdf.ts`
- Create: `packages/core/src/context/export.ts`
- Create: `packages/core/src/embeddings/local.ts`
- Modify: `packages/core/src/search/search.ts`
- Modify: `packages/core/src/sources/chunks.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/core.test.mjs`

- [ ] **Step 1: Implement failing API tests**

Assert `createPdfAnchorFromQuote`, `resolveAnchor`, `exportSourceContext`, `refreshEmbeddings`, and semantic/hybrid search.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @human-learning/core test`

Expected: fails because APIs are not implemented.

- [ ] **Step 3: Implement APIs**

Implement deterministic hash-vector embeddings, quote-based PDF/text anchor creation, context export files, and search modes.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @human-learning/core test`

Expected: passes.

### Task 3: CLI Commands

**Files:**
- Create: `packages/cli/test/cli-smoke.test.mjs`
- Modify: `packages/cli/package.json`
- Create: `packages/cli/src/commands/anchor.ts`
- Create: `packages/cli/src/commands/context.ts`
- Create: `packages/cli/src/commands/embeddings.ts`
- Modify: `packages/cli/src/commands/search.ts`
- Modify: `packages/cli/src/main.ts`

- [ ] **Step 1: Write CLI smoke tests**

Use `node packages/cli/dist/main.js` in a temp vault and assert JSON output for init, ingest, embeddings refresh, hybrid search, links rebuild/check, anchor creation, and context export.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @human-learning/cli test`

Expected: fails because new commands are missing.

- [ ] **Step 3: Implement commands**

Add `hl anchor create-pdf|resolve`, `hl context export`, `hl embeddings refresh|status`, and support `search --mode semantic|hybrid`.

- [ ] **Step 4: Run CLI tests**

Run: `pnpm --filter @human-learning/cli test`

Expected: passes.

### Task 4: VS Code PDF And Markdown Editors

**Files:**
- Modify: `packages/vscode-extension/package.json`
- Modify: `packages/vscode-extension/webpack.config.js`
- Create: `packages/vscode-extension/src/pdfEditorProvider.ts`
- Create: `packages/vscode-extension/src/markdownEditorProvider.ts`
- Create: `packages/vscode-extension/webview-src/pdf-viewer.ts`
- Create: `packages/vscode-extension/webview-src/markdown-editor.ts`
- Create: `packages/vscode-extension/webview-src/extensions/hlLinks.ts`
- Create: `packages/vscode-extension/webview-src/vscode.d.ts`
- Modify: `packages/vscode-extension/src/extension.ts`
- Modify: `packages/vscode-extension/src/uriDispatcher.ts`

- [ ] **Step 1: Add dependencies and build test**

Install CodeMirror and EmbedPDF packages into the extension package.

- [ ] **Step 2: Implement PDF editor**

Adapt the reference PDFium webview pattern for `human-learning.pdfViewer`, persist anchors through core, and insert `hl://pdf/...` markdown links.

- [ ] **Step 3: Implement markdown editor**

Use CodeMirror 6 as a `CustomTextEditorProvider`; keep raw markdown as the document and render `hl://` links as widgets on inactive lines.

- [ ] **Step 4: Build extension**

Run: `pnpm --filter human-learning-vscode build`

Expected: webpack emits `extension.js`, `pdf-viewer.js`, `markdown-editor.js`, and `pdfium.wasm`.

### Task 5: Full Local Verification

**Files:**
- Modify as needed based on failures.

- [ ] **Step 1: Run all tests**

Run: `pnpm test`

Expected: all workspace tests pass.

- [ ] **Step 2: Build all packages**

Run: `pnpm build`

Expected: all packages build.

- [ ] **Step 3: Run demo vault smoke flow**

Run the CLI against a temp vault with markdown/code/text/PDF-like source and verify links, embeddings, and context files.

- [ ] **Step 4: Report final status**

Summarize implemented files, commands, verification, and any residual limitations.
