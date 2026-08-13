# Claude Direct Selection Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Claude Code's full immutable `selection.md` at-mention into its sidebar draft without leaving the exported Markdown open or taking the learner away from the source.

**Architecture:** Keep `agentHandoff.ts` as the provider adapter boundary. Claude's public at-mention command requires an active native text-editor selection, so the adapter opens the immutable export as a preview, selects the full file, invokes Claude's command, and closes the exact captured preview tab with preserved focus. Existing Codex, Cursor Agent, and CodeBuddy adapters remain unchanged.

**Tech Stack:** TypeScript, VS Code Extension API, Node.js built-in test runner, pnpm, Computer Use with `@oai/sky`.

## Global Constraints

- Preserve the semantic full-file form `@.llm_wiki/agent/exports/<id>/selection.md#1-N`.
- Leave no `selection.md` preview open after handoff.
- Close only the exact temporary tab whose URI matches the immutable export.
- Never submit the Claude draft.
- Do not use or modify the clipboard.
- Keep Codex, Cursor Agent, and CodeBuddy behavior unchanged.
- Keep the source PDF or Markdown editor selected after handoff.

---

### Task 1: Add the failing Claude tab-cleanup regression

**Files:**
- Modify: `packages/vscode-extension/test/agentHandoff.test.mjs`

**Interfaces:**
- Consumes: `handoffSelectionToAgent(contextUri, attachmentUris?)`
- Produces: Regression expectations for Claude's full-document mention and exact temporary-tab cleanup.

- [ ] **Step 1: Extend the Claude tests with source and temporary tabs**

Model the source tab, temporary exported tab, full-document editor selection,
and Tab Groups close behavior:

```javascript
const sourceTab = { input: { uri: sourceUri } };
const temporaryTab = { input: { uri } };
const tabGroup = { activeTab: sourceTab };
const closedTabs = [];

window: {
  tabGroups: {
    activeTabGroup: tabGroup,
    all: [tabGroup],
    close: async (tab, preserveFocus) => {
      closedTabs.push([tab, preserveFocus]);
      tabGroup.activeTab = sourceTab;
      return true;
    },
  },
  showTextDocument: async () => {
    tabGroup.activeTab = temporaryTab;
    return editor;
  },
}
```

Keep the complete editor-selection assertions and expect:

```javascript
assert.deepEqual(calls, [['claude-vscode.insertAtMention']]);
assert.deepEqual(closedTabs, [[temporaryTab, true]]);
assert.equal(tabGroup.activeTab, sourceTab);
```

Retain the assertion that no command name contains `submit` or `send`.

- [ ] **Step 2: Add an unrelated-tab safety regression**

Make the captured active tab point to:

```javascript
const unrelatedTab = {
  input: {
    uri: {
      scheme: 'file',
      fsPath: '/vault/notes/unrelated.md',
    },
  },
};
```

Assert that Claude's insertion command runs but `tabGroups.close()` is not
called.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
node --test packages/vscode-extension/test/agentHandoff.test.mjs
```

Expected: FAIL because the current implementation does not close and restore
the exact temporary preview tab.

---

### Task 2: Implement exact Claude preview cleanup

**Files:**
- Modify: `packages/vscode-extension/src/agentHandoff.ts`

**Interfaces:**
- Consumes:
  - `vscode.workspace.openTextDocument(contextUri): Promise<TextDocument>`
  - `vscode.window.showTextDocument(document, { preview: true })`
  - `vscode.commands.executeCommand(command)`
  - `vscode.window.tabGroups.close(tab, true)`
- Produces:
  - `closeTemporaryClaudeContextTab(tab, contextUri): Promise<void>`
  - A Claude draft containing the full semantic reference with no lingering preview.

- [ ] **Step 1: Capture the temporary preview tab**

After opening the immutable Markdown, capture the active tab before invoking
Claude:

```typescript
const editor = await vscode.window.showTextDocument(document, { preview: true });
const temporaryTab = vscode.window.tabGroups.activeTabGroup.activeTab;
```

- [ ] **Step 2: Add URI-checked tab cleanup**

Add:

```typescript
async function closeTemporaryClaudeContextTab(
  tab: vscode.Tab | undefined,
  contextUri: vscode.Uri,
): Promise<void> {
  const input = tab?.input as { uri?: vscode.Uri } | undefined;
  const uri = input?.uri;
  if (
    !tab
    || !uri
    || uri.scheme !== contextUri.scheme
    || uri.fsPath !== contextUri.fsPath
  ) {
    return;
  }
  const closed = await vscode.window.tabGroups.close(tab, true);
  if (!closed) {
    vscode.window.showWarningMessage(
      'Claude received selection.md, but LLM Wiki could not close the temporary preview.',
    );
  }
}
```

- [ ] **Step 3: Close the preview in a finally block**

Keep the existing complete-document selection, then wrap Claude's command:

```typescript
try {
  await vscode.commands.executeCommand(command);
} finally {
  await closeTemporaryClaudeContextTab(temporaryTab, contextUri);
}
```

If `tabGroups.close()` throws, preserve the already-inserted mention and show
the same cleanup-specific warning. Do not change the other provider branches.

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
git commit -m "fix: restore source after Claude selection handoff"
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

Use Computer Use to run **Developer: Reload Window**, then open
`demo-vault/raw/pdf/ddia.pdf`.

- [ ] **Step 3: Prepare the live reproduction**

Using Computer Use:

1. Navigate to PDF page 29.
2. Select the fault-tolerance paragraph.
3. Clear the Claude draft.
4. Keep the Claude sidebar visible.

- [ ] **Step 4: Trigger the fixed handoff**

Click **Send to Claude Code** in the PDF selection toolbar.

- [ ] **Step 5: Verify live postconditions**

Inspect a fresh accessibility tree and screenshot:

- `ddia.pdf` remains the selected editor tab.
- No `selection.md` editor tab remains open.
- Claude's input contains an immutable
  `@.llm_wiki/agent/exports/<id>/selection.md#1-N` reference.
- The Claude input remains focused.
- The draft has not been submitted.

---

### Task 4: Improve the README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Implemented provider behavior and filesystem-first architecture.
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
- Provider-specific file and crop behavior.
- Claude's full-file semantic `@selection.md#1-N` reference.
- Claude's exact temporary-preview cleanup.
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

Expected: no whitespace errors and the behavior is directly discoverable.

- [ ] **Step 6: Commit the README and revised design records**

```bash
git add README.md \
  docs/superpowers/specs/2026-08-13-claude-direct-selection-handoff-design.md \
  docs/superpowers/plans/2026-08-13-claude-direct-selection-handoff.md
git commit -m "docs: explain agent handoff behavior"
```

---

### Task 5: Final verification

**Files:**
- Verify all modified files and generated build artifacts.

**Interfaces:**
- Consumes: Completed implementation and documentation.
- Produces: Evidence that the repository and live UI satisfy the approved behavior.

- [ ] **Step 1: Run the complete repository checks**

Run:

```bash
pnpm check
```

Expected: lint, type checking, and every package test pass.

- [ ] **Step 2: Verify the production bundle contains the cleanup path**

Run:

```bash
rg -n "temporary preview|tabGroups\\.close|could not attach the selection" \
  packages/vscode-extension/dist/extension.js
```

Expected: the cleanup warning and handoff warning exist in the production
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

Keep `codex/fix-claude-direct-handoff` available unless the user explicitly
requests a merge, push, or discard.
