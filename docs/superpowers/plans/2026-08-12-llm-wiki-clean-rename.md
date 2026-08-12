# LLM Wiki Clean Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the complete development-stage product and vault contract to LLM Wiki without retaining compatibility aliases.

**Architecture:** Apply the clean rename in four behaviorally testable boundaries: extension/package identity, secure vault exports and anchors, portable PDF annotation persistence, and webview/runtime surfaces. Finish with a mechanical documentation/fixture pass, a zero-prior-identity audit, fresh-vault and renamed-demo-vault smoke tests, and local integration into `main`.

**Tech Stack:** TypeScript 5.9, Node.js test runner, pnpm workspaces, VS Code extension manifests and APIs, webpack, Playwright, JSON-LD portable annotations.

## Global Constraints

- Product and UI copy is `LLM Wiki`.
- Vault state is stored only below `.llm_wiki/`.
- Repository metadata uses `llm_wiki`; npm and VS Code package-style identifiers use `llm-wiki`.
- npm workspace packages use the `@llm-wiki/*` scope.
- VS Code commands and custom editors use the `llm-wiki.*` namespace.
- TypeScript symbols and VS Code context keys use the `llmWiki` prefix; uppercase constants use `LLM_WIKI`.
- Generated passage-link files use `.llm_wiki_anchor`.
- Portable annotation properties use `llm_wiki:` and namespace `urn:llm_wiki:`.
- No compatibility aliases, runtime migration, fallback readers, or prior-format tests may remain.
- Preserve existing filesystem confinement, symlink rejection, atomic writes, immutable exports, and file modes.
- Preserve Markdown, PDF, Vim, theme, outline, annotation, and agent-handoff behavior.

---

### Task 1: Rename workspace and extension identity

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/core/package.json`
- Modify: `packages/pdf-editor/package.json`
- Modify: `packages/vscode-extension/package.json`
- Modify: `packages/vscode-extension/webpack.config.js`
- Modify: `packages/vscode-extension/src/extension.ts`
- Modify: `packages/vscode-extension/src/pdfEditorProvider.ts`
- Modify: `packages/vscode-extension/src/markdownEditorProvider.ts`
- Modify: `packages/vscode-extension/src/anchorFileEditorProvider.ts`
- Modify: `packages/vscode-extension/src/experimentalOwnedBrowserProtocol.ts`
- Modify: `packages/vscode-extension/src/knowledgeGraphPanel.ts`
- Modify: `packages/vscode-extension/src/markdownSymbols.ts`
- Modify: `packages/vscode-extension/src/backlinksProvider.ts`
- Modify: `packages/vscode-extension/src/linkProvider.ts`
- Modify: `packages/vscode-extension/src/uriDispatcher.ts`
- Test: `packages/vscode-extension/test/buildArtifacts.test.mjs`
- Test: `packages/vscode-extension/test/extensionActivation.test.mjs`
- Test: `packages/vscode-extension/test/markdownSymbols.test.mjs`
- Test: `packages/vscode-extension/test/backlinksProvider.test.mjs`
- Test: `packages/vscode-extension/test/uriDispatcher.test.mjs`

**Interfaces:**
- Produces: extension ID `llm-wiki.llm-wiki-vscode`, command/editor namespace `llm-wiki.*`, context prefix `llmWiki`, and workspace packages `@llm-wiki/core` and `@llm-wiki/pdf-editor`.
- Consumes: the naming contract in the design specification.

- [ ] **Step 1: Change manifest-facing tests to the new identity**

Update the build-artifact and activation expectations to assert literal new
values, including:

```js
assert.equal(manifest.name, 'llm-wiki-vscode');
assert.equal(manifest.displayName, 'LLM Wiki');
assert.equal(manifest.publisher, 'llm-wiki');
assert.equal(markdownEditor.viewType, 'llm-wiki.markdownEditor');
assert.deepEqual(anchorEditor.selector, [
  { filenamePattern: '*.llm_wiki_anchor' },
]);
assert.ok(vscode.__registeredCommands['llm-wiki.addSelectionToContext']);
assert.deepEqual(
  contextCall,
  ['setContext', 'llmWikiHostIsCursor', true],
);
```

Change existing outline, link, URI, command, editor-registration, keybinding,
view-container, and package-provenance expectations to the same identity.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm --filter ./packages/vscode-extension build
node --test \
  packages/vscode-extension/test/buildArtifacts.test.mjs \
  packages/vscode-extension/test/extensionActivation.test.mjs \
  packages/vscode-extension/test/markdownSymbols.test.mjs \
  packages/vscode-extension/test/backlinksProvider.test.mjs \
  packages/vscode-extension/test/uriDispatcher.test.mjs
```

Expected: failures report that manifests, package imports, command registrations,
editor IDs, and context keys still expose the prior identity.

- [ ] **Step 3: Apply the minimal workspace and extension rename**

Update package names, filters, dependencies, repository metadata, activation
events, custom editors, commands, keybindings, menus, views, context keys, URI
authorities, registered command strings, view types, UI copy, and corresponding
TypeScript symbol names. Update imports to:

```ts
import type { PdfTextFragment } from '@llm-wiki/core';
```

Use the repository URL:

```json
{
  "type": "git",
  "url": "https://github.com/t04dJ14n9/llm_wiki.git"
}
```

- [ ] **Step 4: Regenerate workspace metadata**

Run:

```bash
pnpm install --lockfile-only --offline
```

Expected: the lockfile workspace links use `@llm-wiki/core` and
`@llm-wiki/pdf-editor`, with no dependency download changes.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command again.

Expected: all selected tests pass.

- [ ] **Step 6: Commit the extension identity boundary**

```bash
git add package.json pnpm-lock.yaml packages/core/package.json \
  packages/pdf-editor/package.json packages/vscode-extension
git commit -m "refactor: rename extension to LLM Wiki"
```

### Task 2: Rename secure vault exports and generated anchors

**Files:**
- Modify: `packages/vscode-extension/src/agentContext.ts`
- Modify: `packages/vscode-extension/src/agentHandoff.ts`
- Modify: `packages/vscode-extension/src/anchorFileCodec.ts`
- Modify: `packages/vscode-extension/src/anchorFileEditorProvider.ts`
- Modify: `packages/vscode-extension/src/anchorUris.ts`
- Modify: `packages/vscode-extension/src/filesystemWiki.ts`
- Modify: `packages/vscode-extension/src/cursorBrowserSelection.ts`
- Test: `packages/vscode-extension/test/agentContext.test.mjs`
- Test: `packages/vscode-extension/test/agentHandoff.test.mjs`
- Test: `packages/vscode-extension/test/anchorFileEditorProvider.test.mjs`
- Test: `packages/vscode-extension/test/anchorUris.test.mjs`
- Test: `packages/vscode-extension/test/cursorBrowserSelection.test.mjs`
- Test: `packages/vscode-extension/test/filesystemWikiMetadata.test.mjs`

**Interfaces:**
- Produces: immutable exports below
  `.llm_wiki/agent/exports/<uuid>/`, latest aliases below
  `.llm_wiki/agent/`, and generated `source-<sha256>.llm_wiki_anchor` files.
- Consumes: the command and extension identity from Task 1.

- [ ] **Step 1: Change export and anchor tests to the new paths**

Use hand-derived expectations such as:

```js
assert.match(
  exported.anchorPath,
  /\.llm_wiki\/agent\/exports\/[^/]+\/source-[a-f0-9]{64}\.llm_wiki_anchor$/,
);
assert.equal(
  readFileSync(join(vaultRoot, '.llm_wiki', 'agent', 'selection.md'), 'utf8'),
  expectedMarkdown,
);
```

Retain all traversal, symlink, immutable-file, concurrent-alias, invalid-name,
and file-mode assertions with the renamed layout.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm --filter ./packages/vscode-extension build
node --test \
  packages/vscode-extension/test/agentContext.test.mjs \
  packages/vscode-extension/test/agentHandoff.test.mjs \
  packages/vscode-extension/test/anchorFileEditorProvider.test.mjs \
  packages/vscode-extension/test/anchorUris.test.mjs \
  packages/vscode-extension/test/cursorBrowserSelection.test.mjs \
  packages/vscode-extension/test/filesystemWikiMetadata.test.mjs
```

Expected: failures identify prior export directories, anchor suffixes, URI
authorities, or excluded-directory names.

- [ ] **Step 3: Rename production paths without weakening validation**

Change the export layout to:

```ts
for (const segment of ['.llm_wiki', 'agent', 'exports']) {
  // Existing lstat, mkdir, realpath, and confinement checks remain unchanged.
}
```

Change anchor construction and validation to:

```ts
fileName: `source-${hash}.llm_wiki_anchor`
/^source-([0-9a-f]{64})\.llm_wiki_anchor$/
```

Rename local variables such as the state-directory path so no abbreviated prior
identity remains, and update user-facing export messages.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command again.

Expected: all selected tests pass, including security and concurrency cases.

- [ ] **Step 5: Commit secure persistence rename**

```bash
git add packages/vscode-extension/src packages/vscode-extension/test
git commit -m "refactor: rename LLM Wiki vault exports"
```

### Task 3: Rename PDF persistence and portable annotation vocabulary

**Files:**
- Modify: `packages/core/src/pdf-discussions/store.ts`
- Modify: `packages/core/src/pdf-discussions/portable.ts`
- Modify: `packages/core/src/pdf-discussions/schema.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/vscode-extension/src/pdfDiscussionController.ts`
- Modify: `packages/vscode-extension/src/learningNoteStore.ts`
- Modify: `packages/vscode-extension/src/dailyNotes.ts`
- Test: `packages/core/test/pdf-discussions.test.mjs`
- Test: `packages/core/test/pdf-portable-annotations.test.mjs`
- Test: `packages/vscode-extension/test/pdfDiscussionController.test.mjs`
- Test: `packages/vscode-extension/test/pdfDiscussionHostIntegration.test.mjs`
- Test: `packages/vscode-extension/test/learningNoteStore.test.mjs`
- Test: `packages/vscode-extension/test/dailyNotes.test.mjs`

**Interfaces:**
- Produces: PDF state below `.llm_wiki/annotations/pdf/` and portable
  annotations using `llm_wiki:` properties and `urn:llm_wiki:` identifiers.
- Consumes: renamed package imports from Task 1 and renamed vault root from
  Task 2.

- [ ] **Step 1: Change persistence and JSON-LD tests to the new contract**

Use literal expected data:

```js
assert.equal(result.id, 'urn:llm_wiki:annotation:discussion-1');
assert.deepEqual(result['@context'], [
  'http://www.w3.org/ns/anno.jsonld',
  { llm_wiki: 'urn:llm_wiki:' },
]);
assert.equal(
  selector(result, 'llm_wiki:PdfRectSelector')['llm_wiki:unit'],
  'pt',
);
assert.equal(
  result['llm_wiki:snapshot'].id,
  '../../assets/discussion-1/selection.png',
);
```

Retain malformed-vocabulary, traversal, symlink, damaged-record, conflict, and
snapshot-validation coverage.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm --filter @llm-wiki/core test
node --test \
  packages/vscode-extension/test/pdfDiscussionController.test.mjs \
  packages/vscode-extension/test/pdfDiscussionHostIntegration.test.mjs \
  packages/vscode-extension/test/learningNoteStore.test.mjs \
  packages/vscode-extension/test/dailyNotes.test.mjs
```

Expected: tests fail on the old state root, namespace, compact properties,
selectors, annotation URNs, and generated note markers.

- [ ] **Step 3: Apply the minimal persistence and vocabulary rename**

Export:

```ts
export const LLM_WIKI_CONTEXT = 'urn:llm_wiki:';
```

Update `@context`, annotation IDs, compact properties, selectors, scanners,
relative snapshot paths, note markers, trusted temporary-directory prefixes,
and PDF controller copy. Keep the existing parser strict: records using any
other context or compact vocabulary remain invalid.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command again.

Expected: all selected core and extension tests pass.

- [ ] **Step 5: Commit PDF persistence rename**

```bash
git add packages/core packages/vscode-extension/src \
  packages/vscode-extension/test
git commit -m "refactor: rename LLM Wiki PDF persistence"
```

### Task 4: Rename webview runtime surfaces and complete test fixtures

**Files:**
- Modify: `packages/pdf-editor/src/webview/pdf-viewer.ts`
- Modify: `packages/pdf-editor/src/webview/pdfAskPanelStyles.ts`
- Modify: `packages/vscode-extension/webview-src/markdown-editor.ts`
- Modify: `packages/vscode-extension/webview-src/markdownTheme.ts`
- Modify: `packages/vscode-extension/webview-src/webviewClipboard.ts`
- Modify: `packages/vscode-extension/webview-src/extensions/hybridRendering.ts`
- Modify: `packages/vscode-extension/src/codexAppServerClient.ts`
- Modify: `packages/vscode-extension/src/experimentalOwnedBrowser.ts`
- Modify: all remaining files below `packages/vscode-extension/test/`
- Test: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts`
- Test: `packages/vscode-extension/test/e2e/pdf-viewer.spec.ts`
- Test: `packages/vscode-extension/test/codexAppServerClient.test.mjs`
- Test: `packages/vscode-extension/test/experimentalOwnedBrowser.test.mjs`

**Interfaces:**
- Produces: renamed DOM events, CSS identifiers, webview capability globals,
  temporary identifiers, app-server metadata, titles, accessible labels, and
  complete test fixtures.
- Consumes: all runtime identifiers from Tasks 1–3.

- [ ] **Step 1: Change representative browser tests to the new runtime names**

Update fixtures and assertions so Markdown and PDF pages initialize only the
new globals and events. Add a representative browser assertion:

```ts
await expect(page.getByRole('toolbar', { name: 'PDF toolbar' })).toBeVisible();
await expect(page).toHaveTitle('LLM Wiki PDF');
```

The second assertion is limited to the controlled fixture copy and does not
replace functional toolbar, selection, handoff, or editor behavior assertions.

- [ ] **Step 2: Run representative tests and verify RED**

Run:

```bash
pnpm --filter llm-wiki-vscode build
pnpm exec playwright test \
  packages/vscode-extension/test/e2e/markdown-editor.spec.ts \
  packages/vscode-extension/test/e2e/pdf-viewer.spec.ts \
  -g "identity|provider action matrix|selection export"
```

Expected: at least one fixture/runtime assertion fails because the webview
still exposes prior globals, event names, CSS names, or UI copy.

- [ ] **Step 3: Rename webview and host runtime identifiers**

Rename exported/imported highlight styles, Vim action names, DOM custom events,
CSS selectors, globals, URI exclusions, temporary crop IDs, Ask style IDs,
app-server client metadata, experimental reader IDs, HTML titles, and accessible
labels. Preserve event payloads and behavior.

- [ ] **Step 4: Complete the mechanical test-fixture rename**

Update every remaining test double, fixture URI, expected path, command key,
view type, context key, source marker, and package import below
`packages/vscode-extension/test/`. Do not delete behavior assertions to make the
rename pass.

- [ ] **Step 5: Run extension Node and browser suites**

Run:

```bash
pnpm --filter ./packages/vscode-extension test
pnpm exec playwright test \
  packages/vscode-extension/test/e2e/markdown-editor.spec.ts \
  packages/vscode-extension/test/e2e/pdf-viewer.spec.ts
```

Expected: all extension Node tests and both complete browser files pass.

- [ ] **Step 6: Commit runtime and fixture rename**

```bash
git add packages/pdf-editor packages/vscode-extension
git commit -m "refactor: rename LLM Wiki runtime surfaces"
```

### Task 5: Rename documentation, configuration, and demo vault

**Files:**
- Modify: `README.md`
- Modify: `packages/pdf-editor/README.md`
- Modify: `packages/vscode-extension/README.md`
- Modify: `.github/workflows/quality.yml`
- Modify: `.gitignore`
- Modify: `.vscode/launch.json`
- Modify: all Markdown files below `docs/`
- Rename to: `docs/superpowers/specs/2026-05-24-llm-wiki-mvp-design.md`
- Rename to: `docs/superpowers/plans/2026-05-24-llm-wiki-mvp.md`
- Modify ignored integration data: `demo-vault/AGENTS.md`
- Modify ignored integration data: `demo-vault/CLAUDE.md`
- Rename ignored integration data to: `demo-vault/.agents/skills/llm-wiki/`
- Rename ignored integration data to: `demo-vault/.claude/commands/llm-wiki-explain-selection.md`
- Rename ignored integration data to: `demo-vault/.llm_wiki/`
- Modify: `packages/vscode-extension/test/vscode-e2e/fixtures/test-vault/AGENTS.md`
- Modify: `packages/vscode-extension/test/vscode-e2e/fixtures/test-vault/CLAUDE.md`

**Interfaces:**
- Produces: generic LLM Wiki documentation and a live demo vault using only the
  new state directory and provider instructions.
- Consumes: final behavior and names from Tasks 1–4.

- [ ] **Step 1: Rename tracked documentation and configuration**

Update commands, package filters, paths, diagrams, examples, vault trees,
architecture tables, troubleshooting instructions, launch names, CI filters,
and ignore rules. Rename the two MVP design/plan filenames to use `llm-wiki`.
Keep historical decisions accurate while describing the product only as LLM
Wiki.

- [ ] **Step 2: Rename the ignored demo-vault integration files**

Before moving state, verify `demo-vault/.llm_wiki` does not exist. Move the
existing prior state directory atomically to `demo-vault/.llm_wiki`, rename the
project skill and Claude command paths, then update their contents and both
vault instruction files. Preserve all state bytes and permissions.

- [ ] **Step 3: Build and run documentation command examples**

Run:

```bash
pnpm --filter @llm-wiki/core test
pnpm --filter llm-wiki-vscode test
pnpm build
```

Expected: all documented package filters resolve, tests pass, and production
bundles build.

- [ ] **Step 4: Audit tracked current files for prior identity**

Run a literal audit across tracked code, tests, documentation, JSON, YAML,
JavaScript, TypeScript, Markdown, and lockfiles. The audit must return no prior
product name, package/command stem, camel/uppercase prefix, state directory,
generated-anchor suffix, or JSON-LD vocabulary. Inspect every match rather than
blanket-excluding files.

- [ ] **Step 5: Commit tracked documentation and configuration**

```bash
git add README.md packages docs .github .gitignore .vscode package.json \
  pnpm-lock.yaml
git commit -m "docs: rename project to LLM Wiki"
```

### Task 6: Full verification, live smoke, and main integration

**Files:**
- Verify only; fix scoped defects in the owning task files and commit them
  separately before integration.

**Interfaces:**
- Consumes: the complete clean rename.
- Produces: fresh automated and live evidence on the feature branch and merged
  `main`.

- [ ] **Step 1: Run static and package verification**

Run:

```bash
pnpm check
git diff --check
```

Expected: both commands exit 0 with no lint, type, unit, integration, or
whitespace failures.

- [ ] **Step 2: Run the full browser suite**

Run:

```bash
pnpm exec playwright test
```

Expected: zero failures; intentional manual skips are reported separately.

- [ ] **Step 3: Verify clean and existing vault behavior**

Launch an isolated VS Code or Cursor Extension Development Host against a fresh
temporary vault and confirm it creates `.llm_wiki/` only. Reload the existing
`demo-vault`, then verify:

- Markdown and PDF editors open;
- Markdown Outline and PDF Outline render;
- a PDF selection export creates
  `.llm_wiki/agent/exports/<id>/selection.{md,json,png}`;
- the Source link targets a `.llm_wiki_anchor`;
- one available agent action prepares context without submitting.

- [ ] **Step 4: Re-run the identity audit and inspect Git state**

Confirm the tracked audit has zero matches, the prior demo state directory is
absent, `demo-vault/.llm_wiki` exists, and `git status --short` contains only
intended tracked changes or is clean after commits.

- [ ] **Step 5: Merge locally into `main`**

From the primary checkout:

```bash
git switch main
git merge --ff-only codex/llm-wiki-clean-rename
```

Expected: fast-forward merge succeeds without rewriting existing main history.

- [ ] **Step 6: Verify the merged result**

Run on `main`:

```bash
pnpm check
pnpm exec playwright test
git diff --check
```

Expected: all commands exit 0. Remove the feature worktree and delete its local
branch only after this merged verification succeeds.
