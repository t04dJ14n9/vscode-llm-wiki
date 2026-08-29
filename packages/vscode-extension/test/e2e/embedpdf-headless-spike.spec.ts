import { expect, test, type Page } from '@playwright/test';

const viewerUrl = 'http://localhost:8979/embedpdf-spike.html';
const smolLmPdf = [
  process.cwd(),
  'demo-vault/assets/smollm2-when-smol-goes-big-data-centric-training-of-a-small-language-model.pdf',
].join('/');

type Point = { x: number; y: number };

test.describe('EmbedPDF headless migration spike', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 1000 });
  });

  test('GQA page-2 prose stays in the left reading flow in both directions', async ({ page }) => {
    await openHeadlessViewer(page);
    await page.waitForTimeout(700);
    await page.getByRole('button', { name: 'Next page' }).click();
    await page.waitForTimeout(500);

    const caption = { x: 347, y: 287 };
    const leftColumnTail = { x: 590, y: 868 };
    const forward = await selectText(page, caption, leftColumnTail);

    expect(forward).toContain('Figure 2: Overview of grouped-query method.');
    expect(forward).toContain('2.2 Grouped-query attention');
    expect(forward).toContain('while model FLOPs and parameters scale with the');
    expect(forward).not.toMatch(/3 Experiments|Configurations|Uptraining/);

    const selectionMenu = page.locator('.embedpdf-selection-menu');
    await expect(selectionMenu).toHaveCSS(
      'background-color',
      await resolveThemeColor(page, '--vscode-editorWidget-background'),
    );
    await expect(selectionMenu.getByRole('button', { name: /Add to Chat/ }))
      .toHaveCSS(
        'background-color',
        await resolveThemeColor(page, '--vscode-button-background'),
      );
    await expect(selectionMenu.getByRole('button', { name: 'Copy for Agent' }))
      .toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await selectionMenu.getByRole('button', {
      name: 'Add to Chat',
    }).click();
    await expect.poll(() => page.evaluate(() => window.__mockMessages?.some(
      (message: Record<string, unknown>) => (
        message.type === 'selectionAction' && message.action === 'addToCursorChat'
      ),
    ))).toBe(true);

    await page.evaluate(() => window.__embedPdfSpike!.selection.clear('llm-wiki-document'));
    const reverse = await selectText(page, leftColumnTail, caption);
    expect(reverse).toBe(forward);
  });

  test('shows ordinary text highlights continuously during pointer movement', async ({ page }) => {
    await openHeadlessViewer(page);
    await page.waitForTimeout(700);
    await page.getByRole('button', { name: 'Next page' }).click();
    await page.waitForTimeout(500);

    await expect(page.locator('.embedpdf-headless-page[data-page-index="1"] img'))
      .toHaveAttribute('draggable', 'false');
    await page.mouse.move(347, 287);
    await page.mouse.down();
    await page.mouse.move(520, 560, { steps: 12 });

    await expect.poll(() => page.evaluate(() => (
      window.__embedPdfSpike!.selection
        .getHighlightRectsForPage(1, 'llm-wiki-document').length
    ))).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => {
      const pdfPage = document.querySelector('.embedpdf-headless-page[data-page-index="1"]');
      const selectionHost = document.querySelector('.embedpdf-headless-shell') ?? document.body;
      const probe = selectionHost.appendChild(document.createElement('i'));
      probe.style.background = 'var(--embedpdf-selection-fill)';
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return [...(pdfPage?.querySelectorAll<HTMLElement>('div') ?? [])].filter(element => {
        const bounds = element.getBoundingClientRect();
        return getComputedStyle(element).backgroundColor === expected
          && bounds.width > 0
          && bounds.height > 0;
      }).length;
    })).toBeGreaterThan(0);

    await page.evaluate(() => {
      document.documentElement.style.setProperty(
        '--vscode-editor-selectionBackground',
        'rgba(184, 92, 116, .46)',
      );
    });
    await expect(page.locator(
      '.embedpdf-native-selection-layer > div:first-child > div',
    ).first()).toHaveCSS(
      'background-color',
      await resolveThemeColor(page, '--embedpdf-selection-fill'),
    );

    await page.mouse.up();
  });

  test('keeps an active text drag captured when the pointer leaves the PDF page', async ({ page }) => {
    await openHeadlessViewer(page);
    await page.waitForTimeout(700);
    await page.getByRole('button', { name: 'Next page' }).click();
    await page.waitForTimeout(500);

    const pdfPage = page.locator('.embedpdf-headless-page[data-page-index="1"]');
    await page.mouse.move(347, 287);
    await page.mouse.down();
    await page.mouse.move(520, 560, { steps: 8 });
    await expect.poll(() => pdfPage.evaluate(element => element.hasPointerCapture(1))).toBe(true);

    await page.mouse.move(1050, 560, { steps: 4 });
    await expect.poll(() => pdfPage.evaluate(element => element.hasPointerCapture(1))).toBe(true);
    await page.mouse.up();

    await expect.poll(() => page.evaluate(() => (
      window.__embedPdfSpike!.selection.getState('llm-wiki-document').selecting
    ))).toBe(false);
    await expect.poll(() => page.evaluate(() => (
      window.__embedPdfSpike!.selection.getState('llm-wiki-document').selection !== null
      && window.__mockMessages?.some(message => message.type === 'selectionChanged')
    ))).toBe(true);
  });

  test('commits an empty-area marquee and offers Copy for Agent', async ({ page }) => {
    await page.route('**/fixtures/gqa-paper.pdf', route => route.fulfill({
      path: smolLmPdf,
      contentType: 'application/pdf',
    }));
    await openHeadlessViewer(page);
    await page.waitForTimeout(700);
    const pageInput = page.locator('input[aria-label="Page"]');
    await pageInput.fill('5');
    await pageInput.press('Enter');
    await page.waitForTimeout(700);
    await page.evaluate(() => { window.__mockMessages = []; });

    await page.mouse.move(350, 63);
    await page.mouse.down();
    await page.mouse.move(500, 94, { steps: 6 });
    await expect(page.locator('.embedpdf-area-selection-marquee')).toBeVisible();
    await page.mouse.up();

    await expect(page.locator('.embedpdf-area-selection-marquee')).toHaveCount(0);
    await expect(page.locator('.embedpdf-area-selection-rect')).toBeVisible();
    const menu = page.getByRole('toolbar', { name: 'PDF region actions' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Add to Chat' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Copy for Agent' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Copy text' })).toHaveCount(0);

    const change = await page.evaluate(() => window.__mockMessages?.findLast(message => (
      message.type === 'selectionChanged'
      && (message.clipboardSelection as { kind?: string } | undefined)?.kind === 'area'
    )));
    expect(change?.anchor).toMatchObject({
      area: true,
      page: 5,
      snippet: 'Selected PDF region.',
    });
    expect(change?.clipboardSelection).toMatchObject({
      kind: 'area',
      startPage: 5,
      endPage: 5,
    });
    const rect = (change!.clipboardSelection as any).pages[0].rects[0] as number[];
    expect(rect).toHaveLength(4);
    expect(rect[2]).toBeGreaterThan(rect[0]!);
    expect(rect[3]).toBeGreaterThan(rect[1]!);

    await menu.getByRole('button', { name: 'Copy for Agent' }).click();
    await expect.poll(() => page.evaluate(() => window.__mockMessages?.some(
      message => message.type === 'copySelectionForAgent',
    ))).toBe(true);
  });

  test('serializes structured PDF errors instead of reporting object Object', async ({ page }) => {
    await openHeadlessViewer(page);
    const message = await page.evaluate(() => window.__embedPdfSpike!.formatError({
      type: 'reject',
      reason: { code: 26, message: 'Cannot select PDF text' },
    }));
    expect(message).toBe('Cannot select PDF text (code 26)');
    expect(message).not.toContain('[object Object]');
  });

  test('LLM Wiki rectangular adapter selects only the SmolLM table value column', async ({ page }) => {
    await page.route('**/fixtures/gqa-paper.pdf', route => route.fulfill({
      path: smolLmPdf,
      contentType: 'application/pdf',
    }));
    await openHeadlessViewer(page);
    await page.waitForTimeout(700);
    const pageInput = page.locator('input[aria-label="Page"]');
    await pageInput.fill('5');
    await pageInput.press('Enter');
    await page.waitForTimeout(700);

    const selected = await selectText(
      page,
      { x: 543, y: 209 },
      { x: 561, y: 247 },
    );

    expect(selected).toBe('25.6 24.8 22.4 22.7');
    await expect(page.locator('.embedpdf-column-selection-layer'))
      .toHaveAttribute('data-phase', 'committed');
    await expect(page.locator('.embedpdf-column-selection-rect').first())
      .toHaveCSS(
        'background-color',
        await resolveThemeColor(page, '--embedpdf-selection-fill'),
      );
  });

  test('does not mistake a narrow GQA prose drag for a table column', async ({ page }) => {
    await openHeadlessViewer(page);
    const zoom = page.locator('input[aria-label="Zoom"]');
    await zoom.fill('80');
    await zoom.press('Enter');
    const pageInput = page.locator('input[aria-label="Page"]');
    await pageInput.fill('6');
    await pageInput.press('Enter');

    const pdfPage = page.locator('.embedpdf-headless-page[data-page-index="5"]');
    await expect(pdfPage).toBeVisible();
    const bounds = await pdfPage.boundingBox();
    expect(bounds).not.toBeNull();
    const selected = await selectText(
      page,
      { x: bounds!.x + 100, y: bounds!.y + 58 },
      { x: bounds!.x + 112, y: bounds!.y + 360 },
    );

    expect(selected.length).toBeGreaterThan(40);
    await expect(page.locator('.embedpdf-column-selection-rect')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => Boolean(
      window.__embedPdfSpike!.selection.getState('llm-wiki-document').selection,
    ))).toBe(true);
  });

  test('shows rectangular selection feedback before the pointer is released', async ({ page }) => {
    await page.route('**/fixtures/gqa-paper.pdf', route => route.fulfill({
      path: smolLmPdf,
      contentType: 'application/pdf',
    }));
    await openHeadlessViewer(page);
    await page.waitForTimeout(700);
    const pageInput = page.locator('input[aria-label="Page"]');
    await pageInput.fill('5');
    await pageInput.press('Enter');
    await page.waitForTimeout(700);

    await page.mouse.move(543, 209);
    await page.mouse.down();
    await page.mouse.move(549, 221, { steps: 3 });

    const layer = page.locator('.embedpdf-column-selection-layer');
    await expect(layer).toHaveAttribute('data-phase', 'corridor');
    await expect(page.locator('.embedpdf-column-selection-rect'))
      .toHaveCSS(
        'border-color',
        await resolveThemeColor(page, '--embedpdf-selection-edge'),
      );

    await page.mouse.move(561, 247, { steps: 6 });

    await expect(page.locator('.embedpdf-column-selection-rect')).not.toHaveCount(0);
    await expect(layer).toHaveAttribute('data-phase', 'drag');
    await expect.poll(() => page.evaluate(() => (
      window.__embedPdfSpike!.selection
        .getHighlightRectsForPage(4, 'llm-wiki-document').length
    ))).toBe(0);

    await page.mouse.up();
  });

  test('advances one paginated page per wheel gesture with a smooth transition', async ({ page }) => {
    await openHeadlessViewer(page);
    const layout = page.getByRole('combobox', { name: 'Page layout' });
    const viewport = page.locator('.embedpdf-headless-viewport');
    const pageInput = page.locator('input[aria-label="Page"]');

    await layout.selectOption('single');
    await expect(pageInput).toHaveValue('1');
    await expect(page.locator(
      '.embedpdf-headless-page[data-page-index="1"] img',
    )).toHaveAttribute('src', /^(blob:|data:)/);
    await page.locator('.embedpdf-paginated-frame').evaluate(element => {
      element.scrollTop = element.scrollHeight;
    });
    await viewport.hover();

    for (let index = 0; index < 10; index += 1) await page.mouse.wheel(0, 15);
    await expect(pageInput).toHaveValue('2');
    await expect.poll(() => visiblePageIndices(page)).toEqual([1]);
    const activeSpread = page.locator('.embedpdf-paginated-spread[data-paginated-active="true"]');
    await expect(activeSpread)
      .toHaveAttribute('data-page-transition', 'forward');
    await expect(activeSpread)
      .toHaveCSS('animation-name', 'embedpdf-page-enter-forward');

    await page.waitForTimeout(220);
    await page.locator('.embedpdf-paginated-frame').evaluate(element => {
      element.scrollTop = element.scrollHeight;
    });
    for (let index = 0; index < 10; index += 1) await page.mouse.wheel(0, 15);
    await expect(pageInput).toHaveValue('3');

    await page.waitForTimeout(220);
    for (let index = 0; index < 10; index += 1) await page.mouse.wheel(0, -15);
    await expect(pageInput).toHaveValue('2');
    await expect(activeSpread)
      .toHaveAttribute('data-page-transition', 'backward');
  });

  test('pans inside an enlarged paginated page before turning the page', async ({ page }) => {
    await openHeadlessViewer(page);
    await page.getByRole('combobox', { name: 'Page layout' }).selectOption('single');
    const zoom = page.locator('input[aria-label="Zoom"]');
    await zoom.fill('200');
    await zoom.press('Enter');
    await expect(zoom).toHaveValue('200');

    const frame = page.locator('.embedpdf-paginated-frame');
    const pageInput = page.locator('input[aria-label="Page"]');
    await expect.poll(() => frame.evaluate(element => (
      element.scrollHeight - element.clientHeight
    ))).toBeGreaterThan(100);
    await frame.hover();
    await page.mouse.wheel(0, 120);
    await expect.poll(() => frame.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await expect(pageInput).toHaveValue('1');

    await frame.evaluate(element => { element.scrollTop = element.scrollHeight; });
    for (let index = 0; index < 10; index += 1) await page.mouse.wheel(0, 15);
    await expect(pageInput).toHaveValue('2');
  });

  test('renders a full-size centered page in non-continuous mode', async ({ page }) => {
    await page.setViewportSize({ width: 2048, height: 1120 });
    await openHeadlessViewer(page);
    const zoom = page.locator('input[aria-label="Zoom"]');
    await zoom.fill('109');
    await zoom.press('Enter');
    await expect(zoom).toHaveValue('109');
    await page.getByRole('combobox', { name: 'Page layout' }).selectOption('single');

    const activePage = page.locator(
      '.embedpdf-paginated-spread[data-paginated-active="true"] .embedpdf-headless-page',
    );
    await expect(activePage).toHaveCount(1);
    await expect.poll(async () => activePage.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    })).toEqual({ width: 649, height: 918 });
    await expect.poll(() => page.evaluate(() => {
      const viewport = document.querySelector('.embedpdf-headless-viewport')?.getBoundingClientRect();
      const frame = document.querySelector('.embedpdf-paginated-frame')?.getBoundingClientRect();
      return viewport && frame
        ? {
            widthDifference: Math.round(Math.abs(viewport.width - frame.width)),
            heightDifference: Math.round(Math.abs(viewport.height - frame.height)),
          }
        : undefined;
    })).toEqual({ widthDifference: 0, heightDifference: 0 });
  });

  test('ports toolbar modes, zoom, sidebar, search, hover, and link history', async ({ page }) => {
    await openHeadlessViewer(page);
    await page.waitForTimeout(700);

    const toolbar = page.getByRole('toolbar', { name: 'PDF toolbar' });
    await expect(toolbar.getByRole('button', { name: 'Copy for Agent' })).toHaveCount(0);
    await expect(toolbar.getByRole('button', { name: 'Copy text' })).toHaveCount(0);

    const zoom = page.locator('input[aria-label="Zoom"]');
    const initialZoom = Number(await zoom.inputValue());
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(initialZoom);

    const layout = page.getByRole('combobox', { name: 'Page layout' });
    const viewport = page.locator('.embedpdf-headless-viewport');
    await expect(layout).toHaveValue('single-continuous');

    await layout.selectOption('single');
    await expect(viewport).toHaveClass(/paginated/);
    await expect.poll(() => visiblePageIndices(page)).toEqual([0]);
    await expect.poll(() => page.evaluate(() => (
      window.__embedPdfSpike!.registry.getPlugin('spread').provides()
        .forDocument('llm-wiki-document').getSpreadMode()
    ))).toBe('none');

    await page.getByRole('button', { name: 'Next page' }).click();
    await expect.poll(() => visiblePageIndices(page)).toEqual([1]);

    await layout.selectOption('single-continuous');
    await expect(viewport).not.toHaveClass(/paginated/);
    await expect.poll(() => page.locator('.embedpdf-headless-page').count()).toBeGreaterThan(1);

    await layout.selectOption('two');
    await expect(viewport).toHaveClass(/paginated/);
    await expect.poll(() => visiblePageIndices(page)).toEqual([1, 2]);
    await expect.poll(() => page.evaluate(() => (
      window.__embedPdfSpike!.registry.getPlugin('spread').provides()
        .forDocument('llm-wiki-document').getSpreadMode()
    ))).toBe('even');

    await layout.selectOption('two-continuous');
    await expect(viewport).not.toHaveClass(/paginated/);
    await expect.poll(() => page.locator('.embedpdf-headless-page').count()).toBeGreaterThan(2);
    await expect.poll(() => page.evaluate(() => (
      window.__embedPdfSpike!.registry.getPlugin('spread').provides()
        .forDocument('llm-wiki-document').getSpreadMode()
    ))).toBe('even');

    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect(page.locator('.embedpdf-thumbnail')).toHaveCount(7);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('searchbox', { name: 'Find in PDF' }).fill('grouped-query');
    await expect.poll(async () => page.locator('.search-count').innerText()).toContain('/ 12');

    const link = page.locator('.embedpdf-link-overlay').first();
    await link.hover();
    await expect(page.locator('.embedpdf-link-preview')).toContainText('Internal PDF link');
    await link.click();
    await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible();
    await page.getByRole('button', { name: 'Go back' }).click();
  });
});

async function openHeadlessViewer(page: Page): Promise<void> {
  await page.goto(viewerUrl);
  await page.waitForFunction(() => (
    window.__mockMessages?.some((message: { type?: string; implementation?: string }) => (
      message.type === 'embedPdfReady' && message.implementation === 'headless'
    ))
  ));
}

async function visiblePageIndices(page: Page): Promise<number[]> {
  return page.locator('.embedpdf-headless-page').evaluateAll(elements => {
    const viewport = document.querySelector<HTMLElement>('.embedpdf-headless-viewport')
      ?.getBoundingClientRect();
    if (!viewport) return [];
    return elements
      .filter(element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.right > viewport.left
          && rect.left < viewport.right
          && rect.bottom > viewport.top
          && rect.top < viewport.bottom;
      })
      .map(element => Number((element as HTMLElement).dataset.pageIndex))
      .sort((left, right) => left - right);
  });
}

async function resolveThemeColor(page: Page, variable: string): Promise<string> {
  return page.evaluate(name => {
    const selectionHost = document.querySelector('.embedpdf-headless-shell') ?? document.body;
    const probe = selectionHost.appendChild(document.createElement('i'));
    probe.style.color = `var(${name})`;
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, variable);
}

async function selectText(page: Page, start: Point, end: Point): Promise<string> {
  await page.evaluate(() => {
    window.__mockMessages = window.__mockMessages?.filter(
      (message: { type?: string }) => message.type !== 'selectionChanged',
    ) ?? [];
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();

  // Playwright's synthetic mouse-up currently misses PagePointerProvider's
  // pointer-capture endpoint in Chromium. Dispatch the matching pointer event
  // so the plugin completes the same selection range used by a real pointer.
  await page.evaluate(({ x, y }) => {
    document.elementFromPoint(x, y)?.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      clientX: x,
      clientY: y,
      isPrimary: true,
      pointerId: 1,
      pointerType: 'mouse',
    }));
  }, end);

  await page.waitForFunction(() => window.__mockMessages?.some(
    (message: { type?: string }) => message.type === 'selectionChanged',
  ));
  return page.evaluate(() => {
    const message = window.__mockMessages!.findLast(
      (candidate: { type?: string }) => candidate.type === 'selectionChanged',
    ) as { clipboardSelection: { selectedText: string } };
    return message.clipboardSelection.selectedText;
  });
}

declare global {
  interface Window {
    __mockMessages?: Array<Record<string, unknown>>;
    __embedPdfSpike?: {
      registry: {
        getPlugin(id: string): any;
      };
      selection: {
        clear(documentId?: string): void;
        getHighlightRectsForPage(page: number, documentId?: string): unknown[];
        getState(documentId?: string): { selecting: boolean; selection: unknown };
      };
      formatError(value: unknown): string;
    };
  }
}
