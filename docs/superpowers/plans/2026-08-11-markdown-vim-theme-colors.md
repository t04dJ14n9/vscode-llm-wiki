# Markdown Vim Startup and Theme Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start Vim-enabled Markdown editors in Normal mode and make every Markdown editor font color follow semantic Cursor/VS Code theme colors.

**Architecture:** Keep Vim state ownership inside the existing CodeMirror webview, but stop overriding the Vim extension's native Normal-mode initialization during creation, focus, and reveal events. Move syntax-color policy into a focused `markdownTheme.ts` module, then add explicit active-link destination and punctuation decorations so the approved Option A hierarchy can be styled independently.

**Tech Stack:** TypeScript, CodeMirror 6, `@replit/codemirror-vim`, `@codemirror/language`, `@lezer/highlight`, Playwright, Node test runner, VS Code webview CSS variables.

## Global Constraints

- A newly initialized Markdown editor starts in Vim Normal mode when persisted Vim mode is enabled.
- Enabling Vim in an open editor enters Normal mode.
- Focus and reveal events preserve the editor's current Vim state.
- The Preview/Markdown surface toggle is unchanged.
- Option A remains editable inline source; no pill, chip, or metadata card.
- All user-facing font colors use semantic `--vscode-*` variables.
- Fixed hexadecimal or RGB values are forbidden as text-color fallbacks.
- The active theme remains authoritative; no stored theme name or dark/light branch.
- Links retain an underline and keyboard focus affordance.
- Existing Markdown content and exported links are unchanged.

---

### Task 1: Vim Normal-Mode Initialization

**Files:**
- Modify: `packages/vscode-extension/webview-src/markdown-editor.ts:1390-1400`
- Modify: `packages/vscode-extension/webview-src/markdown-editor.ts:2338-2360`
- Modify: `packages/vscode-extension/webview-src/markdown-editor.ts:2578-2605`
- Modify: `packages/vscode-extension/webview-src/markdown-editor.ts:2737-2745`
- Test: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts:5217-5555`

**Interfaces:**
- Consumes: `vimModeEnabled`, `vimModeCompartment`, `vim()`, `restoreEditorFocusAfterShortcut`, and the existing `focus`, `restoreFocus`, `setVimMode`, and `revealPosition` message contracts.
- Produces: Vim state whose `getCM(view)?.state.vim?.insertMode` is `false` after first enablement and unchanged by later focus/reveal messages.

- [ ] **Step 1: Rewrite the startup test to require Normal mode**

Replace the insert-mode startup assertion with a test that observes the Vim
state directly and proves ordinary typing is interpreted as a Normal command:

```ts
test('Vim mode starts in normal mode and requires an insert command', async ({ page }) => {
  await page.goto('http://localhost:8979/test.html');
  await page.evaluate(() => {
    window.postMessage({ type: 'setVimMode', enabled: true }, '*');
    window.postMessage({ type: 'setText', text: 'Alpha beta' }, '*');
  });
  await page.waitForSelector('#editor .cm-content');
  await page.waitForFunction(() =>
    window.__cmView?.cm?.state.vim?.insertMode === false
  );

  await page.locator('.cm-content').click();
  await page.keyboard.press('i');
  await page.keyboard.type('X');

  expect(await page.evaluate(() => ({
    insertMode: window.__cmView.cm.state.vim?.insertMode,
    text: window.__cmView.state.doc.toString(),
  }))).toEqual({ insertMode: true, text: 'XAlpha beta' });
});
```

- [ ] **Step 2: Rewrite focus and reveal tests to verify state preservation**

Cover both directions:

```ts
// Insert mode survives host focus.
await page.keyboard.press('i');
await page.evaluate(() => window.postMessage({ type: 'focus' }, '*'));
expect(await page.evaluate(() =>
  window.__cmView.cm.state.vim?.insertMode
)).toBe(true);

// Normal mode survives host reveal.
await page.keyboard.press('Escape');
await page.evaluate(() => window.postMessage({
  type: 'revealPosition',
  anchor: 0,
  head: 0,
}, '*'));
expect(await page.evaluate(() =>
  window.__cmView.cm.state.vim?.insertMode
)).toBe(false);
```

Update click behavior to assert that clicking moves the cursor without changing
Normal mode.

- [ ] **Step 3: Run the focused tests to verify they fail**

Run:

```bash
pnpm --filter llm-wiki-vscode exec playwright test test/e2e/markdown-editor.spec.ts --grep "Vim mode starts|Vim mode remains|host focus|host reveal"
```

Expected: the new assertions fail because `ensureVimInsertMode` forces
`insertMode === true`.

- [ ] **Step 4: Remove automatic Insert-mode coercion**

Delete `ensureVimInsertMode` and `enterVimInsertModeForView`. Remove their calls
after editor construction, after `revealPosition`, and from `applyVimMode`.
Keep `enterVimInsertMode(cm)` because punctuation commands intentionally use it:

```ts
function applyVimMode(editorView: EditorView, enabled: boolean): void {
  vimModeEnabled = enabled;
  editorView.dispatch({
    effects: vimModeCompartment.reconfigure(enabled ? [vim()] : []),
  });
  editorView.focus();
}
```

The `focus` and `restoreFocus` message paths continue to focus the editor but do
not mutate Vim state.

- [ ] **Step 5: Run the Vim regression set**

Run:

```bash
pnpm --filter llm-wiki-vscode exec playwright test test/e2e/markdown-editor.spec.ts --grep "Vim|vim"
```

Expected: all Vim tests pass after expectations that depended on forced Insert
mode are updated to use `i`, `a`, or the intended Normal command explicitly.

- [ ] **Step 6: Commit the Vim behavior**

```bash
git add packages/vscode-extension/webview-src/markdown-editor.ts packages/vscode-extension/test/e2e/markdown-editor.spec.ts
git commit -m "fix: start markdown Vim in normal mode"
```

---

### Task 2: Semantic Markdown Highlight Style

**Files:**
- Create: `packages/vscode-extension/webview-src/markdownTheme.ts`
- Modify: `packages/vscode-extension/webview-src/markdown-editor.ts:1-15`
- Modify: `packages/vscode-extension/webview-src/markdown-editor.ts:825-832`
- Modify: `packages/vscode-extension/webview-src/markdown-editor.ts:1066-1355`
- Modify: `packages/vscode-extension/webview-src/extensions/hybridStyles.ts`
- Modify: `packages/vscode-extension/test/e2e/test.html`
- Test: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts`

**Interfaces:**
- Produces: `llmWikiHighlightStyle: HighlightStyle` from `markdownTheme.ts`.
- Consumes: `HighlightStyle` from `@codemirror/language`, `tags` from `@lezer/highlight`, and semantic `--vscode-*` variables injected into the webview.

- [ ] **Step 1: Add a failing computed-style test**

Add a real browser test that injects distinctive theme variables, renders an
active TypeScript fence, and reads the computed token colors:

```ts
test('Markdown syntax colors follow semantic VS Code theme variables', async ({ page }) => {
  await page.goto('http://localhost:8979/test.html');
  await page.evaluate(() => {
    const root = document.documentElement.style;
    root.setProperty('--vscode-editor-foreground', 'rgb(231, 232, 233)');
    root.setProperty('--vscode-descriptionForeground', 'rgb(151, 152, 153)');
    root.setProperty('--vscode-symbolIcon-keywordForeground', 'rgb(101, 111, 121)');
    root.setProperty('--vscode-symbolIcon-stringForeground', 'rgb(131, 141, 151)');
    window.postMessage({
      type: 'setText',
      text: ['```ts', 'const theme = "adaptive"; // note', '```'].join('\\n'),
    }, '*');
  });
  await page.waitForSelector('#editor .cm-content');
  await page.evaluate(() => {
    const view = window.__cmView;
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
  });

  const colors = await page.locator('.cm-line').nth(1).evaluate((line) => {
    const colorOf = (text: string) => {
      const element = [...line.querySelectorAll('span')]
        .find(candidate => candidate.textContent === text);
      return element ? getComputedStyle(element).color : '';
    };
    return {
      keyword: colorOf('const'),
      string: colorOf('"adaptive"'),
      comment: colorOf('// note'),
    };
  });
  expect(colors).toEqual({
    keyword: 'rgb(101, 111, 121)',
    string: 'rgb(131, 141, 151)',
    comment: 'rgb(151, 152, 153)',
  });
});
```

- [ ] **Step 2: Run the computed-style test to verify it fails**

Run:

```bash
pnpm --filter llm-wiki-vscode exec playwright test test/e2e/markdown-editor.spec.ts --grep "syntax colors follow"
```

Expected: FAIL because CodeMirror's fixed `defaultHighlightStyle` does not
follow the injected semantic variables.

- [ ] **Step 3: Create the semantic highlight module**

Implement the complete role mapping without fixed text fallbacks:

```ts
import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const editorForeground =
  'var(--vscode-editor-foreground)';
const descriptionForeground =
  'var(--vscode-descriptionForeground, var(--vscode-editor-foreground))';

export const llmWikiHighlightStyle = HighlightStyle.define([
  { tag: tags.meta, color: descriptionForeground },
  { tag: tags.link, color: 'var(--vscode-textLink-foreground)', textDecoration: 'underline' },
  { tag: tags.url, color: descriptionForeground },
  { tag: tags.heading, color: editorForeground, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.keyword, color: 'var(--vscode-symbolIcon-keywordForeground, var(--vscode-editor-foreground))' },
  { tag: [tags.atom, tags.bool], color: 'var(--vscode-symbolIcon-booleanForeground, var(--vscode-editor-foreground))' },
  { tag: [tags.number, tags.integer, tags.float], color: 'var(--vscode-symbolIcon-numberForeground, var(--vscode-editor-foreground))' },
  { tag: [tags.literal, tags.string, tags.regexp, tags.escape], color: 'var(--vscode-symbolIcon-stringForeground, var(--vscode-editor-foreground))' },
  { tag: tags.variableName, color: 'var(--vscode-symbolIcon-variableForeground, var(--vscode-editor-foreground))' },
  { tag: [tags.typeName, tags.className], color: 'var(--vscode-symbolIcon-classForeground, var(--vscode-editor-foreground))' },
  { tag: tags.namespace, color: 'var(--vscode-symbolIcon-namespaceForeground, var(--vscode-editor-foreground))' },
  { tag: tags.propertyName, color: 'var(--vscode-symbolIcon-propertyForeground, var(--vscode-editor-foreground))' },
  { tag: tags.operator, color: 'var(--vscode-symbolIcon-operatorForeground, var(--vscode-editor-foreground))' },
  { tag: tags.comment, color: descriptionForeground },
  { tag: [tags.invalid, tags.deleted], color: 'var(--vscode-errorForeground, var(--vscode-editor-foreground))' },
]);
```

Use only tags exported by the installed `@lezer/highlight` version; adjust
grouping if its declarations do not include an alias in the snippet.

- [ ] **Step 4: Install the semantic style and remove fixed text fallbacks**

Replace:

```ts
import { bracketMatching, defaultHighlightStyle, ... } from '@codemirror/language';
syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
```

with:

```ts
import { bracketMatching, ... } from '@codemirror/language';
import { llmWikiHighlightStyle } from './markdownTheme';
syntaxHighlighting(llmWikiHighlightStyle, { fallback: true }),
```

Replace fixed text fallbacks such as `#d4d4d4`, `#c586c0`, and `#4ec9b0`
with `var(--vscode-editor-foreground)` or the relevant semantic variable.
Leave fixed last-resort values only on non-text shadows, fills, selections, and
highlight backgrounds.

Replace the rendered fenced-code palette's fixed dark/light branches with the
same `symbolIcon.*`, `descriptionForeground`, and `editor.foreground` roles.
Map callout accent text through `charts.*`, editor status, and error theme
tokens, with semantic foreground fallbacks instead of fixed hues.

- [ ] **Step 5: Audit remaining text declarations**

Inspect every `color` and `caretColor` declaration in `markdown-editor.ts` and
`markdownTheme.ts`. Replace fixed text fallbacks such as `#d4d4d4`, `#c586c0`,
and `#4ec9b0` with semantic variables. Confirm fixed values remain only on
non-text surfaces such as shadows, fills, selections, and highlight
backgrounds.

- [ ] **Step 6: Run browser, type, and build checks**

Run:

```bash
pnpm --filter llm-wiki-vscode exec playwright test test/e2e/markdown-editor.spec.ts --grep "syntax colors follow"
pnpm exec tsc -p packages/vscode-extension/tsconfig.json --pretty false --noEmit
pnpm --filter llm-wiki-vscode build
```

Expected: all commands exit zero.

- [ ] **Step 7: Commit the semantic theme**

```bash
git add packages/vscode-extension/webview-src/markdownTheme.ts packages/vscode-extension/webview-src/markdown-editor.ts packages/vscode-extension/test/e2e/markdown-editor.spec.ts
git commit -m "feat: use semantic colors in markdown"
```

---

### Task 3: Option A Active-Link Hierarchy

**Files:**
- Modify: `packages/vscode-extension/webview-src/markdown-editor.ts:545-560`
- Modify: `packages/vscode-extension/webview-src/markdown-editor.ts:1255-1310`
- Modify: `packages/vscode-extension/webview-src/markdown-editor.ts:2880-2920`
- Test: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts:4970-5060`

**Interfaces:**
- Produces CSS classes `cm-active-link-label`,
  `cm-active-link-destination`, and `cm-active-link-punctuation`.
- Consumes `MarkdownLinkSpan.destinationFrom`,
  `MarkdownLinkSpan.destinationTo`, `labelFrom`, `labelTo`, `from`, and `to`.

- [ ] **Step 1: Add a failing active-link theme test**

Add an E2E test that sets unmistakable theme variables and activates a Markdown
link source line:

```ts
test('active Markdown links separate theme label, destination, and punctuation colors', async ({ page }) => {
  await page.goto('http://localhost:8979/test.html');
  await page.evaluate(() => {
    const root = document.documentElement.style;
    root.setProperty('--vscode-textLink-foreground', 'rgb(21, 121, 221)');
    root.setProperty('--vscode-descriptionForeground', 'rgb(151, 152, 153)');
    root.setProperty('--vscode-editor-foreground', 'rgb(231, 232, 233)');
    window.postMessage({
      type: 'setText',
      text: 'Read [docs](https://example.com/docs) now.',
    }, '*');
  });
  await page.waitForSelector('#editor .cm-content');
  await page.evaluate(() => {
    const view = window.__cmView;
    view.dispatch({ selection: { anchor: view.state.doc.line(1).from + 8 } });
  });

  await expect(page.locator('.cm-active-link-label')).toHaveCSS(
    'color', 'rgb(21, 121, 221)'
  );
  await expect(page.locator('.cm-active-link-destination')).toHaveCSS(
    'color', 'rgb(151, 152, 153)'
  );
  await expect(page.locator('.cm-active-link-punctuation').first()).toHaveCSS(
    'color', 'rgb(151, 152, 153)'
  );
});
```

- [ ] **Step 2: Run the focused link test to verify it fails**

Run:

```bash
pnpm --filter llm-wiki-vscode exec playwright test test/e2e/markdown-editor.spec.ts --grep "active Markdown links separate"
```

Expected: FAIL because destination and punctuation classes do not exist.

- [ ] **Step 3: Add decorations for destination and punctuation ranges**

Define:

```ts
const activeLinkLabelMark = Decoration.mark({ class: 'cm-active-link-label' });
const activeLinkDestinationMark = Decoration.mark({ class: 'cm-active-link-destination' });
const activeLinkPunctuationMark = Decoration.mark({ class: 'cm-active-link-punctuation' });
```

For every inline `MarkdownLinkSpan`, add:

```ts
decorations.push(activeLinkDestinationMark.range(
  link.destinationFrom,
  link.destinationTo,
));
for (const range of [
  { from: sourceFrom, to: link.labelFrom },
  { from: link.labelTo, to: link.destinationFrom },
  { from: link.destinationTo, to: sourceTo },
]) {
  if (range.from < range.to) {
    decorations.push(activeLinkPunctuationMark.range(range.from, range.to));
  }
}
```

For reference-style links, keep the label mark and apply the punctuation mark
to the source outside `labelFrom..labelTo`.

- [ ] **Step 4: Apply semantic Option A styles**

Add:

```ts
'.cm-active-link-destination': {
  color: 'var(--vscode-descriptionForeground, var(--vscode-editor-foreground))',
  fontWeight: '400',
},
'.cm-active-link-punctuation': {
  color: 'var(--vscode-descriptionForeground, var(--vscode-editor-foreground))',
  fontWeight: '400',
},
'.cm-active-link-label:focus-visible, .cm-llm-wiki-link:focus-visible': {
  outline: '1px solid var(--vscode-contrastBorder, var(--vscode-focusBorder))',
  outlineOffset: '1px',
},
```

Keep the current transparent background, zero-radius inline appearance,
underline, theme link foreground, active foreground on hover, and ↗ affordance.

- [ ] **Step 5: Add dark, light, and high-contrast variable checks**

Use a table-driven E2E loop with three semantic palettes. For each palette,
assign different `--vscode-textLink-foreground`,
`--vscode-descriptionForeground`, `--vscode-editor-foreground`,
`--vscode-focusBorder`, and `--vscode-contrastBorder` values, then assert
computed label, destination, punctuation, and focus-outline colors match that
palette. This proves there is no dark/light name branch.

- [ ] **Step 6: Run the complete Markdown browser suite**

Run:

```bash
pnpm --filter llm-wiki-vscode exec playwright test test/e2e/markdown-editor.spec.ts
```

Expected: all Markdown editor E2E tests pass.

- [ ] **Step 7: Commit the link treatment**

```bash
git add packages/vscode-extension/webview-src/markdown-editor.ts packages/vscode-extension/test/e2e/markdown-editor.spec.ts
git commit -m "feat: theme active markdown links"
```

---

### Task 4: Repository and Live Verification

**Files:**
- Modify only if verification exposes a defect in the files owned by Tasks 1-3.

**Interfaces:**
- Consumes the completed Markdown webview bundle and the persisted
  `markdownVimMode` workspace state.
- Produces verification evidence for Normal-mode startup and semantic theme
  adaptation.

- [ ] **Step 1: Run the repository verification gate**

Run:

```bash
pnpm check
git diff --check
```

Expected: lint, type-check, core tests, extension build/tests, and diff check all
exit zero.

- [ ] **Step 2: Reload the Extension Development Host**

Use Computer Use to reload the current Cursor Extension Development Host after
the production bundle is built. Open a Markdown file with Vim mode already
enabled.

- [ ] **Step 3: Verify Vim and Option A in the dark theme**

Confirm:

- The initial Vim state is Normal.
- Typing `x` performs the Vim Normal command rather than inserting `x`.
- Pressing `i` enters Insert mode and allows text entry.
- The link label uses the host link color.
- The long destination and punctuation use the host secondary text color.
- No fixed light-theme syntax colors remain visibly unreadable.

- [ ] **Step 4: Verify a light and high-contrast theme**

Temporarily switch only the Extension Development Host theme. Confirm the same
semantic roles update without reloading the Markdown document. Restore the
user's original theme at the end.

- [ ] **Step 5: Inspect fresh console output**

Confirm there are no new LLM Wiki webview errors. Record unrelated Cursor
or third-party-extension errors separately rather than attributing them to the
Markdown editor.
