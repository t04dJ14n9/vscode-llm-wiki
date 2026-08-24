import { expect, test, type Page } from '@playwright/test';

const viewerOrigin = 'http://localhost:8979';
const realPdfUrl = `${viewerOrigin}/pdf-viewer.html`;
const outOfOrderUrl = `${viewerOrigin}/pdf-viewer.html?fixture=out-of-order-text`;
const mixedStyleUrl = `${viewerOrigin}/pdf-viewer.html?fixture=mixed-style-selection`;
const shortRowUrl = `${viewerOrigin}/pdf-viewer.html?fixture=short-row-selection`;
const formulaUrl = `${viewerOrigin}/pdf-viewer.html?fixture=formula-selection`;
const twoColumnRegressionUrl = `${viewerOrigin}/pdf-viewer.html?fixture=two-column-selection-regression`;
const authorGridRegressionUrl = `${viewerOrigin}/pdf-viewer.html?fixture=author-grid-selection-regression`;
const numericTableRegressionUrl = `${viewerOrigin}/pdf-viewer.html?fixture=numeric-table-selection-regression`;
const centeredMastheadRegressionUrl = `${viewerOrigin}/pdf-viewer.html?fixture=centered-masthead-selection-regression`;
const twoPageUrl = `${viewerOrigin}/pdf-viewer.html?fixture=two-page`;
const fourPageUrl = `${viewerOrigin}/pdf-viewer.html?fixture=four-page`;

const realPdfText = [
  'FlashAttention uses tiling to reduce HBM accesses.',
  'By splitting Q, K, V into blocks that fit in on-chip SRAM, the algorithm avoids materializing the full NxN attention matrix.',
  'Online softmax computes normalization incrementally across tiles.',
  'This yields 2-4x speedup over standard attention with exact results.',
].join(' ');

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
  test('real PDF character drags keep exact first and last glyph endpoints across repeated attempts', async ({ page }) => {
    await openRealPdf(page);
    const start = await characterTarget(page, 'FlashAttention', 0, 0);
    const end = await characterTarget(page, 'results.', 0, 'results.'.length - 1);
    const expected = {
      page: 1,
      textItemIndex: start.itemIndex,
      charOffset: start.offset,
      endTextItemIndex: end.itemIndex,
      endCharOffset: end.offset + 1,
      snippet: realPdfText,
    };

    const attempts = [
      { startBias: -0.2, endBias: 0.2 },
      { startBias: 0.2, endBias: -0.2 },
      { startBias: 0, endBias: 0 },
    ];
    const anchors = [];
    for (const attempt of attempts) {
      await resetMessages(page);
      await dragSelection(
        page,
        pointWithinCharacter(start, attempt.startBias),
        pointWithinCharacter(end, attempt.endBias),
      );
      anchors.push(await waitForSelectionAnchor(page));
    }

    for (const anchor of anchors) {
      expect(anchor).toMatchObject(expected);
    }
    expect(await canonicalNativeSelection(page)).toBe(realPdfText);
    const bands = await normalizedSelectionBands(page);
    expect(bands).toHaveLength(5);
    for (let index = 1; index < bands.length; index++) {
      expect(bands[index - 1]!.y + bands[index - 1]!.height)
        .toBeLessThanOrEqual(bands[index]!.y);
    }
  });

  test('real PDF reverse drags preserve wrapped-line endpoints around repeated attention runs', async ({ page }) => {
    await openRealPdf(page);
    const firstAttention = await characterTarget(page, 'attention', 0, 0);
    const secondAttentionEnd = await characterTarget(page, 'attention', 1, 'attention'.length - 1);
    const expectedText = [
      'attention matrix.',
      'Online softmax computes normalization incrementally across tiles.',
      'This yields 2-4x speedup over standard attention',
    ].join(' ');
    const expected = {
      page: 1,
      textItemIndex: firstAttention.itemIndex,
      charOffset: firstAttention.offset,
      endTextItemIndex: secondAttentionEnd.itemIndex,
      endCharOffset: secondAttentionEnd.offset + 1,
      snippet: expectedText,
    };

    const anchors = [];
    for (const jitter of [-0.2, 0, 0.2]) {
      await resetMessages(page);
      await dragSelection(
        page,
        pointWithinCharacter(secondAttentionEnd, jitter),
        pointWithinCharacter(firstAttention, -jitter),
      );
      anchors.push(await waitForSelectionAnchor(page));
    }

    for (const anchor of anchors) {
      expect(anchor).toMatchObject(expected);
    }
    expect(await canonicalNativeSelection(page)).toBe(expectedText);
  });

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

  test('far trailing whitespace keeps the endpoint on the intended short visual row', async ({ page }) => {
    await page.goto(shortRowUrl);
    await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
    const spans = page.locator('#page-1 .text-layer span[data-item-index]');
    await expect(spans).toHaveCount(3);
    const first = await requiredBox(spans.nth(0));
    const short = await requiredBox(spans.nth(1));
    const pageBox = await requiredBox(page.locator('#page-1'));
    const trailingWhitespaceX = pageBox.x + pageBox.width - 16;
    expect(trailingWhitespaceX).toBeGreaterThan(short.x + short.width + 250);

    await resetMessages(page);
    await dragSelection(
      page,
      { x: first.x + 1, y: first.y + first.height / 2 },
      { x: trailingWhitespaceX, y: short.y + short.height / 2 },
    );

    const expected = [
      'The preceding row is intentionally much longer than the row below.',
      'Short.',
    ].join(' ');
    await expectSelectionSnippet(page, expected);
    expect(await canonicalNativeSelection(page)).toBe(expected);
    expect(await waitForSelectionAnchor(page)).toMatchObject({
      page: 1,
      textItemIndex: 0,
      charOffset: 0,
      endTextItemIndex: 1,
      endCharOffset: 'Short.'.length,
      snippet: expected,
    });
    const bands = await normalizedSelectionBands(page);
    expect(bands).toHaveLength(2);
    expect(bands[1]!.x + bands[1]!.width).toBeLessThan(short.x + short.width + 1);
  });

  test('a drag through one prose column excludes the neighboring column', async ({ page }) => {
    await page.goto(twoColumnRegressionUrl);
    await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
    await expect(page.locator('#page-1 .text-layer span[data-item-index]')).toHaveCount(6);
    const start = await textItemBox(page, 'Left line one.');
    const end = await textItemBox(page, 'Left line three.');

    await resetMessages(page);
    await dragSelection(
      page,
      { x: start.x + 1, y: start.y + start.height / 2 },
      { x: end.x + end.width - 1, y: end.y + end.height / 2 },
    );

    const expected = 'Left line one. Left line two. Left line three.';
    await expectSelectionSnippet(page, expected);
    expect(await canonicalNativeSelection(page)).toBe(expected);
    expect(await canonicalNativeSelection(page)).not.toContain('Right line');
  });

  test('a drag from the first author through shared metadata includes the complete author grid', async ({ page }) => {
    await page.goto(authorGridRegressionUrl);
    await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
    await expect(page.locator('#page-1 .text-layer span[data-item-index]')).toHaveCount(7);
    const start = await textItemBox(page, 'Rafael Alpha');
    const end = await textItemBox(page, 'authors@example.test');

    await resetMessages(page);
    await dragSelection(
      page,
      { x: start.x + 1, y: start.y + start.height / 2 },
      { x: end.x + end.width - 1, y: end.y + end.height / 2 },
    );

    const expected = [
      'Rafael Alpha',
      'Archit Beta',
      'Eric Gamma',
      'Stefano Delta',
      'Christopher Epsilon',
      'Chelsea Zeta',
      'authors@example.test',
    ].join(' ');
    await expectSelectionSnippet(page, expected);
    expect(await canonicalNativeSelection(page)).toBe(expected);
  });

  test('a drag through a fragmented numeric table includes every value in visual-row order', async ({ page }) => {
    await page.goto(numericTableRegressionUrl);
    await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
    await expect(page.locator('#page-1 .text-layer span[data-item-index]')).toHaveCount(36);
    const start = await textItemBox(page, 'BERT Base Score');
    const end = await textItemBox(page, '8.41');

    await resetMessages(page);
    await dragSelection(
      page,
      { x: start.x + 1, y: start.y + start.height / 2 },
      { x: end.x + end.width - 1, y: end.y + end.height / 2 },
    );

    const expected = [
      'BERT Base Score 88.19 76.89 88.09',
      'BERT Large Score 90.87 89.65 90.94',
      'GPT3 126M Score 19.01 28.37 19.43',
      'GPT3 1.3B Score 10.19 12.74 10.29',
      'GPT3 6.7B Score 8.51 10.29 8.41',
    ].join(' ');
    await expectSelectionSnippet(page, expected);
    expect(await canonicalNativeSelection(page)).toBe(expected);
  });

  test('a drag through a centered affiliation masthead includes preceding author rows', async ({ page }) => {
    await page.goto(centeredMastheadRegressionUrl);
    await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
    await expect(page.locator('#page-1 .text-layer span[data-item-index]')).toHaveCount(19);
    const start = await textItemBox(page, 'FP8 F');
    const end = await textItemBox(page, 'Neil Burgess, Sangwon Ha, Richard Grisenthwaite');

    await resetMessages(page);
    await dragSelection(
      page,
      { x: start.x + 1, y: start.y + start.height / 2 },
      { x: end.x + end.width - 1, y: end.y + end.height / 2 },
    );

    const expected = [
      'FP8 F ORMATS FOR D EEP L EARNING',
      'Paulius Micikevicius, Dusan Stosic, Patrick Judd, John Kamalu, Stuart Oberman, Mohammad Shoeybi,',
      'Michael Siu, Hao Wu',
      'NVIDIA',
      '{pauliusm, dstosic, pjudd, jkamalu, soberman, mshoeybi, msiu, skyw}@nvidia.com',
      'Neil Burgess, Sangwon Ha, Richard Grisenthwaite',
    ].join(' ');
    await expectSelectionSnippet(page, expected);
    expect(await canonicalNativeSelection(page)).toBe(expected);
  });

  test('rapid repeated character drags never escalate into word or line selection', async ({ page }) => {
    await openRealPdf(page);
    const start = await characterTarget(page, 'FlashAttention', 0, 2);
    const end = await characterTarget(page, 'FlashAttention', 0, 4);

    for (let attempt = 0; attempt < 8; attempt++) {
      await resetMessages(page);
      await dragSelection(page, pointWithinCharacter(start, 0), pointWithinCharacter(end, 0));
      expect(await waitForSelectionAnchor(page)).toMatchObject({
        page: 1,
        textItemIndex: start.itemIndex,
        charOffset: start.offset,
        endTextItemIndex: end.itemIndex,
        endCharOffset: end.offset + 1,
        snippet: 'ash',
      });
      expect(await canonicalNativeSelection(page)).toBe('ash');
      await expect(page.locator('#page-1 .pdf-selection-rect')).toHaveCount(1);
    }
  });

  test('formula scripts extend one baseline selection band to their painted bounds', async ({ page }) => {
    await page.goto(formulaUrl);
    await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
    const spans = page.locator('#page-1 .text-layer span[data-item-index]');
    await expect(spans).toHaveCount(5);
    const firstRun = await requiredBox(spans.first());
    const lastRun = await requiredBox(spans.last());
    await resetMessages(page);
    await dragSelection(
      page,
      { x: firstRun.x + 1, y: firstRun.y + firstRun.height / 2 },
      { x: lastRun.x + lastRun.width - 1, y: lastRun.y + lastRun.height / 2 },
    );
    await expect(page.locator('#selection-toolbar')).toBeVisible();

    const bands = await normalizedSelectionBands(page);
    expect(bands).toHaveLength(1);
    const formulaRuns = await spans.evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
    const superscriptTop = Math.min(...formulaRuns.map(rect => rect.y));
    const subscriptBottom = Math.max(...formulaRuns.map(rect => rect.y + rect.height));
    expect(formulaRuns.filter(rect => rect.height < Math.max(...formulaRuns.map(run => run.height)) * 0.8))
      .toHaveLength(2);
    expect(bands[0]!.y).toBeLessThanOrEqual(superscriptTop + 0.5);
    expect(bands[0]!.y + bands[0]!.height)
      .toBeGreaterThanOrEqual(subscriptBottom - 0.5);
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

async function openRealPdf(page: Page): Promise<void> {
  await page.goto(realPdfUrl);
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('#page-1 .text-layer span[data-item-index]')).not.toHaveCount(0);
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

type CharacterTarget = Point & {
  width: number;
  itemIndex: number;
  offset: number;
};

async function characterTarget(
  page: Page,
  needle: string,
  occurrence: number,
  needleOffset: number,
): Promise<CharacterTarget> {
  return page.locator('#page-1 .text-layer').evaluate((layer, request) => {
    let remaining = request.occurrence;
    for (const element of layer.querySelectorAll<HTMLElement>('span[data-item-index] .pdf-text-glyphs')) {
      const node = element.firstChild;
      const content = node?.textContent ?? '';
      let from = 0;
      for (;;) {
        const match = content.indexOf(request.needle, from);
        if (match < 0) break;
        if (remaining-- === 0) {
          if (!node || node.nodeType !== Node.TEXT_NODE) {
            throw new Error(`Expected a text node for "${request.needle}"`);
          }
          const offset = match + request.needleOffset;
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          const rect = range.getBoundingClientRect();
          const item = element.closest<HTMLElement>('span[data-item-index]');
          return {
            x: rect.left,
            y: rect.top + rect.height / 2,
            width: rect.width,
            itemIndex: Number(item?.dataset.itemIndex ?? -1),
            offset,
          };
        }
        from = match + 1;
      }
    }
    throw new Error(`Could not find occurrence ${request.occurrence} of "${request.needle}"`);
  }, { needle, occurrence, needleOffset });
}

function pointWithinCharacter(target: CharacterTarget, centerBias: number): Point {
  return {
    x: target.x + target.width * (0.5 + centerBias),
    y: target.y,
  };
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

async function waitForSelectionAnchor(page: Page): Promise<Record<string, unknown>> {
  await expect.poll(() => page.evaluate(() => (window as any).__mockMessages
    ?.filter((message: any) => message.type === 'selectionChanged' && message.anchor)
    .at(-1)?.anchor), { timeout: 2_000 }).toBeTruthy();
  return page.evaluate(() => (window as any).__mockMessages
    ?.filter((message: any) => message.type === 'selectionChanged' && message.anchor)
    .at(-1)?.anchor);
}

async function canonicalNativeSelection(page: Page): Promise<string> {
  return page.evaluate(() => window.getSelection()?.toString().replace(/\s+/gu, ' ').trim() ?? '');
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
