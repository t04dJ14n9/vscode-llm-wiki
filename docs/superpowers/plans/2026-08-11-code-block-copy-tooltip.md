# Code Block Copy Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Markdown fenced-code copy button an accessible, theme-aware `Copied` tooltip with repeatable timing and reduced-motion support.

**Architecture:** Extend the existing `CodeBlockHeaderWidget` so clipboard completion drives one local tooltip state inside the copy button. Keep all presentation in the existing CodeMirror hybrid theme, use sequence-guarded timers for repeated clicks, and verify consumer-visible behavior in the real Playwright Markdown editor fixture.

**Tech Stack:** TypeScript, CodeMirror 6 widgets and themes, VS Code semantic CSS variables, Playwright, pnpm.

## Global Constraints

- The tooltip text is exactly `Copied`.
- Enter over 120 ms by fading in and moving upward 4 px.
- Remain visible for 1 second, then exit over 120 ms.
- Repeated clicks restart the visibility interval and entrance animation.
- Use `--vscode-editorHoverWidget-background`, `--vscode-editorHoverWidget-foreground`, and `--vscode-editorHoverWidget-border`, with editor and contrast token fallbacks.
- Preserve the copy icon, language label, code contents, header dimensions, and clipboard payload.
- Use `role="status"`, `aria-live="polite"`, and `aria-atomic="true"`.
- Preserve the button's existing `Copy code` accessible name and title.
- Under `prefers-reduced-motion: reduce`, remove translation and fading while preserving the 1-second dwell time.
- Do not add a global toast, notification, clipboard protocol, or dependency.

---

## File Structure

- Modify `packages/vscode-extension/webview-src/extensions/hybridCodeBlocks.ts`
  to create the status element, start feedback only after clipboard completion,
  and coordinate repeatable timers.
- Modify `packages/vscode-extension/webview-src/extensions/hybridStyles.ts`
  to position and theme the tooltip without changing code-block layout.
- Modify `packages/vscode-extension/test/e2e/markdown-editor.spec.ts`
  to exercise the real widget, native and fallback clipboard paths, timing,
  layout, semantic colors, and reduced motion.

### Task 1: Basic Tooltip, Theme, Accessibility, and Clipboard Completion

**Files:**
- Modify: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts:7945-8230`
- Modify: `packages/vscode-extension/webview-src/extensions/hybridCodeBlocks.ts:22-103`
- Modify: `packages/vscode-extension/webview-src/extensions/hybridStyles.ts:701-757`

**Interfaces:**
- Consumes: `writeTextToClipboard(text: string, fallback: CopyTextFallback): Promise<void>`
  and `dispatchCopyTextEvent(target: EventTarget, text: string): void`.
- Produces: `.cm-hybrid-codeblock-copy-tooltip`, the
  `.cm-hybrid-codeblock-copy.is-copied` state, and unchanged clipboard output.

- [ ] **Step 1: Write the failing real-widget browser test**

Add a focused test before the existing comprehensive fenced-code test:

```ts
test('code block copy reports success in a theme-aware tooltip without shifting layout', async ({ page }) => {
  await page.goto('http://localhost:8979/test.html');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--vscode-editorHoverWidget-background', '#313233');
    document.documentElement.style.setProperty('--vscode-editorHoverWidget-foreground', '#fafafa');
    document.documentElement.style.setProperty('--vscode-editorHoverWidget-border', '#555657');
    window.postMessage({
      type: 'setText',
      text: ['```ts', 'const answer = 42;', '```'].join('\n'),
    }, '*');
    window.__copiedText = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          window.__copiedText = text;
        },
      },
    });
  });

  const header = page.locator('.cm-hybrid-codeblock-header');
  const copyButton = page.locator('.cm-hybrid-codeblock-copy');
  const tooltip = page.locator('.cm-hybrid-codeblock-copy-tooltip');
  await expect(copyButton).toBeVisible();
  const headerBefore = await header.boundingBox();
  await copyButton.click();

  await expect.poll(() => page.evaluate(() => window.__copiedText))
    .toBe('const answer = 42;');
  await expect(tooltip).toHaveText('Copied');
  await expect(tooltip).toHaveAttribute('role', 'status');
  await expect(tooltip).toHaveAttribute('aria-live', 'polite');
  await expect(tooltip).toHaveAttribute('aria-atomic', 'true');
  await expect(copyButton).toHaveAttribute('aria-label', 'Copy code');
  await expect(copyButton).toHaveAttribute('title', 'Copy code');
  await expect(copyButton).toHaveClass(/is-copied/);

  const feedback = await page.evaluate(() => {
    const button = document.querySelector<HTMLElement>('.cm-hybrid-codeblock-copy')!;
    const tooltip = document.querySelector<HTMLElement>('.cm-hybrid-codeblock-copy-tooltip')!;
    const buttonRect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const style = getComputedStyle(tooltip);
    return {
      tooltipBottom: tooltipRect.bottom,
      buttonTop: buttonRect.top,
      background: style.backgroundColor,
      foreground: style.color,
      border: style.borderColor,
    };
  });
  expect(feedback.tooltipBottom).toBeLessThanOrEqual(feedback.buttonTop);
  expect(feedback.background).toBe('rgb(49, 50, 51)');
  expect(feedback.foreground).toBe('rgb(250, 250, 250)');
  expect(feedback.border).toBe('rgb(85, 86, 87)');
  expect(await header.boundingBox()).toEqual(headerBefore);

  await expect(tooltip).toHaveText('', { timeout: 2_000 });
});
```

Extend the same test with the host fallback:

```ts
await page.evaluate(() => {
  window.__mockMessages = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: undefined,
  });
});
await copyButton.click();
await expect.poll(() => page.evaluate(() => (
  window.__mockMessages?.filter(message => message.type === 'copyText').at(-1)?.text
))).toBe('const answer = 42;');
await expect(tooltip).toHaveText('Copied');
```

The production mutation this test catches is removing the post-copy feedback
or rendering it in normal flow so the header moves.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec playwright test test/e2e/markdown-editor.spec.ts \
  -g "code block copy reports success"
```

Expected: FAIL because `.cm-hybrid-codeblock-copy-tooltip` does not exist.
The clipboard assertion must pass, proving the failure is feedback-specific.

- [ ] **Step 3: Add the status element and completion-driven state**

In `CodeBlockHeaderWidget.toDOM`, create the tooltip immediately after the
copy SVG:

```ts
const copyTooltip = document.createElement('span');
copyTooltip.className = 'cm-hybrid-codeblock-copy-tooltip';
copyTooltip.setAttribute('role', 'status');
copyTooltip.setAttribute('aria-live', 'polite');
copyTooltip.setAttribute('aria-atomic', 'true');
copyButton.append(copyIcon, copyTooltip);
```

Replace the existing `copyButton.appendChild(copyIcon)` with the final line
above so the SVG is appended exactly once. Replace the fire-and-forget
clipboard call with feedback after the existing promise completes:

```ts
copyButton.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  void writeTextToClipboard(
    this.code,
    text => dispatchCopyTextEvent(view.dom, text),
  ).then(() => {
    copyTooltip.textContent = 'Copied';
    copyButton.classList.add('is-copied');
    window.setTimeout(() => {
      copyButton.classList.remove('is-copied');
    }, 1_120);
    window.setTimeout(() => {
      copyTooltip.textContent = '';
    }, 1_240);
  });
});
```

Do not change `aria-label`, `title`, the SVG, or the copied string.

- [ ] **Step 4: Add semantic tooltip styles without layout changes**

In `hybridStyles.ts`, allow only the header surface to expose the absolutely
positioned tooltip by changing `.cm-hybrid-codeblock-inner` from
`overflow: hidden` to `overflow: visible`. Add:

```ts
'.cm-hybrid-codeblock-copy-tooltip': {
  boxSizing: 'border-box',
  position: 'absolute',
  right: '0',
  bottom: 'calc(100% + 6px)',
  zIndex: '4',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  padding: '2px 7px',
  border: '1px solid var(--vscode-editorHoverWidget-border, var(--vscode-contrastBorder, transparent))',
  borderRadius: '4px',
  color: 'var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground))',
  backgroundColor: 'var(--vscode-editorHoverWidget-background, var(--vscode-editor-background))',
  boxShadow: '0 2px 8px color-mix(in srgb, var(--vscode-editor-foreground) 18%, transparent)',
  opacity: '0',
  transform: 'translateY(4px)',
  visibility: 'hidden',
  transition: 'opacity 120ms ease, transform 120ms ease, visibility 0s linear 120ms',
},
'.cm-hybrid-codeblock-copy.is-copied .cm-hybrid-codeblock-copy-tooltip': {
  opacity: '1',
  transform: 'translateY(0)',
  visibility: 'visible',
  transitionDelay: '0s',
},
```

Keep the button `position: absolute`; the tooltip must never enter header
layout.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run the Step 2 command.

Expected: PASS for native clipboard, host fallback, theme colors,
accessibility attributes, geometry, and reset.

- [ ] **Step 6: Commit the basic tooltip behavior**

```bash
git add \
  packages/vscode-extension/webview-src/extensions/hybridCodeBlocks.ts \
  packages/vscode-extension/webview-src/extensions/hybridStyles.ts \
  packages/vscode-extension/test/e2e/markdown-editor.spec.ts
git commit -m "feat: show code copy confirmation"
```

### Task 2: Restartable Timing and Reduced Motion

**Files:**
- Modify: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts:7945-8230`
- Modify: `packages/vscode-extension/webview-src/extensions/hybridCodeBlocks.ts:22-120`
- Modify: `packages/vscode-extension/webview-src/extensions/hybridStyles.ts:726-780`

**Interfaces:**
- Consumes: `.cm-hybrid-codeblock-copy-tooltip` and `.is-copied` from Task 1.
- Produces: `.cm-hybrid-codeblock-copy-reduced-motion` and
  sequence-guarded feedback whose latest click owns the hide/reset timers.

- [ ] **Step 1: Write failing repeat-click and reduced-motion tests**

Add a repeat-click assertion to the Task 1 test:

```ts
await copyButton.click();
await page.waitForTimeout(700);
await copyButton.click();
await page.waitForTimeout(700);
await expect(tooltip).toHaveText('Copied');
await expect(copyButton).toHaveClass(/is-copied/);
await expect(tooltip).toHaveText('', { timeout: 2_000 });
```

Without timer ownership, the first click hides the second click's feedback
after roughly 420 ms, so this must fail.

Add a second focused test:

```ts
test('code block copy feedback respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://localhost:8979/test.html');
  await page.evaluate(() => {
    window.postMessage({
      type: 'setText',
      text: ['```text', 'bounded feedback', '```'].join('\n'),
    }, '*');
  });
  const copyButton = page.locator('.cm-hybrid-codeblock-copy');
  const tooltip = page.locator('.cm-hybrid-codeblock-copy-tooltip');
  await copyButton.click();
  await expect(tooltip).toHaveText('Copied');
  const motion = await tooltip.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      transitionDuration: style.transitionDuration,
      transform: style.transform,
    };
  });
  expect(motion.transitionDuration.split(',').every(value => value.trim() === '0s')).toBe(true);
  expect(motion.transform).toBe('none');
  await expect(tooltip).toHaveText('', { timeout: 1_500 });
});
```

The production mutation these tests catch is allowing stale timers to own
new feedback or animating despite the user's reduced-motion preference.

- [ ] **Step 2: Run both tests and verify RED**

Run:

```bash
pnpm exec playwright test test/e2e/markdown-editor.spec.ts \
  -g "code block copy (reports success|feedback respects reduced motion)"
```

Expected: the repeat assertion fails because the first timer hides the latest
feedback; the reduced-motion assertion fails because the widget has no
reduced-motion class and still reports 120 ms transitions.

- [ ] **Step 3: Replace competing timers with sequence ownership**

At module scope add exact timing constants:

```ts
const copyFeedbackEnterMs = 120;
const copyFeedbackDwellMs = 1_000;
const copyFeedbackExitMs = 120;
```

Inside `toDOM`, add:

```ts
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
if (reducedMotion) {
  copyButton.classList.add('cm-hybrid-codeblock-copy-reduced-motion');
}
let copyFeedbackSequence = 0;

const showCopyFeedback = (): void => {
  copyFeedbackSequence += 1;
  const sequence = copyFeedbackSequence;
  const enterMs = reducedMotion ? 0 : copyFeedbackEnterMs;
  const exitMs = reducedMotion ? 0 : copyFeedbackExitMs;

  copyButton.classList.remove('is-copied');
  copyTooltip.textContent = 'Copied';
  void copyTooltip.offsetWidth;
  copyButton.classList.add('is-copied');

  window.setTimeout(() => {
    if (copyFeedbackSequence !== sequence) return;
    copyButton.classList.remove('is-copied');
  }, enterMs + copyFeedbackDwellMs);
  window.setTimeout(() => {
    if (copyFeedbackSequence !== sequence) return;
    copyTooltip.textContent = '';
  }, enterMs + copyFeedbackDwellMs + exitMs);
};
```

Call `showCopyFeedback()` in the clipboard promise instead of scheduling the
Task 1 timers inline.

- [ ] **Step 4: Add the reduced-motion style override**

Add:

```ts
'.cm-hybrid-codeblock-copy-reduced-motion .cm-hybrid-codeblock-copy-tooltip': {
  transform: 'none',
  transition: 'none',
},
```

The visible-state rule continues to control opacity and visibility
immediately.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the Step 2 command.

Expected: both tests pass; the second click remains visible after the first
timer would have fired, and reduced motion has `0s` transition durations and
`none` transform.

- [ ] **Step 6: Run the complete Markdown browser suite**

Run:

```bash
pnpm exec playwright test test/e2e/markdown-editor.spec.ts
```

Expected: all Markdown editor browser tests pass, including the existing
code-block layout, copy-content, fallback, Vim, and theme tests.

- [ ] **Step 7: Commit restartable and reduced-motion feedback**

```bash
git add \
  packages/vscode-extension/webview-src/extensions/hybridCodeBlocks.ts \
  packages/vscode-extension/webview-src/extensions/hybridStyles.ts \
  packages/vscode-extension/test/e2e/markdown-editor.spec.ts
git commit -m "fix: harden code copy feedback timing"
```

### Task 3: Full and Live Verification

**Files:**
- Verify only: `packages/vscode-extension/webview-src/extensions/hybridCodeBlocks.ts`
- Verify only: `packages/vscode-extension/webview-src/extensions/hybridStyles.ts`
- Verify only: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts`

**Interfaces:**
- Consumes: the completed copy-feedback behavior from Tasks 1 and 2.
- Produces: fresh automated and live evidence; no production API.

- [ ] **Step 1: Run the full repository check**

Run:

```bash
pnpm check
```

Expected: lint, typecheck, production webpack builds, core tests, and VS Code
extension tests all exit successfully with zero failures.

- [ ] **Step 2: Check patch hygiene and task scope**

Run:

```bash
git diff --check
git status --short -- \
  packages/vscode-extension/webview-src/extensions/hybridCodeBlocks.ts \
  packages/vscode-extension/webview-src/extensions/hybridStyles.ts \
  packages/vscode-extension/test/e2e/markdown-editor.spec.ts
```

Expected: no whitespace errors and no uncommitted task-file changes after the
two implementation commits.

- [ ] **Step 3: Verify the exact interaction in Cursor**

Build output is produced by `pnpm check`. Reload the Extension Development
Host, reopen `demo-vault/.llm_wiki/agent/selection.md`, and:

1. Hover the fenced-code copy button.
2. Click it once and confirm `Copied` appears above the button without layout
   movement.
3. Click it twice within one second and confirm the latest feedback remains
   visible for its full interval.
4. Confirm the tooltip disappears, the icon remains unchanged, and no Human
   Learning error notification appears.

Capture the immediate and post-timeout screenshots as live evidence.
