# Markdown Native Autosave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Vim `o`/`O` edits in the Markdown document until VS Code's native save or autosave policy persists them.

**Architecture:** The webview continues to send complete-document edits through the provider's serialized `WorkspaceEdit` queue. The provider stops calling `TextDocument.save()` on its own timer; explicit save and close messages retain their existing queue flushes before delegating persistence to VS Code.

**Tech Stack:** TypeScript, VS Code Custom Text Editor API, CodeMirror 6/Vim, Playwright VS Code E2E.

## Global Constraints

- Preserve all unrelated dirty working-tree changes.
- Do not bypass configured save participants on explicit or native autosaves.
- Do not change Vim command semantics; only change host persistence ownership.
- Remove temporary cursor tracing after manual verification.

---

### Task 1: Protect Native Autosave Ownership

**Files:**
- Modify: `packages/vscode-extension/test/vscode-e2e/sandboxFixtures.mjs`
- Modify: `packages/vscode-extension/test/vscode-e2e/extension.spec.ts`
- Modify: `packages/vscode-extension/src/markdownEditorProvider.ts`
- Modify: `packages/vscode-extension/webview-src/markdown-editor.ts` (remove diagnostics only)

**Interfaces:**
- Consumes: the existing `VIM_SANDBOXES`, `openVimSandbox`, `ensureHostVimMode`, and `evaluateLlmWikiWebview` test helpers.
- Produces: Markdown custom-editor edits that remain dirty until VS Code saves them; no new production API.

- [ ] **Step 1: Add a dedicated sandbox fixture**

Add this entry to `VIM_SANDBOXES`:

```js
openLinePersistence: sandbox(
  'vim-open-line-persistence.md',
  'LLM Wiki E2E Vim open line persistence',
),
```

- [ ] **Step 2: Write the failing VS Code-hosted regression test**

Add this test beside the existing Vim host tests:

```ts
test('Vim normal-mode o keeps the inserted line until VS Code saves the document', async ({ vsCodePage: page }) => {
  const fixture = VIM_SANDBOXES.openLinePersistence;
  const initialNeedle = await openVimSandbox(page, fixture);
  await ensureHostVimMode(page, initialNeedle, true);
  const fixturePath = path.resolve(TEST_DIR, 'fixtures', 'test-vault', fixture.relativePath);
  const diskTextBefore = fs.readFileSync(fixturePath, 'utf8');

  await evaluateLlmWikiWebview(initialNeedle, `
    win.postMessage({
      type: 'setText',
      text: ['First line', 'Second line', 'Third line'].join('\\n'),
    }, '*');
    win.postMessage({ type: 'setVimMode', enabled: true }, '*');
    await new Promise(resolve => setTimeout(resolve, 100));
    const currentView = win.__cmView;
    currentView.dispatch({
      selection: { anchor: currentView.state.doc.line(2).from },
      scrollIntoView: true,
    });
    currentView.focus();
    return true;
  `);

  await page.keyboard.press('Escape');
  await page.keyboard.press('o');
  await page.waitForTimeout(600);

  const editorText = await evaluateLlmWikiWebview<string>('Second line', `
    return view.state.doc.toString();
  `);
  expect(editorText).toBe('First line\\nSecond line\\n\\nThird line');
  expect(fs.readFileSync(fixturePath, 'utf8')).toBe(diskTextBefore);
});
```

This test catches either manifestation of the current bug: a formatter-driven
host echo removes the line, or the extension saves the edit despite native
autosave being disabled.

- [ ] **Step 3: Run the regression test and verify RED**

Run:

```bash
pnpm --filter llm-wiki-vscode test:vscode-e2e --grep "Vim normal-mode o keeps"
```

Expected: FAIL because the current 150-millisecond timer either changes the
fixture on disk or sends formatted text back to the webview.

- [ ] **Step 4: Remove extension-owned delayed saving**

In `MarkdownEditorProvider.resolveCustomTextEditor`:

- Delete `autoSaveHandle`.
- Delete `clearAutoSave`.
- Delete `scheduleAutoSave`.
- Delete the `scheduleAutoSave()` call after `replaceDocument`.
- Delete `clearAutoSave()` calls from panel disposal, save, close, and
  save-and-close handlers.
- Keep `flushBeforeSave()`, `document.save()`, and native tab closing unchanged.

- [ ] **Step 5: Run the regression test and verify GREEN**

Run:

```bash
pnpm --filter llm-wiki-vscode test:vscode-e2e --grep "Vim normal-mode o keeps"
```

Expected: PASS; the line remains in the webview and the sandbox file is
unchanged on disk.

- [ ] **Step 6: Run focused and package verification**

Run:

```bash
pnpm --filter llm-wiki-vscode test
pnpm --filter llm-wiki-vscode build
pnpm --filter llm-wiki-vscode test:vscode-e2e --grep "Vim"
```

Expected: all commands pass.

- [ ] **Step 7: Manually verify the real formatter interaction**

Build and reload the latest Extension Development Host, open
`demo-vault/projects/nanochat.md`, enable Vim mode, navigate to a non-final
line, press `o`, and wait at least one second.

Expected: the new line remains and the editor stays in insert mode. Explicit
save may still apply the user's configured Markdown formatter.

- [ ] **Step 8: Remove diagnostic tracing and re-run verification**

Remove `debugCursorTrace`, the `LLM Wiki Cursor Trace` output channel, and all
trace helper/listener calls added to `markdown-editor.ts`. Re-run the focused
regression test and `pnpm --filter llm-wiki-vscode build`.
