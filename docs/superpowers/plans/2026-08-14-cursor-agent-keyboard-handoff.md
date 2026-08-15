# Cursor Agent keyboard handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Ctrl/Cmd+L` attach the exact Markdown selection to Cursor Agent and make `Esc` return focus to the source Markdown editor.

**Architecture:** Reuse the existing `llm-wiki.addSelectionToChat` and exact-range Cursor adapter. Add a small extension-host handoff-state context key and a dedicated focus command that delegates to `MarkdownEditorProvider.focusActiveEditor()`. Keep the shortcut Cursor-specific and guard Escape so it only intercepts focus after a successful handoff.

**Tech Stack:** VS Code extension commands/keybindings, TypeScript, CodeMirror keymaps, Node `node:test`, Cursor Extension Development Host, Computer Use (`@oai/sky`).

## Global Constraints

- The source Markdown document remains authoritative; no handoff submits an agent message.
- Preserve the exact inclusive source line range and avoid creating duplicate Markdown editor tabs.
- Codex and Claude keep their existing explicit handoff actions; this shortcut is Cursor-only.
- `Esc` must be idempotent and must not close the agent composer or alter document contents.
- Follow the repository Node 20 floor and existing TypeScript/test conventions.

---

### Task 1: Add failing tests for keyboard state and focus restoration

**Files:**
- Modify: `packages/vscode-extension/test/extensionActivation.test.mjs`
- Modify: `packages/vscode-extension/test/markdownEditorInsertion.test.mjs` only if the provider focus seam needs a focused unit case
- Modify: `packages/vscode-extension/test/buildArtifacts.test.mjs` for manifest command/keybinding assertions

**Interfaces:**
- Consume the existing extension activation test harness and the existing
  `MarkdownEditorProvider` test doubles.
- Produce failing assertions for the new command name,
  `llmWikiAgentHandoffActive` context transitions, and guarded Escape
  keybinding.

- [x] **Step 1: Write the failing activation test**

Add a test that activates the extension with a mocked Cursor host, captures the
registered command handlers, and asserts that:

```js
assert.ok(commands.has('llm-wiki.focusMarkdownEditor'));
await commands.get('llm-wiki.focusMarkdownEditor')();
assert.deepEqual(executed, ['setContext', 'workbench.action.focusActiveEditorGroup']);
```

The test should also assert that the focus handler clears
`llmWikiAgentHandoffActive` after calling the provider focus method.

- [x] **Step 2: Write the failing manifest test**

Assert that `package.json` contributes `llm-wiki.focusMarkdownEditor` and an
`escape` keybinding whose `when` clause contains both
`llmWikiAgentHandoffActive` and
`activeCustomEditorId == 'llm-wiki.markdownEditor'`.

- [x] **Step 3: Run the focused tests and confirm RED**

Run:

```bash
pnpm --filter llm-wiki-vscode exec node --test \
  test/extensionActivation.test.mjs test/buildArtifacts.test.mjs
```

Expected: failures explaining that the focus command and Escape keybinding are
not yet registered.

### Task 2: Implement the extension-host focus state and command

**Files:**
- Modify: `packages/vscode-extension/src/extension.ts`
- Modify: `packages/vscode-extension/src/markdownEditorProvider.ts` only if the
  existing focus method needs a returned/awaited completion signal

**Interfaces:**
- `setAgentHandoffActive(active: boolean): void` sets the
  `llmWikiAgentHandoffActive` context key.
- `llm-wiki.focusMarkdownEditor` calls
  `markdownEditorProvider?.focusActiveEditor()`, then clears the context key.

- [x] **Step 1: Register the context key and command**

Initialize the context to `false` during activation. Register
`llm-wiki.focusMarkdownEditor` beside the existing editor focus/shortcut
commands. The handler should be safe when no Markdown webview is active and
should always clear the transient context in a `finally` block.

- [x] **Step 2: Mark successful Cursor handoffs**

In the Cursor `addSelectionToChat` route, set the context key only after
`handoffSelectionToCursor(...)` returns `true`. Leave it false for missing or
empty selections and failed provider commands.

- [x] **Step 3: Run the focused tests and confirm GREEN**

Run the command and manifest tests from Task 1. Expected: all pass with no
new warnings.

### Task 3: Wire the keyboard shortcuts without breaking editor behavior

**Files:**
- Modify: `packages/vscode-extension/package.json`
- Modify: `packages/vscode-extension/webview-src/markdown-editor.ts` only if
  the existing `Mod-l` handler needs to return the host result or avoid a
  duplicate fallback

**Interfaces:**
- `llm-wiki.addSelectionToChat` remains the Cursor-only selection command.
- `llm-wiki.focusMarkdownEditor` is the guarded Escape command.

- [x] **Step 1: Add the guarded Escape keybinding**

Add a keybinding with `key: "escape"` and `when`:

```text
llmWikiAgentHandoffActive && activeCustomEditorId == 'llm-wiki.markdownEditor'
```

Do not add a global Escape binding.

- [x] **Step 2: Preserve the existing Cmd/Ctrl+L behavior**

Keep the current Cursor-only `ctrl+l`/`cmd+l` binding guarded by
`llmWikiHostIsCursor` and `llmWikiMarkdownHasSelection`. Keep the CodeMirror
`Mod-l` path's no-selection checklist fallback unchanged.

- [x] **Step 3: Run manifest and Markdown tests**

Run:

```bash
pnpm --filter llm-wiki-vscode exec node --test \
  test/buildArtifacts.test.mjs test/e2e/markdown-editor.spec.ts
```

Expected: the manifest checks and existing keyboard/selection tests pass.

### Task 4: Add the session functionality inventory document

**Files:**
- Create: `docs/session-functionality-2026-08-14.md`

**Interfaces:**
- The document is a durable, human-readable checklist of every feature the
  user requested in this session, with implementation evidence and verification
  status.

- [x] **Step 1: Record all requested features**

Include the metadata list/table rendering, image raw-line/copy behavior,
GitHub-style structured properties, selection toolbar placement/color, Vim
scroll preservation, Git diff roadmap, markdownlint dependency/roadmap,
exact Cursor/Codex/Claude handoffs, source/generated property editing,
speedrun rendering fixes, `Cmd/Ctrl+L`, and `Esc` focus restoration.

- [x] **Step 2: Link each item to code/tests or mark it as roadmap**

Use absolute repository-relative Markdown links and distinguish shipped,
partially shipped, and planned work. Do not claim live verification until Task
5 supplies it.

### Task 5: Build, automate, and verify in Cursor

**Files:**
- No source files; inspect the built extension, test output, and live Cursor
  state.

- [x] **Step 1: Run focused and full automated checks**

Run:

```bash
pnpm --filter llm-wiki-vscode build
pnpm --filter llm-wiki-vscode exec node --test test/*.test.mjs
pnpm check
git diff --check
```

- [x] **Step 2: Rebuild and validate the demo vault**

Run:

```bash
python3 tools/demo-vault/rebuild_indexes.py --vault demo-vault
python3 tools/demo-vault/rebuild_indexes.py --vault demo-vault --check
python3 tools/demo-vault/validate_vault.py --vault demo-vault
```

- [x] **Step 3: Reload Cursor and verify Cmd/Ctrl+L**

Using Computer Use, open the Markdown editor, select several source lines,
press `super+l` on macOS (and use the platform-equivalent control shortcut if
available), then assert that the Cursor composer contains an exact range pill
and no second editor group appears.

- [x] **Step 4: Verify Escape focus restoration**

Press `Escape` and assert that the accessibility tree reports the Markdown
editor as focused, the Cursor composer remains open, and the exact selection
pill remains present. Press `Escape` once more and confirm no tab closes and no
document text changes.

- [x] **Step 5: Update the inventory with evidence**

Record command outputs and the live Cursor observations in
`docs/session-functionality-2026-08-14.md`, then rerun `git diff --check`.
