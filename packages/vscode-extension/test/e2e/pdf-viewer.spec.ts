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

  expect(geometry.cssWidth).toBeGreaterThan(0);
  expect(geometry.cssHeight).toBeGreaterThan(0);
  expect(geometry.wrapperWidth).toBe(geometry.canvasWidth);
  expect(geometry.wrapperHeight).toBe(geometry.canvasHeight);
  expect(geometry.textLayerWidth).toBe(geometry.canvasWidth);
  expect(geometry.textLayerHeight).toBe(geometry.canvasHeight);
  expect(geometry.highlightLayerWidth).toBe(geometry.canvasWidth);
  expect(geometry.highlightLayerHeight).toBe(geometry.canvasHeight);
  expect(Math.abs(geometry.bitmapWidth - Math.round(geometry.cssWidth * geometry.dpr))).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.bitmapHeight - Math.round(geometry.cssHeight * geometry.dpr))).toBeLessThanOrEqual(1);
});

test('pdf viewer aligns selectable glyph bounds with the rendered text rectangle', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=selector-edge');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  const zoomInput = page.getByRole('spinbutton', { name: 'Zoom' });
  await zoomInput.fill('150');
  await zoomInput.press('Enter');
  await expect(page.locator('#page-info')).toHaveText(/150%/);

  const geometry = await page.locator('#page-1 .text-layer span[data-item-index]').filter({ hasText: 'Flash' }).evaluate((span: HTMLElement) => {
    const wrapper = span.closest<HTMLElement>('.page-wrapper')!;
    const wrapperRect = wrapper.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(span);
    const rangeRect = range.getBoundingClientRect();
    return {
      expected: {
        left: Number.parseFloat(span.style.left),
        top: Number.parseFloat(span.style.top),
        width: Number.parseFloat(span.style.width),
        height: Number.parseFloat(span.style.height),
      },
      actual: {
        left: rangeRect.left - wrapperRect.left,
        top: rangeRect.top - wrapperRect.top,
        width: rangeRect.width,
        height: rangeRect.height,
      },
      hitBox: {
        left: spanRect.left - wrapperRect.left,
        top: spanRect.top - wrapperRect.top,
        width: spanRect.width,
        height: spanRect.height,
      },
    };
  });

  const expectedRight = geometry.expected.left + geometry.expected.width;
  const actualRight = geometry.actual.left + geometry.actual.width;
  const expectedBottom = geometry.expected.top + geometry.expected.height;
  const actualBottom = geometry.actual.top + geometry.actual.height;
  const hitBoxRight = geometry.hitBox.left + geometry.hitBox.width;
  const hitBoxBottom = geometry.hitBox.top + geometry.hitBox.height;
  expect(Math.abs(geometry.actual.left - geometry.expected.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(actualRight - expectedRight)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.actual.top - geometry.expected.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(actualBottom - expectedBottom)).toBeLessThanOrEqual(2);
  expect(Math.abs(geometry.hitBox.left - geometry.expected.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(hitBoxRight - expectedRight)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.hitBox.top - geometry.expected.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(hitBoxBottom - expectedBottom)).toBeLessThanOrEqual(2);
});

test('pdf viewer can switch from continuous scroll to page-turning mode', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=two-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });
  await expect(page.locator('.page-wrapper')).toHaveCount(2);

  await setContinuousScroll(page, false);
  await expect(page.locator('#page-container')).toHaveClass(/paginated/);

  const firstVisible = await visiblePageIds(page);
  expect(firstVisible).toEqual(['page-1']);

  await page.locator('#next').click();
  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 2/);
  const secondVisible = await visiblePageIds(page);
  expect(secondVisible).toEqual(['page-2']);
});

test('single-page Next click performs one page change when the page field has a pending value', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=four-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 4/, { timeout: 10_000 });

  await setContinuousScroll(page, false);
  await chooseDisplayMode(page, 'Single Page');

  const pageInput = page.getByRole('spinbutton', { name: 'Page' });
  await pageInput.fill('4');
  await page.getByRole('button', { name: 'Next page' }).click();

  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 4/);
  await expect(pageInput).toHaveValue('2');
  expect(await visiblePageIds(page)).toEqual(['page-2']);
});

test('aborted page-button pointer gesture still commits a blurred page field', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=four-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 4/, { timeout: 10_000 });

  await setContinuousScroll(page, false);
  await chooseDisplayMode(page, 'Single Page');

  const pageInput = page.getByRole('spinbutton', { name: 'Page' });
  const nextButton = page.getByRole('button', { name: 'Next page' });
  await pageInput.fill('4');
  const nextBox = await nextButton.boundingBox();
  expect(nextBox).not.toBeNull();
  if (!nextBox) return;

  await page.mouse.move(nextBox.x + nextBox.width / 2, nextBox.y + nextBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(nextBox.x + nextBox.width + 40, nextBox.y + nextBox.height + 40);
  await page.mouse.up();

  await expect(page.locator('#page-info')).toHaveText(/Page 4 \/ 4/);
  await expect(pageInput).toHaveValue('4');
  expect(await visiblePageIds(page)).toEqual(['page-4']);
});

test('page field deferred blur commits when page-button pointer capture is lost', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=four-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 4/, { timeout: 10_000 });

  await setContinuousScroll(page, false);
  await chooseDisplayMode(page, 'Single Page');

  await page.evaluate(() => {
    const pageInput = document.querySelector<HTMLInputElement>('#page-input')!;
    const nextButton = document.querySelector<HTMLButtonElement>('#next')!;
    pageInput.focus();
    pageInput.value = '4';
    nextButton.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 73,
    }));
    nextButton.focus();
    nextButton.dispatchEvent(new PointerEvent('lostpointercapture', {
      bubbles: true,
      pointerId: 73,
    }));
  });

  await expect(page.locator('#page-info')).toHaveText(/Page 4 \/ 4/);
  await expect(page.getByRole('spinbutton', { name: 'Page' })).toHaveValue('4');
  expect(await visiblePageIds(page)).toEqual(['page-4']);
});

test('page field still commits when keyboard focus moves to the Next button', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=four-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 4/, { timeout: 10_000 });

  await setContinuousScroll(page, false);
  await chooseDisplayMode(page, 'Single Page');

  const pageInput = page.getByRole('spinbutton', { name: 'Page' });
  await pageInput.fill('2');
  await pageInput.press('Tab');

  await expect(page.getByRole('button', { name: 'Next page' })).toBeFocused();
  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 4/);
  expect(await visiblePageIds(page)).toEqual(['page-2']);
});

test('pdf viewer can switch to two-page double-column layout', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=four-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 4/, { timeout: 10_000 });

  await chooseDisplayMode(page, 'Two Pages');
  await expect(page.locator('#page-container')).toHaveClass(/two-page/);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('#page-info')).toHaveText(/Page 3 \/ 4/);

  const layout = await page.locator('#page-container').evaluate((container: HTMLElement) => {
    const styles = window.getComputedStyle(container);
    const wrappers = Array.from(container.querySelectorAll<HTMLElement>('.page-wrapper'))
      .filter(wrapper => window.getComputedStyle(wrapper).display !== 'none');
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

test('pdf viewer exposes PDF++-like direct page and zoom controls', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=two-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });

  const toolbar = page.getByRole('toolbar', { name: 'PDF toolbar' });
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Toggle sidebar' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Search' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom out' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Display options' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next page' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Copy embed link to rectangular selection' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Copy link format' })).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: 'Highlight color' })).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: 'Direct highlight' })).toHaveCount(0);

  const pageInput = page.getByRole('spinbutton', { name: 'Page' });
  const zoomInput = page.getByRole('spinbutton', { name: 'Zoom' });
  await expect(pageInput).toHaveValue('1');
  await expect(page.locator('#page-total')).toHaveText('of 2');
  const automaticZoom = Number(await zoomInput.inputValue());
  expect(automaticZoom).toBeGreaterThanOrEqual(10);
  expect(automaticZoom).toBeLessThanOrEqual(350);

  await pageInput.fill('2');
  await pageInput.press('Enter');
  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 2/);
  await expect(pageInput).toHaveValue('2');

  const initialWidth = await page.locator('#page-2').evaluate((element: HTMLElement) => element.getBoundingClientRect().width);
  await zoomInput.fill('200');
  await zoomInput.press('Enter');
  await expect(page.locator('#page-info')).toHaveText(/200%/);
  await expect(zoomInput).toHaveValue('200');
  await expect.poll(async () => Math.abs(
    await page.locator('#page-2').evaluate((element: HTMLElement) => element.getBoundingClientRect().width)
      - initialWidth * (200 / automaticZoom)
  )).toBeLessThanOrEqual(3);
});

test('pdf viewer keeps the latest page navigation when an older render finishes last', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 220 });
  await installNavigationRaceHarness(page);

  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=four-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 4/, { timeout: 10_000 });
  await expect(page.locator('#page-1 canvas.pdf-canvas')).toBeVisible();
  const zoomInput = page.getByRole('spinbutton', { name: 'Zoom' });
  await zoomInput.fill('200');
  await zoomInput.press('Enter');
  await expect(zoomInput).toHaveValue('200');

  await page.evaluate(() => {
    const state = window as any;
    state.__navigationScrollTargets = [];
    state.__delayNextPdfImageLoadMs = 200;
    const pageInput = document.querySelector<HTMLInputElement>('#page-input')!;
    pageInput.value = '2';
    pageInput.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }));
    document.querySelector<HTMLButtonElement>('#next')!.click();
  });

  await expect(page.locator('#page-info')).toHaveText(/Page 3 \/ 4/);
  await expect.poll(() => page.evaluate(() => (window as any).__delayedPdfImageLoadsCompleted)).toBe(1);
  expect(await page.evaluate(() => (window as any).__navigationScrollTargets)).toEqual(['page-3']);
});

test('pdf viewer retains continuous-scroll page state across separate intersection batches', async ({ page }) => {
  await installIntersectionObserverHarness(page);
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=four-page&askPdf=1');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 4/, { timeout: 10_000 });
  await page.waitForTimeout(50);

  await page.evaluate(() => {
    (window as any).__emitPdfPageIntersections([
      [1, 0],
      [3, 0.4],
      [2, 0.8],
    ]);
  });
  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 4/);

  await page.evaluate(() => {
    (window as any).__emitPdfPageIntersections([[3, 0.6]]);
  });
  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 4/);

  const pageTwo = discussionAnnotation('discussion-page-2', 2, 'Question anchored on page 2');
  await page.evaluate(annotation => {
    (window as any).__mockMessages = [];
    window.postMessage({
      type: 'pdfDiscussionSnapshot',
      annotations: [annotation],
      consentGranted: true,
    }, '*');
  }, pageTwo);
  await page.getByRole('button', { name: 'PDF discussions (1)' }).click();
  await page.getByRole('region', { name: 'PDF discussion overview' }).getByRole('button').click();

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 4/);
  await expect(page.locator('#page-input')).toHaveValue('2');
  await expect(panel.getByRole('link', { name: 'Page 2' })).toBeVisible();
  await expect(page.locator('#page-2 .pdf-discussion-marker[data-annotation-id="discussion-page-2"]')).toBeVisible();
  await expect(page.locator('#page-2 canvas.pdf-canvas')).toBeVisible();
  await panel.getByRole('button', { name: 'Copy portable selection link' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mockMessages
    .filter(message => message.type === 'pdfDiscussionCopyPortableLink')
    .at(-1)?.annotationId)).toBe(pageTwo.id);
});

test('Ask PDF keeps the latest annotation marker navigation when an older page render finishes last', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 220 });
  await installNavigationRaceHarness(page);
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=four-page&askPdf=1');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 4/, { timeout: 10_000 });
  const zoomInput = page.getByRole('spinbutton', { name: 'Zoom' });
  await zoomInput.fill('200');
  await zoomInput.press('Enter');
  await expect(zoomInput).toHaveValue('200');

  const annotations = [
    discussionAnnotation('discussion-a', 2, 'Question A'),
    discussionAnnotation('discussion-b', 3, 'Question B'),
  ];
  await page.evaluate(snapshot => {
    window.postMessage({
      type: 'pdfDiscussionSnapshot',
      annotations: snapshot,
      consentGranted: true,
    }, '*');
  }, annotations);
  await expect(page.getByRole('button', { name: 'PDF discussions (2)' })).toBeVisible();

  await page.evaluate(() => {
    const state = window as any;
    state.__navigationScrollTargets = [];
    state.__delayNextPdfImageLoadMs = 200;
    const count = document.querySelector<HTMLButtonElement>('#ask-pdf-count')!;
    count.click();
    document.querySelectorAll<HTMLButtonElement>('.ask-pdf-overview-item')[0]!.click();
    count.click();
    document.querySelectorAll<HTMLButtonElement>('.ask-pdf-overview-item')[1]!.click();
  });

  await expect(page.locator('#page-info')).toHaveText(/Page 3 \/ 4/);
  await expect.poll(() => page.evaluate(() => (window as any).__delayedPdfImageLoadsCompleted)).toBe(1);
  expect(await page.evaluate(() => (window as any).__navigationScrollTargets)).toEqual([
    'page-3',
    'marker:discussion-b',
  ]);
});

test('pdf viewer sidebar renders page thumbnails and navigates like PDF++', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=two-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });

  const sidebarToggle = page.getByRole('button', { name: 'Toggle sidebar' });
  await expect(sidebarToggle).toHaveAttribute('aria-expanded', 'false');
  await sidebarToggle.click();
  await expect(sidebarToggle).toHaveAttribute('aria-expanded', 'true');
  const navigation = page.getByRole('complementary', { name: 'PDF navigation' });
  await expect(navigation).toBeVisible();
  const pagesTab = navigation.getByRole('tab', { name: 'Pages' });
  const outlineTab = navigation.getByRole('tab', { name: 'Outline' });
  await expect(pagesTab).toHaveAttribute('aria-selected', 'true');
  await expect(outlineTab).toHaveAttribute('aria-selected', 'false');
  await pagesTab.focus();
  await pagesTab.press('ArrowRight');
  await expect(outlineTab).toHaveAttribute('aria-selected', 'true');
  await outlineTab.press('ArrowLeft');
  await expect(pagesTab).toHaveAttribute('aria-selected', 'true');

  const thumbnails = page.getByRole('button', { name: /Page \d+ thumbnail/ });
  await expect(thumbnails).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Page 1 thumbnail' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.pdf-thumbnail canvas').first()).toBeVisible();
  await expect.poll(() => page.locator('.pdf-thumbnail canvas').first().evaluate((canvas: HTMLCanvasElement) => canvas.width))
    .toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Page 2 thumbnail' }).click();
  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 2/);
  await expect(page.getByRole('button', { name: 'Page 2 thumbnail' })).toHaveAttribute('aria-current', 'page');
});

test('pdf viewer display menu exposes Preview presentation and fit modes', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=two-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });

  await page.getByRole('button', { name: 'Display options' }).click();
  const menu = page.getByRole('menu', { name: 'Display options' });
  await expect(menu).toBeVisible();
  for (const label of [
    'Single Page',
    'Single Page Continuous',
    'Two Pages',
    'Two Pages Continuous',
    'Fit width',
    'Fit height',
    'Fit page',
  ]) {
    await expect(menu.getByRole('menuitemradio', { name: label, exact: true })).toBeVisible();
  }
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Adapt to theme' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Defaults' })).toBeVisible();

  await menu.getByRole('menuitemradio', { name: 'Two Pages', exact: true }).click();
  await expect(page.locator('#page-container')).toHaveClass(/two-page/);
  await expect(page.locator('#page-container')).toHaveClass(/paginated/);
  await expect(page.locator('#page-container')).toHaveAttribute('data-spread-parity', 'even');
});

test('pdf viewer lays out Preview book spreads with a centered cover', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=four-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 4/, { timeout: 10_000 });

  await chooseDisplayMode(page, 'Two Pages');
  expect(await visiblePageIds(page)).toEqual(['page-1']);
  const coverOffset = await page.evaluate(() => {
    const viewer = document.querySelector<HTMLElement>('#viewer-container')!.getBoundingClientRect();
    const cover = document.querySelector<HTMLElement>('#page-1')!.getBoundingClientRect();
    return Math.abs((cover.left + cover.right) / 2 - (viewer.left + viewer.right) / 2);
  });
  expect(coverOffset).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('#page-info')).toHaveText(/Page 3 \/ 4/);
  expect(await visiblePageIds(page)).toEqual(['page-2', 'page-3']);
  const spread = await spreadGeometry(page);
  expect(spread[1].top).toBe(spread[2].top);
  expect(spread[1].left).toBeLessThan(spread[2].left);
});

test('pdf fit modes recompute after sidebar and viewport size changes', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  await chooseDisplayMode(page, 'Fit width');
  const wrapper = page.locator('#page-1');
  const initialWidth = await wrapper.evaluate(element => element.getBoundingClientRect().width);
  expect(Number(await page.getByRole('spinbutton', { name: 'Zoom' }).inputValue())).toBeLessThanOrEqual(350);

  await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  await expect.poll(() => wrapper.evaluate(element => element.getBoundingClientRect().width))
    .toBeLessThan(initialWidth - 100);
  await page.getByRole('button', { name: 'Close sidebar' }).click();
  await expect.poll(() => wrapper.evaluate(element => element.getBoundingClientRect().width))
    .toBeGreaterThan(initialWidth - 8);

  await page.setViewportSize({ width: 900, height: 760 });
  await expect.poll(() => wrapper.evaluate(element => element.getBoundingClientRect().width))
    .toBeLessThan(initialWidth - 180);

  await chooseDisplayMode(page, 'Fit page');
  const fitPage = await page.evaluate(() => {
    const viewer = document.querySelector<HTMLElement>('#viewer-container')!.getBoundingClientRect();
    const wrapper = document.querySelector<HTMLElement>('#page-1')!.getBoundingClientRect();
    return { viewerWidth: viewer.width, viewerHeight: viewer.height, pageWidth: wrapper.width, pageHeight: wrapper.height };
  });
  expect(fitPage.pageWidth).toBeLessThanOrEqual(fitPage.viewerWidth - 30);
  expect(fitPage.pageHeight).toBeLessThanOrEqual(fitPage.viewerHeight - 30);
});

test('pdf viewer preserves original PDF colors by default in a dark theme', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await page.locator('body').evaluate(body => body.classList.add('vscode-dark'));

  const body = page.locator('body');
  const canvas = page.locator('canvas.pdf-canvas');
  await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  const thumbnail = page.locator('.pdf-thumbnail canvas').first();
  await expect(thumbnail).toBeVisible();

  await expect(body).not.toHaveClass(/pdf-adapt-theme/);
  await expect.poll(() => canvas.evaluate(element => getComputedStyle(element).filter)).toBe('none');
  await expect.poll(() => thumbnail.evaluate(element => getComputedStyle(element).filter)).toBe('none');

  await page.getByRole('button', { name: 'Display options' }).click();
  const adaptToTheme = page.getByRole('menuitemcheckbox', { name: 'Adapt to theme' });
  await expect(adaptToTheme).toHaveAttribute('aria-checked', 'false');
  await adaptToTheme.click();
  await expect(body).toHaveClass(/pdf-adapt-theme/);
  await expect.poll(() => canvas.evaluate(element => getComputedStyle(element).filter)).not.toBe('none');
  await expect.poll(() => thumbnail.evaluate(element => getComputedStyle(element).filter)).not.toBe('none');

  await page.getByRole('button', { name: 'Display options' }).click();
  await page.getByRole('menuitem', { name: 'Defaults' }).click();
  await expect(body).not.toHaveClass(/pdf-adapt-theme/);
  await expect.poll(() => canvas.evaluate(element => getComputedStyle(element).filter)).toBe('none');
  await expect.poll(() => thumbnail.evaluate(element => getComputedStyle(element).filter)).toBe('none');
});

test('pdf viewer production surface exposes only live selection actions and keeps Ask PDF dormant', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?host=cursor');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('.text-layer span[data-item-index="0"]')).toBeVisible();

  await page.evaluate(() => {
    const span = document.querySelector<HTMLElement>('.text-layer span[data-item-index="0"]');
    const quote = 'FlashAttention uses tiling';
    const offset = span?.textContent?.indexOf(quote) ?? -1;
    const text = span?.querySelector('.pdf-text-glyphs')?.firstChild;
    if (!text || offset < 0) throw new Error('Expected selectable PDF text');
    const range = document.createRange();
    range.setStart(text, offset);
    range.setEnd(text, offset + quote.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.querySelector('#page-container')?.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
    }));
  });

  await expect(page.locator('#selection-toolbar button')).toHaveText([
    'Copy Link',
    /Add to Chat/,
  ]);
  for (const label of [
    'Ask about selection…',
    'Insert Link',
    'Copy Quote and Link',
    'Insert Quote and Link',
    'More',
  ]) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: 'Copy link format' })).toHaveCount(0);

  const rectangle = page.getByRole('button', { name: 'Copy embed link to rectangular selection' });
  await expect(rectangle).toBeVisible();

  await page.evaluate(() => window.postMessage({
    type: 'pdfDiscussionSnapshot',
    annotations: [],
    consentGranted: true,
  }, '*'));
  await expect(page.locator('.ask-pdf-panel, .pdf-discussion-marker')).toHaveCount(0);

  await page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) throw new Error('Expected an active PDF selection');
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const clientX = Math.round(rect.left + rect.width / 2);
    const clientY = Math.round(rect.top + rect.height / 2);
    const target = document.elementFromPoint(clientX, clientY);
    if (!target) throw new Error('Expected a hit-test target inside the PDF selection');
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
    }));
  });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  expect(await menu.getByRole('menuitem').allTextContents()).toEqual([
    'Look up ...',
    expect.stringMatching(/Add to Chat/),
    'Copy link to selection',
    'Copy selected text',
  ]);
});

test('stock VS Code shows only installed provider actions', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?host=vscode&agents=codex,claude');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  await selectPdfTextRange(page, 0, 26);
  await expect(page.locator('#selection-toolbar button')).toHaveText([
    'Copy Link',
    'Send to Codex',
    'Send to Claude Code',
  ]);
  await expect(page.getByText('Add to Chat', { exact: true })).toHaveCount(0);

  await openPdfSelectionContextMenu(page);
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
    'Look up ...',
    'Send to Codex',
    'Send to Claude Code',
    'Copy link to selection',
    'Copy selected text',
  ]);
});

test('Cursor keeps Add to Chat and installed provider actions', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?host=cursor&agents=codex,claude,codebuddy');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  await selectPdfTextRange(page, 0, 26);
  await expect(page.locator('#selection-toolbar button')).toHaveText([
    'Copy Link',
    /Add to Chat/,
    'Send to Codex',
    'Send to Claude Code',
    'Send to CodeBuddy',
  ]);
});

test('explicit provider action posts its ID and crop', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?host=vscode&agents=codex');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  await selectPdfTextRange(page, 0, 26);
  await page.getByRole('button', { name: 'Send to Codex', exact: true }).click();
  expect(await waitForSelectionAction(page, 'sendToAgent')).toMatchObject({
    action: 'sendToAgent',
    agentId: 'codex',
    snapshotPngBase64: expect.any(String),
  });
});

test('stock VS Code honors provider capture requests but ignores direct Cursor requests', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?host=vscode&agents=codex');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  await selectPdfTextRange(page, 0, 26);
  await page.evaluate(() => {
    window.__mockMessages = [];
    window.postMessage({
      type: 'captureSelectionForAgent',
      requestId: 'provider-capture-1',
    }, '*');
  });
  expect(await waitForSelectionAction(page, 'addToCursorChat')).toMatchObject({
    action: 'addToCursorChat',
    requestId: 'provider-capture-1',
    snapshotPngBase64: expect.any(String),
  });

  await page.evaluate(() => window.postMessage({ type: 'addSelectionToCursorChat' }, '*'));
  await page.waitForTimeout(50);
  await expect.poll(() => page.evaluate(() =>
    window.__mockMessages?.filter(message =>
      message.type === 'selectionAction' && message.action === 'addToCursorChat'
    ).length
  )).toBe(1);
});

test('capability message validates and updates provider actions in an open viewer', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?host=vscode&agents=claude');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  await selectPdfTextRange(page, 0, 26);
  await expect(page.locator('#selection-toolbar button')).toHaveText([
    'Copy Link',
    'Send to Claude Code',
  ]);

  await page.evaluate(() => window.postMessage({
    type: 'agentHandoffCapabilities',
    cursorAgent: true,
    providers: [
      { id: 'codebuddy', label: 'Spoofed CodeBuddy' },
      { id: 'codex', label: 'Spoofed Codex' },
      { id: 'codex', label: 'Duplicate Codex' },
      { id: 'unknown', label: 'Unknown' },
      { id: 'claude', label: '' },
    ],
  }, '*'));
  await expect(page.locator('#selection-toolbar button')).toHaveText([
    'Copy Link',
    /Add to Chat/,
    'Send to Codex',
    'Send to CodeBuddy',
  ]);

  await openPdfSelectionContextMenu(page);
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
    'Look up ...',
    /Add to Chat/,
    'Send to Codex',
    'Send to CodeBuddy',
    'Copy link to selection',
    'Copy selected text',
  ]);
});

test('expanded provider toolbar stays contained in a narrow pane', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('http://localhost:8979/pdf-viewer.html?host=cursor&agents=codex,claude,codebuddy');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  await selectPdfTextRange(page, 0, 26);
  const toolbar = page.locator('#selection-toolbar');
  await expect(toolbar).toBeVisible();
  const toolbarBox = await toolbar.boundingBox();
  expect(toolbarBox).not.toBeNull();
  if (!toolbarBox) return;
  expect(toolbarBox.x).toBeGreaterThanOrEqual(12);
  expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(308);
  for (const button of await toolbar.getByRole('button').all()) {
    await expect(button).toBeVisible();
  }
});

test('pdf viewer rectangular selection copies PDF++ coordinates in a one-shot drag', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  const rectangle = page.getByRole('button', { name: 'Copy embed link to rectangular selection' });
  await rectangle.click();
  await expect(rectangle).toHaveAttribute('aria-pressed', 'true');

  const wrapper = page.locator('#page-1');
  const box = await wrapper.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const start = { x: box.x + 54, y: box.y + 68 };
  const end = { x: box.x + 216, y: box.y + 176 };
  const scale = Number(await page.getByRole('spinbutton', { name: 'Zoom' }).inputValue()) / 100;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await expect(page.locator('.rectangle-selection-overlay')).toBeVisible();
  await page.mouse.up();

  const actions = await page.evaluate(() =>
    window.__mockMessages?.filter(message => message.type === 'selectionAction' && message.action === 'copyRectEmbed')
  );
  expect(actions).toHaveLength(1);
  expect(actions[0].anchor.page).toBe(1);
  expect(actions[0].anchor.rects).toHaveLength(1);
  const rect = actions[0].anchor.rects[0];
  expect(rect).toHaveLength(4);
  expect(Math.abs(rect[0] - 54 / scale)).toBeLessThanOrEqual(2);
  expect(Math.abs(rect[1] - 68 / scale)).toBeLessThanOrEqual(2);
  expect(Math.abs(rect[2] - 216 / scale)).toBeLessThanOrEqual(2);
  expect(Math.abs(rect[3] - 176 / scale)).toBeLessThanOrEqual(2);
  await expect(rectangle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.rectangle-selection-overlay')).toHaveCount(0);
});

test('pdf viewer search bar finds text and uses compact VS Code find-widget layout', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=two-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  const searchPanel = page.locator('#pdf-search');
  await expect(searchPanel).toBeVisible();
  await expect(page.getByRole('button', { name: 'Match case' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search settings' })).toBeVisible();

  await page.locator('#pdf-search-input').fill('Page Two');
  await expect(page.locator('.pdf-search-match')).toHaveCount(1);
  await expect(page.locator('.pdf-search-match.selected')).toHaveCount(1);
  await expect(page.locator('#pdf-search-count')).toHaveText('1 of 1');
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

  await page.getByRole('button', { name: 'Match case' }).click();
  await expect(page.getByRole('button', { name: 'Match case' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#pdf-search-input').fill('page two');
  await expect(page.locator('#pdf-search-count')).toHaveText('No results');
  await page.locator('#pdf-search-input').fill('Page Two');
  await expect(page.locator('#pdf-search-count')).toHaveText('1 of 1');
});

test('pdf search publishes a cached current-page match before indexing a large document', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=ddia-local');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 613/, { timeout: 15_000 });

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  const input = page.locator('#pdf-search-input');
  const immediateCount = await input.evaluate((element: HTMLInputElement) => {
    element.value = 'a';
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'a' }));
    return document.querySelector('#pdf-search-count')?.textContent ?? '';
  });

  expect(immediateCount).toBe('Searching…');
  await expect(input).toHaveValue('a');
  await expect(page.locator('#pdf-search-count')).toHaveText(
    /^\d+ of \d+(?: · Searching…)?$/,
    { timeout: 500 },
  );
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

  await expect(page.locator('#pdf-search-count')).toHaveText('1 of 1');
  await expect(page.locator('.pdf-search-match.selected')).toHaveCount(2);
});

test('pdf viewer fuzzes controls, search, and view modes without stale state', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=two-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });
  await expectPdfViewerStable(page, errors, 'initial two-page fixture', 2);

  for (const operation of [
    { label: 'zoom in once', run: () => page.locator('#zoom-in').click() },
    { label: 'zoom in twice', run: () => page.locator('#zoom-in').click() },
    { label: 'zoom out', run: () => page.locator('#zoom-out').click() },
    {
      label: 'fit width',
      run: async () => {
        await page.getByRole('button', { name: 'Display options' }).click();
        await page.getByRole('menuitemradio', { name: 'Fit width' }).click();
      },
    },
  ]) {
    await operation.run();
    await expectPdfViewerStable(page, errors, operation.label, 2);
  }

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  await expect(page.locator('#pdf-search')).toBeVisible();
  await expectPdfViewerStable(page, errors, 'open search with keyboard shortcut', 2);

  await page.locator('#pdf-search-input').pressSequentially('Page');
  await expect(page.locator('#pdf-search-count')).toHaveText('1 of 2');
  await expect(page.locator('.pdf-search-match')).toHaveCount(1);
  await expectPdfViewerStable(page, errors, 'search broad query', 2);

  await page.locator('#pdf-search-input').press('Enter');
  await expect(page.locator('#pdf-search-count')).toHaveText('2 of 2');
  await expectPdfViewerStable(page, errors, 'search next via Enter', 2);

  await page.locator('#pdf-search-input').press('Shift+Enter');
  await expect(page.locator('#pdf-search-count')).toHaveText('1 of 2');
  await expectPdfViewerStable(page, errors, 'search previous via Shift+Enter', 2);

  await page.locator('#pdf-search-input').fill('not present in fixture');
  await expect(page.locator('#pdf-search-count')).toHaveText('No results');
  await expect(page.locator('.pdf-search-match')).toHaveCount(0);
  await expectPdfViewerStable(page, errors, 'search no results', 2);

  await page.locator('#pdf-search-input').fill('Page Two');
  await expect(page.locator('#pdf-search-count')).toHaveText('1 of 1');
  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 2/);
  await expectPdfViewerStable(page, errors, 'search exact page two query', 2);

  await page.locator('#pdf-search-close').click();
  await expect(page.locator('#pdf-search')).toBeHidden();
  await expect(page.locator('.pdf-search-match')).toHaveCount(0);
  await expectPdfViewerStable(page, errors, 'close search clears highlights', 2);

  for (const operation of [
    { label: 'switch to paginated mode', run: () => chooseDisplayMode(page, 'Single Page') },
    { label: 'navigate previous in paginated mode', run: () => page.locator('#prev').click() },
    { label: 'switch to two-page spread', run: () => chooseDisplayMode(page, 'Two Pages') },
    { label: 'navigate next in spread mode', run: () => page.locator('#next').click() },
    { label: 'return to continuous spread mode', run: () => chooseDisplayMode(page, 'Two Pages Continuous') },
    { label: 'return to one-page continuous mode', run: () => chooseDisplayMode(page, 'Single Page Continuous') },
  ]) {
    await operation.run();
    await expectPdfViewerStable(page, errors, operation.label, 2);
  }

});

test('pdf search settings match PDF++ highlight, diacritic, and whole-word behavior', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=two-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');

  const settingsButton = page.getByRole('button', { name: 'Search settings' });
  await settingsButton.click();
  const settings = page.getByRole('menu', { name: 'Search settings' });
  await expect(settings).toBeVisible();
  for (const label of ['Highlight all', 'Match diacritics', 'Whole words']) {
    await expect(settings.getByRole('checkbox', { name: label })).not.toBeChecked();
  }

  const input = page.locator('#pdf-search-input');
  await input.fill('Page');
  await expect(page.locator('#pdf-search-count')).toHaveText('1 of 2');
  await expect(page.locator('.pdf-search-match')).toHaveCount(1);
  await settings.getByRole('checkbox', { name: 'Highlight all' }).check();
  await expect(page.locator('.pdf-search-match')).toHaveCount(2);

  await settings.getByRole('checkbox', { name: 'Whole words' }).check();
  await input.fill('Pag');
  await expect(page.locator('#pdf-search-count')).toHaveText('No results');
  await settings.getByRole('checkbox', { name: 'Whole words' }).uncheck();
  await expect(page.locator('#pdf-search-count')).toHaveText('1 of 2');

  await input.fill('Páge');
  await expect(page.locator('#pdf-search-count')).toHaveText('1 of 2');
  await settings.getByRole('checkbox', { name: 'Match diacritics' }).check();
  await expect(page.locator('#pdf-search-count')).toHaveText('No results');
  await input.fill('Page');
  await expect(page.locator('#pdf-search-count')).toHaveText('1 of 2');

  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(page.locator('#pdf-search')).toBeVisible();
});

test('pdf goToAnchor resolves a contextual range text fragment on the requested page', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  const expected = await page.locator('#page-1 .text-layer span[data-item-index="0"]').evaluate((span: HTMLElement) => {
    const content = span.textContent ?? '';
    const from = content.indexOf('Attention');
    const endTerm = 'tiling';
    const to = content.indexOf(endTerm, from) + endTerm.length;
    if (from < 0 || to < endTerm.length) throw new Error('Expected FlashAttention fixture text was not rendered');
    const itemLeft = Number.parseFloat(span.style.left);
    const itemWidth = Number.parseFloat(span.style.width);
    const perCharacter = itemWidth / content.length;
    return {
      left: itemLeft + perCharacter * from,
      width: perCharacter * (to - from),
    };
  });

  await page.evaluate(() => {
    window.postMessage({
      type: 'goToAnchor',
      page: 1,
      textFragment: {
        textStart: 'ATTENTION',
        textEnd: 'TILING',
        prefix: 'Flash',
        suffix: 'to reduce',
      },
    }, '*');
  });

  const highlights = page.locator('#page-1 .anchor-highlight');
  await expect(highlights).toHaveCount(1);
  const actual = await highlights.first().evaluate((element: HTMLElement) => ({
    left: Number.parseFloat(element.style.left),
    width: Number.parseFloat(element.style.width),
  }));
  expect(Math.abs(actual.left - expected.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.width - expected.width)).toBeLessThanOrEqual(1);
});

test('pdf text-fragment suffix can select a later repeated textEnd', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  const expectedRight = await page.locator('#page-1 .text-layer span[data-item-index]').evaluateAll((spans: HTMLElement[]) => {
    const span = spans.find(candidate => candidate.textContent?.includes('standard attention with exact'));
    if (!span) throw new Error('Expected repeated attention fixture text was not rendered');
    const content = span.textContent ?? '';
    const from = content.indexOf('attention');
    const to = from + 'attention'.length;
    const itemLeft = Number.parseFloat(span.style.left);
    const itemWidth = Number.parseFloat(span.style.width);
    return itemLeft + (itemWidth / content.length) * to;
  });

  await page.evaluate(() => {
    window.postMessage({
      type: 'goToAnchor',
      page: 1,
      textFragment: {
        textStart: 'FlashAttention uses tiling',
        textEnd: 'attention',
        suffix: 'with exact results.',
      },
    }, '*');
  });

  const highlights = page.locator('#page-1 .anchor-highlight');
  await expect.poll(() => highlights.count(), { timeout: 2_000 }).toBeGreaterThan(0);
  const actualRight = await highlights.last().evaluate((element: HTMLElement) =>
    Number.parseFloat(element.style.left) + Number.parseFloat(element.style.width)
  );
  expect(Math.abs(actualRight - expectedRight)).toBeLessThanOrEqual(1);
});

test('pdf goToAnchor scopes text-fragment matching to the requested page', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=two-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });

  await page.evaluate(() => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    (window as unknown as { __hlAnchorScrollBehavior?: ScrollBehavior })
      .__hlAnchorScrollBehavior = undefined;
    Element.prototype.scrollIntoView = function scrollIntoView(options?: boolean | ScrollIntoViewOptions) {
      if (this.classList.contains('anchor-highlight') && typeof options === 'object') {
        (window as unknown as { __hlAnchorScrollBehavior?: ScrollBehavior })
          .__hlAnchorScrollBehavior = options.behavior;
      }
      return originalScrollIntoView.call(this, options);
    };
    window.postMessage({
      type: 'goToAnchor',
      page: 2,
      textFragment: { textStart: 'page' },
    }, '*');
  });

  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 2/);
  await expect(page.locator('#page-1 .anchor-highlight')).toHaveCount(0);
  await expect(page.locator('#page-2 .anchor-highlight')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __hlAnchorScrollBehavior?: ScrollBehavior })
      .__hlAnchorScrollBehavior
  )).toBe('auto');
});

test('pdf goToAnchor keeps its requested page through stale intersection updates', async ({ page }) => {
  await installIntersectionObserverHarness(page);
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=four-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 4/, { timeout: 10_000 });

  const zoomInput = page.getByRole('spinbutton', { name: 'Zoom' });
  await zoomInput.fill('64');
  await zoomInput.press('Enter');
  await expect(zoomInput).toHaveValue('64');

  const pageInput = page.locator('#page-input');
  await pageInput.fill('3');
  await pageInput.press('Enter');
  await expect(page.locator('#page-info')).toHaveText(/Page 3 \/ 4/);
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));

  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'goToAnchor',
        page: 4,
        textFragment: { textStart: 'Page Four' },
      },
    }));
    // This represents the observer batch that was computed for the old
    // viewport while the target page is still rendering.
    (window as any).__emitPdfPageIntersections([
      [3, 0.9],
      [4, 0.4],
    ]);
  });

  await expect(page.locator('#page-4 .anchor-highlight')).toHaveCount(1);
  await expect(page.locator('#page-info')).toHaveText(/Page 4 \/ 4/);
  await expect(page.locator('#page-input')).toHaveValue('4');

  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await page.evaluate(() => {
    (window as any).__emitPdfPageIntersections([
      [3, 0.7],
      [4, 0.7],
    ]);
  });
  await expect(page.locator('#page-info')).toHaveText(/Page 4 \/ 4/);
});

test('pdf goToAnchor still changes page when its text fragment misses', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=two-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });

  await page.evaluate(() => {
    window.postMessage({
      type: 'goToAnchor',
      page: 2,
      textFragment: { textStart: 'text that is not on this page' },
    }, '*');
  });

  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 2/);
  await expect(page.locator('.anchor-highlight')).toHaveCount(0);
});

test('pdf text-fragment review page-only navigation does not flash the first text item', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=two-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });

  await page.evaluate(() => {
    window.postMessage({ type: 'goToAnchor', page: 2 }, '*');
  });

  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 2/);
  expect(await page.locator('.anchor-highlight').count()).toBe(0);
});

test('pdf text-fragment review miss clears an existing transient highlight', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=two-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });

  await page.evaluate(() => {
    window.postMessage({ type: 'goToAnchor', page: 2, textFragment: { textStart: 'page' } }, '*');
  });
  await expect(page.locator('#page-2 .anchor-highlight')).toHaveCount(1);

  await page.evaluate(() => {
    window.postMessage({ type: 'goToAnchor', page: 2, textFragment: { textStart: 'missing selector' } }, '*');
  });
  await expect.poll(() => page.locator('.anchor-highlight').count(), { timeout: 1_000 }).toBe(0);
});

test('pdf text-fragment review folds Greek sigma consistently', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=unicode-selector');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  const span = page.locator('#page-1 .text-layer span[data-item-index]').first();
  await expect(span).toHaveText('ΟΣ İX');
  const expected = await span.evaluate((element: HTMLElement) => ({
    left: Number.parseFloat(element.style.left),
    width: Number.parseFloat(element.style.width) * 2 / (element.textContent?.length ?? 1),
  }));

  await page.evaluate(() => {
    window.postMessage({ type: 'goToAnchor', page: 1, textFragment: { textStart: 'ος' } }, '*');
  });

  const highlight = page.locator('#page-1 .anchor-highlight');
  await expect.poll(() => highlight.count(), { timeout: 2_000 }).toBe(1);
  const actual = await highlight.evaluate((element: HTMLElement) => ({
    left: Number.parseFloat(element.style.left),
    width: Number.parseFloat(element.style.width),
  }));
  expect(Math.abs(actual.left - expected.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.width - expected.width)).toBeLessThanOrEqual(1);
});

test('pdf text-fragment review maps expanded İ folding to one exact source glyph', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=unicode-selector');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  const span = page.locator('#page-1 .text-layer span[data-item-index]').first();
  await expect(span).toHaveText('ΟΣ İX');
  const expected = await span.evaluate((element: HTMLElement) => {
    const content = element.textContent ?? '';
    const itemLeft = Number.parseFloat(element.style.left);
    const perCharacter = Number.parseFloat(element.style.width) / content.length;
    return { left: itemLeft + perCharacter * content.indexOf('İ'), width: perCharacter };
  });

  await page.evaluate(() => {
    window.postMessage({ type: 'goToAnchor', page: 1, textFragment: { textStart: 'İ' } }, '*');
  });

  const highlight = page.locator('#page-1 .anchor-highlight');
  await expect.poll(() => highlight.count(), { timeout: 2_000 }).toBe(1);
  const actual = await highlight.evaluate((element: HTMLElement) => ({
    left: Number.parseFloat(element.style.left),
    width: Number.parseFloat(element.style.width),
  }));
  expect(Math.abs(actual.left - expected.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.width - expected.width)).toBeLessThanOrEqual(1);
});

test('pdf text-fragment review round-trips a multi-item selection across a visual word gap', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=selector-edge');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  await page.evaluate(() => {
    window.__mockMessages = [];
    const spans = Array.from(document.querySelectorAll<HTMLElement>('#page-1 .text-layer span[data-item-index]'));
    const start = spans.find(span => span.textContent?.startsWith('Page'));
    const end = spans.find(span => span.textContent?.startsWith('Two'));
    const startText = start?.querySelector('.pdf-text-glyphs')?.firstChild;
    const endText = end?.querySelector('.pdf-text-glyphs')?.firstChild;
    if (!startText || !endText) {
      throw new Error(`Expected separated Page/Two text items: ${JSON.stringify(spans.map(span => span.textContent))}`);
    }
    const range = document.createRange();
    range.setStart(startText, 0);
    range.setEnd(endText, 'Two'.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.querySelector('#page-container')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  });

  await expect(page.locator('#selection-toolbar')).toBeVisible();
  const fragment = await page.evaluate(() => window.__mockMessages
    ?.filter(message => message.type === 'selectionChanged' && message.anchor)
    .at(-1)?.anchor?.textFragment);
  expect(fragment).toEqual({
    textStart: 'Page Two',
    suffix: 'Flash Attention aaaaa tail start',
  });
  await page.evaluate((textFragment) => {
    window.getSelection()?.removeAllRanges();
    window.postMessage({ type: 'goToAnchor', page: 1, textFragment }, '*');
  }, fragment);
  await expect.poll(() => page.locator('#page-1 .anchor-highlight').count(), { timeout: 2_000 }).toBe(2);
});

test('pdf text-fragment review round-trips a word split across adjacent text items', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=selector-edge');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  await page.evaluate(() => {
    window.__mockMessages = [];
    const spans = Array.from(document.querySelectorAll<HTMLElement>('#page-1 .text-layer span[data-item-index]'));
    const start = spans.find(span => span.textContent === 'Flash');
    const end = spans.find(span => span.textContent === 'Attention');
    const startText = start?.querySelector('.pdf-text-glyphs')?.firstChild;
    const endText = end?.querySelector('.pdf-text-glyphs')?.firstChild;
    if (!startText || !endText) {
      throw new Error(`Expected split Flash/Attention text items: ${JSON.stringify(spans.map(span => span.textContent))}`);
    }
    const range = document.createRange();
    range.setStart(startText, 0);
    range.setEnd(endText, end?.textContent?.length ?? 0);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.querySelector('#page-container')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  });

  await expect(page.locator('#selection-toolbar')).toBeVisible();
  const fragment = await page.evaluate(() => window.__mockMessages
    ?.filter(message => message.type === 'selectionChanged' && message.anchor)
    .at(-1)?.anchor?.textFragment);
  expect(fragment).toEqual({
    textStart: 'FlashAttention',
    prefix: 'Page Two',
    suffix: 'aaaaa tailstart aaaa tail',
  });
  await page.evaluate((textFragment) => {
    window.getSelection()?.removeAllRanges();
    window.postMessage({ type: 'goToAnchor', page: 1, textFragment }, '*');
  }, fragment);
  await expect.poll(() => page.locator('#page-1 .anchor-highlight').count(), { timeout: 2_000 }).toBe(2);
});

test('pdf native selection reconstructs canonical text when the DOM selection is duplicated', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=selector-edge');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('#page-1 .text-layer span[data-item-index]')).toHaveCount(6);

  await page.evaluate(() => {
    window.__mockMessages = [];
    const spans = Array.from(document.querySelectorAll<HTMLElement>('#page-1 .text-layer span[data-item-index]'));
    const start = spans.find(span => span.textContent?.startsWith('Page'));
    const end = spans.find(span => span.textContent?.startsWith('Two'));
    const startText = start?.querySelector('.pdf-text-glyphs')?.firstChild;
    const endText = end?.querySelector('.pdf-text-glyphs')?.firstChild;
    if (!startText || !endText) throw new Error('Expected separated Page/Two text items');
    const range = document.createRange();
    range.setStart(startText, 0);
    range.setEnd(endText, 'Two'.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const selectionPrototype = Object.getPrototypeOf(selection) as Selection;
    Object.defineProperty(selectionPrototype, 'toString', {
      configurable: true,
      value: () => 'PageTwoPageTwo',
    });
    document.querySelector('#page-container')?.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: 0,
    }));
  });

  await expect(page.locator('#selection-toolbar')).toBeVisible();
  const anchor = await page.evaluate(() => window.__mockMessages
    ?.filter(message => message.type === 'selectionChanged' && message.anchor)
    .at(-1)?.anchor);
  expect(anchor).toMatchObject({
    snippet: 'Page Two',
    textFragment: { textStart: 'Page Two' },
  });

  await page.evaluate((textFragment) => {
    window.getSelection()?.removeAllRanges();
    window.postMessage({ type: 'goToAnchor', page: 1, textFragment }, '*');
  }, anchor.textFragment);
  await expect.poll(() => page.locator('#page-1 .anchor-highlight').count(), { timeout: 2_000 }).toBe(2);
});

test('pdf text layer cleans glyph artifacts and follows visual reading order', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=out-of-order-text');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  const spans = page.locator('#page-1 .text-layer span[data-item-index]');
  await expect(spans).toHaveCount(5);
  const textItems = await spans.evaluateAll(elements => elements.map(element => element.textContent ?? ''));
  expect(textItems).toEqual([
    'First line starts the paragraph.',
    'Second line continues in visual order.',
    'Third line remains part of selection.',
    'Fourth line should not jump ahead.',
    'Fifth line ends the paragraph.',
  ]);
  expect(textItems.join('')).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);

  await page.evaluate(() => {
    window.__mockMessages = [];
    const items = Array.from(document.querySelectorAll<HTMLElement>('#page-1 .text-layer span[data-item-index]'));
    const start = items[0]?.querySelector('.pdf-text-glyphs')?.firstChild;
    const endSpan = items.at(-1);
    const end = endSpan?.querySelector('.pdf-text-glyphs')?.firstChild;
    if (!start || !end || !endSpan) throw new Error('Expected five ordered PDF text items');
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, endSpan.textContent?.length ?? 0);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.querySelector('#page-container')?.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      button: 0,
    }));
  });

  await expect(page.locator('#selection-toolbar')).toBeVisible();
  const expected = [
    'First line starts the paragraph.',
    'Second line continues in visual order.',
    'Third line remains part of selection.',
    'Fourth line should not jump ahead.',
    'Fifth line ends the paragraph.',
  ].join(' ');
  const anchor = await page.evaluate(() => window.__mockMessages
    ?.filter(message => message.type === 'selectionChanged' && message.anchor)
    .at(-1)?.anchor);
  expect(anchor?.snippet).toBe(expected);

  const copiedText = await page.evaluate(() => {
    const transfer = new DataTransfer();
    const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: transfer });
    document.querySelector('#page-container')?.dispatchEvent(event);
    return transfer.getData('text/plain');
  });
  expect(copiedText).toBe(expected);
});

test('pdf body selection skips a vertically overlapping margin-caption lane', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=body-caption-selection');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  const spans = page.locator('#page-1 .text-layer span[data-item-index]');
  await expect(spans).toHaveCount(6);
  await expect.poll(() => spans.evaluateAll(elements => elements.map(element => (element.textContent ?? '').trim())))
    .toEqual([
      'Body paragraph starts in the main column.',
      'Its second line stays in that reading lane.',
      'The third body line follows beside the caption.',
      'The body paragraph ends here.',
      'Figure side caption.',
      'Do not select this.',
    ]);

  const boxes = await spans.evaluateAll(elements => elements.slice(0, 4).map(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  const first = boxes[0];
  const last = boxes[3];
  if (!first || !last) throw new Error('Expected four body text items');

  await page.evaluate(() => {
    window.__mockMessages = [];
  });
  await page.mouse.move(first.x + 1, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 1, last.y + last.height / 2, { steps: 24 });
  await page.mouse.up();

  const expected = [
    'Body paragraph starts in the main column.',
    'Its second line stays in that reading lane.',
    'The third body line follows beside the caption.',
    'The body paragraph ends here.',
  ].join(' ');
  await expect.poll(() => page.evaluate(() => window.__mockMessages
    ?.filter(message => message.type === 'selectionChanged' && message.anchor)
    .at(-1)?.anchor?.snippet)).toBe(expected);
  const nativeText = await page.evaluate(() => window.getSelection()?.toString().replace(/\s+/gu, ' ').trim());
  expect(nativeText).toBe(expected);
  expect(nativeText).not.toContain('Figure side caption');
});

test('pdf text selection keeps its focus at the nearest line edge while dragging into trailing whitespace', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=out-of-order-text');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  const spans = page.locator('#page-1 .text-layer span[data-item-index]');
  await expect(spans).toHaveCount(5);
  const boxes = await spans.evaluateAll(elements => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  const first = boxes[0];
  const fourth = boxes[3];
  if (!first || !fourth) throw new Error('Expected ordered PDF line boxes');

  await page.evaluate(() => { window.__mockMessages = []; });
  await page.mouse.move(first.x + 1, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(fourth.x + fourth.width - 1, fourth.y + fourth.height / 2, { steps: 12 });
  await page.mouse.move(fourth.x + fourth.width + 8, fourth.y + fourth.height / 2, { steps: 2 });
  await page.mouse.up();

  const expected = [
    'First line starts the paragraph.',
    'Second line continues in visual order.',
    'Third line remains part of selection.',
    'Fourth line should not jump ahead.',
  ].join(' ');
  await expect.poll(() => page.evaluate(() => window.__mockMessages
    ?.filter(message => message.type === 'selectionChanged' && message.anchor)
    .at(-1)?.anchor?.snippet)).toBe(expected);
  const anchor = await page.evaluate(() => window.__mockMessages
    ?.filter(message => message.type === 'selectionChanged' && message.anchor)
    .at(-1)?.anchor);
  expect(anchor).toMatchObject({
    page: 1,
    textItemIndex: 0,
    charOffset: 0,
    endTextItemIndex: 3,
    endCharOffset: 34,
    snippet: expected,
  });
  await expect(page.locator('#selection-toolbar')).toBeVisible();
});

test('pdf text selection stays on its visual line through long trailing whitespace', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=out-of-order-text');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  const spans = page.locator('#page-1 .text-layer span[data-item-index]');
  await expect(spans).toHaveCount(5);
  const first = await spans.first().boundingBox();
  const pageBox = await page.locator('#page-1').boundingBox();
  if (!first || !pageBox) throw new Error('Expected the first PDF line and page bounds');
  const trailingWhitespaceX = pageBox.x + pageBox.width - 16;
  expect(trailingWhitespaceX).toBeGreaterThan(first.x + first.width + 100);

  await page.evaluate(() => { window.__mockMessages = []; });
  await page.mouse.move(first.x + 1, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(trailingWhitespaceX, first.y + first.height / 2, { steps: 12 });
  await page.mouse.up();

  const expected = 'First line starts the paragraph.';
  await expect.poll(() => page.evaluate(() => window.__mockMessages
    ?.filter(message => message.type === 'selectionChanged' && message.anchor)
    .at(-1)?.anchor?.snippet)).toBe(expected);
  const anchor = await page.evaluate(() => window.__mockMessages
    ?.filter(message => message.type === 'selectionChanged' && message.anchor)
    .at(-1)?.anchor);
  expect(anchor).toMatchObject({
    page: 1,
    textItemIndex: 0,
    charOffset: 0,
    endTextItemIndex: 0,
    endCharOffset: 32,
    snippet: expected,
  });
  await expect(page.locator('#selection-toolbar')).toBeVisible();
});

test('pdf text selection keeps its anchor at the nearest line edge during a backward whitespace drag', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=out-of-order-text');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  const spans = page.locator('#page-1 .text-layer span[data-item-index]');
  await expect(spans).toHaveCount(5);
  const boxes = await spans.evaluateAll(elements => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  const first = boxes[0];
  const fourth = boxes[3];
  if (!first || !fourth) throw new Error('Expected ordered PDF line boxes');

  await page.evaluate(() => { window.__mockMessages = []; });
  await page.mouse.move(fourth.x + fourth.width - 1, fourth.y + fourth.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + 1, first.y + first.height / 2, { steps: 12 });
  await page.mouse.move(first.x - 8, first.y + first.height / 2, { steps: 2 });
  await page.mouse.up();

  const expected = [
    'First line starts the paragraph.',
    'Second line continues in visual order.',
    'Third line remains part of selection.',
    'Fourth line should not jump ahead.',
  ].join(' ');
  await expect.poll(() => page.evaluate(() => window.__mockMessages
    ?.filter(message => message.type === 'selectionChanged' && message.anchor)
    .at(-1)?.anchor?.snippet)).toBe(expected);
  const anchor = await page.evaluate(() => window.__mockMessages
    ?.filter(message => message.type === 'selectionChanged' && message.anchor)
    .at(-1)?.anchor);
  expect(anchor).toMatchObject({
    page: 1,
    textItemIndex: 0,
    charOffset: 0,
    endTextItemIndex: 3,
    endCharOffset: 34,
    snippet: expected,
  });
  await expect(page.locator('#selection-toolbar')).toBeVisible();
});

test('pdf glyph selection survives zoom rerender with the same canonical text and aligned overlay', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=out-of-order-text');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  const spans = page.locator('#page-1 .text-layer span[data-item-index]');
  const boxes = await spans.evaluateAll(elements => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  const first = boxes[0];
  const fourth = boxes[3];
  if (!first || !fourth) throw new Error('Expected ordered PDF line boxes');

  await page.mouse.move(first.x + 1, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(fourth.x + fourth.width + 8, fourth.y + fourth.height / 2, { steps: 12 });
  await page.mouse.up();

  const expected = [
    'First line starts the paragraph.',
    'Second line continues in visual order.',
    'Third line remains part of selection.',
    'Fourth line should not jump ahead.',
  ].join(' ');
  await expect.poll(() => page.evaluate(() => window.__mockMessages
    ?.filter(message => message.type === 'selectionChanged' && message.anchor)
    .at(-1)?.anchor?.snippet)).toBe(expected);
  const overlay = page.locator('#page-1 .pdf-selection-rect').first();
  await expect(overlay).toBeVisible();
  const initialOverlay = await overlay.boundingBox();
  expect(initialOverlay).not.toBeNull();

  const firstTextSpan = spans.first();
  await firstTextSpan.evaluate(element => {
    element.dataset.preZoomTextLayer = 'true';
  });
  const zoom = page.getByRole('spinbutton', { name: 'Zoom' });
  const initialScale = Number(await zoom.inputValue()) / 100;
  await zoom.fill('200');
  await zoom.press('Enter');
  await expect(zoom).toHaveValue('200');
  await expect(firstTextSpan).not.toHaveAttribute('data-pre-zoom-text-layer', 'true');
  await expect(page.locator('#selection-toolbar')).toBeVisible();

  const copiedText = await page.evaluate(() => {
    const transfer = new DataTransfer();
    const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: transfer });
    document.querySelector('#page-container')?.dispatchEvent(event);
    return transfer.getData('text/plain');
  });
  expect(copiedText).toBe(expected);
  await expect(overlay).toBeVisible();
  const rerenderedOverlay = await overlay.boundingBox();
  expect(rerenderedOverlay).not.toBeNull();
  if (initialOverlay && rerenderedOverlay) {
    expect(Math.abs(rerenderedOverlay.width - initialOverlay.width * (2 / initialScale))).toBeLessThanOrEqual(2);
    expect(Math.abs(rerenderedOverlay.height - initialOverlay.height * (2 / initialScale))).toBeLessThanOrEqual(2);
  }
});

test('pdf text-fragment review enumerates overlapping textStart candidates', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=selector-edge');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  const span = page.locator('#page-1 .text-layer span[data-item-index]').filter({ hasText: 'aaaaa tail' }).first();
  const expected = await span.evaluate((element: HTMLElement) => {
    const content = element.textContent ?? '';
    const perCharacter = Number.parseFloat(element.style.width) / content.length;
    return {
      left: Number.parseFloat(element.style.left) + perCharacter,
      width: perCharacter * 3,
    };
  });

  await page.evaluate(() => {
    window.postMessage({
      type: 'goToAnchor',
      page: 1,
      textFragment: { textStart: 'aaa', prefix: 'a', suffix: 'a tail' },
    }, '*');
  });

  const highlight = page.locator('#page-1 .anchor-highlight');
  await expect.poll(() => highlight.count(), { timeout: 2_000 }).toBe(1);
  const actual = await highlight.evaluate((element: HTMLElement) => ({
    left: Number.parseFloat(element.style.left),
    width: Number.parseFloat(element.style.width),
  }));
  expect(Math.abs(actual.left - expected.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.width - expected.width)).toBeLessThanOrEqual(1);
});

test('pdf text-fragment review enumerates overlapping textEnd candidates', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=selector-edge');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  const span = page.locator('#page-1 .text-layer span[data-item-index]').filter({ hasText: 'start aaaa tail' }).first();
  const expectedRight = await span.evaluate((element: HTMLElement) => {
    const content = element.textContent ?? '';
    return Number.parseFloat(element.style.left) + (Number.parseFloat(element.style.width) / content.length) * 9;
  });

  await page.evaluate(() => {
    window.postMessage({
      type: 'goToAnchor',
      page: 1,
      textFragment: { textStart: 'start', textEnd: 'aa', suffix: 'a tail' },
    }, '*');
  });

  const highlight = page.locator('#page-1 .anchor-highlight');
  await expect.poll(() => highlight.count(), { timeout: 2_000 }).toBe(1);
  const actualRight = await highlight.evaluate((element: HTMLElement) =>
    Number.parseFloat(element.style.left) + Number.parseFloat(element.style.width)
  );
  expect(Math.abs(actualRight - expectedRight)).toBeLessThanOrEqual(1);
});

test('pdf text-fragment review drops a partial leading word from 32-character prefix context', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  await page.evaluate(() => {
    window.__mockMessages = [];
    const span = document.querySelector<HTMLElement>('.text-layer span[data-item-index="0"]');
    const selectedText = 'HBM';
    const offset = span?.textContent?.indexOf(selectedText) ?? -1;
    const text = span?.querySelector('.pdf-text-glyphs')?.firstChild;
    if (!text || offset < 0) throw new Error('Expected HBM fixture text');
    const range = document.createRange();
    range.setStart(text, offset);
    range.setEnd(text, offset + selectedText.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.querySelector('#page-container')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  });

  await expect(page.locator('#selection-toolbar')).toBeVisible();
  const anchor = await page.evaluate(() => window.__mockMessages
    ?.filter(message => message.type === 'selectionChanged' && message.anchor)
    .at(-1)?.anchor);
  expect(anchor.prefix).toBe('uses tiling to reduce');
  expect(Array.from(anchor.prefix).length).toBeLessThanOrEqual(32);
});

test('pdf selection toolbar emits the portable copy-link action', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('.text-layer span[data-item-index="0"]')).toBeVisible();

  await page.evaluate(() => {
    const span = document.querySelector('.text-layer span[data-item-index="0"]');
    const quote = 'FlashAttention uses tiling';
    const offset = span.textContent.indexOf(quote);
    const text = span.querySelector('.pdf-text-glyphs')?.firstChild;
    if (!text) throw new Error('Expected selectable PDF text');
    const range = document.createRange();
    range.setStart(text, offset);
    range.setEnd(text, offset + quote.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    document.querySelector('#page-container').dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  });

  await expect(page.locator('#selection-toolbar')).toBeVisible();
  const selectionMessages = await page.evaluate(() =>
    window.__mockMessages?.filter((message) => message.type === 'selectionChanged')
  );
  expect(selectionMessages.length).toBeGreaterThanOrEqual(1);
  const latestSelectionMessage = selectionMessages.at(-1);
  expect(latestSelectionMessage.anchor.snippet).toBe('FlashAttention uses tiling');
  expect(latestSelectionMessage.anchor.page).toBe(1);

  await page.evaluate(() => {
    window.__mockMessages = [];
  });
  await page.locator('#selection-toolbar button', { hasText: 'Copy Link' }).click();

  const messages = await page.evaluate(() =>
    window.__mockMessages?.filter((message) => message.type === 'selectionAction')
  );
  expect(messages).toHaveLength(1);
  expect(messages[0].action).toBe('copyLink');
  expect(messages[0].anchor.snippet).toBe('FlashAttention uses tiling');
});

test('pdf native selection emits bounded word-safe text-fragment context', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('.text-layer span[data-item-index="0"]')).toBeVisible();

  await page.evaluate(() => {
    window.__mockMessages = [];
    const selectedText = 'uses';
    const span = Array.from(document.querySelectorAll<HTMLElement>('.text-layer span[data-item-index]'))
      .find(candidate => candidate.textContent?.includes(selectedText));
    const text = span?.querySelector('.pdf-text-glyphs')?.firstChild;
    if (!text) throw new Error('Expected HBM fixture text was not rendered');
    const offset = span.textContent?.indexOf(selectedText) ?? -1;
    const range = document.createRange();
    range.setStart(text, offset);
    range.setEnd(text, offset + selectedText.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.querySelector('#page-container')?.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: 0,
    }));
  });

  await expect(page.locator('#selection-toolbar')).toBeVisible();
  const anchor = await page.evaluate(() => window.__mockMessages
    ?.filter(message => message.type === 'selectionChanged' && message.anchor)
    .at(-1)?.anchor);
  expect(anchor).toMatchObject({
    snippet: 'uses',
    prefix: 'FlashAttention',
    suffix: 'tiling to reduce HBM accesses.',
    textFragment: {
      textStart: 'uses',
      prefix: 'FlashAttention',
      suffix: 'tiling to reduce HBM accesses.',
    },
  });
  expect(Array.from(anchor.prefix).length).toBeLessThanOrEqual(32);
  expect(Array.from(anchor.suffix).length).toBeLessThanOrEqual(32);
});

test('pdf viewer exposes a PDF++-style context menu for selections and pages', async ({ page }) => {
  const quote = 'FlashAttention uses tiling';
  await page.goto('http://localhost:8979/pdf-viewer.html?host=cursor');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('.text-layer span[data-item-index="0"]')).toBeVisible();

  await page.evaluate((selectedText) => {
    const span = document.querySelector('.text-layer span[data-item-index="0"]');
    const offset = span.textContent.indexOf(selectedText);
    const text = span.querySelector('.pdf-text-glyphs')?.firstChild;
    if (!text) throw new Error('Expected selectable PDF text');
    const range = document.createRange();
    range.setStart(text, offset);
    range.setEnd(text, offset + selectedText.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector('#page-container').dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
    }));
  }, quote);
  await expect(page.locator('#selection-toolbar')).toBeVisible();
  await page.evaluate(() => { window.__mockMessages = []; });

  const openSelectionMenu = async () => {
    await page.evaluate(() => {
      const selection = window.getSelection();
      if (!selection?.rangeCount) throw new Error('Expected an active PDF selection');
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const clientX = Math.round(rect.left + rect.width / 2);
      const clientY = Math.round(rect.top + rect.height / 2);
      const target = document.elementFromPoint(clientX, clientY);
      if (!target) throw new Error('Expected a hit-test target inside the PDF selection');
      target.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
      }));
    });
    await expect(page.getByRole('menu')).toBeVisible();
  };

  await openSelectionMenu();
  await expect(page.locator('#selection-toolbar')).toHaveCount(0);
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
    'Look up ...',
    /(?:⌘L|Ctrl\+L)  Add to Chat/,
    'Copy link to selection',
    'Copy selected text',
  ]);
  await page.getByRole('menuitem', { name: 'Look up ...', exact: true }).click();
  await expect.poll(() => page.evaluate(() =>
    window.__mockMessages?.filter(message => message.type === 'lookupSelection')
  )).toEqual([{ type: 'lookupSelection', text: quote }]);

  await openSelectionMenu();
  await page.getByRole('menuitem', { name: 'Copy selected text', exact: true }).click();
  await expect.poll(() => page.evaluate(() =>
    window.__mockMessages?.filter(message => message.type === 'copyText')
  )).toEqual([{ type: 'copyText', text: quote }]);

  await openSelectionMenu();
  await page.getByRole('menuitem', { name: 'Copy link to selection', exact: true }).click();
  const selectionActions = await page.evaluate(() =>
    window.__mockMessages?.filter(message => message.type === 'selectionAction')
  );
  expect(selectionActions).toHaveLength(1);
  expect(selectionActions[0].action).toBe('copyLink');
  expect(selectionActions[0].anchor.snippet).toBe(quote);
  expect(selectionActions[0].anchor.page).toBe(1);

  await page.evaluate(() => { window.__mockMessages = []; });
  const canvas = page.locator('#page-1 .pdf-canvas');
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  if (!canvasBox) return;
  await page.mouse.click(
    canvasBox.x + canvasBox.width / 2,
    canvasBox.y + canvasBox.height / 2,
    { button: 'right' },
  );
  await expect(page.locator('#selection-toolbar')).toHaveCount(0);
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
    'Zoom In',
    'Zoom Out',
    'Actual Size',
    'Next Page',
    'Previous Page',
    'Copy link to page',
  ]);
  await page.getByRole('menuitem', { name: 'Copy link to page', exact: true }).click();
  await expect.poll(() => page.evaluate(() =>
    window.__mockMessages?.filter(message => message.type === 'copyPageLink')
  )).toEqual([{ type: 'copyPageLink', page: 1 }]);
});

test('selection context menu remains available at an aligned trailing glyph edge', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=selector-edge');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  const zoomInput = page.getByRole('spinbutton', { name: 'Zoom' });
  await zoomInput.fill('150');
  await zoomInput.press('Enter');
  await expect(page.locator('#page-info')).toHaveText(/150%/);
  const flashSpan = page.locator('.text-layer span[data-item-index]').filter({ hasText: /^Flash$/ });
  await expect(flashSpan).toHaveCount(1);

  await flashSpan.evaluate(span => {
    if (!span.firstChild) throw new Error('Expected the selector-edge Flash span');
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector('#page-container')!.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: 0,
    }));
  });
  await expect(page.locator('#selection-toolbar')).toBeVisible();

  const hitTest = await page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) throw new Error('Expected an active Flash selection');
    const range = selection.getRangeAt(0);
    const selectedSpan = range.startContainer.parentElement;
    const rect = range.getBoundingClientRect();
    const target = document.elementFromPoint(rect.right - 0.25, rect.top + rect.height / 2);
    if (!target) throw new Error('Expected a hit-test target at the selection edge');
    const targetSpan = target.closest<HTMLElement>('.text-layer span[data-item-index]');
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.right - 0.25,
      clientY: rect.top + rect.height / 2,
    }));
    return {
      selectedItemIndex: selectedSpan?.dataset.itemIndex,
      targetItemIndex: targetSpan?.dataset.itemIndex,
    };
  });

  expect(hitTest.targetItemIndex).toBeDefined();
  expect(hitTest.targetItemIndex).not.toBe(hitTest.selectedItemIndex);
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Copy link to selection', exact: true })).toBeVisible();
});

test('PDF++-style context menu cancels a pending mouseup toolbar update', async ({ page }) => {
  const quote = 'FlashAttention uses tiling';
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('.text-layer span[data-item-index="0"]')).toBeVisible();

  await page.evaluate((selectedText) => {
    const span = document.querySelector('.text-layer span[data-item-index="0"]');
    const offset = span.textContent.indexOf(selectedText);
    const text = span.querySelector('.pdf-text-glyphs')?.firstChild;
    if (!text) throw new Error('Expected selectable PDF text');
    const range = document.createRange();
    range.setStart(text, offset);
    range.setEnd(text, offset + selectedText.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector('#page-container').dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: 0,
    }));
  }, quote);
  await expect(page.locator('#selection-toolbar')).toBeVisible();

  await page.evaluate(() => {
    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const span = range.startContainer.parentElement;
    const rect = range.getBoundingClientRect();
    document.querySelector('#page-container').dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: 0,
    }));
    span.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
  });

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await page.waitForTimeout(90);
  await expect(menu).toBeVisible();
  await expect(page.locator('#selection-toolbar')).toHaveCount(0);
});

test('PDF++-style context menu derives actions from a new same-text native range', async ({ page }) => {
  const quote = 'FlashAttention';
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('.text-layer span[data-item-index="0"]')).toBeVisible();

  const exactEndOffset = await page.evaluate((selectedText) => {
    const span = document.querySelector('.text-layer span[data-item-index="0"]');
    const offset = span.textContent.indexOf(selectedText);
    const text = span.querySelector('.pdf-text-glyphs')?.firstChild;
    if (!text) throw new Error('Expected selectable PDF text');
    const range = document.createRange();
    range.setStart(text, offset);
    range.setEnd(text, offset + selectedText.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector('#page-container').dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: 0,
    }));
    return offset + selectedText.length;
  }, quote);
  await expect(page.locator('#selection-toolbar')).toBeVisible();
  await page.evaluate(() => { window.__mockMessages = []; });

  const expandedEndOffset = await page.evaluate(({ selectedText, exactEnd }) => {
    const span = document.querySelector('.text-layer span[data-item-index="0"]');
    if (!/\s/.test(span.textContent.charAt(exactEnd))) {
      throw new Error('PDF fixture must contain whitespace after the repeated selection text');
    }
    const offset = span.textContent.indexOf(selectedText);
    const text = span.querySelector('.pdf-text-glyphs')?.firstChild;
    if (!text) throw new Error('Expected selectable PDF text');
    const range = document.createRange();
    range.setStart(text, offset);
    range.setEnd(text, exactEnd + 1);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const rect = range.getBoundingClientRect();
    span.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
    return exactEnd + 1;
  }, { selectedText: quote, exactEnd: exactEndOffset });

  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Copy link to selection', exact: true }).click();
  const actions = await page.evaluate(() =>
    window.__mockMessages?.filter(message => message.type === 'selectionAction')
  );
  expect(actions).toHaveLength(1);
  expect(actions[0].anchor.snippet).toBe(quote);
  expect(actions[0].anchor.endCharOffset).toBe(expandedEndOffset);
  expect(actions[0].anchor.endCharOffset).not.toBe(exactEndOffset);
});

test('PDF++-style context menu uses page actions outside a non-collapsed selection', async ({ page }) => {
  const quote = 'FlashAttention';
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('.text-layer span[data-item-index="0"]')).toBeVisible();

  await page.evaluate((selectedText) => {
    const span = document.querySelector('.text-layer span[data-item-index="0"]');
    const offset = span.textContent.indexOf(selectedText);
    const text = span.querySelector('.pdf-text-glyphs')?.firstChild;
    if (!text) throw new Error('Expected selectable PDF text');
    const range = document.createRange();
    range.setStart(text, offset);
    range.setEnd(text, offset + selectedText.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector('#page-container').dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: 0,
    }));
  }, quote);
  await expect(page.locator('#selection-toolbar')).toBeVisible();

  const selectionStayedActive = await page.locator('#page-1 .pdf-canvas').evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.right - 12,
      clientY: rect.bottom - 12,
    }));
    return !window.getSelection()?.isCollapsed;
  });
  expect(selectionStayedActive).toBe(true);
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
    'Zoom In',
    'Zoom Out',
    'Actual Size',
    'Next Page',
    'Previous Page',
    'Copy link to page',
  ]);
});

test('pdf selection toolbar fuzzes all actions across synthetic and dragged selections', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('http://localhost:8979/pdf-viewer.html?host=cursor');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('.text-layer span[data-item-index="0"]')).toBeVisible();
  await expectPdfViewerStable(page, errors, 'selection fuzz initial document', 1);

  for (const actionCase of [
    { label: 'Copy Link', action: 'copyLink', start: 0, end: 14 },
    { label: 'Add to Chat', action: 'addToCursorChat', start: 15, end: 26 },
  ]) {
    await selectPdfTextRange(page, actionCase.start, actionCase.end);
    await expect(page.locator('#selection-toolbar')).toBeVisible();
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
  expect(draggedMessage.anchor.snippet).toContain('Attention');
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
      .filter(wrapper => {
        const styles = window.getComputedStyle(wrapper);
        return styles.display !== 'none'
          && styles.visibility !== 'hidden'
          && Number(styles.opacity) > 0;
      })
      .map(wrapper => wrapper.id),
  );
}

async function spreadGeometry(page) {
  return page.locator('.page-wrapper').evaluateAll((wrappers: HTMLElement[]) =>
    wrappers.map(wrapper => {
      const rect = wrapper.getBoundingClientRect();
      return { left: Math.round(rect.left), top: Math.round(rect.top) };
    })
  );
}

async function chooseDisplayMode(page, label: string) {
  await page.getByRole('button', { name: 'Display options' }).click();
  const menu = page.getByRole('menu', { name: 'Display options' });
  await expect(menu).toBeVisible();
  const pageChanges = await page.evaluate(() => (window as any).__mockMessages
    .filter((message: any) => message.type === 'pageChanged').length);
  await menu.getByRole('menuitemradio', { name: label, exact: true }).click();
  await expect(menu).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).__mockMessages
    .filter((message: any) => message.type === 'pageChanged').length)).toBeGreaterThan(pageChanges);
}

async function setContinuousScroll(page, enabled: boolean) {
  await page.getByRole('button', { name: 'Display options' }).click();
  const menu = page.getByRole('menu', { name: 'Display options' });
  await expect(menu).toBeVisible();
  const target = menu.getByRole('menuitemradio', {
    name: enabled ? 'Single Page Continuous' : 'Single Page',
    exact: true,
  });
  const checked = await target.getAttribute('aria-checked');
  if (checked !== 'true') {
    const pageChanges = await page.evaluate(() => (window as any).__mockMessages
      .filter((message: any) => message.type === 'pageChanged').length);
    await target.click();
    await expect.poll(() => page.evaluate(() => (window as any).__mockMessages
      .filter((message: any) => message.type === 'pageChanged').length)).toBeGreaterThan(pageChanges);
  } else {
    await page.keyboard.press('Escape');
  }
  await expect(menu).toBeHidden();
  if (enabled) await expect(page.locator('#page-container')).not.toHaveClass(/(?:^|\s)paginated(?:\s|$)/);
  else await expect(page.locator('#page-container')).toHaveClass(/(?:^|\s)paginated(?:\s|$)/);
}

async function installNavigationRaceHarness(page): Promise<void> {
  await page.addInitScript(() => {
    const state = window as any;
    state.__navigationScrollTargets = [];
    state.__delayNextPdfImageLoadMs = 0;
    state.__delayedPdfImageLoadsCompleted = 0;

    const imageSource = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (!imageSource?.get || !imageSource.set) throw new Error('HTMLImageElement.src is unavailable');
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: imageSource.configurable,
      enumerable: imageSource.enumerable,
      get: imageSource.get,
      set(value: string) {
        const delay = Number(state.__delayNextPdfImageLoadMs) || 0;
        if (delay > 0) {
          state.__delayNextPdfImageLoadMs = 0;
          const image = this as HTMLImageElement;
          const onload = image.onload;
          image.onload = event => {
            window.setTimeout(() => {
              onload?.call(image, event);
              state.__delayedPdfImageLoadsCompleted++;
            }, delay);
          };
        }
        imageSource.set!.call(this, value);
      },
    });

    Element.prototype.scrollIntoView = function scrollIntoView(): void {
      const element = this as HTMLElement;
      state.__navigationScrollTargets.push(
        element.dataset.annotationId ? `marker:${element.dataset.annotationId}` : element.id,
      );
    };
  });
}

async function installIntersectionObserverHarness(page): Promise<void> {
  await page.addInitScript(() => {
    const state = window as any;
    const observers: any[] = [];

    class DeterministicIntersectionObserver {
      readonly root: Element | Document | null;
      readonly rootMargin: string;
      readonly thresholds: readonly number[];
      readonly targets = new Set<Element>();

      constructor(
        private readonly callback: IntersectionObserverCallback,
        options: IntersectionObserverInit = {},
      ) {
        this.root = options.root ?? null;
        this.rootMargin = options.rootMargin ?? '0px';
        this.thresholds = Array.isArray(options.threshold)
          ? options.threshold
          : [options.threshold ?? 0];
        observers.push(this);
      }

      observe(target: Element): void {
        this.targets.add(target);
      }

      unobserve(target: Element): void {
        this.targets.delete(target);
      }

      disconnect(): void {
        this.targets.clear();
      }

      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }

      emit(entries: IntersectionObserverEntry[]): void {
        this.callback(entries, this as unknown as IntersectionObserver);
      }
    }

    state.IntersectionObserver = DeterministicIntersectionObserver;
    state.__emitPdfPageIntersections = (ratios: Array<[number, number]>) => {
      const observer = observers.find(candidate =>
        candidate.root instanceof HTMLElement && candidate.root.id === 'viewer-container'
      );
      if (!observer) throw new Error('PDF page IntersectionObserver was not created');
      const entries = ratios.map(([page, intersectionRatio]) => {
        const target = document.getElementById(`page-${page}`);
        if (!target || !observer.targets.has(target)) {
          throw new Error(`PDF page ${page} is not observed`);
        }
        const bounds = target.getBoundingClientRect();
        return {
          target,
          time: performance.now(),
          rootBounds: null,
          boundingClientRect: bounds,
          intersectionRect: intersectionRatio > 0 ? bounds : new DOMRectReadOnly(),
          isIntersecting: intersectionRatio > 0,
          intersectionRatio,
        } as IntersectionObserverEntry;
      });
      observer.emit(entries);
    };
  });
}

function discussionAnnotation(id: string, page: number, question: string) {
  const createdAt = '2026-07-15T12:00:00.000Z';
  return {
    id,
    kind: 'agent_discussion',
    selectionKey: `selection-${page}`,
    anchor: {
      page,
      quote: `Selection on page ${page}`,
      rects: [[72, 90, 230, 112]],
    },
    messages: [{ id: `question-${page}`, role: 'user', markdown: question, createdAt }],
    lastTurn: { status: 'idle' },
    createdAt,
    updatedAt: createdAt,
  };
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
  const readState = () => page.evaluate(() => {
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
        wrapper.textLayerWidth !== wrapper.highlightLayerWidth ||
        wrapper.textLayerHeight !== wrapper.highlightLayerHeight
      ),
      searchHidden: document.querySelector<HTMLElement>('#pdf-search')?.classList.contains('hidden') ?? true,
      searchCountText: document.querySelector<HTMLElement>('#pdf-search-count')?.textContent ?? '',
      searchMatchCount: document.querySelectorAll('.pdf-search-match').length,
      selectedSearchMatchCount: document.querySelectorAll('.pdf-search-match.selected').length,
      selectionToolbarCount: document.querySelectorAll('#selection-toolbar').length,
      messageTypes: (window.__mockMessages ?? []).map(message => message.type),
    };
  });
  await expect.poll(async () => (await readState()).misaligned, { message: label }).toEqual([]);
  const state = await readState();

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
  if (state.searchHidden) {
    expect(state.searchMatchCount, label).toBe(0);
    expect(state.selectedSearchMatchCount, label).toBe(0);
  } else {
    expect(state.selectedSearchMatchCount, label).toBeLessThanOrEqual(Math.max(1, state.searchMatchCount));
  }
}

async function selectPdfTextRange(page, start: number, end: number) {
  await page.evaluate(({ start, end }) => {
    const span = document.querySelector<HTMLElement>('.text-layer span[data-item-index="0"]');
    const textNode = span?.querySelector<HTMLElement>('.pdf-text-glyphs')?.firstChild ?? span?.firstChild;
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

async function openPdfSelectionContextMenu(page) {
  await page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) throw new Error('Expected an active PDF selection');
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const clientX = Math.round(rect.left + rect.width / 2);
    const clientY = Math.round(rect.top + rect.height / 2);
    const target = document.elementFromPoint(clientX, clientY);
    if (!target) throw new Error('Expected a hit-test target inside the PDF selection');
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
    }));
  });
  await expect(page.getByRole('menu')).toBeVisible();
}

async function waitForSelectionAction(page, action: string) {
  await page.waitForFunction((action) =>
    window.__mockMessages?.some(message => message.type === 'selectionAction' && message.action === action),
  action);
  return page.evaluate((action) =>
    window.__mockMessages?.find(message => message.type === 'selectionAction' && message.action === action),
  action);
}
