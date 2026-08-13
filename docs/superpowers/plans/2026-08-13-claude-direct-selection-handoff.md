# Claude Direct Selection Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert Claude Code's full immutable `selection.md` at-mention directly into its sidebar draft without opening the exported Markdown in an editor.

**Architecture:** Keep `agentHandoff.ts` as the provider adapter boundary. The Claude adapter will read the exported document without showing it, construct the same workspace-relative `@file#1-N` reference that Claude's current active-editor command produces, focus Claude's sidebar, and use VS Code's focused-input typing command. Existing Codex, Cursor Agent, and CodeBuddy adapters remain unchanged.

**Tech Stack:** TypeScript, VS Code Extension API, Node.js built-in test runner, pnpm, Computer Use with `@oai/sky`.

## Global Constraints

- Preserve the semantic full-file form `@.llm_wiki/agent/exports/<id>/selection.md#1-N`.
- Never call `vscode.window.showTextDocument` in the Claude handoff path.
- Never submit the Claude draft.
- Do not use the clipboard.
- Do not fall back to opening `selection.md`.
- Keep Codex, Cursor Agent, and CodeBuddy behavior unchanged.
- Keep the source PDF or Markdown editor selected after handoff.

---

### Task 1: Add the failing Claude handoff regression

**Files:**
- Modify: `packages/vscode-extension/test/agentHandoff.test.mjs`

**Interfaces:**
- Consumes: `handoffSelectionToAgent(contextUri, attachmentUris?)`
- Produces: Regression expectations for the Claude provider adapter.

- [ ] **Step 1: Replace the existing active-editor Claude assertion with direct-draft expectations**

Update the Claude-specific tests so their VS Code mock provides:

```javascript
workspace: {
  asRelativePath: value => {
    assert.equal(value, uri);
    return '.llm_wiki/agent/exports/export-id/selection.md';
  },
  openTextDocument: async value => {
    assert.equal(value, uri);
    return { lineCount: 3 };
  },
},
window: {
  showTextDocument: () => assert.fail('Claude must not open selection.md'),
  // Keep each test's existing tabGroups, picker, and warning behavior.
},
```

Expected command calls:

```javascript
[
  ['claude-vscode.sidebar.open'],
  [
    'type',
    {
      text: '@.llm_wiki/agent/exports/export-id/selection.md#1-3 ',
    },
  ],
]
```

Retain the assertion that no command name contains `submit` or `send`.

- [ ] **Step 2: Add a focused path-normalization regression**

Add a test whose `workspace.asRelativePath()` returns:

```javascript
'.llm_wiki\\agent\\exports\\export-id\\selection.md'
```

Assert that the typed reference is:

```javascript
'@.llm_wiki/agent/exports/export-id/selection.md#1-1 '
```

The mock `window.showTextDocument` must fail if invoked.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
node --test packages/vscode-extension/test/agentHandoff.test.mjs
```

Expected: FAIL because the current implementation calls `showTextDocument`,
sets a native editor selection, and invokes `claude-vscode.insertAtMention`
instead of `claude-vscode.sidebar.open` followed by `type`.

---

### Task 2: Implement direct Claude draft insertion

**Files:**
- Modify: `packages/vscode-extension/src/agentHandoff.ts`

**Interfaces:**
- Consumes:
  - `vscode.workspace.openTextDocument(contextUri): Promise<TextDocument>`
  - `vscode.workspace.asRelativePath(contextUri): string`
  - `vscode.commands.executeCommand('claude-vscode.sidebar.open')`
  - `vscode.commands.executeCommand('type', { text: string })`
- Produces:
  - `formatClaudeSelectionReference(contextUri, lineCount): string`
  - A Claude draft containing one full-file semantic reference.

- [ ] **Step 1: Add provider command constants**

Near the existing handoff command constants, add:

```typescript
const CLAUDE_OPEN_COMMAND = 'claude-vscode.sidebar.open';
const TYPE_COMMAND = 'type';
```

- [ ] **Step 2: Add a pure Claude reference formatter**

Add:

```typescript
function formatClaudeSelectionReference(
  contextUri: vscode.Uri,
  lineCount: number,
): string {
  const relativePath = vscode.workspace
    .asRelativePath(contextUri)
    .replaceAll('\\', '/');
  return `@${relativePath}#1-${Math.max(1, lineCount)} `;
}
```

The trailing space matches Claude's existing at-mention insertion behavior and
keeps subsequent typing separated from the reference.

- [ ] **Step 3: Replace the Claude active-editor workaround**

Replace:

```typescript
const document = await vscode.workspace.openTextDocument(contextUri);
const editor = await vscode.window.showTextDocument(document, { preview: true });
const end = document.lineAt(Math.max(0, document.lineCount - 1)).range.end;
editor.selection = new vscode.Selection(new vscode.Position(0, 0), end);
await vscode.commands.executeCommand(command);
```

with:

```typescript
const document = await vscode.workspace.openTextDocument(contextUri);
const reference = formatClaudeSelectionReference(contextUri, document.lineCount);
await vscode.commands.executeCommand(CLAUDE_OPEN_COMMAND);
await vscode.commands.executeCommand(TYPE_COMMAND, { text: reference });
```

Do not change the other provider branches.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --test packages/vscode-extension/test/agentHandoff.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run type checking and the extension package tests**

Run:

```bash
pnpm typecheck
pnpm --filter llm-wiki-vscode test
```

Expected: both commands exit `0`.

- [ ] **Step 6: Commit the tested adapter change**

```bash
git add packages/vscode-extension/src/agentHandoff.ts \
  packages/vscode-extension/test/agentHandoff.test.mjs
git commit -m "fix: insert Claude selection reference without opening editor"
```

---

### Task 3: Validate the actual Claude sidebar workflow

**Files:**
- Build output only: `packages/vscode-extension/dist/*`

**Interfaces:**
- Consumes: Running Extension Development Host and installed Claude Code extension.
- Produces: Live evidence that the source PDF remains active and the draft receives the immutable reference.

- [ ] **Step 1: Rebuild the extension**

Run:

```bash
pnpm build:extension
```

Expected: webpack reports successful builds for the extension and all webview
bundles.

- [ ] **Step 2: Reload the Extension Development Host**

Use Computer Use to run **Developer: Reload Window** in the Extension
Development Host, then reopen `demo-vault/raw/pdf/ddia.pdf` if necessary.

- [ ] **Step 3: Prepare the live reproduction**

Using Computer Use:

1. Select a PDF passage.
2. Close any existing `selection.md` preview tab.
3. Clear the Claude draft.
4. Keep the Claude sidebar visible.

- [ ] **Step 4: Trigger the fixed handoff**

Click **Send to Claude Code** in the PDF selection toolbar.

- [ ] **Step 5: Verify live postconditions**

Inspect the fresh accessibility tree and screenshot:

- `ddia.pdf` remains the selected editor tab.
- No `selection.md` editor tab is created.
- Claude's message input contains an immutable
  `@.llm_wiki/agent/exports/<id>/selection.md#1-N` reference.
- The draft has not been submitted.

If VS Code's programmatic `type` command does not reach the Claude input, stop
and return to root-cause analysis rather than adding an editor-opening
fallback.

---

### Task 4: Improve the README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: The implemented provider behavior and existing filesystem-first architecture.
- Produces: Current user-facing feature and design documentation.

- [ ] **Step 1: Clarify the learning loop and selection actions**

Document that:

- **Add to Chat** chooses an appropriate available target.
- Explicit PDF buttons route to Codex, Claude Code, or CodeBuddy.
- Handoffs update a draft but never submit it.

- [ ] **Step 2: Add an “Agent handoff design” section**

Describe:

- Immutable exports under `.llm_wiki/agent/exports/<id>/`.
- Latest aliases under `.llm_wiki/agent/selection.{md,json,png}`.
- Codex/Cursor/CodeBuddy native file attachment behavior.
- Claude's full-file semantic `@selection.md#1-N` reference.
- Claude's optional image access through the relative Markdown link rather
  than a native image attachment.
- Provider discovery through installed VS Code command capabilities.

- [ ] **Step 3: Expand the filesystem tree**

Include:

```text
.llm_wiki/
├── agent/
│   ├── selection.md
│   ├── selection.json
│   ├── selection.png
│   └── exports/<id>/
│       ├── selection.md
│       ├── selection.json
│       └── selection.png
└── annotations/pdf/
```

- [ ] **Step 4: Explain the architecture boundary**

State that webviews own rendering and selection interaction, while the
extension host owns trusted filesystem writes, export validation, provider
discovery, and agent handoff.

- [ ] **Step 5: Verify documentation quality**

Run:

```bash
git diff --check
rg -n "Claude|immutable|selection\\.md|never submits|filesystem-first" README.md
```

Expected: no whitespace errors and the new behavior is directly discoverable.

- [ ] **Step 6: Commit the README**

```bash
git add README.md
git commit -m "docs: explain agent handoff behavior"
```

---

### Task 5: Final verification

**Files:**
- Verify all modified files and generated build artifacts.

**Interfaces:**
- Consumes: Completed implementation and documentation.
- Produces: Evidence that the repository and live UI satisfy the approved design.

- [ ] **Step 1: Run the complete repository checks**

Run:

```bash
pnpm check
```

Expected: lint, type checking, and every package test pass.

- [ ] **Step 2: Verify the production bundle contains the direct path**

Run:

```bash
rg -n "claude-vscode\\.sidebar\\.open|selection\\.md#1-|could not attach the selection" \
  packages/vscode-extension/dist/extension.js
```

Expected: the Claude sidebar command and handoff warning exist in the production
bundle.

- [ ] **Step 3: Review the final diff**

Run:

```bash
git status --short --branch
git diff main...HEAD --check
git diff --stat main...HEAD
```

Confirm that the diff is limited to:

- The approved design and implementation plan.
- `agentHandoff.ts` and its regression tests.
- `README.md`.

- [ ] **Step 4: Preserve the feature branch**

Keep `codex/fix-claude-direct-handoff` available for the user unless they
explicitly request a merge, push, or discard.

