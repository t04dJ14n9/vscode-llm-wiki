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

test('pdf viewer keeps canvas and overlay geometry aligned to exact scaled size', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('canvas.pdf-canvas')).toBeVisible();

  const geometry = await page.evaluate(() => {
    const wrapper = document.querySelector('.page-wrapper') as HTMLElement;
    const canvas = document.querySelector('canvas.pdf-canvas') as HTMLCanvasElement;
    const textLayer = document.querySelector('.text-layer') as HTMLElement;
    const highlightLayer = document.querySelector('.highlight-layer') as HTMLElement;
    const cssWidth = Number.parseFloat(canvas.style.width);
    const cssHeight = Number.parseFloat(canvas.style.height);
    return {
      wrapperWidth: wrapper.style.width,
      wrapperHeight: wrapper.style.height,
      canvasWidth: canvas.style.width,
      canvasHeight: canvas.style.height,
      textLayerWidth: textLayer.style.width,
      textLayerHeight: textLayer.style.height,
      highlightLayerWidth: highlightLayer.style.width,
      highlightLayerHeight: highlightLayer.style.height,
      cssWidth,
      cssHeight,
      bitmapWidth: canvas.width,
      bitmapHeight: canvas.height,
      dpr: window.devicePixelRatio || 1,
    };
  });

  expect(Number.isInteger(geometry.cssWidth)).toBe(false);
  expect(Number.isInteger(geometry.cssHeight)).toBe(false);
  expect(geometry.wrapperWidth).toBe(geometry.canvasWidth);
  expect(geometry.wrapperHeight).toBe(geometry.canvasHeight);
  expect(geometry.textLayerWidth).toBe(geometry.canvasWidth);
  expect(geometry.textLayerHeight).toBe(geometry.canvasHeight);
  expect(geometry.highlightLayerWidth).toBe(geometry.canvasWidth);
  expect(geometry.highlightLayerHeight).toBe(geometry.canvasHeight);
  expect(Math.abs(geometry.bitmapWidth - Math.round(geometry.cssWidth * geometry.dpr))).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.bitmapHeight - Math.round(geometry.cssHeight * geometry.dpr))).toBeLessThanOrEqual(1);
});

test('pdf viewer can switch from continuous scroll to page-turning mode', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=two-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });
  await expect(page.locator('.page-wrapper')).toHaveCount(2);

  await page.locator('#toggle-continuous').click();
  await expect(page.locator('#page-container')).toHaveClass(/paginated/);

  const firstVisible = await visiblePageIds(page);
  expect(firstVisible).toEqual(['page-1']);

  await page.locator('#next').click();
  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 2/);
  const secondVisible = await visiblePageIds(page);
  expect(secondVisible).toEqual(['page-2']);
});

test('pdf viewer can switch to two-page double-column layout', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=two-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });

  await page.locator('#toggle-spread').click();
  await expect(page.locator('#page-container')).toHaveClass(/two-page/);

  const layout = await page.locator('#page-container').evaluate((container: HTMLElement) => {
    const styles = window.getComputedStyle(container);
    const wrappers = Array.from(container.querySelectorAll<HTMLElement>('.page-wrapper'));
    return {
      display: styles.display,
      columns: styles.gridTemplateColumns.split(' ').filter(Boolean).length,
      firstTop: Math.round(wrappers[0].getBoundingClientRect().top),
      secondTop: Math.round(wrappers[1].getBoundingClientRect().top),
      firstLeft: Math.round(wrappers[0].getBoundingClientRect().left),
      secondLeft: Math.round(wrappers[1].getBoundingClientRect().left),
    };
  });

  expect(layout.display).toBe('grid');
  expect(layout.columns).toBe(2);
  expect(layout.firstTop).toBe(layout.secondTop);
  expect(layout.secondLeft).toBeGreaterThan(layout.firstLeft);
});

test('pdf viewer search bar finds text and uses compact VS Code find-widget layout', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=two-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  const searchPanel = page.locator('#pdf-search');
  await expect(searchPanel).toBeVisible();

  await page.locator('#pdf-search-input').fill('Page Two');
  await expect(page.locator('.pdf-search-match')).toHaveCount(1);
  await expect(page.locator('.pdf-search-match.selected')).toHaveCount(1);
  await expect(page.locator('#pdf-search-count')).toHaveText('1 / 1');
  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 2/);

  const metrics = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('#pdf-search');
    const viewer = document.querySelector<HTMLElement>('#viewer-container');
    const input = document.querySelector<HTMLInputElement>('#pdf-search-input');
    const buttons = Array.from(panel?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    if (!panel || !viewer || !input) return null;
    const panelRect = panel.getBoundingClientRect();
    const viewerRect = viewer.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const selected = document.querySelector<HTMLElement>('.pdf-search-match.selected');
    const selectedRect = selected?.getBoundingClientRect();
    return {
      panelWidth: Math.round(panelRect.width),
      panelTopGap: Math.round(panelRect.top - viewerRect.top),
      panelRightGap: Math.round(viewerRect.right - panelRect.right),
      inputHeight: Math.round(inputRect.height),
      selectedTop: Math.round(selectedRect?.top ?? 0),
      selectedBottom: Math.round(selectedRect?.bottom ?? 0),
      viewerTop: Math.round(viewerRect.top),
      viewerBottom: Math.round(viewerRect.bottom),
      buttonWidths: buttons.map(button => Math.round(button.getBoundingClientRect().width)),
      buttonBackgroundImages: buttons.map(button => getComputedStyle(button).backgroundImage),
      buttonColors: buttons.map(button => getComputedStyle(button).color),
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.panelWidth).toBeLessThanOrEqual(420);
  expect(metrics!.panelTopGap).toBeGreaterThanOrEqual(6);
  expect(metrics!.panelTopGap).toBeLessThanOrEqual(12);
  expect(metrics!.panelRightGap).toBeGreaterThanOrEqual(6);
  expect(metrics!.panelRightGap).toBeLessThanOrEqual(12);
  expect(metrics!.inputHeight).toBeGreaterThanOrEqual(24);
  expect(metrics!.inputHeight).toBeLessThanOrEqual(28);
  expect(metrics!.selectedTop).toBeGreaterThan(metrics!.viewerTop);
  expect(metrics!.selectedBottom).toBeLessThan(metrics!.viewerBottom);
  expect(metrics!.buttonWidths.every(width => width <= 28)).toBe(true);
  expect(metrics!.buttonBackgroundImages.every(image => image === 'none')).toBe(true);
  expect(metrics!.buttonColors.every(color => color !== 'rgb(0, 0, 0)')).toBe(true);
});

test('pdf viewer search finds phrases split across PDF text rects', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=split-search');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  const textItems = await page.locator('.text-layer span[data-item-index]').evaluateAll(spans =>
    spans.map(span => span.textContent ?? '')
  );
  expect(textItems.length).toBeGreaterThanOrEqual(2);
  expect(textItems.some(text => text.startsWith('Page'))).toBe(true);
  expect(textItems.some(text => text.startsWith('Two'))).toBe(true);
  expect(textItems.some(text => text.includes('Page Two'))).toBe(false);

  await page.locator('#search-open').click();
  await page.locator('#pdf-search-input').pressSequentially('Page Two');

  await expect(page.locator('#pdf-search-count')).toHaveText('1 / 1');
  await expect(page.locator('.pdf-search-match.selected')).toHaveCount(2);
});

test('pdf viewer fuzzes controls, search, view modes, and highlights without stale state', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=two-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });
  await expectPdfViewerStable(page, errors, 'initial two-page fixture', 2);

  for (const operation of [
    { label: 'zoom in once', run: () => page.locator('#zoom-in').click() },
    { label: 'zoom in twice', run: () => page.locator('#zoom-in').click() },
    { label: 'zoom out', run: () => page.locator('#zoom-out').click() },
    { label: 'fit width', run: () => page.locator('#fit').click() },
  ]) {
    await operation.run();
    await expectPdfViewerStable(page, errors, operation.label, 2);
  }

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  await expect(page.locator('#pdf-search')).toBeVisible();
  await expectPdfViewerStable(page, errors, 'open search with keyboard shortcut', 2);

  await page.locator('#pdf-search-input').pressSequentially('Page');
  await expect(page.locator('#pdf-search-count')).toHaveText('1 / 2');
  await expect(page.locator('.pdf-search-match')).toHaveCount(2);
  await expectPdfViewerStable(page, errors, 'search broad query', 2);

  await page.locator('#pdf-search-input').press('Enter');
  await expect(page.locator('#pdf-search-count')).toHaveText('2 / 2');
  await expectPdfViewerStable(page, errors, 'search next via Enter', 2);

  await page.locator('#pdf-search-input').press('Shift+Enter');
  await expect(page.locator('#pdf-search-count')).toHaveText('1 / 2');
  await expectPdfViewerStable(page, errors, 'search previous via Shift+Enter', 2);

  await page.locator('#pdf-search-input').fill('not present in fixture');
  await expect(page.locator('#pdf-search-count')).toHaveText('No results');
  await expect(page.locator('.pdf-search-match')).toHaveCount(0);
  await expectPdfViewerStable(page, errors, 'search no results', 2);

  await page.locator('#pdf-search-input').fill('Page Two');
  await expect(page.locator('#pdf-search-count')).toHaveText('1 / 1');
  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 2/);
  await expectPdfViewerStable(page, errors, 'search exact page two query', 2);

  await page.locator('#pdf-search-close').click();
  await expect(page.locator('#pdf-search')).toBeHidden();
  await expect(page.locator('.pdf-search-match')).toHaveCount(0);
  await expectPdfViewerStable(page, errors, 'close search clears highlights', 2);

  for (const operation of [
    { label: 'switch to paginated mode', run: () => page.locator('#toggle-continuous').click() },
    { label: 'navigate previous in paginated mode', run: () => page.locator('#prev').click() },
    { label: 'switch to two-page spread', run: () => page.locator('#toggle-spread').click() },
    { label: 'navigate next in spread mode', run: () => page.locator('#next').click() },
    { label: 'return to continuous spread mode', run: () => page.locator('#toggle-continuous').click() },
    { label: 'return to one-page continuous mode', run: () => page.locator('#toggle-spread').click() },
  ]) {
    await operation.run();
    await expectPdfViewerStable(page, errors, operation.label, 2);
  }

  const referencedAnchor = {
    id: 'anc_fuzz_referenced',
    page: 1,
    textItemIndex: 0,
    charOffset: 0,
    endTextItemIndex: 0,
    endCharOffset: 4,
    snippet: 'Page',
  };
  const annotatedAnchor = {
    id: 'anc_fuzz_annotated',
    page: 2,
    textItemIndex: 0,
    charOffset: 5,
    endTextItemIndex: 0,
    endCharOffset: 8,
    snippet: 'Two',
  };
  await page.evaluate(({ referencedAnchor, annotatedAnchor }) => {
    window.__mockMessages = [];
    window.postMessage({
      type: 'setHighlights',
      referenced: [{ anchor: referencedAnchor }],
      annotated: [{ anchor: annotatedAnchor }],
    }, '*');
  }, { referencedAnchor, annotatedAnchor });
  await expect(page.locator('.annotation-highlight.referenced')).toHaveCount(1);
  await expect(page.locator('.annotation-highlight.annotated')).toHaveCount(1);
  await expectPdfViewerStable(page, errors, 'draw referenced and annotated highlights', 2);

  await page.locator('.annotation-highlight.referenced').click({ force: true });
  await page.waitForFunction(() =>
    window.__mockMessages?.some((message) => message.type === 'requestReferencesForAnchor' && message.anchor?.id === 'anc_fuzz_referenced')
  );
  await page.evaluate((referencedAnchor) => {
    window.postMessage({
      type: 'referencesForAnchor',
      anchor: referencedAnchor,
      items: [{
        source: 'notes/Concepts/Page One.md',
        sourceLine: 7,
        snippet: 'Page',
        contextLine: 'The first page is referenced by markdown.',
      }],
    }, '*');
  }, referencedAnchor);
  await expect(page.locator('.ref-popover')).toContainText('1 markdown note references this');
  await expectPdfViewerStable(page, errors, 'referenced highlight popover', 2);

  await page.keyboard.press('Escape');
  await expect(page.locator('.ref-popover')).toHaveCount(0);
  await expectPdfViewerStable(page, errors, 'dismiss referenced highlight popover', 2);

  await page.locator('.annotation-highlight.annotated').click({ force: true });
  await page.waitForFunction(() =>
    window.__mockMessages?.some((message) => message.type === 'requestReferencesForAnchor' && message.anchor?.id === 'anc_fuzz_annotated')
  );
  await page.evaluate((annotatedAnchor) => {
    window.postMessage({
      type: 'referencesForAnchor',
      anchor: annotatedAnchor,
      items: [],
    }, '*');
  }, annotatedAnchor);
  await expect(page.locator('.ref-popover')).toContainText('No markdown references found.');
  await expectPdfViewerStable(page, errors, 'annotated highlight empty popover', 2);
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

test('pdf selection toolbar fuzzes all actions across synthetic and dragged selections', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('.text-layer span[data-item-index="0"]')).toBeVisible();
  await expectPdfViewerStable(page, errors, 'selection fuzz initial document', 1);

  for (const actionCase of [
    { label: 'Copy Link', action: 'copyLink', openMenu: false, start: 0, end: 14 },
    { label: 'Insert Link', action: 'insertLink', openMenu: false, start: 15, end: 26 },
    { label: 'Copy Quote and Link', action: 'copyQuoteAndLink', openMenu: true, start: 0, end: 26 },
    { label: 'Insert Quote and Link', action: 'insertQuoteAndLink', openMenu: true, start: 27, end: 34 },
    { label: 'Highlight Selection', action: 'highlight', openMenu: true, start: 35, end: 41 },
  ]) {
    await selectPdfTextRange(page, actionCase.start, actionCase.end);
    await expect(page.locator('#selection-toolbar')).toBeVisible();
    if (actionCase.openMenu) {
      await page.locator('#selection-toolbar button', { hasText: 'More' }).click();
      await expect(page.locator('#selection-toolbar .menu.open')).toBeVisible();
    }
    await page.evaluate(() => {
      window.__mockMessages = [];
    });
    await page.locator('#selection-toolbar button', { hasText: actionCase.label }).click();
    const message = await waitForSelectionAction(page, actionCase.action);
    expect(message.anchor.page).toBe(1);
    expect(message.anchor.textItemIndex).toBe(0);
    expect(message.anchor.endTextItemIndex).toBe(0);
    expect(message.anchor.snippet.length).toBeGreaterThan(0);
    expect(message.anchor.charOffset).toBeLessThan(message.anchor.endCharOffset);
    await expect(page.locator('#selection-toolbar')).toHaveCount(0);
    await expectPdfViewerStable(page, errors, `selection action ${actionCase.action}`, 1);
  }

  const span = page.locator('.text-layer span[data-item-index="0"]');
  const box = await span.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(box.width - 4, 220), box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#selection-toolbar')).toBeVisible();
  await page.evaluate(() => {
    window.__mockMessages = [];
  });
  await page.locator('#selection-toolbar button', { hasText: 'Copy Link' }).click();
  const draggedMessage = await waitForSelectionAction(page, 'copyLink');
  expect(draggedMessage.anchor.snippet).toContain('FlashAttention');
  await expectPdfViewerStable(page, errors, 'dragged selection action', 1);
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

async function visiblePageIds(page) {
  return page.locator('.page-wrapper').evaluateAll((wrappers: HTMLElement[]) =>
    wrappers
      .filter(wrapper => window.getComputedStyle(wrapper).display !== 'none')
      .map(wrapper => wrapper.id),
  );
}

function collectPageErrors(page) {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

async function expectPdfViewerStable(page, errors: string[], label: string, expectedTotalPages: number) {
  const state = await page.evaluate(() => {
    const pageInfo = document.querySelector<HTMLElement>('#page-info')?.textContent ?? '';
    const pageMatch = pageInfo.match(/Page\s+(\d+)\s+\/\s+(\d+)\s+(\d+)%/);
    const wrappers = Array.from(document.querySelectorAll<HTMLElement>('.page-wrapper')).map(wrapper => {
      const canvas = wrapper.querySelector<HTMLCanvasElement>('canvas.pdf-canvas');
      const textLayer = wrapper.querySelector<HTMLElement>('.text-layer');
      const highlightLayer = wrapper.querySelector<HTMLElement>('.highlight-layer');
      const styles = window.getComputedStyle(wrapper);
      return {
        id: wrapper.id,
        display: styles.display,
        wrapperWidth: wrapper.style.width,
        wrapperHeight: wrapper.style.height,
        canvasWidth: canvas?.style.width ?? '',
        canvasHeight: canvas?.style.height ?? '',
        textLayerWidth: textLayer?.style.width ?? '',
        textLayerHeight: textLayer?.style.height ?? '',
        highlightLayerWidth: highlightLayer?.style.width ?? '',
        highlightLayerHeight: highlightLayer?.style.height ?? '',
        canvasBitmapWidth: canvas?.width ?? 0,
        canvasBitmapHeight: canvas?.height ?? 0,
        textItemCount: textLayer?.querySelectorAll('span[data-item-index]').length ?? 0,
        annotationCount: highlightLayer?.querySelectorAll('.annotation-highlight').length ?? 0,
        searchMatchCount: highlightLayer?.querySelectorAll('.pdf-search-match').length ?? 0,
      };
    });
    const visibleWrappers = wrappers.filter(wrapper => wrapper.display !== 'none');
    return {
      pageInfo,
      currentPage: pageMatch ? Number(pageMatch[1]) : null,
      totalPages: pageMatch ? Number(pageMatch[2]) : null,
      scalePercent: pageMatch ? Number(pageMatch[3]) : null,
      visibleIds: visibleWrappers.map(wrapper => wrapper.id),
      wrapperCount: wrappers.length,
      renderedVisibleCount: visibleWrappers.filter(wrapper => wrapper.canvasBitmapWidth > 0 && wrapper.canvasBitmapHeight > 0).length,
      misaligned: visibleWrappers.filter(wrapper =>
        wrapper.wrapperWidth !== wrapper.canvasWidth ||
        wrapper.wrapperHeight !== wrapper.canvasHeight ||
        wrapper.wrapperWidth !== wrapper.textLayerWidth ||
        wrapper.wrapperHeight !== wrapper.textLayerHeight ||
        wrapper.wrapperWidth !== wrapper.highlightLayerWidth ||
        wrapper.wrapperHeight !== wrapper.highlightLayerHeight
      ),
      searchHidden: document.querySelector<HTMLElement>('#pdf-search')?.classList.contains('hidden') ?? true,
      searchCountText: document.querySelector<HTMLElement>('#pdf-search-count')?.textContent ?? '',
      searchMatchCount: document.querySelectorAll('.pdf-search-match').length,
      selectedSearchMatchCount: document.querySelectorAll('.pdf-search-match.selected').length,
      selectionToolbarCount: document.querySelectorAll('#selection-toolbar').length,
      popoverCount: document.querySelectorAll('.ref-popover').length,
      messageTypes: (window.__mockMessages ?? []).map(message => message.type),
    };
  });

  expect(errors, label).toEqual([]);
  expect(state.pageInfo, label).toMatch(new RegExp(`Page \\d+ / ${expectedTotalPages}`));
  expect(state.currentPage, label).toBeGreaterThanOrEqual(1);
  expect(state.currentPage, label).toBeLessThanOrEqual(expectedTotalPages);
  expect(state.totalPages, label).toBe(expectedTotalPages);
  expect(state.scalePercent, label).toBeGreaterThanOrEqual(50);
  expect(state.scalePercent, label).toBeLessThanOrEqual(350);
  expect(state.wrapperCount, label).toBe(expectedTotalPages);
  expect(state.visibleIds.length, label).toBeGreaterThan(0);
  expect(state.renderedVisibleCount, label).toBeGreaterThan(0);
  expect(state.misaligned, label).toEqual([]);
  expect(state.selectionToolbarCount, label).toBeLessThanOrEqual(1);
  expect(state.popoverCount, label).toBeLessThanOrEqual(1);
  if (state.searchHidden) {
    expect(state.searchCountText, label).toBe('');
    expect(state.searchMatchCount, label).toBe(0);
    expect(state.selectedSearchMatchCount, label).toBe(0);
  } else {
    expect(state.selectedSearchMatchCount, label).toBeLessThanOrEqual(Math.max(1, state.searchMatchCount));
  }
}

async function selectPdfTextRange(page, start: number, end: number) {
  await page.evaluate(({ start, end }) => {
    const span = document.querySelector<HTMLElement>('.text-layer span[data-item-index="0"]');
    const textNode = span?.firstChild;
    if (!span || !textNode) throw new Error('PDF text span is not ready');
    const contentLength = textNode.textContent?.length ?? 0;
    const range = document.createRange();
    range.setStart(textNode, Math.max(0, Math.min(start, contentLength)));
    range.setEnd(textNode, Math.max(0, Math.min(end, contentLength)));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    document.querySelector('#page-container')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  }, { start, end });
}

async function waitForSelectionAction(page, action: string) {
  await page.waitForFunction((action) =>
    window.__mockMessages?.some(message => message.type === 'selectionAction' && message.action === action),
  action);
  return page.evaluate((action) =>
    window.__mockMessages?.find(message => message.type === 'selectionAction' && message.action === action),
  action);
}
