# Claude Sidebar-Only Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every Cursor Claude handoff into the right-hand Claude sidebar without creating or targeting a Claude editor tab.

**Architecture:** Treat Claude's sidebar-open plus mention-insertion commands as the complete Cursor handoff contract. Reuse the existing temporary native-selection workflow for both exported selections and Markdown ranges, and remove Claude editor tabs from stable chat-target discovery.

**Tech Stack:** TypeScript, VS Code extension APIs, Node.js test runner, Cursor Extension Development Host, Computer Use.

## Global Constraints

- Every LLM Wiki Claude handoff in Cursor targets the right-hand Claude sidebar.
- LLM Wiki never creates, targets, or closes a Claude editor tab.
- Existing sidebar drafts receive an at-mention without message submission.
- A closed sidebar is opened before insertion.
- Missing sidebar insertion support fails closed instead of opening an editor.
- Exported selections and direct Markdown ranges follow the same rule.
- Stock VS Code and all non-Claude providers retain their current behavior.
- Preserve all unrelated dirty working-tree changes.

---

## File Structure

- Modify `packages/vscode-extension/src/agentHandoff.ts`: define Cursor Claude availability as sidebar-open plus mention insertion, remove editor-tab targeting, and route exported selections through the existing native-selection adapter.
- Modify `packages/vscode-extension/test/agentHandoff.test.mjs`: replace the editor-open regression contract and update capability/visible-target coverage.
- Verify `packages/vscode-extension/src/extension.ts` unchanged: it already passes explicit `claude` handoff requests into `handoffSelectionToAgentId`.
- Verify `packages/vscode-extension/test/vscode-e2e/demo-vault.spec.ts` unchanged unless real-host validation reveals a missing observable assertion.

### Task 1: Require the Claude sidebar capability

**Files:**
- Modify: `packages/vscode-extension/test/agentHandoff.test.mjs:132-167`
- Modify: `packages/vscode-extension/src/agentHandoff.ts:40-110,458-470`

**Interfaces:**
- Consumes: `availableAgentCommand(agent, commands): string | undefined`, `isCursorHost(): boolean`, `CLAUDE_SIDEBAR_OPEN_COMMAND`, and `CLAUDE_HANDOFF_COMMANDS`.
- Produces: Cursor Claude capability only when sidebar-open and a mention command are both available.

- [ ] **Step 1: Replace the ambiguous capability test with a failing sidebar-contract test**

Replace `Cursor advertises Claude when its sidebar insertion command is
available` with:

```javascript
test('Cursor advertises Claude only when sidebar open and mention insertion are available', () => {
  const capabilityFor = commands => loadAgentHandoff({
    env: { appName: 'Cursor' },
    extensions: extensionRegistry(
      installedExtension('anthropic.claude-code', commands),
    ),
  }).getImmediateAgentSurfaceCapabilities();

  assert.deepEqual(capabilityFor([
    'claude-vscode.editor.open',
    'claude-vscode.insertAtMention',
  ]), {
    cursorAgent: true,
    providers: [],
  });
  assert.deepEqual(capabilityFor([
    'claude-vscode.sidebar.open',
  ]), {
    cursorAgent: true,
    providers: [],
  });
  assert.deepEqual(capabilityFor([
    'claude-vscode.sidebar.open',
    'claude-vscode.insertAtMention',
  ]), {
    cursorAgent: true,
    providers: [{ id: 'claude', label: 'Claude Code' }],
  });
});
```

This test catches either half of the sidebar command contract being omitted and
proves that `editor.open` is not a substitute.

- [ ] **Step 2: Run the capability test and verify RED**

Run:

```bash
node --test \
  --test-name-pattern "Cursor advertises Claude only when sidebar open and mention insertion are available" \
  packages/vscode-extension/test/agentHandoff.test.mjs
```

Expected: FAIL because mention insertion alone currently advertises Claude in
Cursor.

- [ ] **Step 3: Implement the minimal capability guard**

Change `availableAgentCommand` to:

```typescript
function availableAgentCommand(
  agent: AgentChoice,
  commands: ReadonlySet<string>,
): string | undefined {
  if (
    agent.id === 'claude'
    && isCursorHost()
    && !commands.has(CLAUDE_SIDEBAR_OPEN_COMMAND)
  ) {
    return undefined;
  }
  return agent.commands.find(command => commands.has(command));
}
```

Do not require the Cursor-only sidebar command in stock VS Code.

- [ ] **Step 4: Run the capability test and verify GREEN**

Run the Step 2 command.

Expected: PASS.

### Task 2: Stop treating Claude editor tabs as handoff targets

**Files:**
- Modify: `packages/vscode-extension/test/agentHandoff.test.mjs:699-1020`
- Modify: `packages/vscode-extension/src/agentHandoff.ts:100-110,370-430`

**Interfaces:**
- Consumes: `EDITOR_CHAT_VIEW_TYPES`, `visibleEditorChatTargets`, and `agentIdForEditorTab`.
- Produces: stable editor targeting for Codex only; a `claudeVSCodePanel` tab supplies no Claude handoff target.

- [ ] **Step 1: Add a failing assertion that a Claude editor is not a stable target**

Replace the old `multiple visible chat editors show a picker narrowed to those
stable targets` test with a focused target-selection test:

```javascript
test('Claude editor tabs are ignored as handoff targets', async () => {
  const calls = [];
  const uri = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/exports/export-id/selection.md',
  };
  const sourceGroup = {
    activeTab: {
      input: { uri: { scheme: 'file', fsPath: '/vault/source.md' } },
    },
  };
  const codexGroup = {
    activeTab: {
      input: {
        viewType: 'chatgpt.conversationEditor',
        uri: { scheme: 'openai-codex' },
      },
    },
  };
  const claudeGroup = {
    activeTab: {
      input: { viewType: 'claudeVSCodePanel' },
    },
  };
  const vscode = {
    commands: {
      getCommands: async () => [
        'chatgpt.addFileToThread',
        'claude-vscode.sidebar.open',
        'claude-vscode.insertAtMention',
      ],
      executeCommand: async (...args) => calls.push(args),
    },
    extensions: {
      getExtension: id => (
        ['openai.chatgpt', 'anthropic.claude-code'].includes(id.toLowerCase())
          ? { id }
          : undefined
      ),
    },
    window: {
      tabGroups: {
        activeTabGroup: sourceGroup,
        all: [sourceGroup, codexGroup, claudeGroup],
      },
      showQuickPick: () => assert.fail(
        'a Claude editor tab must not create a second stable target',
      ),
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToAgent } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToAgent(uri), 'codex');
  assert.deepEqual(calls, [['chatgpt.addFileToThread', uri]]);
});
```

- [ ] **Step 2: Run the target-selection test and verify RED**

Run:

```bash
node --test \
  --test-name-pattern "Claude editor tabs are ignored as handoff targets" \
  packages/vscode-extension/test/agentHandoff.test.mjs
```

Expected: FAIL because `claudeVSCodePanel` currently creates a second visible
agent target and opens the quick pick.

- [ ] **Step 3: Remove Claude editor tabs from the stable target map**

Change:

```typescript
const EDITOR_CHAT_VIEW_TYPES: Readonly<Record<string, AgentId>> = {
  'chatgpt.conversationEditor': 'codex',
  claudeVSCodePanel: 'claude',
};
```

to:

```typescript
const EDITOR_CHAT_VIEW_TYPES: Readonly<Record<string, AgentId>> = {
  'chatgpt.conversationEditor': 'codex',
};
```

Do not close or otherwise inspect user-created Claude editor tabs.

- [ ] **Step 4: Run target-selection coverage and verify GREEN**

Run:

```bash
node --test \
  --test-name-pattern "stable active editor tab routes to Codex|Claude editor tabs are ignored as handoff targets" \
  packages/vscode-extension/test/agentHandoff.test.mjs
```

Expected: both tests pass.

### Task 3: Route exported selections through the Claude sidebar

**Files:**
- Modify: `packages/vscode-extension/test/agentHandoff.test.mjs:1467-1530`
- Modify: `packages/vscode-extension/src/agentHandoff.ts:50-70,520-625,680-715`

**Interfaces:**
- Consumes: `executeAgentHandoff`, `executeWithNativeSelection`, `closeTemporaryClaudeContextTab`, and `restoreEditorTab`.
- Produces: sidebar-open → native full-range selection → mention insertion → temporary-tab cleanup → source restoration.

- [ ] **Step 1: Replace the editor-open regression test with a sidebar-only exported-selection test**

Rename `Cursor opens the full Claude editor beside the source with the
immutable reference` to `Cursor sends an exported selection to the Claude
sidebar without opening an editor session`.

Use the same real adapter path with this observable setup:

```javascript
const calls = [];
const closedTabs = [];
const uri = {
  scheme: 'file',
  fsPath: '/vault/.llm_wiki/agent/exports/export-id/selection.md',
};
const sourceUri = {
  scheme: 'file',
  fsPath: '/vault/raw/source.pdf',
};
const sourceTab = {
  input: { uri: sourceUri, viewType: 'llm-wiki.pdfViewer' },
  isPreview: true,
};
const temporaryTab = { input: { uri }, isPreview: false };
const sourceGroup = {
  viewColumn: 1,
  activeTab: sourceTab,
  tabs: [sourceTab],
};
const temporaryGroup = {
  viewColumn: 2,
  activeTab: temporaryTab,
  tabs: [temporaryTab],
};
const groups = [sourceGroup];
let activeGroup = sourceGroup;
const end = { line: 2, character: 7 };
const document = {
  lineCount: 3,
  lineAt: () => ({ range: { end } }),
};
const editor = {};
class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}
class Selection {
  constructor(start, finish) {
    this.start = start;
    this.end = finish;
  }
}
```

Build the VS Code test double with:

```javascript
const vscode = {
  Position,
  Selection,
  ViewColumn: { Beside: 2 },
  env: { appName: 'Cursor' },
  commands: {
    getCommands: async () => [
      'claude-vscode.editor.open',
      'claude-vscode.sidebar.open',
      'claude-vscode.insertAtMention',
    ],
    executeCommand: async (...args) => {
      calls.push(args);
      if (args[0] === 'vscode.openWith') activeGroup = sourceGroup;
    },
  },
  extensions: extensionRegistry(installedExtension(
    'anthropic.claude-code',
    [
      'claude-vscode.editor.open',
      'claude-vscode.sidebar.open',
      'claude-vscode.insertAtMention',
    ],
    { isActive: true },
  )),
  workspace: {
    openTextDocument: async value => {
      assert.equal(value, uri);
      return document;
    },
  },
  window: {
    tabGroups: {
      get activeTabGroup() { return activeGroup; },
      get all() { return groups; },
      close: async (tab, preserveFocus) => {
        closedTabs.push([tab, preserveFocus]);
        groups.splice(groups.indexOf(temporaryGroup), 1);
        activeGroup = sourceGroup;
        return true;
      },
    },
    showTextDocument: async (value, options) => {
      assert.equal(value, document);
      assert.deepEqual(options, {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside,
      });
      groups.push(temporaryGroup);
      activeGroup = temporaryGroup;
      return editor;
    },
    showWarningMessage: () => undefined,
  },
};
```

Assert the complete selection, command order, cleanup, and absence of
editor-open:

```javascript
const { handoffSelectionToAgentId } = loadAgentHandoff(vscode);

assert.equal(await handoffSelectionToAgentId('claude', uri), true);
assert.equal(editor.selection.start.line, 0);
assert.equal(editor.selection.start.character, 0);
assert.equal(editor.selection.end, end);
assert.deepEqual(calls, [
  ['claude-vscode.sidebar.open'],
  ['claude-vscode.insertAtMention'],
  ['vscode.openWith', sourceUri, 'llm-wiki.pdfViewer', {
    viewColumn: 1,
    preserveFocus: false,
    preview: true,
  }],
]);
assert.deepEqual(closedTabs, [[temporaryTab, true]]);
assert.equal(
  calls.some(([command]) => command === 'claude-vscode.editor.open'),
  false,
);
```

- [ ] **Step 2: Run the exported-selection test and verify RED**

Run:

```bash
node --test \
  --test-name-pattern "Cursor sends an exported selection to the Claude sidebar without opening an editor session" \
  packages/vscode-extension/test/agentHandoff.test.mjs
```

Expected: FAIL because the current Cursor selection-export branch invokes
`claude-vscode.editor.open` and never creates the native full-range selection.

- [ ] **Step 3: Replace the Cursor editor-open branch with native sidebar insertion**

Reduce the Cursor Claude branch in `executeAgentHandoff` to:

```typescript
if (agent.id === 'claude') {
  if (isCursorHost()) {
    await executeWithNativeSelection(context, command);
    return;
  }
  // Retain the existing stock VS Code implementation below.
}
```

Delete `CLAUDE_EDITOR_OPEN_COMMAND` and
`formatClaudeSelectionReference`; they have no remaining production callers.

- [ ] **Step 4: Make sidebar opening mandatory inside the Cursor native-selection adapter**

Change the Cursor prelude in `executeWithNativeSelection` to:

```typescript
if (
  isCursorHost()
  && (command === CLAUDE_HANDOFF_COMMANDS[0]
    || command === CLAUDE_HANDOFF_COMMANDS[1])
) {
  const sidebarCommand = await registeredCommand(CLAUDE_SIDEBAR_OPEN_COMMAND);
  if (!sidebarCommand) {
    throw new Error('Claude sidebar handoff is unavailable.');
  }
  await vscode.commands.executeCommand(sidebarCommand);
}
```

Keep the existing temporary selection, cleanup, and source restoration logic
unchanged.

- [ ] **Step 5: Run Claude handoff tests and verify GREEN**

Run:

```bash
node --test \
  --test-name-pattern "Claude|Cursor sends an exported selection|Cursor Claude" \
  packages/vscode-extension/test/agentHandoff.test.mjs
```

Expected: all selected tests pass and no assertion observes
`claude-vscode.editor.open`.

### Task 4: Reconcile adjacent tests and verify all providers

**Files:**
- Modify: `packages/vscode-extension/test/agentHandoff.test.mjs`
- Verify: `packages/vscode-extension/src/agentHandoff.ts`

**Interfaces:**
- Consumes: the sidebar-only capability and delivery behavior from Tasks 1-3.
- Produces: a coherent provider test suite with no legacy editor-open expectations.

- [ ] **Step 1: Update legacy Claude target tests to the sidebar-only contract**

Rename `stable visible Claude editor routes there and restores the source tab`
to `a visible Claude editor does not change sidebar-only Claude delivery`.
Call `handoffSelectionToAgentId('claude', uri)` so the test exercises an
explicit Claude request rather than generic agent picking. Retain its
exported-selection fixture and assert that delivery begins with:

```javascript
['claude-vscode.sidebar.open'],
['claude-vscode.insertAtMention'],
```

Also replace `Cursor Claude receives the original Markdown range mention` with
this runtime fail-closed test:

```javascript
test('Cursor Claude refuses an editor-only fallback', async () => {
  const calls = [];
  const warnings = [];
  const uri = {
    scheme: 'file',
    fsPath: '/vault/notes/Source.md',
    fragment: '',
    with(changes) { return { ...this, ...changes, with: this.with }; },
  };
  const vscode = {
    env: { appName: 'Cursor' },
    commands: {
      getCommands: async () => [
        'claude-vscode.editor.open',
        'claude-vscode.insertAtMention',
      ],
      executeCommand: async (...args) => calls.push(args),
    },
    extensions: extensionRegistry(installedExtension(
      'anthropic.claude-code',
      [
        'claude-vscode.editor.open',
        'claude-vscode.insertAtMention',
      ],
      { isActive: true },
    )),
    window: {
      showWarningMessage: message => warnings.push(message),
    },
  };
  const { handoffSelectionToAgentId } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToAgentId('claude', {
    kind: 'markdown-range',
    uri,
    range: { startLine: 3, endLine: 7 },
  }), false);
  assert.deepEqual(calls, []);
  assert.deepEqual(warnings, ['Claude Code handoff is not available.']);
});
```

This locks the no-editor fallback at runtime, not only in cold capability
discovery.

- [ ] **Step 2: Run the complete agent handoff test file**

Run:

```bash
node --test packages/vscode-extension/test/agentHandoff.test.mjs
```

Expected: all tests pass with zero failures.

- [ ] **Step 3: Run package verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm --filter llm-wiki-vscode test
git diff --check
```

Expected: lint, typecheck, build, all extension tests, and whitespace checks
exit successfully.

### Task 5: Validate the existing Claude sidebar in Cursor

**Files:**
- Verify: `demo-vault/.llm_wiki/agent/exports/<id>/selection.md`
- Verify: `packages/vscode-extension/src/agentHandoff.ts`

**Interfaces:**
- Consumes: the rebuilt extension, an existing right-hand Claude sidebar draft, and PDF/Markdown selections.
- Produces: real-host evidence that no Claude editor session is created.

- [ ] **Step 1: Build the extension**

Run:

```bash
pnpm build:extension
```

Expected: all webpack targets compile successfully.

- [ ] **Step 2: Reload the Cursor Extension Development Host**

Use Computer Use to run **Developer: Reload Window** in the existing
`demo-vault` host. Preserve the user's existing Claude sidebar session.

- [ ] **Step 3: Validate a PDF export**

With the existing right-hand Claude sidebar open:

1. Select a PDF passage.
2. Choose **Send to Claude Code**.
3. Confirm the existing sidebar draft receives exactly one
   `@.llm_wiki/agent/exports/<id>/selection.md#1-N` mention.
4. Confirm no message is submitted.
5. Confirm no new `Claude Code` editor tab or editor group appears.
6. Confirm the source/editor layout is restored.

- [ ] **Step 4: Validate a Markdown range**

Select a Markdown range, choose **Send to Claude Code**, and confirm the same
sidebar-only behavior with the exact requested line range.

- [ ] **Step 5: Run final verification before reporting completion**

Run:

```bash
pnpm test
pnpm lint
pnpm typecheck
git diff --check
```

Expected: the complete repository test suite and static checks pass.

- [ ] **Step 6: Record the handoff**

Report:

- the RED failures that proved the old editor-open behavior;
- the focused and full test counts;
- the Cursor sidebar observation;
- that no Claude editor tab was created;
- the documentation commits and implementation file list;
- that unrelated dirty working-tree changes were preserved.
