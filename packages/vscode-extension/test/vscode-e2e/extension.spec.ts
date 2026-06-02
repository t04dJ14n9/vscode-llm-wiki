import { test as base, expect, chromium, type Page, type Browser, type BrowserContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const TEST_DIR = path.resolve(__dirname, '.vscode-test');
const WS_URL_FILE = path.resolve(TEST_DIR, 'ws-url');
const DEBUG_PORT_FILE = path.resolve(TEST_DIR, 'debug-port');
const SCREENSHOT_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'e2e-report', 'vscode-e2e-screenshots');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// Custom fixture that connects to VS Code via CDP
const test = base.extend<{ vsCodePage: Page; vsCodeContext: BrowserContext }>({
  vsCodePage: async ({}, use, testInfo) => {
    const wsUrl = fs.readFileSync(WS_URL_FILE, 'utf-8').trim();
    console.log(`[fixture] Connecting to VS Code CDP: ${wsUrl}`);

    const browser = await chromium.connectOverCDP(wsUrl);
    const contexts = browser.contexts();
    expect(contexts.length).toBeGreaterThan(0);

    const context = contexts[0]!;
    const pages = context.pages();
    const page = pages[0] ?? await context.waitForEvent('page', { timeout: 30_000 });

    // Wait for VS Code workbench
    await page.waitForSelector('.monaco-workbench', { timeout: 30_000 });
    console.log('[fixture] VS Code workbench loaded');

    await use(page);

    // Don't close - VS Code stays running for teardown
    await browser.close();
  },
  vsCodeContext: async ({}, use) => {
    const wsUrl = fs.readFileSync(WS_URL_FILE, 'utf-8').trim();
    const browser = await chromium.connectOverCDP(wsUrl);
    const contexts = browser.contexts();
    expect(contexts.length).toBeGreaterThan(0);
    const context = contexts[0]!;
    if (context.pages().length === 0) {
      await context.waitForEvent('page', { timeout: 30_000 });
    }
    await use(context);
    await browser.close();
  },
});

async function screenshot(page: Page, name: string): Promise<void> {
  const filePath = path.resolve(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`[screenshot] Saved: ${filePath}`);
}

async function focusWorkbenchChrome(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.locator('.monaco-workbench').click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(200);
}

async function openQuickInput(page: Page, command: string): Promise<void> {
  await focusWorkbenchChrome(page);
  await page.keyboard.press(command);
  await expect(page.locator('.quick-input-widget').first()).toBeVisible({ timeout: 5_000 });
}

async function closeQuickInput(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('.quick-input-widget').first()).toBeHidden({ timeout: 5_000 });
}

async function openQuickFile(page: Page, query: string, waitMs = 4000): Promise<void> {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await openQuickInput(page, `${modifier}+p`);
  await page.keyboard.type(query, { delay: 50 });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(waitMs);
}

async function openMathAndCode(page: Page): Promise<void> {
  await openQuickFile(page, 'notes/Concepts/Math and Code.md');
  await expect(page.locator('iframe.webview:visible').first()).toBeVisible({ timeout: 15_000 });
}

async function moveCursorToTop(page: Page): Promise<void> {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.locator('iframe.webview:visible').first().click({ position: { x: 300, y: 300 } });
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.keyboard.press(`${modifier}+Home`);
  await page.waitForTimeout(1000);
}

interface DevtoolsTarget {
  type: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

async function evaluateHumanLearningWebview<T>(
  docNeedle: string,
  body: string,
): Promise<T> {
  const debugPort = Number(fs.readFileSync(DEBUG_PORT_FILE, 'utf-8').trim());
  const deadline = Date.now() + 15_000;
  let mismatches: string[] = [];

  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await response.json() as DevtoolsTarget[];
    const webviews = targets.filter(target => (
      target.type === 'iframe'
      && typeof target.webSocketDebuggerUrl === 'string'
      && (target.url ?? '').includes('extensionId=human-learning.human-learning-vscode')
    ));

    mismatches = [];
    for (const target of webviews) {
      const result = await cdpEvaluate<{
        ok: boolean;
        value?: T;
        reason?: string;
        preview?: string;
      }>(target.webSocketDebuggerUrl!, `(async () => {
        const hostFrame = document.getElementById('active-frame');
        const doc = hostFrame?.contentDocument;
        const win = hostFrame?.contentWindow;
        const view = win?.__cmView;
        if (!doc || !view) {
          const scripts = doc
            ? [...doc.querySelectorAll('script')].map(script => script.getAttribute('src') ?? '[inline]').join(', ')
            : 'no document';
          const body = doc?.body?.textContent?.trim().slice(0, 160) ?? '';
          return { ok: false, reason: 'missing editor', preview: scripts + ' :: ' + body };
        }
        const source = view.state.doc.toString();
        if (!source.includes(${JSON.stringify(docNeedle)})) {
          return { ok: false, reason: 'doc mismatch', preview: source.slice(0, 120) };
        }
        return { ok: true, value: await (async () => {
          ${body}
        })() };
      })()`);

      if (result.ok) return result.value as T;
      mismatches.push(`${result.reason ?? 'unknown'}: ${result.preview ?? target.title ?? target.url ?? ''}`);
    }

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw new Error(`Human Learning markdown webview not found for ${JSON.stringify(docNeedle)}. Candidates: ${mismatches.join(' | ')}`);
}

async function cdpEvaluate<T>(wsUrl: string, expression: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const id = 1;
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out while evaluating VS Code webview'));
    }, 10_000);

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: {
          expression,
          returnByValue: true,
          awaitPromise: true,
        },
      }));
    });

    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) {
        reject(new Error(JSON.stringify(message.error)));
        return;
      }
      if (message.result?.exceptionDetails) {
        reject(new Error(JSON.stringify(message.result.exceptionDetails)));
        return;
      }
      resolve((message.result?.result?.value ?? message.result?.result?.description) as T);
    });

    socket.addEventListener('error', event => {
      clearTimeout(timer);
      reject(new Error(`CDP websocket error: ${String(event)}`));
    });
  });
}

test.describe('Human Learning — VS Code Extension E2E', () => {

  test('extension activates and VS Code loads', async ({ vsCodePage: page }) => {
    // Verify VS Code workbench is loaded
    await expect(page.locator('.monaco-workbench')).toBeVisible();
    await screenshot(page, '01-workbench-loaded');

    // Check for the editor area
    await expect(page.locator('.monaco-editor, .editor-instance, .split-view-view').first()).toBeVisible({
      timeout: 15_000,
    });

    await screenshot(page, '02-editor-area-visible');
  });

  test('Human Learning sidebar icon is present', async ({ vsCodePage: page }) => {
    // Look for activity bar items
    const activityBar = page.locator('.activitybar, .activity-bar');
    await expect(activityBar).toBeVisible({ timeout: 10_000 });

    // Count all activity bar action items
    const actionItems = page.locator('.activitybar .action-item, .activity-bar .action-item');
    const count = await actionItems.count();
    console.log(`[info] Activity bar items: ${count}`);

    // Try to find the Human Learning icon by iterating
    let hlFound = false;
    for (let i = 0; i < count; i++) {
      const item = actionItems.nth(i);
      const title = await item.getAttribute('title') ?? '';
      const label = await item.getAttribute('aria-label') ?? '';
      if (title.toLowerCase().includes('human') || title.toLowerCase().includes('learning') ||
          label.toLowerCase().includes('human') || label.toLowerCase().includes('learning')) {
        hlFound = true;
        console.log(`[info] Found HL icon at index ${i}: title="${title}" label="${label}"`);
        break;
      }
    }

    if (!hlFound) {
      console.log('[info] HL icon not found by title/label, checking all items...');
      for (let i = 0; i < count; i++) {
        const item = actionItems.nth(i);
        const title = await item.getAttribute('title') ?? '';
        console.log(`[info] Activity bar item ${i}: "${title}"`);
      }
    }

    await screenshot(page, '03-activity-bar');
  });

  test('can open Quick Open and search for files', async ({ vsCodePage: page }) => {
    // Open Quick Open (Cmd+P on macOS, Ctrl+P elsewhere)
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await openQuickInput(page, `${modifier}+p`);

    // Type a search query
    await page.keyboard.type('FlashAttention', { delay: 50 });
    await page.waitForTimeout(1500);

    await screenshot(page, '04-quick-open-search');

    // Verify quick input widget is visible
    const quickInput = page.locator('.quick-input-widget').first();
    await expect(quickInput).toBeVisible({ timeout: 5_000 });

    // Press Escape to close
    await closeQuickInput(page);

    await screenshot(page, '05-quick-open-closed');
  });

  test('can open a markdown file', async ({ vsCodePage: page }) => {
    // Open FlashAttention.md via Quick Open
    await openQuickFile(page, 'FlashAttention', 3000);

    await screenshot(page, '06-markdown-file-opened');

    // Check for editor content
    const editors = page.locator('.editor-instance, .monaco-editor');
    const editorCount = await editors.count();
    console.log(`[info] Editor instances: ${editorCount}`);

    await screenshot(page, '07-markdown-editor-content');
  });

  test('can open command palette and find Human Learning commands', async ({ vsCodePage: page }) => {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

    // Open Command Palette (Cmd+Shift+P)
    await openQuickInput(page, `${modifier}+Shift+p`);

    await page.keyboard.type('Human Learning', { delay: 50 });
    await page.waitForTimeout(1500);

    await screenshot(page, '08-command-palette');

    // Check for command entries
    const commands = page.locator('.quick-input-list .monaco-list-row');
    const commandCount = await commands.count();
    console.log(`[info] Human Learning commands found: ${commandCount}`);

    // List the commands
    for (let i = 0; i < Math.min(commandCount, 5); i++) {
      const text = await commands.nth(i).textContent() ?? '';
      console.log(`[info] Command ${i}: ${text.trim()}`);
    }

    await screenshot(page, '09-commands-listed');

    // Close palette
    await closeQuickInput(page);
  });

  test('can open a PDF file in custom viewer', async ({ vsCodePage: page }) => {
    // Open PDF via Quick Open
    await openQuickFile(page, 'flash-attention', 4000);

    await screenshot(page, '10-pdf-file-opened');

    // Check for webview elements (PDF viewer runs in a webview)
    const webviews = page.locator('webview, iframe[title*="PDF"], iframe[title*="Human"]');
    const webviewCount = await webviews.count();
    console.log(`[info] PDF webview elements: ${webviewCount}`);

    await screenshot(page, '11-pdf-viewer-visible');
  });

  test('sidebar shows tree views when Human Learning icon is clicked', async ({ vsCodePage: page }) => {
    // Find and click the Human Learning activity bar icon
    const actionItems = page.locator('.activitybar .action-item, .activity-bar .action-item');
    const count = await actionItems.count();

    for (let i = 0; i < count; i++) {
      const item = actionItems.nth(i);
      const title = await item.getAttribute('title') ?? '';
      const label = await item.getAttribute('aria-label') ?? '';
      if (title.toLowerCase().includes('human') || title.toLowerCase().includes('learning') ||
          label.toLowerCase().includes('human') || label.toLowerCase().includes('learning')) {
        await item.click();
        await page.waitForTimeout(1500);
        console.log(`[info] Clicked HL sidebar icon at index ${i}`);
        break;
      }
    }

    await screenshot(page, '12-sidebar-opened');

    // Check for sidebar content
    const sidebar = page.locator('.sidebar, .composite.viewlet, .pane-view');
    if (await sidebar.count() > 0) {
      await expect(sidebar.first()).toBeVisible({ timeout: 5_000 });
    }

    await screenshot(page, '13-sidebar-content');
  });

  test('full workflow: open note, navigate to PDF, check sidebar', async ({ vsCodePage: page }) => {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

    // Step 1: Open FlashAttention note
    await openQuickFile(page, 'FlashAttention', 3000);

    await screenshot(page, '14-workflow-note-opened');

    // Step 2: Open Human Learning sidebar
    const actionItems = page.locator('.activitybar .action-item, .activity-bar .action-item');
    const count = await actionItems.count();
    for (let i = 0; i < count; i++) {
      const item = actionItems.nth(i);
      const title = await item.getAttribute('title') ?? '';
      if (title.toLowerCase().includes('human') || title.toLowerCase().includes('learning')) {
        await item.click();
        await page.waitForTimeout(1500);
        break;
      }
    }

    await screenshot(page, '15-workflow-sidebar-open');

    // Step 3: Show backlinks via command palette
    await openQuickInput(page, `${modifier}+Shift+p`);
    await page.keyboard.type('Show Backlinks', { delay: 50 });
    await page.waitForTimeout(1000);

    await screenshot(page, '16-workflow-backlinks-cmd');

    // Try to execute the command
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);

    await screenshot(page, '17-workflow-backlinks-result');

    // Step 4: Final overview
    await screenshot(page, '18-workflow-complete');
  });

  test('settings page is accessible', async ({ vsCodePage: page }) => {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

    // Open Settings (Cmd+,)
    await page.keyboard.press(`${modifier}+,`);
    await page.waitForTimeout(1000);

    await screenshot(page, '19-settings-opened');

    // Search for human learning
    const searchInput = page.locator('.settings-editor .search-widget input, .settings-search-input input');
    if (await searchInput.count() > 0) {
      await searchInput.first().fill('human learning');
      await page.waitForTimeout(1000);
    }

    await screenshot(page, '20-settings-search');

    // Close settings
    await page.keyboard.press(`${modifier}+w`);
    await page.waitForTimeout(500);

    await screenshot(page, '21-settings-closed');
  });

  // ── Math & Code Rendering Tests ──

  test('opens Math and Code rendering test file', async ({ vsCodePage: page }) => {
    await openMathAndCode(page);

    await screenshot(page, '22-math-code-file-opened');

    // Verify the file is loaded in the editor
    const editor = page.locator('.monaco-editor, .editor-instance').first();
    await expect(editor).toBeVisible({ timeout: 10_000 });
  });

  test('inline math equations render via MathJax', async ({ vsCodePage: page }) => {
    await openMathAndCode(page);

    await screenshot(page, '23-inline-math-loaded');

    await moveCursorToTop(page);

    await screenshot(page, '24-inline-math-deselected');
    await screenshot(page, '25-inline-math-rendered');
  });

  test('block math equations render via MathJax', async ({ vsCodePage: page }) => {
    await openMathAndCode(page);

    await moveCursorToTop(page);

    await screenshot(page, '26-block-math-rendered');
  });

  test('code blocks render with syntax highlighting', async ({ vsCodePage: page }) => {
    await openMathAndCode(page);

    await moveCursorToTop(page);

    // Scroll down to see code blocks (Cmd+End jumps to end of file)
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+End`);
    await page.waitForTimeout(2000);

    // Move cursor back to top so widgets render (cursor in block hides widget)
    await page.keyboard.press(`${modifier}+Home`);
    await page.waitForTimeout(500);

    // Scroll down with PageDown to see code blocks while keeping cursor at top
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(1500);

    await screenshot(page, '28-code-blocks-rendered');
  });

  test('code blocks have Prism syntax tokens', async ({ vsCodePage: page }) => {
    await openMathAndCode(page);

    await moveCursorToTop(page);

    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(1500);

    await screenshot(page, '30-syntax-highlighting-tokens');
  });

  test('inactive display math source is hidden in the VS Code webview', async ({ vsCodePage: page }) => {
    await openQuickFile(page, 'Online Softmax');

    await evaluateHumanLearningWebview('m_k = \\max', `
      const heading = view.state.doc.line(6);
      view.dispatch({ selection: { anchor: heading.from }, scrollIntoView: true });
      view.focus();
      return true;
    `);
    await page.waitForTimeout(500);

    const mathState = await evaluateHumanLearningWebview<{
      selectedLine: number;
      rawMathSourceRows: string[];
      renderedMathBlocks: number;
      sourceLineNumber: number;
      sourceLineText: string;
      sourceRowText: string;
    }>('m_k = \\max', `
      const mathSource = '$$m_k = \\\\max(m_{k-1}, x_k)$$';
      const sourceLine = view.state.doc.lineAt(view.state.doc.toString().indexOf(mathSource));
      const numberRows = [...doc.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
        .map(row => {
          const rect = row.getBoundingClientRect();
          return { text: row.textContent?.trim() ?? '', top: rect.top, height: rect.height };
        })
        .filter(row => row.text.length > 0 && row.height > 0);
      const sourceNumberRow = numberRows.find(row => row.text === String(sourceLine.number));
      const sourceRow = [...doc.querySelectorAll('.cm-line')]
        .find(line => sourceNumberRow && Math.abs(line.getBoundingClientRect().top - sourceNumberRow.top) <= 1);
      return {
        selectedLine: view.state.doc.lineAt(view.state.selection.main.head).number,
        rawMathSourceRows: [...doc.querySelectorAll('.cm-line')]
          .map(line => line.textContent ?? '')
          .filter(text => text.includes('$$m_k')),
        renderedMathBlocks: doc.querySelectorAll('.cm-hybrid-math-block mjx-container[jax="SVG"]').length,
        sourceLineNumber: sourceLine.number,
        sourceLineText: sourceLine.text,
        sourceRowText: sourceRow?.textContent ?? '',
      };
    `);

    expect(mathState.selectedLine).toBe(6);
    expect(mathState.sourceLineNumber).toBe(14);
    expect(mathState.sourceLineText).toBe('$$m_k = \\max(m_{k-1}, x_k)$$');
    expect(mathState.renderedMathBlocks).toBeGreaterThanOrEqual(1);
    expect(mathState.rawMathSourceRows).toEqual([]);
    expect(mathState.sourceRowText).not.toContain('$$m_k');
  });

  test('active fenced code keeps padding and Prism highlighting in the VS Code webview', async ({ vsCodePage: page }) => {
    await openMathAndCode(page);

    const inactiveCodeState = await evaluateHumanLearningWebview<{
      selectedLine: number;
      lineLeft: number;
      linePaddingLeft: string;
      lineColor: string;
      keywordText: string;
      keywordColor: string;
      tokenCount: number;
    }>('def softmax(x):', `
      const source = view.state.doc.toString();
      const target = source.indexOf('def softmax(x):');
      const targetLine = view.state.doc.lineAt(target);
      const topLine = view.state.doc.line(1);
      view.dispatch({ selection: { anchor: topLine.from } });
      const targetBlock = view.lineBlockAt(targetLine.from);
      view.scrollDOM.scrollTop = Math.max(0, targetBlock.top - 160);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const codeLine = [...doc.querySelectorAll('.cm-hybrid-codeblock-content-line')]
        .find(line => line.textContent?.includes('def softmax(x):'));
      const keyword = codeLine?.querySelector('.cm-hybrid-prism-token.token.keyword');
      const lineStyle = codeLine ? getComputedStyle(codeLine) : null;
      const keywordStyle = keyword ? getComputedStyle(keyword) : null;
      return {
        selectedLine: view.state.doc.lineAt(view.state.selection.main.head).number,
        lineLeft: codeLine?.getBoundingClientRect().left ?? 0,
        linePaddingLeft: lineStyle?.paddingLeft ?? '',
        lineColor: lineStyle?.color ?? '',
        keywordText: keyword?.textContent ?? '',
        keywordColor: keywordStyle?.color ?? '',
        tokenCount: codeLine?.querySelectorAll('.cm-hybrid-prism-token').length ?? 0,
      };
    `);

    await evaluateHumanLearningWebview('def softmax(x):', `
      const source = view.state.doc.toString();
      const target = source.indexOf('def softmax(x):');
      const line = view.state.doc.lineAt(target);
      view.dispatch({ selection: { anchor: line.from + 2 }, scrollIntoView: true });
      view.focus();
      return true;
    `);
    await page.waitForTimeout(750);

    const codeState = await evaluateHumanLearningWebview<{
      selectedLineText: string;
      selectedLineClass: string;
      selectedLineLeft: number;
      siblingLineClass: string;
      siblingLineLeft: number;
      selectedLinePaddingLeft: string;
      keywordText: string;
      keywordColor: string;
      lineColor: string;
      tokenCount: number;
    }>('def softmax(x):', `
      const selectedDocLine = view.state.doc.lineAt(view.state.selection.main.head);
      const codeLines = [...doc.querySelectorAll('.cm-hybrid-codeblock-content-line')];
      const selectedLine = codeLines.find(line => line.textContent?.includes('def softmax(x):'));
      const siblingLine = codeLines.find(line => line.textContent?.includes('e_x = np.exp'));
      const keyword = selectedLine?.querySelector('.cm-hybrid-prism-token.token.keyword');
      const selectedStyle = selectedLine ? getComputedStyle(selectedLine) : null;
      const keywordStyle = keyword ? getComputedStyle(keyword) : null;
      return {
        selectedLineText: selectedDocLine.text,
        selectedLineClass: selectedLine?.className ?? '',
        selectedLineLeft: selectedLine?.getBoundingClientRect().left ?? 0,
        siblingLineClass: siblingLine?.className ?? '',
        siblingLineLeft: siblingLine?.getBoundingClientRect().left ?? 0,
        selectedLinePaddingLeft: selectedStyle?.paddingLeft ?? '',
        keywordText: keyword?.textContent ?? '',
        keywordColor: keywordStyle?.color ?? '',
        lineColor: selectedStyle?.color ?? '',
        tokenCount: selectedLine?.querySelectorAll('.cm-hybrid-prism-token').length ?? 0,
      };
    `);

    expect(inactiveCodeState.selectedLine).toBe(1);
    expect(inactiveCodeState.keywordText).toBe('def');
    expect(inactiveCodeState.tokenCount).toBeGreaterThan(0);
    expect(codeState.selectedLineText).toBe('def softmax(x):');
    expect(codeState.selectedLineClass).toContain('cm-hybrid-codeblock-content-line');
    expect(codeState.siblingLineClass).toContain('cm-hybrid-codeblock-content-line');
    expect(Math.abs(codeState.selectedLineLeft - codeState.siblingLineLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(codeState.selectedLineLeft - inactiveCodeState.lineLeft)).toBeLessThanOrEqual(1);
    expect(codeState.selectedLinePaddingLeft).toBe(inactiveCodeState.linePaddingLeft);
    expect(codeState.keywordText).toBe('def');
    expect(codeState.tokenCount).toBeGreaterThan(0);
    expect(codeState.keywordColor).not.toBe(codeState.lineColor);
    expect(codeState.keywordColor).toBe(inactiveCodeState.keywordColor);
  });

  test('math and code both render in full document view', async ({ vsCodePage: page }) => {
    await openMathAndCode(page);

    await moveCursorToTop(page);

    // Screenshot 1: Top of document (inline math + block math visible)
    await screenshot(page, '31-full-document-with-math-and-code');

    // Screenshot 2: Top showing inline math area
    await screenshot(page, '32-full-document-inline-math');

    // Scroll down to see code blocks while keeping cursor at top
    // (so widgets are not hidden by cursor presence inside block)
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(1500);
    await screenshot(page, '33-full-document-code-blocks');

    // Scroll further down to see more code blocks
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(1500);
    await screenshot(page, '34-full-document-more-code-blocks');
  });

  test('inline math inside Markdown lists renders in the VS Code webview', async ({ vsCodePage: page }) => {
    await openMathAndCode(page);

    await moveCursorToTop(page);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 2600);
    await page.waitForTimeout(1500);

    const listMathState = await evaluateHumanLearningWebview<{
      selectedLine: number;
      renderedInlineMath: number;
      listRows: Array<{
        label: string;
        sourceLine: number;
        sourceText: string;
        text: string;
        className: string;
        html: string;
        inlineMathCount: number;
      }>;
      rawDollarRows: string[];
      htmlScripts: string[];
    }>('Math Inside Lists', `
      const source = view.state.doc.toString();
      const visibleRows = [...doc.querySelectorAll('.cm-line')];
      const numberRows = [...doc.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
        .map(row => {
          const rect = row.getBoundingClientRect();
          return { text: row.textContent?.trim() ?? '', top: rect.top, height: rect.height };
        })
        .filter(row => row.text.length > 0 && row.height > 0);
      const listRows = ['Softmax:', 'Cross-entropy loss:', 'Gradient:']
        .map(label => {
          const sourceIndex = source.indexOf('- ' + label);
          const sourceLine = view.state.doc.lineAt(sourceIndex);
          const numberRow = numberRows.find(row => row.text === String(sourceLine.number));
          const row = visibleRows.find(line => (
            numberRow && Math.abs(line.getBoundingClientRect().top - numberRow.top) <= 1
          ));
          return {
            label,
            sourceLine: sourceLine.number,
            sourceText: sourceLine.text,
            text: row?.textContent ?? '',
            className: row?.className ?? '',
            html: row?.innerHTML ?? '',
            inlineMathCount: row?.querySelectorAll('.cm-hybrid-inline-math mjx-container[jax="SVG"]').length ?? 0,
          };
        });
      return {
        selectedLine: view.state.doc.lineAt(view.state.selection.main.head).number,
        renderedInlineMath: doc.querySelectorAll('.cm-hybrid-inline-math mjx-container[jax="SVG"]').length,
        listRows,
        rawDollarRows: listRows
          .filter(row => row.text.includes('$') || row.html.includes('$'))
          .map(row => row.label + ': ' + row.text),
        htmlScripts: [...doc.querySelectorAll('script')]
          .map(script => script.getAttribute('src') ?? script.textContent?.slice(0, 80) ?? ''),
      };
    `);
    expect(listMathState.selectedLine).toBeLessThan(10);
    expect(listMathState.htmlScripts.some(script => /markdown-editor-\d+-\d+\.js/.test(script))).toBe(true);
    expect(listMathState.renderedInlineMath).toBeGreaterThanOrEqual(3);
    expect(listMathState.listRows).toHaveLength(3);
    expect(listMathState.listRows.map(row => row.sourceText)).toEqual([
      '- Softmax: $\\sigma(x_i) = \\frac{e^{x_i}}{\\sum_j e^{x_j}}$',
      '- Cross-entropy loss: $L = -\\sum_{i} y_i \\log(\\hat{y}_i)$',
      '- Gradient: $\\frac{\\partial L}{\\partial x_i} = \\hat{y}_i - y_i$',
    ]);
    expect(listMathState.listRows.every(row => row.inlineMathCount >= 1)).toBe(true);
    expect(listMathState.rawDollarRows).toEqual([]);

    await screenshot(page, '35-list-inline-math-rendered');
  });

  test('arrow down navigation inside code block does not throw error', async ({ vsCodePage: page }) => {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await openQuickFile(page, 'notes/Concepts/Math and Code.md', 4000);

    // Listen for VS Code error notifications and console errors
    const errorMessages: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errorMessages.push(msg.text());
      }
    });
    page.on('pageerror', error => {
      errorMessages.push(`PageError: ${error.message}`);
    });

    // Click in the editor area to focus the webview
    const editorArea = page.locator('iframe.webview:visible').first();
    await editorArea.click();
    await page.waitForTimeout(500);

    // Navigate to start, then press arrow down many times to reach line 78
    await page.keyboard.press(`${modifier}+Home`);
    await page.waitForTimeout(500);

    // Press arrow down 90 times to navigate through entire document
    for (let i = 0; i < 90; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(50);
    }

    await screenshot(page, '36-after-down-arrow-many');

    // Look for VS Code error notification
    const errorNotifications = await page.locator('.notification-list-item .notification-list-item-message').allTextContents();
    const humanLearningErrors = errorNotifications.filter(text =>
      text.includes('Human Learning Markdown') || text.includes("Cannot read properties of undefined")
    );

    console.log(`[info] Console/Page errors: ${errorMessages.length}`);
    if (errorMessages.length > 0) {
      console.log('[error] Errors:', errorMessages);
    }
    console.log(`[info] VS Code error notifications: ${errorNotifications.length}`);
    if (humanLearningErrors.length > 0) {
      console.log('[error] Human Learning errors:', humanLearningErrors);
    }

    expect(humanLearningErrors).toHaveLength(0);
    expect(errorMessages.filter(m => m.includes("Cannot read properties of undefined"))).toHaveLength(0);
  });

  test('Vim normal mode inserts on the current VS Code webview line after pressing i', async ({ vsCodePage: page }) => {
    await openQuickFile(page, 'notes/Concepts/Math and Code.md', 4000);

    const editorArea = page.locator('iframe.webview:visible').first();
    await editorArea.click();
    await page.waitForTimeout(500);

    await evaluateHumanLearningWebview('Math and Code Rendering Test', `
      win.postMessage({ type: 'setVimMode', enabled: true }, '*');
      const targetLineNumber = 8;
      const line = view.state.doc.line(targetLineNumber);
      view.dispatch({ selection: { anchor: line.to } });
      view.focus();
      return {
        lineNumber: targetLineNumber,
        lineText: line.text,
        head: view.state.selection.main.head,
      };
    `);

    await page.keyboard.press('Escape');
    await page.keyboard.press('i');
    await page.keyboard.type('whoami');
    await page.waitForTimeout(1500);

    const state = await evaluateHumanLearningWebview<{
      lineNumber: number;
      lineText: string;
      column: number;
      cursorTop: number | null;
      cursorBottom: number | null;
      activeLineTop: number | null;
      activeLineBottom: number | null;
    }>('Math and Code Rendering Test', `
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      const cursor = doc.querySelector('.cm-cursor');
      const activeLine = [...doc.querySelectorAll('.cm-line')]
        .find(element => element.textContent?.includes('whoami'));
      const cursorRect = cursor?.getBoundingClientRect();
      const activeLineRect = activeLine?.getBoundingClientRect();
      return {
        lineNumber: line.number,
        lineText: line.text,
        column: head - line.from,
        cursorTop: cursorRect?.top ?? null,
        cursorBottom: cursorRect?.bottom ?? null,
        activeLineTop: activeLineRect?.top ?? null,
        activeLineBottom: activeLineRect?.bottom ?? null,
      };
    `);

    expect(state.lineNumber).toBe(8);
    expect(state.lineText).toContain('whoami');
    expect(state.cursorTop).not.toBeNull();
    expect(state.activeLineTop).not.toBeNull();
    expect(state.cursorTop!).toBeGreaterThanOrEqual(state.activeLineTop! - 1);
    expect(state.cursorBottom!).toBeLessThanOrEqual(state.activeLineBottom! + 1);
  });

  test('VS Code webview keeps Ctrl+O stable and opens rendered table cells on their source row', async ({ vsCodePage: page }) => {
    await openQuickFile(page, 'notes/Concepts/Math and Code.md', 4000);

    const editorArea = page.locator('iframe.webview:visible').first();
    await editorArea.click();
    await page.waitForTimeout(500);

    const scratchDoc = [
      '# VS Code Scratch',
      '',
      'Alpha beta',
      '',
      '| Left | Right |',
      '| --- | --- |',
      '| Row zero | Cell target |',
      '',
      'Tail line',
    ].join('\n');

    await evaluateHumanLearningWebview('Math and Code Rendering Test', `
      const scratchDoc = ${JSON.stringify(scratchDoc)};
      win.postMessage({ type: 'setVimMode', enabled: false }, '*');
      win.postMessage({
        type: 'setText',
        text: scratchDoc,
        currentNotePath: 'notes/Scratch Production Note.md',
        notePaths: ['notes/Concepts/FlashAttention.md'],
      }, '*');
      await new Promise(resolve => setTimeout(resolve, 250));
      const targetLine = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: targetLine.to } });
      view.focus();
      return view.state.doc.toString();
    `);

    await page.keyboard.press('Control+O');
    await page.keyboard.press('i');
    await page.keyboard.press('o');
    await page.waitForTimeout(250);
    const ctrlODoc = scratchDoc.replace('Alpha beta', 'Alpha betaio');

    const ctrlOState = await evaluateHumanLearningWebview<{
      text: string;
      lineNumber: number;
      lineText: string;
      column: number;
    }>('Alpha beta', `
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      return {
        text: view.state.doc.toString(),
        lineNumber: line.number,
        lineText: line.text,
        column: head - line.from,
      };
    `);

    expect(ctrlOState.text).toBe(ctrlODoc);
    expect(ctrlOState.lineNumber).toBe(3);
    expect(ctrlOState.lineText).toBe('Alpha betaio');
    expect(ctrlOState.column).toBe('Alpha betaio'.length);

    const tableClickState = await evaluateHumanLearningWebview<{
      lineNumber: number;
      lineText: string;
      column: number;
      tableWidgetCount: number;
      clicked: boolean;
    }>('Alpha beta', `
      const tailLine = view.state.doc.line(view.state.doc.lines);
      view.dispatch({ selection: { anchor: tailLine.from } });
      view.focus();
      await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
      const cell = [...doc.querySelectorAll('.cm-hybrid-table td')]
        .find(element => element.textContent?.includes('Cell target'));
      if (!cell) {
        return {
          lineNumber: -1,
          lineText: '',
          column: -1,
          tableWidgetCount: doc.querySelectorAll('.cm-hybrid-table-widget').length,
          clicked: false,
        };
      }
      cell.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        view: win,
      }));
      await new Promise(resolve => setTimeout(resolve, 100));
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      return {
        lineNumber: line.number,
        lineText: line.text,
        column: head - line.from,
        tableWidgetCount: doc.querySelectorAll('.cm-hybrid-table-widget').length,
        clicked: true,
      };
    `);

    expect(tableClickState.clicked).toBe(true);
    expect(tableClickState.lineNumber).toBe(7);
    expect(tableClickState.lineText).toBe('| Row zero | Cell target |');
    expect(tableClickState.column).toBe(tableClickState.lineText.indexOf('Cell target'));
    expect(tableClickState.tableWidgetCount).toBe(0);
  });
});
