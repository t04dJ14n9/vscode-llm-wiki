# PDF Add to Chat Raw Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PDF Add to Chat's `selection.md` attachment with exact in-memory raw text while retaining the optional crop image.

**Architecture:** The extension formats PDF context with the existing agent clipboard formatter, stores only the crop in the bounded image cache, and calls a focused Cursor adapter that adds a raw code-selection payload followed by the optional PNG. Existing durable export and provider handoff paths remain intact.

**Tech Stack:** TypeScript, VS Code extension commands, Cursor composer commands, Node test runner, ESLint, TypeScript project references.

## Global Constraints

- Do not create or attach `selection.md`, `selection.json`, or an export directory for PDF Add to Chat.
- Use the original PDF URI as the source identity.
- Preserve the exact source link and selected passage in the raw-text payload.
- Persist only a validated PNG through the existing bounded clipboard image cache.
- Reuse the active Cursor composer and never submit a message.
- Do not change Markdown Add to Chat, Copy for Agent, browser handoff, or durable export behavior.

---

### Task 1: Add a raw-text Cursor handoff

**Files:**
- Modify: `packages/vscode-extension/src/agentHandoff.ts`
- Test: `packages/vscode-extension/test/agentHandoff.test.mjs`

**Interfaces:**
- Consumes: the existing Cursor composer discovery and file-attachment commands.
- Produces:
  - `CursorRawTextHandoff`
  - `handoffRawTextToCursor(input: CursorRawTextHandoff, attachmentUris?: readonly vscode.Uri[]): Promise<boolean>`

- [ ] **Step 1: Write the failing adapter test**

Add a test that calls `handoffRawTextToCursor` with a PDF URI, one-based page
range, literal source/selection text, and one PNG. Assert the command sequence
is `composer.getOrderedSelectedComposerIds`,
`composer.addsymbolstocomposer`, then `composer.addfilestocomposer`. Assert the
code selection contains the literal `rawText`, and no command argument contains
`selection.md`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --test-name-pattern "raw PDF text" packages/vscode-extension/test/agentHandoff.test.mjs
```

Expected: FAIL because `handoffRawTextToCursor` is not exported.

- [ ] **Step 3: Implement the minimal adapter**

Validate nonempty raw text and ordered positive line values, reuse the existing
active-composer check, invoke `composer.addsymbolstocomposer` with one
`codeSelections` entry, and attach only unique local optional files. Warn and
return `false` if raw-text insertion fails; warn but return `true` if only an
optional image fails.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --test --test-name-pattern "raw PDF text" packages/vscode-extension/test/agentHandoff.test.mjs
```

Expected: PASS.

### Task 2: Route PDF Add to Chat around durable export

**Files:**
- Modify: `packages/vscode-extension/src/extension.ts`
- Test: `packages/vscode-extension/test/extensionActivation.test.mjs`

**Interfaces:**
- Consumes:
  - `createPdfAgentClipboardContext(...)`
  - `persistPdfAgentClipboardImage(...)`
  - `handoffRawTextToCursor(...)`
- Produces: PDF Add to Chat behavior with raw text and an optional PNG only.

- [ ] **Step 1: Write the failing activation test**

Change the PDF Add to Chat regression to make `addSelectionToContext` and
`syncSelectionExportAttachment` fail if called. Assert the raw handoff receives
the original PDF URI, the literal formatted source/selection text, and only the
cached PNG URI.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --test-name-pattern "Add to Chat stays Cursor-only" packages/vscode-extension/test/extensionActivation.test.mjs
```

Expected: FAIL because the current path exports and attaches `selection.md`.

- [ ] **Step 3: Implement the PDF-specific route**

Before the durable export branch, detect a file-backed PDF selection, create
the validated clipboard context, persist a validated PNG when present, and
call `handoffRawTextToCursor`. Leave all other selection kinds on their
existing paths.

- [ ] **Step 4: Verify the focused and affected suites**

Run:

```bash
node --test packages/vscode-extension/test/agentHandoff.test.mjs packages/vscode-extension/test/extensionActivation.test.mjs
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

Expected: all commands exit zero.

- [ ] **Step 5: Commit and update the existing pull request**

```bash
git add docs/superpowers/specs/2026-08-17-pdf-add-to-chat-raw-text-design.md docs/superpowers/plans/2026-08-17-pdf-add-to-chat-raw-text.md packages/vscode-extension/src/agentHandoff.ts packages/vscode-extension/src/extension.ts packages/vscode-extension/test/agentHandoff.test.mjs packages/vscode-extension/test/extensionActivation.test.mjs
git commit -m "fix(pdf): add chat context without selection export"
git push
```
