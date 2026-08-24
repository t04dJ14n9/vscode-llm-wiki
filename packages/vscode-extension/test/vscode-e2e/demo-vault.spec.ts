import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { resolveVsCodeE2eTestDir } from './testDirectory.mjs';

const TEST_DIR = resolveVsCodeE2eTestDir();
const WS_URL_FILE = path.resolve(TEST_DIR, 'ws-url');
const DEBUG_PORT_FILE = path.resolve(TEST_DIR, 'debug-port');
const SCREENSHOT_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'e2e-report',
  'demo-vault',
);

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const test = base.extend<{
  vsCodePage: Page;
  vsCodeContext: BrowserContext;
}>({
  vsCodePage: async ({}, use) => {
    const browser = await chromium.connectOverCDP(
      fs.readFileSync(WS_URL_FILE, 'utf-8').trim(),
    );
    const context = browser.contexts()[0]!;
    const page = context.pages()[0]
      ?? await context.waitForEvent('page', { timeout: 30_000 });
    await page.waitForSelector('.monaco-workbench', { timeout: 30_000 });
    await use(page);
    await browser.close();
  },
  vsCodeContext: async ({}, use) => {
    const browser = await chromium.connectOverCDP(
      fs.readFileSync(WS_URL_FILE, 'utf-8').trim(),
    );
    const context = browser.contexts()[0]!;
    await use(context);
    await browser.close();
  },
});

test.skip(
  !process.env.LLM_WIKI_E2E_VAULT,
  'Set LLM_WIKI_E2E_VAULT to run the repository demo-vault journey.',
);

test('demo vault reading journey is smooth from project indexes to evidence', async ({
  vsCodePage: page,
}) => {
  test.setTimeout(120_000);

  await openQuickFile(page, '_index.md');
  const root = await waitForMarkdown('okf_version: "0.2"');
  expect(root.source).toContain('[projects](projects/)');
  await screenshot(page, '01-root-index');

  await followMarkdownLink('okf_version: "0.2"', 'projects/');
  await waitForMarkdown('repositories.yaml');
  await followMarkdownLink('repositories.yaml', 'nanochat.md');
  const card = await waitForMarkdown(
    'repository_url: "https://github.com/karpathy/nanochat.git"',
  );
  expect(card.source).toContain('code_state: "missing"');
  await screenshot(page, '02-project-card');

  await followMarkdownLink(
    'repository_url: "https://github.com/karpathy/nanochat.git"',
    'nanochat/',
  );
  await waitForMarkdown('Nanochat project-vault agent guidance');
  await followMarkdownLink('Nanochat project-vault agent guidance', 'summaries/');
  await waitForMarkdown('# Summary');
  await followMarkdownLink(
    '# Summary',
    'nanochat-end-to-end-training-pipeline.md',
  );
  await waitForMarkdown('# Nanochat end-to-end training pipeline');
  await screenshot(page, '03-pipeline-summary');

  await followMarkdownLink(
    '# Nanochat end-to-end training pipeline',
    '../../../concepts/byte-pair-encoding.md',
  );
  await waitForMarkdown('# Byte-pair encoding');

  const rawStarted = Date.now();
  await followMarkdownLink(
    '# Byte-pair encoding',
    '../raw/neural-machine-translation-of-rare-words-with-subword-units.md',
  );
  const raw = await waitForMarkdown(
    '## Mechanically extracted full text',
    20_000,
  );
  expect(raw.source.length).toBeGreaterThan(30_000);
  expect(Date.now() - rawStarted).toBeLessThan(20_000);
  await screenshot(page, '04-raw-paper');

  await followMarkdownLink(
    '## Mechanically extracted full text',
    '../assets/neural-machine-translation-of-rare-words-with-subword-units.pdf',
  );
  const pdf = await waitForPdf();
  expect(pdf.pageCount).toBeGreaterThan(0);
  expect(pdf.pageInfo).toMatch(/^Page 1 \//);
  expect(pdf.firstCanvasReady).toBe(true);
  expect(pdf.hasProductionControls).toBe(true);
  await screenshot(page, '05-local-paper-pdf');

  await openQuickFile(page, 'in-place-code-workflow.md');
  await waitForMarkdown('# In-place code study workflow');
  await screenshot(page, '06-workflow-summary');

  await openQuickFile(page, 'nanochat-code-vault.md');
  await waitForMarkdown('## Identity');
  await screenshot(page, '07-vault-entity');

  await openQuickFile(
    page,
    'where-do-the-paper-ideas-appear-in-nanochat.md',
  );
  const query = await waitForMarkdown(
    '# Where do the paper ideas appear in Nanochat?',
  );
  expect(query.source).toContain('| BPE');
  expect(query.source).toContain('| DPO');
  await screenshot(page, '08-durable-query');
});

async function openQuickFile(
  page: Page,
  query: string,
  waitMs = 2_000,
): Promise<void> {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.locator('.monaco-workbench').click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(200);
  await page.keyboard.press(`${modifier}+p`);
  await expect(page.locator('.quick-input-widget').first()).toBeVisible({
    timeout: 5_000,
  });
  await page.keyboard.type(query, { delay: 25 });
  await page.waitForTimeout(750);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(waitMs);
  await expect(page.locator('iframe.webview:visible').first()).toBeVisible({
    timeout: 15_000,
  });
}

async function followMarkdownLink(
  documentNeedle: string,
  destination: string,
): Promise<void> {
  await evaluateMarkdown(documentNeedle, `
    const source = view.state.doc.toString();
    const destination = ${JSON.stringify(destination)};
    if (!source.includes('](' + destination + ')')) {
      throw new Error('Document does not contain link ' + destination);
    }
    view.dom.dispatchEvent(new win.CustomEvent('llm-wiki-open-uri', {
      bubbles: true,
      detail: { uri: destination, relativeToDocument: true },
    }));
    return true;
  `);
}

async function waitForMarkdown(
  documentNeedle: string,
  timeoutMs = 15_000,
): Promise<{ source: string; title: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await evaluateMarkdown<{
        source: string;
        title: string;
      }>(documentNeedle, `
        return {
          source: view.state.doc.toString(),
          title: doc.title,
        };
      `);
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

async function evaluateMarkdown<T>(
  documentNeedle: string,
  body: string,
): Promise<T> {
  return evaluateWebviews<T>(`(async () => {
    const hostFrame = document.getElementById('active-frame');
    const doc = hostFrame?.contentDocument;
    const win = hostFrame?.contentWindow;
    const view = win?.__cmView;
    if (!doc || !win || !view) return { ok: false };
    const source = view.state.doc.toString();
    if (!source.includes(${JSON.stringify(documentNeedle)})) {
      return { ok: false };
    }
    return {
      ok: true,
      value: await (async () => {
        ${body}
      })(),
    };
  })()`);
}

async function waitForPdf(): Promise<{
  pageCount: number;
  pageInfo: string;
  firstCanvasReady: boolean;
  hasProductionControls: boolean;
}> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await evaluateWebviews<{
        pageCount: number;
        pageInfo: string;
        firstCanvasReady: boolean;
        hasProductionControls: boolean;
      }>(`(async () => {
        const hostFrame = document.getElementById('active-frame');
        const doc = hostFrame?.contentDocument;
        if (!doc?.querySelector('#viewer-container')) return { ok: false };
        const firstCanvas = doc.querySelector('#page-1 canvas.pdf-canvas');
        const value = {
          pageCount: doc.querySelectorAll('.page-wrapper').length,
          pageInfo: doc.querySelector('#page-info')?.textContent?.trim() ?? '',
          firstCanvasReady: firstCanvas?.dataset.renderQuality === 'full'
            && firstCanvas.width > 0
            && firstCanvas.height > 0,
          hasProductionControls: [
            '#prev',
            '#next',
            '#zoom-in',
            '#zoom-out',
            '#pdf-search-input',
          ].every(selector => Boolean(doc.querySelector(selector))),
        };
        return value.firstCanvasReady ? { ok: true, value } : { ok: false };
      })()`);
      return result;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

async function evaluateWebviews<T>(expression: string): Promise<T> {
  const debugPort = Number(fs.readFileSync(DEBUG_PORT_FILE, 'utf-8').trim());
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  const targets = await response.json() as Array<{
    type: string;
    url?: string;
    webSocketDebuggerUrl?: string;
  }>;

  for (const target of targets) {
    if (
      target.type !== 'iframe'
      || !target.webSocketDebuggerUrl
      || !target.url?.includes('extensionId=llm-wiki.llm-wiki-vscode')
    ) continue;
    const result = await cdpEvaluate<{
      ok: boolean;
      value?: T;
    }>(target.webSocketDebuggerUrl, expression);
    if (result.ok) return result.value as T;
  }
  throw new Error('Matching LLM Wiki webview was not ready');
}

async function cdpEvaluate<T>(
  wsUrl: string,
  expression: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out evaluating webview'));
    }, 10_000);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
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
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.result?.exceptionDetails) {
        reject(new Error(
          message.result.exceptionDetails.exception?.description
          ?? message.result.exceptionDetails.text,
        ));
        return;
      }
      resolve(message.result.result.value as T);
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('CDP webview socket failed'));
    });
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: path.resolve(SCREENSHOT_DIR, `${name}.png`),
    fullPage: false,
  });
}
