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
  expect(Math.abs(actualBottom - expectedBottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.hitBox.left - geometry.expected.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(hitBoxRight - expectedRight)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.hitBox.top - geometry.expected.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(hitBoxBottom - expectedBottom)).toBeLessThanOrEqual(1);
});

test('pdf viewer can switch from continuous scroll to page-turning mode', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=two-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });
  await expect(page.locator('.page-wrapper')).toHaveCount(2);

  await chooseDisplayMode(page, 'In-page scroll');
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

  await chooseDisplayMode(page, 'In-page scroll');
  await chooseDisplayMode(page, 'Single page');

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

  await chooseDisplayMode(page, 'In-page scroll');
  await chooseDisplayMode(page, 'Single page');

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

  await chooseDisplayMode(page, 'In-page scroll');
  await chooseDisplayMode(page, 'Single page');

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

  await chooseDisplayMode(page, 'In-page scroll');
  await chooseDisplayMode(page, 'Single page');

  const pageInput = page.getByRole('spinbutton', { name: 'Page' });
  await pageInput.fill('2');
  await pageInput.press('Tab');

  await expect(page.getByRole('button', { name: 'Next page' })).toBeFocused();
  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 4/);
  expect(await visiblePageIds(page)).toEqual(['page-2']);
});

test('pdf viewer can switch to two-page double-column layout', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=two-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });

  await chooseDisplayMode(page, 'Two pages (odd)');
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
  for (const label of ['Highlight color', 'Copy link format', 'Copy embed link to rectangular selection', 'Direct highlight']) {
    await expect(toolbar.getByRole('button', { name: label })).toBeVisible();
  }

  const pageInput = page.getByRole('spinbutton', { name: 'Page' });
  const zoomInput = page.getByRole('spinbutton', { name: 'Zoom' });
  await expect(pageInput).toHaveValue('1');
  await expect(page.locator('#page-total')).toHaveText('of 2');
  await expect(zoomInput).toHaveValue('135');

  await pageInput.fill('2');
  await pageInput.press('Enter');
  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 2/);
  await expect(pageInput).toHaveValue('2');

  const initialWidth = await page.locator('#page-2').evaluate((element: HTMLElement) => element.getBoundingClientRect().width);
  await zoomInput.fill('200');
  await zoomInput.press('Enter');
  await expect(page.locator('#page-info')).toHaveText(/200%/);
  await expect(zoomInput).toHaveValue('200');
  await expect.poll(() => page.locator('#page-2').evaluate((element: HTMLElement) => element.getBoundingClientRect().width))
    .toBeGreaterThan(initialWidth * 1.4);
});

test('pdf viewer keeps the latest page navigation when an older render finishes last', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 220 });
  await installNavigationRaceHarness(page);

  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=four-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 4/, { timeout: 10_000 });
  await expect(page.locator('#page-1 canvas.pdf-canvas')).toBeVisible();

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
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=four-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 4/, { timeout: 10_000 });

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

  const panel = page.getByRole('complementary', { name: 'Ask PDF' });
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
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=four-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 4/, { timeout: 10_000 });

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
  await expect(page.getByRole('complementary', { name: 'PDF sidebar' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Thumbnails' })).toBeVisible();

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

test('pdf viewer display menu exposes PDF++ fit, scroll, and spread modes', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=two-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });

  await page.getByRole('button', { name: 'Display options' }).click();
  const menu = page.getByRole('menu', { name: 'Display options' });
  await expect(menu).toBeVisible();
  for (const label of [
    'Fit width',
    'Fit height',
    'Fit page',
    'Vertical scroll',
    'Horizontal scroll',
    'In-page scroll',
    'Wrapped scroll',
    'Single page',
    'Two pages (odd)',
    'Two pages (even)',
  ]) {
    await expect(menu.getByRole('menuitemradio', { name: label })).toBeVisible();
  }
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Adapt to theme' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Defaults' })).toBeVisible();

  await menu.getByRole('menuitemradio', { name: 'Horizontal scroll' }).click();
  await expect(page.locator('#page-container')).toHaveClass(/scroll-horizontal/);
  await chooseDisplayMode(page, 'Wrapped scroll');
  await expect(page.locator('#page-container')).toHaveClass(/scroll-wrapped/);
  await chooseDisplayMode(page, 'Two pages (even)');
  await expect(page.locator('#page-container')).toHaveClass(/two-page/);
  await expect(page.locator('#page-container')).toHaveAttribute('data-spread-parity', 'even');
});

test('pdf viewer lays out odd and even spreads with PDF++ page pairing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=four-page');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 4/, { timeout: 10_000 });

  await chooseDisplayMode(page, 'Two pages (even)');
  const even = await spreadGeometry(page);
  expect(even[0].top).toBeLessThan(even[1].top);
  expect(even[0].left).toBe(even[2].left);
  expect(even[1].top).toBe(even[2].top);
  expect(even[1].left).toBe(even[3].left);
  expect(even[3].top).toBeGreaterThan(even[2].top);

  await chooseDisplayMode(page, 'Two pages (odd)');
  const odd = await spreadGeometry(page);
  expect(odd[0].top).toBe(odd[1].top);
  expect(odd[0].left).toBeLessThan(odd[1].left);
  expect(odd[2].top).toBe(odd[3].top);
  expect(odd[2].top).toBeGreaterThan(odd[0].top);

  await chooseDisplayMode(page, 'In-page scroll');
  const pageInput = page.getByRole('spinbutton', { name: 'Page' });
  await pageInput.fill('1');
  await pageInput.press('Enter');
  await chooseDisplayMode(page, 'Two pages (even)');
  expect(await visiblePageIds(page)).toEqual(['page-1']);
  await page.getByRole('button', { name: 'Next page' }).click();
  expect(await visiblePageIds(page)).toEqual(['page-2', 'page-3']);
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

test('pdf viewer toolbar exposes PDF++ highlight colors, copy formats, and selection modes', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });

  const highlightTrigger = page.getByRole('button', { name: 'Highlight color' });
  await highlightTrigger.click();
  const colorMenu = page.getByRole('menu', { name: 'Highlight colors' });
  await expect(colorMenu).toBeVisible();
  for (const color of ['Yellow', 'Red', 'Green', 'Purple']) {
    await expect(colorMenu.getByRole('menuitemradio', { name: color })).toBeVisible();
  }
  await expect(colorMenu.getByRole('menuitemradio', { name: 'Blue' })).toHaveCount(0);
  await colorMenu.getByRole('menuitemradio', { name: 'Purple' }).click();
  await expect(highlightTrigger).toHaveAttribute('data-highlight-color', 'purple');

  const palette = page.getByRole('group', { name: 'Highlight palette' });
  for (const color of ['Yellow', 'Red', 'Green', 'Purple']) {
    await expect(palette.getByRole('button', { name: `${color} highlight` })).toBeVisible();
  }
  await expect(palette.getByRole('button', { name: 'Blue highlight' })).toHaveCount(0);
  await palette.getByRole('button', { name: 'Red highlight' }).click();
  await expect(palette.getByRole('button', { name: 'Red highlight' })).toHaveAttribute('aria-pressed', 'true');
  await expect(highlightTrigger).toHaveAttribute('data-highlight-color', 'red');

  const copyFormatTrigger = page.getByRole('button', { name: 'Copy link format' });
  await copyFormatTrigger.click();
  const copyMenu = page.getByRole('menu', { name: 'Copy link format' });
  await expect(copyMenu.getByRole('menuitemradio', { name: 'Link only' })).toHaveAttribute('aria-checked', 'true');
  await copyMenu.getByRole('menuitemradio', { name: 'Quote and link' }).click();
  await expect(copyFormatTrigger).toHaveAttribute('data-copy-link-format', 'quote');

  const rectangle = page.getByRole('button', { name: 'Copy embed link to rectangular selection' });
  const direct = page.getByRole('button', { name: 'Direct highlight' });
  await rectangle.click();
  await expect(rectangle).toHaveAttribute('aria-pressed', 'true');
  await expect(direct).toHaveAttribute('aria-pressed', 'false');
  await direct.click();
  await expect(direct).toHaveAttribute('aria-pressed', 'true');
  await expect(rectangle).toHaveAttribute('aria-pressed', 'false');
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
  expect(Math.abs(rect[0] - 40)).toBeLessThanOrEqual(2);
  expect(Math.abs(rect[1] - 50)).toBeLessThanOrEqual(2);
  expect(Math.abs(rect[2] - 160)).toBeLessThanOrEqual(2);
  expect(Math.abs(rect[3] - 130)).toBeLessThanOrEqual(2);
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
    window.postMessage({
      type: 'goToAnchor',
      page: 2,
      textFragment: { textStart: 'page' },
    }, '*');
  });

  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 2/);
  await expect(page.locator('#page-1 .anchor-highlight')).toHaveCount(0);
  await expect(page.locator('#page-2 .anchor-highlight')).toHaveCount(1);
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
    suffix: 'a Flash Attention aaaaa tail',
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
    prefix: 'Page Twoa',
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
    'Ask about selection…',
    'Copy link to selection',
    'Highlight selection',
    'Copy selected text',
    'Copy quote and link',
    'Insert link',
    'Insert quote and link',
  ]);
  await expect(page.getByRole('menu')).toHaveScreenshot('pdf-context-menu-ask-selection.png', { maxDiffPixels: 1 });

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
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Copy link to page']);
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

  await page.evaluate(() => {
    const span = Array.from(document.querySelectorAll<HTMLElement>('.text-layer span[data-item-index]'))
      .find(candidate => candidate.textContent === 'Flash');
    if (!span?.firstChild) throw new Error('Expected the selector-edge Flash span');
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
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Copy link to page']);
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

test('pdf direct highlight uses the selected color without showing a selection toolbar', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 1/, { timeout: 10_000 });
  await expect(page.locator('.text-layer span[data-item-index="0"]')).toBeVisible();

  await page.getByRole('button', { name: 'Highlight color' }).click();
  await page.getByRole('menuitemradio', { name: 'Purple' }).click();
  await page.getByRole('button', { name: 'Direct highlight' }).click();
  await page.evaluate(() => { window.__mockMessages = []; });

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
    document.querySelector('#page-container').dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  });

  await expect.poll(() => page.evaluate(() =>
    window.__mockMessages?.filter(message => message.type === 'selectionAction' && message.action === 'highlight').length ?? 0
  )).toBe(1);
  const result = await page.evaluate(() => {
    const action = window.__mockMessages
      ?.filter(message => message.type === 'selectionAction' && message.action === 'highlight')
      .at(-1);
    const selectionMessages = window.__mockMessages?.filter(message => message.type === 'selectionChanged') ?? [];
    return {
      action,
      lastSelection: selectionMessages.at(-1),
      nativeSelectionCollapsed: window.getSelection()?.isCollapsed,
    };
  });
  expect(result.action.anchor.highlightColor).toBe('purple');
  expect(result.action.anchor.rects.length).toBeGreaterThan(0);
  expect(result.action.anchor.rects[0]).toHaveLength(4);
  expect(result.lastSelection?.anchor).toBeUndefined();
  expect(result.nativeSelectionCollapsed).toBe(true);
  await expect(page.locator('#selection-toolbar')).toHaveCount(0);

  await page.evaluate(anchor => {
    window.postMessage({
      type: 'setHighlights',
      referenced: [],
      annotated: [{ anchor }],
    }, '*');
  }, result.action.anchor);
  const overlay = page.locator('.annotation-highlight.annotated').first();
  await expect(overlay).toHaveAttribute('data-highlight-color', 'purple');
  await expect.poll(() => overlay.evaluate(element => getComputedStyle(element).backgroundColor))
    .toBe('rgba(177, 151, 252, 0.42)');

  const initialGeometry = await overlay.evaluate((element: HTMLElement) => ({
    left: Number.parseFloat(element.style.left),
    top: Number.parseFloat(element.style.top),
    width: Number.parseFloat(element.style.width),
    height: Number.parseFloat(element.style.height),
  }));
  const rect = result.action.anchor.rects[0];
  expect(Math.abs(initialGeometry.left - rect[0] * 1.35)).toBeLessThanOrEqual(1);
  expect(Math.abs(initialGeometry.top - rect[1] * 1.35)).toBeLessThanOrEqual(1);
  expect(Math.abs(initialGeometry.width - (rect[2] - rect[0]) * 1.35)).toBeLessThanOrEqual(1);
  expect(Math.abs(initialGeometry.height - (rect[3] - rect[1]) * 1.35)).toBeLessThanOrEqual(1);

  const zoomInput = page.getByRole('spinbutton', { name: 'Zoom' });
  await zoomInput.fill('200');
  await zoomInput.press('Enter');
  await expect.poll(() => overlay.evaluate((element: HTMLElement) => Number.parseFloat(element.style.left)))
    .toBeCloseTo(rect[0] * 2, 0);
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
  await menu.getByRole('menuitemradio', { name: label }).click();
  await expect(menu).toBeHidden();
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
