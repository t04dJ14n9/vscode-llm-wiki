import { expect, test, type Page } from '@playwright/test';

const viewerOrigin = 'http://localhost:8979';
const outOfOrderUrl = `${viewerOrigin}/pdf-viewer.html?fixture=out-of-order-text`;
const mixedStyleUrl = `${viewerOrigin}/pdf-viewer.html?fixture=mixed-style-selection`;
const twoPageUrl = `${viewerOrigin}/pdf-viewer.html?fixture=two-page`;
const fourPageUrl = `${viewerOrigin}/pdf-viewer.html?fixture=four-page`;

const orderedLines = [
  'First line starts the paragraph.',
  'Second line continues in visual order.',
  'Third line remains part of selection.',
  'Fourth line should not jump ahead.',
  'Fifth line ends the paragraph.',
];

type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };

test.describe('Preview-compatible PDF text selection', () => {
  test('mixed normal and bold text produces one non-overlapping selection band per visual line', async ({ page }) => {
    await openMixedStyleFixture(page);
    await selectMixedStyleLines(page);

    await expectSelectionSnippet(
      page,
      'Normal text before bold words and after. Tightly spaced normal second line.',
    );
    const bands = await normalizedSelectionBands(page);
    expect(bands).toHaveLength(2);
    expect(bands[0].y + bands[0].height).toBeLessThanOrEqual(bands[1].y + 0.5);
    expect(Math.abs(bands[0].height - bands[1].height)).toBeLessThanOrEqual(1);

    const firstLineParts = await Promise.all([
      textItemBox(page, 'Normal text before'),
      textItemBox(page, 'bold words'),
      textItemBox(page, 'and after.'),
    ]);
    for (const part of firstLineParts) {
      expect(bands[0].x).toBeLessThanOrEqual(part.x + 1);
      expect(bands[0].x + bands[0].width).toBeGreaterThanOrEqual(part.x + part.width - 1);
    }
  });

  test('mixed-style selection retains two normalized bands and the committed zoom level', async ({ page }) => {
    await openMixedStyleFixture(page);
    await selectMixedStyleLines(page);
    const before = await normalizedSelectionBands(page);

    const zoom = page.getByRole('spinbutton', { name: 'Zoom' });
    const initialZoom = Number(await zoom.inputValue());
    await zoom.fill('175');
    await zoom.press('Enter');

    await expect(zoom).toHaveValue('175');
    await expect(page.locator('#page-1 .pdf-selection-rect')).toHaveCount(2);
    const after = await normalizedSelectionBands(page);
    expect(after[0].y + after[0].height).toBeLessThanOrEqual(after[1].y + 0.5);
    expect(Math.abs(after[0].height - after[1].height)).toBeLessThanOrEqual(1);
    expect(after[0].height / before[0].height).toBeCloseTo(175 / initialZoom, 1);
    await expectSelectionSnippet(
      page,
      'Normal text before bold words and after. Tightly spaced normal second line.',
    );
  });

  test('double-click selects the complete word under the pointer', async ({ page }) => {
    await openOutOfOrderFixture(page);
    const word = await pointInsideText(page, 0, 'paragraph');

    await resetMessages(page);
    await page.mouse.dblclick(word.x, word.y);

    await expectSelectionSnippet(page, 'paragraph');
    await expect(page.locator('#selection-toolbar')).toBeVisible();
  });

  test('double-click drag preserves whole-word boundaries in the forward direction', async ({ page }) => {
    await openOutOfOrderFixture(page);
    const start = await pointInsideText(page, 0, 'First');
    const end = await pointInsideText(page, 2, 'part');

    await resetMessages(page);
    await dragSelection(page, start, end, 2);

    await expectSelectionSnippet(page, [
      orderedLines[0],
      orderedLines[1],
      'Third line remains part',
    ].join(' '));
  });

  test('double-click drag preserves whole-word boundaries in the backward direction', async ({ page }) => {
    await openOutOfOrderFixture(page);
    const start = await pointInsideText(page, 3, 'ahead');
    const end = await pointInsideText(page, 1, 'continues');

    await resetMessages(page);
    await dragSelection(page, start, end, 2);

    await expectSelectionSnippet(page, [
      'continues in visual order.',
      orderedLines[2],
      'Fourth line should not jump ahead',
    ].join(' '));
  });

  test('triple-click expands beyond double-click to the complete visual line', async ({ page }) => {
    await openOutOfOrderFixture(page);
    const word = await pointInsideText(page, 0, 'paragraph');

    await resetMessages(page);
    await page.mouse.click(word.x, word.y, { clickCount: 3 });

    await expectSelectionSnippet(page, orderedLines[0]);
  });

  test('selection toolbar dismisses or remains attached to the selection while the viewer scrolls', async ({ page }) => {
    await openOutOfOrderFixture(page);
    const firstText = page.locator('#page-1 .text-layer span[data-item-index="0"]');
    await commitZoomAndWaitForTextLayer(page, 250, firstText);
    const first = await requiredBox(firstText);
    await dragSelection(
      page,
      { x: first.x + 1, y: first.y + first.height / 2 },
      { x: first.x + first.width - 1, y: first.y + first.height / 2 },
    );
    await expect(page.locator('#selection-toolbar')).toBeVisible();
    await expect(page.locator('#page-1 .pdf-selection-rect')).not.toHaveCount(0);

    const before = await toolbarOffsetFromSelection(page);
    const viewer = page.locator('#viewer-container');
    const initialScrollTop = await viewer.evaluate(element => element.scrollTop);
    await viewer.evaluate(element => element.scrollBy({ top: 96 }));
    await expect.poll(() => viewer.evaluate(element => element.scrollTop), { timeout: 2_000 })
      .toBeGreaterThan(initialScrollTop);

    await expect.poll(async () => {
      if (!await page.locator('#selection-toolbar').count()) return true;
      const current = await toolbarOffsetFromSelection(page);
      return Math.abs(current - before) <= 3;
    }, { timeout: 2_000 }).toBe(true);
  });

  test('the real platform copy shortcut writes the canonical PDF selection text', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: viewerOrigin });
    await openOutOfOrderFixture(page);
    const first = await lineBox(page, 0);
    const fourth = await lineBox(page, 3);
    const expected = orderedLines.slice(0, 4).join(' ');

    await resetMessages(page);
    await dragSelection(
      page,
      { x: first.x + 1, y: first.y + first.height / 2 },
      { x: fourth.x + fourth.width - 1, y: fourth.y + fourth.height / 2 },
    );
    await expectSelectionSnippet(page, expected);
    await expect.poll(() => page.evaluate(() => (
      window.getSelection()?.toString().replace(/\s+/gu, ' ').trim()
    )), { timeout: 2_000 }).toBe(expected);

    await page.evaluate(() => navigator.clipboard.writeText('__preview_copy_sentinel__'));
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');

    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 2_000 })
      .toBe(expected);
  });

  test('continuous mode permits one drag selection to cross a page boundary', async ({ page }) => {
    await page.setViewportSize({ width: 1_000, height: 1_200 });
    await page.goto(twoPageUrl);
    await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });
    const first = page.locator('#page-1 .text-layer span[data-item-index]').filter({ hasText: 'Page One' });
    const second = page.locator('#page-2 .text-layer span[data-item-index]').filter({ hasText: 'Page Two' });
    await expect(first).toHaveCount(1);
    await expect(second).toHaveCount(1);
    const firstBox = await requiredBox(first);
    const secondBox = await requiredBox(second);

    await resetMessages(page);
    await dragSelection(
      page,
      { x: firstBox.x + 1, y: firstBox.y + firstBox.height / 2 },
      { x: secondBox.x + secondBox.width - 1, y: secondBox.y + secondBox.height / 2 },
    );

    await expectSelectionSnippet(page, 'Page One Page Two');
    await expect(page.locator('#page-1 .pdf-selection-rect')).not.toHaveCount(0);
    await expect(page.locator('#page-2 .pdf-selection-rect')).not.toHaveCount(0);
  });

  test('selection autoscroll continues while the pointer is held at the viewer edge', async ({ page }) => {
    await page.goto(fourPageUrl);
    await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 4/, { timeout: 10_000 });
    const firstText = page
      .locator('#page-1 .text-layer span[data-item-index]')
      .filter({ hasText: 'Page One' });
    await commitZoomAndWaitForTextLayer(page, 200, firstText);
    const first = await requiredBox(firstText);
    const viewer = await requiredBox(page.locator('#viewer-container'));
    await page.mouse.move(first.x + 1, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(viewer.x + viewer.width / 2, viewer.y + viewer.height - 3, { steps: 8 });
    const afterInitialMove = await page.locator('#viewer-container').evaluate(element => element.scrollTop);
    await page.waitForTimeout(400);
    const afterHold = await page.locator('#viewer-container').evaluate(element => element.scrollTop);
    await page.mouse.up();

    expect(afterHold).toBeGreaterThan(afterInitialMove + 4);
  });
});

async function openOutOfOrderFixture(page: Page): Promise<void> {
  await page.goto(outOfOrderUrl);
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('#page-1 .text-layer span[data-item-index]')).toHaveCount(5);
}

async function openMixedStyleFixture(page: Page): Promise<void> {
  await page.goto(mixedStyleUrl);
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('#page-1 .text-layer span[data-item-index]')).toHaveCount(4);
}

async function selectMixedStyleLines(page: Page): Promise<void> {
  const first = await textItemBox(page, 'Normal text before');
  const second = await textItemBox(page, 'Tightly spaced normal second line.');
  await resetMessages(page);
  await dragSelection(
    page,
    { x: first.x + 1, y: first.y + first.height / 2 },
    { x: second.x + second.width - 1, y: second.y + second.height / 2 },
  );
  await expect(page.locator('#page-1 .pdf-selection-rect')).toHaveCount(2);
}

async function textItemBox(page: Page, text: string): Promise<Box> {
  const item = page.locator('#page-1 .text-layer span[data-item-index]').filter({ hasText: text });
  await expect(item).toHaveCount(1);
  return requiredBox(item);
}

async function normalizedSelectionBands(page: Page): Promise<Box[]> {
  return page.locator('#page-1 .pdf-selection-rect').evaluateAll(elements => elements
    .map(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })
    .sort((left, right) => left.y - right.y || left.x - right.x));
}

async function pointInsideText(
  page: Page,
  itemIndex: number,
  needle: string,
): Promise<Point> {
  const span = page.locator(`#page-1 .text-layer span[data-item-index="${itemIndex}"] .pdf-text-glyphs`);
  await expect(span).toHaveCount(1);
  return span.evaluate((element, selectedText) => {
    const node = element.firstChild;
    const content = node?.textContent ?? '';
    const start = content.indexOf(selectedText);
    if (!node || node.nodeType !== Node.TEXT_NODE || start < 0) {
      throw new Error(`Could not find "${selectedText}" in "${content}"`);
    }
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + selectedText.length);
    const rect = range.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }, needle);
}

async function lineBox(page: Page, itemIndex: number): Promise<Box> {
  return requiredBox(page.locator(`#page-1 .text-layer span[data-item-index="${itemIndex}"]`));
}

async function commitZoomAndWaitForTextLayer(
  page: Page,
  percentage: number,
  witness: ReturnType<Page['locator']>,
): Promise<void> {
  await expect(witness).toBeVisible();
  await witness.evaluate(element => {
    element.dataset.preZoomTextLayer = 'true';
  });

  const zoom = page.getByRole('spinbutton', { name: 'Zoom' });
  await zoom.fill(String(percentage));
  await zoom.press('Enter');
  await expect(zoom).toHaveValue(String(percentage));

  // Progressive zoom deliberately retains the old raster and text until the
  // sharper render is ready. Wait for the reconstructed interactive layer,
  // not merely for a visible node from the retiring generation.
  await expect(witness).not.toHaveAttribute('data-pre-zoom-text-layer', 'true');
  await expect(witness).toBeVisible();
}

async function requiredBox(locator: ReturnType<Page['locator']>): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Expected ${locator} to have a bounding box`);
  return box;
}

async function dragSelection(
  page: Page,
  start: Point,
  end: Point,
  clickCount = 1,
): Promise<void> {
  await page.mouse.move(start.x, start.y);
  if (clickCount > 1) {
    // A real word-drag starts on the second press of a double-click gesture.
    await page.mouse.click(start.x, start.y);
  }
  await page.mouse.down({ clickCount });
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up({ clickCount });
}

async function resetMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__mockMessages = [];
  });
}

async function latestSelectionSnippet(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window as any).__mockMessages
    ?.filter((message: any) => message.type === 'selectionChanged' && message.anchor)
    .at(-1)?.anchor?.snippet);
}

async function expectSelectionSnippet(page: Page, expected: string): Promise<void> {
  await expect.poll(() => latestSelectionSnippet(page), { timeout: 2_000 }).toBe(expected);
}

async function toolbarOffsetFromSelection(page: Page): Promise<number> {
  const toolbar = await page.locator('#selection-toolbar').boundingBox();
  const selection = await page.locator('#page-1 .pdf-selection-rect').first().boundingBox();
  if (!toolbar || !selection) throw new Error('Expected toolbar and selection geometry');
  return toolbar.y - selection.y;
}
