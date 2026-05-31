import { test, expect } from '@playwright/test';

test('pdf viewer renders the demo PDF into a visible canvas', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('http://localhost:8979/pdf-viewer.html');

  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('.page-wrapper')).toHaveCount(1);
  await expect(page.locator('canvas.pdf-canvas')).toBeVisible();

  const pixelStats = await page.locator('canvas.pdf-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d');
    if (!context) return { width: canvas.width, height: canvas.height, nonWhite: 0 };
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonWhite = 0;
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3] ?? 0;
      const red = data[index] ?? 255;
      const green = data[index + 1] ?? 255;
      const blue = data[index + 2] ?? 255;
      if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) nonWhite++;
    }
    return { width: canvas.width, height: canvas.height, nonWhite };
  });

  expect(pixelStats.width).toBeGreaterThan(0);
  expect(pixelStats.height).toBeGreaterThan(0);
  expect(pixelStats.nonWhite, errors.join('\n')).toBeGreaterThan(0);
});

test('pdf viewer renders reference overlays and opens markdown reference popovers', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('.text-layer span[data-item-index="0"]')).toBeVisible();

  const anchor = {
    id: 'anc_pdf_overlay',
    page: 1,
    textItemIndex: 0,
    charOffset: 0,
    endTextItemIndex: 0,
    endCharOffset: 26,
    snippet: 'FlashAttention uses tiling',
  };
  await page.evaluate((anchor) => {
    window.postMessage({
      type: 'setHighlights',
      referenced: [{ anchor }],
      annotated: [],
    }, '*');
  }, anchor);

  const overlay = page.locator('.annotation-highlight.referenced').first();
  await expect(overlay).toBeVisible();

  await page.evaluate(() => {
    window.__mockMessages = [];
  });
  await overlay.click({ force: true });
  await page.waitForFunction(() =>
    window.__mockMessages?.some((message) => message.type === 'requestReferencesForAnchor')
  );

  await page.evaluate((anchor) => {
    window.postMessage({
      type: 'referencesForAnchor',
      anchor,
      items: [{
        source: 'notes/Concepts/FlashAttention.md',
        sourceLine: 12,
        snippet: 'FlashAttention uses tiling',
        contextLine: 'See the FlashAttention tiling discussion.',
      }],
    }, '*');
  }, anchor);

  await expect(page.locator('.ref-popover')).toContainText('1 markdown note references this');
  await expect(page.locator('.ref-popover')).toContainText('See the FlashAttention tiling discussion.');

  await page.locator('.ref-popover .item').click();
  const openMessages = await page.evaluate(() =>
    window.__mockMessages?.filter((message) => message.type === 'openMarkdownAtLocation')
  );
  expect(openMessages).toHaveLength(1);
  expect(openMessages[0].path).toBe('notes/Concepts/FlashAttention.md');
});

test('annotated pdf highlights still respond to clicks and show an empty reference popover', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('.text-layer span[data-item-index="0"]')).toBeVisible();

  const anchor = {
    id: 'anc_pdf_annotated',
    page: 1,
    textItemIndex: 0,
    charOffset: 0,
    endTextItemIndex: 0,
    endCharOffset: 26,
    snippet: 'FlashAttention uses tiling',
  };
  await page.evaluate((anchor) => {
    window.postMessage({
      type: 'setHighlights',
      referenced: [],
      annotated: [{ anchor }],
    }, '*');
    window.__mockMessages = [];
  }, anchor);

  const overlay = page.locator('.annotation-highlight.annotated').first();
  await expect(overlay).toBeVisible();
  await overlay.click({ force: true });
  await page.waitForFunction(() =>
    window.__mockMessages?.some((message) => message.type === 'requestReferencesForAnchor')
  );

  await page.evaluate((anchor) => {
    window.postMessage({
      type: 'referencesForAnchor',
      anchor,
      items: [],
    }, '*');
  }, anchor);

  await expect(page.locator('.ref-popover')).toContainText('No markdown references found.');
});

test('pdf selection toolbar exposes quote and highlight actions', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('.text-layer span[data-item-index="0"]')).toBeVisible();

  await page.evaluate(() => {
    const span = document.querySelector('.text-layer span[data-item-index="0"]');
    const quote = 'FlashAttention uses tiling';
    const offset = span.textContent.indexOf(quote);
    const range = document.createRange();
    range.setStart(span.firstChild, offset);
    range.setEnd(span.firstChild, offset + quote.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    document.querySelector('#page-container').dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  });

  await expect(page.locator('#selection-toolbar')).toBeVisible();
  await page.locator('#selection-toolbar button', { hasText: 'More' }).click();
  await expect(page.locator('#selection-toolbar .menu.open')).toBeVisible();

  await page.evaluate(() => {
    window.__mockMessages = [];
  });
  await page.locator('#selection-toolbar button', { hasText: 'Insert Quote and Link' }).click();

  const messages = await page.evaluate(() =>
    window.__mockMessages?.filter((message) => message.type === 'selectionAction')
  );
  expect(messages).toHaveLength(1);
  expect(messages[0].action).toBe('insertQuoteAndLink');
  expect(messages[0].anchor.snippet).toBe('FlashAttention uses tiling');
});

test('pdf selection toolbar appears after a real mouse drag across PDF text', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  const span = page.locator('.text-layer span[data-item-index="0"]');
  await expect(span).toBeVisible();
  const box = await span.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(box.width - 4, 220), box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator('#selection-toolbar')).toBeVisible();
});

test('pdf viewer keeps the selectable text layer visually hidden', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  const styles = await page.locator('.text-layer span[data-item-index="0"]').evaluate((span: HTMLElement) => {
    const layer = span.closest('.text-layer') as HTMLElement | null;
    const spanStyles = window.getComputedStyle(span);
    const layerStyles = layer ? window.getComputedStyle(layer) : null;
    return {
      spanColor: spanStyles.color,
      spanTextFill: spanStyles.webkitTextFillColor,
      layerOpacity: layerStyles?.opacity ?? null,
    };
  });

  expect(styles.layerOpacity).toBe('1');
  expect(styles.spanColor).toBe('rgba(0, 0, 0, 0)');
  expect(styles.spanTextFill).toBe('rgba(0, 0, 0, 0)');
});
