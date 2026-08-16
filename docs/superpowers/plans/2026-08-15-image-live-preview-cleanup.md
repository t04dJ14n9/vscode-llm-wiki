# Image Live Preview Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide image source on inactive lines and overlay the expand control at the rendered image's top-right corner.

**Architecture:** Restore CodeMirror replacement decorations for inactive image spans while retaining the existing additive preview on the active image line. Reposition the existing semantic expand button with the hybrid editor theme rather than changing widget events or dialog behavior.

**Tech Stack:** TypeScript, CodeMirror 6 decorations/widgets, Playwright, pnpm.

## Global Constraints

- Inactive image lines show the preview without visible Markdown image source.
- Active image lines show editable source and retain the preview.
- Moving the caret away hides the source again without changing document text.
- Markdown, reference, and Obsidian images share the same behavior.
- The expand button stays accessible and appears inside the preview's top-right corner.
- Preserve image resolution, dimensions, fallback, dialog, copy, navigation, autosave, and Vim behavior.

---

## File Structure

- Modify `packages/vscode-extension/test/e2e/markdown-editor.spec.ts`: define browser-observable source visibility and button placement behavior.
- Modify `packages/vscode-extension/webview-src/extensions/hybridRendering.ts`: restore replacement-mode image rendering on inactive lines.
- Modify `packages/vscode-extension/webview-src/extensions/hybridStyles.ts`: overlay the existing expand control at the image's top-right.
- Verify `packages/vscode-extension/webview-src/extensions/hybridImages.ts` unchanged: it already supplies the correct semantic button and event behavior.
- Verify `packages/vscode-extension/test/vscode-e2e/demo-vault.spec.ts`: extend only if the real-host smoke test lacks an assertion for inactive source hiding.

### Task 1: Define inactive and active image source behavior

**Files:**
- Test: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts`

**Interfaces:**
- Consumes: `window.__cmView: EditorView`, `.cm-content`, `.cm-hybrid-image`, and `.cm-hybrid-image-img`.
- Produces: browser assertions covering inactive replacement, click-to-reveal, and re-hiding.

- [ ] **Step 1: Replace the current Markdown image click test with the complete lifecycle contract**

Use a document with a plain Markdown image on line 3. Place the caret on line 5
and assert:

```typescript
const content = page.locator('.cm-content');
const image = page.locator('.cm-hybrid-image-img');
await expect(image).toBeVisible();
await expect(content).not.toContainText('![Attention diagram]');
```

Click the image and assert that line 3 becomes active, the preview remains
visible, and the source is visible:

```typescript
await image.click();
await expect(image).toBeVisible();
await expect(content).toContainText('![Attention diagram]');
expect(await page.evaluate(() => {
  const view = window.__cmView;
  return view.state.doc.lineAt(view.state.selection.main.head).number;
})).toBe(3);
```

Move the caret back to line 5 and assert the source is hidden again:

```typescript
await page.evaluate(() => {
  const view = window.__cmView;
  view.dispatch({ selection: { anchor: view.state.doc.line(5).from } });
});
await expect(content).not.toContainText('![Attention diagram]');
await expect(image).toBeVisible();
```

- [ ] **Step 2: Extend the Obsidian image test with inactive and restored assertions**

Before clicking `![[...|Nanochat logo]]`, assert:

```typescript
await expect(page.locator('.cm-content')).not.toContainText('![[data:image/gif');
```

After clicking, retain the existing visible-source assertion. Move the caret to
line 5 and assert that the source disappears while the image stays visible.

- [ ] **Step 3: Run the two focused tests and verify RED**

Run:

```bash
pnpm --filter llm-wiki-vscode exec playwright test \
  test/e2e/markdown-editor.spec.ts \
  --grep "clicking a rendered image|clicking an Obsidian wikilink image" \
  --workers=1
```

Expected: both tests fail at the initial inactive-source assertion because the
current renderer deliberately leaves image source visible.

### Task 2: Restore inactive source replacement

**Files:**
- Modify: `packages/vscode-extension/webview-src/extensions/hybridRendering.ts:1315-1333`
- Test: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts`

**Interfaces:**
- Consumes: `decorateRenderedLine(...)` and `replaceImages(..., renderActiveImages = false)`.
- Produces: replacement image decorations for inactive lines and additive image widgets only for active lines.

- [ ] **Step 1: Implement the minimal inactive rendering change**

In the `!active.has(line.number)` branch, remove the
`renderActiveImages: true` override:

```typescript
decorateRenderedLine(
  line.from,
  line.to,
  line.text,
  obsidianCommentRanges,
  referenceDefinitions,
  referenceDefinitionSpans,
  decorations,
  { renderActiveMarkdownLinks: false },
);
```

Keep the active-line `renderActiveImages` calculation and
`activeInlineRevealSpans` image exclusion unchanged so clicking an image
continues to show both source and preview.

- [ ] **Step 2: Run the focused lifecycle tests and verify GREEN**

Run the Task 1 focused Playwright command.

Expected: both tests pass through inactive, active, and re-hidden states.

- [ ] **Step 3: Run adjacent image behavior tests**

Run:

```bash
pnpm --filter llm-wiki-vscode exec playwright test \
  test/e2e/markdown-editor.spec.ts \
  --grep "image|Obsidian callout|reference-style links and images" \
  --workers=1
```

Expected: all selected tests pass, including dimensions, fallback, dialog,
callout/table image rendering, copy, and click navigation.

### Task 3: Define and implement top-right expand placement

**Files:**
- Test: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts`
- Modify: `packages/vscode-extension/webview-src/extensions/hybridStyles.ts:50-76`

**Interfaces:**
- Consumes: `.cm-hybrid-image`, `.cm-hybrid-image-img`, and `.cm-hybrid-image-expand`.
- Produces: an expand button whose bounding box sits inside the image container at its top-right.

- [ ] **Step 1: Add the failing placement assertion**

In an existing rendered-image test, measure real browser layout:

```typescript
const placement = await page.locator('.cm-hybrid-image').evaluate((container) => {
  const image = container.querySelector<HTMLElement>('.cm-hybrid-image-img');
  const button = container.querySelector<HTMLElement>('.cm-hybrid-image-expand');
  if (!image || !button) throw new Error('Missing image preview controls');
  const imageRect = image.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  return {
    buttonInsideTop: buttonRect.top >= imageRect.top
      && buttonRect.bottom <= imageRect.bottom,
    rightInset: imageRect.right - buttonRect.right,
    buttonBelowImage: buttonRect.top >= imageRect.bottom,
  };
});
expect(placement.buttonInsideTop).toBe(true);
expect(placement.rightInset).toBeGreaterThanOrEqual(0);
expect(placement.rightInset).toBeLessThanOrEqual(12);
expect(placement.buttonBelowImage).toBe(false);
```

- [ ] **Step 2: Run the placement test and verify RED**

Run:

```bash
pnpm --filter llm-wiki-vscode exec playwright test \
  test/e2e/markdown-editor.spec.ts \
  --grep "clicking an Obsidian wikilink image" \
  --workers=1
```

Expected: the placement assertion fails because the button is currently laid
out below the image.

- [ ] **Step 3: Implement the minimal overlay styles**

Change the image container and button styles:

```typescript
'.cm-hybrid-image': {
  display: 'inline-block',
  position: 'relative',
  maxWidth: '100%',
},
'.cm-hybrid-image-expand': {
  position: 'absolute',
  top: '8px',
  right: '8px',
  zIndex: '1',
  // retain the existing border, typography, colors, hover, and focus rules
},
```

Use the existing VS Code theme variables for the background. Do not modify the
button label, event handlers, dialog, or error cleanup.

- [ ] **Step 4: Run the placement and lifecycle tests and verify GREEN**

Run the focused commands from Tasks 1 and 3.

Expected: source lifecycle and button placement assertions all pass.

### Task 4: Verify the extension and real Cursor host

**Files:**
- Verify: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts`
- Verify: `packages/vscode-extension/test/vscode-e2e/demo-vault.spec.ts`
- Verify: `demo-vault/projects/nanochat.md`

**Interfaces:**
- Consumes: the built VS Code extension and Nanochat image embed.
- Produces: automated and real-host evidence for source visibility and control placement.

- [ ] **Step 1: Run static and package verification**

```bash
pnpm typecheck
pnpm lint
pnpm --filter llm-wiki-vscode test
git diff --check
```

Expected: all commands exit successfully, or any unrelated pre-existing
failure is recorded without changing unrelated files.

- [ ] **Step 2: Run the complete Markdown editor browser suite**

```bash
pnpm --filter llm-wiki-vscode exec playwright test \
  test/e2e/markdown-editor.spec.ts \
  --workers=1
```

Expected: the complete file passes.

- [ ] **Step 3: Build the extension**

```bash
pnpm build:extension
```

Expected: bundling finishes without TypeScript or webpack errors.

- [ ] **Step 4: Verify `demo-vault` in Cursor Extension Development Host**

Open `demo-vault/projects/nanochat.md` and confirm:

1. With the caret away from line 33, the `![[...]]` source is hidden.
2. The Nanochat image is visible.
3. `Expand image` appears over the image's top-right corner and opens the
   existing dialog.
4. Clicking the image reveals line 33 source and retains the preview.
5. Moving the caret away hides line 33 source again.
6. No document content changes occur during the interaction.

- [ ] **Step 5: Record final evidence**

Report the exact test/build commands and results, the Cursor observation, and
any unrelated working-tree changes preserved.
