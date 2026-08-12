# Cursor-style Selection Toolbar and Theme-native Vim Caret Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wrapped PDF selection-action cluster with a compact Cursor-style bar and make the Vim normal-mode block cursor use the active VS Code/Cursor cursor color.

**Architecture:** Keep all PDF action routing in `PdfViewer`, changing only the toolbar's presentation, accessible labeling, and responsive layout. Override the third-party Vim block-cursor theme inside LLM Wiki's existing CodeMirror theme so every cursor surface resolves from the same VS Code CSS token without changing Vim state or cursor geometry.

**Tech Stack:** TypeScript, CodeMirror 6, `@replit/codemirror-vim`, VS Code webview theme tokens, Playwright, pnpm, ESLint.

## Global Constraints

- Preserve all existing PDF action order, routing, exported artifacts, context-menu actions, and keyboard behavior.
- Keep `Copy Link` as the only primary action.
- Use compact visual provider labels: `Codex`, `Claude`, and `CodeBuddy`.
- Preserve full accessible provider names: `Send to Codex`, `Send to Claude Code`, and `Send to CodeBuddy`.
- Keep the toolbar on one line and within the viewport, using horizontal overflow only when the pane is genuinely too narrow.
- Preserve the Vim normal-mode block shape.
- Resolve cursor color from `var(--vscode-editorCursor-foreground, var(--vscode-editor-foreground))`.
- Apply theme changes to an already-open editor without reload or reconfiguration.

---

## File Map

- `packages/pdf-editor/src/webview/pdf-viewer.ts`: constructs the PDF selection toolbar and owns action labels/order.
- `packages/vscode-extension/src/pdfEditorProvider.ts`: production webview CSS for the PDF selection toolbar.
- `packages/vscode-extension/test/e2e/pdf-viewer.html`: browser-test fixture CSS that must match production.
- `packages/vscode-extension/test/e2e/pdf-viewer.spec.ts`: PDF toolbar layout, theme, accessibility, action-matrix, and narrow-pane regressions.
- `packages/vscode-extension/webview-src/markdown-editor.ts`: CodeMirror theme overrides for regular and Vim cursors.
- `packages/vscode-extension/test/e2e/markdown-editor.spec.ts`: real-browser cursor-token and Vim-mode regressions.

### Task 1: Compact Cursor-style PDF selection actions

**Files:**
- Modify: `packages/pdf-editor/src/webview/pdf-viewer.ts:2690-2734`
- Modify: `packages/vscode-extension/src/pdfEditorProvider.ts:1283-1290`
- Modify: `packages/vscode-extension/test/e2e/pdf-viewer.html:351-358`
- Test: `packages/vscode-extension/test/e2e/pdf-viewer.spec.ts:646-769`
- Test: `packages/vscode-extension/test/e2e/pdf-viewer.spec.ts:929-997`

**Interfaces:**
- Consumes: `AgentSurfaceCapabilities.providers`, `ExternalAgentId`, `PdfTextSelectionAction`, and `cursorSelectionShortcutLabel()`.
- Produces: the existing `#selection-toolbar` DOM with unchanged button order and click messages, compact visual labels, full `aria-label` values, and a decorative `.selection-toolbar-separator`.

- [ ] **Step 1: Add failing normal-width layout and accessible-label assertions**

Extend `expanded provider actions follow theme colors and keyboard focus order` so the toolbar must be a single compact row and provider buttons must expose compact text with full accessible names:

```ts
const providerButtons = [
  { accessible: 'Send to Codex', visual: 'Codex' },
  { accessible: 'Send to Claude Code', visual: 'Claude' },
  { accessible: 'Send to CodeBuddy', visual: 'CodeBuddy' },
] as const;

for (const provider of providerButtons) {
  const button = toolbar.getByRole('button', { name: provider.accessible, exact: true });
  await expect(button).toHaveText(provider.visual);
}
await expect(toolbar.locator('.selection-toolbar-separator')).toHaveCount(1);

const normalGeometry = await toolbar.evaluate(element => {
  const box = element.getBoundingClientRect();
  const buttons = Array.from(element.querySelectorAll('button'))
    .map(button => button.getBoundingClientRect());
  return {
    height: box.height,
    buttonRows: new Set(buttons.map(rect => Math.round(rect.top))).size,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  };
});
expect(normalGeometry.buttonRows).toBe(1);
expect(normalGeometry.height).toBeLessThanOrEqual(36);
expect(normalGeometry.scrollWidth).toBeLessThanOrEqual(normalGeometry.clientWidth);
```

Update the provider matrix's toolbar expectations to compare compact visible labels while continuing to expect full labels in the context menu.

- [ ] **Step 2: Strengthen the failing 320px responsive regression**

Replace the assumptions that every off-screen button rect is always inside the toolbar with assertions that the bar itself is one row, viewport-contained, horizontally scrollable, and can reveal the final provider action:

```ts
const responsive = await toolbar.evaluate(element => ({
  clientWidth: element.clientWidth,
  scrollWidth: element.scrollWidth,
  clientHeight: element.clientHeight,
  buttonRows: new Set(
    Array.from(element.querySelectorAll('button'))
      .map(button => Math.round(button.getBoundingClientRect().top)),
  ).size,
}));
expect(responsive.buttonRows).toBe(1);
expect(responsive.clientHeight).toBeLessThanOrEqual(36);
expect(responsive.scrollWidth).toBeGreaterThan(responsive.clientWidth);

const codeBuddy = toolbar.getByRole('button', { name: 'Send to CodeBuddy', exact: true });
await codeBuddy.scrollIntoViewIfNeeded();
await expect(codeBuddy).toBeInViewport();
```

- [ ] **Step 3: Run the PDF toolbar tests to verify RED**

Run:

```bash
pnpm build:extension
pnpm exec playwright test packages/vscode-extension/test/e2e/pdf-viewer.spec.ts -g "provider action capability matrix|expanded provider actions|narrow pane"
```

Expected: failures show full provider text, the missing separator, a multi-row toolbar, or a toolbar taller than 36px.

- [ ] **Step 4: Implement compact labels and separator without changing routing**

In `PdfViewer.showSelectionToolbar`, allow visual and accessible labels to differ:

```ts
const addButton = (
  label: string,
  action: PdfTextSelectionAction,
  className = '',
  agentId?: ExternalAgentId,
  accessibleLabel = label,
) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = className;
  button.setAttribute('aria-label', accessibleLabel);
  // Keep the existing click listener unchanged.
  toolbar.appendChild(button);
  return button;
};
```

After `Copy Link`, insert one separator when any handoff action exists:

```ts
if (this.agentCapabilities.cursorAgent || this.agentCapabilities.providers.length > 0) {
  const separator = document.createElement('span');
  separator.className = 'selection-toolbar-separator';
  separator.setAttribute('role', 'separator');
  separator.setAttribute('aria-orientation', 'vertical');
  toolbar.appendChild(separator);
}
```

Use an exact compact-label map for provider buttons:

```ts
const compactProviderLabels: Record<ExternalAgentId, string> = {
  codex: 'Codex',
  claude: 'Claude',
  codebuddy: 'CodeBuddy',
};

for (const provider of this.agentCapabilities.providers) {
  addButton(
    compactProviderLabels[provider.id],
    'sendToAgent',
    'secondary provider-action',
    provider.id,
    `Send to ${provider.label}`,
  );
}
```

- [ ] **Step 5: Implement the Cursor-style single-row CSS in production and fixture**

Replace the current wrapping CSS in both HTML surfaces with matching rules:

```css
.selection-toolbar {
  position: absolute;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  box-sizing: border-box;
  width: max-content;
  max-width: calc(100vw - 24px);
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-start;
  gap: 1px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 3px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  background: var(--vscode-editorWidget-background);
  box-shadow: 0 4px 14px var(--vscode-widget-shadow, rgba(0,0,0,.32));
  scrollbar-width: none;
}
.selection-toolbar::-webkit-scrollbar { display: none; }
.selection-toolbar button {
  flex: 0 0 auto;
  min-height: 26px;
  border: 0;
  border-radius: 5px;
  padding: 0 8px;
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
}
.selection-toolbar .secondary {
  background: transparent;
  color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
}
.selection-toolbar .secondary:hover {
  background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.16));
}
.selection-toolbar-separator {
  flex: 0 0 auto;
  width: 1px;
  height: 15px;
  margin: 0 1px;
  background: var(--vscode-panel-border);
}
```

Retain the existing primary button, focus-visible outline, shortcut badge, and hover token behavior, adjusting only their dimensions to fit the 26px control height.

- [ ] **Step 6: Build and run focused GREEN verification**

Run:

```bash
pnpm build:extension
pnpm exec playwright test packages/vscode-extension/test/e2e/pdf-viewer.spec.ts -g "provider action capability matrix|expanded provider actions|narrow pane"
```

Expected: all selected tests pass with all 16 provider/host combinations preserved.

- [ ] **Step 7: Run the complete PDF viewer regression suite**

Run:

```bash
pnpm exec playwright test packages/vscode-extension/test/e2e/pdf-viewer.spec.ts
```

Expected: all tests pass.

- [ ] **Step 8: Commit the PDF toolbar task**

```bash
git add packages/pdf-editor/src/webview/pdf-viewer.ts packages/vscode-extension/src/pdfEditorProvider.ts packages/vscode-extension/test/e2e/pdf-viewer.html packages/vscode-extension/test/e2e/pdf-viewer.spec.ts
git commit -m "style: compact PDF selection actions"
```

### Task 2: Make the Vim normal cursor theme-native

**Files:**
- Modify: `packages/vscode-extension/webview-src/markdown-editor.ts:818-1145`
- Test: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts:11-78`
- Test: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts:920-950`

**Interfaces:**
- Consumes: CodeMirror's `.cm-vimCursorLayer .cm-fat-cursor` DOM, `editorCaret`, `--vscode-editorCursor-foreground`, `--vscode-editor-foreground`, and `--vscode-editor-background`.
- Produces: theme-derived focused block background, unfocused block outline, and inverse block glyph color without changing Vim mode or block geometry.

- [ ] **Step 1: Add a helper that observes the real Vim block cursor**

Add a browser helper that enables Vim, forces normal mode, and captures focused and unfocused computed styles:

```ts
async function vimBlockCursorColors(
  page: import('@playwright/test').Page,
  cursorForeground: string,
  editorForeground: string,
  editorBackground: string,
) {
  await page.evaluate(({ cursor, foreground, background }) => {
    document.documentElement.style.setProperty('--vscode-editorCursor-foreground', cursor);
    document.documentElement.style.setProperty('--vscode-editor-foreground', foreground);
    document.documentElement.style.setProperty('--vscode-editor-background', background);
    window.postMessage({ type: 'setText', text: 'Theme-derived Vim cursor.' }, '*');
    window.postMessage({ type: 'setVimMode', enabled: true }, '*');
  }, {
    cursor: cursorForeground,
    foreground: editorForeground,
    background: editorBackground,
  });
  await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
  await page.locator('.cm-content').click();
  await page.keyboard.press('Escape');
  const block = page.locator('.cm-vimCursorLayer .cm-fat-cursor').first();
  await expect(block).toBeVisible();

  const focused = await block.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  await page.getByRole('textbox', { name: 'note title' }).focus();
  const unfocusedOutline = await block.evaluate(element => getComputedStyle(element).outlineColor);
  return { focused, unfocusedOutline };
}
```

- [ ] **Step 2: Add explicit-token, fallback, and live-change RED tests**

Add three tests:

```ts
test('Vim normal cursor follows the VS Code cursor and background tokens', async ({ page }) => {
  expect(await vimBlockCursorColors(page, '#123456', '#654321', '#fedcba')).toEqual({
    focused: { background: 'rgb(18, 52, 86)', color: 'rgb(254, 220, 186)' },
    unfocusedOutline: 'rgb(18, 52, 86)',
  });
});

test('Vim normal cursor falls back to the editor foreground token', async ({ page }) => {
  expect(await vimBlockCursorColors(page, 'initial', '#654321', '#fedcba')).toEqual({
    focused: { background: 'rgb(101, 67, 33)', color: 'rgb(254, 220, 186)' },
    unfocusedOutline: 'rgb(101, 67, 33)',
  });
});
```

For the live-change case, keep the same open editor, set `--vscode-editorCursor-foreground` to `#abcdef`, refocus `.cm-content`, and expect the same block element's background to become `rgb(171, 205, 239)`.

- [ ] **Step 3: Build and run the Vim cursor tests to verify RED**

Run:

```bash
pnpm build:extension
pnpm exec playwright test packages/vscode-extension/test/e2e/markdown-editor.spec.ts -g "Vim normal cursor"
```

Expected: focused background or unfocused outline remains `rgb(255, 150, 150)`, proving the third-party hard-coded color still wins.

- [ ] **Step 4: Override the third-party Vim cursor colors in the existing theme**

Add these selectors to the existing `EditorView.baseTheme` object that already styles `.cm-cursor` and `.cm-dropCursor`:

```ts
'.cm-vimCursorLayer .cm-fat-cursor': {
  backgroundColor: `${editorCaret} !important`,
  color: 'var(--vscode-editor-background) !important',
},
'&:not(.cm-focused) .cm-vimCursorLayer .cm-fat-cursor': {
  background: 'none !important',
  outlineColor: `${editorCaret} !important`,
},
```

The important declarations are intentionally narrow: the upstream Vim extension installs its hard-coded block-cursor theme at highest CodeMirror precedence. Do not change cursor dimensions, blink timing, selection state, or Vim keymaps.

- [ ] **Step 5: Build and run focused GREEN verification**

Run:

```bash
pnpm build:extension
pnpm exec playwright test packages/vscode-extension/test/e2e/markdown-editor.spec.ts -g "caret uses|Vim normal cursor"
```

Expected: the existing five caret-surface tests and all new Vim block tests pass.

- [ ] **Step 6: Run the complete Markdown regression suite**

Run:

```bash
pnpm exec playwright test packages/vscode-extension/test/e2e/markdown-editor.spec.ts
```

Expected: all tests pass.

- [ ] **Step 7: Commit the Vim caret task**

```bash
git add packages/vscode-extension/webview-src/markdown-editor.ts packages/vscode-extension/test/e2e/markdown-editor.spec.ts
git commit -m "fix: theme the Vim normal cursor"
```

### Task 3: Final integrated verification

**Files:**
- Verify only: all files changed in Tasks 1 and 2

**Interfaces:**
- Consumes: the production extension bundle and complete workspace test graph.
- Produces: evidence that both visual changes coexist without altering PDF handoff or Markdown editing behavior.

- [ ] **Step 1: Run static and workspace checks**

```bash
pnpm check
git diff --check
```

Expected: lint, typecheck, core tests, extension tests, and whitespace checks all pass.

- [ ] **Step 2: Run the full Playwright suite**

```bash
pnpm exec playwright test
```

Expected: zero failures; manual-only tests may remain skipped.

- [ ] **Step 3: Run live Cursor theme verification**

Launch an Extension Development Host from the freshly built extension, open `demo-vault/notes/Concepts/Mermaid Preview.md`, and verify:

1. In a dark theme, Vim normal mode shows a block cursor using the same light cursor color as the built-in editor.
2. Switch to a light theme while the editor remains open; the same block cursor immediately becomes dark.
3. Open `demo-vault/raw/pdf/ddia.pdf`, select text, and confirm the actions form a compact single row with `Copy Link`, `Add to Chat`, and compact installed-provider labels.
4. Confirm keyboard focus traverses every action and no action is submitted automatically.

- [ ] **Step 4: Record final status**

```bash
git status --short --branch
git log -3 --oneline
```

Expected: no uncommitted task changes and the design, PDF toolbar, and Vim caret commits are present on `main`.
