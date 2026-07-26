import { expect, test, type Locator, type Page } from '@playwright/test';

const viewerUrl = 'http://localhost:8979/pdf-viewer.html?fixture=internal-destinations';

test('embedded figure and section destinations become accessible link overlays', async ({ page }) => {
  await openInternalDestinationsFixture(page);

  const figureLink = page.locator('.pdf-link-overlay[data-target-page="2"]');
  const sectionLink = page.locator('#page-1 .pdf-link-overlay[data-target-page="3"]');

  await expect(figureLink).toHaveCount(1);
  await expect(sectionLink).toHaveCount(1);
  await expect(figureLink).toHaveAttribute('aria-label', /figure|page 2/i);
  await expect(sectionLink).toHaveAttribute('aria-label', /section|page 3/i);
  await expect(figureLink).toHaveCSS('cursor', 'pointer');
});

test('internal destinations align their targets and Back restores the exact reading position', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await openInternalDestinationsFixture(page);
  await setCustomZoom(page, 180);

  const viewer = page.locator('#viewer-container');
  const sourceLocation = await viewer.evaluate((element: HTMLElement) => {
    element.scrollTop = 90;
    element.scrollLeft = Math.min(24, element.scrollWidth - element.clientWidth);
    return {
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft,
    };
  });

  const figureLink = page.locator('#page-1 .pdf-link-overlay[data-target-page="2"]');
  await expect(figureLink).toBeVisible();
  await figureLink.click();

  await expectCurrentPage(page, 2);
  await expectDestinationNearViewerTop(page, 2, 'Figure 11.1 target');
  await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('180');

  const backButton = page.locator('#pdf-history-back');
  await expect(backButton).toBeVisible();
  await expect(backButton).toHaveAttribute('aria-label', /back|return/i);
  await expectBottomLeftPlacement(backButton, viewer);

  const figureLocation = await viewer.evaluate((element: HTMLElement) => ({
    scrollTop: element.scrollTop,
    scrollLeft: element.scrollLeft,
  }));

  const sectionLink = page.locator('#page-2 .pdf-link-overlay[data-target-page="3"]');
  await expect(sectionLink).toBeVisible();
  await sectionLink.click();

  await expectCurrentPage(page, 3);
  await expectDestinationNearViewerTop(page, 3, 'Section 12.2 target');
  await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('180');

  await backButton.click();
  await expectCurrentPage(page, 2);
  await expectScrollLocation(viewer, figureLocation);
  await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('180');
  await expect(backButton).toBeVisible();

  await backButton.click();
  await expectCurrentPage(page, 1);
  await expectScrollLocation(viewer, sourceLocation);
  await expect(page.getByRole('spinbutton', { name: 'Zoom' })).toHaveValue('180');
  await expect(backButton).toBeHidden();
});

async function openInternalDestinationsFixture(page: Page): Promise<void> {
  await page.goto(viewerUrl);
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 3/, { timeout: 10_000 });
  await expect(page.locator('#page-1 .pdf-link-overlay')).toHaveCount(2);
}

async function setCustomZoom(page: Page, percent: number): Promise<void> {
  const input = page.getByRole('spinbutton', { name: 'Zoom' });
  await input.fill(String(percent));
  await input.press('Enter');
  await expect(input).toHaveValue(String(percent));
  await expect(page.locator('#page-1 .pdf-link-overlay')).toHaveCount(2);
}

async function expectCurrentPage(page: Page, pageNumber: number): Promise<void> {
  await expect(page.locator('#page-info')).toHaveText(
    new RegExp(`Page ${pageNumber} / 3`),
  );
  await expect(page.getByRole('spinbutton', { name: 'Page' })).toHaveValue(String(pageNumber));
}

async function expectDestinationNearViewerTop(
  page: Page,
  pageNumber: number,
  text: string,
): Promise<void> {
  const target = page.locator(`#page-${pageNumber} .text-layer span[data-item-index]`)
    .filter({ hasText: text })
    .first();
  await expect(target).toBeVisible();
  await expect.poll(async () => target.evaluate((span: HTMLElement) => {
    const viewerRect = document.querySelector<HTMLElement>('#viewer-container')!.getBoundingClientRect();
    return span.getBoundingClientRect().top - viewerRect.top;
  })).toBeGreaterThanOrEqual(-4);
  const offset = await target.evaluate((span: HTMLElement) => {
    const viewerRect = document.querySelector<HTMLElement>('#viewer-container')!.getBoundingClientRect();
    return span.getBoundingClientRect().top - viewerRect.top;
  });
  expect(offset).toBeLessThanOrEqual(72);
}

async function expectScrollLocation(
  viewer: Locator,
  expected: { scrollTop: number; scrollLeft: number },
): Promise<void> {
  await expect.poll(
    async () => viewer.evaluate((element: HTMLElement) => element.scrollTop),
  ).toBeCloseTo(expected.scrollTop, 0);
  await expect.poll(
    async () => viewer.evaluate((element: HTMLElement) => element.scrollLeft),
  ).toBeCloseTo(expected.scrollLeft, 0);
}

async function expectBottomLeftPlacement(button: Locator, viewer: Locator): Promise<void> {
  const geometry = await button.evaluate((element: HTMLElement) => {
    const buttonRect = element.getBoundingClientRect();
    const viewerRect = document.querySelector<HTMLElement>('#viewer-container')!.getBoundingClientRect();
    return {
      leftInset: buttonRect.left - viewerRect.left,
      bottomInset: viewerRect.bottom - buttonRect.bottom,
    };
  });
  expect(geometry.leftInset).toBeGreaterThanOrEqual(8);
  expect(geometry.leftInset).toBeLessThanOrEqual(80);
  expect(geometry.bottomInset).toBeGreaterThanOrEqual(8);
  expect(geometry.bottomInset).toBeLessThanOrEqual(80);
  await expect(button).toBeInViewport();
  await expect(viewer).toBeVisible();
}
