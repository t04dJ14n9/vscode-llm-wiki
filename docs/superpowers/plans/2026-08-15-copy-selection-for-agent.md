# Copy Selection for Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace provider-specific Markdown/PDF handoff with a cross-platform **Copy for Agent** action while retaining Cursor's existing direct **Add to Chat** path.

**Architecture:** Markdown copies a stable `@workspace/path.md#line[-line]` reference through the VS Code text clipboard API. PDF selection changes are validated by the extension host and correlated with a precomputed source context; the PDF webview then writes one rich `ClipboardItem` containing PNG, plain text, and sanitized HTML from the user's click handler. Multi-page PDF selections produce one vertically stitched, bounded PNG.

**Tech Stack:** TypeScript, VS Code extension API, PDFium-backed custom PDF webview, DOM Canvas API, Async Clipboard API, Node test runner, ESLint, TypeScript project references, webpack.

## Global Constraints

- Start from `main` at or after design commit `d0cd645f`; do not merge the superseded `codex/claude-sidebar-only-handoff` branch.
- Use only cross-platform VS Code and web-standard clipboard APIs; do not add OS-specific executables or shell commands.
- **Copy for Agent** must never create `selection.md`, `selection.json`, `selection.png`, anchor bridge files, or temporary editor tabs.
- **Copy for Agent** must never open, focus, create, or submit to Codex, Claude Code, CodeBuddy, or another provider.
- Cursor retains `llm-wiki.addSelectionToChat` and its `Cmd/Ctrl+L` shortcut.
- Stock VS Code exposes **Copy for Agent** but not **Add to Chat**.
- Markdown clipboard text is exactly `@workspace-relative/path.md#N` or `@workspace-relative/path.md#N-M`, with POSIX separators and no trailing whitespace.
- PDF rich clipboard data contains `image/png`, `text/plain`, and sanitized `text/html`.
- Multi-page PDF crops are vertically stitched in page order and respect the existing 1,600-pixel crop-edge and 5 MiB PNG limits.
- Rich-copy failure falls back to validated plain text and reports: `Selection text copied, but the image could not be copied.`
- Preserve Ask PDF and persisted annotation schemas as single-page.
- Every behavior change follows red-green-refactor TDD and receives an independent review before the next task.

---

### Task 1: Add provider-neutral clipboard formatting

**Files:**
- Create: `packages/vscode-extension/src/agentClipboard.ts`
- Create: `packages/vscode-extension/test/agentClipboard.test.mjs`

**Interfaces:**
- Consumes: `SelectionContext`, `llmWikiOpenAnchorUri(target: string)`.
- Produces:
  - `formatMarkdownAgentReference(relativePath: string, startLine: number, endLine: number): string`
  - `PdfAgentClipboardContext`
  - `createPdfAgentClipboardContext(input: PdfAgentClipboardContextInput): PdfAgentClipboardContext | undefined`
  - `pdfAgentClipboardSelectionKey(input: PdfAgentClipboardSelection): string | undefined`

- [ ] **Step 1: Write failing formatter and validation tests**

Create `agentClipboard.test.mjs` with table-driven tests equivalent to:

```javascript
test('formats exact Markdown agent references', () => {
  assert.equal(formatMarkdownAgentReference('notes/a.md', 7, 7), '@notes/a.md#7');
  assert.equal(formatMarkdownAgentReference('notes\\\\a.md', 7, 9), '@notes/a.md#7-9');
});

test('builds single- and multi-page PDF clipboard context', () => {
  const single = createPdfAgentClipboardContext({
    selectionKey: 'single-key',
    relativePath: 'raw/paper.pdf',
    startPage: 3,
    endPage: 3,
    selectedText: 'Exact passage',
    anchorUri: 'raw/paper.pdf#page=3',
  });
  assert.equal(single.sourceLabel, 'raw/paper.pdf (page 3)');
  assert.match(single.plainText, /^Source: \\[raw\\/paper\\.pdf \\(page 3\\)\\]/);

  const multiple = createPdfAgentClipboardContext({
    selectionKey: 'multi-key',
    relativePath: 'raw/paper.pdf',
    startPage: 3,
    endPage: 5,
    selectedText: 'Cross page passage',
    anchorUri: 'raw/paper.pdf#page=3',
  });
  assert.equal(multiple.sourceLabel, 'raw/paper.pdf (pages 3–5)');
});

test('rejects malformed clipboard inputs', () => {
  assert.equal(createPdfAgentClipboardContext({
    selectionKey: '',
    relativePath: '/absolute/paper.pdf',
    startPage: 5,
    endPage: 3,
    selectedText: '',
    anchorUri: 'raw/paper.pdf#page=5',
  }), undefined);
});
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
node --test packages/vscode-extension/test/agentClipboard.test.mjs
```

Expected: FAIL because `agentClipboard.ts` and its exports do not exist.

- [ ] **Step 3: Implement the minimal pure formatting module**

Define:

```typescript
export interface PdfAgentClipboardContextInput {
  selectionKey: string;
  relativePath: string;
  startPage: number;
  endPage: number;
  selectedText: string;
  anchorUri: string;
}

export interface PdfAgentClipboardContext {
  selectionKey: string;
  sourceLabel: string;
  sourceHref: string;
  selectedText: string;
  plainText: string;
}

export interface PdfAgentClipboardPageSelection {
  page: number;
  rects: ReadonlyArray<readonly [number, number, number, number]>;
}

export interface PdfAgentClipboardSelection {
  startPage: number;
  endPage: number;
  pages: readonly PdfAgentClipboardPageSelection[];
  selectedText: string;
}
```

Normalize Markdown paths with `.replaceAll('\\', '/')`; require nonempty
workspace-relative paths, positive safe integer lines/pages, ordered ranges,
nonempty bounded selected text, and a valid `llmWikiOpenAnchorUri`. Format PDF
plain text exactly as:

```text
Source: [<source label>](<<source href>>)

Selected text:
<selected text>
```

Use a stable JSON key over start page, end page, selected text, and normalized
per-page rectangles. Do not hash or encode a key in the webview independently.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
node --test packages/vscode-extension/test/agentClipboard.test.mjs
pnpm eslint packages/vscode-extension/src/agentClipboard.ts packages/vscode-extension/test/agentClipboard.test.mjs --max-warnings=0
```

Expected: all formatter tests pass with no lint warnings.

- [ ] **Step 5: Commit**

```bash
git add packages/vscode-extension/src/agentClipboard.ts packages/vscode-extension/test/agentClipboard.test.mjs
git commit -m "feat: format provider-neutral agent clipboard context"
```

---

### Task 2: Copy exact Markdown references without agent handoff

**Files:**
- Modify: `packages/vscode-extension/src/extension.ts`
- Modify: `packages/vscode-extension/src/markdownEditorProvider.ts`
- Modify: `packages/vscode-extension/webview-src/markdown-editor.ts`
- Modify: `packages/vscode-extension/test/extensionActivation.test.mjs`
- Modify: `packages/vscode-extension/test/markdownEditorInsertion.test.mjs`

**Interfaces:**
- Consumes: `formatMarkdownAgentReference`, existing `SelectionContext`, custom Markdown selection capture, document save and recapture.
- Produces:
  - command `llm-wiki.copySelectionForAgent`
  - webview message `{ type: 'copySelectionForAgent' }`
  - `copyMarkdownSelectionForAgent(selection?: SelectionContext): Promise<boolean>`

- [ ] **Step 1: Write failing command tests**

Add activation tests that assert:

```javascript
assert.equal(await commands.get('llm-wiki.copySelectionForAgent')(), true);
assert.deepEqual(clipboardWrites, ['@notes/source.md#12-14']);
assert.equal(exportCalls.length, 0);
assert.equal(handoffCalls.length, 0);
```

Add cases for a single line, dirty document save followed by recapture, untitled
Markdown, failed save, and empty selection. For failure cases, assert the
clipboard array is unchanged and the exact save/select warning is shown.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test --test-name-pattern "Copy for Agent|dirty Markdown copy|untitled Markdown copy" packages/vscode-extension/test/extensionActivation.test.mjs packages/vscode-extension/test/markdownEditorInsertion.test.mjs
```

Expected: FAIL because the command and webview message do not exist.

- [ ] **Step 3: Implement the host command**

Refactor the existing dirty-Markdown save/recapture logic into a helper used by
both Cursor handoff and clipboard copy. The clipboard path must end with:

```typescript
const reference = formatMarkdownAgentReference(
  vscode.workspace.asRelativePath(selection.uri),
  selection.startLine,
  selection.endLine,
);
await vscode.env.clipboard.writeText(reference);
vscode.window.showInformationMessage('Selection copied for agent.');
return true;
```

Do not call `addSelectionToContext`, `handoffSelectionToAgent`, or
`showTextDocument`.

- [ ] **Step 4: Wire the custom Markdown webview**

Replace provider-specific selection messages with:

```typescript
vscode.postMessage({ type: 'copySelectionForAgent' });
```

The context menu and floating selection toolbar contain **Copy for Agent**.
Keep **Add to Chat** only when `agentCapabilities.cursorAgent` is true. Do not
render buttons from `agentCapabilities.providers`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
node --test packages/vscode-extension/test/extensionActivation.test.mjs packages/vscode-extension/test/markdownEditorInsertion.test.mjs
pnpm eslint packages/vscode-extension/src/extension.ts packages/vscode-extension/src/markdownEditorProvider.ts packages/vscode-extension/webview-src/markdown-editor.ts --max-warnings=0
```

Expected: all Markdown copy and existing Cursor Add to Chat tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/vscode-extension/src/extension.ts packages/vscode-extension/src/markdownEditorProvider.ts packages/vscode-extension/webview-src/markdown-editor.ts packages/vscode-extension/test/extensionActivation.test.mjs packages/vscode-extension/test/markdownEditorInsertion.test.mjs
git commit -m "feat: copy Markdown ranges for agents"
```

---

### Task 3: Define correlated single- and multi-page PDF clipboard context

**Files:**
- Modify: `packages/vscode-extension/src/pdfEditorProvider.ts`
- Modify: `packages/pdf-editor/src/webview/pdf-viewer.ts`
- Modify: `packages/vscode-extension/test/pdfSelectionContext.test.mjs`
- Modify: `packages/vscode-extension/test/pdfSelectionDomain.test.mjs`

**Interfaces:**
- Consumes: `createPdfAgentClipboardContext`, `pdfAgentClipboardSelectionKey`, existing PDF caret selection and `selectionRectsForState`.
- Produces:
  - normalized shared `PdfAgentClipboardSelection`
  - host message `{ type: 'agentClipboardContext', context }`
  - webview cache keyed by `selectionKey`

- [ ] **Step 1: Write failing multi-page selection tests**

Assert that a selection from page 2 into page 4 produces:

```javascript
{
  startPage: 2,
  endPage: 4,
  pages: [
    { page: 2, rects: expectedStartRects },
    { page: 3, rects: expectedMiddleRects },
    { page: 4, rects: expectedEndRects },
  ],
  selectedText: 'complete normalized text across all pages',
}
```

Add a host test that fires `selectionChanged` and expects one
`agentClipboardContext` response whose key equals the current geometry. Change
the selection and assert the old key is rejected and never copied.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test --test-name-pattern "multi-page.*clipboard|correlates.*clipboard context|stale.*clipboard" packages/vscode-extension/test/pdfSelectionContext.test.mjs packages/vscode-extension/test/*.test.mjs
```

Expected: FAIL because cross-page anchors are currently reduced to
`multiPage: true`, rejected by the host normalizer, and have no correlated
clipboard context.

- [ ] **Step 3: Extend only the clipboard selection shape**

For cross-page `PdfSelectionState`, construct:

```typescript
const clipboardSelection: PdfAgentClipboardSelection = {
  startPage: start.page,
  endPage: end.page,
  pages,
  selectedText: text,
};
```

Loop from `start.page` through `end.page`, call
`selectionRectsForState(selection, page)`, and omit pages with no rectangles.
Keep the existing single-page `PdfSelectionAnchor` and persisted annotation
normalizer unchanged.

- [ ] **Step 4: Precompute host context on selection change**

When a valid selection arrives:

1. Normalize it through the clipboard-only validator.
2. Compute the stable key.
3. Build the source link through `createPdfAgentClipboardContext`.
4. Post `{ type: 'agentClipboardContext', context }` to the same webview.

When selection clears or validation fails, post
`{ type: 'agentClipboardContext' }` and clear the cache. The webview stores a
context only when its key equals the current selection key.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
node --test packages/vscode-extension/test/pdfSelectionContext.test.mjs packages/vscode-extension/test/pdfSelectionDomain.test.mjs
pnpm eslint packages/vscode-extension/src/pdfEditorProvider.ts packages/pdf-editor/src/webview/pdf-viewer.ts --max-warnings=0
```

Expected: single- and multi-page context correlation tests pass; Ask PDF
single-page tests remain unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/vscode-extension/src/pdfEditorProvider.ts packages/pdf-editor/src/webview/pdf-viewer.ts packages/vscode-extension/test/pdfSelectionContext.test.mjs packages/vscode-extension/test/pdfSelectionDomain.test.mjs
git commit -m "feat: correlate PDF clipboard selection context"
```

---

### Task 4: Build bounded single- and multi-page PDF crops

**Files:**
- Create: `packages/pdf-editor/src/webview/pdfAgentClipboard.ts`
- Create: `packages/vscode-extension/test/pdfAgentClipboard.test.mjs`
- Modify: `packages/pdf-editor/src/webview/pdfAskPanel.ts`

**Interfaces:**
- Consumes: page canvases, page dimensions, per-page selected rectangles.
- Produces:
  - `capturePdfAgentClipboardPng(input: PdfAgentClipboardCropInput): Promise<Blob | undefined>`
  - `stitchPdfSelectionCrops(crops: readonly PdfSelectionCrop[]): HTMLCanvasElement | undefined`

- [ ] **Step 1: Write failing crop tests**

Use the repository's existing fake canvas pattern to assert:

```javascript
const blob = await capturePdfAgentClipboardPng({
  pages: [
    { page: 2, canvas: page2, pageWidth: 612, pageHeight: 792, rects: page2Rects },
    { page: 3, canvas: page3, pageWidth: 612, pageHeight: 792, rects: page3Rects },
  ],
});
assert.equal(renderedPageOrder, '2,3');
assert.ok(outputWidth <= 1600);
assert.ok(outputHeight <= 1600);
assert.ok(blob.size <= 5 * 1024 * 1024);
```

Cover one page, page ordering, white gutters, iterative downscaling, malformed
geometry, a missing page canvas, and failure to obtain a 2D context.

- [ ] **Step 2: Run crop tests and verify RED**

Run:

```bash
node --test packages/vscode-extension/test/pdfAgentClipboard.test.mjs
```

Expected: FAIL because `pdfAgentClipboard.ts` does not exist.

- [ ] **Step 3: Extract reusable crop primitives**

Move the existing union-bound, padding, white-background, selection-outline,
and size-retry logic from `pdfAskPanel.ts` into named pure helpers without
changing Ask PDF output. Keep compatibility wrappers:

```typescript
export function capturePdfSelectionCrop(...): string | undefined;
export async function capturePdfAgentClipboardPng(...): Promise<Blob | undefined>;
```

For multiple pages, render individual bounded crops, scale them to a common
width, add a 12-pixel white gutter, and iteratively reduce the combined scale
until both edge and byte limits pass.

- [ ] **Step 4: Run crop and Ask PDF tests and verify GREEN**

Run:

```bash
node --test packages/vscode-extension/test/pdfAgentClipboard.test.mjs packages/vscode-extension/test/pdfDiscussion*.test.mjs
pnpm eslint packages/pdf-editor/src/webview/pdfAgentClipboard.ts packages/pdf-editor/src/webview/pdfAskPanel.ts --max-warnings=0
```

Expected: new crop tests and existing Ask PDF snapshot tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/pdf-editor/src/webview/pdfAgentClipboard.ts packages/pdf-editor/src/webview/pdfAskPanel.ts packages/vscode-extension/test/pdfAgentClipboard.test.mjs
git commit -m "feat: stitch multi-page PDF selection crops"
```

---

### Task 5: Write the cross-platform rich PDF clipboard item

**Files:**
- Modify: `packages/pdf-editor/src/webview/pdfAgentClipboard.ts`
- Modify: `packages/pdf-editor/src/webview/pdf-viewer.ts`
- Modify: `packages/vscode-extension/src/pdfEditorProvider.ts`
- Modify: `packages/vscode-extension/test/pdfAgentClipboard.test.mjs`
- Modify: `packages/vscode-extension/test/pdfSelectionContext.test.mjs`

**Interfaces:**
- Consumes: correlated `PdfAgentClipboardContext`, bounded PNG `Blob`, webview `navigator.clipboard`, host text fallback.
- Produces:
  - `writePdfAgentClipboard(input: PdfAgentClipboardWriteInput, clipboard?: Clipboard): Promise<'rich' | 'text-fallback'>`
  - webview message `{ type: 'agentClipboardResult', status, plainText? }`

- [ ] **Step 1: Write failing rich clipboard tests**

Inject fake `Clipboard`, `ClipboardItem`, and host messenger objects. Assert one
write receives one item exposing:

```javascript
assert.deepEqual(item.types.sort(), ['image/png', 'text/html', 'text/plain']);
assert.equal(await (await item.getType('text/plain')).text(), expectedPlainText);
assert.match(await (await item.getType('text/html')).text(), /<a href="cursor:/);
assert.doesNotMatch(await (await item.getType('text/html')).text(), /<script|onerror=/i);
```

Reject `clipboard.write`, then assert one host fallback message contains only
the already validated `plainText` and no PNG bytes or HTML.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test --test-name-pattern "rich PDF clipboard|clipboard text fallback|sanitizes clipboard HTML" packages/vscode-extension/test/pdfAgentClipboard.test.mjs packages/vscode-extension/test/pdfSelectionContext.test.mjs
```

Expected: FAIL because no rich clipboard writer or fallback message exists.

- [ ] **Step 3: Implement the rich writer**

Create escaped HTML:

```html
<p><strong>Source:</strong> <a href="...">...</a></p>
<p><strong>Selected text:</strong></p>
<blockquote>...</blockquote>
<img src="data:image/png;base64,..." alt="Selected PDF region">
```

Then perform exactly one user-gesture-bound write:

```typescript
await clipboard.write([
  new ClipboardItem({
    'image/png': pngBlob,
    'text/plain': new Blob([context.plainText], { type: 'text/plain' }),
    'text/html': new Blob([html], { type: 'text/html' }),
  }),
]);
```

Do not call the host before this write. If it rejects, post a typed fallback
message containing the current selection key and plain text.

- [ ] **Step 4: Implement and validate host fallback**

The host accepts fallback only when the key equals its current cached context
and the text exactly equals the precomputed `plainText`. It then calls
`vscode.env.clipboard.writeText`, shows
`Selection text copied, but the image could not be copied.`, and reports
fallback success. Any mismatch fails closed.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
node --test packages/vscode-extension/test/pdfAgentClipboard.test.mjs packages/vscode-extension/test/pdfSelectionContext.test.mjs
pnpm eslint packages/pdf-editor/src/webview/pdfAgentClipboard.ts packages/pdf-editor/src/webview/pdf-viewer.ts packages/vscode-extension/src/pdfEditorProvider.ts --max-warnings=0
```

Expected: rich copy, HTML escaping, stale fallback, and text-only fallback tests
pass.

- [ ] **Step 6: Commit**

```bash
git add packages/pdf-editor/src/webview/pdfAgentClipboard.ts packages/pdf-editor/src/webview/pdf-viewer.ts packages/vscode-extension/src/pdfEditorProvider.ts packages/vscode-extension/test/pdfAgentClipboard.test.mjs packages/vscode-extension/test/pdfSelectionContext.test.mjs
git commit -m "feat: copy rich PDF context for agents"
```

---

### Task 6: Replace provider-specific Markdown/PDF UI and command contributions

**Files:**
- Modify: `packages/vscode-extension/package.json`
- Modify: `packages/vscode-extension/src/extension.ts`
- Modify: `packages/vscode-extension/src/pdfEditorProvider.ts`
- Modify: `packages/vscode-extension/webview-src/markdown-editor.ts`
- Modify: `packages/pdf-editor/src/webview/pdf-viewer.ts`
- Modify: `packages/vscode-extension/test/buildArtifacts.test.mjs`
- Modify: `packages/vscode-extension/test/extensionActivation.test.mjs`
- Modify: `packages/vscode-extension/test/pdfSelectionContext.test.mjs`
- Modify: `packages/vscode-extension/test/agentHandoff.test.mjs`

**Interfaces:**
- Consumes: `llm-wiki.copySelectionForAgent`, existing Cursor capability and `llm-wiki.addSelectionToChat`.
- Produces: final Cursor/VS Code action visibility with no provider-specific selection controls.

- [ ] **Step 1: Write failing manifest and UI tests**

Assert:

```javascript
assert.equal(commandTitle('llm-wiki.copySelectionForAgent'), 'LLM Wiki: Copy for Agent');
assert.equal(hasCommand('llm-wiki.addSelectionToContext'), false);
assert.equal(copyForAgentWhen.includes('llmWikiHostIsCursor'), false);
assert.equal(addToChatWhen.includes('llmWikiHostIsCursor'), true);
```

For Markdown and PDF webview markup, assert Cursor capability renders
**Add to Chat** and **Copy for Agent**, stock VS Code renders only **Copy for
Agent**, and provider arrays never render Send buttons.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test --test-name-pattern "Copy for Agent|provider-specific.*absent|Add to Chat.*Cursor" packages/vscode-extension/test/buildArtifacts.test.mjs packages/vscode-extension/test/extensionActivation.test.mjs packages/vscode-extension/test/pdfSelectionContext.test.mjs
```

Expected: FAIL because the manifest and webviews still expose the provider
picker and provider-specific actions.

- [ ] **Step 3: Replace command and menu contributions**

Replace visible `llm-wiki.addSelectionToContext` contributions with:

```json
{
  "command": "llm-wiki.copySelectionForAgent",
  "title": "LLM Wiki: Copy for Agent",
  "icon": "$(copy)"
}
```

Show it for selected native/custom Markdown and selected PDF in both hosts.
Keep `llm-wiki.addSelectionToChat` guarded by `llmWikiHostIsCursor`.

- [ ] **Step 4: Remove provider-specific selection routing**

Remove `sendToAgent`, explicit provider buttons, provider picker calls, and
`ADD_SELECTION_TO_AGENT_COMMAND` from Markdown/PDF selection paths. Do not
delete durable export helpers or Cursor Browser paths that remain in scope.
Retain `agentHandoff.ts` only where still required by Cursor direct or unrelated
legacy paths; no Copy for Agent caller may import or invoke it.

- [ ] **Step 5: Run affected suites and verify GREEN**

Run:

```bash
node --test packages/vscode-extension/test/buildArtifacts.test.mjs packages/vscode-extension/test/extensionActivation.test.mjs packages/vscode-extension/test/pdfSelectionContext.test.mjs packages/vscode-extension/test/agentHandoff.test.mjs
pnpm lint
pnpm typecheck
```

Expected: all affected suites, lint, and typecheck pass.

- [ ] **Step 6: Commit**

```bash
git add packages/vscode-extension/package.json packages/vscode-extension/src/extension.ts packages/vscode-extension/src/pdfEditorProvider.ts packages/vscode-extension/webview-src/markdown-editor.ts packages/pdf-editor/src/webview/pdf-viewer.ts packages/vscode-extension/test/buildArtifacts.test.mjs packages/vscode-extension/test/extensionActivation.test.mjs packages/vscode-extension/test/pdfSelectionContext.test.mjs packages/vscode-extension/test/agentHandoff.test.mjs
git commit -m "feat: replace provider handoff with copy for agent"
```

---

### Task 7: Full verification and live clipboard validation

**Files:**
- Modify if required by verified findings only: files from Tasks 1–6
- Update: `.superpowers/sdd/2026-08-15-copy-selection-for-agent/progress.md` (ignored evidence ledger)

**Interfaces:**
- Consumes: completed implementation and Extension Development Host.
- Produces: final automated and live evidence.

- [ ] **Step 1: Run the complete repository verification**

Run:

```bash
pnpm test
pnpm lint
pnpm typecheck
git diff --check
```

Expected: every package test passes with zero failures or warnings.

- [ ] **Step 2: Build and load the Extension Development Host**

Run the extension build, reload the existing Cursor Extension Development Host,
and open `demo-vault` without changing the user's source vault content.

- [ ] **Step 3: Validate Markdown clipboard behavior**

In Cursor:

1. Select one line and use **Copy for Agent**.
2. Paste into Cursor, Codex, and Claude drafts; do not submit.
3. Confirm exact `@path.md#N`, no export files, and no panel flash.
4. Repeat for multiple lines and confirm `@path.md#N-M`.
5. Confirm **Add to Chat** and `Cmd+L` still work independently.

- [ ] **Step 4: Validate single-page PDF rich clipboard behavior**

Select a region on one page, use **Copy for Agent**, and paste into Cursor,
Codex, and Claude drafts. Confirm each receives an image attachment plus
selected text and the clickable product deep link. Confirm no export files or
agent sessions are created.

- [ ] **Step 5: Validate multi-page and fallback behavior**

Select across at least two pages and confirm one stitched PNG in page order,
complete text, and a `pages N–M` source label. Exercise or simulate rejected
rich clipboard access and confirm text-only fallback plus the exact warning.

- [ ] **Step 6: Validate stock VS Code visibility**

Open the fixture in stock VS Code and confirm **Copy for Agent** is present
while **Add to Chat** and provider-specific Send actions are absent.

- [ ] **Step 7: Request final whole-branch review**

Review the full diff from `d0cd645f` through HEAD for:

- clipboard permission and stale-selection races;
- HTML injection and oversized payloads;
- multi-page crop bounds and page ordering;
- accidental export writes or provider invocations;
- Cursor/VS Code visibility regressions;
- test adequacy.

Resolve every Critical or Important finding with a failing regression test,
minimal fix, focused verification, and commit.

- [ ] **Step 8: Re-run final verification and record evidence**

Run:

```bash
pnpm test
pnpm lint
pnpm typecheck
git diff --check
git status --short
```

Expected: all checks pass and the implementation worktree is clean.
