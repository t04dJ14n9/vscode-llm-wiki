import { expect, test, type Page } from '@playwright/test';

const viewerUrl = 'http://localhost:8979/pdf-viewer.html?fixture=four-page';

type PresentationMode =
  | 'single'
  | 'single-continuous'
  | 'two'
  | 'two-continuous';

test('Preview presentation modes keep page layout and continuity as independent choices', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openFourPageFixture(page);

  await setPresentationMode(page, 'single-continuous');
  await expectView(page, {
    twoPage: false,
    continuous: true,
    visiblePages: ['page-1', 'page-2', 'page-3', 'page-4'],
  });

  await setPresentationMode(page, 'two-continuous');
  await expectView(page, {
    twoPage: true,
    continuous: true,
    visiblePages: ['page-1', 'page-2', 'page-3', 'page-4'],
  });
  await expectPagesShareRow(page, 2, 3);
  await expectSpreadGutter(page, 2, 3, 12);

  await setPresentationMode(page, 'two');
  await expectView(page, {
    twoPage: true,
    continuous: false,
    visiblePages: ['page-1'],
  });
  await expectPageCentered(page, 1);

  await page.getByRole('button', { name: 'Next page' }).click();
  await expectCurrentPage(page, 3);
  await expectView(page, {
    twoPage: true,
    continuous: false,
    visiblePages: ['page-2', 'page-3'],
  });
  await expectPagesShareRow(page, 2, 3);
  await expectSpreadCentered(page, 2, 3);
  await expectSpreadGutter(page, 2, 3, 0);

  await setPresentationMode(page, 'single');
  await expectView(page, {
    twoPage: false,
    continuous: false,
    visiblePages: ['page-3'],
  });
});

test('PDF viewer initially fits a whole page and keeps automatic fit on resize', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 480 });
  await openFourPageFixture(page);

  const initial = await pageAndViewerGeometry(page, 1);
  expect(initial.pageWidth).toBeLessThanOrEqual(initial.viewerWidth - 24);
  expect(initial.pageHeight).toBeLessThanOrEqual(initial.viewerHeight - 76);
  expect(initial.zoom).not.toBe(135);

  await page.setViewportSize({ width: 1200, height: 720 });
  await expect.poll(async () => (await pageAndViewerGeometry(page, 1)).zoom)
    .toBeGreaterThan(initial.zoom + 20);

  const resized = await pageAndViewerGeometry(page, 1);
  expect(resized.pageWidth).toBeLessThanOrEqual(resized.viewerWidth - 24);
  expect(resized.pageHeight).toBeLessThanOrEqual(resized.viewerHeight - 76);
});

test('Option+Arrow turns pages without changing custom zoom and ignores editable controls', async ({ page }) => {
  await openFourPageFixture(page);
  await setPresentationMode(page, 'single');

  const zoom = page.getByRole('spinbutton', { name: 'Zoom' });
  await setCustomZoom(page, 200);

  await page.keyboard.press('Alt+ArrowRight');
  await expectCurrentPage(page, 2);
  await expect(zoom).toHaveValue('200');

  const pageInput = page.getByRole('spinbutton', { name: 'Page' });
  await pageInput.focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expectCurrentPage(page, 2);
  await expect(zoom).toHaveValue('200');

  await page.evaluate(() => {
    const textarea = document.createElement('textarea');
    textarea.id = 'keyboard-shortcut-test-textarea';
    document.body.append(textarea);
    textarea.focus();
  });
  await page.keyboard.press('Alt+ArrowLeft');
  await expectCurrentPage(page, 2);
  await expect(zoom).toHaveValue('200');

  await focusViewer(page);
  await page.keyboard.press('Alt+ArrowLeft');
  await expectCurrentPage(page, 1);
  await expect(zoom).toHaveValue('200');

  await page.keyboard.press('Alt+ArrowDown');
  await expectCurrentPage(page, 2);
  await expect(zoom).toHaveValue('200');
  await page.keyboard.press('Alt+ArrowUp');
  await expectCurrentPage(page, 1);
  await expect(zoom).toHaveValue('200');
});

test('Option+Arrow page turns preserve normalized viewport position in both directions at custom zoom', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 520 });
  await openFourPageFixture(page);
  await setPresentationMode(page, 'single');
  await setCustomZoom(page, 250);

  await setViewerViewportProgress(page, { x: 0.36, y: 0.64 });
  await focusViewer(page);
  await page.keyboard.press('Alt+ArrowRight');
  await expectCurrentPage(page, 2);
  await expectViewerViewportProgress(page, { x: 0.36, y: 0.64 });
  await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('250');

  await setViewerViewportProgress(page, { x: 0.72, y: 0.28 });
  await focusViewer(page);
  await page.keyboard.press('Alt+ArrowLeft');
  await expectCurrentPage(page, 1);
  await expectViewerViewportProgress(page, { x: 0.72, y: 0.28 });
  await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('250');
});

test('two-page navigation advances by Preview spreads and refits each spread', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await openFourPageFixture(page);
  await setPresentationMode(page, 'two');
  await chooseDisplayAction(page, 'fit-width');

  const zoom = page.getByRole('spinbutton', { name: 'Zoom' });
  const coverZoom = await zoom.inputValue();
  await expectPageCentered(page, 1);

  await focusViewer(page);
  await page.keyboard.press('Alt+ArrowRight');
  await expectCurrentPage(page, 3);
  const spreadZoom = await zoom.inputValue();
  expect(spreadZoom).not.toBe(coverZoom);
  const spreadGeometry = await spreadAndViewerGeometry(page, 2, 3);
  expect(Math.abs(spreadGeometry.spreadWidth - (spreadGeometry.viewerWidth - 24))).toBeLessThanOrEqual(1);
  await expectSpreadCentered(page, 2, 3);
  await expectSpreadGutter(page, 2, 3, 0);

  await page.keyboard.press('Alt+ArrowRight');
  await expectCurrentPage(page, 4);
  await expectVisiblePages(page, ['page-4']);
  await expectPageCentered(page, 4);
});

test('single-page continuous navigation and rerenders preserve the explicit active page', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await openFourPageFixture(page);
  await setPresentationMode(page, 'single-continuous');

  const zoom = page.getByRole('spinbutton', { name: 'Zoom' });
  await zoom.fill('100');
  await zoom.press('Enter');

  const pageInput = page.getByRole('spinbutton', { name: 'Page' });
  await pageInput.fill('2');
  await pageInput.press('Enter');
  await expectCurrentPage(page, 2);
  await page.waitForTimeout(700);
  await expectCurrentPage(page, 2);

  await page.getByRole('button', { name: 'Next page' }).click();
  await expectCurrentPage(page, 3);
  await page.waitForTimeout(700);
  await expectCurrentPage(page, 3);

  await zoom.fill('150');
  await zoom.press('Enter');
  await expectCurrentPage(page, 3);
  await page.waitForTimeout(100);
  await expectCurrentPage(page, 3);

  await chooseDisplayAction(page, 'fit-page');
  await expectCurrentPage(page, 3);
});

test('display menu exposes Preview four-mode labels and one active mode', async ({ page }) => {
  await openFourPageFixture(page);
  await openDisplayMenu(page);
  const menu = page.getByRole('menu', { name: 'Display options' });
  const modes = menu.locator('[data-display-action^="presentation-"]');

  await expect(modes).toHaveCount(4);
  await expect(modes).toHaveText([
    'Single Page',
    'Single Page Continuous',
    'Two Pages',
    'Two Pages Continuous',
  ]);
  await expect(menu.locator('[data-display-action="presentation-single"]')).toHaveAttribute('aria-checked', 'false');
  await expect(menu.locator('[data-display-action="presentation-single-continuous"]')).toHaveAttribute('aria-checked', 'true');
  await expect(menu.locator('[data-display-action="presentation-two"]')).toHaveAttribute('aria-checked', 'false');
  await expect(menu.locator('[data-display-action="presentation-two-continuous"]')).toHaveAttribute('aria-checked', 'false');
  await expect(menu.locator('[data-display-action="continuous"]')).toHaveCount(0);
  await expect(menu.locator('[data-display-action^="scroll-"]')).toHaveCount(0);
  await expect(menu.locator('[data-display-action^="spread-"]')).toHaveCount(0);
});

test('page background context menu mirrors Preview labels, active mode, and actions', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await openFourPageFixture(page);

  let menu = await openPageContextMenu(page, 1);
  for (const [action, label] of [
    ['auto-resize', 'Automatically Resize'],
    ['zoom-in', 'Zoom In'],
    ['zoom-out', 'Zoom Out'],
    ['actual-size', 'Actual Size'],
    ['next-page', 'Next Page'],
    ['previous-page', 'Previous Page'],
  ] as const) {
    await expect(menu.getByText(label, { exact: true })).toHaveCount(1);
    await expect(menu.locator(`[data-context-action="${action}"]`)).toHaveText(label);
  }
  const modeItems = menu.getByRole('menuitemradio');
  await expect(modeItems).toHaveCount(4);
  await expect(modeItems).toHaveText([
    'Single Page',
    'Single Page Continuous',
    'Two Pages',
    'Two Pages Continuous',
  ]);
  for (const mode of ['single', 'single-continuous', 'two', 'two-continuous'] as const) {
    await expect(menu.locator(`[data-context-action="presentation-${mode}"]`)).toHaveCount(1);
  }
  await expect(menu.getByRole('menuitemradio', { name: 'Single Page Continuous', exact: true }))
    .toHaveAttribute('aria-checked', 'true');

  await menu.getByText('Actual Size', { exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('100');

  menu = await openPageContextMenu(page, 1);
  await menu.getByText('Zoom In', { exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('115');

  menu = await openPageContextMenu(page, 1);
  await menu.getByText('Zoom Out', { exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('100');

  menu = await openPageContextMenu(page, 1);
  await menu.getByText('Automatically Resize', { exact: true }).click();
  await expect.poll(async () => Number(await page.getByRole('spinbutton', { name: 'Zoom' }).inputValue()))
    .not.toBe(100);

  menu = await openPageContextMenu(page, 1);
  await menu.getByRole('menuitemradio', { name: 'Two Pages Continuous', exact: true }).click();
  await expectView(page, {
    twoPage: true,
    continuous: true,
    visiblePages: ['page-1', 'page-2', 'page-3', 'page-4'],
  });

  menu = await openPageContextMenu(page, 1);
  await expect(menu.getByRole('menuitemradio', { name: 'Two Pages Continuous', exact: true }))
    .toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitemradio', { name: 'Two Pages', exact: true }).click();
  await expectView(page, {
    twoPage: true,
    continuous: false,
    visiblePages: ['page-1'],
  });

  menu = await openPageContextMenu(page, 1);
  await menu.getByRole('menuitemradio', { name: 'Single Page Continuous', exact: true }).click();
  await expectView(page, {
    twoPage: false,
    continuous: true,
    visiblePages: ['page-1', 'page-2', 'page-3', 'page-4'],
  });

  menu = await openPageContextMenu(page, 1);
  await menu.getByRole('menuitemradio', { name: 'Single Page', exact: true }).click();
  await expectView(page, {
    twoPage: false,
    continuous: false,
    visiblePages: ['page-1'],
  });

  menu = await openPageContextMenu(page, 1);
  await menu.getByText('Next Page', { exact: true }).click();
  await expectCurrentPage(page, 2);

  menu = await openPageContextMenu(page, 2);
  await menu.getByText('Previous Page', { exact: true }).click();
  await expectCurrentPage(page, 1);
});

test('two-page navigation uses cover, even-left spreads, and a final singleton', async ({ page }) => {
  await openFourPageFixture(page);
  await setPresentationMode(page, 'two');

  const next = page.getByRole('button', { name: 'Next page' });
  await expect(next).toBeEnabled();
  await next.click();

  await expectCurrentPage(page, 3);
  await expectVisiblePages(page, ['page-2', 'page-3']);
  await next.click();
  await expectCurrentPage(page, 4);
  await expectVisiblePages(page, ['page-4']);
  await expect(next).toBeDisabled();
});

for (const scenario of [
  {
    mode: 'single' as const,
    expectedPage: 2,
    expectedVisiblePages: ['page-2'],
  },
  {
    mode: 'two' as const,
    expectedPage: 3,
    expectedVisiblePages: ['page-2', 'page-3'],
  },
]) {
  test(`paginated ${scenario.mode === 'single' ? 'single-page' : 'two-page'} wheel turns exactly one ${scenario.mode === 'single' ? 'page' : 'spread'} at the boundary and preserves custom zoom`, async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 560 });
    await openFourPageFixture(page);
    await setPresentationMode(page, scenario.mode);
    await setCustomZoom(page, 200);

    const maxScrollTop = await scrollViewerToBottom(page);
    expect(maxScrollTop).toBeGreaterThan(0);
    await dispatchViewerWheel(page, 180);

    await expectCurrentPage(page, scenario.expectedPage);
    await expectVisiblePages(page, scenario.expectedVisiblePages);
    await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('200');

    await page.waitForTimeout(650);
    await expectCurrentPage(page, scenario.expectedPage);
  });
}

for (const scenario of [
  {
    mode: 'single' as const,
    label: 'single page',
    currentPage: 1,
    visiblePages: ['page-1'],
    contentPages: [1],
  },
  {
    mode: 'two' as const,
    label: 'two-page spread',
    currentPage: 3,
    visiblePages: ['page-2', 'page-3'],
    contentPages: [2, 3],
  },
]) {
  test(`oversized paginated ${scenario.label} starts centered with both horizontal edges reachable while fitting content stays centered`, async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 520 });
    await openFourPageFixture(page);
    await setPresentationMode(page, scenario.mode);
    if (scenario.mode === 'two') {
      await page.getByRole('button', { name: 'Next page' }).click();
    }
    await expectCurrentPage(page, scenario.currentPage);
    await expectVisiblePages(page, scenario.visiblePages);
    await setCustomZoom(page, 250);

    await expect.poll(async () =>
      Math.abs((await horizontalContentGeometry(page, scenario.contentPages)).centerOffset)
    ).toBeLessThanOrEqual(2);
    const initial = await horizontalContentGeometry(page, scenario.contentPages);
    expect(initial.maxScrollLeft).toBeGreaterThan(0);
    expect(initial.scrollLeft).toBeGreaterThan(0);
    expect(initial.scrollLeft).toBeLessThan(initial.maxScrollLeft);

    await setViewerHorizontalEdge(page, 'left');
    const leftEdge = await horizontalContentGeometry(page, scenario.contentPages);
    expect(leftEdge.scrollLeft).toBe(0);
    expect(leftEdge.contentLeft).toBeGreaterThanOrEqual(leftEdge.viewerLeft - 1);
    expect(leftEdge.contentLeft).toBeLessThan(leftEdge.viewerRight);

    await setViewerHorizontalEdge(page, 'right');
    const rightEdge = await horizontalContentGeometry(page, scenario.contentPages);
    expect(Math.abs(rightEdge.scrollLeft - rightEdge.maxScrollLeft)).toBeLessThanOrEqual(1);
    expect(rightEdge.contentRight).toBeLessThanOrEqual(rightEdge.viewerRight + 1);
    expect(rightEdge.contentRight).toBeGreaterThan(rightEdge.viewerLeft);

    await setCustomZoom(page, 50);
    await expect.poll(async () =>
      Math.abs((await horizontalContentGeometry(page, scenario.contentPages)).centerOffset)
    ).toBeLessThanOrEqual(2);
    const fitted = await horizontalContentGeometry(page, scenario.contentPages);
    expect(fitted.contentWidth).toBeLessThan(fitted.viewerWidth);
  });
}

for (const scenario of [
  {
    mode: 'single' as const,
    expectedPage: 2,
    expectedVisiblePages: ['page-2'],
  },
  {
    mode: 'two' as const,
    expectedPage: 3,
    expectedVisiblePages: ['page-2', 'page-3'],
  },
]) {
  test(`horizontal trackpad pan in paginated ${scenario.mode === 'single' ? 'single-page' : 'two-page'} mode suppresses residual page turns until a fresh edge gesture`, async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 520 });
    await openFourPageFixture(page);
    await setPresentationMode(page, scenario.mode);
    await setCustomZoom(page, 250);

    const panPosition = await positionViewerBeforeRightEdge(page, 80);
    expect(panPosition.maxScrollLeft).toBeGreaterThan(80);
    expect(panPosition.scrollLeft).toBeLessThan(panPosition.maxScrollLeft);

    await dispatchViewerWheelVector(page, { deltaX: 50, deltaY: 3 });
    await expectCurrentPage(page, 1);

    await scrollViewerToRight(page);
    for (let index = 0; index < 3; index++) {
      await dispatchViewerWheelVector(page, { deltaX: 24, deltaY: 2 });
    }
    await page.waitForTimeout(80);
    await expectCurrentPage(page, 1);

    await page.waitForTimeout(400);
    await dispatchViewerWheelVector(page, { deltaX: 60, deltaY: 2 });
    await expectCurrentPage(page, scenario.expectedPage);
    await expectVisiblePages(page, scenario.expectedVisiblePages);
    await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('250');

    for (let index = 0; index < 3; index++) {
      await dispatchViewerWheelVector(page, { deltaX: 24, deltaY: 2 });
    }
    await page.waitForTimeout(100);
    await expectCurrentPage(page, scenario.expectedPage);
  });
}

for (const scenario of [
  {
    mode: 'single' as const,
    label: 'page',
    expectedPage: 2,
    expectedVisiblePages: ['page-2'],
    contentPages: [2],
  },
  {
    mode: 'two' as const,
    label: 'spread',
    expectedPage: 3,
    expectedVisiblePages: ['page-2', 'page-3'],
    contentPages: [2, 3],
  },
]) {
  test(`horizontal residual momentum after turning a paginated ${scenario.label} is consumed without panning the new oversized content`, async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 520 });
    await openFourPageFixture(page);
    await setPresentationMode(page, scenario.mode);
    await setCustomZoom(page, 250);
    await setViewerHorizontalEdge(page, 'right');

    const turn = await dispatchViewerWheelVectorWithDefaultPan(page, { deltaX: 60, deltaY: 2 });
    expect(turn.defaultPrevented).toBe(true);
    await waitForViewerHorizontalNavigationEdge(page, scenario.expectedPage, 'left');
    await expectCurrentPage(page, scenario.expectedPage);
    await expectVisiblePages(page, scenario.expectedVisiblePages);

    const beforeResidual = await horizontalContentGeometry(page, scenario.contentPages);
    expect(beforeResidual.maxScrollLeft).toBeGreaterThan(0);
    expect(beforeResidual.scrollLeft).toBeLessThanOrEqual(1);

    const residual = [];
    for (let index = 0; index < 3; index++) {
      residual.push(await dispatchViewerWheelVectorWithDefaultPan(page, { deltaX: 24, deltaY: 2 }));
    }
    expect(residual.every(event => event.defaultPrevented && !event.dispatchResult)).toBe(true);

    const afterResidual = await horizontalContentGeometry(page, scenario.contentPages);
    expect(Math.abs(afterResidual.scrollLeft - beforeResidual.scrollLeft)).toBeLessThanOrEqual(1);
    await expectCurrentPage(page, scenario.expectedPage);
    await expectVisiblePages(page, scenario.expectedVisiblePages);
  });
}

test('horizontal trackpad gesture locks its axis so orthogonal jitter cannot turn a paginated page', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 520 });
  await openFourPageFixture(page);
  await setPresentationMode(page, 'single');
  await setCustomZoom(page, 250);
  await scrollViewerToBottom(page);
  await scrollViewerToRight(page);

  await dispatchViewerWheelVector(page, { deltaX: 20, deltaY: 2 });
  for (let index = 0; index < 5; index++) {
    await dispatchViewerWheelVector(page, { deltaX: 4, deltaY: 12 });
  }
  await page.waitForTimeout(100);

  await expectCurrentPage(page, 1);
  await expectVisiblePages(page, ['page-1']);
  await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('250');
});

for (const scenario of [
  {
    mode: 'single' as const,
    label: 'single page',
    startPage: 3,
    startVisiblePages: ['page-3'],
    previousPage: 2,
    previousVisiblePages: ['page-2'],
    previousContentPages: [2],
  },
  {
    mode: 'two' as const,
    label: 'two-page spread',
    startPage: 3,
    startVisiblePages: ['page-2', 'page-3'],
    previousPage: 1,
    previousVisiblePages: ['page-1'],
    previousContentPages: [1],
  },
]) {
  test(`negative horizontal gesture pans an oversized paginated ${scenario.label} left before a fresh gesture turns exactly once`, async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 520 });
    await openFourPageFixture(page);
    await setPresentationMode(page, scenario.mode);
    const pageInput = page.getByRole('spinbutton', { name: 'Page' });
    await pageInput.fill(String(scenario.startPage));
    await pageInput.press('Enter');
    await expectCurrentPage(page, scenario.startPage);
    await expectVisiblePages(page, scenario.startVisiblePages);
    await setCustomZoom(page, 250);

    const positioned = await positionViewerFromLeft(page, 120);
    expect(positioned.maxScrollLeft).toBeGreaterThan(120);
    expect(positioned.scrollLeft).toBeGreaterThan(0);

    const pan = await dispatchViewerWheelVectorWithDefaultPan(page, { deltaX: -240, deltaY: 2 });
    expect(pan.defaultPrevented).toBe(false);
    expect(pan.scrollLeftAfter).toBe(0);
    await expectCurrentPage(page, scenario.startPage);

    const sameGestureResidual = [];
    for (let index = 0; index < 3; index++) {
      sameGestureResidual.push(
        await dispatchViewerWheelVectorWithDefaultPan(page, { deltaX: -24, deltaY: 2 }),
      );
    }
    expect(sameGestureResidual.every(event => event.defaultPrevented && !event.dispatchResult)).toBe(true);
    expect(await viewerScrollLeft(page)).toBe(0);
    await expectCurrentPage(page, scenario.startPage);

    await page.waitForTimeout(220);
    const freshTurn = await dispatchViewerWheelVectorWithDefaultPan(page, { deltaX: -60, deltaY: 2 });
    expect(freshTurn.defaultPrevented).toBe(true);
    await waitForViewerHorizontalNavigationEdge(page, scenario.previousPage, 'right');
    await expectCurrentPage(page, scenario.previousPage);
    await expectVisiblePages(page, scenario.previousVisiblePages);

    const previousEdge = await horizontalContentGeometry(page, scenario.previousContentPages);
    expect(previousEdge.maxScrollLeft).toBeGreaterThan(0);
    expect(Math.abs(previousEdge.scrollLeft - previousEdge.maxScrollLeft)).toBeLessThanOrEqual(1);

    const postTurnResidual = await dispatchViewerWheelVectorWithDefaultPan(
      page,
      { deltaX: -24, deltaY: 2 },
    );
    expect(postTurnResidual.defaultPrevented).toBe(true);
    const afterPostTurnResidual = await horizontalContentGeometry(page, scenario.previousContentPages);
    expect(Math.abs(afterPostTurnResidual.scrollLeft - previousEdge.scrollLeft)).toBeLessThanOrEqual(1);
    await expectCurrentPage(page, scenario.previousPage);
  });
}

test('plain vertical arrow keys scroll within an oversized paginated page and turn only at its boundary', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 500 });
  await openFourPageFixture(page);
  await setPresentationMode(page, 'single');
  await setCustomZoom(page, 200);
  await focusViewer(page);

  const initialScrollTop = await viewerScrollTop(page);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => viewerScrollTop(page)).toBeGreaterThan(initialScrollTop);
  await expectCurrentPage(page, 1);

  const maxScrollTop = await scrollViewerToBottom(page);
  expect(maxScrollTop).toBeGreaterThan(0);
  await page.keyboard.press('ArrowDown');
  await expectCurrentPage(page, 2);
  await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('200');

  await page.waitForTimeout(650);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('#viewer-container')!.scrollTop = 0;
  });
  await focusViewer(page);
  await page.keyboard.press('ArrowUp');
  await expectCurrentPage(page, 1);
  await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('200');
});

test('plain horizontal arrow keys scroll an oversized paginated page before turning it', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 700 });
  await openFourPageFixture(page);
  await setPresentationMode(page, 'single');
  await setCustomZoom(page, 200);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('#viewer-container')!.scrollLeft = 0;
  });
  await focusViewer(page);

  await page.keyboard.press('ArrowRight');
  await expect.poll(() => viewerScrollLeft(page)).toBeGreaterThan(0);
  await expectCurrentPage(page, 1);

  const maxScrollLeft = await scrollViewerToRight(page);
  expect(maxScrollLeft).toBeGreaterThan(0);
  await page.keyboard.press('ArrowRight');
  await expectCurrentPage(page, 2);
  await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('200');
});

test('plain horizontal arrow boundary turns wrap horizontal position and preserve normalized vertical position', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 520 });
  await openFourPageFixture(page);
  await setPresentationMode(page, 'single');
  await setCustomZoom(page, 250);

  await setViewerViewportProgress(page, { x: 1, y: 0.67 });
  await focusViewer(page);
  await page.keyboard.press('ArrowRight');
  await expectCurrentPage(page, 2);
  await expectViewerViewportProgress(page, { x: 0, y: 0.67 });

  await setViewerViewportProgress(page, { x: 0, y: 0.31 });
  await focusViewer(page);
  await page.keyboard.press('ArrowLeft');
  await expectCurrentPage(page, 1);
  await expectViewerViewportProgress(page, { x: 1, y: 0.31 });
  await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('250');
});

test('plain vertical arrow boundary turns wrap vertical position and preserve normalized horizontal position', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 520 });
  await openFourPageFixture(page);
  await setPresentationMode(page, 'single');
  await setCustomZoom(page, 250);

  await setViewerViewportProgress(page, { x: 0.41, y: 1 });
  await focusViewer(page);
  await page.keyboard.press('ArrowDown');
  await expectCurrentPage(page, 2);
  await expectViewerViewportProgress(page, { x: 0.41, y: 0 });

  await setViewerViewportProgress(page, { x: 0.76, y: 0 });
  await focusViewer(page);
  await page.keyboard.press('ArrowUp');
  await expectCurrentPage(page, 1);
  await expectViewerViewportProgress(page, { x: 0.76, y: 1 });
  await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('250');
});

for (const mode of ['single-continuous', 'two-continuous'] as const) {
  test(`${mode === 'single-continuous' ? 'single-page' : 'two-page'} continuous mode retains normal wheel scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 500 });
    await openFourPageFixture(page);
    await setPresentationMode(page, mode);
    await setCustomZoom(page, 100);

    await page.evaluate(() => {
      document.querySelector<HTMLElement>('#viewer-container')!.scrollTop = 0;
    });
    const viewer = page.locator('#viewer-container');
    const bounds = await viewer.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.mouse.wheel(0, 240);

    await expect.poll(() => viewerScrollTop(page)).toBeGreaterThan(0);
    await expectVisiblePages(page, ['page-1', 'page-2', 'page-3', 'page-4']);
    await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('100');
  });
}

test('trackpad pinch ctrl-wheel zooms continuously and suppresses native browser zoom', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 600 });
  await openFourPageFixture(page);
  await setPresentationMode(page, 'single');
  await setCustomZoom(page, 150);

  const focalPoint = await visiblePointOnPage(page, 1);
  const before = await pinchObservableGeometry(page, 1);
  const firstEvent = await dispatchTrackpadPinch(page, focalPoint, -6);

  expect(firstEvent.defaultPrevented).toBe(true);
  expect(firstEvent.dispatchResult).toBe(false);
  await expect.poll(async () => (await pinchObservableGeometry(page, 1)).pageWidth)
    .toBeGreaterThan(before.pageWidth);
  await expect.poll(async () => (await pinchObservableGeometry(page, 1)).zoom)
    .toBeGreaterThan(before.zoom);

  const afterFirst = await pinchObservableGeometry(page, 1);
  expect(afterFirst.zoom).toBeGreaterThan(before.zoom);
  expect(afterFirst.zoom - before.zoom).toBeLessThan(15);
  expect(afterFirst.pageWidth - before.pageWidth).toBeLessThan(45);

  const secondEvent = await dispatchTrackpadPinch(page, focalPoint, -24);
  expect(secondEvent.defaultPrevented).toBe(true);
  await expect.poll(async () => (await pinchObservableGeometry(page, 1)).pageWidth)
    .toBeGreaterThan(afterFirst.pageWidth);
  await expect.poll(async () => (await pinchObservableGeometry(page, 1)).zoom)
    .toBeGreaterThan(afterFirst.zoom);

  const afterSecond = await pinchObservableGeometry(page, 1);
  expect(afterSecond.zoom).toBeGreaterThan(afterFirst.zoom);
  expect(afterSecond.zoom - afterFirst.zoom).toBeGreaterThan(afterFirst.zoom - before.zoom);

  const zoomOutEvent = await dispatchTrackpadPinch(page, focalPoint, 12);
  expect(zoomOutEvent.defaultPrevented).toBe(true);
  await expect.poll(async () => (await pinchObservableGeometry(page, 1)).pageWidth)
    .toBeLessThan(afterSecond.pageWidth);
  await expect.poll(async () => (await pinchObservableGeometry(page, 1)).zoom)
    .toBeLessThan(afterSecond.zoom);

  const afterZoomOut = await pinchObservableGeometry(page, 1);
  expect(afterZoomOut.zoom).toBeLessThan(afterSecond.zoom);
  expect(afterZoomOut.visualViewportScale).toBe(before.visualViewportScale);
  expect(afterZoomOut.devicePixelRatio).toBe(before.devicePixelRatio);
  expect(afterZoomOut.documentWidth).toBe(before.documentWidth);
});

test('trackpad pinch preserves the focal PDF point under the pointer', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 520 });
  await openFourPageFixture(page);
  await setPresentationMode(page, 'single');
  await setCustomZoom(page, 250);
  await centerViewerScroll(page);

  const focalPoint = await visiblePointOnPage(page, 1);
  const before = await pdfCoordinatesAtClientPoint(page, 1, focalPoint);
  const event = await dispatchTrackpadPinch(page, focalPoint, -24);
  expect(event.defaultPrevented).toBe(true);
  await expect.poll(async () => (await pinchObservableGeometry(page, 1)).zoom)
    .toBeGreaterThan(250);

  const after = await pdfCoordinatesAtClientPoint(page, 1, focalPoint);
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1.5);
});

test('trackpad pinch clamps zoom to the supported Preview range', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 600 });
  await openFourPageFixture(page);
  await setPresentationMode(page, 'single');

  await setCustomZoom(page, 350);
  let focalPoint = await visiblePointOnPage(page, 1);
  const maximumEvent = await dispatchTrackpadPinch(page, focalPoint, -160);
  expect(maximumEvent.defaultPrevented).toBe(true);
  await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('350');

  await setCustomZoom(page, 10);
  focalPoint = await visiblePointOnPage(page, 1);
  const minimumEvent = await dispatchTrackpadPinch(page, focalPoint, 160);
  expect(minimumEvent.defaultPrevented).toBe(true);
  await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('10');
});

test('smooth trackpad pinch burst previews every zoom without clearing content and settles with one exact render', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 600 });
  await openFourPageFixture(page);
  await setPresentationMode(page, 'single');
  await setCustomZoom(page, 150);
  await expect(page.locator('#page-1 .text-layer span')).not.toHaveCount(0);

  const focalPoint = await visiblePointOnPage(page, 1);
  const before = await pinchObservableGeometry(page, 1);
  await installPinchRenderProbe(page, 1);

  const firstEvents = await dispatchTrackpadPinchBurst(page, focalPoint, [-4, -4, -4]);
  await nextAnimationFrame(page);
  const intermediate = await pinchRenderProbeSnapshot(page, 1);
  expect(intermediate.wrapperWidth).toBeGreaterThan(before.pageWidth);
  expect(intermediate.zoom).toBeGreaterThan(before.zoom);
  expect(intermediate.drawCalls).toBe(0);
  expect(intermediate.canvasDimensionMutations).toBe(0);
  expect(intermediate.textMutations).toBe(0);

  const secondEvents = await dispatchTrackpadPinchBurst(page, focalPoint, [-4, -4, -4]);
  const events = [...firstEvents, ...secondEvents];
  expect(events).toHaveLength(6);
  expect(events.every(event => event.defaultPrevented && !event.dispatchResult)).toBe(true);
  await nextAnimationFrame(page);

  const duringGesture = await pinchRenderProbeSnapshot(page, 1);
  expect(duringGesture.wrapperWidth).toBeGreaterThan(intermediate.wrapperWidth);
  expect(duringGesture.zoom).toBeGreaterThan(intermediate.zoom);
  expect(duringGesture.drawCalls).toBe(0);
  expect(duringGesture.canvasDimensionMutations).toBe(0);
  expect(duringGesture.textMutations).toBe(0);
  expect(duringGesture.sameCanvas).toBe(true);
  expect(duringGesture.sameFirstTextNode).toBe(true);
  expect(duringGesture.firstTextNodeConnected).toBe(true);
  expect(duringGesture.canvasPixelsUnchanged).toBe(true);

  await expect.poll(async () => (await pinchRenderProbeSnapshot(page, 1)).drawCalls)
    .toBe(1);
  const settled = await pinchRenderProbeSnapshot(page, 1);
  expect(settled.wrapperWidth).toBeGreaterThan(before.pageWidth);
  expect(settled.zoom).toBeGreaterThan(before.zoom);

  await page.waitForTimeout(250);
  await expect.poll(async () => (await pinchRenderProbeSnapshot(page, 1)).drawCalls)
    .toBe(1);
});

test('trackpad pinch handling leaves ordinary two-finger wheel scrolling unchanged', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 500 });
  await openFourPageFixture(page);
  await setPresentationMode(page, 'single-continuous');
  await setCustomZoom(page, 150);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('#viewer-container')!.scrollTop = 0;
    (window as any).__ordinaryWheelDefaultPrevented = undefined;
    document.addEventListener('wheel', event => {
      (window as any).__ordinaryWheelDefaultPrevented = event.defaultPrevented;
    }, { once: true });
  });

  const viewer = page.locator('#viewer-container');
  const bounds = await viewer.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.wheel(0, 180);

  await expect.poll(() => viewerScrollTop(page)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window as any).__ordinaryWheelDefaultPrevented))
    .toBe(false);
  await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('150');
});

test('the non-page viewer canvas is dark while rendered PDF pages stay white', async ({ page }) => {
  await openFourPageFixture(page);

  const colors = await page.evaluate(() => ({
    viewer: getComputedStyle(document.querySelector<HTMLElement>('#viewer-container')!).backgroundColor,
    page: getComputedStyle(document.querySelector<HTMLElement>('#page-1')!).backgroundColor,
  }));
  expect(rgbLuminance(colors.viewer), `viewer background ${colors.viewer}`).toBeLessThan(80);
  expect(rgbLuminance(colors.page), `PDF page background ${colors.page}`).toBeGreaterThan(245);
});

async function openFourPageFixture(page: Page): Promise<void> {
  await page.goto(viewerUrl);
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 4/, { timeout: 10_000 });
  await expect(page.locator('.page-wrapper')).toHaveCount(4);
}

async function setPresentationMode(page: Page, mode: PresentationMode): Promise<void> {
  await openDisplayMenu(page);
  const menu = page.getByRole('menu', { name: 'Display options' });
  await menu.locator(`[role="menuitemradio"][data-display-action="presentation-${mode}"]`).click();
  await expect(menu).toBeHidden();
}

async function chooseDisplayAction(page: Page, action: string): Promise<void> {
  await openDisplayMenu(page);
  const menu = page.getByRole('menu', { name: 'Display options' });
  await menu.locator(`[data-display-action="${action}"]`).click();
  await expect(menu).toBeHidden();
}

async function openDisplayMenu(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Display options' });
  const menu = page.getByRole('menu', { name: 'Display options' });
  if (!(await menu.isVisible())) await trigger.click();
  await expect(menu).toBeVisible();
}

async function openPageContextMenu(page: Page, pageNumber: number) {
  const pageSurface = page.locator(`#page-${pageNumber} .text-layer`);
  await expect(pageSurface).toBeVisible();
  const size = await pageSurface.boundingBox();
  expect(size).not.toBeNull();
  await page.mouse.click(
    size!.x + Math.max(1, size!.width - 20),
    size!.y + Math.max(1, size!.height - 20),
    { button: 'right' },
  );
  const menu = page.getByRole('menu', { name: 'Context menu' });
  await expect(menu).toBeVisible();
  return menu;
}

async function expectView(
  page: Page,
  expected: { twoPage: boolean; continuous: boolean; visiblePages: string[] },
): Promise<void> {
  const container = page.locator('#page-container');
  if (expected.twoPage) await expect(container).toHaveClass(/(?:^|\s)two-page(?:\s|$)/);
  else await expect(container).not.toHaveClass(/(?:^|\s)two-page(?:\s|$)/);
  if (expected.continuous) await expect(container).not.toHaveClass(/(?:^|\s)paginated(?:\s|$)/);
  else await expect(container).toHaveClass(/(?:^|\s)paginated(?:\s|$)/);
  await expectVisiblePages(page, expected.visiblePages);
}

async function expectVisiblePages(page: Page, expected: string[]): Promise<void> {
  await expect.poll(() => page.locator('.page-wrapper').evaluateAll((wrappers: HTMLElement[]) =>
    wrappers
      .filter(wrapper => window.getComputedStyle(wrapper).display !== 'none')
      .map(wrapper => wrapper.id),
  )).toEqual(expected);
}

async function expectPagesShareRow(page: Page, first: number, second: number): Promise<void> {
  await expect.poll(async () => {
    const firstTop = await page.locator(`#page-${first}`).evaluate(element =>
      Math.round(element.getBoundingClientRect().top)
    );
    const secondTop = await page.locator(`#page-${second}`).evaluate(element =>
      Math.round(element.getBoundingClientRect().top)
    );
    return Math.abs(firstTop - secondTop);
  }).toBeLessThanOrEqual(1);
}

async function expectPageCentered(page: Page, pageNumber: number): Promise<void> {
  await expect.poll(async () => page.evaluate((number) => {
    const viewer = document.querySelector<HTMLElement>('#viewer-container')!.getBoundingClientRect();
    const pageRect = document.querySelector<HTMLElement>(`#page-${number}`)!.getBoundingClientRect();
    return Math.abs((pageRect.left + pageRect.right) / 2 - (viewer.left + viewer.right) / 2);
  }, pageNumber)).toBeLessThanOrEqual(1);
}

async function expectSpreadGutter(
  page: Page,
  firstPage: number,
  secondPage: number,
  expected: number,
): Promise<void> {
  await expect.poll(async () => page.evaluate(({ first, second }) => {
    const firstRect = document.querySelector<HTMLElement>(`#page-${first}`)!.getBoundingClientRect();
    const secondRect = document.querySelector<HTMLElement>(`#page-${second}`)!.getBoundingClientRect();
    return Math.round(secondRect.left - firstRect.right);
  }, { first: firstPage, second: secondPage })).toBe(expected);
}

async function expectCurrentPage(page: Page, pageNumber: number): Promise<void> {
  await expect(page.getByRole('spinbutton', { name: 'Page' })).toHaveValue(String(pageNumber));
  await expect(page.locator('#page-info')).toHaveText(new RegExp(`Page ${pageNumber} / 4`));
}

async function pageAndViewerGeometry(page: Page, pageNumber: number): Promise<{
  viewerWidth: number;
  viewerHeight: number;
  pageWidth: number;
  pageHeight: number;
  zoom: number;
}> {
  return page.evaluate((number) => {
    const viewer = document.querySelector<HTMLElement>('#viewer-container')!.getBoundingClientRect();
    const wrapper = document.querySelector<HTMLElement>(`#page-${number}`)!.getBoundingClientRect();
    const zoom = Number(document.querySelector<HTMLInputElement>('#zoom-input')!.value);
    return {
      viewerWidth: viewer.width,
      viewerHeight: viewer.height,
      pageWidth: wrapper.width,
      pageHeight: wrapper.height,
      zoom,
    };
  }, pageNumber);
}

async function spreadAndViewerGeometry(
  page: Page,
  firstPage: number,
  secondPage: number,
): Promise<{ viewerWidth: number; spreadWidth: number; centerOffset: number }> {
  return page.evaluate(({ first, second }) => {
    const viewer = document.querySelector<HTMLElement>('#viewer-container')!.getBoundingClientRect();
    const firstRect = document.querySelector<HTMLElement>(`#page-${first}`)!.getBoundingClientRect();
    const secondRect = document.querySelector<HTMLElement>(`#page-${second}`)!.getBoundingClientRect();
    const left = Math.min(firstRect.left, secondRect.left);
    const right = Math.max(firstRect.right, secondRect.right);
    return {
      viewerWidth: viewer.width,
      spreadWidth: right - left,
      centerOffset: (left + right) / 2 - (viewer.left + viewer.right) / 2,
    };
  }, { first: firstPage, second: secondPage });
}

async function expectSpreadCentered(page: Page, firstPage: number, secondPage: number): Promise<void> {
  await expect.poll(async () =>
    Math.abs((await spreadAndViewerGeometry(page, firstPage, secondPage)).centerOffset)
  ).toBeLessThanOrEqual(2);
}

async function horizontalContentGeometry(
  page: Page,
  pageNumbers: number[],
): Promise<{
  viewerLeft: number;
  viewerRight: number;
  viewerWidth: number;
  contentLeft: number;
  contentRight: number;
  contentWidth: number;
  centerOffset: number;
  scrollLeft: number;
  maxScrollLeft: number;
}> {
  return page.evaluate((numbers) => {
    const viewerElement = document.querySelector<HTMLElement>('#viewer-container')!;
    const viewer = viewerElement.getBoundingClientRect();
    const pages = numbers.map(number =>
      document.querySelector<HTMLElement>(`#page-${number}`)!.getBoundingClientRect()
    );
    const contentLeft = Math.min(...pages.map(rect => rect.left));
    const contentRight = Math.max(...pages.map(rect => rect.right));
    return {
      viewerLeft: viewer.left,
      viewerRight: viewer.right,
      viewerWidth: viewer.width,
      contentLeft,
      contentRight,
      contentWidth: contentRight - contentLeft,
      centerOffset: (contentLeft + contentRight) / 2 - (viewer.left + viewer.right) / 2,
      scrollLeft: viewerElement.scrollLeft,
      maxScrollLeft: Math.max(0, viewerElement.scrollWidth - viewerElement.clientWidth),
    };
  }, pageNumbers);
}

async function setCustomZoom(page: Page, percentage: number): Promise<void> {
  const zoom = page.getByRole('spinbutton', { name: 'Zoom' });
  await zoom.fill(String(percentage));
  await zoom.press('Enter');
  await expect(zoom).toHaveValue(String(percentage));
  await expect.poll(() => page.locator(
    '.page-wrapper:not([style*="display: none"]) .text-layer > span[data-item-index]',
  ).count()).toBeGreaterThan(0);
}

async function setViewerViewportProgress(
  page: Page,
  progress: { x: number; y: number },
): Promise<void> {
  await page.locator('#viewer-container').evaluate((viewer: HTMLElement, target) => {
    const maxScrollLeft = Math.max(0, viewer.scrollWidth - viewer.clientWidth);
    const maxScrollTop = Math.max(0, viewer.scrollHeight - viewer.clientHeight);
    if (maxScrollLeft === 0 || maxScrollTop === 0) {
      throw new Error('Expected the custom-zoom PDF page to overflow on both axes');
    }
    viewer.scrollTo({
      left: target.x * maxScrollLeft,
      top: target.y * maxScrollTop,
      behavior: 'auto',
    });
  }, progress);
  await expectViewerViewportProgress(page, progress);
}

async function expectViewerViewportProgress(
  page: Page,
  expected: { x: number; y: number },
): Promise<void> {
  await expect.poll(async () => {
    const progress = await viewerViewportProgress(page);
    return Math.max(
      Math.abs(progress.x - expected.x),
      Math.abs(progress.y - expected.y),
    );
  }).toBeLessThanOrEqual(0.015);
}

async function viewerViewportProgress(
  page: Page,
): Promise<{ x: number; y: number }> {
  return page.locator('#viewer-container').evaluate((viewer: HTMLElement) => {
    const maxScrollLeft = Math.max(0, viewer.scrollWidth - viewer.clientWidth);
    const maxScrollTop = Math.max(0, viewer.scrollHeight - viewer.clientHeight);
    return {
      x: maxScrollLeft > 0 ? viewer.scrollLeft / maxScrollLeft : 0.5,
      y: maxScrollTop > 0 ? viewer.scrollTop / maxScrollTop : 0.5,
    };
  });
}

async function dispatchViewerWheel(page: Page, deltaY: number): Promise<void> {
  await page.locator('#viewer-container').evaluate((viewer, delta) => {
    viewer.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaY: delta,
    }));
  }, deltaY);
}

async function dispatchViewerWheelVector(
  page: Page,
  delta: { deltaX: number; deltaY: number },
): Promise<{ defaultPrevented: boolean; dispatchResult: boolean }> {
  return page.locator('#viewer-container').evaluate((viewer, wheelDelta) => {
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaX: wheelDelta.deltaX,
      deltaY: wheelDelta.deltaY,
    });
    const dispatchResult = viewer.dispatchEvent(event);
    return {
      defaultPrevented: event.defaultPrevented,
      dispatchResult,
    };
  }, delta);
}

async function dispatchViewerWheelVectorWithDefaultPan(
  page: Page,
  delta: { deltaX: number; deltaY: number },
): Promise<{
  defaultPrevented: boolean;
  dispatchResult: boolean;
  scrollLeftBefore: number;
  scrollLeftAfter: number;
}> {
  return page.locator('#viewer-container').evaluate((viewer: HTMLElement, wheelDelta) => {
    const scrollLeftBefore = viewer.scrollLeft;
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaX: wheelDelta.deltaX,
      deltaY: wheelDelta.deltaY,
    });
    const dispatchResult = viewer.dispatchEvent(event);
    if (!event.defaultPrevented) {
      viewer.scrollBy({
        left: wheelDelta.deltaX,
        top: wheelDelta.deltaY,
        behavior: 'auto',
      });
    }
    return {
      defaultPrevented: event.defaultPrevented,
      dispatchResult,
      scrollLeftBefore,
      scrollLeftAfter: viewer.scrollLeft,
    };
  }, delta);
}

async function waitForViewerHorizontalNavigationEdge(
  page: Page,
  expectedPage: number,
  edge: 'left' | 'right',
): Promise<void> {
  await page.locator('#viewer-container').evaluate(
    (viewer: HTMLElement, expected) => new Promise<void>((resolve, reject) => {
      const startedAt = performance.now();
      const check = () => {
        const currentPage = document.querySelector<HTMLInputElement>('#page-input')!.value;
        const maxScrollLeft = Math.max(0, viewer.scrollWidth - viewer.clientWidth);
        const atEdge = expected.edge === 'left'
          ? viewer.scrollLeft <= 1
          : Math.abs(viewer.scrollLeft - maxScrollLeft) <= 1;
        if (currentPage === String(expected.pageNumber) && maxScrollLeft > 0 && atEdge) {
          resolve();
          return;
        }
        if (performance.now() - startedAt >= 140) {
          reject(new Error(
            `Horizontal page navigation did not settle at the ${expected.edge} edge within one wheel burst`,
          ));
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    }),
    { pageNumber: expectedPage, edge },
  );
}

async function scrollViewerToBottom(page: Page): Promise<number> {
  return page.locator('#viewer-container').evaluate((viewer: HTMLElement) => {
    viewer.scrollTop = viewer.scrollHeight;
    return viewer.scrollTop;
  });
}

async function viewerScrollTop(page: Page): Promise<number> {
  return page.locator('#viewer-container').evaluate((viewer: HTMLElement) => viewer.scrollTop);
}

async function positionViewerBeforeRightEdge(
  page: Page,
  remaining: number,
): Promise<{ scrollLeft: number; maxScrollLeft: number }> {
  return page.locator('#viewer-container').evaluate((viewer: HTMLElement, distance) => {
    const maxScrollLeft = Math.max(0, viewer.scrollWidth - viewer.clientWidth);
    viewer.scrollLeft = Math.max(0, maxScrollLeft - distance);
    return {
      scrollLeft: viewer.scrollLeft,
      maxScrollLeft,
    };
  }, remaining);
}

async function positionViewerFromLeft(
  page: Page,
  distance: number,
): Promise<{ scrollLeft: number; maxScrollLeft: number }> {
  return page.locator('#viewer-container').evaluate((viewer: HTMLElement, target) => {
    const maxScrollLeft = Math.max(0, viewer.scrollWidth - viewer.clientWidth);
    viewer.scrollLeft = Math.min(maxScrollLeft, Math.max(0, target));
    return {
      scrollLeft: viewer.scrollLeft,
      maxScrollLeft,
    };
  }, distance);
}

async function setViewerHorizontalEdge(page: Page, edge: 'left' | 'right'): Promise<void> {
  await page.locator('#viewer-container').evaluate((viewer: HTMLElement, targetEdge) => {
    viewer.scrollLeft = targetEdge === 'left' ? 0 : viewer.scrollWidth;
  }, edge);
}

async function scrollViewerToRight(page: Page): Promise<number> {
  return page.locator('#viewer-container').evaluate((viewer: HTMLElement) => {
    viewer.scrollLeft = viewer.scrollWidth;
    return viewer.scrollLeft;
  });
}

async function viewerScrollLeft(page: Page): Promise<number> {
  return page.locator('#viewer-container').evaluate((viewer: HTMLElement) => viewer.scrollLeft);
}

async function visiblePointOnPage(
  page: Page,
  pageNumber: number,
): Promise<{ clientX: number; clientY: number }> {
  return page.evaluate((number) => {
    const viewer = document.querySelector<HTMLElement>('#viewer-container')!.getBoundingClientRect();
    const wrapper = document.querySelector<HTMLElement>(`#page-${number}`)!.getBoundingClientRect();
    const visibleLeft = Math.max(viewer.left, wrapper.left);
    const visibleRight = Math.min(viewer.right, wrapper.right);
    const visibleTop = Math.max(viewer.top, wrapper.top);
    const visibleBottom = Math.min(viewer.bottom, wrapper.bottom);
    if (visibleRight - visibleLeft < 8 || visibleBottom - visibleTop < 8) {
      throw new Error(`Page ${number} does not have a visible pinch target`);
    }
    return {
      clientX: (visibleLeft + visibleRight) / 2,
      clientY: (visibleTop + visibleBottom) / 2,
    };
  }, pageNumber);
}

async function dispatchTrackpadPinch(
  page: Page,
  point: { clientX: number; clientY: number },
  deltaY: number,
): Promise<{ defaultPrevented: boolean; dispatchResult: boolean }> {
  return page.evaluate(({ clientX, clientY, delta }) => {
    const target = document.elementFromPoint(clientX, clientY)
      ?? document.querySelector<HTMLElement>('#viewer-container')!;
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      ctrlKey: true,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaY: delta,
    });
    const dispatchResult = target.dispatchEvent(event);
    return {
      defaultPrevented: event.defaultPrevented,
      dispatchResult,
    };
  }, { ...point, delta: deltaY });
}

async function dispatchTrackpadPinchBurst(
  page: Page,
  point: { clientX: number; clientY: number },
  deltas: number[],
): Promise<Array<{ defaultPrevented: boolean; dispatchResult: boolean }>> {
  return page.evaluate(({ clientX, clientY, wheelDeltas }) => wheelDeltas.map(deltaY => {
    const target = document.elementFromPoint(clientX, clientY)
      ?? document.querySelector<HTMLElement>('#viewer-container')!;
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      ctrlKey: true,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaY,
    });
    const dispatchResult = target.dispatchEvent(event);
    return {
      defaultPrevented: event.defaultPrevented,
      dispatchResult,
    };
  }), { ...point, wheelDeltas: deltas });
}

async function pinchObservableGeometry(
  page: Page,
  pageNumber: number,
): Promise<{
  pageWidth: number;
  zoom: number;
  visualViewportScale: number;
  devicePixelRatio: number;
  documentWidth: number;
}> {
  return page.evaluate((number) => ({
    pageWidth: document.querySelector<HTMLElement>(`#page-${number}`)!.getBoundingClientRect().width,
    zoom: Number(document.querySelector<HTMLInputElement>('#zoom-input')!.value),
    visualViewportScale: window.visualViewport?.scale ?? 1,
    devicePixelRatio: window.devicePixelRatio,
    documentWidth: document.documentElement.getBoundingClientRect().width,
  }), pageNumber);
}

async function installPinchRenderProbe(page: Page, pageNumber: number): Promise<void> {
  await page.evaluate((number) => {
    const canvas = document.querySelector<HTMLCanvasElement>(`#page-${number} .pdf-canvas`)!;
    const textLayer = document.querySelector<HTMLElement>(`#page-${number} .text-layer`)!;
    const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    const probe = {
      canvas,
      textLayer,
      firstTextNode: textLayer.firstChild,
      initialCanvasPixels: canvas.toDataURL(),
      drawCalls: 0,
      canvasDimensionMutations: 0,
      textMutations: 0,
    };
    CanvasRenderingContext2D.prototype.drawImage = function (...args: any[]) {
      if (this.canvas === canvas) probe.drawCalls++;
      return Reflect.apply(originalDrawImage, this, args);
    } as typeof CanvasRenderingContext2D.prototype.drawImage;
    new MutationObserver(records => {
      probe.canvasDimensionMutations += records.length;
    }).observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
    new MutationObserver(records => {
      probe.textMutations += records.length;
    }).observe(textLayer, { childList: true, subtree: true });
    (window as any).__pinchRenderProbe = probe;
  }, pageNumber);
}

async function pinchRenderProbeSnapshot(
  page: Page,
  pageNumber: number,
): Promise<{
  wrapperWidth: number;
  zoom: number;
  drawCalls: number;
  canvasDimensionMutations: number;
  textMutations: number;
  sameCanvas: boolean;
  sameFirstTextNode: boolean;
  firstTextNodeConnected: boolean;
  canvasPixelsUnchanged: boolean;
}> {
  return page.evaluate((number) => {
    const probe = (window as any).__pinchRenderProbe;
    const canvas = document.querySelector<HTMLCanvasElement>(`#page-${number} .pdf-canvas`)!;
    const textLayer = document.querySelector<HTMLElement>(`#page-${number} .text-layer`)!;
    return {
      wrapperWidth: document.querySelector<HTMLElement>(`#page-${number}`)!.getBoundingClientRect().width,
      zoom: Number(document.querySelector<HTMLInputElement>('#zoom-input')!.value),
      drawCalls: probe.drawCalls,
      canvasDimensionMutations: probe.canvasDimensionMutations,
      textMutations: probe.textMutations,
      sameCanvas: canvas === probe.canvas,
      sameFirstTextNode: textLayer.firstChild === probe.firstTextNode,
      firstTextNodeConnected: Boolean(probe.firstTextNode?.isConnected),
      canvasPixelsUnchanged: canvas.toDataURL() === probe.initialCanvasPixels,
    };
  }, pageNumber);
}

async function nextAnimationFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => resolve());
  }));
}

async function pdfCoordinatesAtClientPoint(
  page: Page,
  pageNumber: number,
  point: { clientX: number; clientY: number },
): Promise<{ x: number; y: number }> {
  return page.evaluate(({ number, clientX, clientY }) => {
    const wrapper = document.querySelector<HTMLElement>(`#page-${number}`)!.getBoundingClientRect();
    return {
      x: ((clientX - wrapper.left) / wrapper.width) * 300,
      y: ((clientY - wrapper.top) / wrapper.height) * 400,
    };
  }, { number: pageNumber, ...point });
}

async function centerViewerScroll(page: Page): Promise<void> {
  await page.locator('#viewer-container').evaluate((viewer: HTMLElement) => {
    viewer.scrollLeft = (viewer.scrollWidth - viewer.clientWidth) / 2;
    viewer.scrollTop = (viewer.scrollHeight - viewer.clientHeight) / 2;
  });
}

function rgbLuminance(color: string): number {
  const components = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!components || components.length !== 3) {
    throw new Error(`Expected an rgb() background color, received ${color}`);
  }
  return components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722;
}

async function focusViewer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const viewer = document.querySelector<HTMLElement>('#viewer-container')!;
    viewer.tabIndex = -1;
    viewer.focus();
  });
}
