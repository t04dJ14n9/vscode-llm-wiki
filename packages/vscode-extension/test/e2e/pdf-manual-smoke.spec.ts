import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const smokePdfPath = process.env.LLM_WIKI_PDF_SMOKE_PATH;

test.skip(!smokePdfPath, 'Set LLM_WIKI_PDF_SMOKE_PATH to run the real-PDF selection smoke test');

test('real PDF page 18 selects only the opening rendering paragraph and preserves zoom', async ({ page }) => {
  test.setTimeout(180_000);
  if (!smokePdfPath) throw new Error('LLM_WIKI_PDF_SMOKE_PATH is required');
  expect(existsSync(smokePdfPath), `PDF does not exist: ${smokePdfPath}`).toBe(true);
  const browserErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      browserErrors.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', error => browserErrors.push(`pageerror: ${error.message}`));

  // The source textbook is large enough to make the fixture's base64 bridge
  // exhaust Chromium's renderer. Keep pages 18 and 19 byte-faithful, prepend
  // lightweight blank pages, and retain their original page numbers.
  const pdf = preparePageEighteenSmokePdf(smokePdfPath);
  await page.route('**/fixtures/manual-smoke.pdf', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: pdf,
    });
  });

  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=manual-smoke');
  try {
    await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ \d+/, { timeout: 30_000 });
  } catch (error) {
    const hostErrors = await page.evaluate(() => window.__mockMessages
      ?.filter(message => message.type === 'error')
      .map(message => String(message.message)) ?? []);
    throw new Error([
      error instanceof Error ? error.message : String(error),
      ...browserErrors,
      ...hostErrors.map(message => `host: ${message}`),
    ].join('\n'));
  }
  await setContinuousScroll(page, false);

  const pageInput = page.getByRole('spinbutton', { name: 'Page' });
  await pageInput.fill('18');
  await pageInput.press('Enter');
  await expect(page.locator('#page-info')).toHaveText(/Page 18 \/ \d+/, { timeout: 60_000 });
  await expect.poll(() => page.locator('#page-18 .text-layer span[data-item-index]').count(), {
    timeout: 60_000,
  }).toBeGreaterThan(8);

  const drag = await paragraphDragCoordinates(page);
  await page.evaluate(() => {
    window.__mockMessages = [];
  });
  await page.mouse.move(drag.start.x, drag.start.y);
  await page.mouse.down();
  await page.mouse.move(drag.end.x, drag.end.y, { steps: 36 });
  await page.mouse.up();

  await expect.poll(() => latestSelectionSnippet(page), { timeout: 10_000 })
    .toContain('When most people think about computer games');
  const snippet = await latestSelectionSnippet(page);
  console.log(`LLM_WIKI_PDF_SMOKE_SNIPPET=${JSON.stringify(snippet)}`);

  expect(snippet).toMatch(/^When most people think about computer games\b/);
  expect(snippet).toMatch(/ways in which stylized effects can be achieved\.$/);
  expect(snippet).not.toMatch(/^(?:11\s*)?Rendering\b/);
  expect(snippet).not.toMatch(/(?:^|\s)11(?:\s|$)/);
  expect(snippet).not.toContain('The topic of 3D computer graphics');

  const zoomInput = page.getByRole('spinbutton', { name: 'Zoom' });
  await zoomInput.fill('175');
  await zoomInput.press('Enter');
  await expect(zoomInput).toHaveValue('175');
  await focusViewer(page);
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(() => visiblePageIds(page), { timeout: 20_000 }).toEqual(['page-19']);
  await expect.poll(() => page.locator('#page-19 canvas.pdf-canvas').evaluate(
    (canvas: HTMLCanvasElement) => canvas.width,
  ), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(zoomInput).toHaveValue('175');
});

test('real PDF page 56 keeps a margin caption out of the body selection', async ({ page }) => {
  test.setTimeout(180_000);
  if (!smokePdfPath) throw new Error('LLM_WIKI_PDF_SMOKE_PATH is required');
  const pdf = prepareSinglePageSmokePdf(smokePdfPath, 56);
  await page.route('**/fixtures/manual-smoke.pdf', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: pdf,
    });
  });

  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=manual-smoke');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 30_000 });
  await expect.poll(() => page.locator('#page-1 .text-layer span[data-item-index]').count(), {
    timeout: 60_000,
  }).toBeGreaterThan(40);

  const drag = await page.locator('#page-1 .text-layer').evaluate((layer: HTMLElement) => {
    const spans = Array.from(layer.querySelectorAll<HTMLElement>('span[data-item-index]'));
    const texts = spans.map(span => (span.textContent ?? '').replace(/\s+/gu, ' ').trim());
    const locate = (needle: string): number => {
      for (let index = 0; index < texts.length; index++) {
        const joined = texts.slice(index, index + 4).join(' ');
        if (joined.includes(needle)) return index;
      }
      return -1;
    };
    const directStartIndex = texts.findIndex(text => text.includes('A mesh of triangles serves'));
    const startIndex = directStartIndex >= 0
      ? directStartIndex
      : locate('A mesh of triangles serves as a piecewise linear');
    const endStart = locate('triangles is known as tessellation');
    if (startIndex < 0 || endStart < startIndex) {
      throw new Error(`Could not locate page 56 body paragraph: ${JSON.stringify(texts)}`);
    }
    let endIndex = endStart;
    while (
      endIndex + 1 < texts.length
      && !texts.slice(endStart, endIndex + 1).join(' ').includes('triangles is known as tessellation')
    ) {
      endIndex++;
    }
    const startRect = spans[startIndex]!.getBoundingClientRect();
    const endRect = spans[endIndex]!.getBoundingClientRect();
    return {
      start: { x: startRect.left + 0.5, y: startRect.top + startRect.height / 2 },
      end: { x: endRect.right + Math.max(4, endRect.height), y: endRect.top + endRect.height / 2 },
    };
  });

  await page.evaluate(() => {
    window.__mockMessages = [];
  });
  await page.mouse.move(drag.start.x, drag.start.y);
  await page.mouse.down();
  await page.mouse.move(drag.end.x, drag.end.y, { steps: 40 });
  await page.mouse.up();

  await expect.poll(() => latestSelectionSnippet(page), { timeout: 10_000 }).toMatch(
    /^A mesh of triangles serves as a piecewise linear approximation\b/,
  );
  const selected = await latestSelectionSnippet(page);
  expect(selected).toMatch(/triangles is known as tessellation\.$/);
  expect(selected).not.toContain('Figure 11.19. A mesh of triangles is a linear');
  expect(selected).not.toMatch(/\bapproximation to a sur face\b/);
  expect(selected).not.toMatch(/\bconnected line seg line segments\b/);
});

test('real PDF page 190 keeps the Figure 12.12 caption out of the spot-light paragraph selection', async ({ page }) => {
  test.setTimeout(180_000);
  if (!smokePdfPath) throw new Error('LLM_WIKI_PDF_SMOKE_PATH is required');
  const pdf = prepareSinglePageSmokePdf(smokePdfPath, 190);
  await page.route('**/fixtures/manual-smoke.pdf', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: pdf,
    });
  });

  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=manual-smoke');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 30_000 });
  await expect.poll(() => page.locator('#page-1 .text-layer span[data-item-index]').count(), {
    timeout: 60_000,
  }).toBeGreaterThan(40);

  const drag = await page.locator('#page-1 .text-layer').evaluate((layer: HTMLElement) => {
    const spans = Array.from(layer.querySelectorAll<HTMLElement>('span[data-item-index]'));
    const texts = spans.map(span => (span.textContent ?? '').replace(/\s+/gu, ' ').trim());
    const locate = (needle: string): number => {
      for (let index = 0; index < texts.length; index++) {
        if (texts.slice(index, index + 6).join(' ').startsWith(needle)) return index;
      }
      return -1;
    };
    const startIndex = locate('A spot light acts like a point light');
    const endStart = locate('Figure 12.13 illustrates a spot light source');
    if (startIndex < 0 || endStart < startIndex) {
      throw new Error(`Could not locate page 190 spot-light paragraph: ${JSON.stringify(texts)}`);
    }
    let endIndex = endStart;
    while (
      endIndex + 1 < texts.length
      && !texts.slice(endStart, endIndex + 1).join(' ').includes('Figure 12.13 illustrates a spot light source')
    ) {
      endIndex++;
    }
    const startRect = spans[startIndex]!.getBoundingClientRect();
    const endRect = spans[endIndex]!.getBoundingClientRect();
    return {
      start: { x: startRect.left + 0.5, y: startRect.top + startRect.height / 2 },
      end: { x: endRect.right + Math.max(4, endRect.height), y: endRect.top + endRect.height / 2 },
    };
  });

  await page.evaluate(() => {
    window.__mockMessages = [];
  });
  await page.mouse.move(drag.start.x, drag.start.y);
  await page.mouse.down();
  await page.mouse.move(drag.end.x, drag.end.y, { steps: 40 });
  await page.mouse.up();

  await expect.poll(() => latestSelectionSnippet(page), { timeout: 10_000 }).toMatch(
    /^A spot light acts like a point light whose rays are restricted to a cone[‑-]shaped region\b/,
  );
  const selected = await latestSelectionSnippet(page);
  expect(selected).toMatch(/Figure 12\.13 illustrates a spot light source\.$/);
  expect(selected).not.toContain('Figure 12.12. Model of a point light source');
  const nativeText = await page.evaluate(() => window.getSelection()?.toString().replace(/\s+/gu, ' ').trim() ?? '');
  expect(nativeText).toMatch(/^A spot light acts like a point light\b/);
  expect(nativeText).not.toContain('Figure 12.12. Model of a point light source');
});

test('real PDF page 2 restores a stripped join marker for whole-word selection', async ({ page }) => {
  test.setTimeout(180_000);
  if (!smokePdfPath) throw new Error('LLM_WIKI_PDF_SMOKE_PATH is required');
  const pdf = prepareSinglePageSmokePdf(smokePdfPath, 2);
  await page.route('**/fixtures/manual-smoke.pdf', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: pdf,
    });
  });

  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=manual-smoke');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 30_000 });
  const run = page.locator('#page-1 .text-layer span[data-item-index]').filter({ hasText: 'Unchart' }).first();
  await expect(run).toBeVisible({ timeout: 60_000 });
  const point = await run.evaluate((span: HTMLElement) => {
    const glyphs = span.querySelector<HTMLElement>('.pdf-text-glyphs');
    const node = glyphs?.firstChild;
    const text = node?.textContent ?? '';
    const start = text.indexOf('Unchart');
    if (!node || node.nodeType !== Node.TEXT_NODE || start < 0) {
      throw new Error(`Could not locate Unchart run: ${JSON.stringify(text)}`);
    }
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + 'Unchart'.length);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });

  await page.evaluate(() => {
    window.__mockMessages = [];
  });
  await page.mouse.dblclick(point.x, point.y);
  await expect.poll(() => latestSelectionSnippet(page), { timeout: 10_000 }).toBe('Uncharted');
  await expect(page.locator('#page-1 .pdf-selection-rect')).not.toHaveCount(0);
});

test('real DataComp page 2 selects the Figure 1 caption through Introduction in visual order', async ({ page }) => {
  test.setTimeout(180_000);
  if (!smokePdfPath) throw new Error('LLM_WIKI_PDF_SMOKE_PATH is required');
  const pdf = prepareSinglePageSmokePdf(smokePdfPath, 2);
  await page.route('**/fixtures/manual-smoke.pdf', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: pdf,
    });
  });

  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=manual-smoke');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 30_000 });
  await expect.poll(() => page.locator('#page-1 .text-layer span[data-item-index]').count(), {
    timeout: 60_000,
  }).toBeGreaterThan(100);

  const drag = await page.locator('#page-1 .text-layer').evaluate((layer: HTMLElement) => {
    const spans = Array.from(layer.querySelectorAll<HTMLElement>('span[data-item-index]'));
    const start = spans.find(span => (span.textContent ?? '').includes('Figure 1:'));
    const end = spans.find(span => (
      span.textContent ?? ''
    ).includes('training datasets that enable efficient generalization'));
    if (!start || !end) {
      throw new Error(`Could not locate DataComp caption drag: ${JSON.stringify(
        spans.map(span => span.textContent ?? ''),
      )}`);
    }
    const startRect = start.getBoundingClientRect();
    const endRect = end.getBoundingClientRect();
    return {
      start: {
        x: startRect.left + 0.5,
        y: startRect.top + startRect.height / 2,
      },
      end: {
        x: endRect.right + Math.max(4, endRect.height),
        y: endRect.top + endRect.height / 2,
      },
    };
  });

  await page.evaluate(() => {
    window.__mockMessages = [];
  });
  await page.mouse.move(drag.start.x, drag.start.y);
  await page.mouse.down();
  await page.mouse.move(drag.end.x, drag.end.y, { steps: 40 });
  await page.mouse.up();

  await expect.poll(() => latestSelectionSnippet(page), { timeout: 10_000 })
    .toContain('Figure 1:');
  const snippet = compactSelectionText(await latestSelectionSnippet(page));
  const nativeText = compactSelectionText(await page.evaluate(
    () => window.getSelection()?.toString() ?? '',
  ));
  expect(snippet).toMatch(
    /^Figure 1: Improving training sets leads to better models that are cheaper to train\./,
  );
  expect(snippet).toContain('1 Introduction');
  expect(snippet).toContain(
    'Large training datasets are an important driver of progress in the recent language modeling (LM)',
  );
  expect(snippet).toContain(
    'training datasets that enable efficient generalization on a wide range of downstream tasks. Indeed,',
  );
  expect(snippet).not.toContain('Core evals score');
  expect(snippet).not.toContain('DCLM-Baseline');
  expect(snippet).not.toContain('Total training FLOPS');
  expect(nativeText).toBe(snippet);
});

test('real DataComp page 2 graph-label drag selects the nearest label instead of body prose', async ({ page }) => {
  test.setTimeout(180_000);
  if (!smokePdfPath) throw new Error('LLM_WIKI_PDF_SMOKE_PATH is required');
  const pdf = prepareSinglePageSmokePdf(smokePdfPath, 2);
  await page.route('**/fixtures/manual-smoke.pdf', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: pdf,
    });
  });

  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=manual-smoke');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 30_000 });
  const label = page
    .locator('#page-1 .text-layer span[data-item-index]')
    .filter({ hasText: 'Core evals score' })
    .first();
  await expect(label).toBeVisible({ timeout: 60_000 });
  const drag = await label.evaluate((span: HTMLElement) => {
    const rect = span.getBoundingClientRect();
    return {
      start: { x: rect.left + rect.width / 2, y: rect.bottom - 1 },
      end: { x: rect.left + rect.width / 2, y: rect.top + 1 },
    };
  });

  await page.evaluate(() => {
    window.__mockMessages = [];
  });
  await page.mouse.move(drag.start.x, drag.start.y);
  await page.mouse.down();
  await page.mouse.move(drag.end.x, drag.end.y, { steps: 30 });
  await page.mouse.up();

  await expect.poll(async () => compactSelectionText(await latestSelectionSnippet(page)), {
    timeout: 10_000,
  }).toBe('Core evals score');
  const snippet = compactSelectionText(await latestSelectionSnippet(page));
  const nativeText = compactSelectionText(await page.evaluate(
    () => window.getSelection()?.toString() ?? '',
  ));
  expect(snippet).not.toContain('Large training datasets');
  expect(snippet).not.toContain('Figure 1:');
  expect(nativeText).toBe(snippet);
  await expect(page.locator('#page-1 .pdf-selection-rect')).not.toHaveCount(0);
});

async function setContinuousScroll(page: Page, enabled: boolean): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Display options' });
  const menu = page.getByRole('menu', { name: 'Display options' });
  await trigger.click();
  await expect(menu).toBeVisible();
  const target = menu.getByRole('menuitemradio', {
    name: enabled ? 'Single Page Continuous' : 'Single Page',
    exact: true,
  });
  const checked = await target.getAttribute('aria-checked');
  if (checked !== 'true') await target.click();
  else await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
}

async function paragraphDragCoordinates(page: Page): Promise<{
  start: { x: number; y: number };
  end: { x: number; y: number };
}> {
  return page.locator('#page-18 .text-layer').evaluate((layer: HTMLElement) => {
    const spans = Array.from(layer.querySelectorAll<HTMLElement>('span[data-item-index]'));
    const texts = spans.map(span => span.textContent ?? '');
    const compact = (text: string) => text.replace(/\s+/gu, ' ').trim();
    const startNeedle = 'When most people think about computer games';
    const endNeedle = 'ways in which stylized effects can be achieved.';
    const nextParagraphNeedle = 'The topic of 3D computer graphics';

    let startIndex = texts.findIndex(text => compact(text).includes(startNeedle));
    if (startIndex < 0) {
      startIndex = texts.findIndex((text, index) =>
        compact(`${text}${texts[index + 1] ?? ''}`).includes(startNeedle)
      );
    }
    const nextParagraphIndex = texts.findIndex((text, index) =>
      index > startIndex && compact(text).includes(nextParagraphNeedle)
    );
    const paragraphLimit = nextParagraphIndex >= 0 ? nextParagraphIndex : texts.length;
    let endIndex = -1;
    for (let index = startIndex; index < paragraphLimit; index++) {
      if (compact(texts[index] ?? '').includes(endNeedle)) endIndex = index;
    }
    if (endIndex < 0) {
      for (let index = startIndex; index < paragraphLimit; index++) {
        if (compact(`${texts[index] ?? ''}${texts[index + 1] ?? ''}`).includes(endNeedle)) {
          endIndex = Math.min(index + 1, paragraphLimit - 1);
        }
      }
    }
    if (startIndex < 0 || endIndex < startIndex) {
      throw new Error(`Could not locate page 18 paragraph runs: ${JSON.stringify(texts)}`);
    }

    const startRect = spans[startIndex]!.getBoundingClientRect();
    const endRect = spans[endIndex]!.getBoundingClientRect();
    return {
      start: {
        x: startRect.left + Math.min(0.5, startRect.width / 4),
        y: startRect.top + startRect.height / 2,
      },
      end: {
        // Finish in trailing whitespace so the viewer must clamp to the real
        // line end instead of dropping the final punctuation or drifting.
        x: endRect.right + Math.max(4, endRect.height),
        y: endRect.top + endRect.height / 2,
      },
    };
  });
}

async function latestSelectionSnippet(page: Page): Promise<string> {
  return page.evaluate(() => String(
    window.__mockMessages
      ?.filter(message => message.type === 'selectionChanged' && message.anchor)
      .at(-1)?.anchor?.snippet ?? '',
  ));
}

function compactSelectionText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

async function focusViewer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const viewer = document.querySelector<HTMLElement>('#viewer-container')!;
    viewer.tabIndex = -1;
    viewer.focus();
  });
}

async function visiblePageIds(page: Page): Promise<string[]> {
  return page.locator('.page-wrapper').evaluateAll((wrappers: HTMLElement[]) =>
    wrappers
      .filter(wrapper => window.getComputedStyle(wrapper).display !== 'none')
      .map(wrapper => wrapper.id),
  );
}

function preparePageEighteenSmokePdf(sourcePath: string): Buffer {
  const directory = mkdtempSync(join(tmpdir(), 'llm-wiki-pdf-smoke-'));
  try {
    const blankPage = join(directory, 'blank.pdf');
    const sourcePattern = join(directory, 'source-%d.pdf');
    const pageEighteen = join(directory, 'source-18.pdf');
    const pageNineteen = join(directory, 'source-19.pdf');
    const smokePdf = join(directory, 'smoke.pdf');
    writeFileSync(blankPage, blankPdfFixture());
    execFileSync('pdfseparate', [
      '-f', '18',
      '-l', '19',
      sourcePath,
      sourcePattern,
    ]);
    execFileSync('pdfunite', [
      ...Array.from({ length: 17 }, () => blankPage),
      pageEighteen,
      pageNineteen,
      smokePdf,
    ]);
    return readFileSync(smokePdf);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function prepareSinglePageSmokePdf(sourcePath: string, page: number): Buffer {
  const directory = mkdtempSync(join(tmpdir(), 'llm-wiki-pdf-smoke-'));
  try {
    const outputPattern = join(directory, 'source-%d.pdf');
    const output = join(directory, `source-${page}.pdf`);
    execFileSync('pdfseparate', [
      '-f', String(page),
      '-l', String(page),
      sourcePath,
      outputPattern,
    ]);
    return readFileSync(output);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function blankPdfFixture(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, 'ascii'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, 'ascii');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
}
