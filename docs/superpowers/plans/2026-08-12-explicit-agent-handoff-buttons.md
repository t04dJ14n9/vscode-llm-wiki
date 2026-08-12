# Explicit Agent Handoff Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic provider-specific PDF selection buttons in VS Code and Cursor, keep Cursor's direct Add to Chat action, and make every installed provider work from a cold extension state without submitting a prompt.

**Architecture:** `agentHandoff.ts` remains the single registry for supported provider extensions, data-handoff commands, capabilities, activation, and provider adapters. The PDF host supplies a serializable capability matrix to its webview and routes explicit provider IDs through a new Human Learning command; selection export remains shared and adds a portable sibling-image link for Claude Code. Cursor's generic action bypasses provider selection and uses only Cursor Agent.

**Tech Stack:** TypeScript, VS Code Extension API, shared PDF webview, Node test runner, Playwright, webpack, pnpm.

## Global Constraints

- Stock VS Code shows **Copy Link** plus **Send to Codex**, **Send to Claude Code**, and **Send to CodeBuddy** only when their extensions expose supported data-handoff commands.
- Cursor shows those installed-provider buttons and retains **Add to Chat** as a direct Cursor Agent action.
- The generic Add to Chat command, title/context actions, and Cmd/Ctrl+L
  keybinding are enabled only when `humanLearningHostIsCursor` is true; stock
  VS Code retains **Send Selection to Agent…** as its non-PDF picker.
- An installed provider with `Extension.isActive === false` is visible and is explicitly activated on click before its command is revalidated and invoked.
- Focus/open-only commands never count as provider handoff capabilities.
- An explicit provider failure never reroutes to Cursor or another provider.
- Codex and CodeBuddy receive unique `selection.md` and optional `selection.png` attachments.
- Claude Code receives the complete `selection.md` mention; that Markdown contains `**Visual evidence**: [selection.png](./selection.png) when present`.
- No provider path submits a prompt.
- Open PDF editors refresh their provider actions on `vscode.extensions.onDidChange`.
- Do not automate a provider's private webview or add a provider SDK/API dependency.
- Do not edit source material under `demo-vault/raw/`.

---

### Task 1: Centralize explicit provider capabilities and cold activation

**Files:**
- Modify: `packages/vscode-extension/src/agentHandoff.ts`
- Modify: `packages/vscode-extension/test/agentHandoff.test.mjs`

**Interfaces:**
- Produces:

```ts
export type ExternalAgentId = 'codex' | 'claude' | 'codebuddy';

export interface AgentHandoffCapability {
  id: ExternalAgentId;
  label: string;
}

export interface AgentSurfaceCapabilities {
  cursorAgent: boolean;
  providers: AgentHandoffCapability[];
}

export interface AgentSurfaceCapabilitySource extends vscode.Disposable {
  readonly onDidChange: vscode.Event<void>;
  read(): AgentSurfaceCapabilities;
  refresh(): Promise<void>;
}

export function getImmediateAgentSurfaceCapabilities(): AgentSurfaceCapabilities;
export function resolveAgentSurfaceCapabilities(): Promise<AgentSurfaceCapabilities>;
export function createAgentSurfaceCapabilitySource(): AgentSurfaceCapabilitySource;

export async function handoffSelectionToAgentId(
  agentId: ExternalAgentId,
  contextUri: vscode.Uri,
  attachmentUris?: readonly vscode.Uri[],
): Promise<boolean>;
```

- Preserves:

```ts
export async function handoffSelectionToAgent(
  contextUri: vscode.Uri,
  attachmentUris?: readonly vscode.Uri[],
): Promise<AgentId | undefined>;

export async function handoffSelectionToCursor(
  contextUri: vscode.Uri,
  attachmentUris?: readonly vscode.Uri[],
): Promise<boolean>;
```

- Claude data commands are exactly:

```ts
const CLAUDE_HANDOFF_COMMANDS = [
  'claude-vscode.insertAtMention',
  'claude-code.insertAtMentioned',
] as const;
```

`claude-vscode.focus` is not a fallback data command.

- [ ] **Step 1: Add failing provider-capability tests**

In `agentHandoff.test.mjs`, add a helper that supplies installed extension
records with `packageJSON.contributes.commands`, `isActive`, and `activate`.
Add these RED cases:

```js
test('cold installed providers are visible before activation', () => {
  const capabilities = getImmediateAgentSurfaceCapabilities();
  assert.deepEqual(capabilities, {
    cursorAgent: false,
    providers: [
      { id: 'codex', label: 'Codex' },
      { id: 'claude', label: 'Claude Code' },
      { id: 'codebuddy', label: 'CodeBuddy' },
    ],
  });
});

test('focus-only Claude does not produce a handoff capability', () => {
  assert.deepEqual(getImmediateAgentSurfaceCapabilities().providers, []);
});

test('explicit cold Codex handoff activates, refreshes commands, then attaches', async () => {
  assert.equal(await handoffSelectionToAgentId('codex', selection, [crop]), true);
  assert.deepEqual(order, [
    'activate:openai.chatgpt',
    'getCommands',
    'chatgpt.addFileToThread:selection.md',
    'chatgpt.addFileToThread:selection.png',
  ]);
});

test('explicit activation failure does not fall back to another provider', async () => {
  assert.equal(await handoffSelectionToAgentId('codex', selection), false);
  assert.deepEqual(executedCommands, []);
  assert.match(warnings[0], /Codex could not be activated/);
});
```

Also assert `cursorAgent` is true only when
`vscode.env.appName.toLowerCase()` contains `cursor`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --test-name-pattern="cold installed|focus-only Claude|explicit cold|activation failure" packages/vscode-extension/test/agentHandoff.test.mjs
```

Expected: FAIL because the capability and explicit-ID APIs do not exist, Claude
still treats a focus command as a fallback, and no explicit activation path
exists.

- [ ] **Step 3: Implement cached manifest-and-registry capabilities**

Refactor the provider registry so each external provider declares:

```ts
interface AgentChoice extends vscode.QuickPickItem {
  id: AgentId;
  commands: readonly string[];
  extensionIds?: readonly string[];
}
```

Implement a safe manifest command reader:

```ts
function contributedCommandIds(extension: vscode.Extension<unknown>): Set<string> {
  const commands = extension.packageJSON?.contributes?.commands;
  if (!Array.isArray(commands)) return new Set();
  return new Set(commands.flatMap(item =>
    item && typeof item.command === 'string' ? [item.command] : []
  ));
}
```

The capability source must:

- publish a synchronous manifest-derived snapshot immediately;
- asynchronously union `vscode.commands.getCommands(true)` with manifest
  contributions without activating providers;
- keep the expected installed extension ID as a mandatory gate;
- refresh initially and after `vscode.extensions.onDidChange`;
- discard out-of-order async refresh results and emit only semantic changes;
- preserve valid manifest capabilities when command enumeration fails;
- accept any configured extension-ID casing variant;
- require at least one real provider data command in the manifest or registry;
- ignore `isActive`;
- return providers in Codex, Claude Code, CodeBuddy order;
- compute `cursorAgent` from the host product name, not Cursor composer state.

- [ ] **Step 4: Implement explicit activation and dispatch**

`handoffSelectionToAgentId()` must resolve exactly one external provider,
activate its installed extension when `!extension.isActive`, then call
`vscode.commands.getCommands(true)` and choose the first supported registered
data command. Wrap activation and invocation separately so warnings name the
provider and the function returns `false` without rerouting.

Move the existing Codex, Claude, and CodeBuddy command shapes into one internal
`executeAgentHandoff(agent, command, contextUri, attachmentUris)` adapter used
by both the explicit API and the picker API. Keep Cursor in its direct adapter.

- [ ] **Step 5: Run the complete handoff test file and verify GREEN**

Run:

```bash
node --test packages/vscode-extension/test/agentHandoff.test.mjs
```

Expected: all tests pass, including existing picker and Cursor behavior.

- [ ] **Step 6: Commit the capability service**

```bash
git add packages/vscode-extension/src/agentHandoff.ts packages/vscode-extension/test/agentHandoff.test.mjs
git commit -m "feat: add explicit agent handoff capabilities"
```

---

### Task 2: Make the exported visual evidence a portable sibling link

**Files:**
- Modify: `packages/vscode-extension/src/agentContext.ts`
- Modify: `packages/vscode-extension/test/agentContext.test.mjs`

**Interfaces:**
- Produces the exact Markdown line:

```md
**Visual evidence**: [selection.png](./selection.png) when present
```

- Preserves immutable export directories and latest aliases for
  `selection.md`, `selection.json`, and optional `selection.png`.

- [ ] **Step 1: Write failing exact-link and stale-image tests**

Change the Markdown assertions in `agentContext.test.mjs` to require:

```js
assert.match(
  markdown,
  /\*\*Visual evidence\*\*: \[selection\.png\]\(\.\/selection\.png\) when present/,
);
```

Extend the existing sequential-export test so an export with a crop followed
by one without a crop asserts:

```js
assert.equal(existsSync(join(vaultRoot, '.hl', 'agent', 'selection.png')), false);
assert.match(
  readFileSync(second.markdownPath, 'utf8'),
  /\[selection\.png\]\(\.\/selection\.png\) when present/,
);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test --test-name-pattern="portable|crop|Visual evidence" packages/vscode-extension/test/agentContext.test.mjs
```

Expected: FAIL because the current export renders `selection.png` as inline
code instead of a relative Markdown link.

- [ ] **Step 3: Replace the visual-evidence line**

In `agentContext.ts`, change only the generated line:

```ts
    : ''}**Visual evidence**: [selection.png](./selection.png) when present
```

Do not alter attachment publication, alias confinement, Source links, hashes,
or crop validation.

- [ ] **Step 4: Run the complete export tests and verify GREEN**

Run:

```bash
node --test packages/vscode-extension/test/agentContext.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit the portable image link**

```bash
git add packages/vscode-extension/src/agentContext.ts packages/vscode-extension/test/agentContext.test.mjs
git commit -m "fix: link selection visual evidence"
```

---

### Task 3: Wire explicit handoff commands and PDF host capabilities

**Files:**
- Modify: `packages/vscode-extension/src/extension.ts`
- Modify: `packages/vscode-extension/src/pdfEditorProvider.ts`
- Modify: `packages/vscode-extension/package.json`
- Modify: `packages/vscode-extension/test/extensionActivation.test.mjs`
- Modify: `packages/vscode-extension/test/pdfSelectionContext.test.mjs`
- Modify: `packages/vscode-extension/test/buildArtifacts.test.mjs`

**Interfaces:**
- Consumes from Task 1:

```ts
createAgentSurfaceCapabilitySource(): AgentSurfaceCapabilitySource;
handoffSelectionToAgentId(
  agentId: ExternalAgentId,
  contextUri: vscode.Uri,
  attachmentUris?: readonly vscode.Uri[],
): Promise<boolean>;
handoffSelectionToCursor(
  contextUri: vscode.Uri,
  attachmentUris?: readonly vscode.Uri[],
): Promise<boolean>;
```

- Extends `PdfEditorProviderOptions` with:

```ts
agentCapabilities?: () => AgentSurfaceCapabilities;
onDidChangeAgentCapabilities?: vscode.Event<void>;
```

- Produces:

```ts
export const ADD_SELECTION_TO_AGENT_COMMAND =
  'human-learning.addSelectionToAgent';

interface AddSelectionToAgentInput extends AddSelectionToChatInput {
  agentId: ExternalAgentId;
}
```

- Host-to-webview message:

```ts
{
  type: 'agentHandoffCapabilities';
  cursorAgent: boolean;
  providers: AgentHandoffCapability[];
}
```

- Webview-to-host selection action:

```ts
{
  type: 'selectionAction';
  action: 'sendToAgent';
  agentId: ExternalAgentId;
  anchor: PdfSelectionAnchor;
  snapshotPngBase64?: string;
}
```

- [ ] **Step 1: Write failing extension routing tests**

In `extensionActivation.test.mjs`, mock
`handoffSelectionToAgentId` and `handoffSelectionToCursor` separately. Assert:

```js
await registered['human-learning.addSelectionToAgent']({
  agentId: 'codex',
  selection,
  snapshotPng,
});
assert.deepEqual(explicitCalls, [{
  agentId: 'codex',
  markdownPath: exported.markdownPath,
  attachments: [exportedCropPath],
}]);

await registered['human-learning.addSelectionToCursorChat']({
  selection,
  snapshotPng,
});
assert.deepEqual(cursorCalls, [{
  markdownPath: exported.markdownPath,
  attachments: [exportedCropPath],
}]);
assert.deepEqual(pickerCalls, []);
```

Also assert activation owns exactly one capability source, adds it to
`context.subscriptions`, and provider construction receives a getter backed by
`source.read()` plus `source.onDidChange`.
Assert activation sets:

```js
['setContext', 'humanLearningHostIsCursor', false] // VS Code
['setContext', 'humanLearningHostIsCursor', true]  // Cursor
```

In `buildArtifacts.test.mjs`, replace the provider-neutral generic-action test
with assertions that every menu/keybinding contribution for
`human-learning.addSelectionToChat` contains `humanLearningHostIsCursor`, while
`human-learning.addSelectionToContext` remains available in both products.

- [ ] **Step 2: Write failing PDF provider protocol tests**

In `pdfSelectionContext.test.mjs`:

- deliver a `ready` message and assert `agentHandoffCapabilities` is posted
  before `loadPdf`;
- fire the injected capability-change event and assert all live PDF webviews
  receive a refreshed payload;
- invoke `handleSelectionAction(pdfUri, 'sendToAgent', anchor, png, 'codex')`
  and assert `human-learning.addSelectionToAgent` receives the normalized
  selection, agent ID, and validated PNG;
- assert an invalid agent ID produces no command call.

- [ ] **Step 3: Run focused host tests and verify RED**

Run:

```bash
pnpm --filter human-learning-vscode build
node --test --test-name-pattern="explicit agent|agent handoff capabilities|Cursor handoff routes" packages/vscode-extension/test/extensionActivation.test.mjs packages/vscode-extension/test/pdfSelectionContext.test.mjs
```

Expected: FAIL because the explicit command, capability callbacks, and provider
action do not exist, and the Cursor alias still uses generic target selection.

- [ ] **Step 4: Split generic, Cursor, and explicit command handlers**

In `extension.ts`, introduce:

```ts
type SelectionHandoffTarget =
  | { kind: 'picker' }
  | { kind: 'cursor' }
  | { kind: 'agent'; agentId: ExternalAgentId };
```

Add `target: SelectionHandoffTarget` to `exportSelectionAndHandoff()`. After the
shared Markdown/crop export:

```ts
const sent = target.kind === 'cursor'
  ? await handoffSelectionToCursor(markdownUri, attachments)
  : target.kind === 'agent'
    ? await handoffSelectionToAgentId(target.agentId, markdownUri, attachments)
    : (await handoffSelectionToAgent(markdownUri, attachments)) !== undefined;
```

Register:

- `human-learning.addSelectionToChat` with `{ kind: 'picker' }`;
- `human-learning.addSelectionToCursorChat` with `{ kind: 'cursor' }`;
- `human-learning.addSelectionToAgent` after validating
  `agentId ∈ {'codex','claude','codebuddy'}`.

Keep the existing PDF re-request behavior when a command is invoked without an
explicit selection.

Set `humanLearningHostIsCursor` during activation from the capability source's
immediate `read().cursorAgent` snapshot. In `package.json`, add
`"enablement": "humanLearningHostIsCursor"` to the generic Add to Chat command
and add `humanLearningHostIsCursor &&` to all of its menu/keybinding `when`
clauses. Do not gate **Send Selection to Agent…**.

- [ ] **Step 5: Add PDF capability and explicit-action plumbing**

Pass these options when constructing `PdfEditorProvider`:

```ts
agentCapabilities: () => agentCapabilitySource.read(),
onDidChangeAgentCapabilities: agentCapabilitySource.onDidChange,
```

In `PdfEditorProvider`:

- store the capability callback;
- subscribe through `context.subscriptions`;
- post the normalized capability message before PDF loading on `ready`;
- broadcast it to every live webview on the change event;
- add `'sendToAgent'` to the validated action union;
- validate the external agent ID;
- route it through `ADD_SELECTION_TO_AGENT_COMMAND`;
- retain `'addToCursorChat'` as the direct Cursor action.

Remove the unconditional generated-HTML assignment
`window.__humanLearningAddToCursorChat = true`; capability messages are now
authoritative.

- [ ] **Step 6: Run focused host tests and verify GREEN**

Run the command from Step 3.

Expected: all selected tests pass.

- [ ] **Step 7: Commit the host protocol**

```bash
git add packages/vscode-extension/src/extension.ts packages/vscode-extension/src/pdfEditorProvider.ts packages/vscode-extension/package.json packages/vscode-extension/test/extensionActivation.test.mjs packages/vscode-extension/test/pdfSelectionContext.test.mjs packages/vscode-extension/test/buildArtifacts.test.mjs
git commit -m "feat: route explicit PDF agent handoffs"
```

---

### Task 4: Render provider-specific PDF actions responsively

**Files:**
- Modify: `packages/pdf-editor/src/webview/pdf-viewer.ts`
- Modify: `packages/vscode-extension/test/e2e/pdf-viewer.html`
- Modify: `packages/vscode-extension/test/e2e/pdf-viewer.spec.ts`

**Interfaces:**
- Consumes the host-to-webview and webview-to-host messages from Task 3.
- Produces selection buttons and context-menu items in this fixed order:
  Cursor Add to Chat, Codex, Claude Code, CodeBuddy.

- [ ] **Step 1: Add failing VS Code/Cursor matrix tests**

Teach `pdf-viewer.html` to translate query parameters into an
`agentHandoffCapabilities` host message after `ready`:

```js
const params = new URLSearchParams(window.location.search);
window.postMessage({
  type: 'agentHandoffCapabilities',
  cursorAgent: params.get('host') === 'cursor',
  providers: (params.get('agents') ?? '')
    .split(',')
    .filter(Boolean)
    .map(id => ({
      id,
      label: id === 'codex'
        ? 'Codex'
        : id === 'claude'
          ? 'Claude Code'
          : 'CodeBuddy',
    })),
}, '*');
```

Add Playwright tests:

```ts
test('stock VS Code shows only installed provider actions', async ({ page }) => {
  await page.goto('/pdf-viewer.html?host=vscode&agents=codex,claude');
  await selectPdfTextRange(page, 0, 26);
  await expect(page.locator('#selection-toolbar button')).toHaveText([
    'Copy Link',
    'Send to Codex',
    'Send to Claude Code',
  ]);
  await expect(page.getByText('Add to Chat', { exact: true })).toHaveCount(0);
});

test('Cursor keeps Add to Chat and installed provider actions', async ({ page }) => {
  await page.goto('/pdf-viewer.html?host=cursor&agents=codex,claude,codebuddy');
  await selectPdfTextRange(page, 0, 26);
  await expect(page.locator('#selection-toolbar button')).toHaveText([
    'Copy Link',
    /Add to Chat/,
    'Send to Codex',
    'Send to Claude Code',
    'Send to CodeBuddy',
  ]);
});

test('explicit provider action posts its ID and crop', async ({ page }) => {
  await page.getByRole('button', { name: 'Send to Codex' }).click();
  expect(await waitForSelectionAction(page, 'sendToAgent')).toMatchObject({
    action: 'sendToAgent',
    agentId: 'codex',
    snapshotPngBase64: expect.any(String),
  });
});
```

Mirror the exact action matrix in the right-click menu and add a test that a
second capability message changes actions in the already-open viewer.

- [ ] **Step 2: Run focused Playwright tests and verify RED**

Run:

```bash
pnpm --filter human-learning-vscode build
pnpm exec playwright test packages/vscode-extension/test/e2e/pdf-viewer.spec.ts -g "installed provider|explicit provider|Cursor keeps|capability message"
```

Expected: FAIL because the webview still reads a static Cursor flag and has no
provider action UI.

- [ ] **Step 3: Implement validated webview capability state**

In `pdf-viewer.ts`, replace the static
`__humanLearningAddToCursorChat` flag with class state initialized to:

```ts
private agentCapabilities: AgentSurfaceCapabilities = {
  cursorAgent: false,
  providers: [],
};
```

Add a validator that accepts only unique `codex`, `claude`, and `codebuddy`
entries, applies canonical labels, and preserves fixed provider order. Handle
`agentHandoffCapabilities` in `setupMessages()`.

Use `this.agentCapabilities.cursorAgent` for Cmd/Ctrl+L and the direct Cursor
action.

- [ ] **Step 4: Render explicit toolbar and context-menu actions**

Extend `PdfTextSelectionAction` with `'sendToAgent'`. Change
`postTextSelectionAction()` to accept an optional `agentId`; include crop data
for both `'addToCursorChat'` and `'sendToAgent'`.

After **Copy Link**:

```ts
if (this.agentCapabilities.cursorAgent) {
  addCursorButton();
}
for (const provider of this.agentCapabilities.providers) {
  addButton(`Send to ${provider.label}`, 'sendToAgent', 'secondary', provider.id);
}
```

Build right-click items from the same capability state and ordering. Every
provider button/menu item must have an accessible name equal to its visible
label.

- [ ] **Step 5: Make the expanded toolbar safe on narrow panes**

Update both production and fixture CSS:

```css
.selection-toolbar {
  max-width: calc(100vw - 24px);
  flex-wrap: wrap;
  justify-content: center;
}
```

Keep all colors derived from existing VS Code variables. Add a Playwright case
with a 320-pixel viewport that asserts the toolbar bounding box stays within
12 pixels of both viewport edges and every button remains visible.

- [ ] **Step 6: Run the complete PDF viewer suite and verify GREEN**

Run:

```bash
pnpm exec playwright test packages/vscode-extension/test/e2e/pdf-viewer.spec.ts
```

Expected: all PDF viewer tests pass.

- [ ] **Step 7: Commit the provider UI**

```bash
git add packages/pdf-editor/src/webview/pdf-viewer.ts packages/vscode-extension/test/e2e/pdf-viewer.html packages/vscode-extension/test/e2e/pdf-viewer.spec.ts
git commit -m "feat: show explicit PDF agent actions"
```

---

### Task 5: Refresh vault guidance and verify tracked regression coverage

**Files:**
- Modify locally: `demo-vault/AGENTS.md`
- Modify locally: `demo-vault/CLAUDE.md`
- Modify locally: `demo-vault/.agents/skills/human-learning/SKILL.md`
- Modify locally: `demo-vault/.claude/commands/hl-explain-selection.md`
- Modify: `packages/vscode-extension/test/buildArtifacts.test.mjs`

**Interfaces:**
- Consumes the final Cursor/VS Code action matrix and Claude linked-image
  contract.
- Produces current local vault instructions without force-adding ignored demo
  data.

- [ ] **Step 1: Write exact documentation assertions**

Add a production-bundle test to `buildArtifacts.test.mjs`:

```js
test('production PDF bundle contains explicit provider actions and no static Cursor flag', () => {
  const bundle = readFileSync(join(dist, 'pdf-viewer.js'), 'utf8');
  for (const value of [
    'agentHandoffCapabilities',
    'Send to Codex',
    'Send to Claude Code',
    'Send to CodeBuddy',
  ]) assert.equal(bundle.includes(value), true);
  assert.equal(bundle.includes('__humanLearningAddToCursorChat'), false);
});
```

Required vault wording:

- Cursor **Add to Chat** targets Cursor Agent.
- **Send to Codex**, **Send to Claude Code**, and **Send to CodeBuddy** are
  explicit installed-provider actions and never submit.
- VS Code has no ambiguous generic PDF Add to Chat action.
- Claude uses the linked `selection.png` visual evidence from `selection.md`.

Forbidden wording:

- “Add to Chat targets a compatible supported agent”
- any claim that Claude receives a native image attachment
- any instruction to invent or rewrite a PDF URL

- [ ] **Step 2: Update the four local vault guidance files**

Preserve current Source-link, immutable `.hlanchor`, theme, Vim, outline, and
`raw/` rules. Replace only the stale provider-neutral action wording with the
approved explicit matrix and linked-image behavior.

Do not edit `.gitignore` and do not force-add `demo-vault/`.

- [ ] **Step 3: Build production artifacts and run all Node tests**

Run:

```bash
pnpm --filter human-learning-vscode test
```

Expected: production bundles build and every extension Node test passes.

- [ ] **Step 4: Audit generated bundles and vault wording**

Run:

```bash
rg -n "Send to Codex|Send to Claude Code|Send to CodeBuddy|agentHandoffCapabilities" packages/vscode-extension/dist/pdf-viewer.js
rg -n "Add to Chat targets a compatible supported agent|native image attachment" demo-vault/AGENTS.md demo-vault/CLAUDE.md demo-vault/.agents/skills/human-learning/SKILL.md demo-vault/.claude/commands/hl-explain-selection.md
```

Expected: the bundle contains all explicit capabilities; the forbidden vault
wording search returns no matches.

- [ ] **Step 5: Commit any tracked regression-test adjustment**

```bash
git add packages/vscode-extension/test/buildArtifacts.test.mjs
git commit -m "test: cover explicit agent handoff bundle"
```

The ignored local vault files remain present for the user's workspace and are
reported in the final handoff.

---

### Task 6: Run full verification and cold-start product checks

**Files:**
- Create ignored evidence/report files under:
  `.superpowers/sdd/2026-08-12-explicit-agent-handoff-buttons/`
- Do not modify product source unless verification exposes a product defect.

**Interfaces:**
- Consumes the production bundles and all provider actions from Tasks 1–5.
- Produces automated and live evidence for completion.

- [ ] **Step 1: Run repository checks**

Run:

```bash
pnpm check
git diff --check
```

Expected: lint, typecheck, core tests, extension tests, and whitespace checks
all pass.

- [ ] **Step 2: Run the complete Playwright suite**

Run:

```bash
pnpm exec playwright test
```

Expected: all non-skipped tests pass. If an unrelated test flakes, preserve its
artifact, rerun that exact test at least three times, and report it separately;
do not weaken product assertions.

- [ ] **Step 3: Launch isolated cold Cursor and VS Code hosts**

Use unique user-data directories and remote-debugging ports. Load:

- the current Human Learning extension development path;
- each product's normal external-extension directory;
- `demo-vault`;
- the freshly built `dist/extension.js`.

Record process argv, PID/start time, Human Learning ID/version/activation,
external provider ID/version, and production bundle hashes.

- [ ] **Step 4: Verify the cold-start button matrix before activation**

In each host, open a real PDF before opening any provider. For Codex, Claude
Code, and CodeBuddy, record:

```text
installed = true
isActive = false
expected provider button = visible
```

In Cursor additionally verify **Add to Chat** is visible. In VS Code verify it
is absent.

- [ ] **Step 5: Verify each product action without submitting**

For every host/provider row:

1. Select a real PDF passage through Human Learning.
2. Click that provider's Human Learning button.
3. Confirm the provider changes to `isActive === true`.
4. Inspect its draft and verify `selection.md` arrived.
5. Verify PNG arrival for Codex, CodeBuddy, and Cursor.
6. For Claude, verify the inserted Markdown mention and the exact relative
   sibling-image line instead of a native PNG chip.
7. Confirm no message/history entry was submitted.

An authentication/onboarding or opaque UI that prevents draft inspection leaves
the row **unverified**. Activation and resolved command logs may be recorded as
supporting evidence but cannot upgrade the row to passing.

- [ ] **Step 6: Verify isolation and dynamic updates**

- Click Cursor **Add to Chat** and prove it invokes no Codex, Claude, or
  CodeBuddy command.
- Disable or remove one provider in an isolated profile and prove its action
  disappears from an already-open PDF after `extensions.onDidChange`.
- Re-enable it and prove its action returns without reloading the PDF.
- Confirm no provider action submits.

- [ ] **Step 7: Review the final diff and report**

Review:

```bash
git status --short
git diff --stat HEAD~4
git diff --check
```

Write a concise report with:

- exact commits;
- automated test totals;
- cold-start matrix with PASS/UNVERIFIED/FAIL;
- any narrowly evidenced provider limitation;
- confirmation that the local vault rules were updated but remain ignored;
- confirmation that no prompt was submitted.

Request an independent final code/spec review before claiming completion.
