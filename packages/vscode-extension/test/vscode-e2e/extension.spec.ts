import { test as base, expect, chromium, type Page, type BrowserContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolveVsCodeE2eTestDir } from './testDirectory.mjs';
import { MULTIPAGE_PDF_FIXTURE, VIM_SANDBOXES } from './sandboxFixtures.mjs';

const TEST_DIR = resolveVsCodeE2eTestDir();
const WS_URL_FILE = path.resolve(TEST_DIR, 'ws-url');
const DEBUG_PORT_FILE = path.resolve(TEST_DIR, 'debug-port');
const CODE_CLI_FILE = path.resolve(TEST_DIR, 'code-cli');
const USER_DATA_DIR = path.resolve(TEST_DIR, 'user-data');
const EXTENSIONS_DIR = path.resolve(TEST_DIR, 'extensions');
const SCREENSHOT_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'e2e-report', 'vscode-e2e-screenshots');
const execFileAsync = promisify(execFile);

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// Custom fixture that connects to VS Code via CDP
const test = base.extend<{ vsCodePage: Page; vsCodeContext: BrowserContext }>({
  vsCodePage: async ({}, use) => {
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

async function openExplorerOutline(page: Page): Promise<void> {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await focusWorkbenchChrome(page);
  await page.keyboard.press(`${modifier}+Shift+E`);

  const outlineHeader = page.locator('.sidebar .pane-header, .part.sidebar .pane-header')
    .filter({ hasText: /^PDF Outline$/i })
    .last();
  await expect(outlineHeader).toBeVisible({ timeout: 10_000 });
  if (await outlineHeader.getAttribute('aria-expanded') === 'false') {
    await outlineHeader.click();
  }
}

async function runCommandFromPalette(page: Page, query: string, waitMs = 500): Promise<void> {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await openQuickInput(page, `${modifier}+Shift+p`);
  await page.keyboard.type(query, { delay: 50 });
  await page.waitForTimeout(1000);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(waitMs);
}

async function ensureHostVimMode(page: Page, docNeedle: string, enabled: boolean): Promise<void> {
  const current = await evaluateLlmWikiWebview<boolean>(docNeedle, `
    return typeof win.__llmWikiVimModeEnabled === 'function' ? win.__llmWikiVimModeEnabled() : false;
  `);
  if (current !== enabled) {
    await runCommandFromPalette(page, 'LLM Wiki: Toggle Vim Mode', 750);
  }
  await expect.poll(() => evaluateLlmWikiWebview<boolean>(docNeedle, `
    return typeof win.__llmWikiVimModeEnabled === 'function' ? win.__llmWikiVimModeEnabled() : false;
  `)).toBe(enabled);
}

async function openMathAndCode(page: Page): Promise<void> {
  await openQuickFile(page, 'notes/Concepts/Math and Code.md');
  await expect(page.locator('iframe.webview:visible').first()).toBeVisible({ timeout: 15_000 });
}

async function openVimSandbox(
  page: Page,
  fixture: (typeof VIM_SANDBOXES)[keyof typeof VIM_SANDBOXES],
): Promise<string> {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await focusWorkbenchChrome(page);
  await page.keyboard.press(`${modifier}+K`);
  await page.keyboard.press('W');
  await page.waitForTimeout(750);
  await openQuickFile(page, fixture.relativePath, 4000);
  await expect(page.locator('iframe.webview:visible').first()).toBeVisible({ timeout: 15_000 });
  return fixture.marker;
}

interface EditorPixelMetrics {
  editorLeft: number;
  editorTop: number;
  editorWidth: number;
  contentLeft: number;
  contentTop: number;
  contentWidth: number;
  firstLineLeft: number;
  firstLineTop: number;
  firstLineHeight: number;
  firstLineFontFamily: string;
  firstLineFontSize: string;
  firstLineFontStyle: string;
  firstLineFontWeight: string;
  firstLineLineHeight: string;
  firstLineLetterSpacing: string;
  firstLineTextWidth: number;
  firstLineTextHeight: number;
  firstLineTextRows: number;
  firstLineIsActive: boolean;
  lineNumberLeft: number;
  lineNumberTop: number;
  lineNumberWidth: number;
  lineNumberHeight: number;
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

async function evaluateLlmWikiWebview<T>(
  docNeedle: string,
  body: string,
  titleNeedle?: string,
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
      && (target.url ?? '').includes('extensionId=llm-wiki.llm-wiki-vscode')
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
          const scriptReady = typeof win?.__llmWikiCommands === 'object';
          return {
            ok: false,
            reason: 'missing editor',
            preview: 'scriptReady=' + scriptReady
              + ' readyState=' + (doc?.readyState ?? 'no document')
              + ' :: ' + scripts + ' :: ' + body,
          };
        }
        const source = view.state.doc.toString();
        const title = doc.querySelector('input.cm-hybrid-document-title')?.value ?? '';
        if (!source.includes(${JSON.stringify(docNeedle)}) || (${JSON.stringify(titleNeedle)} && !title.includes(${JSON.stringify(titleNeedle)}))) {
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

  throw new Error(`LLM Wiki markdown webview not found for ${JSON.stringify(docNeedle)}. Candidates: ${mismatches.join(' | ')}`);
}

async function evaluateLlmWikiPdfWebview<T>(body: string): Promise<T> {
  const debugPort = Number(fs.readFileSync(DEBUG_PORT_FILE, 'utf-8').trim());
  const deadline = Date.now() + 20_000;
  let mismatches: string[] = [];

  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await response.json() as DevtoolsTarget[];
    const webviews = targets.filter(target => (
      target.type === 'iframe'
      && typeof target.webSocketDebuggerUrl === 'string'
      && (target.url ?? '').includes('extensionId=llm-wiki.llm-wiki-vscode')
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
        const viewer = doc?.querySelector('#viewer-container');
        if (!doc || !win || !viewer) {
          return {
            ok: false,
            reason: 'missing PDF viewer',
            preview: doc?.body?.textContent?.trim().slice(0, 160) ?? 'no document',
          };
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

  throw new Error(`LLM Wiki PDF webview not found. Candidates: ${mismatches.join(' | ')}`);
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

function expectCloseTo(actual: number, expected: number, tolerance = 1): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

test.describe('LLM Wiki — VS Code Extension E2E', () => {

  test('the real VS Code CLI opens a missing Markdown path as an unsaved LLM Wiki document', async ({ vsCodePage: page }) => {
    const filename = `cli-untitled-${Date.now()}.md`;
    const target = path.resolve(TEST_DIR, 'fixtures', 'test-vault', 'notes', filename);
    const content = '# CLI untitled markdown\n\nOnly explicit save creates this file.\n';
    fs.rmSync(target, { force: true });

    const codeCli = fs.readFileSync(CODE_CLI_FILE, 'utf-8').trim();
    await execFileAsync(codeCli, [
      '--reuse-window',
      `--user-data-dir=${USER_DATA_DIR}`,
      `--extensions-dir=${EXTENSIONS_DIR}`,
      target,
    ], {
      env: { ...process.env, ELECTRON_NO_ATTACH_CONSOLE: '1' },
      timeout: 30_000,
    });

    await expect.poll(() => fs.existsSync(target)).toBe(false);
    await expect(page.locator('.tab.active, .tab[aria-selected="true"]').filter({ hasText: filename }).last()).toBeVisible({
      timeout: 15_000,
    });
    await evaluateLlmWikiWebview('', `
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(content)} } });
    `, filename.replace(/\.md$/i, ''));
    await page.waitForTimeout(450);
    expect(fs.existsSync(target)).toBe(false);

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
    await expect.poll(() => fs.existsSync(target), { timeout: 15_000 }).toBe(true);
    expect(fs.readFileSync(target, 'utf-8')).toBe(content);
    fs.rmSync(target, { force: true });
  });

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

  test('LLM Wiki sidebar icon is present', async ({ vsCodePage: page }) => {
    // Look for activity bar items
    const activityBar = page.locator('.activitybar, .activity-bar');
    await expect(activityBar).toBeVisible({ timeout: 10_000 });

    // Count all activity bar action items
    const actionItems = page.locator('.activitybar .action-item, .activity-bar .action-item');
    const count = await actionItems.count();
    console.log(`[info] Activity bar items: ${count}`);

    // Try to find the LLM Wiki icon by iterating
    let llmWikiFound = false;
    for (let i = 0; i < count; i++) {
      const item = actionItems.nth(i);
      const title = await item.getAttribute('title') ?? '';
      const label = await item.getAttribute('aria-label') ?? '';
      if (title.toLowerCase().includes('human') || title.toLowerCase().includes('learning') ||
          label.toLowerCase().includes('human') || label.toLowerCase().includes('learning')) {
        llmWikiFound = true;
        console.log(`[info] Found LLM Wiki icon at index ${i}: title="${title}" label="${label}"`);
        break;
      }
    }

    if (!llmWikiFound) {
      console.log('[info] LLM Wiki icon not found by title/label, checking all items...');
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

  test('can open command palette and find LLM Wiki commands', async ({ vsCodePage: page }) => {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

    // Open Command Palette (Cmd+Shift+P)
    await openQuickInput(page, `${modifier}+Shift+p`);

    await page.keyboard.type('LLM Wiki', { delay: 50 });
    await page.waitForTimeout(1500);

    await screenshot(page, '08-command-palette');

    // Check for command entries
    const commands = page.locator('.quick-input-list .monaco-list-row');
    const commandCount = await commands.count();
    console.log(`[info] LLM Wiki commands found: ${commandCount}`);

    // List the commands
    for (let i = 0; i < Math.min(commandCount, 5); i++) {
      const text = await commands.nth(i).textContent() ?? '';
      console.log(`[info] Command ${i}: ${text.trim()}`);
    }

    await screenshot(page, '09-commands-listed');

    // Close palette
    await closeQuickInput(page);
  });

  test('can open a synthetic multi-page PDF with production controls and a prefetched neighbor', async ({ vsCodePage: page }) => {
    await openQuickFile(page, MULTIPAGE_PDF_FIXTURE, 8000);
    await expect(page.locator('iframe.webview:visible').first()).toBeVisible({ timeout: 15_000 });

    await screenshot(page, '10-pdf-file-opened');

    await evaluateLlmWikiPdfWebview(`
      if (!doc.querySelector('#page-container')?.classList.contains('paginated')) {
        doc.querySelector('[data-display-action="presentation-single"]')?.click();
      }
      return true;
    `);

    await expect.poll(() => evaluateLlmWikiPdfWebview<{
      pageInfo: string;
      pageCount: number;
      firstCanvasReady: boolean;
      neighborCanvasReady: boolean;
      neighborHidden: boolean;
      reduceAnimationLabels: string[];
      hasOutlineTab: boolean;
      focusedOutlineStyle: string;
    }>(`
      const pageInfo = doc.querySelector('#page-info')?.textContent?.trim() ?? '';
      const pageCount = doc.querySelectorAll('.page-wrapper').length;
      const firstCanvas = doc.querySelector('#page-1 canvas.pdf-canvas');
      const neighbor = doc.querySelector('#page-2');
      const neighborCanvas = neighbor?.querySelector('canvas.pdf-canvas');
      viewer.tabIndex = -1;
      viewer.focus({ preventScroll: true });
      return {
        pageInfo,
        pageCount,
        firstCanvasReady: firstCanvas?.dataset.renderQuality === 'full'
          && firstCanvas.width > 0
          && firstCanvas.height > 0,
        neighborCanvasReady: neighborCanvas?.dataset.renderQuality === 'full'
          && neighborCanvas.width > 0
          && neighborCanvas.height > 0,
        neighborHidden: Boolean(neighbor)
          && win.getComputedStyle(neighbor).display === 'none',
        reduceAnimationLabels: [...doc.querySelectorAll(
          '[data-display-action^="reduce-animation-"]',
        )].map(element => element.textContent?.trim() ?? ''),
        hasOutlineTab: Boolean(doc.querySelector('#sidebar-outline-tab')),
        focusedOutlineStyle: win.getComputedStyle(viewer).outlineStyle,
      };
    `), { timeout: 30_000 }).toEqual({
      pageInfo: expect.stringMatching(/^Page 1 \/ 67\b/),
      pageCount: 67,
      firstCanvasReady: true,
      neighborCanvasReady: true,
      neighborHidden: true,
      reduceAnimationLabels: ['On', 'Off', 'System'],
      hasOutlineTab: true,
      focusedOutlineStyle: 'none',
    });

    const pageTurn = await evaluateLlmWikiPdfWebview<{
      durationMs: number;
      firstVisibleFrameHadBitmap: boolean;
      targetCanvasReady: boolean;
    }>(`
      const target = doc.querySelector('#page-2');
      let firstVisibleFrameHadBitmap;
      let sampling = true;
      const sample = () => {
        if (!sampling || firstVisibleFrameHadBitmap !== undefined) return;
        const styles = win.getComputedStyle(target);
        if (
          styles.display !== 'none'
          && Number.parseFloat(styles.opacity || '1') > 0.01
        ) {
          const canvas = target.querySelector('canvas.pdf-canvas');
          firstVisibleFrameHadBitmap = canvas?.dataset.renderQuality === 'full'
            && canvas.width > 0
            && canvas.height > 0;
          return;
        }
        win.requestAnimationFrame(sample);
      };
      win.requestAnimationFrame(sample);
      const startedAt = win.performance.now();
      doc.querySelector('#next')?.click();
      await new Promise((resolve, reject) => {
        const deadline = win.performance.now() + 2_000;
        const poll = () => {
          const pageValue = doc.querySelector('#page-input')?.value;
          if (pageValue === '2' && firstVisibleFrameHadBitmap !== undefined) {
            resolve();
          } else if (win.performance.now() >= deadline) {
            reject(new Error('Timed out waiting for cached page turn'));
          } else {
            win.requestAnimationFrame(poll);
          }
        };
        win.requestAnimationFrame(poll);
      });
      sampling = false;
      const canvas = target.querySelector('canvas.pdf-canvas');
      return {
        durationMs: win.performance.now() - startedAt,
        firstVisibleFrameHadBitmap: firstVisibleFrameHadBitmap === true,
        targetCanvasReady: canvas?.dataset.renderQuality === 'full'
          && canvas.width > 0
          && canvas.height > 0,
      };
    `);
    console.log(`[info] cached multipage-PDF page turn: ${pageTurn.durationMs.toFixed(1)} ms`);
    expect(pageTurn.durationMs).toBeLessThan(750);
    expect(pageTurn.firstVisibleFrameHadBitmap).toBe(true);
    expect(pageTurn.targetCanvasReady).toBe(true);

    await openExplorerOutline(page);
    const outlineTarget = page.getByText('Slide 3: Outline and goals', { exact: true }).last();
    await expect(outlineTarget).toBeVisible({ timeout: 15_000 });
    await outlineTarget.click();
    await expect.poll(() => evaluateLlmWikiPdfWebview<{
      pageInfo: string;
      destinationFocusCount: number;
      historyBackHidden: boolean;
    }>(`
      return {
        pageInfo: doc.querySelector('#page-info')?.textContent?.trim() ?? '',
        destinationFocusCount: doc.querySelectorAll('.pdf-destination-focus').length,
        historyBackHidden: doc.querySelector('#pdf-history-back')?.hidden === true,
      };
    `), { timeout: 15_000 }).toEqual({
      pageInfo: expect.stringMatching(/^Page 2 \/ 67\b/),
      destinationFocusCount: 1,
      historyBackHidden: true,
    });

    await screenshot(page, '11-pdf-viewer-visible');
  });

  test('sidebar shows tree views when LLM Wiki icon is clicked', async ({ vsCodePage: page }) => {
    // Find and click the LLM Wiki activity bar icon
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
        console.log(`[info] Clicked LLM Wiki sidebar icon at index ${i}`);
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

    // Step 2: Open LLM Wiki sidebar
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

  test('markdown source reveal preserves prose typography and line-number alignment', async ({ vsCodePage: page }) => {
    await openQuickFile(page, 'notes/Concepts/Native Typography.md', 4000);
    await expect(page.locator('iframe.webview:visible').first()).toBeVisible({ timeout: 15_000 });

    const transition = await evaluateLlmWikiWebview<{
      inactive: EditorPixelMetrics;
      active: EditorPixelMetrics;
      restored: EditorPixelMetrics;
    }>('Typography Check', `
      const measure = () => {
        const editor = doc.querySelector('.cm-editor');
        const content = doc.querySelector('.cm-content');
        const firstLine = doc.querySelector('.cm-line');
        const lineNumber = [...doc.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
          .find(row => row.textContent?.trim().length > 0 && row.getBoundingClientRect().height > 0);
        if (!editor || !content || !firstLine || !lineNumber) {
          throw new Error('Missing markdown CodeMirror editor elements');
        }
        const editorRect = editor.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        const firstLineRect = firstLine.getBoundingClientRect();
        const lineNumberRect = lineNumber.getBoundingClientRect();
        const firstLineStyle = getComputedStyle(firstLine);
        const textRange = doc.createRange();
        textRange.selectNodeContents(firstLine);
        const textRect = textRange.getBoundingClientRect();
        return {
          editorLeft: editorRect.left,
          editorTop: editorRect.top,
          editorWidth: editorRect.width,
          contentLeft: contentRect.left,
          contentTop: contentRect.top,
          contentWidth: contentRect.width,
          firstLineLeft: firstLineRect.left,
          firstLineTop: firstLineRect.top,
          firstLineHeight: firstLineRect.height,
          firstLineFontFamily: firstLineStyle.fontFamily,
          firstLineFontSize: firstLineStyle.fontSize,
          firstLineFontStyle: firstLineStyle.fontStyle,
          firstLineFontWeight: firstLineStyle.fontWeight,
          firstLineLineHeight: firstLineStyle.lineHeight,
          firstLineLetterSpacing: firstLineStyle.letterSpacing,
          firstLineTextWidth: textRect.width,
          firstLineTextHeight: textRect.height,
          firstLineTextRows: textRange.getClientRects().length,
          firstLineIsActive: firstLine.classList.contains('cm-hybrid-source-line'),
          lineNumberLeft: lineNumberRect.left,
          lineNumberTop: lineNumberRect.top,
          lineNumberWidth: lineNumberRect.width,
          lineNumberHeight: lineNumberRect.height,
        };
      };
      view.dispatch({ selection: { anchor: view.state.doc.line(4).from }, scrollIntoView: true });
      view.focus();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const inactive = measure();
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const active = measure();
      view.dispatch({ selection: { anchor: view.state.doc.line(4).from } });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { inactive, active, restored: measure() };
    `);

    expect(transition.inactive.firstLineIsActive).toBe(false);
    expect(transition.active.firstLineIsActive).toBe(true);
    expect(transition.restored.firstLineIsActive).toBe(false);
    for (const current of [transition.active, transition.restored]) {
      expect({
        fontFamily: current.firstLineFontFamily,
        fontSize: current.firstLineFontSize,
        fontStyle: current.firstLineFontStyle,
        fontWeight: current.firstLineFontWeight,
        lineHeight: current.firstLineLineHeight,
        letterSpacing: current.firstLineLetterSpacing,
        textRows: current.firstLineTextRows,
      }).toEqual({
        fontFamily: transition.inactive.firstLineFontFamily,
        fontSize: transition.inactive.firstLineFontSize,
        fontStyle: transition.inactive.firstLineFontStyle,
        fontWeight: transition.inactive.firstLineFontWeight,
        lineHeight: transition.inactive.firstLineLineHeight,
        letterSpacing: transition.inactive.firstLineLetterSpacing,
        textRows: transition.inactive.firstLineTextRows,
      });
      expectCloseTo(current.firstLineHeight, transition.inactive.firstLineHeight);
      expectCloseTo(current.firstLineTextWidth, transition.inactive.firstLineTextWidth);
      expectCloseTo(current.firstLineTextHeight, transition.inactive.firstLineTextHeight);
    }
    const markdownMetrics = transition.active;
    expectCloseTo(markdownMetrics.firstLineLeft, markdownMetrics.contentLeft);
    expectCloseTo(markdownMetrics.lineNumberTop, markdownMetrics.firstLineTop);
    expectCloseTo(markdownMetrics.lineNumberHeight, markdownMetrics.firstLineHeight);
    expect(markdownMetrics.lineNumberLeft).toBeLessThan(markdownMetrics.contentLeft);
    expect(markdownMetrics.firstLineTop).toBeGreaterThan(markdownMetrics.contentTop);
    expect(markdownMetrics.contentWidth).toBeGreaterThan(0);

    await screenshot(page, '37-native-markdown-pixel-parity');
  });

  test('markdown selection overlays use the active VS Code theme colors', async ({ vsCodePage: page }) => {
    await openQuickFile(page, 'notes/Concepts/Native Typography.md', 4000);
    const webview = page.locator('iframe.webview:visible').first();
    await expect(webview).toBeVisible({ timeout: 15_000 });
    await page.bringToFront();
    await webview.click({ position: { x: 320, y: 260 } });

    const colors = await evaluateLlmWikiWebview<{
      active: string[];
      inactive: string[];
      expectedActive: string;
      expectedInactive: string;
      selectedText: string;
      activeFocused: boolean;
      inactiveFocused: boolean;
    }>('Typography Check', `
      const resolveThemeColor = name => {
        const probe = doc.createElement('span');
        probe.style.backgroundColor = 'var(' + name + ')';
        doc.body.appendChild(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      };
      view.dispatch({
        selection: {
          anchor: view.state.doc.line(1).from + 2,
          head: view.state.doc.line(2).to - 2,
        },
      });
      view.focus();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const selectionColors = () => [...new Set(
        [...doc.querySelectorAll('.cm-selectionLayer .cm-selectionBackground')]
          .map(element => getComputedStyle(element).backgroundColor),
      )];
      const active = selectionColors();
      const activeFocused = doc.querySelector('.cm-editor')?.classList.contains('cm-focused') === true;
      const expectedActive = resolveThemeColor('--vscode-editor-selectionBackground');
      const focusTarget = doc.createElement('button');
      focusTarget.type = 'button';
      doc.body.appendChild(focusTarget);
      focusTarget.focus();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const inactive = selectionColors();
      const inactiveFocused = doc.querySelector('.cm-editor')?.classList.contains('cm-focused') === true;
      const expectedInactive = resolveThemeColor('--vscode-editor-inactiveSelectionBackground');
      focusTarget.remove();
      const range = view.state.selection.main;
      return {
        active,
        inactive,
        expectedActive,
        expectedInactive,
        selectedText: view.state.sliceDoc(range.from, range.to),
        activeFocused,
        inactiveFocused,
      };
    `);

    expect(colors.selectedText).toContain('\n');
    expect(colors.activeFocused).toBe(true);
    expect(colors.inactiveFocused).toBe(false);
    expect(colors.active.length).toBeGreaterThan(0);
    expect(colors.inactive.length).toBeGreaterThan(0);
    expect(colors.active).toEqual([colors.expectedActive]);
    expect(colors.inactive).toEqual([colors.expectedInactive]);
    expect(colors.active).not.toContain('rgb(215, 212, 240)');
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

    await evaluateLlmWikiWebview('m_k = \\max', `
      const heading = view.state.doc.line(6);
      view.dispatch({ selection: { anchor: heading.from }, scrollIntoView: true });
      view.focus();
      return true;
    `);
    await page.waitForTimeout(500);

    const mathState = await evaluateLlmWikiWebview<{
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

    const inactiveCodeState = await evaluateLlmWikiWebview<{
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

    await evaluateLlmWikiWebview('def softmax(x):', `
      const source = view.state.doc.toString();
      const target = source.indexOf('def softmax(x):');
      const line = view.state.doc.lineAt(target);
      view.dispatch({ selection: { anchor: line.from + 2 }, scrollIntoView: true });
      view.focus();
      return true;
    `);
    await page.waitForTimeout(750);

    const codeState = await evaluateLlmWikiWebview<{
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

    const listMathState = await evaluateLlmWikiWebview<{
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
    const llmWikiErrors = errorNotifications.filter(text =>
      text.includes('LLM Wiki Markdown') || text.includes("Cannot read properties of undefined")
    );

    console.log(`[info] Console/Page errors: ${errorMessages.length}`);
    if (errorMessages.length > 0) {
      console.log('[error] Errors:', errorMessages);
    }
    console.log(`[info] VS Code error notifications: ${errorNotifications.length}`);
    if (llmWikiErrors.length > 0) {
      console.log('[error] LLM Wiki errors:', llmWikiErrors);
    }

    expect(llmWikiErrors).toHaveLength(0);
    expect(errorMessages.filter(m => m.includes("Cannot read properties of undefined"))).toHaveLength(0);
  });

  test('Vim mode modifier shortcuts stay stable in the VS Code-hosted markdown webview', async ({ vsCodePage: page }) => {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const initialNeedle = await openVimSandbox(page, VIM_SANDBOXES.modifierShortcuts);
    await ensureHostVimMode(page, initialNeedle, true);

    const shortcuts = [
      { label: 'open file', key: `${modifier}+O` },
      { label: 'italics', key: `${modifier}+I` },
      { label: 'bold', key: `${modifier}+B` },
      { label: 'inline code', key: `${modifier}+Backquote` },
      { label: 'insert link', key: `${modifier}+K` },
      { label: 'insert table', key: `${modifier}+Shift+T` },
    ];
    let docNeedle = initialNeedle;

    for (const shortcut of shortcuts) {
      await test.step(shortcut.label, async () => {
        const before = await evaluateLlmWikiWebview<{
          text: string;
          head: number;
          focused: boolean;
        }>(docNeedle, `
          win.postMessage({ type: 'setText', text: 'alpha beta' }, '*');
          win.postMessage({ type: 'setVimMode', enabled: true }, '*');
          await new Promise(resolve => setTimeout(resolve, 100));
          const currentView = win.__cmView;
          currentView.dispatch({ selection: { anchor: currentView.state.doc.line(1).from + 'alpha '.length } });
          currentView.focus();
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const editor = doc.querySelector('.cm-editor');
          return {
            text: currentView.state.doc.toString(),
            head: currentView.state.selection.main.head,
            focused: editor?.classList.contains('cm-focused') ?? false,
          };
        `);
        docNeedle = 'alpha beta';

        await page.locator('iframe.webview:visible').first().click({ position: { x: 300, y: 300 } });
        await page.waitForTimeout(200);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);

        const normalModeState = await evaluateLlmWikiWebview<typeof before>('alpha beta', `
          const editor = doc.querySelector('.cm-editor');
          return {
            text: view.state.doc.toString(),
            head: view.state.selection.main.head,
            focused: editor?.classList.contains('cm-focused') ?? false,
          };
        `);

        await page.keyboard.press(shortcut.key);
        await page.waitForTimeout(200);

        const after = await evaluateLlmWikiWebview<typeof before>('alpha beta', `
          const editor = doc.querySelector('.cm-editor');
          return {
            text: view.state.doc.toString(),
            head: view.state.selection.main.head,
            focused: editor?.classList.contains('cm-focused') ?? false,
          };
        `);

        expect(normalModeState.text).toBe(before.text);
        expect(normalModeState.focused).toBe(true);
        expect(after.text).toBe(normalModeState.text);
        expect(after.head).toBe(normalModeState.head);
        expect(after.focused).toBe(true);
      });
    }
  });

  test('Vim Cmd/Ctrl+O keypress keeps the next edit on the current rendered line', async ({ vsCodePage: page }) => {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const initialNeedle = await openVimSandbox(page, VIM_SANDBOXES.commandO);
    await ensureHostVimMode(page, initialNeedle, true);

    await page.locator('iframe.webview:visible').first().click({ position: { x: 300, y: 300 } });
    await page.waitForTimeout(200);
    const before = await evaluateLlmWikiWebview<{
      text: string;
      lineNumber: number;
      offset: number;
    }>(initialNeedle, `
      win.postMessage({
        type: 'setText',
        text: ['First line', '## Current Heading', 'Last line'].join('\\n'),
      }, '*');
      win.postMessage({ type: 'setVimMode', enabled: true }, '*');
      await new Promise(resolve => setTimeout(resolve, 100));
      const currentView = win.__cmView;
      const target = currentView.state.doc.line(2).from + '## '.length;
      currentView.dispatch({ selection: { anchor: target }, scrollIntoView: true });
      currentView.focus();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const selectedLine = currentView.state.doc.lineAt(currentView.state.selection.main.head);
      return {
        text: currentView.state.doc.toString(),
        lineNumber: selectedLine.number,
        offset: currentView.state.selection.main.head - selectedLine.from,
      };
    `);
    expect(before).toEqual({
      text: 'First line\n## Current Heading\nLast line',
      lineNumber: 2,
      offset: 3,
    });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await page.keyboard.press(`${modifier}+O`);
    await page.waitForTimeout(300);
    await page.keyboard.press('i');
    await page.keyboard.type('Z');
    await page.waitForTimeout(200);

    const after = await evaluateLlmWikiWebview<{
      text: string;
      lineNumber: number;
      offset: number;
    }>('ZCurrent Heading', `
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        text: view.state.doc.toString(),
        lineNumber: selectedLine.number,
        offset: view.state.selection.main.head - selectedLine.from,
      };
    `);

    expect(after).toEqual({
      text: 'First line\n## ZCurrent Heading\nLast line',
      lineNumber: 2,
      offset: 4,
    });
  });

  test('Vim normal-mode o keeps the inserted line until VS Code saves the document', async ({ vsCodePage: page }) => {
    const fixture = VIM_SANDBOXES.openLinePersistence;
    const initialNeedle = await openVimSandbox(page, fixture);
    await ensureHostVimMode(page, initialNeedle, true);
    const fixturePath = path.resolve(__dirname, 'fixtures', 'test-vault', fixture.relativePath);
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
    expect(editorText).toBe('First line\nSecond line\n\nThird line');
    expect(fs.readFileSync(fixturePath, 'utf8')).toBe(diskTextBefore);
  });

  test('Vim host shortcut keeps the next edit anchored after delayed focus retries', async ({ vsCodePage: page }) => {
    const initialNeedle = await openVimSandbox(page, VIM_SANDBOXES.delayedFocus);
    await ensureHostVimMode(page, initialNeedle, true);

    await page.locator('iframe.webview:visible').first().click({ position: { x: 300, y: 300 } });
    await page.waitForTimeout(200);
    const before = await evaluateLlmWikiWebview<{
      text: string;
      head: number;
      lineNumber: number;
      offset: number;
    }>(initialNeedle, `
      win.postMessage({
        type: 'setText',
        text: ['Intro line', '# Rendered Heading', 'Tail line'].join('\\n'),
      }, '*');
      win.postMessage({ type: 'setVimMode', enabled: true }, '*');
      await new Promise(resolve => setTimeout(resolve, 100));
      const currentView = win.__cmView;
      const target = currentView.state.doc.line(2).from + '# '.length;
      currentView.dispatch({ selection: { anchor: target }, scrollIntoView: true });
      currentView.focus();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const selectedLine = currentView.state.doc.lineAt(currentView.state.selection.main.head);
      return {
        text: currentView.state.doc.toString(),
        head: currentView.state.selection.main.head,
        lineNumber: selectedLine.number,
        offset: currentView.state.selection.main.head - selectedLine.from,
      };
    `);
    expect(before).toEqual({
      text: 'Intro line\n# Rendered Heading\nTail line',
      head: 'Intro line\n# '.length,
      lineNumber: 2,
      offset: 2,
    });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await runCommandFromPalette(page, 'LLM Wiki: Consume Vim Host Shortcut', 900);
    await page.keyboard.press('i');
    await page.keyboard.type('X');
    await page.waitForTimeout(200);

    const after = await evaluateLlmWikiWebview<{
      text: string;
      lineNumber: number;
      offset: number;
    }>('XRendered Heading', `
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        text: view.state.doc.toString(),
        lineNumber: selectedLine.number,
        offset: view.state.selection.main.head - selectedLine.from,
      };
    `);

    expect(after).toEqual({
      text: 'Intro line\n# XRendered Heading\nTail line',
      lineNumber: 2,
      offset: 3,
    });
  });

  test('Vim dd keeps the next edit anchored on rendered markdown lines', async ({ vsCodePage: page }) => {
    const initialNeedle = await openVimSandbox(page, VIM_SANDBOXES.deleteLine);
    await ensureHostVimMode(page, initialNeedle, true);

    await page.locator('iframe.webview:visible').first().click({ position: { x: 300, y: 300 } });
    await page.waitForTimeout(200);
    await evaluateLlmWikiWebview(initialNeedle, `
      win.postMessage({
        type: 'setText',
        text: ['Intro line', '# Delete Me', 'Tail line', 'Final line'].join('\\n'),
      }, '*');
      win.postMessage({ type: 'setVimMode', enabled: true }, '*');
      await new Promise(resolve => setTimeout(resolve, 100));
      const currentView = win.__cmView;
      currentView.dispatch({
        selection: { anchor: currentView.state.doc.line(2).from + '# '.length },
        scrollIntoView: true,
      });
      currentView.focus();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return true;
    `);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await page.keyboard.press('d');
    await page.keyboard.press('d');
    await page.keyboard.press('i');
    await page.keyboard.type('X');
    await page.waitForTimeout(200);

    const after = await evaluateLlmWikiWebview<{
      text: string;
      lineNumber: number;
      offset: number;
    }>('XTail line', `
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        text: view.state.doc.toString(),
        lineNumber: selectedLine.number,
        offset: view.state.selection.main.head - selectedLine.from,
      };
    `);

    expect(after).toEqual({
      text: 'Intro line\nXTail line\nFinal line',
      lineNumber: 2,
      offset: 1,
    });
  });

  test('Vim dd keypress keeps the next edit off the first line after rendered markdown', async ({ vsCodePage: page }) => {
    const initialNeedle = await openVimSandbox(page, VIM_SANDBOXES.deleteHeading);
    await ensureHostVimMode(page, initialNeedle, true);

    await page.locator('iframe.webview:visible').first().click({ position: { x: 300, y: 300 } });
    await page.waitForTimeout(200);
    await evaluateLlmWikiWebview(initialNeedle, `
      win.postMessage({
        type: 'setText',
        text: [
          'Top line',
          '## Rendered Heading',
          'Paragraph before delete',
          '### Delete This Heading',
          'Tail stays here',
          'Last line',
        ].join('\\n'),
      }, '*');
      win.postMessage({ type: 'setVimMode', enabled: true }, '*');
      await new Promise(resolve => setTimeout(resolve, 100));
      const currentView = win.__cmView;
      currentView.dispatch({
        selection: { anchor: currentView.state.doc.line(4).from + '### '.length },
        scrollIntoView: true,
      });
      currentView.focus();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return true;
    `);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await page.keyboard.press('d');
    await page.keyboard.press('d');
    await page.keyboard.press('i');
    await page.keyboard.type('Z');
    await page.waitForTimeout(200);

    const after = await evaluateLlmWikiWebview<{
      text: string;
      lineNumber: number;
      offset: number;
    }>('ZTail stays here', `
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        text: view.state.doc.toString(),
        lineNumber: selectedLine.number,
        offset: view.state.selection.main.head - selectedLine.from,
      };
    `);

    expect(after).toEqual({
      text: [
        'Top line',
        '## Rendered Heading',
        'Paragraph before delete',
        'ZTail stays here',
        'Last line',
      ].join('\n'),
      lineNumber: 4,
      offset: 1,
    });
  });

  test('Vim insert and open-line commands stay anchored on scaled headings in the VS Code-hosted markdown webview', async ({ vsCodePage: page }) => {
    const initialNeedle = await openVimSandbox(page, VIM_SANDBOXES.headingCommands);

    const cases = [
      {
        label: 'insert',
        command: 'i',
        typed: 'X',
        expectedText: [
          'Intro',
          'X# Rendered Heading',
          'Tail',
          initialNeedle,
        ].join('\n'),
        expectedLine: 2,
        expectedOffset: 1,
      },
      {
        label: 'open line',
        command: 'o',
        typed: 'Inserted',
        expectedText: [
          'Intro',
          '# Rendered Heading',
          'Inserted',
          'Tail',
          initialNeedle,
        ].join('\n'),
        expectedLine: 3,
        expectedOffset: 'Inserted'.length,
      },
    ];
    const docNeedle = initialNeedle;

    for (const testCase of cases) {
      await test.step(testCase.label, async () => {
        await page.locator('iframe.webview:visible').first().click({ position: { x: 300, y: 300 } });
        await page.waitForTimeout(200);
        await evaluateLlmWikiWebview(docNeedle, `
          win.postMessage({
            type: 'setText',
            text: ['Intro', '# Rendered Heading', 'Tail', ${JSON.stringify(initialNeedle)}].join('\\n'),
          }, '*');
          win.postMessage({ type: 'setVimMode', enabled: true }, '*');
          await new Promise(resolve => setTimeout(resolve, 100));
          const currentView = win.__cmView;
          currentView.dispatch({ selection: { anchor: currentView.state.doc.line(1).from } });
          currentView.focus();
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return true;
        `);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
        await page.keyboard.press('j');
        await page.waitForTimeout(100);

        const beforeCommand = await evaluateLlmWikiWebview<{
          lineNumber: number;
          offset: number;
          text: string;
        }>(docNeedle, `
          const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
          return {
            lineNumber: selectedLine.number,
            offset: view.state.selection.main.head - selectedLine.from,
            text: selectedLine.text,
          };
        `);
        expect(beforeCommand).toEqual({
          lineNumber: 2,
          offset: 0,
          text: '# Rendered Heading',
        });

        await page.keyboard.press(testCase.command);
        await page.keyboard.type(testCase.typed);
        await page.waitForTimeout(200);

        const after = await evaluateLlmWikiWebview<{
          text: string;
          lineNumber: number;
          offset: number;
        }>(docNeedle, `
          const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
          return {
            text: view.state.doc.toString(),
            lineNumber: selectedLine.number,
            offset: view.state.selection.main.head - selectedLine.from,
          };
        `);

        expect(after).toEqual({
          text: testCase.expectedText,
          lineNumber: testCase.expectedLine,
          offset: testCase.expectedOffset,
        });
      });
    }
  });

  test('Vim normal mode inserts on the current VS Code webview line after pressing i', async ({ vsCodePage: page }) => {
    await openQuickFile(page, 'notes/Concepts/Math and Code.md', 4000);

    const editorArea = page.locator('iframe.webview:visible').first();
    await editorArea.click();
    await page.waitForTimeout(500);

    await evaluateLlmWikiWebview('Math and Code Rendering Test', `
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

    const state = await evaluateLlmWikiWebview<{
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

    await evaluateLlmWikiWebview('Math and Code Rendering Test', `
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

    const ctrlOState = await evaluateLlmWikiWebview<{
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

    const tableClickState = await evaluateLlmWikiWebview<{
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
