# Active Markdown Link Source Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reveal the complete Markdown source for only the non-image link containing an empty caret, matching Obsidian live preview.

**Architecture:** Keep `activeInlineRevealSpans` as the caret-to-source-span decision point. Remove its compact-label exception so the existing rendered-decoration filter exposes the complete link source, while retaining the current image and non-empty-selection exclusions.

**Tech Stack:** TypeScript, CodeMirror 6 decorations, Playwright, pnpm.

## Global Constraints

- Reveal only the link containing the empty caret.
- Leave other links on the same line rendered and compact.
- Restore compact rendering when the caret leaves the link.
- Apply the same rule to ordinary, reference, and inline-code-label links.
- Preserve current image behavior.
- Preserve current non-empty-selection behavior.
- Do not change link resolution, navigation, persistence, or cursor-position preservation.

---

## File Structure

- Modify `packages/vscode-extension/test/e2e/markdown-editor.spec.ts`: add browser-level regression coverage for caret-scoped source reveal and restoration.
- Modify `packages/vscode-extension/webview-src/extensions/hybridRendering.ts`: remove only the compact-label suppression from active inline reveal calculation.
- Keep `packages/vscode-extension/webview-src/markdown-editor.ts` unchanged: its existing active-link marks already style the revealed label, punctuation, and destination.

### Task 1: Add caret-scoped link reveal regression coverage

**Files:**
- Test: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts`

**Interfaces:**
- Consumes: `window.__cmView: EditorView`, `.cm-line`, `.cm-llm-wiki-link`, `.cm-active-link-label`, `.cm-active-link-destination`, and `.cm-active-link-punctuation`.
- Produces: browser assertions that define the caret-scoped reveal contract.

- [ ] **Step 1: Write the failing ordinary-link regression test**

Add this test beside the existing active Markdown link tests:

```typescript
test('a caret inside a Markdown link label reveals only that link source', async ({ page }) => {
  await page.goto('http://localhost:8979/test.html');
  await waitForEditorBootstrap(page);
  await page.evaluate(() => {
    window.postMessage({
      type: 'setText',
      text: 'Read [code index](code/index.md) and [guide](guide.md).',
    }, '*');
  });

  await page.evaluate(() => {
    const view = window.__cmView;
    const line = view.state.doc.line(1);
    view.dispatch({
      selection: { anchor: line.from + line.text.indexOf('code index') + 2 },
    });
  });

  const line = page.locator('.cm-line').first();
  await expect(line).toHaveText('Read [code index](code/index.md) and guide.');
  await expect(line.locator('.cm-active-link-label')).toHaveText('code index');
  await expect(line.locator('.cm-active-link-destination')).toHaveText('code/index.md');
  await expect(line.locator('.cm-active-link-punctuation')).toHaveText(['[', '](', ')']);
  await expect(line.locator('.cm-llm-wiki-link')).toHaveText('guide');

  await page.evaluate(() => {
    const view = window.__cmView;
    const line = view.state.doc.line(1);
    view.dispatch({ selection: { anchor: line.to } });
  });

  await expect(line).toHaveText('Read code index and guide.');
  await expect(line.locator('.cm-llm-wiki-link')).toHaveText(['code index', 'guide']);
});
```

- [ ] **Step 2: Write the failing inline-code-label regression test**

Add a second focused test:

```typescript
test('a caret inside an inline-code link label reveals the complete enclosing link', async ({ page }) => {
  await page.goto('http://localhost:8979/test.html');
  await waitForEditorBootstrap(page);
  await page.evaluate(() => {
    window.postMessage({
      type: 'setText',
      text: 'Run [`runs/speedrun.sh`](code/nanochat/runs/speedrun.sh) first.',
    }, '*');
  });

  await page.evaluate(() => {
    const view = window.__cmView;
    const line = view.state.doc.line(1);
    view.dispatch({
      selection: { anchor: line.from + line.text.indexOf('speedrun') + 2 },
    });
  });

  const line = page.locator('.cm-line').first();
  await expect(line).toHaveText(
    'Run [`runs/speedrun.sh`](code/nanochat/runs/speedrun.sh) first.',
  );
  await expect(line.locator('.cm-active-link-label')).toContainText('runs/speedrun.sh');
  await expect(line.locator('.cm-active-link-destination')).toHaveText(
    'code/nanochat/runs/speedrun.sh',
  );
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter llm-wiki-vscode exec playwright test \
  test/e2e/markdown-editor.spec.ts \
  --grep "caret inside a Markdown link label|caret inside an inline-code link label" \
  --workers=1
```

Expected: both new tests fail because the label caret leaves the link compact and hides its destination.

### Task 2: Remove the compact-label reveal exception

**Files:**
- Modify: `packages/vscode-extension/webview-src/extensions/hybridRendering.ts:1393-1446`
- Test: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts`

**Interfaces:**
- Consumes: `inlineSourceSpans`, `imageSourceSpans`, and `EditorState.selection.ranges`.
- Produces: `activeInlineRevealSpans(state, lineFrom, text, referenceDefinitions): Span[]` with caret-scoped complete link spans.

- [ ] **Step 1: Implement the minimal reveal-rule change**

Reduce `activeInlineRevealSpans` to the existing caret and image checks:

```typescript
function activeInlineRevealSpans(
  state: EditorState,
  lineFrom: number,
  text: string,
  referenceDefinitions: ReturnType<typeof markdownReferenceDefinitions>,
): Span[] {
  const sourceSpans = inlineSourceSpans(lineFrom, text, referenceDefinitions);
  const imageSpans = imageSourceSpans(lineFrom, text, referenceDefinitions);
  const revealed: Span[] = [];
  for (const range of state.selection.ranges) {
    for (const span of sourceSpans) {
      const containsCaret = range.empty
        && range.head >= span.from
        && range.head < span.to;
      // A non-empty selection should retain the rendered live-preview labels.
      // The raw source remains available through copy/edit operations, while
      // revealing every URL and delimiter makes a paragraph selection noisy
      // and can expose hidden destinations that were not under the caret.
      if (!containsCaret) continue;

      // Keep the preview visible while the caret moves through an image source.
      if (
        range.head >= span.from
        && imageSpans.some(image => image.from === span.from && image.to === span.to)
      ) {
        continue;
      }

      revealed.push(span);
    }
  }
  return uniqueSpans(revealed);
}
```

- [ ] **Step 2: Run the focused tests and verify GREEN**

Run the Task 1 focused Playwright command.

Expected: both tests pass.

- [ ] **Step 3: Run adjacent regression tests**

Run:

```bash
pnpm --filter llm-wiki-vscode exec playwright test \
  test/e2e/markdown-editor.spec.ts \
  --grep "non-empty selections keep rendered links|active raw markdown lines still style link labels|active Markdown links separate|inline-code link labels use" \
  --workers=1
```

Expected: all selected tests pass, confirming selection, styling, and inactive compact rendering remain unchanged.

- [ ] **Step 4: Commit the implementation**

```bash
git add \
  packages/vscode-extension/test/e2e/markdown-editor.spec.ts \
  packages/vscode-extension/webview-src/extensions/hybridRendering.ts
git commit -m "fix: reveal active Markdown link source"
```

### Task 3: Verify the extension and Cursor host behavior

**Files:**
- Verify: `demo-vault/projects/nanochat.md`
- Verify: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts`
- Verify: `packages/vscode-extension/webview-src/extensions/hybridRendering.ts`

**Interfaces:**
- Consumes: the built extension and the demo-vault link `[code index](code/index.md)`.
- Produces: automated and real-host evidence that the regression is fixed.

- [ ] **Step 1: Run static verification**

```bash
pnpm typecheck
pnpm lint
git diff --check
```

Expected: all commands exit successfully.

- [ ] **Step 2: Run the complete Markdown editor Playwright file**

```bash
pnpm --filter llm-wiki-vscode exec playwright test \
  test/e2e/markdown-editor.spec.ts \
  --workers=1
```

Expected: the file passes without failures.

- [ ] **Step 3: Build the extension**

```bash
pnpm build:extension
```

Expected: webpack completes without TypeScript or bundling errors.

- [ ] **Step 4: Verify in Cursor Extension Development Host**

Open `demo-vault/projects/nanochat.md`, place the caret inside `code index`, and
confirm the line exposes `[code index](code/index.md)`. Move the caret outside
the link and confirm it returns to `code index`. Confirm the adjacent rendered
links remain compact throughout.

- [ ] **Step 5: Record final evidence**

Report the exact test/build commands, their results, the Cursor observation,
the implementation commit, and any unrelated pre-existing failures without
modifying unrelated working-tree changes.
