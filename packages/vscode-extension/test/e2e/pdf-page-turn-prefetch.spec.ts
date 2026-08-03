import { expect, test, type Page } from '@playwright/test';

const viewerUrl = 'http://localhost:8979/pdf-viewer.html?fixture=four-page';

test('paginated page turns reuse a prefetched canvas without a blank frame', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await openFourPageFixture(page);
  await setSinglePageMode(page);

  await page.getByRole('button', { name: 'Next page' }).click();
  await expectCurrentPage(page, 2);

  const nextPage = page.locator('#page-3');
  const nextCanvas = nextPage.locator('canvas.pdf-canvas');
  await expect(nextPage).toBeHidden();
  await expect.poll(() => nextCanvas.evaluate(canvasHasVisibleInk)).toBe(true);

  await installPageTurnCanvasProbe(page, 3);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expectCurrentPage(page, 3);
  await expect(nextPage).toBeVisible();

  // Let any deferred render work settle so a late replacement is also caught.
  await page.waitForTimeout(250);
  const probe = await readAndStopPageTurnCanvasProbe(page, 3);

  expect(probe.visibleFrames).toBeGreaterThan(0);
  expect(probe.firstVisibleFrameHadPixels).toBe(true);
  expect(probe.blankVisibleFrames).toBe(0);
  expect(probe.canvasReplacements).toBe(0);
  expect(probe.sameCanvas).toBe(true);
  expect(probe.canvasStillHasPixels).toBe(true);
});

test('backward page turns reuse the previous canvas without a blank frame', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await openFourPageFixture(page);
  await setSinglePageMode(page);

  await page.getByRole('button', { name: 'Next page' }).click();
  await expectCurrentPage(page, 2);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expectCurrentPage(page, 3);

  const previousPage = page.locator('#page-2');
  await expect(previousPage).toBeHidden();
  await expect.poll(() => previousPage.locator('canvas.pdf-canvas')
    .evaluate(canvasHasVisibleInk)).toBe(true);

  await installPageTurnCanvasProbe(page, 2);
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expectCurrentPage(page, 2);
  await expect(previousPage).toBeVisible();
  await waitForAnimationFrames(page, 2);

  const probe = await readAndStopPageTurnCanvasProbe(page, 2);
  expect(probe.visibleFrames).toBeGreaterThan(0);
  expect(probe.firstVisibleFrameHadPixels).toBe(true);
  expect(probe.blankVisibleFrames).toBe(0);
  expect(probe.canvasReplacements).toBe(0);
  expect(probe.sameCanvas).toBe(true);
  expect(probe.canvasStillHasPixels).toBe(true);
});

test('an immediate fit-page turn stays painted before adjacent prefetch can start', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await openFourPageFixture(page);
  await setSinglePageMode(page);

  // Page 2 is the normal forward prefetch from the initial page. Hold the
  // zero-delay prefetch scheduled after navigating to page 2 so page 3 remains
  // genuinely uncached when the user immediately advances again.
  await expect.poll(() => page.locator('#page-2 canvas.pdf-canvas')
    .evaluate(canvasHasVisibleInk)).toBe(true);
  await installNextZeroDelayTimerGate(page);
  await armNextZeroDelayTimer(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expectCurrentPage(page, 2);
  await expectNextZeroDelayTimerHeld(page);

  const targetPage = 3;
  await expect(page.locator(`#page-${targetPage}`)).toBeHidden();
  expect(await page.locator(`#page-${targetPage} canvas.pdf-canvas`)
    .evaluate(canvasHasVisibleInk)).toBe(false);

  await installPdfImageLoadGate(page);
  await installPageTurnCanvasProbe(page, targetPage);
  await armNextPdfImageLoad(page);
  await page.getByRole('button', { name: 'Next page' }).click();

  const probe = await finishGatedPageTurnProbe(page, 2, targetPage);
  expect({
    firstVisibleFrameHadPixels: probe.firstVisibleFrameHadPixels,
    blankVisibleFrames: probe.blankVisibleFrames,
  }).toEqual({
    firstVisibleFrameHadPixels: true,
    blankVisibleFrames: 0,
  });
});

test('reversing an uncached turn cancels its stale staged render without blanking the source page', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await openFourPageFixture(page);
  await setSinglePageMode(page);

  await expect.poll(() => page.locator('#page-2 canvas.pdf-canvas')
    .evaluate(canvasHasVisibleInk)).toBe(true);
  await installNextZeroDelayTimerGate(page);
  await armNextZeroDelayTimer(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expectCurrentPage(page, 2);
  await expectNextZeroDelayTimerHeld(page);

  await installPdfImageLoadGate(page);
  await installPageTurnCanvasProbe(page, 2);
  await armNextPdfImageLoad(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await waitForGatedPageTurn(page, 2, 3);

  await page.getByRole('button', { name: 'Previous page' }).click();
  await expectCurrentPage(page, 2);
  await expect(page.locator('#page-2')).toBeVisible();

  await releasePdfImageLoadGate(page);
  await expect.poll(() => pdfImageLoadGateSnapshot(page)).toEqual({
    started: 1,
    pending: false,
    completed: 1,
  });
  await expect(page.locator('#page-3')).toBeHidden();
  await expect(page.locator('#page-3')).not.toHaveClass(/page-turn-staging/);
  await waitForAnimationFrames(page, 2);

  const probe = await readAndStopPageTurnCanvasProbe(page, 2);
  expect(probe.visibleFrames).toBeGreaterThan(0);
  expect(probe.firstVisibleFrameHadPixels).toBe(true);
  expect(probe.blankVisibleFrames).toBe(0);
  expect(probe.canvasReplacements).toBe(0);
  expect(probe.sameCanvas).toBe(true);
  expect(probe.canvasStillHasPixels).toBe(true);
});

test('a prefetched fit-page book spread reveals every page without a blank frame', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await openFourPageFixture(page);
  await setPresentationMode(page, 'two');
  for (const pageNumber of [2, 3]) {
    await expect(page.locator(`#page-${pageNumber}`)).toBeHidden();
    const canvas = page.locator(`#page-${pageNumber} canvas.pdf-canvas`);
    await expect.poll(() => canvas.evaluate(canvasHasVisibleInk)).toBe(true);
    await expect.poll(() => canvas.evaluate(canvasMatchesCssResolution)).toBe(true);
    await expect(canvas).toHaveAttribute('data-render-quality', 'full');
    await installPageTurnCanvasProbe(page, pageNumber);
  }

  await page.getByRole('button', { name: 'Next page' }).click();
  await expectCurrentPage(page, 3);
  await waitForAnimationFrames(page, 2);

  for (const pageNumber of [2, 3]) {
    await expect(page.locator(`#page-${pageNumber}`)).toBeVisible();
    const probe = await readAndStopPageTurnCanvasProbe(page, pageNumber);
    expect(probe.visibleFrames).toBeGreaterThan(0);
    expect(probe.firstVisibleFrameHadPixels).toBe(true);
    expect(probe.blankVisibleFrames).toBe(0);
    expect(probe.canvasReplacements).toBe(0);
    expect(probe.sameCanvas).toBe(true);
    expect(probe.canvasStillHasPixels).toBe(true);
  }
});

test('custom zoom cancels an obsolete prefetch timer and reveals the new-scale neighbor atomically', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await openFourPageFixture(page);
  await setSinglePageMode(page);

  await expect.poll(() => page.locator('#page-2 canvas.pdf-canvas')
    .evaluate(canvasHasVisibleInk)).toBe(true);
  await installNextZeroDelayTimerGate(page);
  await armNextZeroDelayTimer(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expectCurrentPage(page, 2);
  await expectNextZeroDelayTimerHeld(page);

  await setCustomZoom(page, 180);
  await expect.poll(() => page.evaluate(() => {
    const gate = (window as any).__pageTurnTimerGate;
    return {
      armed: gate.armed,
      held: gate.held,
      hasTimer: typeof gate.timerId === 'number',
    };
  })).toEqual({
    armed: false,
    held: false,
    hasTimer: false,
  });

  const targetCanvas = page.locator('#page-3 canvas.pdf-canvas');
  await expect.poll(() => targetCanvas.evaluate(canvasHasVisibleInk)).toBe(true);
  await expect.poll(() => targetCanvas.evaluate(canvasMatchesCssResolution)).toBe(true);
  await expect(targetCanvas).toHaveAttribute('data-render-quality', 'full');

  await installPageTurnCanvasProbe(page, 3);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expectCurrentPage(page, 3);
  await waitForAnimationFrames(page, 2);

  const probe = await readAndStopPageTurnCanvasProbe(page, 3);
  expect(probe.firstVisibleFrameHadPixels).toBe(true);
  expect(probe.blankVisibleFrames).toBe(0);
  expect(probe.canvasReplacements).toBe(0);
  expect(probe.sameCanvas).toBe(true);
  expect(probe.canvasStillHasPixels).toBe(true);
});

test('a stale prefetched bitmap cannot overwrite a newer custom-zoom canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await openFourPageFixture(page);
  await setSinglePageMode(page);

  await expect.poll(() => page.locator('#page-2 canvas.pdf-canvas')
    .evaluate(canvasHasVisibleInk)).toBe(true);
  await installPdfImageLoadGate(page);
  await armNextPdfImageLoad(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expectCurrentPage(page, 2);
  await expect.poll(() => pdfImageLoadGateSnapshot(page)).toEqual({
    started: 1,
    pending: true,
    completed: 0,
  });

  await setCustomZoom(page, 180);
  const targetCanvas = page.locator('#page-3 canvas.pdf-canvas');
  await expect.poll(() => targetCanvas.evaluate(canvasHasVisibleInk)).toBe(true);
  await expect.poll(() => targetCanvas.evaluate(canvasMatchesCssResolution)).toBe(true);
  await expect(targetCanvas).toHaveAttribute('data-render-quality', 'full');
  await page.evaluate(() => {
    (window as any).__freshZoomedPrefetchCanvas =
      document.querySelector('#page-3 canvas.pdf-canvas');
  });

  await releasePdfImageLoadGate(page);
  await expect.poll(() => pdfImageLoadGateSnapshot(page)).toEqual({
    started: 1,
    pending: false,
    completed: 1,
  });
  await waitForAnimationFrames(page, 3);

  expect(await page.evaluate(() =>
    document.querySelector('#page-3 canvas.pdf-canvas')
      === (window as any).__freshZoomedPrefetchCanvas
  )).toBe(true);
  await expect.poll(() => targetCanvas.evaluate(canvasHasVisibleInk)).toBe(true);
  await expect.poll(() => targetCanvas.evaluate(canvasMatchesCssResolution)).toBe(true);
  await expect(targetCanvas).toHaveAttribute('data-render-quality', 'full');
});

for (const scenario of [
  { label: 'single-page', mode: 'single', zoomPercent: 180 },
  { label: 'two-page', mode: 'two', zoomPercent: 70 },
] as const) {
  test(`${scenario.label} custom-zoom turns keep an unvisited adjacent page painted`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 });
    await openFourPageFixture(page);
    await setSinglePageMode(page);

    // Re-render page 1 and its adjacent page at custom zoom. Page 3 has still
    // never been rendered, so holding the next prefetch gives both modes a
    // deterministic uncached page-turn target.
    await setCustomZoomAndWaitForAdjacentPage(page, scenario.zoomPercent, 2);
    await installNextZeroDelayTimerGate(page);
    await armNextZeroDelayTimer(page);
    if (scenario.mode === 'single') {
      await page.getByRole('button', { name: 'Next page' }).click();
      await expectCurrentPage(page, 2);
    } else {
      await setPresentationMode(page, 'two');
    }
    await expectNextZeroDelayTimerHeld(page);

    const sourcePage = scenario.mode === 'single' ? 2 : 1;
    const targetPage = 3;
    // With the fixture's spread parity, page 3 enters beside the already
    // painted page 2. Page 3 is the newly exposed, uncached wrapper.
    const targetPages = [targetPage];
    for (const pageNumber of targetPages) {
      await expect(page.locator(`#page-${pageNumber}`)).toBeHidden();
      expect(await page.locator(`#page-${pageNumber} canvas.pdf-canvas`)
        .evaluate(canvasHasVisibleInk)).toBe(false);
    }

    await installPdfImageLoadGate(page);
    for (const pageNumber of targetPages) {
      await installPageTurnCanvasProbe(page, pageNumber);
    }
    await armNextPdfImageLoad(page);
    await page.getByRole('button', { name: 'Next page' }).click();

    await waitForGatedPageTurn(page, sourcePage, targetPage);
    await releaseGatedPageTurn(page, targetPage);
    const probes = await Promise.all(
      targetPages.map(pageNumber => readAndStopPageTurnCanvasProbe(page, pageNumber)),
    );
    for (const probe of probes) {
      expect({
        firstVisibleFrameHadPixels: probe.firstVisibleFrameHadPixels,
        blankVisibleFrames: probe.blankVisibleFrames,
      }).toEqual({
        firstVisibleFrameHadPixels: true,
        blankVisibleFrames: 0,
      });
    }
  });
}

async function openFourPageFixture(page: Page): Promise<void> {
  await page.goto(viewerUrl);
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 4/, { timeout: 10_000 });
  await expect(page.locator('.page-wrapper')).toHaveCount(4);
}

async function setSinglePageMode(page: Page): Promise<void> {
  await setPresentationMode(page, 'single');
}

async function setPresentationMode(page: Page, mode: 'single' | 'two'): Promise<void> {
  await page.getByRole('button', { name: 'Display options' }).click();
  const menu = page.getByRole('menu', { name: 'Display options' });
  await expect(menu).toBeVisible();
  await menu.locator(`[data-display-action="presentation-${mode}"]`).click();
  await expect(menu).toBeHidden();
  await expect(page.locator('#page-container')).toHaveClass(/(?:^|\s)paginated(?:\s|$)/);
}

async function setCustomZoom(page: Page, percent: number): Promise<void> {
  const zoom = page.getByRole('spinbutton', { name: 'Zoom' });
  await zoom.fill(String(percent));
  await zoom.press('Enter');
  await expect(zoom).toHaveValue(String(percent));
}

async function setCustomZoomAndWaitForAdjacentPage(
  page: Page,
  percent: number,
  adjacentPage: number,
): Promise<void> {
  await page.evaluate((number) => {
    (window as any).__pageTurnSetupCanvas =
      document.querySelector(`#page-${number} canvas.pdf-canvas`);
  }, adjacentPage);
  await setCustomZoom(page, percent);
  await expect.poll(() => page.evaluate((number) => {
    const current = document.querySelector<HTMLCanvasElement>(
      `#page-${number} canvas.pdf-canvas`,
    );
    return current !== (window as any).__pageTurnSetupCanvas
      && current?.dataset.renderQuality === 'full';
  }, adjacentPage)).toBe(true);
  await expect.poll(() => page.locator(`#page-${adjacentPage} canvas.pdf-canvas`)
    .evaluate(canvasHasVisibleInk)).toBe(true);
}

async function expectCurrentPage(page: Page, pageNumber: number): Promise<void> {
  await expect(page.getByRole('spinbutton', { name: 'Page' })).toHaveValue(String(pageNumber));
  await expect(page.locator('#page-info')).toHaveText(new RegExp(`Page ${pageNumber} / 4`));
}

function canvasHasVisibleInk(canvas: HTMLCanvasElement): boolean {
  if (canvas.width < 1 || canvas.height < 1) return false;
  const context = canvas.getContext('2d');
  if (!context) return false;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const xStep = Math.max(1, Math.floor(canvas.width / 160));
  const yStep = Math.max(1, Math.floor(canvas.height / 160));
  for (let y = 0; y < canvas.height; y += yStep) {
    for (let x = 0; x < canvas.width; x += xStep) {
      const offset = (y * canvas.width + x) * 4;
      if (
        pixels[offset + 3] > 16
        && (pixels[offset] < 248 || pixels[offset + 1] < 248 || pixels[offset + 2] < 248)
      ) {
        return true;
      }
    }
  }
  return false;
}

function canvasMatchesCssResolution(canvas: HTMLCanvasElement): boolean {
  const cssWidth = Number.parseFloat(canvas.style.width);
  const cssHeight = Number.parseFloat(canvas.style.height);
  const dpr = window.devicePixelRatio || 1;
  return Number.isFinite(cssWidth)
    && Number.isFinite(cssHeight)
    && Math.abs(canvas.width - Math.round(cssWidth * dpr)) <= 1
    && Math.abs(canvas.height - Math.round(cssHeight * dpr)) <= 1;
}

async function installPageTurnCanvasProbe(page: Page, pageNumber: number): Promise<void> {
  await page.evaluate((number) => {
    const wrapper = document.querySelector<HTMLElement>(`#page-${number}`)!;
    const viewer = document.querySelector<HTMLElement>('#viewer-container')!;
    const baselineCanvas = wrapper.querySelector<HTMLCanvasElement>('canvas.pdf-canvas')!;
    const state = window as any;
    const probes = state.__pageTurnCanvasProbes ??= {};
    const probe = {
      active: true,
      baselineCanvas,
      lastCanvas: baselineCanvas,
      canvasReplacements: 0,
      visibleFrames: 0,
      blankVisibleFrames: 0,
      firstVisibleFrameHadPixels: undefined as boolean | undefined,
      observer: undefined as MutationObserver | undefined,
    };
    const hasVisibleInk = (canvas: HTMLCanvasElement | null): boolean => {
      if (!canvas || canvas.width < 1 || canvas.height < 1) return false;
      const context = canvas.getContext('2d');
      if (!context) return false;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const xStep = Math.max(1, Math.floor(canvas.width / 160));
      const yStep = Math.max(1, Math.floor(canvas.height / 160));
      for (let y = 0; y < canvas.height; y += yStep) {
        for (let x = 0; x < canvas.width; x += xStep) {
          const offset = (y * canvas.width + x) * 4;
          if (
            pixels[offset + 3] > 16
            && (pixels[offset] < 248 || pixels[offset + 1] < 248 || pixels[offset + 2] < 248)
          ) {
            return true;
          }
        }
      }
      return false;
    };
    probe.observer = new MutationObserver(() => {
      const currentCanvas = wrapper.querySelector<HTMLCanvasElement>('canvas.pdf-canvas');
      if (currentCanvas && currentCanvas !== probe.lastCanvas) {
        probe.canvasReplacements++;
        probe.lastCanvas = currentCanvas;
      }
    });
    probe.observer.observe(wrapper, { childList: true });
    const sampleFrame = () => {
      if (!probe.active) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      const viewerRect = viewer.getBoundingClientRect();
      const style = getComputedStyle(wrapper);
      const visiblyPainted = style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity || '1') > 0.01
        && wrapperRect.right > viewerRect.left
        && wrapperRect.left < viewerRect.right
        && wrapperRect.bottom > viewerRect.top
        && wrapperRect.top < viewerRect.bottom;
      if (visiblyPainted) {
        const currentCanvas = wrapper.querySelector<HTMLCanvasElement>('canvas.pdf-canvas');
        const hasPixels = hasVisibleInk(currentCanvas);
        probe.visibleFrames++;
        probe.firstVisibleFrameHadPixels ??= hasPixels;
        if (!hasPixels) probe.blankVisibleFrames++;
      }
      requestAnimationFrame(sampleFrame);
    };
    probes[number] = probe;
    requestAnimationFrame(sampleFrame);
  }, pageNumber);
}

async function installPdfImageLoadGate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as any;
    state.__pageTurnImageLoadGate = {
      armed: false,
      started: 0,
      pending: false,
      completed: 0,
      release: undefined,
    };
    if (state.__pageTurnImageLoadGateInstalled) return;
    state.__pageTurnImageLoadGateInstalled = true;

    const imageSource = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (!imageSource?.get || !imageSource.set) {
      throw new Error('HTMLImageElement.src is unavailable');
    }
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: imageSource.configurable,
      enumerable: imageSource.enumerable,
      get: imageSource.get,
      set(value: string) {
        const active = state.__pageTurnImageLoadGate;
        if (active?.armed) {
          active.armed = false;
          active.started++;
          const image = this as HTMLImageElement;
          const onload = image.onload;
          image.onload = event => {
            active.pending = true;
            active.release = () => {
              active.release = undefined;
              active.pending = false;
              onload?.call(image, event);
              active.completed++;
            };
          };
        }
        imageSource.set!.call(this, value);
      },
    });
  });
}

async function armNextPdfImageLoad(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__pageTurnImageLoadGate.armed = true;
  });
}

async function releasePdfImageLoadGate(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__pageTurnImageLoadGate.release?.();
  });
}

async function pdfImageLoadGateSnapshot(
  page: Page,
): Promise<{ started: number; pending: boolean; completed: number }> {
  return page.evaluate(() => {
    const gate = (window as any).__pageTurnImageLoadGate;
    return {
      started: Number(gate?.started) || 0,
      pending: gate?.pending === true,
      completed: Number(gate?.completed) || 0,
    };
  });
}

async function installNextZeroDelayTimerGate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as any;
    state.__pageTurnTimerGate = {
      armed: false,
      held: false,
      timerId: undefined as number | undefined,
    };
    if (state.__pageTurnTimerGateInstalled) return;
    state.__pageTurnTimerGateInstalled = true;

    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeClearTimeout = window.clearTimeout.bind(window);
    window.setTimeout = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ): number => {
      const gate = state.__pageTurnTimerGate;
      if (gate?.armed && Number(timeout ?? 0) === 0) {
        gate.armed = false;
        gate.held = true;
        // Use a real timer id so the viewer's normal prefetch cancellation
        // path can cancel this held callback without any product-only hook.
        const timerId = nativeSetTimeout(handler, 60_000, ...args);
        gate.timerId = timerId;
        return timerId;
      }
      return nativeSetTimeout(handler, timeout, ...args);
    }) as typeof window.setTimeout;
    window.clearTimeout = ((timerId?: number): void => {
      const gate = state.__pageTurnTimerGate;
      if (gate?.timerId === timerId) {
        gate.timerId = undefined;
        gate.held = false;
      }
      nativeClearTimeout(timerId);
    }) as typeof window.clearTimeout;
  });
}

async function armNextZeroDelayTimer(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__pageTurnTimerGate.armed = true;
  });
}

async function expectNextZeroDelayTimerHeld(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const gate = (window as any).__pageTurnTimerGate;
    return {
      armed: gate.armed,
      held: gate.held,
      hasTimer: typeof gate.timerId === 'number',
    };
  })).toEqual({
    armed: false,
    held: true,
    hasTimer: true,
  });
}

async function finishGatedPageTurnProbe(
  page: Page,
  sourcePage: number,
  targetPage: number,
): Promise<Awaited<ReturnType<typeof readAndStopPageTurnCanvasProbe>>> {
  await waitForGatedPageTurn(page, sourcePage, targetPage);
  await releaseGatedPageTurn(page, targetPage);
  return readAndStopPageTurnCanvasProbe(page, targetPage);
}

async function waitForGatedPageTurn(
  page: Page,
  sourcePage: number,
  targetPage: number,
): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const gate = (window as any).__pageTurnImageLoadGate;
    return {
      started: gate.started,
      pending: gate.pending,
      completed: gate.completed,
    };
  })).toEqual({
    started: 1,
    pending: true,
    completed: 0,
  });
  await waitForAnimationFrames(page, 3);
  await expectCurrentPage(page, sourcePage);
  await expect(page.locator(`#page-${sourcePage}`)).toBeVisible();
  await expect(page.locator(`#page-${targetPage}`)).toHaveClass(/page-turn-staging/);
  await expect(page.locator(`#page-${targetPage}`)).toHaveCSS('opacity', '0');
}

async function releaseGatedPageTurn(
  page: Page,
  targetPage: number,
): Promise<void> {
  await page.evaluate(() => {
    (window as any).__pageTurnImageLoadGate.release?.();
  });
  await expect.poll(() => page.evaluate(() => {
    const gate = (window as any).__pageTurnImageLoadGate;
    return {
      started: gate.started,
      pending: gate.pending,
      completed: gate.completed,
    };
  })).toEqual({
    started: 1,
    pending: false,
    completed: 1,
  });
  await expectCurrentPage(page, targetPage);
  await expect.poll(() => page.locator(`#page-${targetPage} canvas.pdf-canvas`)
    .evaluate(canvasHasVisibleInk)).toBe(true);
  await waitForAnimationFrames(page, 2);
}

async function waitForAnimationFrames(page: Page, count: number): Promise<void> {
  await page.evaluate((frames) => new Promise<void>(resolve => {
    let remaining = frames;
    const next = () => {
      remaining--;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  }), count);
}

async function readAndStopPageTurnCanvasProbe(
  page: Page,
  pageNumber: number,
): Promise<{
  visibleFrames: number;
  blankVisibleFrames: number;
  firstVisibleFrameHadPixels: boolean | undefined;
  canvasReplacements: number;
  sameCanvas: boolean;
  canvasStillHasPixels: boolean;
}> {
  return page.evaluate((number) => {
    const wrapper = document.querySelector<HTMLElement>(`#page-${number}`)!;
    const currentCanvas = wrapper.querySelector<HTMLCanvasElement>('canvas.pdf-canvas')!;
    const probe = (window as any).__pageTurnCanvasProbes[number];
    probe.active = false;
    probe.observer.disconnect();
    const context = currentCanvas.getContext('2d');
    let canvasStillHasPixels = false;
    if (context && currentCanvas.width > 0 && currentCanvas.height > 0) {
      const pixels = context.getImageData(
        0,
        0,
        currentCanvas.width,
        currentCanvas.height,
      ).data;
      const xStep = Math.max(1, Math.floor(currentCanvas.width / 160));
      const yStep = Math.max(1, Math.floor(currentCanvas.height / 160));
      outer: for (let y = 0; y < currentCanvas.height; y += yStep) {
        for (let x = 0; x < currentCanvas.width; x += xStep) {
          const offset = (y * currentCanvas.width + x) * 4;
          if (
            pixels[offset + 3] > 16
            && (pixels[offset] < 248 || pixels[offset + 1] < 248 || pixels[offset + 2] < 248)
          ) {
            canvasStillHasPixels = true;
            break outer;
          }
        }
      }
    }
    return {
      visibleFrames: probe.visibleFrames,
      blankVisibleFrames: probe.blankVisibleFrames,
      firstVisibleFrameHadPixels: probe.firstVisibleFrameHadPixels,
      canvasReplacements: probe.canvasReplacements,
      sameCanvas: currentCanvas === probe.baselineCanvas,
      canvasStillHasPixels,
    };
  }, pageNumber);
}
