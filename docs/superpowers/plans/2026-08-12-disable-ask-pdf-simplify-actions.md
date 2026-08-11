# Disable Ask PDF and Simplify PDF Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every active Ask PDF and obsolete PDF selection surface, make all Markdown carets follow the VS Code editor theme, and replace stale local demo-vault agent rules with the current provider-neutral handoff contract.

**Architecture:** Ask PDF is disabled at extension composition: production activation creates no Codex client/controller and passes no discussion capability to the PDF provider. The preserved Ask modules remain directly testable through an explicit test-only fixture capability. PDF text-selection messages are narrowed to the live Copy Link, Add to Chat, and rectangle-embed actions; caret colors use VS Code theme variables with an editor-foreground fallback.

**Tech Stack:** TypeScript, VS Code Extension API, CodeMirror 6, PDF webview, Node test runner, Playwright, pnpm.

## Global Constraints

- Keep `packages/vscode-extension/src/codexAppServerClient.ts`, PDF discussion controller/protocol/store modules, and existing `.hl/annotations/pdf` data.
- Do not start Codex, show Ask PDF UI, or handle legacy Ask messages in a production activation.
- The visible PDF text-selection toolbar contains only **Copy Link** and **Add to Chat** when handoff is available.
- Keep rectangle embed copying and ordinary selected-text copying.
- Add to Chat remains provider-neutral, prepares a draft, includes the generated Source link and optional screenshot, and never submits.
- Every Markdown caret uses `var(--vscode-editorCursor-foreground, var(--vscode-editor-foreground))`.
- Do not edit raw source material under `demo-vault/raw/`.
- Do not change `.gitignore` or force-add the ignored `demo-vault/` directory.

---

### Task 1: Stop Ask PDF composition and manifest exposure

**Files:**
- Modify: `packages/vscode-extension/src/extension.ts`
- Modify: `packages/vscode-extension/package.json`
- Modify: `packages/vscode-extension/test/extensionActivation.test.mjs`
- Modify: `packages/vscode-extension/test/pdfDiscussionHostIntegration.test.mjs`

**Interfaces:**
- Consumes: existing `PdfEditorProviderOptions.discussionController?: PdfDiscussionController`.
- Produces: production `PdfEditorProvider` construction with `discussionController === undefined`; no `human-learning.pdfAskSelection` command/configuration.

- [ ] **Step 1: Replace positive Ask PDF activation assertions with failing absence assertions**

In `extensionActivation.test.mjs`, replace the dedicated Codex-output/startup and trusted/untrusted Ask-command tests with one activation-boundary test that records constructor/configuration/output-channel calls:

```js
test('production activation leaves Ask PDF and Codex uncomposed', () => {
  assert.equal(codexClientCount, 0);
  assert.equal(discussionControllerCount, 0);
  assert.equal(outputChannels.length, 0);
  assert.equal(configurationSections.includes('humanLearning.agent'), false);
  assert.equal(vscode.__registeredCommands['human-learning.pdfAskSelection'], undefined);
  assert.equal(providerOptions[0].discussionController, undefined);
});
```

In `pdfDiscussionHostIntegration.test.mjs`, invert the manifest test:

```js
assert.equal(
  manifest.contributes.commands.some(item => item.command === 'human-learning.pdfAskSelection'),
  false,
);
assert.equal(
  manifest.contributes.configuration?.properties?.['humanLearning.agent.codexCommand'],
  undefined,
);
assert.doesNotMatch(JSON.stringify(manifest.capabilities), /Ask PDF/);
```

- [ ] **Step 2: Run focused Node tests and verify RED**

Run:

```bash
pnpm --filter human-learning-vscode build
node --test --test-name-pattern="production activation leaves Ask PDF|manifest" packages/vscode-extension/test/extensionActivation.test.mjs packages/vscode-extension/test/pdfDiscussionHostIntegration.test.mjs
```

Expected: FAIL because activation constructs Codex services and registers `pdfAskSelection`, and the manifest still contributes Ask PDF/configuration.

- [ ] **Step 3: Remove the active Ask PDF composition**

In `extension.ts`:

- Remove active imports and globals for `CodexAppServerClient`, `PdfDiscussionController`, `PDF_DISCUSSION_WORKSPACE_TRUST_MESSAGE`, the Codex output channel, and controller/client instances.
- Remove `initializeCodex(context)` and its activation call.
- Remove `discussionController: pdfDiscussionController` and `markdownInsertTarget: markdownEditorProvider` from `PdfEditorProvider` construction.
- Remove `human-learning.pdfAskSelection` registration and `requireWorkspaceTrust()`.
- Remove Ask-owned deactivation disposal.
- Add exactly one intentional marker at the provider-composition boundary:

```ts
// TODO(ask-pdf): Re-enable after the provider-neutral “More detail” workflow and backend policy are specified.
```

In `package.json`:

- Remove `human-learning.pdfAskSelection`.
- Change limited-workspace copy so it describes only the capabilities that remain.
- Remove `restrictedConfigurations: ["humanLearning.agent.codexCommand"]`.
- Remove the `humanLearning.agent.codexCommand` configuration property.

- [ ] **Step 4: Run focused Node tests and verify GREEN**

Run the same command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit the composition boundary**

```bash
git add packages/vscode-extension/src/extension.ts packages/vscode-extension/package.json packages/vscode-extension/test/extensionActivation.test.mjs packages/vscode-extension/test/pdfDiscussionHostIntegration.test.mjs
git commit -m "fix: leave Ask PDF uncomposed"
```

---

### Task 2: Hide dormant Ask UI and remove obsolete PDF selection actions

**Files:**
- Modify: `packages/pdf-editor/src/webview/pdf-viewer.ts`
- Modify: `packages/vscode-extension/src/pdfEditorProvider.ts`
- Modify: `packages/vscode-extension/test/e2e/pdf-viewer.html`
- Modify: `packages/vscode-extension/test/e2e/pdf-viewer.spec.ts`
- Modify: `packages/vscode-extension/test/e2e/ask-pdf.spec.ts`
- Modify: `packages/vscode-extension/test/pdfSelectionContext.test.mjs`
- Modify: `packages/vscode-extension/test/markdownEditorInsertion.test.mjs`
- Modify: `packages/vscode-extension/test/pdfDiscussionHostIntegration.test.mjs`
- Modify: `packages/vscode-extension/test/buildArtifacts.test.mjs`

**Interfaces:**
- Consumes: optional `PdfEditorProviderOptions.discussionController`.
- Produces: `PdfTextSelectionAction = 'addToCursorChat' | 'copyLink'` in the webview and `PdfSelectionAction = 'addToCursorChat' | 'copyLink' | 'copyRectEmbed'` in the host.
- Produces: test-only `window.__humanLearningAskPdfEnabled === true` support; production emits `false`.

- [ ] **Step 1: Write failing product-surface and protocol tests**

In `pdf-viewer.spec.ts`, add a production-default surface test:

```ts
await openPdf(page);
await selectText(page, 'FlashAttention uses tiling');
await expect(page.locator('#selection-toolbar button')).toHaveText([
  'Copy Link',
  /Add to Chat/,
]);
for (const label of [
  'Ask about selection…',
  'Insert Link',
  'Copy Quote and Link',
  'Insert Quote and Link',
  'More',
]) {
  await expect(page.getByText(label, { exact: true })).toHaveCount(0);
}
await expect(page.getByRole('button', { name: 'Copy link format' })).toHaveCount(0);
await expect(page.getByRole('button', { name: 'Copy embed link to rectangular selection' }))
  .toBeVisible();
await page.evaluate(() => window.postMessage({
  type: 'pdfDiscussionSnapshot',
  annotations: [],
  consentGranted: true,
}, '*'));
await expect(page.locator('.ask-pdf-panel, .pdf-discussion-marker')).toHaveCount(0);
```

Open the right-click menu and assert its exact retained labels:

```ts
expect(await menu.getByRole('menuitem').allTextContents()).toEqual([
  'Look up ...',
  expect.stringMatching(/Add to Chat/),
  'Copy link to selection',
  'Copy selected text',
]);
```

In `pdfSelectionContext.test.mjs`, add rejection assertions for removed message values:

```js
for (const action of ['insertLink', 'copyQuoteAndLink', 'insertQuoteAndLink']) {
  await provider.handleSelectionAction(pdfUri, action, selection);
}
assert.deepEqual(clipboardWrites, []);
assert.deepEqual(commandCalls, []);
```

In `pdfDiscussionHostIntegration.test.mjs`, construct a provider without a controller, deliver `pdfDiscussionList` and `pdfDiscussionSubmit`, then assert no store construction, controller call, write, or outbound discussion message.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm --filter human-learning-vscode build
node --test --test-name-pattern="removed selection|without a controller|PDF copy" packages/vscode-extension/test/pdfSelectionContext.test.mjs packages/vscode-extension/test/pdfDiscussionHostIntegration.test.mjs
pnpm exec playwright test packages/vscode-extension/test/e2e/pdf-viewer.spec.ts -g "selection actions|Ask PDF"
```

Expected: FAIL because Ask/quote/insert controls and protocol values still exist.

- [ ] **Step 3: Gate the preserved Ask panel behind the dormant capability**

In `pdf-viewer.ts`, define:

```ts
const askPdfEnabled =
  (window as typeof window & { __humanLearningAskPdfEnabled?: unknown })
    .__humanLearningAskPdfEnabled === true;
```

Make `askPanel` optional, construct it only when `askPdfEnabled`, guard Ask host messages/markers, and include “Ask about selection…” only in the test-enabled context menu. A disabled viewer must ignore discussion snapshots without creating styles, panel nodes, markers, or outbound discussion messages.

In `pdfEditorProvider.ts`:

- Ignore `isPdfDiscussionMessage(message)` when `discussionController` is absent.
- Emit `window.__humanLearningAskPdfEnabled = ${this.discussionController !== undefined};` in generated HTML.

In `pdf-viewer.html`, set the test capability from the query string:

```js
window.__humanLearningAskPdfEnabled =
  new URLSearchParams(window.location.search).get('askPdf') === '1';
```

In `ask-pdf.spec.ts`, use `?askPdf=1` in `openPdf()` so dormant component/controller coverage remains explicit and isolated.

- [ ] **Step 4: Remove obsolete selection actions and UI**

In `pdf-viewer.ts`:

- Narrow `PdfTextSelectionAction`.
- Delete `copyLinkFormat` state and setup.
- Make the floating toolbar always add **Copy Link**, then optional **Add to Chat**.
- Delete Insert Link, More, its nested menu, and both quote actions.
- Remove quote/insert items from the context menu.

In `pdfEditorProvider.ts`:

- Narrow `PdfSelectionAction` and `isPdfSelectionAction`.
- Keep Add to Chat, Copy Link, and Copy Rect Embed branches.
- Delete `MarkdownInsertTarget`, option/property/constructor plumbing, quote formatting, insertion fallback, and removed notifications.
- Delete copy-format trigger/menu markup and selection-menu CSS from generated HTML.

Mirror HTML/CSS removals in `pdf-viewer.html`.

Delete obsolete PDF-insertion/quote tests from `markdownEditorInsertion.test.mjs`, and rewrite existing fuzz/action matrices in `pdf-viewer.spec.ts` to exercise only live actions.

Change `buildArtifacts.test.mjs` to assert the production PDF bundle and generated host HTML omit the removed selection actions:

```js
for (const removed of [
  'Insert Quote and Link',
  'Copy Quote and Link',
  'Insert Link',
  'copy-link-format',
]) {
  assert.equal(bundle.includes(removed), false);
}
```

The dormant Ask panel remains imported behind its explicit test capability, so its protocol strings may remain in the bundle. Do not delete those source modules or their isolated tests.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
pnpm --filter human-learning-vscode build
node --test packages/vscode-extension/test/pdfSelectionContext.test.mjs packages/vscode-extension/test/pdfDiscussionHostIntegration.test.mjs packages/vscode-extension/test/markdownEditorInsertion.test.mjs packages/vscode-extension/test/buildArtifacts.test.mjs
pnpm exec playwright test packages/vscode-extension/test/e2e/pdf-viewer.spec.ts packages/vscode-extension/test/e2e/ask-pdf.spec.ts
```

Expected: PASS; default product tests see no Ask/obsolete buttons, while explicit `askPdf=1` tests preserve dormant panel coverage.

- [ ] **Step 6: Commit PDF surface cleanup**

```bash
git add packages/pdf-editor/src/webview/pdf-viewer.ts packages/vscode-extension/src/pdfEditorProvider.ts packages/vscode-extension/test/e2e/pdf-viewer.html packages/vscode-extension/test/e2e/pdf-viewer.spec.ts packages/vscode-extension/test/e2e/ask-pdf.spec.ts packages/vscode-extension/test/pdfSelectionContext.test.mjs packages/vscode-extension/test/markdownEditorInsertion.test.mjs packages/vscode-extension/test/pdfDiscussionHostIntegration.test.mjs packages/vscode-extension/test/buildArtifacts.test.mjs
git commit -m "fix: simplify PDF selection actions"
```

---

### Task 3: Make every Markdown caret follow the VS Code theme

**Files:**
- Modify: `packages/vscode-extension/webview-src/markdown-editor.ts`
- Modify: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts`

**Interfaces:**
- Consumes: VS Code webview variables `--vscode-editorCursor-foreground` and `--vscode-editor-foreground`.
- Produces: identical theme-derived color for CodeMirror cursor/drop cursor, native editor caret, Vim input, and search input.

- [ ] **Step 1: Add failing computed-style tests for token and fallback behavior**

Add a helper in `markdown-editor.spec.ts` that sets theme variables, opens the search panel, enables Vim and opens its command panel, appends a synthetic `.cm-dropCursor`, and returns:

```ts
{
  editorCaret: getComputedStyle(document.querySelector('.cm-editor')!).caretColor,
  cursor: getComputedStyle(document.querySelector('.cm-cursor')!).borderLeftColor,
  dropCursor: getComputedStyle(document.querySelector('.cm-dropCursor')!).borderLeftColor,
  searchCaret: getComputedStyle(document.querySelector('.cm-search input[name="search"]')!).caretColor,
  vimCaret: getComputedStyle(document.querySelector('.cm-vim-panel input')!).caretColor,
}
```

Capture the search-input color immediately after `Meta+F`/`Control+F`, close that panel, then send `setVimMode`, press `Escape`, press `:`, and capture the Vim input. The two panels do not need to coexist.

Test the explicit token:

```ts
expect(colors).toEqual({
  editorCaret: 'rgb(18, 52, 86)',
  cursor: 'rgb(18, 52, 86)',
  dropCursor: 'rgb(18, 52, 86)',
  searchCaret: 'rgb(18, 52, 86)',
  vimCaret: 'rgb(18, 52, 86)',
});
```

Then set `--vscode-editorCursor-foreground: initial`, `--vscode-editor-foreground: #654321`, and local element colors to `#abcdef`; assert every returned color is `rgb(101, 67, 33)`.

- [ ] **Step 2: Run focused Playwright tests and verify RED**

Run:

```bash
pnpm --filter human-learning-vscode build
pnpm exec playwright test packages/vscode-extension/test/e2e/markdown-editor.spec.ts -g "caret surfaces"
```

Expected: FAIL because current fallbacks use `currentColor` and the search input has no caret rule.

- [ ] **Step 3: Apply the exact theme-derived caret value**

In `markdown-editor.ts`, use this exact value in the editor root, cursor/drop cursor, Vim input, and search input:

```ts
const editorCaret = 'var(--vscode-editorCursor-foreground, var(--vscode-editor-foreground))';
```

Reference `editorCaret` from:

```ts
'&': { caretColor: editorCaret },
'.cm-cursor, .cm-dropCursor': { borderLeftColor: editorCaret },
'.cm-panel.cm-vim-panel input': { caretColor: editorCaret },
'.cm-search input': { caretColor: editorCaret },
```

- [ ] **Step 4: Run focused Playwright tests and verify GREEN**

Run the same command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit caret theming**

```bash
git add packages/vscode-extension/webview-src/markdown-editor.ts packages/vscode-extension/test/e2e/markdown-editor.spec.ts
git commit -m "fix: follow editor theme for markdown carets"
```

---

### Task 4: Replace stale local demo-vault rules

**Files:**
- Modify locally (ignored): `demo-vault/AGENTS.md`
- Modify locally (ignored): `demo-vault/CLAUDE.md`
- Modify locally (ignored): `demo-vault/.agents/skills/human-learning/SKILL.md`
- Modify locally (ignored): `demo-vault/.claude/commands/hl-explain-selection.md`

**Interfaces:**
- Consumes: `.hl/agent/selection.md`, optional `.hl/agent/selection.png`, and immutable `.hl/agent/exports/<id>/...hlanchor` Source links.
- Produces: synchronized provider-neutral agent instructions.

- [ ] **Step 1: Replace AGENTS and CLAUDE with the synchronized current contract**

Both files must state:

- Human Learning custom Markdown/PDF editors and outline panels.
- Vim starts in normal mode when enabled.
- Editor text, links, and caret follow the active VS Code theme.
- Add to Chat targets a compatible supported agent, prepares a draft, and never submits.
- Read `.hl/agent/selection.md` for the current handoff.
- Treat `.hl/agent/selection.png` as optional visual evidence.
- Reuse the exact Markdown link on the `**Source**:` line verbatim.
- Never invent/rewrite a PDF URL or `.hlanchor` identifier.
- `.hlanchor` is a generated bridge artifact.
- Do not edit `raw/` unless explicitly asked.

Remove “Add to Cursor Chat” and direct `raw/pdf/...#page=...:~:text=...` construction guidance.

- [ ] **Step 2: Update the agent skill and Claude command**

Make `.agents/skills/human-learning/SKILL.md` provider-neutral and apply the same exact-Source-link contract.

Set `.claude/commands/hl-explain-selection.md` to instruct Claude to read the current handoff and optional image, explain the selection, reuse the exact Source link verbatim, and never construct/rewrite a PDF URL or `.hlanchor` identifier.

- [ ] **Step 3: Verify the ignored local rules directly**

Run:

```bash
cmp demo-vault/AGENTS.md demo-vault/CLAUDE.md
rg -n "Add to Cursor Chat|raw/pdf/.+#page=.*text=" demo-vault/AGENTS.md demo-vault/CLAUDE.md demo-vault/.agents/skills/human-learning/SKILL.md
rg -n "Add to Chat|selection\\.md|selection\\.png|exact.*Source|\\.hlanchor|normal mode|theme" demo-vault/AGENTS.md demo-vault/CLAUDE.md demo-vault/.agents/skills/human-learning/SKILL.md demo-vault/.claude/commands/hl-explain-selection.md
```

Expected: `cmp` exits 0; the stale-pattern search returns no matches; the current-contract search finds all required concepts.

Do not stage these ignored local-vault files and do not alter `.gitignore`.

---

### Task 5: Full completion and live-runtime verification

**Files:**
- Verify: all files changed in Tasks 1–4.
- Verify unchanged: `demo-vault/.hl/annotations/pdf/**`.

**Interfaces:**
- Consumes: production extension bundle and Extension Development Host.
- Produces: evidence that the requested end state exists in source, tests, bundle, and live UI.

- [ ] **Step 1: Run static and unit verification**

```bash
pnpm check
git diff --check
```

Expected: lint, typecheck, core tests, extension Node tests, and whitespace checks all pass.

- [ ] **Step 2: Run the complete Playwright suite**

```bash
pnpm exec playwright test
```

Expected: all non-skipped tests pass. If an unrelated known flaky test fails, rerun that exact test at least three times and record both the full-suite and focused evidence; do not call the requested feature complete if any task-specific test fails.

- [ ] **Step 3: Audit source and data invariants**

```bash
rg -n "human-learning\\.pdfAskSelection|Insert Quote and Link|Copy Quote and Link|Insert Link|>More<|copy-link-format" packages/pdf-editor/src packages/vscode-extension/src packages/vscode-extension/package.json
git diff -- demo-vault/.hl/annotations/pdf
```

Expected: no active production UI/command matches; no annotation data diff.

- [ ] **Step 4: Reload and inspect the Extension Development Host**

Verify in Cursor:

1. PDF toolbar has no Ask PDF/history or Copy Link Format button.
2. Selecting PDF text shows only Copy Link and Add to Chat.
3. Right-click has no Ask/insert/quote actions.
4. Add to Chat prepares text, exact Source link, and optional screenshot without submitting.
5. Markdown caret visually matches the built-in editor under the same theme.
6. Changing to a contrasting theme updates the Markdown cursor without reconfiguration.

- [ ] **Step 5: Final review and integration commit if needed**

Review `git status --short`, `git log --oneline -5`, and the implementation diff. Commit any verification-driven tracked fix with a scoped message. Leave ignored demo-vault rule edits in place locally.

---

### Task 6: Verify external agent-extension Add to Chat compatibility

**Files:**
- Verify: `packages/vscode-extension/src/agentHandoff.ts`
- Verify: `packages/vscode-extension/test/agentHandoff.test.mjs`
- Verify installed manifests under the Cursor and VS Code extension directories.
- Create ignored evidence under this plan's `.superpowers/sdd/` workspace.

**Interfaces:**
- Consumes: `chatgpt.addFileToThread`, `claude-vscode.insertAtMention`, and `tencentcloud.codingcopilot.addToChat`.
- Produces: a provider/host compatibility matrix for Cursor and VS Code without using Cursor's built-in Agent composer.

- [ ] **Step 1: Verify installed extension identities and command contracts**

For both Cursor and VS Code extension directories, record the installed extension ID, version, and manifest contribution for:

```text
openai.chatgpt                    chatgpt.addFileToThread
Anthropic.claude-code             claude-vscode.insertAtMention
Tencent-Cloud.coding-copilot      tencentcloud.codingcopilot.addToChat
```

If an extension is not installed, record `SKIPPED: not installed` for that host/provider pair.

- [ ] **Step 2: Run the complete handoff test suite**

```bash
pnpm --filter human-learning-vscode build
node --test packages/vscode-extension/test/agentHandoff.test.mjs
```

Expected: all routing, extension-ID filtering, attachment-shape, visible-editor preference, fallback-command, and no-submit tests pass.

- [ ] **Step 3: Launch isolated Cursor and VS Code hosts**

Launch each application with:

- A unique temporary user-data directory.
- Its normal external-extension directory.
- A unique explicit remote-debugging port.
- `--extensionDevelopmentPath=/Users/t04dj14n9/Code/human-learning/packages/vscode-extension`.
- `/Users/t04dj14n9/Code/human-learning/demo-vault`.

Record exact argv, PID/start time, CDP target list, active extension versions, and current Human Learning bundle hashes.

- [ ] **Step 4: Exercise Add to Chat without the Cursor built-in Agent**

For each available pair in this matrix:

| Host | Codex | Claude Code | CodeBuddy |
|---|---|---|---|
| Cursor | verify | verify | verify |
| VS Code | verify | verify | verify |

Select a PDF passage, invoke Human Learning Add to Chat, choose or focus the named external agent, and verify:

- The external extension's command is selected instead of Cursor Agent.
- `selection.md` reaches the draft/context.
- The optional `selection.png` is forwarded where that provider command accepts attachments.
- No message is submitted automatically.

If authentication, onboarding, or an unavailable UI prevents a live draft inspection, record `SKIPPED` with the exact command/extension presence evidence and blocker, as explicitly permitted by the user. A registered command that throws or receives the wrong arguments is a product failure, not a skip.

- [ ] **Step 5: Preserve and review the compatibility matrix**

Store timestamped logs, screenshots/state JSON, command observations, export hashes, and SHA-256 manifests in the ignored SDD workspace. Restore/close only isolated hosts and leave the user's active windows untouched.
