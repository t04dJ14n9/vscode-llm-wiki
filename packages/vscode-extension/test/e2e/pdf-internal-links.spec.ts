import { expect, test, type Locator, type Page } from '@playwright/test';

const viewerUrl = 'http://localhost:8979/pdf-viewer.html?fixture=internal-destinations';
const shiftedContentsUrl = 'http://localhost:8979/pdf-viewer.html?fixture=shifted-contents-links';
const shiftedSingleLinkUrl = 'http://localhost:8979/pdf-viewer.html?fixture=shifted-single-link';

test('embedded figure and section destinations become accessible link overlays', async ({ page }) => {
  await openInternalDestinationsFixture(page);

  const figureLink = page.locator('#page-1 .pdf-link-overlay[data-target-page="2"]');
  const sectionLink = page.locator('#page-1 .pdf-link-overlay[data-target-page="3"]');

  await expect(figureLink).toHaveCount(1);
  await expect(sectionLink).toHaveCount(1);
  await expect(figureLink).toHaveAttribute('aria-label', /figure|page 2/i);
  await expect(sectionLink).toHaveAttribute('aria-label', /section|page 3/i);
  await expect(figureLink.locator('.pdf-link-hit-fragment')).not.toHaveCount(0);
  await expect(figureLink.locator('.pdf-link-hit-fragment').first()).toHaveCSS('cursor', 'pointer');
});

test('PDF navigation sidebar renders nested bookmarks and jumps to their exact destinations', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await openInternalDestinationsFixture(page);
  await setCustomZoom(page, 180);

  await expect.poll(() => page.evaluate(() => (
    (window as any).__mockMessages
      .find((message: any) => message.type === 'pdfOutline')
      ?.items?.[0]?.children?.[0]?.title
  ))).toBe('Section 12.2');

  await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  const navigation = page.getByRole('complementary', { name: 'PDF navigation' });
  await expect(navigation).toBeVisible();
  await navigation.getByRole('tab', { name: 'Outline' }).click();

  const parent = navigation.locator('.pdf-outline-row').filter({ hasText: 'Internal destinations' }).first();
  const section = navigation.locator('.pdf-outline-row').filter({ hasText: 'Section 12.2' }).first();
  await expect(parent).toBeVisible();
  await expect(section).toBeVisible();
  await expect(section.locator('.pdf-outline-page')).toHaveText('3');

  await section.click();

  await expectCurrentPage(page, 3, 3);
  await expectDestinationNearViewerTop(page, 3, 'Section 12.2 target');
  await expect(page.locator('#pdf-history-back')).toBeVisible();
});

test('PDF history back button stays legible over white pages in light and dark themes', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await openInternalDestinationsFixture(page);
  await setCustomZoom(page, 180);
  await page.locator('#page-1 .pdf-link-overlay[data-target-page="2"]')
    .locator('.pdf-link-hit-fragment')
    .first()
    .click();

  const button = page.locator('#pdf-history-back');
  await expect(button).toBeVisible();
  await expect(button).toBeInViewport();
  await button.evaluate((element: HTMLElement) => {
    const shellRect = element.parentElement!.getBoundingClientRect();
    const pageRect = document.querySelector<HTMLElement>('#page-2 .pdf-canvas')!
      .getBoundingClientRect();
    element.style.left = `${pageRect.left - shellRect.left + 14}px`;
  });
  await finishButtonColorTransition(button);
  expect(await button.evaluate((element) => {
    const buttonRect = element.getBoundingClientRect();
    const centerX = buttonRect.left + buttonRect.width / 2;
    const centerY = buttonRect.top + buttonRect.height / 2;
    return Array.from(document.querySelectorAll<HTMLElement>('.pdf-canvas'))
      .some((canvas) => {
        const pageRect = canvas.getBoundingClientRect();
        return centerX >= pageRect.left && centerX <= pageRect.right
          && centerY >= pageRect.top && centerY <= pageRect.bottom;
      });
  })).toBe(true);

  const themes = [
    {
      name: 'light',
      className: 'vscode-light',
      variables: {
        '--vscode-editor-background': '#ffffff',
        '--vscode-editor-foreground': '#1f1f1f',
        '--vscode-sideBar-background': '#f3f3f3',
        '--vscode-editorWidget-background': '#f3f3f3',
        '--vscode-icon-foreground': '#424242',
        '--vscode-foreground': '#1f1f1f',
        '--vscode-button-background': '#0078d4',
        '--vscode-button-foreground': '#ffffff',
        '--vscode-button-secondaryBackground': '#5f6a79',
        '--vscode-button-secondaryForeground': '#ffffff',
        '--vscode-button-secondaryHoverBackground': '#4c5561',
        '--vscode-widget-border': '#c8c8c8',
        '--vscode-toolbar-hoverBackground': 'rgba(0, 0, 0, .08)',
        '--vscode-toolbar-activeBackground': 'rgba(0, 0, 0, .14)',
      },
    },
    {
      name: 'dark',
      className: 'vscode-dark',
      variables: {
        '--vscode-editor-background': '#1e1e1e',
        '--vscode-editor-foreground': '#d4d4d4',
        '--vscode-sideBar-background': '#252526',
        '--vscode-editorWidget-background': '#252526',
        '--vscode-icon-foreground': '#c5c5c5',
        '--vscode-foreground': '#cccccc',
        '--vscode-button-background': '#0e639c',
        '--vscode-button-foreground': '#ffffff',
        '--vscode-button-secondaryBackground': '#3a3d41',
        '--vscode-button-secondaryForeground': '#ffffff',
        '--vscode-button-secondaryHoverBackground': '#45494e',
        '--vscode-widget-border': '#454545',
        '--vscode-toolbar-hoverBackground': 'rgba(90, 93, 94, .31)',
        '--vscode-toolbar-activeBackground': 'rgba(90, 93, 94, .48)',
      },
    },
  ] as const;

  for (const theme of themes) {
    await page.mouse.move(850, 20);
    await page.evaluate(({ className, variables }) => {
      document.body.classList.remove('vscode-light', 'vscode-dark', 'vscode-high-contrast');
      document.body.classList.add(className);
      for (const [name, value] of Object.entries(variables)) {
        document.documentElement.style.setProperty(name, value);
      }
    }, theme);
    await finishButtonColorTransition(button);
    await expectAccessibleHistoryButtonContrast(button, `${theme.name} resting`);

    await button.hover();
    await finishButtonColorTransition(button);
    await expectAccessibleHistoryButtonContrast(button, `${theme.name} hover`);

    await page.mouse.down();
    await finishButtonColorTransition(button);
    await expectAccessibleHistoryButtonContrast(button, `${theme.name} active`);
    await page.mouse.move(850, 20);
    await page.mouse.up();
    await finishButtonColorTransition(button);
  }

  await page.keyboard.press('Tab');
  await button.focus();
  await expect(button).toBeFocused();
  await expect.poll(() => button.evaluate(element => element.matches(':focus-visible')))
    .toBe(true);
  await expect(button).toHaveCSS('outline-width', '2px');
});

test('nested outline entries expose tree semantics and support keyboard navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await openInternalDestinationsFixture(page);

  await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  const navigation = page.getByRole('complementary', { name: 'PDF navigation' });
  await navigation.getByRole('tab', { name: 'Outline' }).click();

  const tree = navigation.getByRole('tree');
  const parentItem = tree.getByRole('treeitem').filter({
    has: page.locator('.pdf-outline-row', { hasText: 'Internal destinations' }),
  }).first();
  const nestedGroup = parentItem.getByRole('group');
  const sectionButton = nestedGroup.getByRole('button', { name: /Section 12\.2.*3/ });

  await expect(tree).toBeVisible();
  await expect(parentItem).toHaveAttribute('aria-expanded', 'true');
  await expect(nestedGroup).toBeVisible();
  await sectionButton.focus();
  await expect(sectionButton).toBeFocused();
  await sectionButton.press('Enter');

  await expectCurrentPage(page, 3);
  await expectDestinationFocusNearText(page, 3, 'Section 12.2 target');
});

test('unnumbered outline destinations focus the nearest heading instead of the page margin', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await openInternalDestinationsFixture(page);
  await setCustomZoom(page, 180);

  await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  const navigation = page.getByRole('complementary', { name: 'PDF navigation' });
  await navigation.getByRole('tab', { name: 'Outline' }).click();
  await navigation.locator('.pdf-outline-row')
    .filter({ hasText: 'Internal destinations' })
    .first()
    .click();

  await expectCurrentPage(page, 1);
  await expectDestinationFocusNearText(page, 1, 'Internal destinations');
  await expect(page.locator('#pdf-history-back')).toBeHidden();
});

test('extension-host PDF outline destinations use the same validated navigation path', async ({ page }) => {
  await openInternalDestinationsFixture(page);
  await setCustomZoom(page, 180);

  await expect.poll(() => page.evaluate(() => (
    (window as any).__mockMessages
      .find((message: any) => message.type === 'pdfOutline')
      ?.items?.[0]?.children?.[0]?.destination
  ))).not.toBeUndefined();

  const sectionDestination = await page.evaluate(() => (
    (window as any).__mockMessages
      .find((message: any) => message.type === 'pdfOutline')
      .items[0].children[0].destination
  ));
  await page.evaluate((target) => {
    window.postMessage({
      type: 'goToPdfDestination',
      destination: target,
      title: 'Section 12.2',
    }, '*');
  }, sectionDestination);

  await expectCurrentPage(page, 3, 3);
  await expectDestinationNearViewerTop(page, 3, 'Section 12.2 target');
  await expectDestinationFocusNearText(page, 3, 'Section 12.2 target');
});

test('out-of-range extension-host destinations cannot corrupt the current page', async ({ page }) => {
  await openInternalDestinationsFixture(page);
  const viewer = page.locator('#viewer-container');
  const before = await viewer.evaluate((element: HTMLElement) => ({
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
  }));

  await page.evaluate(() => {
    window.postMessage({
      type: 'goToPdfDestination',
      destination: {
        pageIndex: 999,
        view: [],
        zoom: { mode: 2, params: {} },
      },
      title: 'Invalid destination',
    }, '*');
  });
  await page.waitForTimeout(50);

  await expectCurrentPage(page, 1);
  await expectScrollLocation(viewer, before);
  await expect(page.locator('#pdf-history-back')).toBeHidden();
});

test('malformed extension-host destinations are ignored without partial navigation state', async ({ page }) => {
  await openInternalDestinationsFixture(page);
  const viewer = page.locator('#viewer-container');
  const before = await viewer.evaluate((element: HTMLElement) => ({
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
  }));

  await page.evaluate(() => {
    const malformed = [
      null,
      {},
      { pageIndex: -1, view: [], zoom: { mode: 2 } },
      { pageIndex: 1.5, view: [], zoom: { mode: 2 } },
      { pageIndex: '1', view: [], zoom: { mode: 2 } },
      { pageIndex: 1, view: [Number.NaN], zoom: { mode: 2 } },
      { pageIndex: 1, view: [], zoom: { mode: 1, params: { x: 4, y: 5 } } },
      { pageIndex: 1, view: [], zoom: { mode: 99 } },
    ];
    for (const destination of malformed) {
      window.postMessage({
        type: 'goToPdfDestination',
        destination,
        title: 'Malformed destination',
      }, '*');
    }
  });
  await page.waitForTimeout(50);

  await expectCurrentPage(page, 1);
  await expectScrollLocation(viewer, before);
  await expect(page.locator('.pdf-destination-focus')).toHaveCount(0);
  await expect(page.locator('#pdf-history-back')).toBeHidden();
});

test('rapid destination requests commit only the final target and original history location', async ({ page }) => {
  await openInternalDestinationsFixture(page);

  await page.evaluate(() => {
    window.postMessage({
      type: 'goToPdfDestination',
      destination: {
        pageIndex: 1,
        view: [42, 302],
        zoom: { mode: 1, params: { x: 42, y: 302, zoom: 0 } },
      },
      title: 'Figure 11.1',
    }, '*');
    window.postMessage({
      type: 'goToPdfDestination',
      destination: {
        pageIndex: 2,
        view: [42, 516],
        zoom: { mode: 1, params: { x: 42, y: 516, zoom: 0 } },
      },
      title: 'Section 12.2',
    }, '*');
  });

  await expectCurrentPage(page, 3);
  await expectDestinationFocusNearText(page, 3, 'Section 12.2 target');
  await expect(page.locator('.pdf-destination-focus')).toHaveCount(1);

  const backButton = page.locator('#pdf-history-back');
  await expect(backButton).toBeVisible();
  await backButton.click();
  await expectCurrentPage(page, 1);
  await expect(backButton).toBeHidden();
});

test('internal link overlays stay vertically aligned with their text-layer rows at high zoom', async ({ page }) => {
  await openInternalDestinationsFixture(page);
  await setCustomZoom(page, 203);

  await expectLinkAlignedWithText(page, 1, 2, 'Figure 11.1');
  await expectLinkAlignedWithText(page, 1, 3, 'Section 12.2');
});

test('same-page punctuated figure captions focus the figure instead of nearby source prose', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await openInternalDestinationsFixture(page);
  await setCustomZoom(page, 180);

  const pageInput = page.getByRole('spinbutton', { name: 'Page' });
  await pageInput.fill('3');
  await pageInput.press('Enter');
  await expectCurrentPage(page, 3);

  const figureLink = page.locator(
    '#page-3 .pdf-link-overlay[data-target-page="3"][title*="Figure 3-12"]',
  );
  await expect(figureLink).toHaveCount(1);
  await expect(figureLink).toBeVisible();
  await expect(page.locator('#pdf-history-back')).toBeHidden();
  await figureLink.locator('.pdf-link-hit-fragment').first().click();

  await expectCurrentPage(page, 3);
  const focus = page.locator('#page-3 .highlight-layer .pdf-destination-focus');
  await expect(focus).toBeVisible();
  const geometry = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll<HTMLElement>(
      '#page-3 .text-layer span[data-item-index]',
    ));
    const byText = (text: string) => {
      const span = spans.find(candidate => candidate.textContent?.startsWith(text));
      if (!span) throw new Error(`Missing synthetic figure text run: ${text}`);
      return span.getBoundingClientRect();
    };
    const intersection = (left: DOMRect, right: DOMRect) => ({
      width: Math.max(
        0,
        Math.min(left.right, right.right) - Math.max(left.left, right.left),
      ),
      height: Math.max(
        0,
        Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top),
      ),
    });
    const focusRect = document.querySelector<HTMLElement>(
      '#page-3 .highlight-layer .pdf-destination-focus',
    )!.getBoundingClientRect();
    const sourceRect = byText('See Figure 3-12 source reference');
    const artworkRect = byText('Figure artwork region');
    const captionRect = byText('Figure 3-12. Caption');
    const sourceOverlap = intersection(focusRect, sourceRect);
    const artworkOverlap = intersection(focusRect, artworkRect);
    const captionOverlap = intersection(focusRect, captionRect);
    return {
      artworkCoverage: {
        horizontal: artworkOverlap.width / artworkRect.width,
        vertical: artworkOverlap.height / artworkRect.height,
      },
      captionCoverage: {
        horizontal: captionOverlap.width / captionRect.width,
        vertical: captionOverlap.height / captionRect.height,
      },
      focusTopAboveArtwork: artworkRect.top - focusRect.top,
      focusBottomBelowCaption: focusRect.bottom - captionRect.bottom,
      sourceOverlapArea: sourceOverlap.width * sourceOverlap.height,
    };
  });

  expect(geometry.artworkCoverage.horizontal).toBeGreaterThan(0.9);
  expect(geometry.artworkCoverage.vertical).toBeGreaterThan(0.9);
  expect(geometry.captionCoverage.horizontal).toBeGreaterThan(0.9);
  expect(geometry.captionCoverage.vertical).toBeGreaterThan(0.9);
  expect(geometry.focusTopAboveArtwork).toBeGreaterThan(40);
  expect(geometry.focusBottomBelowCaption).toBeGreaterThanOrEqual(0);
  expect(geometry.sourceOverlapArea).toBe(0);
  await expect(page.locator('#pdf-history-back')).toBeHidden();
});

test('same-page figures and cross-page sections receive a subtle destination-focus box', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await openInternalDestinationsFixture(page);
  await setCustomZoom(page, 180);

  const pageInput = page.getByRole('spinbutton', { name: 'Page' });
  await pageInput.fill('2');
  await pageInput.press('Enter');
  await expectCurrentPage(page, 2);

  const samePageFigure = page.locator(
    '#page-2 .pdf-link-overlay[data-target-page="2"] .pdf-link-hit-fragment',
  ).first();
  await expect(samePageFigure).toBeVisible();
  await samePageFigure.click();

  await expectCurrentPage(page, 2);
  await expectDestinationFocusNearText(page, 2, 'Figure 11.1 target');
  await expect(page.locator('.pdf-destination-focus')).toHaveCount(1);

  const crossPageSection = page.locator(
    '#page-2 .pdf-link-overlay[data-target-page="3"] .pdf-link-hit-fragment',
  ).first();
  await expect(crossPageSection).toBeVisible();
  await crossPageSection.click();

  await expectCurrentPage(page, 3);
  await expectDestinationFocusNearText(page, 3, 'Section 12.2 target');
  await expect(page.locator('#page-2 .pdf-destination-focus')).toHaveCount(0);
  await expect(page.locator('.pdf-destination-focus')).toHaveCount(1);
});

test('destination focus box expires after its emphasis interval', async ({ page }) => {
  await openInternalDestinationsFixture(page);

  const figureLink = page.locator(
    '#page-1 .pdf-link-overlay[data-target-page="2"] .pdf-link-hit-fragment',
  ).first();
  await figureLink.click();
  const focus = page.locator('#page-2 .pdf-destination-focus');
  await expect(focus).toBeVisible();
  await expect(focus).toHaveClass(/animate/);
  await expect(focus).toHaveCount(0, { timeout: 4_000 });
  await expect(page.locator('.pdf-destination-focus')).toHaveCount(0);
});

test('a lone body reference on a shifted page remains clickable instead of selecting text', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await page.goto(shiftedSingleLinkUrl);
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });
  await expect(page.locator('#page-1 .pdf-link-overlay')).toHaveCount(1);
  await page.evaluate(() => {
    (window as any).__shiftedSingleLinkCanvasBeforeZoom =
      document.querySelector('#page-1 .pdf-canvas');
  });

  const zoom = page.getByRole('spinbutton', { name: 'Zoom' });
  await zoom.fill('203');
  await zoom.press('Enter');
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#page-1 .pdf-canvas')
      !== (window as any).__shiftedSingleLinkCanvasBeforeZoom
  ))).toBe(true);

  const geometry = await page.evaluate(() => {
    const label = Array.from(
      document.querySelectorAll<HTMLElement>('#page-1 .text-layer span[data-item-index]'),
    ).find(span => span.textContent?.includes('Section 12.2.4.1'));
    const link = document.querySelector<HTMLElement>('#page-1 .pdf-link-overlay');
    if (!label || !link) throw new Error('Missing shifted single-link geometry');
    const labelRect = label.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    return {
      ariaLabel: link.getAttribute('aria-label'),
      targetPage: link.dataset.targetPage,
      topDelta: linkRect.top - labelRect.top,
      bottomDelta: linkRect.bottom - labelRect.bottom,
      leftDelta: linkRect.left - labelRect.left,
      rightDelta: linkRect.right - labelRect.right,
      clickX: (labelRect.left + labelRect.right) / 2,
      clickY: (labelRect.top + labelRect.bottom) / 2,
    };
  });

  expect(geometry.targetPage).toBe('2');
  expect(geometry.ariaLabel).toMatch(/Section 12\.2\.4\.1.*page 2/i);
  expect(geometry.topDelta).toBeCloseTo(0, 0);
  expect(geometry.bottomDelta).toBeCloseTo(0, 0);
  expect(geometry.leftDelta).toBeLessThanOrEqual(0);
  expect(geometry.rightDelta).toBeGreaterThanOrEqual(0);

  await page.mouse.click(geometry.clickX, geometry.clickY);
  await expectCurrentPage(page, 2, 2);
  await expect(page.locator('#page-2 .text-layer')).toContainText('Section 12.2.4.1 target');
  await expect(page.locator('#selection-toolbar')).toHaveCount(0);
});

test('a normal glyph click navigates while adjacent ordinary text remains a selection', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await page.goto(shiftedSingleLinkUrl);
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });
  await page.evaluate(() => {
    (window as any).__pointerRoutingCanvasBeforeZoom =
      document.querySelector('#page-1 .pdf-canvas');
  });

  const zoom = page.getByRole('spinbutton', { name: 'Zoom' });
  await zoom.fill('203');
  await zoom.press('Enter');
  await expect(zoom).toHaveValue('203');
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#page-1 .pdf-canvas')
      !== (window as any).__pointerRoutingCanvasBeforeZoom
  ))).toBe(true);

  const linkFragment = page.locator(
    '#page-1 .pdf-link-overlay[data-target-page="2"] .pdf-link-hit-fragment',
  ).first();
  await expect(linkFragment).toBeVisible();
  const linkBox = await linkFragment.boundingBox();
  expect(linkBox).not.toBeNull();
  if (!linkBox) return;

  // Use the real pointer path rather than Locator.click(), so this covers the
  // event-routing conflict between the link overlay and custom text selection.
  await page.mouse.click(
    linkBox.x + linkBox.width / 2,
    linkBox.y + linkBox.height / 2,
  );
  await expectCurrentPage(page, 2, 2);
  await expect(page.locator('#selection-toolbar')).toHaveCount(0);

  const backButton = page.locator('#pdf-history-back');
  await expect(backButton).toBeVisible();
  await backButton.click();
  await expectCurrentPage(page, 1, 2);
  await expect(backButton).toBeHidden();

  const ordinaryText = page.locator('#page-1 .text-layer span[data-item-index]')
    .filter({ hasText: 'The visible reference itself must receive the click.' })
    .first();
  await expect(ordinaryText).toBeVisible();
  const ordinaryBox = await ordinaryText.boundingBox();
  expect(ordinaryBox).not.toBeNull();
  if (!ordinaryBox) return;

  const ordinaryY = ordinaryBox.y + ordinaryBox.height / 2;
  const dragStartX = ordinaryBox.x + 4;
  const dragEndX = ordinaryBox.x + Math.min(ordinaryBox.width - 4, 220);
  const ordinaryHitTarget = await page.evaluate(({ x, y }) => (
    document.elementFromPoint(x, y)
      ?.closest<HTMLElement>('.pdf-link-overlay')
      ?.dataset.targetPage
    ?? null
  ), { x: (dragStartX + dragEndX) / 2, y: ordinaryY });
  expect(ordinaryHitTarget).toBeNull();

  await page.evaluate(() => { (window as any).__mockMessages = []; });
  await page.mouse.move(dragStartX, ordinaryY);
  await page.mouse.down();
  await page.mouse.move(dragEndX, ordinaryY, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator('#selection-toolbar')).toBeVisible();
  await expect(page.locator('#selection-toolbar').getByRole('button', { name: /jump/i }))
    .toHaveCount(0);
  await expectCurrentPage(page, 1, 2);
  await expect(backButton).toBeHidden();
  await expect.poll(() => page.evaluate(() => (
    document.querySelectorAll('.pdf-link-overlay:hover').length
  ))).toBe(0);
  await expect.poll(() => page.evaluate(() => (
    (window as any).__mockMessages
      ?.filter((message: any) => message.type === 'selectionChanged')
      .at(-1)
      ?.anchor
      ?.snippet
    ?? ''
  ))).toContain('The visible refere');
});

test('dragging ordinary text into a link glyph selects text without following the link', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await page.goto(shiftedSingleLinkUrl);
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 2/, { timeout: 10_000 });

  const ordinaryText = page.locator('#page-1 .text-layer span[data-item-index]')
    .filter({ hasText: 'The visible reference itself must receive the click.' })
    .first();
  const linkFragment = page.locator(
    '#page-1 .pdf-link-overlay[data-target-page="2"] .pdf-link-hit-fragment',
  ).first();
  await expect(ordinaryText).toBeVisible();
  await expect(linkFragment).toBeVisible();
  const ordinaryBox = await ordinaryText.boundingBox();
  const linkBox = await linkFragment.boundingBox();
  expect(ordinaryBox).not.toBeNull();
  expect(linkBox).not.toBeNull();
  if (!ordinaryBox || !linkBox) return;

  await page.evaluate(() => { (window as any).__mockMessages = []; });
  await page.mouse.move(
    ordinaryBox.x + ordinaryBox.width - 4,
    ordinaryBox.y + ordinaryBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    linkBox.x + 4,
    linkBox.y + linkBox.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();

  await expectCurrentPage(page, 1, 2);
  await expect(page.locator('#pdf-history-back')).toBeHidden();
  await expect(page.locator('#selection-toolbar')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__mockMessages
      ?.filter((message: any) => message.type === 'selectionChanged')
      .at(-1)
      ?.anchor
      ?.snippet
    ?? ''
  ))).toContain('The visible reference itself');
});

test('non-zero page origins keep visible contents rows bound to their own destinations', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await page.goto(shiftedContentsUrl);
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 5/, { timeout: 10_000 });
  await expect(page.locator('#page-1 .pdf-link-overlay')).toHaveCount(4);
  await page.evaluate(() => {
    (window as any).__shiftedContentsCanvasBeforeZoom =
      document.querySelector('#page-1 .pdf-canvas');
  });

  const zoom = page.getByRole('spinbutton', { name: 'Zoom' });
  await zoom.fill('203');
  await zoom.press('Enter');
  await expect(zoom).toHaveValue('203');
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#page-1 .pdf-canvas')
      !== (window as any).__shiftedContentsCanvasBeforeZoom
  ))).toBe(true);
  await expect(page.locator('#page-1 .pdf-link-overlay')).toHaveCount(4);
  await page.evaluate(() => {
    const label = Array.from(
      document.querySelectorAll<HTMLElement>('#page-1 .text-layer span[data-item-index]'),
    ).find(span => span.textContent?.includes('12.2 Radiometry'));
    label?.scrollIntoView({ block: 'center', inline: 'nearest' });
  });

  const geometry = await page.evaluate(() => {
    const spans = Array.from(
      document.querySelectorAll<HTMLElement>('#page-1 .text-layer span[data-item-index]'),
    );
    const label = spans.find(span => span.textContent?.includes('12.2 Radiometry'));
    if (!label) throw new Error('Missing visible 12.2 contents row');
    const labelRect = label.getBoundingClientRect();
    const rowCenterY = (labelRect.top + labelRect.bottom) / 2;
    const rowSpans = spans.filter(span => {
      const rect = span.getBoundingClientRect();
      return Math.abs((rect.top + rect.bottom) / 2 - rowCenterY) <= 2;
    });
    const rowLeft = Math.min(...rowSpans.map(span => span.getBoundingClientRect().left));
    const rowRight = Math.max(...rowSpans.map(span => span.getBoundingClientRect().right));
    const links = Array.from(
      document.querySelectorAll<HTMLElement>('#page-1 .pdf-link-overlay'),
    ).map(element => ({ element, rect: element.getBoundingClientRect() }))
      .sort((left, right) => left.rect.top - right.rect.top);
    const link = links.find(candidate => (
      rowCenterY >= candidate.rect.top && rowCenterY <= candidate.rect.bottom
    ));
    if (!link) throw new Error('No link overlay covers the visible 12.2 row');
    const minimumGap = Math.min(
      ...links.slice(1).map((candidate, index) => (
        candidate.rect.top - links[index]!.rect.bottom
      )),
    );
    return {
      ariaLabel: link.element.getAttribute('aria-label'),
      title: link.element.getAttribute('title'),
      targetPage: link.element.dataset.targetPage,
      topDelta: link.rect.top - labelRect.top,
      bottomDelta: link.rect.bottom - labelRect.bottom,
      leftPadding: rowLeft - link.rect.left,
      rightPadding: link.rect.right - rowRight,
      minimumGap,
      clickX: labelRect.left + Math.min(12, labelRect.width / 2),
      clickY: rowCenterY,
    };
  });

  expect(geometry.targetPage).toBe('3');
  expect(geometry.ariaLabel).toMatch(/12\.2 Radiometry.*141.*page 3/i);
  expect(geometry.title).toMatch(/12\.2 Radiometry.*141/i);
  expect(geometry.topDelta).toBeCloseTo(0, 0);
  expect(geometry.bottomDelta).toBeCloseTo(0, 0);
  expect(geometry.leftPadding).toBeGreaterThanOrEqual(0);
  expect(geometry.rightPadding).toBeGreaterThanOrEqual(0);
  expect(geometry.minimumGap).toBeGreaterThanOrEqual(-1);

  // Exercise the visible row itself. Selecting by data-target-page here would
  // conceal the original defect, where 12.4's button occupied the 12.2 row.
  await page.mouse.click(geometry.clickX, geometry.clickY);
  await expectCurrentPage(page, 3, 5);
  await expect(page.locator('#page-3 .text-layer')).toContainText('Section 12.2 target');
  await expect(page.locator('#page-info')).not.toHaveText(/Page 5 \/ 5/);
});

test('contents links only hit visible glyphs instead of the blank space between columns', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await page.goto(shiftedContentsUrl);
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 5/, { timeout: 10_000 });
  await page.evaluate(() => {
    (window as any).__blankHitCanvasBeforeZoom =
      document.querySelector('#page-1 .pdf-canvas');
  });
  const zoom = page.getByRole('spinbutton', { name: 'Zoom' });
  await zoom.fill('203');
  await zoom.press('Enter');
  await expect(zoom).toHaveValue('203');
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#page-1 .pdf-canvas')
      !== (window as any).__blankHitCanvasBeforeZoom
  ))).toBe(true);
  await expect.poll(
    () => page.locator('#page-1 .pdf-link-overlay').count(),
  ).toBeGreaterThanOrEqual(4);

  const hitPoints = await page.evaluate(() => {
    const spans = Array.from(
      document.querySelectorAll<HTMLElement>('#page-1 .text-layer span[data-item-index]'),
    );
    const title = spans.find(span => span.textContent?.includes('12.2 Radiometry'));
    const pageNumber = spans.find(span => span.textContent?.trim() === '141');
    if (!title || !pageNumber) throw new Error('Missing visible 12.2 contents glyphs');

    title.scrollIntoView({ block: 'center', inline: 'nearest' });
    const titleRect = title.getBoundingClientRect();
    const pageNumberRect = pageNumber.getBoundingClientRect();
    const y = (Math.max(titleRect.top, pageNumberRect.top)
      + Math.min(titleRect.bottom, pageNumberRect.bottom)) / 2;
    const titleX = (titleRect.left + titleRect.right) / 2;
    const pageNumberX = (pageNumberRect.left + pageNumberRect.right) / 2;
    const blankX = (titleRect.right + pageNumberRect.left) / 2;
    const targetPageAt = (x: number) => (
      document.elementFromPoint(x, y)
        ?.closest<HTMLElement>('.pdf-link-overlay')
        ?.dataset.targetPage
      ?? null
    );

    return {
      titleX,
      pageNumberX,
      blankX,
      y,
      gap: pageNumberRect.left - titleRect.right,
      titleTargetPage: targetPageAt(titleX),
      pageNumberTargetPage: targetPageAt(pageNumberX),
      blankTargetPage: targetPageAt(blankX),
    };
  });

  expect(hitPoints.gap).toBeGreaterThan(40);
  expect(hitPoints.titleTargetPage).toBe('3');
  expect(hitPoints.pageNumberTargetPage).toBe('3');
  expect(hitPoints.blankTargetPage).toBeNull();

  await page.mouse.move(hitPoints.blankX, hitPoints.y);
  await expect.poll(() => page.evaluate(() => (
    document.querySelectorAll('.pdf-link-overlay:hover').length
  ))).toBe(0);
  await page.mouse.click(hitPoints.blankX, hitPoints.y);
  await expectCurrentPage(page, 1, 5);
  await expect(page.locator('#pdf-history-back')).toBeHidden();

  await page.mouse.click(hitPoints.pageNumberX, hitPoints.y);
  await expectCurrentPage(page, 3, 5);
  await expect(page.locator('#page-3 .text-layer')).toContainText('Section 12.2 target');
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
  await figureLink.locator('.pdf-link-hit-fragment').first().click();

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
  await sectionLink.locator('.pdf-link-hit-fragment').first().click();

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

test('same-page destinations do not create Back history while cross-page destinations do', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await openInternalDestinationsFixture(page);
  await setCustomZoom(page, 180);

  const pageInput = page.getByRole('spinbutton', { name: 'Page' });
  await pageInput.fill('2');
  await pageInput.press('Enter');
  await expectCurrentPage(page, 2);

  const backButton = page.locator('#pdf-history-back');
  await expect(backButton).toBeHidden();

  const samePageLink = page.locator(
    '#page-2 .pdf-link-overlay[data-target-page="2"]',
  );
  await expect(samePageLink).toHaveCount(1);
  await samePageLink.locator('.pdf-link-hit-fragment').first().click();
  await expectCurrentPage(page, 2);
  await expectDestinationNearViewerTop(page, 2, 'Figure 11.1 target');
  const samePageHistoryVisible = await backButton.isVisible();

  // Pop the currently redundant entry so the cross-page case independently
  // demonstrates that real page changes still retain the source location.
  if (samePageHistoryVisible) {
    await backButton.click();
    await expectCurrentPage(page, 2);
    await expect(backButton).toBeHidden();
  }

  const crossPageLink = page.locator(
    '#page-2 .pdf-link-overlay[data-target-page="3"]',
  );
  await expect(crossPageLink).toHaveCount(1);
  await crossPageLink.locator('.pdf-link-hit-fragment').first().click();
  await expectCurrentPage(page, 3);
  await expectDestinationNearViewerTop(page, 3, 'Section 12.2 target');
  const crossPageHistoryVisible = await backButton.isVisible();

  expect({
    samePageHistoryVisible,
    crossPageHistoryVisible,
  }).toEqual({
    samePageHistoryVisible: false,
    crossPageHistoryVisible: true,
  });
});

async function openInternalDestinationsFixture(page: Page): Promise<void> {
  await page.goto(viewerUrl);
  await expect(page.locator('#page-info')).toHaveText(/Page 1 \/ 3/, { timeout: 10_000 });
  await expect(page.locator('#page-1 .pdf-link-overlay')).toHaveCount(2);
}

async function expectLinkAlignedWithText(
  page: Page,
  sourcePage: number,
  targetPage: number,
  text: string,
): Promise<void> {
  const link = page.locator(
    `#page-${sourcePage} .pdf-link-overlay[data-target-page="${targetPage}"]`,
  );
  const textSpan = page.locator(`#page-${sourcePage} .text-layer span[data-item-index]`)
    .filter({ hasText: text })
    .first();
  await expect(link).toBeVisible();
  await expect(textSpan).toBeVisible();

  const geometry = await page.evaluate(({ sourcePage, targetPage, text }) => {
    const linkElement = document.querySelector<HTMLElement>(
      `#page-${sourcePage} .pdf-link-overlay[data-target-page="${targetPage}"]`,
    );
    const textElement = Array.from(
      document.querySelectorAll<HTMLElement>(
        `#page-${sourcePage} .text-layer span[data-item-index]`,
      ),
    ).find(candidate => candidate.textContent?.includes(text));
    if (!linkElement || !textElement) throw new Error(`Missing link or text layer row for ${text}`);
    const linkRect = linkElement.getBoundingClientRect();
    const textRect = textElement.getBoundingClientRect();
    return {
      topDelta: linkRect.top - textRect.top,
      bottomDelta: linkRect.bottom - textRect.bottom,
    };
  }, { sourcePage, targetPage, text });

  expect(geometry.topDelta).toBeCloseTo(0, 0);
  expect(geometry.bottomDelta).toBeCloseTo(0, 0);
}

async function setCustomZoom(page: Page, percent: number): Promise<void> {
  const input = page.getByRole('spinbutton', { name: 'Zoom' });
  await input.fill(String(percent));
  await input.press('Enter');
  await expect(input).toHaveValue(String(percent));
  await expect(page.locator('#page-1 .pdf-link-overlay')).toHaveCount(2);
}

async function expectCurrentPage(
  page: Page,
  pageNumber: number,
  pageCount = 3,
): Promise<void> {
  await expect(page.locator('#page-info')).toHaveText(
    new RegExp(`Page ${pageNumber} / ${pageCount}`),
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
  await expect.poll(async () => target.evaluate((span: HTMLElement) => {
    const viewerRect = document.querySelector<HTMLElement>('#viewer-container')!.getBoundingClientRect();
    return span.getBoundingClientRect().top - viewerRect.top;
  })).toBeLessThanOrEqual(72);
}

async function expectDestinationFocusNearText(
  page: Page,
  pageNumber: number,
  text: string,
): Promise<void> {
  const target = page.locator(`#page-${pageNumber} .text-layer span[data-item-index]`)
    .filter({ hasText: text })
    .first();
  const focus = page.locator(`#page-${pageNumber} .highlight-layer .pdf-destination-focus`);
  await expect(target).toBeVisible();
  await expect(focus).toBeVisible();
  await expect(focus).toHaveCSS('pointer-events', 'none');
  await expect(focus).toHaveCSS('background-color', 'rgba(77, 171, 247, 0.12)');
  await expect(focus).toHaveCSS('border-top-style', 'solid');
  await expect(focus).toHaveCSS('border-top-color', 'rgba(77, 171, 247, 0.38)');

  const geometry = await page.evaluate(({ pageNumber, text }) => {
    const targetElement = Array.from(
      document.querySelectorAll<HTMLElement>(
        `#page-${pageNumber} .text-layer span[data-item-index]`,
      ),
    ).find(candidate => candidate.textContent?.includes(text));
    const focusElement = document.querySelector<HTMLElement>(
      `#page-${pageNumber} .highlight-layer .pdf-destination-focus`,
    );
    if (!targetElement || !focusElement) {
      throw new Error(`Missing destination focus geometry for ${text}`);
    }
    const targetRect = targetElement.getBoundingClientRect();
    const focusRect = focusElement.getBoundingClientRect();
    return {
      leftDelta: focusRect.left - targetRect.left,
      topDelta: focusRect.top - targetRect.top,
      width: focusRect.width,
      height: focusRect.height,
      overlapWidth: Math.max(
        0,
        Math.min(focusRect.right, targetRect.right) - Math.max(focusRect.left, targetRect.left),
      ),
      overlapHeight: Math.max(
        0,
        Math.min(focusRect.bottom, targetRect.bottom) - Math.max(focusRect.top, targetRect.top),
      ),
      targetWidth: targetRect.width,
      targetHeight: targetRect.height,
    };
  }, { pageNumber, text });

  expect(Math.abs(geometry.leftDelta)).toBeLessThanOrEqual(24);
  expect(Math.abs(geometry.topDelta)).toBeLessThanOrEqual(24);
  expect(geometry.width).toBeGreaterThanOrEqual(4);
  expect(geometry.height).toBeGreaterThanOrEqual(4);
  expect(geometry.overlapWidth).toBeGreaterThanOrEqual(geometry.targetWidth * 0.75);
  expect(geometry.overlapHeight).toBeGreaterThanOrEqual(geometry.targetHeight * 0.75);
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

async function finishButtonColorTransition(button: Locator): Promise<void> {
  await button.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map(animation => animation.finished));
  });
}

async function expectAccessibleHistoryButtonContrast(
  button: Locator,
  state: string,
): Promise<void> {
  const contrast = await button.evaluate((element) => {
    const sample = (cssColor: string): [number, number, number, number] => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = cssColor;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return [r / 255, g / 255, b / 255, a / 255];
    };
    const composite = (
      foreground: [number, number, number, number],
      background: [number, number, number, number],
    ): [number, number, number, number] => {
      const alpha = foreground[3] + background[3] * (1 - foreground[3]);
      return [
        (foreground[0] * foreground[3]
          + background[0] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[1] * foreground[3]
          + background[1] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[2] * foreground[3]
          + background[2] * background[3] * (1 - foreground[3])) / alpha,
        alpha,
      ];
    };
    const luminance = ([r, g, b]: [number, number, number, number]): number => {
      const linear = (channel: number): number => (
        channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
      );
      return .2126 * linear(r) + .7152 * linear(g) + .0722 * linear(b);
    };
    const ratio = (
      first: [number, number, number, number],
      second: [number, number, number, number],
    ): number => {
      const light = Math.max(luminance(first), luminance(second));
      const dark = Math.min(luminance(first), luminance(second));
      return (light + .05) / (dark + .05);
    };

    const style = getComputedStyle(element);
    const page = sample('#ffffff');
    const rawSurface = sample(style.backgroundColor);
    const surface = composite(rawSurface, page);
    const foreground = composite(sample(style.color), surface);
    return {
      foreground: style.color,
      surface: style.backgroundColor,
      surfaceAlpha: rawSurface[3],
      foregroundToSurface: ratio(foreground, surface),
      surfaceToPage: ratio(surface, page),
    };
  });

  expect(contrast.surfaceAlpha, `${state} surface must be opaque`).toBe(1);
  expect(
    contrast.foregroundToSurface,
    `${state} icon ${contrast.foreground} on ${contrast.surface}`,
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    contrast.surfaceToPage,
    `${state} surface ${contrast.surface} against the white PDF page`,
  ).toBeGreaterThanOrEqual(3);
}
