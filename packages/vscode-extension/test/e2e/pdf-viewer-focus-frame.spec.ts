import { expect, test } from '@playwright/test';

test('focused PDF viewport does not draw a panel-sized focus frame', async ({ page }) => {
  await page.goto('http://localhost:8979/pdf-viewer.html?fixture=internal-destinations');
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 3/, { timeout: 10_000 });

  const internalLink = page.locator(
    '#page-1 .pdf-link-overlay[data-target-page="2"] .pdf-link-hit-fragment',
  ).first();
  await expect(internalLink).toBeVisible();
  await internalLink.click();

  await expect(page.locator('#page-info')).toHaveText(/Page 2 \/ 3/);
  const viewport = page.locator('#viewer-container');
  await expect(viewport).toBeFocused();
  await expect(viewport).toHaveCSS('outline-style', 'none');
});
