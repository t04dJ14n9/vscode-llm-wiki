# Claude Direct Selection Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Claude Code's full immutable `selection.md` at-mention into its draft without leaving a new export tab open or taking the learner away from the source.

**Architecture:** `agentHandoff.ts` remains the provider-adapter boundary. Claude's public at-mention command requires an active native text-editor selection, so the adapter snapshots the source tab, records pre-existing export tabs, opens the export as a pinned editor beside the source, selects the full file, invokes Claude, closes only a matching tab created by the handoff, and explicitly restores the source editor.

**Tech Stack:** TypeScript, VS Code Extension API, Node.js built-in test runner, pnpm, Computer Use with `@oai/sky`.

## Global Constraints

- Preserve Claude's semantic full-file form
  `@.llm_wiki/agent/exports/<id>/selection.md#1-N`.
- Never submit the Claude draft.
- Never use or modify the clipboard.
- Never close a pre-existing or unrelated tab.
- Open the temporary export beside the source with `preview: false`, preventing
  preview replacement.
- Restore the source URI, editor type, view column, and preview state.
- Keep Codex, Cursor Agent, and CodeBuddy behavior unchanged.

---

### Task 1: Add failing tab-ownership and source-restoration regressions

**Files:**
- Modify: `packages/vscode-extension/test/agentHandoff.test.mjs`

**Interfaces:**
- Consumes:
  - `handoffSelectionToAgent(contextUri, attachmentUris?)`
  - `handoffSelectionToAgentId(agentId, contextUri, attachmentUris?)`
- Produces: Regression expectations for the complete Claude handoff lifecycle.

- [x] **Step 1: Model a preview source tab and a separate temporary editor**

The test must model:

```javascript
const sourceTab = {
  input: {
    uri: sourceUri,
    viewType: 'llm-wiki.pdfViewer',
  },
  isPreview: true,
};

const temporaryTab = {
  input: { uri: selectionUri },
  isPreview: false,
};
```

`showTextDocument()` must receive:

```javascript
{
  preview: false,
  viewColumn: vscode.ViewColumn.Beside,
}
```

- [x] **Step 2: Assert explicit custom-editor source restoration**

After the Claude insertion command, expect:

```javascript
[
  'vscode.openWith',
  sourceUri,
  'llm-wiki.pdfViewer',
  {
    viewColumn: 1,
    preserveFocus: false,
    preview: true,
  },
]
```

The mocked close operation must only remove the temporary group; it must not
restore the source on the production code's behalf.

- [x] **Step 3: Assert standard text-editor source restoration**

For a normal text source, expect:

```javascript
await vscode.window.showTextDocument(sourceUri, {
  viewColumn: 1,
  preserveFocus: false,
  preview: false,
});
```

- [x] **Step 4: Assert pre-existing export tabs are preserved**

Record a `selection.md` tab before the handoff, reveal that same tab during the
temporary editor operation, and assert that `tabGroups.close()` is not called.

- [x] **Step 5: Assert failed insertion does not claim delivery**

Make Claude's insertion command throw and `tabGroups.close()` return `false`.
Assert that the explicit handoff returns `false` and emits only:

```text
Claude Code could not attach the selection.
```

- [x] **Step 6: Run focused tests and verify RED**

Run:

```bash
node --test packages/vscode-extension/test/agentHandoff.test.mjs
```

Expected: FAIL against the previous MRU-based cleanup implementation.

---

### Task 2: Implement owned-tab cleanup and explicit source restoration

**Files:**
- Modify: `packages/vscode-extension/src/agentHandoff.ts`

**Interfaces:**
- Produces:
  - `activeRestorableEditorTab(): RestorableEditorTab | undefined`
  - `tabsForUri(uri): vscode.Tab[]`
  - `tabMatchesUri(tab, uri): boolean`
  - `closeTemporaryClaudeContextTab(tab, uri): Promise<boolean>`
  - `restoreEditorTab(tab): Promise<boolean>`

- [x] **Step 1: Snapshot the active source**

Capture:

```typescript
interface RestorableEditorTab {
  uri: vscode.Uri;
  viewColumn: vscode.ViewColumn;
  preview: boolean;
  viewType?: string;
}
```

- [x] **Step 2: Snapshot pre-existing export tabs**

Before opening the immutable export:

```typescript
const sourceTab = activeRestorableEditorTab();
const existingContextTabs = new Set(tabsForUri(contextUri));
```

- [x] **Step 3: Open the export without replacing previews**

```typescript
const editor = await vscode.window.showTextDocument(document, {
  preview: false,
  viewColumn: vscode.ViewColumn.Beside,
});
```

Identify the owned tab by comparing the matching after-set against
`existingContextTabs`.

- [x] **Step 4: Preserve Claude's supported insertion command**

Select the complete exported document and invoke the contributed
`insertAtMention` command exactly once.

- [x] **Step 5: Clean up and restore in a `finally` block**

Close only the owned matching tab. Then:

- Restore custom editors with `vscode.openWith`.
- Restore text editors with `showTextDocument`.
- Use `preserveFocus: false` so the source becomes active.
- Preserve the source's original `preview` state.

- [x] **Step 6: Separate delivery and cleanup warnings**

Track whether the insertion command completed. Only claim that Claude received
the selection when insertion succeeded. If insertion fails, let the normal
provider failure warning report it without a contradictory success message.

- [x] **Step 7: Run focused tests and type checking**

```bash
node --test packages/vscode-extension/test/agentHandoff.test.mjs
pnpm typecheck
```

Expected: PASS.

---

### Task 3: Validate the actual Claude workflow

**Files:**
- Build output only: `packages/vscode-extension/dist/*`

- [x] **Step 1: Rebuild and reload**

```bash
pnpm build:extension
```

Use Computer Use to run **Developer: Reload Window** in the Extension
Development Host.

- [x] **Step 2: Select the DDIA fault-tolerance paragraph**

Open `demo-vault/raw/pdf/ddia.pdf`, navigate to page 29, and select the paragraph
beginning “Although we generally prefer tolerating faults...”.

- [x] **Step 3: Trigger Claude handoff**

Click **Send to Claude Code**.

- [x] **Step 4: Verify live postconditions**

Verify from a fresh screenshot and accessibility tree:

- `ddia.pdf` is the selected editor tab.
- No newly created `selection.md` tab remains.
- Claude contains an immutable `@.../selection.md#1-N` reference.
- The draft remains unsent.

---

### Task 4: Improve the README and design records

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-13-claude-direct-selection-handoff-design.md`
- Modify: `docs/superpowers/plans/2026-08-13-claude-direct-selection-handoff.md`

- [x] **Step 1: Document immutable selection exports**

Describe latest aliases and immutable exports under
`.llm_wiki/agent/exports/<id>/`.

- [x] **Step 2: Document provider-specific handoff behavior**

Clarify Codex, Claude Code, Cursor Agent, and CodeBuddy file/crop behavior and
state that LLM Wiki never submits a draft.

- [x] **Step 3: Describe Claude's actual public API boundary**

Document the full-file semantic at-mention, separate pinned temporary editor,
owned-tab cleanup, explicit source restoration, and preservation of
pre-existing export tabs.

- [x] **Step 4: Avoid overstating image ingestion**

State that Claude can access the optional crop through the relative Markdown
link; do not claim automatic image ingestion or a native image attachment.

- [x] **Step 5: Verify documentation**

```bash
git diff --check
rg -n "Claude|immutable|selection\\.md|never submits|filesystem-first" README.md
```

---

### Task 5: Final verification

**Files:**
- Verify all modified files and generated build artifacts.

- [x] **Step 1: Run the complete repository checks**

```bash
pnpm check
```

Expected: lint, type checking, 36 core tests, and all extension tests pass.

- [x] **Step 2: Verify the production bundle**

Confirm the production bundle contains:

- `claude-vscode.insertAtMention`
- `vscode.openWith`
- the cleanup-specific warning
- the normal provider failure warning

- [x] **Step 3: Review the final diff**

```bash
git status --short --branch
git diff main...HEAD --check
git diff --stat main...HEAD
```

- [x] **Step 4: Preserve the feature branch**

Keep `codex/fix-claude-direct-handoff` available unless the user explicitly
requests a merge, push, or discard.
