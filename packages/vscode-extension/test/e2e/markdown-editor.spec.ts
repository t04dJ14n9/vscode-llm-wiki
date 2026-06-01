import { test, expect } from '@playwright/test';

test.describe('Human Learning — E2E Bidirectional Links', () => {

  async function waitForEditorBootstrap(page: import('@playwright/test').Page): Promise<void> {
    await page.waitForFunction(() =>
      window.__mockMessages?.some((message) => message.type === 'ready'),
      { timeout: 10_000 },
    );
  }

  test('markdown editor loads, receives setText, and renders native source links as clickable widgets', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    // The CodeMirror view is only created when receiving 'setText'
    const testDoc = [
      '# Test Note',
      '',
      'This references a [PDF quote](raw/pdf/paper.pdf#page=7&anchor=anc_pdf_abc123).',
      '',
      'See also [[FlashAttention]] for background.',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, testDoc);

    // Wait for the editor to appear
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    // The native PDF link should be replaced by an .cm-hl-link widget button
    const linkWidget = page.locator('.cm-hl-link');
    await expect(linkWidget.first()).toBeVisible({ timeout: 3000 });

    // The wiki link is also rendered as an .cm-hl-link widget
    const widgets = page.locator('.cm-hl-link');
    const count = await widgets.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('editor sends edit messages on document change', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    // Create editor by sending setText
    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, '# Initial');

    // Wait for editor
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    // Type in the editor
    await page.click('.cm-content');
    await page.keyboard.type(' added text');

    // Wait and verify edit message was sent
    await page.waitForFunction(() =>
      window.__mockMessages?.some((m) => m.type === 'edit'),
      { timeout: 5000 },
    );

    const editMessages = await page.evaluate(() =>
      window.__mockMessages?.filter((m) => m.type === 'edit')
    );

    expect(editMessages.length).toBeGreaterThan(0);
    expect(editMessages[editMessages.length - 1].text).toContain('added text');
  });

  test('editor sends raw source selection offsets when selection changes', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    const text = '# Note\nAlpha **beta** gamma';
    await page.evaluate((documentText) => {
      window.postMessage({ type: 'setText', text: documentText }, '*');
    }, text);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    const selection = await page.evaluate(() => {
      const view = window.__cmView;
      const from = view.state.doc.toString().indexOf('**beta**');
      const to = from + '**beta**'.length;
      view.dispatch({ selection: { anchor: from, head: to } });
      return { from, to };
    });

    await page.waitForFunction(({ from, to }) =>
      window.__mockMessages?.some((message) =>
        message.type === 'selectionChanged' &&
        message.selection?.from === from &&
        message.selection?.to === to
      ),
      selection,
      { timeout: 5000 },
    );

    const lastSelection = await page.evaluate(() =>
      window.__mockMessages?.filter((message) => message.type === 'selectionChanged').at(-1)?.selection
    );
    expect(lastSelection).toEqual(selection);
  });

  test('markdown editor applies host-provided typography settings', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, '# Styled note\n\nBody copy');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    await page.evaluate(() => {
      window.postMessage({
        type: 'updateSettings',
        settings: {
          fontFamily: 'Fira Code',
          fontSize: '17px',
          fontWeight: '500',
          lineHeight: '29px',
          letterSpacing: '1.25px',
        },
      }, '*');
    });

    await page.waitForFunction(() => {
      const scroller = document.querySelector('.cm-scroller');
      const content = document.querySelector('.cm-content');
      if (!scroller || !content) return false;
      const scrollerStyle = getComputedStyle(scroller);
      const contentStyle = getComputedStyle(content);
      return scrollerStyle.fontFamily.includes('Fira Code')
        && scrollerStyle.fontSize === '17px'
        && scrollerStyle.fontWeight === '500'
        && contentStyle.lineHeight === '29px'
        && contentStyle.letterSpacing === '1.25px';
    }, { timeout: 5000 });

    const styles = await page.evaluate(() => {
      const scroller = document.querySelector('.cm-scroller');
      const content = document.querySelector('.cm-content');
      const scrollerStyle = scroller ? getComputedStyle(scroller) : null;
      const contentStyle = content ? getComputedStyle(content) : null;
      return {
        fontFamily: scrollerStyle?.fontFamily ?? '',
        fontSize: scrollerStyle?.fontSize ?? '',
        fontWeight: scrollerStyle?.fontWeight ?? '',
        lineHeight: contentStyle?.lineHeight ?? '',
        letterSpacing: contentStyle?.letterSpacing ?? '',
      };
    });

    expect(styles.fontFamily).toContain('Fira Code');
    expect(styles.fontSize).toBe('17px');
    expect(styles.fontWeight).toBe('500');
    expect(styles.lineHeight).toBe('29px');
    expect(styles.letterSpacing).toBe('1.25px');
  });

  test('markdown editor search panel uses compact VS Code find-widget layout', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, [
      '# Search Layout',
      '',
      'The search panel should feel like the native VS Code find widget.',
      'Search should stay compact and avoid stretching across the editor.',
      'Another search target keeps next and previous active.',
    ].join('\n'));

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.click('.cm-content');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');

    const searchPanel = page.locator('.cm-search');
    await expect(searchPanel).toBeVisible();

    const metrics = await page.evaluate(() => {
      const editor = document.querySelector<HTMLElement>('.cm-editor');
      const panel = document.querySelector<HTMLElement>('.cm-panel.cm-search');
      const input = panel?.querySelector<HTMLInputElement>('input[name="search"]');
      const buttons = Array.from(panel?.querySelectorAll<HTMLButtonElement>('button') ?? []);
      if (!editor || !panel || !input) {
        return null;
      }
      const editorRect = editor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const inputRect = input.getBoundingClientRect();
      return {
        editorWidth: Math.round(editorRect.width),
        panelWidth: Math.round(panelRect.width),
        panelTopGap: Math.round(panelRect.top - editorRect.top),
        panelRightGap: Math.round(editorRect.right - panelRect.right),
        inputHeight: Math.round(inputRect.height),
        buttonWidths: buttons.map(button => Math.round(button.getBoundingClientRect().width)),
        buttonBackgroundImages: buttons.map(button => getComputedStyle(button).backgroundImage),
        buttonColors: buttons.map(button => getComputedStyle(button).color),
        buttonLabels: buttons.map(button => button.textContent?.trim() ?? ''),
      };
    });

    expect(metrics).not.toBeNull();
    expect(metrics!.editorWidth).toBeGreaterThan(900);
    expect(metrics!.panelWidth).toBeLessThanOrEqual(420);
    expect(metrics!.panelTopGap).toBeGreaterThanOrEqual(6);
    expect(metrics!.panelTopGap).toBeLessThanOrEqual(12);
    expect(metrics!.panelRightGap).toBeGreaterThanOrEqual(6);
    expect(metrics!.panelRightGap).toBeLessThanOrEqual(12);
    expect(metrics!.inputHeight).toBeGreaterThanOrEqual(24);
    expect(metrics!.inputHeight).toBeLessThanOrEqual(28);
    expect(metrics!.buttonWidths.every(width => width <= 28)).toBe(true);
    expect(metrics!.buttonBackgroundImages.every(image => image === 'none')).toBe(true);
    expect(metrics!.buttonColors.every(color => color !== 'rgb(0, 0, 0)')).toBe(true);
    expect(metrics!.buttonLabels).toContain('×');
  });

  test('markdown editor uses an Obsidian-like readable content measure', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('http://localhost:8979/test.html');

    const longParagraph = 'This requires two passes over the data: one to find the max for numerical stability, and one to compute the sum and normalize before the attention tile can continue through the rest of the algorithm.';
    const doc = [
      '# Readable Measure',
      '',
      'Short body line.',
      '',
      longParagraph,
      '',
      '```python',
      'm_new = max(m, max(x_i))',
      'd = d * exp(m - m_new) + sum(exp(x_i - m_new))',
      '```',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-codeblock')).toBeVisible();

    const layout = await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>('.cm-content');
      const scroller = document.querySelector<HTMLElement>('.cm-scroller');
      const paragraph = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent?.startsWith('This requires two passes'));
      const codeBlock = document.querySelector<HTMLElement>('.cm-hybrid-codeblock-inner');
      const normalLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent === 'Short body line.');
      const contentRect = content?.getBoundingClientRect();
      const scrollerRect = scroller?.getBoundingClientRect();
      const paragraphRect = paragraph?.getBoundingClientRect();
      const codeRect = codeBlock?.getBoundingClientRect();
      const normalRect = normalLine?.getBoundingClientRect();
      return {
        contentWidth: contentRect?.width ?? 0,
        scrollerWidth: scrollerRect?.width ?? 0,
        paragraphHeight: paragraphRect?.height ?? 0,
        normalHeight: normalRect?.height ?? 0,
        codeWidth: codeRect?.width ?? 0,
      };
    });

    expect(layout.scrollerWidth).toBeGreaterThan(1100);
    expect(layout.contentWidth).toBeGreaterThan(500);
    expect(layout.contentWidth).toBeLessThanOrEqual(860);
    expect(layout.codeWidth).toBeLessThanOrEqual(layout.contentWidth + 1);
    expect(layout.paragraphHeight).toBeGreaterThan(layout.normalHeight * 1.5);
  });

  test('markdown editor defaults to prose typography while code stays monospace', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '# Typography Check',
      '',
      'Body text with `inline code` and **bold emphasis**.',
      '',
      '```ts',
      'const answer = 42;',
      '```',
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-heading-line-1')).toBeVisible();
    await expect(page.locator('.cm-hybrid-inline-code')).toBeVisible();
    await expect(page.locator('.cm-hybrid-codeblock-content-line')).toBeVisible();

    const styles = await page.evaluate(() => {
      const bodyLine = document.querySelectorAll('.cm-line')[2];
      const heading = document.querySelector('.cm-hybrid-heading-line-1');
      const inlineCode = document.querySelector('.cm-hybrid-inline-code');
      const codeBlock = document.querySelector('.cm-hybrid-codeblock-content-line');
      const bodyStyle = bodyLine ? getComputedStyle(bodyLine) : null;
      const headingStyle = heading ? getComputedStyle(heading) : null;
      const inlineCodeStyle = inlineCode ? getComputedStyle(inlineCode) : null;
      const codeBlockStyle = codeBlock ? getComputedStyle(codeBlock) : null;
      return {
        bodyFontFamily: bodyStyle?.fontFamily ?? '',
        bodyFontSize: bodyStyle?.fontSize ?? '',
        headingFontFamily: headingStyle?.fontFamily ?? '',
        headingFontSize: headingStyle?.fontSize ?? '',
        inlineCodeFontFamily: inlineCodeStyle?.fontFamily ?? '',
        codeBlockFontFamily: codeBlockStyle?.fontFamily ?? '',
      };
    });

    const monospaceFamily = /monospace|ui-monospace|Menlo|Monaco|Consolas|Courier|Fira Code/i;
    expect(styles.bodyFontFamily).not.toMatch(monospaceFamily);
    expect(styles.headingFontFamily).not.toMatch(monospaceFamily);
    expect(styles.inlineCodeFontFamily).toMatch(monospaceFamily);
    expect(styles.codeBlockFontFamily).toMatch(monospaceFamily);
    expect(Number.parseFloat(styles.headingFontSize)).toBeGreaterThan(Number.parseFloat(styles.bodyFontSize));
  });

  test('markdown editor does not highlight the active line number', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, '# Active line\n\nBody copy\n\nLast line');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.click('.cm-content');
    await page.evaluate(() => {
      const editorView = window.__cmView;
      editorView.dispatch({ selection: { anchor: editorView.state.doc.length } });
    });

    await page.waitForFunction(() => document.querySelectorAll('.cm-gutterElement').length > 0, { timeout: 5000 });

    const gutterState = await page.evaluate(() => ({
      activeLineGutterCount: document.querySelectorAll('.cm-activeLineGutter').length,
      activeLineNumber: document.querySelector('.cm-activeLineGutter')?.textContent ?? null,
    }));

    expect(gutterState.activeLineGutterCount).toBe(0);
    expect(gutterState.activeLineNumber).toBeNull();
  });

  test('markdown editor does not paint an active-line row background', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, '# Obsidian active line\n\nBody copy\n\nLast line');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.click('.cm-content');
    await page.evaluate(() => {
      const editorView = window.__cmView;
      const target = editorView.state.doc.line(3);
      editorView.dispatch({ selection: { anchor: target.from + 2 } });
    });

    const activeLineState = await page.evaluate(() => ({
      activeLineCount: document.querySelectorAll('.cm-activeLine').length,
      activeLineBackground: document.querySelector('.cm-activeLine')
        ? getComputedStyle(document.querySelector('.cm-activeLine')!).backgroundColor
        : null,
    }));

    expect(activeLineState.activeLineCount).toBe(0);
    expect(activeLineState.activeLineBackground).toBeNull();
  });

  test('markdown editor renders frontmatter as Obsidian-like properties and starts typing in the body', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '---',
      'id: concept_math_code',
      'tags: [test, math, code]',
      'title: Math and Code',
      '---',
      '',
      '# Math and Code',
      '',
      'Body copy',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    await expect(page.locator('.cm-hybrid-properties')).toBeVisible();
    await expect(page.locator('.cm-hybrid-properties')).toContainText('Properties');
    const propertyNames = await page.locator('.cm-hybrid-property-name-input')
      .evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value));
    expect(propertyNames).toEqual(['id', 'tags', 'title']);
    await expect(page.locator('.cm-hybrid-property-chip')).toContainText(['test', 'math', 'code']);

    const renderedText = await page.locator('.cm-content').textContent();
    expect(renderedText).not.toContain('---');
    expect(renderedText).not.toContain('tags: [test, math, code]');

    await page.keyboard.type('Intro ');

    const editorState = await page.evaluate(() => {
      const text = window.__cmView.state.doc.toString();
      return {
        text,
        startsWithProbe: text.startsWith('Intro '),
      };
    });

    expect(editorState.startsWithProbe).toBe(false);
    expect(editorState.text).toContain('---\n\nIntro # Math and Code');
  });

  test('markdown editor shows an Obsidian-like document title above properties', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '---',
      'id: concept_math_code',
      'tags: [test, math, code]',
      '---',
      '',
      '# Math and Code',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Math and Code' }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    const title = page.locator('.cm-hybrid-document-title-input');
    const properties = page.locator('.cm-hybrid-properties');
    await expect(title).toHaveValue('Math and Code');
    await expect(properties).toBeVisible();

    const layout = await page.evaluate(() => {
      const titleRect = document.querySelector('.cm-hybrid-document-title')?.getBoundingClientRect();
      const propertiesRect = document.querySelector('.cm-hybrid-properties')?.getBoundingClientRect();
      return {
        titleTop: titleRect?.top ?? 0,
        propertiesTop: propertiesRect?.top ?? 0,
        text: window.__cmView.state.doc.toString(),
      };
    });

    expect(layout.titleTop).toBeLessThan(layout.propertiesTop);
    expect(layout.text.startsWith('Math and Code')).toBe(false);
  });

  test('copying from live preview puts raw markdown on the clipboard without the title widget', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '# Online Softmax',
      '',
      'For a vector $x = [x_1, ..., x_n]$:',
      '',
      '$$',
      'softmax(x_i) = exp(x_i) / sum(exp(x_j))',
      '$$',
      '',
      '```python',
      'm = -inf  # running max',
      'd = 0     # running sum',
      '```',
      '',
      'For details see [[FlashAttention]] and [PDF link](raw/pdf/flash-attention.pdf#page=7&anchor=anc_pdf).',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Online Softmax' }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-document-title-input')).toHaveValue('Online Softmax');
    await expect(page.locator('.cm-hybrid-heading-line-1')).toBeVisible();
    await expect(page.locator('.cm-hybrid-math-block')).toBeVisible();
    await expect(page.locator('.cm-hybrid-codeblock')).toBeVisible();

    await page.locator('.cm-content').click();
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: 0 } });
      const content = document.querySelector('.cm-content');
      if (!content) throw new Error('Missing CodeMirror content');
      const range = document.createRange();
      range.selectNodeContents(content);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });

    const copied = await page.evaluate(() => new Promise<string>((resolve) => {
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copied).toBe(doc);
  });

  test('keyboard copy all from live preview puts raw markdown on the clipboard', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '# Copy All Heading',
      '',
      'Paragraph with **bold** text and [[Target Note]].',
      '',
      '```python',
      'm = -inf',
      'd = 0',
      '```',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.locator('.cm-content').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');

    await page.evaluate(() => {
      const testWindow = window as typeof window & { __keyboardCopiedText?: string };
      testWindow.__keyboardCopiedText = undefined;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            testWindow.__keyboardCopiedText = text;
          },
        },
      });
    });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');

    await expect.poll(() => page.evaluate(() => {
      const testWindow = window as typeof window & { __keyboardCopiedText?: string };
      return testWindow.__keyboardCopiedText
        ?? window.__mockMessages?.filter((message) => message.type === 'copyText').at(-1)?.text
        ?? null;
    })).toBe(doc);
  });

  test('copying a native selection through rendered preview widgets falls back to raw markdown', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '# Online Softmax',
      '',
      'For details see [[FlashAttention]].',
      '',
      '```python',
      'm = -inf  # running max',
      'd = 0     # running sum',
      '```',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Online Softmax' }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-heading-line-1')).toBeVisible();
    await expect(page.locator('.cm-hybrid-codeblock')).toBeVisible();

    await page.evaluate(() => {
      const headingText = document.querySelector('.cm-hybrid-heading-line-1')?.firstChild;
      const codeLine = Array.from(document.querySelectorAll('.cm-hybrid-codeblock-content-line'))
        .find(element => element.textContent?.includes('d = 0'));
      if (!headingText || !codeLine) throw new Error('Missing rendered preview text nodes');
      const range = document.createRange();
      range.setStart(headingText, 0);
      range.setEnd(codeLine, codeLine.childNodes.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });

    const copied = await page.evaluate(() => new Promise<string>((resolve) => {
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copied).toBe(doc);
  });

  test('copying a rendered link widget puts the raw markdown link on the clipboard', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Links:',
      '',
      'See [[FlashAttention]] and [paper](raw/pdf/flash-attention.pdf).',
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Links' }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    await expect(page.locator('.cm-hl-link')).toHaveCount(2);

    const copiedWikiLink = await page.evaluate(() => new Promise<string>((resolve) => {
      const linkText = document.querySelector('.cm-hl-link')?.firstChild;
      if (!linkText) throw new Error('Missing rendered wiki link text');
      const range = document.createRange();
      range.setStart(linkText, 0);
      range.setEnd(linkText, linkText.textContent?.length ?? 0);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copiedWikiLink).toBe('[[FlashAttention]]');

    const copiedPdfLink = await page.evaluate(() => new Promise<string>((resolve) => {
      const linkText = document.querySelectorAll('.cm-hl-link')[1]?.firstChild;
      if (!linkText) throw new Error('Missing rendered PDF link text');
      const range = document.createRange();
      range.setStart(linkText, 0);
      range.setEnd(linkText, linkText.textContent?.length ?? 0);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copiedPdfLink).toBe('[paper](raw/pdf/flash-attention.pdf)');
  });

  test('copying a rendered image widget puts the raw markdown image on the clipboard', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const imageSource = '![Attention diagram](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)';
    const doc = [
      'Before image',
      '',
      imageSource,
      '',
      'After image',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Images' }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    await expect(page.locator('.cm-hybrid-image')).toBeVisible();

    const copiedImage = await page.evaluate(() => new Promise<string>((resolve) => {
      const image = document.querySelector('.cm-hybrid-image-img');
      if (!image) throw new Error('Missing rendered image');
      const range = document.createRange();
      range.selectNode(image);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copiedImage).toBe(imageSource);
  });

  test('reference-style Markdown images render and copy like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const imageSource = '![Attention diagram][diagram]';
    const definition = '[diagram]: data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw== "Diagram title"';
    const doc = [
      'Before image',
      '',
      imageSource,
      '',
      definition,
      '',
      'After image',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Reference Images' }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-image')).toBeVisible();
    await expect(page.locator('.cm-hybrid-image-img')).toHaveAttribute('alt', 'Attention diagram');
    await expect(page.locator('.cm-content')).not.toContainText(definition);

    const copiedImage = await page.evaluate(() => new Promise<string>((resolve) => {
      const image = document.querySelector('.cm-hybrid-image-img');
      if (!image) throw new Error('Missing rendered reference image');
      const range = document.createRange();
      range.selectNode(image);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copiedImage).toBe(imageSource);

    await page.evaluate(() => {
      window.getSelection()?.removeAllRanges();
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    await expect(page.locator('.cm-hybrid-image')).toBeVisible();
    await page.locator('.cm-hybrid-image').click();
    await expect(page.locator('.cm-hybrid-image')).toHaveCount(0);
    expect(await page.evaluate(() => {
      const view = window.__cmView;
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    })).toBe(3);
  });

  test('reference definitions with continuation titles stay hidden like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const imageSource = '![Tiny diagram][diagram]';
    const doc = [
      '# References',
      '',
      'Read [external docs][docs] and inspect the image below.',
      '',
      imageSource,
      '',
      '[docs]: https://example.com/docs',
      '  "Docs Title"',
      '[diagram]: data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
      '  "Diagram Title"',
      '',
      'After references',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Continuation References' }, '*');
      window.__mockMessages = [];
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });

    await expect(page.getByRole('button', { name: 'external docs' })).toBeVisible();
    await expect(page.locator('.cm-hybrid-image-img')).toHaveAttribute('alt', 'Tiny diagram');
    await expect(page.locator('.cm-content')).not.toContainText('[docs]: https://example.com/docs');
    await expect(page.locator('.cm-content')).not.toContainText('Docs Title');
    await expect(page.locator('.cm-content')).not.toContainText('[diagram]: data:image/gif');
    await expect(page.locator('.cm-content')).not.toContainText('Diagram Title');

    await page.getByRole('button', { name: 'external docs' }).click();
    await expect.poll(() => page.evaluate(() =>
      window.__mockMessages?.filter((m) => m.type === 'openUri')
    )).toEqual([{ type: 'openUri', uri: 'https://example.com/docs' }]);
  });

  test('Obsidian image embeds render as images and copy raw wikilink syntax', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const embedSource = '![[data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==|Attention diagram]]';
    const doc = [
      'Before embed',
      '',
      embedSource,
      '',
      'After embed',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Embeds' }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-image')).toBeVisible();
    await expect(page.locator('.cm-hybrid-image-img')).toHaveAttribute('alt', 'Attention diagram');

    const copiedEmbed = await page.evaluate(() => new Promise<string>((resolve) => {
      const image = document.querySelector('.cm-hybrid-image-img');
      if (!image) throw new Error('Missing rendered image embed');
      const range = document.createRange();
      range.selectNode(image);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copiedEmbed).toBe(embedSource);

    await page.evaluate(() => {
      window.getSelection()?.removeAllRanges();
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    await expect(page.locator('.cm-hybrid-image')).toBeVisible();
    await page.locator('.cm-hybrid-image').click();
    await expect(page.locator('.cm-hybrid-image')).toHaveCount(0);
    expect(await page.evaluate(() => {
      const view = window.__cmView;
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    })).toBe(3);
    await page.keyboard.type('edited ');
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.line(3).text))
      .toBe(`edited ${embedSource}`);
  });

  test('Obsidian image embed size aliases set rendered dimensions', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    const widthOnlyEmbed = `![[${gif}|320]]`;
    const widthHeightEmbed = `![[${gif}|320x180]]`;
    const doc = [
      'Before embeds',
      '',
      widthOnlyEmbed,
      widthHeightEmbed,
      '',
      'After embeds',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Sized embeds' }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-image-img')).toHaveCount(2);
    const dimensions = await page.locator('.cm-hybrid-image-img').evaluateAll(images => (
      images.map(image => {
        const element = image as HTMLImageElement;
        return {
          alt: element.alt,
          width: element.getAttribute('width'),
          height: element.getAttribute('height'),
          cssWidth: element.style.width,
          cssHeight: element.style.height,
        };
      })
    ));

    expect(dimensions).toEqual([
      { alt: gif, width: '320', height: null, cssWidth: '320px', cssHeight: '' },
      { alt: gif, width: '320', height: '180', cssWidth: '320px', cssHeight: '180px' },
    ]);
  });

  test('rendered note images resolve vault-local resources like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Before local image',
      '',
      '![Local diagram](pixel.gif)',
      '',
      '![[assets/pixel.gif|Vault diagram]]',
      '',
      'After local image',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({
        type: 'setText',
        text,
        title: 'Local Images',
        resourceBaseUri: 'http://localhost:8979/fixtures/notes/Concepts/',
        resourceRootUri: 'http://localhost:8979/fixtures/',
      }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-image')).toHaveCount(2);
    await expect(page.locator('.cm-hybrid-image').nth(0))
      .toHaveAttribute('data-resolved-src', 'http://localhost:8979/fixtures/notes/Concepts/pixel.gif');
    await expect(page.locator('.cm-hybrid-image').nth(1))
      .toHaveAttribute('data-resolved-src', 'http://localhost:8979/fixtures/assets/pixel.gif');
  });

  test('copying rendered inline formatting preserves raw markdown delimiters', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Prelude line',
      '',
      'Mix **bold**, *italic*, ~~strike~~, ==highlight==, and `code` while reading.',
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Formatting' }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    const copyRenderedContents = async (selector: string) => page.evaluate((targetSelector) => (
      new Promise<string>((resolve) => {
        const view = window.__cmView;
        const selection = window.getSelection();
        selection?.removeAllRanges();
        view.dispatch({ selection: { anchor: view.state.doc.length } });
        const target = document.querySelector(targetSelector);
        if (!target) throw new Error(`Missing rendered span: ${targetSelector}`);
        const range = document.createRange();
        range.selectNodeContents(target);
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.addEventListener('copy', event => {
          resolve(event.clipboardData?.getData('text/plain') ?? '');
        }, { once: true });
        document.execCommand('copy');
      })
    ), selector);

    await expect(page.locator('.cm-hybrid-bold')).toContainText('bold');
    await expect(page.locator('.cm-hybrid-italic')).toContainText('italic');
    await expect(page.locator('.cm-hybrid-strikethrough')).toContainText('strike');
    await expect(page.locator('.cm-hybrid-highlight')).toContainText('highlight');
    await expect(page.locator('.cm-hybrid-inline-code')).toContainText('code');

    expect(await copyRenderedContents('.cm-hybrid-bold')).toBe('**bold**');
    expect(await copyRenderedContents('.cm-hybrid-italic')).toBe('*italic*');
    expect(await copyRenderedContents('.cm-hybrid-strikethrough')).toBe('~~strike~~');
    expect(await copyRenderedContents('.cm-hybrid-highlight')).toBe('==highlight==');
    expect(await copyRenderedContents('.cm-hybrid-inline-code')).toBe('`code`');
  });

  test('copying rendered inline math preserves raw dollar delimiters', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Prelude line',
      '',
      'Energy is $E = mc^2$ in the margin.',
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Math' }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    await expect(page.locator('.cm-hybrid-inline-math')).toBeVisible();

    const copiedMath = await page.evaluate(() => new Promise<string>((resolve) => {
      const math = document.querySelector('.cm-hybrid-inline-math');
      if (!math) throw new Error('Missing rendered inline math');
      const range = document.createRange();
      range.selectNode(math);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copiedMath).toBe('$E = mc^2$');
  });

  test('hybrid rendering keeps currency dollars literal like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Price notes',
      '',
      'Cost is $5 and $10 today, while $x_i$ stays math.',
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Currency Math' }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-inline-math')).toHaveCount(1);
    const mathLabels = await page.locator('.cm-hybrid-inline-math').evaluateAll(elements => (
      elements.map(element => element.querySelector('mjx-container')?.getAttribute('aria-label'))
    ));
    expect(mathLabels).toEqual(['x_i']);
    await expect(page.locator('.cm-line').filter({ hasText: 'Cost is $5 and $10 today' })).toBeVisible();
  });

  test('copying a rendered display math block preserves raw dollar delimiters', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Prelude line',
      '',
      '$$',
      'softmax(x_i) = exp(x_i) / sum(exp(x_j))',
      '$$',
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Math' }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    await expect(page.locator('.cm-hybrid-math-block')).toBeVisible();

    const copiedMath = await page.evaluate(() => new Promise<string>((resolve) => {
      const math = document.querySelector('.cm-hybrid-math-block');
      if (!math) throw new Error('Missing rendered display math');
      const range = document.createRange();
      range.selectNode(math);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copiedMath).toBe([
      '$$',
      'softmax(x_i) = exp(x_i) / sum(exp(x_j))',
      '$$',
    ].join('\n'));
  });

  test('rendered math exposes the source expression to the accessibility tree like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Inline math $E = mc^2$ stays readable.',
      '',
      '$$softmax(x_i) = exp(x_i) / sum(exp(x_j))$$',
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Accessible Math' }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    const mathAccessibility = await page.evaluate(() => {
      const inline = document.querySelector<HTMLElement>('.cm-hybrid-inline-math mjx-container');
      const block = document.querySelector<HTMLElement>('.cm-hybrid-math-block mjx-container');
      return {
        inlineRole: inline?.getAttribute('role') ?? '',
        inlineLabel: inline?.getAttribute('aria-label') ?? '',
        blockRole: block?.getAttribute('role') ?? '',
        blockLabel: block?.getAttribute('aria-label') ?? '',
      };
    });

    expect(mathAccessibility).toEqual({
      inlineRole: 'math',
      inlineLabel: 'E = mc^2',
      blockRole: 'math',
      blockLabel: 'softmax(x_i) = exp(x_i) / sum(exp(x_j))',
    });
  });

  test('pasting rendered HTML converts it back to Markdown like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const initialText = '# Paste Target\n\n';
    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, initialText);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });

      const html = [
        '<h1>Online Softmax</h1>',
        '<p>Keep <strong>running max</strong> and <code>d</code>. See <a href="notes/Concepts/FlashAttention.md">FlashAttention</a>.</p>',
        '<pre><code class="language-python">m = -inf\n',
        'd = 0</code></pre>',
      ].join('');
      const data = new Map<string, string>([
        ['text/html', html],
        ['text/plain', 'Online Softmax\nKeep running max and d. See FlashAttention.\nm = -inf\nd = 0'],
      ]);
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => data.get(type) ?? '',
        },
      });
      view.contentDOM.dispatchEvent(event);
    });

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString())).toBe([
      '# Paste Target',
      '',
      '# Online Softmax',
      '',
      'Keep **running max** and `d`. See [FlashAttention](notes/Concepts/FlashAttention.md).',
      '',
      '```python',
      'm = -inf',
      'd = 0',
      '```',
    ].join('\n'));
  });

  test('pasting HTML sanitizes blocked content before Markdown conversion like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, '# Paste Target\n\n');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });

      const html = [
        '<p>Safe <strong>content</strong>.</p>',
        '<script>alert("copied script")</script>',
        '<style>.leak { color: red; }</style>',
        '<iframe src="https://example.com"></iframe>',
        '<p>Tail line.</p>',
      ].join('');
      const data = new Map<string, string>([
        ['text/html', html],
        ['text/plain', 'Safe content.\nTail line.'],
      ]);
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => data.get(type) ?? '',
        },
      });
      view.contentDOM.dispatchEvent(event);
    });

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString())).toBe([
      '# Paste Target',
      '',
      'Safe **content**.',
      '',
      'Tail line.',
    ].join('\n'));
  });

  test('pasting HTML escapes Markdown syntax from literal text like Turndown and Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, '# Paste Target\n\n');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });

      const html = [
        '<p># literal heading marker</p>',
        '<p>- literal bullet marker</p>',
        '<p>1. literal ordered marker</p>',
      ].join('');
      const data = new Map<string, string>([
        ['text/html', html],
        ['text/plain', '# literal heading marker\n- literal bullet marker\n1. literal ordered marker'],
      ]);
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => data.get(type) ?? '',
        },
      });
      view.contentDOM.dispatchEvent(event);
    });

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString())).toBe([
      '# Paste Target',
      '',
      '\\# literal heading marker',
      '',
      '\\- literal bullet marker',
      '',
      '1\\. literal ordered marker',
    ].join('\n'));
  });

  test('pasting rendered highlights keeps Obsidian highlight syntax', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, '# Paste Target\n');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });

      const html = [
        '<p>Keep <mark>running max</mark> stable and ',
        '<span class="cm-highlight">numerically safe</span>.</p>',
      ].join('');
      const data = new Map<string, string>([
        ['text/html', html],
        ['text/plain', 'Keep running max stable and numerically safe.'],
      ]);
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => data.get(type) ?? '',
        },
      });
      view.contentDOM.dispatchEvent(event);
    });

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString())).toBe([
      '# Paste Target',
      'Keep ==running max== stable and ==numerically safe==.',
    ].join('\n'));
  });

  test('pasting rendered math keeps Obsidian dollar delimiters', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, '# Paste Target\n');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });

      const html = [
        '<p>Euler identity: ',
        '<span class="katex"><math><semantics><mrow></mrow>',
        '<annotation encoding="application/x-tex">e^{i\\\\pi}+1=0</annotation>',
        '</semantics></math></span>.</p>',
        '<span class="katex-display"><span class="katex"><math><semantics><mrow></mrow>',
        '<annotation encoding="application/x-tex">\\\\int_0^1 x^2\\\\,dx = \\\\frac{1}{3}</annotation>',
        '</semantics></math></span></span>',
      ].join('');
      const data = new Map<string, string>([
        ['text/html', html],
        ['text/plain', 'Euler identity: e^{i\\pi}+1=0.\n\\int_0^1 x^2\\,dx = \\frac{1}{3}'],
      ]);
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => data.get(type) ?? '',
        },
      });
      view.contentDOM.dispatchEvent(event);
    });

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString())).toBe([
      '# Paste Target',
      'Euler identity: $e^{i\\\\pi}+1=0$.',
      '',
      '$$',
      '\\\\int_0^1 x^2\\\\,dx = \\\\frac{1}{3}',
      '$$',
    ].join('\n'));
  });

  test('pasting MathJax-rendered HTML keeps Obsidian dollar delimiters', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const sourceDoc = [
      'Inline $e^{i\\pi}+1=0$ math.',
      '',
      '$$',
      '\\int_0^1 x^2\\,dx = \\frac{1}{3}',
      '$$',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, sourceDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    await expect(page.locator('.cm-hybrid-inline-math mjx-container[jax="SVG"]')).toBeVisible();
    await expect(page.locator('.cm-hybrid-math-block mjx-container[jax="SVG"]')).toBeVisible();

    const html = await page.evaluate(() => {
      const inline = document.querySelector<HTMLElement>('.cm-hybrid-inline-math mjx-container')?.outerHTML;
      const display = document.querySelector<HTMLElement>('.cm-hybrid-math-block mjx-container')?.outerHTML;
      if (!inline || !display) throw new Error('Expected rendered MathJax HTML');
      return `<p>Euler identity: ${inline}.</p>${display}`;
    });

    await page.evaluate((pasteHtml) => {
      window.__mockMessages = [];
      const view = window.__cmView;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: '# Paste Target\n' },
        selection: { anchor: '# Paste Target\n'.length },
      });
      view.dispatch({ selection: { anchor: view.state.doc.length } });

      const data = new Map<string, string>([
        ['text/html', pasteHtml],
        ['text/plain', 'Euler identity: e^{i\\pi}+1=0.\n\\int_0^1 x^2\\,dx = \\frac{1}{3}'],
      ]);
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => data.get(type) ?? '',
        },
      });
      view.contentDOM.dispatchEvent(event);
    }, html);

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString())).toBe([
      '# Paste Target',
      'Euler identity: $e^{i\\pi}+1=0$.',
      '',
      '$$',
      '\\int_0^1 x^2\\,dx = \\frac{1}{3}',
      '$$',
    ].join('\n'));
  });

  test('pasting rendered Obsidian internal links keeps wikilink syntax', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, '# Paste Target\n');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });

      const html = [
        '<p>See ',
        '<a class="internal-link" data-href="FlashAttention" href="app://obsidian.md/FlashAttention">FlashAttention</a>',
        ' and ',
        '<a class="internal-link" data-href="Online Softmax" href="app://obsidian.md/Online%20Softmax">online softmax</a>',
        '.</p>',
      ].join('');
      const data = new Map<string, string>([
        ['text/html', html],
        ['text/plain', 'See FlashAttention and online softmax.'],
      ]);
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => data.get(type) ?? '',
        },
      });
      view.contentDOM.dispatchEvent(event);
    });

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString())).toBe([
      '# Paste Target',
      'See [[FlashAttention]] and [[Online Softmax|online softmax]].',
    ].join('\n'));
  });

  test('pasting rendered Obsidian callouts keeps callout block syntax', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, '# Paste Target\n');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });

      const html = [
        '<div class="callout" data-callout="tip">',
        '<div class="callout-title"><div class="callout-title-inner">Practical note</div></div>',
        '<div class="callout-content">',
        '<p>Remember <strong>online normalization</strong>.</p>',
        '<p>See <a class="internal-link" data-href="FlashAttention" href="app://obsidian.md/FlashAttention">FlashAttention</a>.</p>',
        '</div>',
        '</div>',
      ].join('');
      const data = new Map<string, string>([
        ['text/html', html],
        ['text/plain', 'Practical note\nRemember online normalization.\nSee FlashAttention.'],
      ]);
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => data.get(type) ?? '',
        },
      });
      view.contentDOM.dispatchEvent(event);
    });

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString())).toBe([
      '# Paste Target',
      '> [!tip] Practical note',
      '> Remember **online normalization**.',
      '>',
      '> See [[FlashAttention]].',
    ].join('\n'));
  });

  test('pasting rendered Obsidian callouts does not duplicate generated default titles', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, '# Paste Target\n');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });

      const html = [
        '<div class="callout" data-callout="warning">',
        '<div class="callout-title"><div class="callout-title-inner">Warning</div></div>',
        '<div class="callout-content"><p>Check numerical stability.</p></div>',
        '</div>',
      ].join('');
      const data = new Map<string, string>([
        ['text/html', html],
        ['text/plain', 'Warning\nCheck numerical stability.'],
      ]);
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => data.get(type) ?? '',
        },
      });
      view.contentDOM.dispatchEvent(event);
    });

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString())).toBe([
      '# Paste Target',
      '> [!warning]',
      '> Check numerical stability.',
    ].join('\n'));
  });

  test('pasting rendered nested and task lists keeps Markdown list structure like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, '# Paste Target\n');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });

      const html = [
        '<ul>',
        '<li>Parent<ul><li><strong>Child</strong></li></ul></li>',
        '<li><input type="checkbox" checked> Done</li>',
        '<li><input type="checkbox"> Todo</li>',
        '</ul>',
        '<ol><li>First</li><li>Second<ul><li>Nested unordered</li></ul></li></ol>',
      ].join('');
      const data = new Map<string, string>([
        ['text/html', html],
        ['text/plain', 'Parent\nChild\nDone\nTodo\nFirst\nSecond\nNested unordered'],
      ]);
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => data.get(type) ?? '',
        },
      });
      view.contentDOM.dispatchEvent(event);
    });

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString())).toBe([
      '# Paste Target',
      '- Parent',
      '  - **Child**',
      '- [x] Done',
      '- [ ] Todo',
      '',
      '1. First',
      '2. Second',
      '  - Nested unordered',
    ].join('\n'));
  });

  test('pasting rendered images keeps Markdown image syntax like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, '# Paste Target\n');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });

      const html = [
        '<p><img alt="Attention diagram" src="raw/images/attention.png"></p>',
        '<p>Figure from <strong>FlashAttention</strong>.</p>',
      ].join('');
      const data = new Map<string, string>([
        ['text/html', html],
        ['text/plain', 'Attention diagram\nFigure from FlashAttention.'],
      ]);
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => data.get(type) ?? '',
        },
      });
      view.contentDOM.dispatchEvent(event);
    });

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString())).toBe([
      '# Paste Target',
      '![Attention diagram](raw/images/attention.png)',
      '',
      'Figure from **FlashAttention**.',
    ].join('\n'));
  });

  test('pasting rendered Obsidian internal image embeds keeps wikilink embed syntax', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, '# Paste Target\n');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });

      const html = [
        '<p>',
        '<span class="internal-embed media-embed image-embed is-loaded" data-href="Pasted image 20260521000732.png">',
        '<img alt="Pasted image 20260521000732.png" src="app://obsidian.md/vault/Pasted%20image%2020260521000732.png">',
        '</span>',
        '</p>',
      ].join('');
      const data = new Map<string, string>([
        ['text/html', html],
        ['text/plain', 'Pasted image 20260521000732.png'],
      ]);
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => data.get(type) ?? '',
        },
      });
      view.contentDOM.dispatchEvent(event);
    });

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString())).toBe([
      '# Paste Target',
      '![[Pasted image 20260521000732.png]]',
    ].join('\n'));
  });

  test('pasting rendered tables keeps Markdown pipe-table syntax like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, '# Paste Target\n');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });

      const html = [
        '<table><thead><tr><th>Symbol</th><th>Meaning</th></tr></thead>',
        '<tbody><tr><td><code>m</code></td><td>running max</td></tr>',
        '<tr><td><strong>d</strong></td><td>running denominator</td></tr></tbody></table>',
      ].join('');
      const data = new Map<string, string>([
        ['text/html', html],
        ['text/plain', 'Symbol Meaning\nm running max\nd running denominator'],
      ]);
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => data.get(type) ?? '',
        },
      });
      view.contentDOM.dispatchEvent(event);
    });

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString())).toBe([
      '# Paste Target',
      '| Symbol | Meaning |',
      '| --- | --- |',
      '| `m` | running max |',
      '| **d** | running denominator |',
    ].join('\n'));
  });

  test('copying a rendered table preserves raw pipe-table markdown', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const tableMarkdown = [
      '| Name | Role |',
      '| --- | --- |',
      '| FlashAttention | Kernel |',
      '| Online Softmax | Math |',
    ].join('\n');
    const doc = [
      'Before',
      '',
      tableMarkdown,
      '',
      'After',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    await expect(page.locator('.cm-hybrid-table-widget')).toBeVisible();

    const copied = await page.evaluate(() => new Promise<string>((resolve) => {
      const table = document.querySelector('.cm-hybrid-table-widget');
      if (!table) throw new Error('Missing rendered table');
      const range = document.createRange();
      range.selectNode(table);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copied).toBe(tableMarkdown);
  });

  test('markdown editor title is editable like Obsidian and requests a note rename', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '---',
      'id: concept_math_code',
      '---',
      '',
      '# Math and Code',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Math and Code' }, '*');
      window.__mockMessages = [];
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    const titleInput = page.locator('.cm-hybrid-document-title-input[aria-label="note title"]');
    await expect(titleInput).toHaveValue('Math and Code');

    await titleInput.fill('Renamed Math Note');
    await titleInput.press('Enter');

    await page.waitForFunction(() =>
      window.__mockMessages.some(message => message.type === 'renameTitle'),
      { timeout: 5000 },
    );
    await page.waitForFunction(() =>
      document.activeElement?.getAttribute('aria-label') === 'note title',
      { timeout: 5000 },
    );

    const state = await page.evaluate(() => ({
      text: window.__cmView.state.doc.toString(),
      renameMessages: window.__mockMessages.filter(message => message.type === 'renameTitle'),
      editMessages: window.__mockMessages.filter(message => message.type === 'edit'),
      focusedValue: document.activeElement?.getAttribute('aria-label') ?? null,
    }));

    expect(state.text).toBe(doc);
    expect(state.renameMessages).toEqual([{ type: 'renameTitle', title: 'Renamed Math Note' }]);
    expect(state.editMessages).toEqual([]);
    expect(state.focusedValue).toBe('note title');
  });

  test('frontmatter properties are editable from the Obsidian-like properties surface', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '---',
      'id: concept_math_code',
      'title: Math and Code',
      'tags: [test, math]',
      '---',
      '',
      '# Math and Code',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    const titleInput = page.locator('.cm-hybrid-property-value-input[aria-label="title property value"]');
    await expect(titleInput).toHaveValue('Math and Code');

    await titleInput.fill('Updated Math Note');
    await titleInput.press('Enter');

    await page.waitForFunction(() =>
      window.__cmView.state.doc.toString().includes('title: Updated Math Note'),
      { timeout: 5000 },
    );
    await page.waitForFunction(() =>
      document.activeElement?.getAttribute('aria-label') === 'title property value',
      { timeout: 5000 },
    );

    const state = await page.evaluate(() => ({
      text: window.__cmView.state.doc.toString(),
      editMessages: window.__mockMessages.filter((message) => message.type === 'edit'),
      errorMessages: window.__mockMessages.filter((message) => message.type === 'error'),
      focusedValue: document.activeElement?.getAttribute('aria-label') ?? null,
    }));

    expect(state.text).toContain('title: Updated Math Note');
    expect(state.text).not.toContain('title: Math and Code');
    expect(state.editMessages.at(-1)?.text).toContain('title: Updated Math Note');
    expect(state.errorMessages).toEqual([]);
    expect(state.focusedValue).toBe('title property value');

    await titleInput.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Z`);

    await page.waitForFunction(() =>
      window.__cmView.state.doc.toString().includes('title: Math and Code'),
      { timeout: 5000 },
    );
    await page.waitForFunction(() =>
      document.activeElement?.getAttribute('aria-label') === 'title property value',
      { timeout: 5000 },
    );

    const undoState = await page.evaluate(() => {
      const text = window.__cmView.state.doc.toString();
      return {
        text,
        errorMessages: window.__mockMessages.filter((message) => message.type === 'error'),
        focusedValue: document.activeElement?.getAttribute('aria-label') ?? null,
      };
    });

    expect(undoState.text).toContain('title: Math and Code');
    expect(undoState.text).not.toContain('title: Updated Math Note');
    expect(undoState.errorMessages).toEqual([]);
    expect(undoState.focusedValue).toBe('title property value');
  });

  test('frontmatter property names are editable from the Obsidian-like properties surface', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '---',
      'id: concept_math_code',
      'title: "Math and Code"',
      '---',
      '',
      '# Math and Code',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Math and Code' }, '*');
      window.__mockMessages = [];
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    const titleNameInput = page.locator('.cm-hybrid-property-name-input[aria-label="title property name"]');
    await expect(titleNameInput).toHaveValue('title');

    await titleNameInput.fill('summary');
    await titleNameInput.press('Enter');

    await page.waitForFunction(() =>
      /^summary: "Math and Code"$/m.test(window.__cmView.state.doc.toString()),
      { timeout: 5000 },
    );
    await page.waitForFunction(() =>
      document.activeElement?.getAttribute('aria-label') === 'summary property name',
      { timeout: 5000 },
    );

    const state = await page.evaluate(() => ({
      text: window.__cmView.state.doc.toString(),
      editorText: (document.querySelector('.cm-content') as HTMLElement | null)?.innerText ?? '',
      summaryValue: document.querySelector('.cm-hybrid-property-value-input[aria-label="summary property value"]')?.value ?? null,
      errorMessages: window.__mockMessages.filter((message) => message.type === 'error'),
      focusedValue: document.activeElement?.getAttribute('aria-label') ?? null,
    }));

    expect(state.text).toContain('summary: "Math and Code"');
    expect(state.text).not.toContain('title: "Math and Code"');
    expect(state.summaryValue).toBe('Math and Code');
    expect(state.editorText).not.toContain('summary: "Math and Code"');
    expect(state.editorText).not.toContain('---');
    expect(state.errorMessages).toEqual([]);
    expect(state.focusedValue).toBe('summary property name');

    await page.locator('.cm-hybrid-property-name-input[aria-label="summary property name"]')
      .press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Z`);

    await page.waitForFunction(() =>
      /^title: "Math and Code"$/m.test(window.__cmView.state.doc.toString()),
      { timeout: 5000 },
    );
    const restoredTitleNameInput = page.locator('.cm-hybrid-property-name-input[aria-label="title property name"]');
    await expect(restoredTitleNameInput).toBeFocused({ timeout: 5000 });

    const undoState = await page.evaluate(() => ({
      text: window.__cmView.state.doc.toString(),
      titleValue: document.querySelector('.cm-hybrid-property-value-input[aria-label="title property value"]')?.value ?? null,
      errorMessages: window.__mockMessages.filter((message) => message.type === 'error'),
    }));

    expect(undoState.text).toContain('title: "Math and Code"');
    expect(undoState.text).not.toContain('summary: "Math and Code"');
    expect(undoState.titleValue).toBe('Math and Code');
    expect(undoState.errorMessages).toEqual([]);
  });

  test('frontmatter list properties are editable from the Obsidian-like properties surface', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '---',
      'id: concept_math_code',
      'tags: [test, math]',
      '---',
      '',
      '# Math and Code',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Math and Code' }, '*');
      window.__mockMessages = [];
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    const tagsInput = page.locator('.cm-hybrid-property-list-input[aria-label="tags property values"]');
    await expect(tagsInput).toHaveValue('test, math');

    await tagsInput.fill('test, math, code');
    await tagsInput.press('Enter');

    await page.waitForFunction(() =>
      /^tags: \[test, math, code\]$/m.test(window.__cmView.state.doc.toString()),
      { timeout: 5000 },
    );
    await page.waitForFunction(() =>
      document.activeElement?.getAttribute('aria-label') === 'tags property values',
      { timeout: 5000 },
    );

    const state = await page.evaluate(() => ({
      text: window.__cmView.state.doc.toString(),
      chips: Array.from(document.querySelectorAll('.cm-hybrid-property-chip')).map(chip => chip.textContent),
      errorMessages: window.__mockMessages.filter((message) => message.type === 'error'),
      focusedValue: document.activeElement?.getAttribute('aria-label') ?? null,
    }));

    expect(state.text).toContain('tags: [test, math, code]');
    expect(state.chips).toEqual(['test', 'math', 'code']);
    expect(state.errorMessages).toEqual([]);
    expect(state.focusedValue).toBe('tags property values');

    await tagsInput.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Z`);

    await page.waitForFunction(() =>
      /^tags: \[test, math\]$/m.test(window.__cmView.state.doc.toString()),
      { timeout: 5000 },
    );
    await page.waitForFunction(() =>
      document.activeElement?.getAttribute('aria-label') === 'tags property values',
      { timeout: 5000 },
    );

    const undoState = await page.evaluate(() => ({
      text: window.__cmView.state.doc.toString(),
      chips: Array.from(document.querySelectorAll('.cm-hybrid-property-chip')).map(chip => chip.textContent),
      errorMessages: window.__mockMessages.filter((message) => message.type === 'error'),
      focusedValue: document.activeElement?.getAttribute('aria-label') ?? null,
    }));

    expect(undoState.text).toContain('tags: [test, math]');
    expect(undoState.text).not.toContain('tags: [test, math, code]');
    expect(undoState.chips).toEqual(['test', 'math']);
    expect(undoState.errorMessages).toEqual([]);
    expect(undoState.focusedValue).toBe('tags property values');
  });

  test('frontmatter block list properties render as Obsidian-like chips and preserve block YAML edits', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '---',
      'id: concept_math_code',
      'tags:',
      '  - test',
      '  - math',
      'aliases:',
      '  - Online softmax',
      '---',
      '',
      '# Math and Code',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Math and Code' }, '*');
      window.__mockMessages = [];
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    const tagsInput = page.locator('.cm-hybrid-property-list-input[aria-label="tags property values"]');
    await expect(tagsInput).toHaveValue('test, math');
    await expect(page.locator('.cm-hybrid-property-chip')).toContainText(['test', 'math', 'Online softmax']);

    await tagsInput.fill('test, math, code');
    await tagsInput.press('Enter');

    await page.waitForFunction(() =>
      /tags:\n  - test\n  - math\n  - code\naliases:/m.test(window.__cmView.state.doc.toString()),
      { timeout: 5000 },
    );

    const state = await page.evaluate(() => ({
      text: window.__cmView.state.doc.toString(),
      chips: Array.from(document.querySelectorAll('.cm-hybrid-property-chip')).map(chip => chip.textContent),
      errorMessages: window.__mockMessages.filter((message) => message.type === 'error'),
      focusedValue: document.activeElement?.getAttribute('aria-label') ?? null,
    }));

    expect(state.text).toContain('tags:\n  - test\n  - math\n  - code');
    expect(state.text).toContain('aliases:\n  - Online softmax');
    expect(state.chips).toEqual(['test', 'math', 'code', 'Online softmax']);
    expect(state.errorMessages).toEqual([]);
    expect(state.focusedValue).toBe('tags property values');
  });

  test('frontmatter properties can be added from the Obsidian-like properties surface', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '---',
      'id: concept_math_code',
      '---',
      '',
      '# Math and Code',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Math and Code' }, '*');
      window.__mockMessages = [];
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    await page.locator('.cm-hybrid-property-add').click();
    const nameInput = page.locator('.cm-hybrid-new-property-name-input');
    const valueInput = page.locator('.cm-hybrid-new-property-value-input');
    await expect(nameInput).toBeVisible();
    await expect(valueInput).toBeVisible();

    await nameInput.fill('source');
    await valueInput.fill('Book');
    await valueInput.press('Enter');

    await page.waitForFunction(() =>
      /^source: Book$/m.test(window.__cmView.state.doc.toString()),
      { timeout: 5000 },
    );

    const state = await page.evaluate(() => ({
      text: window.__cmView.state.doc.toString(),
      errorMessages: window.__mockMessages.filter((message) => message.type === 'error'),
      sourceValue: document.querySelector('.cm-hybrid-property-value-input[aria-label="source property value"]')?.value ?? null,
      sourceLineBeforeClosing: /id: concept_math_code\nsource: Book\n---/.test(window.__cmView.state.doc.toString()),
    }));

    expect(state.sourceLineBeforeClosing).toBe(true);
    expect(state.sourceValue).toBe('Book');
    expect(state.errorMessages).toEqual([]);
  });

  test('active heading lines keep the Markdown heading marker visible like Obsidian live preview', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, '# Active Heading\n\nBody copy');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      const heading = view.state.doc.line(1);
      view.dispatch({ selection: { anchor: heading.from } });
    });

    const headingState = await page.locator('.cm-line').first().evaluate((line) => {
      const style = getComputedStyle(line);
      return {
        text: line.textContent,
        fontWeight: style.fontWeight,
        fontSize: Number.parseFloat(style.fontSize),
        descendantTextDecorations: Array.from(line.querySelectorAll('*')).map((element) =>
          getComputedStyle(element).textDecorationLine
        ),
      };
    });
    const bodyFontSize = await page.locator('.cm-line').nth(2).evaluate((line) =>
      Number.parseFloat(getComputedStyle(line).fontSize)
    );

    expect(headingState.text).toBe('# Active Heading');
    expect(Number.parseInt(headingState.fontWeight, 10)).toBeGreaterThanOrEqual(700);
    expect(headingState.fontSize).toBeGreaterThan(bodyFontSize);
    expect(headingState.descendantTextDecorations.every(decoration => !decoration.includes('underline'))).toBe(true);
  });

  test('inactive ATX headings hide optional closing hash markers like Obsidian live preview', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '## Closing Marker ##',
      '',
      'Body copy',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(3).from } });
    });

    const inactiveHeadingText = await page.locator('.cm-line').first().textContent();
    expect(inactiveHeadingText).toBe('Closing Marker');
    await expect(page.locator('.cm-hybrid-heading-line-2')).toBeVisible();

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });

    const activeHeadingText = await page.locator('.cm-line').first().textContent();
    expect(activeHeadingText).toBe('## Closing Marker ##');
  });

  test('inactive indented ATX headings render like Obsidian live preview', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '  ### Indented Heading ###',
      '',
      'Body copy',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(3).from } });
    });

    await expect(page.locator('.cm-hybrid-heading-line-3')).toBeVisible();
    const inactiveHeadingText = await page.locator('.cm-line').first().textContent();
    expect(inactiveHeadingText).toBe('Indented Heading');

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });

    const activeHeadingText = await page.locator('.cm-line').first().textContent();
    expect(activeHeadingText).toBe('  ### Indented Heading ###');
  });

  test('hybrid rendering displays Setext headings like Obsidian live preview', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Setext Title',
      '============',
      '',
      'Setext Section',
      '--------------',
      '',
      'Body copy',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(7).from } });
    });

    await expect(page.locator('.cm-hybrid-heading-line-1')).toContainText('Setext Title');
    await expect(page.locator('.cm-hybrid-heading-line-2')).toContainText('Setext Section');
    await expect(page.locator('.cm-content')).not.toContainText('============');
    await expect(page.locator('.cm-content')).not.toContainText('--------------');
    await expect(page.locator('.cm-hybrid-hr')).toHaveCount(0);

    const headingLayout = await page.evaluate(() => {
      const h1 = document.querySelector<HTMLElement>('.cm-hybrid-heading-line-1');
      const h2 = document.querySelector<HTMLElement>('.cm-hybrid-heading-line-2');
      const body = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent === 'Body copy');
      return {
        h1Weight: h1 ? Number.parseInt(getComputedStyle(h1).fontWeight, 10) : 0,
        h1Size: h1 ? Number.parseFloat(getComputedStyle(h1).fontSize) : 0,
        h2Size: h2 ? Number.parseFloat(getComputedStyle(h2).fontSize) : 0,
        bodySize: body ? Number.parseFloat(getComputedStyle(body).fontSize) : 0,
      };
    });
    expect(headingLayout.h1Weight).toBeGreaterThanOrEqual(700);
    expect(headingLayout.h1Size).toBeGreaterThan(headingLayout.bodySize);
    expect(headingLayout.h2Size).toBeGreaterThan(headingLayout.bodySize);
  });

  test('heading commands convert Setext headings without leaving underline syntax', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, [
      'Online Softmax',
      '==============',
      '',
      'Body copy',
    ].join('\n'));

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
      window.postMessage({ type: 'executeCommand', command: 'editor:set-heading-2' }, '*');
    });

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['## Online Softmax', '', 'Body copy'].join('\n'));
  });

  test('heading commands toggle matching ATX headings off like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, [
      '## Online Softmax',
      '',
      'Body copy',
    ].join('\n'));

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from + 3 } });
      window.postMessage({ type: 'executeCommand', command: 'editor:set-heading-2' }, '*');
    });

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['Online Softmax', '', 'Body copy'].join('\n'));
  });

  test('heading commands toggle matching Setext headings off like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, [
      'Online Softmax',
      '==============',
      '',
      'Body copy',
    ].join('\n'));

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
      window.postMessage({ type: 'executeCommand', command: 'editor:set-heading-1' }, '*');
    });

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['Online Softmax', '', 'Body copy'].join('\n'));
  });

  test('markdown editor autofocuses on initial load so the caret is immediately visible', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, '# Autofocus check\n\nBody copy');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    await page.waitForFunction(() => {
      const editor = document.querySelector('.cm-editor');
      const cursor = document.querySelector('.cm-cursor');
      if (!editor || !cursor || !editor.classList.contains('cm-focused')) return false;
      const rect = cursor.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }, { timeout: 5000 });

    const focusState = await page.evaluate(() => {
      const editor = document.querySelector('.cm-editor');
      const cursor = document.querySelector('.cm-cursor');
      const rect = cursor?.getBoundingClientRect();
      return {
        isFocused: !!editor?.classList.contains('cm-focused'),
        activeTag: document.activeElement?.tagName ?? null,
        activeClass: document.activeElement?.className ?? null,
        rect: rect ? {
          width: rect.width,
          height: rect.height,
        } : null,
      };
    });

    expect(focusState.isFocused).toBe(true);
    expect(focusState.rect?.width).toBeGreaterThan(0);
    expect(focusState.rect?.height).toBeGreaterThan(0);
  });

  test('markdown editor requests window focus on initial load', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.__focusCalls = 0;
      const originalFocus = window.focus.bind(window);
      window.focus = (...args) => {
        window.__focusCalls += 1;
        return originalFocus(...args);
      };
    });

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, '# Focus window\n\nBody copy');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    await page.waitForFunction(() => window.__focusCalls > 0, { timeout: 5000 });

    expect(await page.evaluate(() => window.__focusCalls)).toBeGreaterThan(0);
  });

  test('markdown editor retries focus briefly after initial load', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.__focusCalls = 0;
      window.__domFocusCalls = 0;
      const originalFocus = window.focus.bind(window);
      const originalElementFocus = HTMLElement.prototype.focus;
      window.focus = (...args) => {
        window.__focusCalls += 1;
        return originalFocus(...args);
      };
      HTMLElement.prototype.focus = function (...args) {
        window.__domFocusCalls += 1;
        if (window.__domFocusCalls === 1) {
          return undefined;
        }
        return originalElementFocus.apply(this, args);
      };
    });

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, '# Focus retries\n\nBody copy');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.waitForFunction(() => window.__focusCalls > 1, { timeout: 5000 });

    expect(await page.evaluate(() => window.__focusCalls)).toBeGreaterThan(1);
  });

  test('markdown editor caret uses the VS Code cursor color when focused', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, '# Caret check\n\nBody copy');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.click('.cm-content');

    await page.waitForFunction(() => {
      const editor = document.querySelector('.cm-editor');
      const cursor = document.querySelector('.cm-cursor');
      if (!editor || !cursor) return false;
      return editor.classList.contains('cm-focused');
    }, { timeout: 5000 });

    const cursorStyles = await page.evaluate(() => {
      const cursor = document.querySelector('.cm-cursor');
      const style = cursor ? getComputedStyle(cursor) : null;
      return {
        borderLeftColor: style?.borderLeftColor ?? '',
        borderLeftStyle: style?.borderLeftStyle ?? '',
        opacity: style?.opacity ?? '',
      };
    });

    expect(cursorStyles.borderLeftStyle).toBe('solid');
    expect(cursorStyles.opacity).toBe('1');
    expect(cursorStyles.borderLeftColor).toBe('rgb(174, 175, 173)');
  });

  test('markdown editor supports Vim-style normal mode when Vim mode is enabled', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, 'cat');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
    });

    await page.click('.cm-content');
    await page.evaluate(() => {
      window.__cmView.dispatch({ selection: { anchor: 0 } });
    });
    await page.keyboard.press('Escape');
    await page.keyboard.press('x');

    await page.waitForFunction(() => window.__cmView.state.doc.toString() === 'at', { timeout: 5000 });

    expect(await page.evaluate(() => window.__cmView.state.doc.toString())).toBe('at');
  });

  test('markdown editor retains Vim mode when the toggle arrives before the editor is created', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text: 'cat' }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.click('.cm-content');
    await page.evaluate(() => {
      window.__cmView.dispatch({ selection: { anchor: 0 } });
    });
    await page.keyboard.press('Escape');
    await page.keyboard.press('x');

    await page.waitForFunction(() => window.__cmView.state.doc.toString() === 'at', { timeout: 5000 });

    expect(await page.evaluate(() => window.__cmView.state.doc.toString())).toBe('at');
  });

  test('Vim ex commands save and close through VS Code host messages', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text: '# Note\n\nBody' }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    const expectVimCommandMessages = async (command: string, expectedTypes: string[]) => {
      await page.evaluate(() => {
        window.__mockMessages = [];
      });
      await page.click('.cm-content');
      await page.keyboard.press('Escape');
      await page.keyboard.type(command);
      await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate(() =>
        window.__mockMessages
          .map(message => message.type)
          .filter(type => type === 'save' || type === 'close' || type === 'saveAndClose'),
      )).toEqual(expectedTypes);
    };

    await expectVimCommandMessages(':w', ['save']);
    await expectVimCommandMessages(':q', ['close']);
    await expectVimCommandMessages(':wq', ['saveAndClose']);
  });

  test('Vim normal mode can move into fenced code blocks and edit code lines', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Intro',
      '',
      '```python',
      'value = 1',
      '```',
      '',
      'Outro',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-codeblock')).toBeVisible();
    await page.click('.cm-content');
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });

    await page.keyboard.press('Escape');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('j');

    expect(await page.evaluate(() => {
      const view = window.__cmView;
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    })).toBe(4);

    await page.keyboard.press('A');
    await page.keyboard.type('  # edited');

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.line(4).text))
      .toBe('value = 1  # edited');
    expect(await page.evaluate(() => window.__mockMessages?.filter(message => message.type === 'error') ?? []))
      .toEqual([]);
  });

  test('active fenced code opening and closing lines reveal raw fence markers', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Intro',
      '',
      '```python',
      'value = 1',
      '```',
      '',
      'Outro',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-codeblock')).toBeVisible();

    const visibleFenceLines = () => page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .map(line => line.textContent ?? '')
        .filter(text => text.includes('```'));
    });

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(3).from } });
    });

    await expect.poll(visibleFenceLines).toEqual(['```python']);

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(5).from } });
    });

    await expect.poll(visibleFenceLines).toEqual(['```']);
  });

  test('Vim normal mode moves into rendered display math instead of skipping it', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Intro',
      'Before math',
      '$$softmax(x_i) = exp(x_i) / sum(exp(x_j))$$',
      'After math',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-math-block')).toBeVisible();
    await page.click('.cm-content');
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
    });

    await page.keyboard.press('Escape');
    await page.keyboard.press('j');

    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      return {
        lineNumber: view.state.doc.lineAt(view.state.selection.main.head).number,
        lineText: view.state.doc.lineAt(view.state.selection.main.head).text,
        visibleSource: document.querySelector('.cm-line')?.textContent ?? '',
        mathBlocks: document.querySelectorAll('.cm-hybrid-math-block').length,
      };
    })).toEqual({
      lineNumber: 3,
      lineText: '$$softmax(x_i) = exp(x_i) / sum(exp(x_j))$$',
      visibleSource: 'Intro',
      mathBlocks: 1,
    });

    const activeMathText = await page.evaluate(() => {
      const sourceLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent?.includes('$$softmax'));
      return sourceLine?.textContent ?? '';
    });
    expect(activeMathText).toContain('$$softmax(x_i)');

    await page.keyboard.press('A');
    await page.keyboard.type(' + correction');

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.line(3).text))
      .toBe('$$softmax(x_i) = exp(x_i) / sum(exp(x_j))$$ + correction');
  });

  test('Vim normal mode moves from the blank line before rendered display math into the math source line', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '# Online Softmax',
      '',
      'Before math',
      '',
      '$$softmax(x_i) = exp(x_i) / sum(exp(x_j))$$',
      '',
      'After math',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-math-block')).toBeVisible();
    await page.click('.cm-content');
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(4).from } });
    });

    await page.keyboard.press('Escape');
    await page.keyboard.press('j');

    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      const activeSourceLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent?.includes('$$softmax'));
      return {
        lineNumber: selectedLine.number,
        lineText: selectedLine.text,
        activeSourceText: activeSourceLine?.textContent ?? '',
      };
    })).toEqual({
      lineNumber: 5,
      lineText: '$$softmax(x_i) = exp(x_i) / sum(exp(x_j))$$',
      activeSourceText: '$$softmax(x_i) = exp(x_i) / sum(exp(x_j))$$',
    });
  });

  test('Vim mode can click into rendered fenced code lines and edit them', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Intro',
      '',
      '```python',
      'value = 1',
      '```',
      '',
      'Outro',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-codeblock')).toBeVisible();

    await page.locator('.cm-hybrid-codeblock-content-line').filter({ hasText: 'value = 1' }).click();

    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    })).toBe(4);

    await page.keyboard.press('Escape');
    await page.keyboard.press('A');
    await page.keyboard.type('  # clicked');

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.line(4).text))
      .toBe('value = 1  # clicked');
    expect(await page.evaluate(() => window.__mockMessages?.filter(message => message.type === 'error') ?? []))
      .toEqual([]);
  });

  test('Vim mode enters editable code when clicking the rendered fenced code block surface', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Intro',
      '',
      '```python',
      'value = 1',
      '```',
      '',
      'Outro',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-codeblock')).toBeVisible();

    await page.locator('.cm-hybrid-codeblock-header').click();

    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    })).toBe(4);

    await page.keyboard.press('Escape');
    await page.keyboard.press('A');
    await page.keyboard.type('  # header-clicked');

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.line(4).text))
      .toBe('value = 1  # header-clicked');
    expect(await page.evaluate(() => window.__mockMessages?.filter(message => message.type === 'error') ?? []))
      .toEqual([]);
  });

  test('link widgets render and clicking them sends openUri messages', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = '# Note\n\nClick [the PDF link](raw/paper.pdf#page=7&anchor=anc_test) here.\n';

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    // Verify the widget was rendered (the markdown link text should be replaced)
    const widgetCount = await page.locator('.cm-hl-link').count();
    expect(widgetCount).toBeGreaterThanOrEqual(1);

    // Click the widget button with a real pointer event to match VS Code webview use.
    await page.evaluate(() => {
      window.__mockMessages = [];
    });
    await page.locator('.cm-hl-link').first().click();

    // Verify openUri message was sent
    const openUriMessages = await page.evaluate(() =>
      window.__mockMessages?.filter((m) => m.type === 'openUri')
    );

    expect(openUriMessages.length).toBe(1);
    expect(openUriMessages[0].uri).toBe('raw/paper.pdf#page=7&anchor=anc_test');
  });

  test('folder-qualified Obsidian wikilinks preserve vault paths when opened', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      '# Note',
      '',
      'See [[Daily Notes/2026-05-25|today]], [[Concepts/FlashAttention]], and [[notes/Projects/Roadmap.md#Milestones]].',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'today', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'FlashAttention', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Roadmap > Milestones', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'today', exact: true }).click();
    await page.getByRole('button', { name: 'FlashAttention', exact: true }).click();
    await page.getByRole('button', { name: 'Roadmap > Milestones', exact: true }).click();

    const openUriMessages = await page.evaluate(() =>
      window.__mockMessages?.filter((message) => message.type === 'openUri')
    );
    expect(openUriMessages).toEqual([
      { type: 'openUri', uri: 'notes/Daily Notes/2026-05-25.md' },
      { type: 'openUri', uri: 'notes/Concepts/FlashAttention.md' },
      { type: 'openUri', uri: 'notes/Projects/Roadmap.md#Milestones' },
    ]);
  });

  test('unqualified Obsidian wikilinks resolve by known vault note basename', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      '# Daily Note',
      '',
      'Reread [[FlashAttention Paper]] sections 2-3.',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({
        type: 'setText',
        text,
        currentNotePath: 'notes/Daily Notes/2026-05-25.md',
        notePaths: [
          'notes/Concepts/Online Softmax.md',
          'notes/Papers/FlashAttention Paper.md',
        ],
      }, '*');
      window.__mockMessages = [];
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'FlashAttention Paper', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'FlashAttention Paper', exact: true }).click();

    const openUriMessages = await page.evaluate(() =>
      window.__mockMessages?.filter((message) => message.type === 'openUri')
    );
    expect(openUriMessages).toEqual([
      { type: 'openUri', uri: 'notes/Papers/FlashAttention Paper.md' },
    ]);
  });

  test('same-note Obsidian heading wikilinks open the current note heading', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      '# Online Softmax',
      '',
      'Jump to [[#Why This Matters|the motivation]].',
      '',
      '## Why This Matters',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({
        type: 'setText',
        text,
        currentNotePath: 'notes/Concepts/Online Softmax.md',
      }, '*');
      window.__mockMessages = [];
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'the motivation' })).toBeVisible();

    await page.getByRole('button', { name: 'the motivation' }).click();

    const openUriMessages = await page.evaluate(() =>
      window.__mockMessages?.filter((message) => message.type === 'openUri')
    );
    expect(openUriMessages).toEqual([
      { type: 'openUri', uri: 'notes/Concepts/Online Softmax.md#Why This Matters' },
    ]);
  });

  test('same-note Obsidian block-reference wikilinks open the current note block', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      '# Online Softmax',
      '',
      'Jump to [[#^fact123|the fact]].',
      '',
      'Important fact about online normalization. ^fact123',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({
        type: 'setText',
        text,
        currentNotePath: 'notes/Concepts/Online Softmax.md',
      }, '*');
      window.__mockMessages = [];
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'the fact' })).toBeVisible();

    await page.getByRole('button', { name: 'the fact' }).click();

    const openUriMessages = await page.evaluate(() =>
      window.__mockMessages?.filter((message) => message.type === 'openUri')
    );
    expect(openUriMessages).toEqual([
      { type: 'openUri', uri: 'notes/Concepts/Online Softmax.md#^fact123' },
    ]);
  });

  test('hybrid rendering hides trailing Obsidian block IDs until the line is active', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      '# Block ID Note',
      '',
      'Important fact about online normalization. ^fact123',
      '',
      'Cursor lands here.',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(5).from } });
    });

    const inactiveLine = await page.locator('.cm-line').nth(2).evaluate(line => line.textContent);
    expect(inactiveLine).toBe('Important fact about online normalization.');

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 8 } });
    });

    const activeLine = await page.locator('.cm-line').nth(2).evaluate(line => line.textContent);
    expect(activeLine).toBe('Important fact about online normalization. ^fact123');
  });

  test('external markdown links are rendered as clickable widgets too', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = '# Note\n\nRead [external docs](https://example.com/docs) next.\n';

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hl-link')).toContainText(['external docs']);

    await page.locator('.cm-hl-link').first().click();

    const openUriMessages = await page.evaluate(() =>
      window.__mockMessages?.filter((m) => m.type === 'openUri')
    );

    expect(openUriMessages).toEqual([{ type: 'openUri', uri: 'https://example.com/docs' }]);
  });

  test('external markdown links with titles open only the URL like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = '# Note\n\nRead [external docs](https://example.com/docs "Docs Title") next.\n';

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'external docs' })).toBeVisible();

    await page.getByRole('button', { name: 'external docs' }).click();

    let openUriMessages = await page.evaluate(() =>
      window.__mockMessages?.filter((m) => m.type === 'openUri')
    );
    expect(openUriMessages).toEqual([{ type: 'openUri', uri: 'https://example.com/docs' }]);

    await page.evaluate(() => {
      const view = window.__cmView;
      window.__mockMessages = [];
      const line = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: line.from + line.text.indexOf('external') } });
      window.postMessage({ type: 'executeCommand', command: 'editor:follow-link' }, '*');
    });

    await page.waitForFunction(() =>
      window.__mockMessages?.some((m) =>
        m.type === 'openUri' && m.uri === 'https://example.com/docs'
      ),
    );
    openUriMessages = await page.evaluate(() =>
      window.__mockMessages?.filter((m) => m.type === 'openUri')
    );
    expect(openUriMessages).toEqual([{ type: 'openUri', uri: 'https://example.com/docs' }]);
  });

  test('reference-style Markdown links render and open like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      '# Note',
      '',
      'Read [external docs][docs] and [compact][].',
      '',
      '[docs]: https://example.com/docs "Docs Title"',
      '[compact]: https://example.com/compact',
      '',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });

    await expect(page.getByRole('button', { name: 'external docs' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'compact' })).toBeVisible();
    await expect(page.locator('.cm-line').nth(2)).toHaveText('Read external docs and compact.');
    await expect(page.locator('.cm-content')).not.toContainText('[docs]: https://example.com/docs');

    await page.getByRole('button', { name: 'external docs' }).click();
    await page.getByRole('button', { name: 'compact' }).click();
    let openUriMessages = await page.evaluate(() =>
      window.__mockMessages?.filter((m) => m.type === 'openUri')
    );
    expect(openUriMessages).toEqual([
      { type: 'openUri', uri: 'https://example.com/docs' },
      { type: 'openUri', uri: 'https://example.com/compact' },
    ]);

    const copied = await page.evaluate(() => (
      new Promise<string>((resolve) => {
        const selection = window.getSelection();
        const target = document.querySelector('.cm-hl-link');
        if (!target) throw new Error('Missing rendered reference link');
        const range = document.createRange();
        range.selectNodeContents(target);
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.addEventListener('copy', event => {
          resolve(event.clipboardData?.getData('text/plain') ?? '');
        }, { once: true });
        document.execCommand('copy');
      })
    ));
    expect(copied).toBe('[external docs][docs]');

    await page.evaluate(() => {
      const view = window.__cmView;
      window.__mockMessages = [];
      const line = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: line.from + line.text.indexOf('external') } });
      window.postMessage({ type: 'executeCommand', command: 'editor:follow-link' }, '*');
    });

    await page.waitForFunction(() =>
      window.__mockMessages?.some((m) =>
        m.type === 'openUri' && m.uri === 'https://example.com/docs'
      ),
    );
    openUriMessages = await page.evaluate(() =>
      window.__mockMessages?.filter((m) => m.type === 'openUri')
    );
    expect(openUriMessages).toEqual([{ type: 'openUri', uri: 'https://example.com/docs' }]);
    await expect(page.locator('.cm-active-link-label').filter({ hasText: 'external docs' })).toBeVisible();

    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(5);
      view.dispatch({ selection: { anchor: line.from } });
    });
    await expect(page.locator('.cm-line').filter({ hasText: '[docs]: https://example.com/docs' })).toBeVisible();
  });

  test('shortcut reference links and images render like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const imageSource = '![Tiny diagram]';
    const testDoc = [
      '# Shortcut References',
      '',
      'Read [external docs] and inspect the image below.',
      '',
      imageSource,
      '',
      '[external docs]: https://example.com/docs',
      '[Tiny diagram]: data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
      '',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Shortcut References' }, '*');
      window.__mockMessages = [];
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });

    await expect(page.getByRole('button', { name: 'external docs' })).toBeVisible();
    await expect(page.locator('.cm-line').nth(2)).toHaveText('Read external docs and inspect the image below.');
    await expect(page.locator('.cm-hybrid-image-img')).toHaveAttribute('alt', 'Tiny diagram');
    await expect(page.locator('.cm-content')).not.toContainText('[external docs]: https://example.com/docs');
    await expect(page.locator('.cm-content')).not.toContainText('[Tiny diagram]: data:image/gif');

    await page.getByRole('button', { name: 'external docs' }).click();
    await expect.poll(() => page.evaluate(() =>
      window.__mockMessages?.filter((m) => m.type === 'openUri')
    )).toEqual([{ type: 'openUri', uri: 'https://example.com/docs' }]);

    const copiedImage = await page.evaluate(() => new Promise<string>((resolve) => {
      const image = document.querySelector('.cm-hybrid-image-img');
      if (!image) throw new Error('Missing rendered shortcut reference image');
      const range = document.createRange();
      range.selectNode(image);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));
    expect(copiedImage).toBe(imageSource);

    await page.evaluate(() => {
      window.__mockMessages = [];
      const view = window.__cmView;
      const line = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: line.from + line.text.indexOf('external') } });
      window.postMessage({ type: 'executeCommand', command: 'editor:follow-link' }, '*');
    });
    await expect.poll(() => page.evaluate(() =>
      window.__mockMessages?.filter((m) => m.type === 'openUri')
    )).toEqual([{ type: 'openUri', uri: 'https://example.com/docs' }]);
  });

  test('external markdown links with balanced parentheses render and open like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const url = 'https://example.com/docs_(draft)';
    const testDoc = `# Note\n\nRead [external docs](${url}) next.\n`;

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'external docs' })).toBeVisible();
    await expect(page.locator('.cm-line').nth(2)).toHaveText('Read external docs next.');

    await page.getByRole('button', { name: 'external docs' }).click();

    let openUriMessages = await page.evaluate(() =>
      window.__mockMessages?.filter((m) => m.type === 'openUri')
    );
    expect(openUriMessages).toEqual([{ type: 'openUri', uri: url }]);

    await page.evaluate(() => {
      const view = window.__cmView;
      window.__mockMessages = [];
      const line = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: line.from + line.text.indexOf('external') } });
      window.postMessage({ type: 'executeCommand', command: 'editor:follow-link' }, '*');
    });

    await page.waitForFunction((expectedUrl) =>
      window.__mockMessages?.some((m) =>
        m.type === 'openUri' && m.uri === expectedUrl
      ),
    url);
    openUriMessages = await page.evaluate(() =>
      window.__mockMessages?.filter((m) => m.type === 'openUri')
    );
    expect(openUriMessages).toEqual([{ type: 'openUri', uri: url }]);
  });

  test('external markdown links with nested brackets in labels render and open like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const url = 'https://example.com/docs';
    const label = 'external [draft] docs';
    const testDoc = `# Note\n\nRead [${label}](${url}) next.\n`;

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: label })).toBeVisible();
    await expect(page.locator('.cm-line').nth(2)).toHaveText(`Read ${label} next.`);

    await page.getByRole('button', { name: label }).click();

    let openUriMessages = await page.evaluate(() =>
      window.__mockMessages?.filter((m) => m.type === 'openUri')
    );
    expect(openUriMessages).toEqual([{ type: 'openUri', uri: url }]);

    await page.evaluate(() => {
      const view = window.__cmView;
      window.__mockMessages = [];
      const line = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: line.from + line.text.indexOf('draft') } });
      window.postMessage({ type: 'executeCommand', command: 'editor:follow-link' }, '*');
    });

    await page.waitForFunction((expectedUrl) =>
      window.__mockMessages?.some((m) =>
        m.type === 'openUri' && m.uri === expectedUrl
      ),
    url);
    openUriMessages = await page.evaluate(() =>
      window.__mockMessages?.filter((m) => m.type === 'openUri')
    );
    expect(openUriMessages).toEqual([{ type: 'openUri', uri: url }]);
  });

  test('bare URLs and angle-bracket autolinks are clickable like Obsidian live preview', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Read https://example.com/bare and <https://example.com/angle> next.',
      '',
      'Active https://example.com/active link.',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(3).from } });
    });

    await expect(page.locator('.cm-hl-link')).toContainText([
      'https://example.com/bare',
      'https://example.com/angle',
    ]);
    await expect(page.locator('.cm-line').first()).not.toContainText('<https://example.com/angle>');

    await page.locator('.cm-hl-link').nth(0).click();
    await page.locator('.cm-hl-link').nth(1).click();

    let openUriMessages = await page.evaluate(() =>
      window.__mockMessages?.filter((m) => m.type === 'openUri')
    );
    expect(openUriMessages).toEqual([
      { type: 'openUri', uri: 'https://example.com/bare' },
      { type: 'openUri', uri: 'https://example.com/angle' },
    ]);

    await page.evaluate(() => {
      const view = window.__cmView;
      window.__mockMessages = [];
      view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 10 } });
    });

    await expect(page.locator('.cm-active-external-link')).toContainText(['https://example.com/active']);
    const rawLine = await page.locator('.cm-line').nth(2).evaluate(line => line.textContent);
    expect(rawLine).toBe('Active https://example.com/active link.');

    await page.locator('.cm-active-external-link').click({ modifiers: ['Meta'] });
    openUriMessages = await page.evaluate(() =>
      window.__mockMessages?.filter((m) => m.type === 'openUri')
    );
    expect(openUriMessages).toEqual([{ type: 'openUri', uri: 'https://example.com/active' }]);
  });

  test('external links show an Obsidian-like outgoing-link affordance in both rendered and active-line modes', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    const doc = [
      '# Note',
      '',
      'Read [external docs](https://example.com/docs) next.',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    const renderedAffordance = await page.locator('.cm-hl-link').first().evaluate((element) =>
      getComputedStyle(element, '::after').content
    );
    expect(renderedAffordance).toBe('"↗"');

    await page.evaluate(() => {
      const view = window.__cmView;
      const target = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: target.from + 8 } });
    });

    const activeAffordance = await page.locator('.cm-active-external-link').evaluate((element) =>
      getComputedStyle(element, '::after').content
    );
    expect(activeAffordance).toBe('"↗"');
  });

  test('link widgets keep Obsidian-like inline link styling without a highlight pill', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, '# Note\n\nClick [the PDF link](raw/paper.pdf#page=7&anchor=anc_test) here.\n');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    const styles = await page.locator('.cm-hl-link').first().evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        textDecorationLine: style.textDecorationLine,
        backgroundColor: style.backgroundColor,
        borderRadius: style.borderRadius,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
      };
    });

    expect(styles.textDecorationLine).toContain('underline');
    expect(styles.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(styles.borderRadius).toBe('0px');
    expect(styles.paddingLeft).toBe('0px');
    expect(styles.paddingRight).toBe('0px');
  });

  test('active raw markdown lines still style link labels like Obsidian live preview', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Prelude line',
      '',
      'Keep [docs](https://example.com/docs) and [[FlashAttention]] visible while editing.',
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      const target = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: target.from + 8 } });
    });

    await expect(page.locator('.cm-hl-link')).toHaveCount(0);
    await expect(page.locator('.cm-active-link-label')).toContainText(['docs', 'FlashAttention']);

    const linkStyles = await page.locator('.cm-active-link-label').first().evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        textDecorationLine: style.textDecorationLine,
        backgroundColor: style.backgroundColor,
        borderRadius: style.borderRadius,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        fontWeight: style.fontWeight,
      };
    });

    expect(linkStyles.textDecorationLine).toContain('underline');
    expect(linkStyles.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(linkStyles.borderRadius).toBe('0px');
    expect(linkStyles.paddingLeft).toBe('0px');
    expect(linkStyles.paddingRight).toBe('0px');
    expect(linkStyles.fontWeight).toBe('500');
  });

  test('Cmd+click on an active raw-line link follows it like Obsidian live preview', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Meta-click modifier assertions are only stable in chromium');

    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Prelude line',
      '',
      'Keep [docs](https://example.com/docs) and [[FlashAttention]] visible while editing.',
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      const target = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: target.from + 8 } });
    });

    await expect(page.locator('.cm-active-link-label')).toContainText(['docs', 'FlashAttention']);

    await page.locator('.cm-active-link-label').first().click({ modifiers: ['Meta'] });

    const openUriMessages = await page.evaluate(() =>
      window.__mockMessages?.filter((m) => m.type === 'openUri')
    );

    expect(openUriMessages).toEqual([{ type: 'openUri', uri: 'https://example.com/docs' }]);
  });

  test('active raw markdown lines keep inline formatting styled like Obsidian live preview', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Prelude line',
      '',
      'Mix **bold**, *italic*, ~~strike~~, ==highlight==, and `code` while editing.',
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      const target = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: target.from + 8 } });
    });

    await expect(page.locator('.cm-hl-link')).toHaveCount(0);
    await expect(page.locator('.cm-active-bold')).toContainText(['bold']);
    await expect(page.locator('.cm-active-italic')).toContainText(['italic']);
    await expect(page.locator('.cm-active-strikethrough')).toContainText(['strike']);
    await expect(page.locator('.cm-active-highlight')).toContainText(['highlight']);
    await expect(page.locator('.cm-active-inline-code')).toContainText(['code']);

    const styles = await page.evaluate(() => {
      const bold = getComputedStyle(document.querySelector('.cm-active-bold'));
      const italic = getComputedStyle(document.querySelector('.cm-active-italic'));
      const strike = getComputedStyle(document.querySelector('.cm-active-strikethrough'));
      const highlight = getComputedStyle(document.querySelector('.cm-active-highlight'));
      const code = getComputedStyle(document.querySelector('.cm-active-inline-code'));
      return {
        italicTexts: Array.from(document.querySelectorAll('.cm-active-italic')).map(element => element.textContent),
        boldWeight: bold.fontWeight,
        boldStyle: bold.fontStyle,
        italicStyle: italic.fontStyle,
        strikeLine: strike.textDecorationLine,
        highlightBg: highlight.backgroundColor,
        codeBg: code.backgroundColor,
        codeRadius: code.borderRadius,
      };
    });

    expect(styles.boldWeight).toBe('700');
    expect(styles.boldStyle).toBe('normal');
    expect(styles.italicTexts).toEqual(['italic']);
    expect(styles.italicStyle).toBe('italic');
    expect(styles.strikeLine).toContain('line-through');
    expect(styles.highlightBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(styles.codeBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(styles.codeRadius).toBe('4px');
  });

  test('hybrid rendering keeps intraword underscores literal like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Before',
      '',
      'Use x_i and snake_case_value in prose, but _emphasis_ should render.',
      '',
      'After',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });

    const inactiveState = await page.evaluate(() => {
      const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(element => element.textContent?.includes('Use '));
      return {
        text: line?.textContent ?? '',
        italicTexts: Array.from(line?.querySelectorAll<HTMLElement>('.cm-hybrid-italic') ?? [])
          .map(element => element.textContent ?? ''),
      };
    });

    expect(inactiveState.text).toContain('x_i');
    expect(inactiveState.text).toContain('snake_case_value');
    expect(inactiveState.italicTexts).toEqual(['emphasis']);

    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: line.from + line.text.indexOf('x_i') + 1 } });
    });

    const activeState = await page.evaluate(() => {
      const activeLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(element => element.textContent?.includes('Use '));
      return {
        text: activeLine?.textContent ?? '',
        italicTexts: Array.from(activeLine?.querySelectorAll<HTMLElement>('.cm-active-italic') ?? [])
          .map(element => element.textContent ?? ''),
      };
    });

    expect(activeState.text).toContain('x_i');
    expect(activeState.text).toContain('snake_case_value');
    expect(activeState.italicTexts).toEqual(['emphasis']);
  });

  test('markdown editor styles Obsidian tags on inactive and active lines', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Tags #flash-attention and #gpu/memory stay visible.',
      '',
      'Ignore C# and #123 while editing.',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(3).from } });
    });

    await expect(page.locator('.cm-hybrid-tag')).toContainText(['#flash-attention', '#gpu/memory']);

    const inactiveStyles = await page.locator('.cm-hybrid-tag').first().evaluate(element => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        background: style.backgroundColor,
        radius: style.borderRadius,
      };
    });
    expect(inactiveStyles.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(inactiveStyles.radius).toBe('4px');

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from + 8 } });
    });

    await expect(page.locator('.cm-active-tag')).toContainText(['#flash-attention', '#gpu/memory']);
    await expect(page.locator('.cm-active-tag')).not.toContainText(['C#', '#123']);

    const rawLine = await page.locator('.cm-line').first().evaluate(line => line.textContent);
    expect(rawLine).toBe('Tags #flash-attention and #gpu/memory stay visible.');
  });

  test('hybrid rendering displays Obsidian footnotes until active', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'A claim with a footnote[^flash].',
      '',
      '[^flash]: FlashAttention uses tiling.',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
    });

    await expect(page.locator('.cm-hybrid-footnote-ref')).toHaveText('flash');
    await expect(page.locator('.cm-hybrid-footnote-def-label')).toHaveText('flash');
    await expect(page.locator('.cm-line').nth(0)).not.toContainText('[^flash]');
    await expect(page.locator('.cm-line').nth(2)).not.toContainText('[^flash]:');
    await expect(page.locator('.cm-line').nth(2)).toContainText('FlashAttention uses tiling.');

    const refStyles = await page.locator('.cm-hybrid-footnote-ref').evaluate(element => {
      const style = getComputedStyle(element);
      return {
        verticalAlign: style.verticalAlign,
        fontSize: style.fontSize,
        color: style.color,
      };
    });
    expect(refStyles.verticalAlign).toBe('super');

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from + 24 } });
    });

    await expect(page.locator('.cm-active-footnote-ref')).toHaveText('flash');
    const rawLine = await page.locator('.cm-line').first().evaluate(line => line.textContent);
    expect(rawLine).toBe('A claim with a footnote[^flash].');
  });

  test('copying rendered Obsidian footnote refs preserves raw markdown delimiters', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'A claim with a footnote[^flash].',
      '',
      '[^flash]: FlashAttention uses tiling.',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
    });

    await expect(page.locator('.cm-hybrid-footnote-ref')).toHaveText('flash');

    const copied = await page.evaluate(() => new Promise<string>((resolve) => {
      const ref = document.querySelector('.cm-hybrid-footnote-ref');
      if (!ref) throw new Error('Missing rendered footnote ref');
      const range = document.createRange();
      range.selectNodeContents(ref);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copied).toBe('[^flash]');
  });

  test('copying rendered Obsidian footnote definitions preserves raw markdown markers', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'A claim with a footnote[^flash].',
      '',
      '[^flash]: FlashAttention uses tiling.',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
    });

    await expect(page.locator('.cm-hybrid-footnote-def-label')).toHaveText('flash');

    const copied = await page.evaluate(() => new Promise<string>((resolve) => {
      const definitionLabel = document.querySelector('.cm-hybrid-footnote-def-label');
      if (!definitionLabel) throw new Error('Missing rendered footnote definition label');
      const range = document.createRange();
      range.selectNodeContents(definitionLabel);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copied).toBe('[^flash]: ');
  });

  test('hybrid rendering treats escaped markdown punctuation as literal like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Escaped \\*not italic\\* and \\[[literal\\]] plus \\#not-a-tag.',
      '',
      'Regular *italic* and #real-tag.',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
    });

    const renderedLine = await page.locator('.cm-line').first().evaluate(line => {
      const style = getComputedStyle(line);
      return {
        text: line.textContent,
        fontStyle: style.fontStyle,
        italicCount: line.querySelectorAll('.cm-hybrid-italic').length,
        linkCount: line.querySelectorAll('.cm-hl-link').length,
        tagCount: line.querySelectorAll('.cm-hybrid-tag').length,
      };
    });

    expect(renderedLine.text).toBe('Escaped *not italic* and [[literal]] plus #not-a-tag.');
    expect(renderedLine.italicCount).toBe(0);
    expect(renderedLine.linkCount).toBe(0);
    expect(renderedLine.tagCount).toBe(0);
    expect(renderedLine.fontStyle).not.toBe('italic');

    await expect(page.locator('.cm-hybrid-italic')).toContainText('italic');
    await expect(page.locator('.cm-hybrid-tag')).toContainText('#real-tag');

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from + 9 } });
    });

    const activeLine = await page.locator('.cm-line').first().evaluate(line => line.textContent);
    expect(activeLine).toBe('Escaped \\*not italic\\* and \\[[literal\\]] plus \\#not-a-tag.');
  });

  test('copying rendered escaped Markdown punctuation preserves raw backslashes', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const escapedLine = 'Escaped \\*not italic\\* and \\#not-a-tag.';
    const renderedText = 'Escaped *not italic* and #not-a-tag.';
    const doc = [
      escapedLine,
      '',
      'Regular *italic* and #real-tag.',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
    });

    const renderedLine = page.locator('.cm-line').first();
    await expect(renderedLine).toHaveText(renderedText);

    const copied = await renderedLine.evaluate(line => new Promise<string>((resolve) => {
      const range = document.createRange();
      range.selectNodeContents(line);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copied).toBe(escapedLine);

    const copiedEscapedTag = await page.evaluate(() => new Promise<string>((resolve) => {
      const view = window.__cmView;
      const line = view.state.doc.line(1);
      const start = line.from + line.text.indexOf('#not-a-tag');
      const end = start + '#not-a-tag'.length;
      const startDom = view.domAtPos(start);
      const endDom = view.domAtPos(end);
      const range = document.createRange();
      range.setStart(startDom.node, startDom.offset);
      range.setEnd(endDom.node, endDom.offset);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copiedEscapedTag).toBe('\\#not-a-tag');
  });

  test('hybrid rendering keeps links tags and footnotes literal inside inline code', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Inline code `https://example.com [[FlashAttention]] [paper](raw/paper.pdf) #literal [^code]` stays literal.',
      '',
      'Outside https://example.com [[FlashAttention]] [paper](raw/paper.pdf) #real [^out].',
      '[^out]: rendered footnote.',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
    });

    const inlineCodeLine = await page.locator('.cm-line').first().evaluate(line => ({
      text: line.textContent,
      linkCount: line.querySelectorAll('.cm-hl-link').length,
      tagCount: line.querySelectorAll('.cm-hybrid-tag').length,
      footnoteCount: line.querySelectorAll('.cm-hybrid-footnote-ref').length,
    }));

    expect(inlineCodeLine.text).toBe(
      'Inline code https://example.com [[FlashAttention]] [paper](raw/paper.pdf) #literal [^code] stays literal.',
    );
    expect(inlineCodeLine.linkCount).toBe(0);
    expect(inlineCodeLine.tagCount).toBe(0);
    expect(inlineCodeLine.footnoteCount).toBe(0);

    const outsideLine = await page.locator('.cm-line').nth(2).evaluate(line => ({
      linkCount: line.querySelectorAll('.cm-hl-link').length,
      tagCount: line.querySelectorAll('.cm-hybrid-tag').length,
      footnoteCount: line.querySelectorAll('.cm-hybrid-footnote-ref').length,
    }));
    expect(outsideLine.linkCount).toBe(3);
    expect(outsideLine.tagCount).toBe(1);
    expect(outsideLine.footnoteCount).toBe(1);

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from + 14 } });
    });

    const activeInlineCodeLine = await page.locator('.cm-line').first().evaluate(line => ({
      activeLinkCount: line.querySelectorAll('.cm-active-link-label').length,
      activeCodeCount: line.querySelectorAll('.cm-active-inline-code').length,
      text: line.textContent,
    }));
    expect(activeInlineCodeLine.text).toBe(doc.split('\n')[0]);
    expect(activeInlineCodeLine.activeLinkCount).toBe(0);
    expect(activeInlineCodeLine.activeCodeCount).toBe(1);
  });

  test('hybrid rendering supports multi-backtick inline code like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Double ticks ``run `literal` [paper](raw/paper.pdf) [[FlashAttention]] #literal [^code]`` stay literal.',
      '',
      'Outside [paper](raw/paper.pdf) [[FlashAttention]] #real [^out].',
      '[^out]: rendered footnote.',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
    });

    const inactiveLine = await page.locator('.cm-line').first().evaluate(line => ({
      text: line.textContent,
      linkCount: line.querySelectorAll('.cm-hl-link').length,
      tagCount: line.querySelectorAll('.cm-hybrid-tag').length,
      footnoteCount: line.querySelectorAll('.cm-hybrid-footnote-ref').length,
    }));

    expect(inactiveLine.text).toBe(
      'Double ticks run `literal` [paper](raw/paper.pdf) [[FlashAttention]] #literal [^code] stay literal.',
    );
    expect(inactiveLine.linkCount).toBe(0);
    expect(inactiveLine.tagCount).toBe(0);
    expect(inactiveLine.footnoteCount).toBe(0);

    const outsideLine = await page.locator('.cm-line').nth(2).evaluate(line => ({
      linkCount: line.querySelectorAll('.cm-hl-link').length,
      tagCount: line.querySelectorAll('.cm-hybrid-tag').length,
      footnoteCount: line.querySelectorAll('.cm-hybrid-footnote-ref').length,
    }));
    expect(outsideLine.linkCount).toBe(2);
    expect(outsideLine.tagCount).toBe(1);
    expect(outsideLine.footnoteCount).toBe(1);

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from + 18 } });
    });

    const activeLine = await page.locator('.cm-line').first().evaluate(line => ({
      activeLinkCount: line.querySelectorAll('.cm-active-link-label').length,
      activeCodeCount: line.querySelectorAll('.cm-active-inline-code').length,
      text: line.textContent,
    }));
    expect(activeLine.text).toBe(doc.split('\n')[0]);
    expect(activeLine.activeLinkCount).toBe(0);
    expect(activeLine.activeCodeCount).toBe(1);
  });

  test('hybrid rendering keeps image syntax literal inside inline code', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    const doc = [
      `Inline code \`![Attention](${gif}) and ![[raw/images/attention.png]]\` stays literal.`,
      '',
      `Outside ![Attention](${gif}) and ![[raw/images/attention.png]].`,
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
    });

    const inlineCodeLine = await page.locator('.cm-line').first().evaluate(line => ({
      text: line.textContent,
      imageCount: line.querySelectorAll('.cm-hybrid-image').length,
    }));
    expect(inlineCodeLine.text).toBe(
      `Inline code ![Attention](${gif}) and ![[raw/images/attention.png]] stays literal.`,
    );
    expect(inlineCodeLine.imageCount).toBe(0);

    const outsideLine = await page.locator('.cm-line').nth(2).evaluate(line => ({
      imageCount: line.querySelectorAll('.cm-hybrid-image').length,
    }));
    expect(outsideLine.imageCount).toBe(2);
  });

  test('hybrid rendering treats escaped image syntax as literal like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    const doc = [
      `Escaped \\![Attention](${gif}) and \\![[raw/images/attention.png]].`,
      '',
      `Regular ![Attention](${gif}) and ![[raw/images/attention.png]].`,
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
    });

    const escapedLine = await page.locator('.cm-line').first().evaluate(line => ({
      text: line.textContent,
      imageCount: line.querySelectorAll('.cm-hybrid-image').length,
    }));
    expect(escapedLine.text).toBe(
      `Escaped ![Attention](${gif}) and ![[raw/images/attention.png]].`,
    );
    expect(escapedLine.imageCount).toBe(0);

    const regularLine = await page.locator('.cm-line').nth(2).evaluate(line => ({
      imageCount: line.querySelectorAll('.cm-hybrid-image').length,
    }));
    expect(regularLine.imageCount).toBe(2);
  });

  test('hybrid rendering hides Obsidian comments until the comment line is active', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Visible %%secret note%% text',
      '',
      'Next line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(3).from } });
    });

    await expect.poll(() => page.locator('.cm-line').first().evaluate(line => line.textContent))
      .toBe('Visible  text');

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });

    await expect.poll(() => page.locator('.cm-line').first().evaluate(line => line.textContent))
      .toBe('Visible %%secret note%% text');
  });

  test('hybrid rendering hides multi-line Obsidian comment blocks until active', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Before %%hidden',
      'still hidden',
      'hidden%% after',
      '',
      'Outside',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(5).from } });
    });

    await expect.poll(() => page.locator('.cm-line').nth(0).evaluate(line => line.textContent))
      .toBe('Before ');
    await expect.poll(() => page.locator('.cm-line').nth(1).evaluate(line => line.textContent))
      .toBe('');
    await expect.poll(() => page.locator('.cm-line').nth(2).evaluate(line => line.textContent))
      .toBe(' after');

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
    });

    await expect.poll(() => page.locator('.cm-line').nth(1).evaluate(line => line.textContent))
      .toBe('still hidden');
  });

  test('hybrid rendering hides Markdown HTML comments until active like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Visible <!--hidden html note--> text',
      'Before <!--hidden',
      'still hidden',
      'hidden--> after',
      '',
      'Outside',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(6).from } });
    });

    await expect.poll(() => page.locator('.cm-line').nth(0).evaluate(line => line.textContent))
      .toBe('Visible  text');
    await expect.poll(() => page.locator('.cm-line').nth(1).evaluate(line => line.textContent))
      .toBe('Before ');
    await expect.poll(() => page.locator('.cm-line').nth(2).evaluate(line => line.textContent))
      .toBe('');
    await expect.poll(() => page.locator('.cm-line').nth(3).evaluate(line => line.textContent))
      .toBe(' after');

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });

    await expect.poll(() => page.locator('.cm-line').nth(0).evaluate(line => line.textContent))
      .toBe('Visible <!--hidden html note--> text');
  });

  test('hybrid rendering renders sanitized inline HTML until active like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const htmlLine = 'HTML has <u>underlined</u>, <mark>highlighted</mark>, and <kbd>Esc</kbd>.';
    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, ['Before', htmlLine, 'After'].join('\n'));

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });

    await expect(page.locator('.cm-hybrid-inline-html u')).toContainText('underlined');
    await expect(page.locator('.cm-hybrid-inline-html mark')).toContainText('highlighted');
    await expect(page.locator('.cm-hybrid-inline-html kbd')).toContainText('Esc');

    const inactiveHtml = await page.evaluate(() => {
      const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(element => element.textContent?.includes('HTML has'));
      const underline = line?.querySelector<HTMLElement>('.cm-hybrid-inline-html u');
      const mark = line?.querySelector<HTMLElement>('.cm-hybrid-inline-html mark');
      const kbd = line?.querySelector<HTMLElement>('.cm-hybrid-inline-html kbd');
      return {
        text: line?.textContent ?? '',
        underlineDecoration: underline ? getComputedStyle(underline).textDecorationLine : '',
        markBackground: mark ? getComputedStyle(mark).backgroundColor : '',
        kbdTag: kbd?.tagName.toLowerCase() ?? '',
      };
    });
    expect(inactiveHtml.text).not.toContain('<u>');
    expect(inactiveHtml.text).not.toContain('<mark>');
    expect(inactiveHtml.underlineDecoration).toContain('underline');
    expect(inactiveHtml.markBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(inactiveHtml.kbdTag).toBe('kbd');

    await page.locator('.cm-hybrid-inline-html u').click();
    await expect(page.locator('.cm-line').filter({ hasText: htmlLine })).toBeVisible();

    const copied = await page.evaluate(() => (
      new Promise<string>((resolve) => {
        const view = window.__cmView;
        const selection = window.getSelection();
        selection?.removeAllRanges();
        view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
        const target = document.querySelector('.cm-hybrid-inline-html');
        if (!target) throw new Error('Missing rendered inline HTML');
        const range = document.createRange();
        range.selectNodeContents(target);
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.addEventListener('copy', event => {
          resolve(event.clipboardData?.getData('text/plain') ?? '');
        }, { once: true });
        document.execCommand('copy');
      })
    ));
    expect(copied).toBe('<u>underlined</u>');
  });

  test('hybrid rendering renders sanitized void inline HTML until active like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const htmlLine = 'HTML break before<br>after, word<wbr>break, and image <img alt="diagram" src="raw/images/attention.png" onerror="window.__htmlXss=1">.';
    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, ['Before', htmlLine, 'After'].join('\n'));

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });

    await expect(page.locator('.cm-hybrid-inline-html br')).toHaveCount(1);
    await expect(page.locator('.cm-hybrid-inline-html wbr')).toHaveCount(1);
    await expect(page.locator('.cm-hybrid-inline-html img[alt="diagram"]')).toHaveCount(1);

    const inactiveHtml = await page.evaluate(() => {
      const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(element => element.textContent?.includes('HTML break before'));
      const image = line?.querySelector<HTMLImageElement>('.cm-hybrid-inline-html img');
      return {
        text: line?.textContent ?? '',
        imageOnError: image?.getAttribute('onerror') ?? null,
        xssFlag: Boolean(window.__htmlXss),
      };
    });
    expect(inactiveHtml.text).not.toContain('<br>');
    expect(inactiveHtml.text).not.toContain('<wbr>');
    expect(inactiveHtml.text).not.toContain('<img');
    expect(inactiveHtml.imageOnError).toBeNull();
    expect(inactiveHtml.xssFlag).toBe(false);

    await page.evaluate(() => {
      const widget = document.querySelector('.cm-hybrid-inline-html');
      if (!widget) throw new Error('Missing rendered void inline HTML');
      widget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    await expect(page.locator('.cm-line').filter({ hasText: htmlLine })).toBeVisible();

    const copied = await page.evaluate(() => (
      new Promise<string>((resolve) => {
        const view = window.__cmView;
        const selection = window.getSelection();
        selection?.removeAllRanges();
        view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
        const target = document.querySelector('.cm-hybrid-inline-html');
        if (!target) throw new Error('Missing rendered void inline HTML');
        const range = document.createRange();
        range.selectNodeContents(target);
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.addEventListener('copy', event => {
          resolve(event.clipboardData?.getData('text/plain') ?? '');
        }, { once: true });
        document.execCommand('copy');
      })
    ));
    expect(copied).toBe('<br>');
  });

  test('hybrid rendering shows math like Obsidian live preview and keeps active block math preview', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Prelude line',
      '',
      'Euler wrote $e^{i\\\\pi} + 1 = 0$ in one line.',
      '',
      '$$',
      '\\\\int_0^1 x^2 \\\\, dx = \\\\frac{1}{3}',
      '$$',
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-inline-math mjx-container[jax="SVG"]')).toBeVisible();
    await expect(page.locator('.cm-hybrid-math-block mjx-container[jax="SVG"]')).toBeVisible();

    const inlineMathSurface = await page.locator('.cm-hybrid-inline-math').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderTopLeftRadius: style.borderTopLeftRadius,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
      };
    });
    expect(inlineMathSurface.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(inlineMathSurface.borderTopLeftRadius).toBe('0px');
    expect(inlineMathSurface.paddingLeft).toBe('0px');
    expect(inlineMathSurface.paddingRight).toBe('0px');

    const mathSurface = await page.locator('.cm-hybrid-math-block-inner').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderTopColor: style.borderTopColor,
        borderTopStyle: style.borderTopStyle,
        borderTopWidth: style.borderTopWidth,
        paddingTop: style.paddingTop,
        textAlign: style.textAlign,
      };
    });

    expect(mathSurface.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(mathSurface.borderTopStyle).toBe('solid');
    expect(mathSurface.borderTopWidth).toBe('1px');
    expect(mathSurface.borderTopColor).toBe('rgba(0, 0, 0, 0)');
    expect(mathSurface.paddingTop).toBe('0px');
    expect(mathSurface.textAlign).toBe('center');

    await page.locator('.cm-hybrid-math-block-inner').hover();
    await expect.poll(() => page.locator('.cm-hybrid-math-block-inner').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderTopColor: style.borderTopColor,
        borderTopStyle: style.borderTopStyle,
        borderTopWidth: style.borderTopWidth,
      };
    })).toEqual({
      borderTopColor: 'rgb(62, 62, 62)',
      borderTopStyle: 'solid',
      borderTopWidth: '1px',
    });

    const renderedText = await page.locator('.cm-content').textContent();
    expect(renderedText).not.toContain('$e^{i\\pi} + 1 = 0$');
    expect(renderedText).not.toContain('$$');

    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: line.from + 20 } });
    });

    await expect(page.locator('.cm-hybrid-inline-math')).toHaveCount(0);
    expect(await page.evaluate(() => window.__cmView.state.doc.line(3).text)).toBe(
      'Euler wrote $e^{i\\\\pi} + 1 = 0$ in one line.',
    );

    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(6);
      view.dispatch({ selection: { anchor: line.from + 8 } });
    });

    await expect(page.locator('.cm-hybrid-math-block')).toHaveCount(1);
    await expect(page.locator('.cm-hybrid-math-block mjx-container[jax="SVG"]')).toBeVisible();
    expect(await page.evaluate(() => [
      window.__cmView.state.doc.line(5).text,
      window.__cmView.state.doc.line(6).text,
      window.__cmView.state.doc.line(7).text,
    ])).toEqual([
      '$$',
      '\\\\int_0^1 x^2 \\\\, dx = \\\\frac{1}{3}',
      '$$',
    ]);

    const activeMathLayout = await page.evaluate(() => {
      const sourceLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent?.includes('\\\\int_0^1'));
      const preview = document.querySelector<HTMLElement>('.cm-hybrid-math-block');
      const sourceRect = sourceLine?.getBoundingClientRect();
      const previewRect = preview?.getBoundingClientRect();
      return {
        sourceText: sourceLine?.textContent ?? '',
        sourceBottom: sourceRect?.bottom ?? 0,
        previewTop: previewRect?.top ?? 0,
      };
    });
    expect(activeMathLayout.sourceText).toContain('\\\\int_0^1');
    expect(activeMathLayout.previewTop).toBeGreaterThanOrEqual(activeMathLayout.sourceBottom);
  });

  test('hybrid rendering renders inline math inside list items like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '---',
      'id: concept_math_code',
      'tags: [test, math, code]',
      '---',
      '',
      '# Math and Code Rendering Test',
      '',
      '## Math Inside Lists',
      '',
      'Key equations:',
      '',
      '- Softmax: $\\sigma(x_i) = \\frac{e^{x_i}}{\\sum_j e^{x_j}}$',
      '- Cross-entropy loss: $L = -\\sum_i y_i \\log(\\hat{y}_i)$',
      '- Gradient: $\\frac{\\partial L}{\\partial x_i} = \\hat{y}_i - y_i$',
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Math and Code' }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-inline-math mjx-container[jax="SVG"]')).toHaveCount(3);

    const renderedLines = await page.evaluate(() => (
      Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .map(line => line.textContent ?? '')
        .filter(text => /Softmax|Cross-entropy|Gradient/.test(text))
    ));

    expect(renderedLines).toHaveLength(3);
    for (const line of renderedLines) {
      expect(line).not.toContain('$');
    }
  });

  test('hybrid rendering keeps active single-line display math source with a rendered preview', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Before',
      '',
      '$$softmax(x_i) = exp(x_i) / sum(exp(x_j))$$',
      '',
      'After',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });

    await expect(page.locator('.cm-hybrid-math-block')).toHaveCount(1);
    expect(await page.locator('.cm-content').textContent()).not.toContain('$$softmax');

    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: line.from + 2 } });
    });

    await expect(page.locator('.cm-hybrid-math-block')).toHaveCount(1);
    await expect(page.locator('.cm-hybrid-math-block mjx-container[jax="SVG"]')).toBeVisible();

    const activeMathLayout = await page.evaluate(() => {
      const sourceLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent?.includes('$$softmax'));
      const preview = document.querySelector<HTMLElement>('.cm-hybrid-math-block');
      const normalLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent === 'Before');
      const sourceRect = sourceLine?.getBoundingClientRect();
      const previewRect = preview?.getBoundingClientRect();
      const normalRect = normalLine?.getBoundingClientRect();
      return {
        sourceText: sourceLine?.textContent ?? '',
        sourceHeight: sourceRect?.height ?? 0,
        normalHeight: normalRect?.height ?? 0,
        sourceBottom: sourceRect?.bottom ?? 0,
        previewTop: previewRect?.top ?? 0,
      };
    });
    expect(activeMathLayout.sourceText).toContain('$$softmax(x_i)');
    expect(Math.abs(activeMathLayout.sourceHeight - activeMathLayout.normalHeight)).toBeLessThanOrEqual(1);
    expect(activeMathLayout.previewTop).toBeGreaterThanOrEqual(activeMathLayout.sourceBottom);

    const activeMathStyles = await page.evaluate(() => {
      const delimiters = Array.from(document.querySelectorAll<HTMLElement>('.cm-active-math-delimiter'));
      const source = document.querySelector<HTMLElement>('.cm-active-math-source');
      const sourceLine = source?.closest<HTMLElement>('.cm-line');
      const sourceStyle = source ? getComputedStyle(source) : null;
      const delimiterStyle = delimiters[0] ? getComputedStyle(delimiters[0]) : null;
      const lineStyle = sourceLine ? getComputedStyle(sourceLine) : null;
      return {
        delimiterCount: delimiters.length,
        delimiterTexts: delimiters.map(element => element.textContent),
        sourceText: source?.textContent ?? '',
        sourceColor: sourceStyle?.color ?? '',
        delimiterColor: delimiterStyle?.color ?? '',
        lineColor: lineStyle?.color ?? '',
        sourceFontStyle: sourceStyle?.fontStyle ?? '',
      };
    });
    expect(activeMathStyles.delimiterCount).toBe(2);
    expect(activeMathStyles.delimiterTexts).toEqual(['$$', '$$']);
    expect(activeMathStyles.sourceText).toBe('softmax(x_i) = exp(x_i) / sum(exp(x_j))');
    expect(activeMathStyles.sourceColor).not.toBe(activeMathStyles.lineColor);
    expect(activeMathStyles.delimiterColor).not.toBe(activeMathStyles.lineColor);
    expect(activeMathStyles.sourceFontStyle).toBe('italic');
  });

  test('inactive single-line display math hides source text while keeping its line number and preview', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '# Online Softmax',
      '',
      'Online softmax is the numerical trick that makes FlashAttention work.',
      '',
      'Standard Softmax',
      '',
      'For a vector $x = [x_1, ..., x_n]$:',
      '',
      '$$softmax(x_i) = exp(x_i) / sum(exp(x_j))$$',
      '',
      'After',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });
    await expect(page.locator('.cm-hybrid-math-block')).toBeVisible();

    const mathLayout = await page.evaluate(() => {
      const editorLines = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .map(line => {
          const rect = line.getBoundingClientRect();
          return {
            text: line.textContent ?? '',
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
          };
        });
      const preview = document.querySelector<HTMLElement>('.cm-hybrid-math-block');
      const normalLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent === 'Online softmax is the numerical trick that makes FlashAttention work.');
      const numberedRows = Array.from(document.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement'))
        .map(element => {
          const rect = element.getBoundingClientRect();
          return {
            text: element.textContent?.trim() ?? '',
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
          };
        })
        .filter(row => row.text.length > 0 && row.height > 0);
      const previewRect = preview?.getBoundingClientRect();
      const normalRect = normalLine?.getBoundingClientRect();
      const sourceLineNumber = window.__cmView.state.doc.lineAt(
        window.__cmView.state.doc.toString().indexOf('$$softmax'),
      ).number;
      const sourceNumberRow = numberedRows.find(row => row.text === String(sourceLineNumber));
      const nextNumberRow = numberedRows.find(row => row.text === String(sourceLineNumber + 1));
      const mathRow = sourceNumberRow
        ? editorLines.find(line => Math.abs(line.top - sourceNumberRow.top) <= 1)
        : undefined;
      return {
        sourceLineNumber,
        visibleRawSourceCount: editorLines.filter(line => line.text.includes('$$softmax')).length,
        renderedEditorText: document.querySelector('.cm-content')?.textContent ?? '',
        mathRowText: mathRow?.text ?? '',
        sourceHeight: mathRow?.height ?? 0,
        normalHeight: normalRect?.height ?? 0,
        sourceTop: mathRow?.top ?? 0,
        sourceBottom: mathRow?.bottom ?? 0,
        previewTop: previewRect?.top ?? 0,
        previewBottom: previewRect?.bottom ?? 0,
        previewIsInsideSourceLine: Boolean(preview?.closest('.cm-line')?.textContent?.includes('$$softmax')),
        sourceNumberTop: sourceNumberRow?.top ?? 0,
        sourceNumberBottom: sourceNumberRow?.bottom ?? 0,
        nextNumberTop: nextNumberRow?.top ?? 0,
      };
    });
    expect(mathLayout.sourceLineNumber).toBe(9);
    expect(mathLayout.visibleRawSourceCount).toBe(0);
    expect(mathLayout.renderedEditorText).not.toContain('$$softmax');
    expect(mathLayout.mathRowText).not.toContain('$$softmax');
    expect(Math.abs(mathLayout.sourceHeight - mathLayout.normalHeight)).toBeLessThanOrEqual(1);
    expect(Math.abs(mathLayout.sourceNumberTop - mathLayout.sourceTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(mathLayout.sourceNumberBottom - mathLayout.sourceBottom)).toBeLessThanOrEqual(1);
    expect(mathLayout.previewTop).toBeGreaterThanOrEqual(mathLayout.sourceBottom);
    expect(mathLayout.nextNumberTop).toBeGreaterThanOrEqual(mathLayout.previewBottom);
    expect(mathLayout.previewIsInsideSourceLine).toBe(false);

    const lineNumbers = await page.locator('.cm-lineNumbers .cm-gutterElement').evaluateAll(elements => (
      elements
        .map(element => element.textContent?.trim() ?? '')
        .filter(Boolean)
    ));
    expect(lineNumbers).toEqual(expect.arrayContaining(['1', '2', '3', '4', '5', '6', '7', '8', '9']));
  });

  test('inactive single-line display math keeps the source row at normal line height', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Before',
      '',
      '$$softmax(x_i) = exp(x_i) / sum(exp(x_j))$$',
      '',
      'After',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });
    await expect(page.locator('.cm-hybrid-math-block')).toBeVisible();

    const rowHeights = await page.evaluate(() => {
      const normalLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent === 'Before');
      const numberedRows = Array.from(document.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement'))
        .map(element => {
          const rect = element.getBoundingClientRect();
          return {
            text: element.textContent?.trim() ?? '',
            top: rect.top,
            height: rect.height,
          };
        })
        .filter(row => row.text.length > 0 && row.height > 0);
      const mathNumber = window.__cmView.state.doc.lineAt(
        window.__cmView.state.doc.toString().indexOf('$$softmax'),
      ).number;
      const mathNumberRow = numberedRows.find(row => row.text === String(mathNumber));
      const mathLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => {
          if (!mathNumberRow) return false;
          return Math.abs(line.getBoundingClientRect().top - mathNumberRow.top) <= 1;
        });
      return {
        normal: normalLine?.getBoundingClientRect().height ?? 0,
        math: mathLine?.getBoundingClientRect().height ?? 0,
        mathText: mathLine?.textContent ?? '',
      };
    });
    expect(rowHeights.normal).toBeGreaterThan(0);
    expect(Math.abs(rowHeights.math - rowHeights.normal)).toBeLessThanOrEqual(1);
    expect(rowHeights.mathText).not.toContain('$$softmax');
  });

  test('inactive multi-line display math keeps source rows and line numbers', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Before',
      '',
      '$$',
      'softmax(x_i) = exp(x_i) / sum(exp(x_j))',
      '$$',
      '',
      'After',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });
    await expect(page.locator('.cm-hybrid-math-block')).toBeVisible();

    const mathLayout = await page.evaluate(() => {
      const normalLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent === 'Before');
      const normalHeight = normalLine?.getBoundingClientRect().height ?? 0;
      const numberedRows = Array.from(document.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement'))
        .map(element => {
          const rect = element.getBoundingClientRect();
          return {
            text: element.textContent?.trim() ?? '',
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
          };
        })
        .filter(row => row.text.length > 0 && row.height > 0);
      const editorLines = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .map(line => {
          const rect = line.getBoundingClientRect();
          return {
            text: line.textContent ?? '',
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
          };
        });
      const sourceRows = [3, 4, 5].map(lineNumber => {
        const numberRow = numberedRows.find(row => row.text === String(lineNumber));
        const editorLine = editorLines.find(line => (
          numberRow ? Math.abs(line.top - numberRow.top) <= 1 : false
        ));
        return {
          lineNumber,
          numberTop: numberRow?.top ?? 0,
          numberBottom: numberRow?.bottom ?? 0,
          text: editorLine?.text ?? '',
          top: editorLine?.top ?? 0,
          bottom: editorLine?.bottom ?? 0,
          height: editorLine?.height ?? 0,
        };
      });
      const preview = document.querySelector<HTMLElement>('.cm-hybrid-math-block');
      const previewRect = preview?.getBoundingClientRect();
      const afterNumber = numberedRows.find(row => row.text === '7');

      return {
        sourceRows,
        normalHeight,
        renderedText: document.querySelector('.cm-content')?.textContent ?? '',
        lineNumbers: numberedRows.map(row => row.text),
        previewTop: previewRect?.top ?? 0,
        previewBottom: previewRect?.bottom ?? 0,
        afterTop: afterNumber?.top ?? 0,
      };
    });

    expect(mathLayout.lineNumbers).toEqual(expect.arrayContaining(['3', '4', '5']));
    expect(mathLayout.renderedText).not.toContain('softmax(x_i) = exp(x_i)');
    for (const row of mathLayout.sourceRows) {
      expect(row.text).not.toContain('$$');
      expect(row.text).not.toContain('softmax(x_i)');
      expect(Math.abs(row.height - mathLayout.normalHeight)).toBeLessThanOrEqual(1);
      expect(Math.abs(row.numberTop - row.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(row.numberBottom - row.bottom)).toBeLessThanOrEqual(1);
    }
    expect(mathLayout.previewTop).toBeGreaterThanOrEqual(mathLayout.sourceRows.at(-1)!.bottom);
    expect(mathLayout.afterTop).toBeGreaterThanOrEqual(mathLayout.previewBottom);
  });

  test('inactive single-line display math stays hidden while editing the previous inline math line', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '# Online Softmax',
      '',
      'Standard Softmax',
      '',
      'For a vector $x = [x_1, ..., x_n]$:',
      '',
      '$$softmax(x_i) = exp(x_i) / sum(exp(x_j))$$',
      '',
      'After',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(5);
      view.dispatch({ selection: { anchor: line.from + line.text.indexOf('$x') + 1 } });
    });
    await expect(page.locator('.cm-hybrid-math-block')).toBeVisible();

    const mathVisibility = await page.evaluate(() => {
      const rawSource = '$$softmax(x_i) = exp(x_i) / sum(exp(x_j))$$';
      const mathLineNumber = window.__cmView.state.doc.lineAt(
        window.__cmView.state.doc.toString().indexOf(rawSource),
      ).number;
      const numberedRows = Array.from(document.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement'))
        .map(element => {
          const rect = element.getBoundingClientRect();
          return {
            text: element.textContent?.trim() ?? '',
            top: rect.top,
            height: rect.height,
          };
        })
        .filter(row => row.text.length > 0 && row.height > 0);
      const mathNumberRow = numberedRows.find(row => row.text === String(mathLineNumber));
      const mathLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => mathNumberRow && Math.abs(line.getBoundingClientRect().top - mathNumberRow.top) <= 1);

      return {
        activeLine: window.__cmView.state.doc.lineAt(window.__cmView.state.selection.main.head).number,
        mathLineNumber,
        contentText: document.querySelector('.cm-content')?.textContent ?? '',
        mathLineText: mathLine?.textContent ?? '',
      };
    });

    expect(mathVisibility.activeLine).toBe(5);
    expect(mathVisibility.mathLineNumber).toBe(7);
    expect(mathVisibility.contentText).not.toContain('$$softmax');
    expect(mathVisibility.mathLineText).not.toContain('$$softmax');
  });

  test('hybrid rendering turns fenced code blocks into Obsidian-like preview blocks until the block is active', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Prelude line',
      '',
      '```ts',
      'const greet = (user_name: string) => `hi ${user_name}`;',
      'console.log(greet("world_name"));',
      '```',
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-codeblock')).toBeVisible();
    await expect(page.locator('.cm-hybrid-codeblock-language')).toContainText(['TypeScript']);
    await expect(page.locator('.cm-hybrid-codeblock-copy')).toBeVisible();
    await expect(page.locator('.cm-hybrid-codeblock-content-line').filter({ hasText: 'const greet' })).toBeVisible();
    await expect(page.locator('.cm-hybrid-codeblock-content-line').filter({ hasText: 'console.log' })).toBeVisible();
    await expect(page.locator('.cm-hybrid-codeblock-content-line .cm-hybrid-prism-token.token.keyword').filter({ hasText: 'const' })).toBeVisible();
    await expect(page.locator('.cm-hybrid-codeblock-content-line .cm-hybrid-prism-token.token.function').filter({ hasText: 'greet' }).first()).toBeVisible();
    const headerLayout = await page.locator('.cm-hybrid-codeblock-header').evaluate((header) => {
      const label = header.querySelector('.cm-hybrid-codeblock-language');
      const copy = header.querySelector('.cm-hybrid-codeblock-copy');
      const headerRect = header.getBoundingClientRect();
      const labelRect = label?.getBoundingClientRect();
      const copyRect = copy?.getBoundingClientRect();
      const copyStyle = copy ? getComputedStyle(copy) : null;
      return {
        labelStartsOnRightHalf: labelRect ? labelRect.left > headerRect.left + headerRect.width / 2 : false,
        labelRightGap: labelRect ? Math.round(headerRect.right - labelRect.right) : Number.POSITIVE_INFINITY,
        copyStaysLeftOfLanguage: copyRect && labelRect ? copyRect.right <= labelRect.left : false,
        copyOpacity: copyStyle?.opacity ?? '',
      };
    });
    expect(headerLayout.labelStartsOnRightHalf).toBe(true);
    expect(headerLayout.labelRightGap).toBeLessThan(24);
    expect(headerLayout.copyStaysLeftOfLanguage).toBe(true);
    expect(headerLayout.copyOpacity).toBe('0');
    await page.locator('.cm-hybrid-codeblock').hover();
    await expect.poll(() => page.locator('.cm-hybrid-codeblock-copy').evaluate(element => (
      getComputedStyle(element).opacity
    ))).toBe('1');
    const codeLineFont = await page.locator('.cm-hybrid-codeblock-content-line').first().evaluate(element => (
      getComputedStyle(element).fontFamily
    ));
    expect(codeLineFont.toLowerCase()).toMatch(/mono|menlo|code/);
    const codeBlockLineHeights = await page.evaluate(() => {
      const header = document.querySelector('.cm-hybrid-codeblock-header');
      const codeLine = document.querySelector('.cm-hybrid-codeblock-content-line');
      const normalLine = Array.from(document.querySelectorAll('.cm-line'))
        .find(line => line.textContent?.includes('Prelude line'));
      const headerRow = header?.closest('.cm-line');
      const footerRow = document.querySelector('.cm-hybrid-codeblock-footer')?.closest('.cm-line');
      return {
        header: header?.getBoundingClientRect().height ?? 0,
        headerRow: headerRow?.getBoundingClientRect().height ?? 0,
        footerRow: footerRow?.getBoundingClientRect().height ?? 0,
        codeLine: codeLine?.getBoundingClientRect().height ?? 0,
        normalLine: normalLine?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(codeBlockLineHeights.header).toBeGreaterThan(0);
    expect(codeBlockLineHeights.headerRow).toBeGreaterThan(0);
    expect(codeBlockLineHeights.footerRow).toBeGreaterThan(0);
    expect(codeBlockLineHeights.codeLine).toBeGreaterThan(0);
    expect(codeBlockLineHeights.normalLine).toBeGreaterThan(0);
    expect(Math.abs(codeBlockLineHeights.header - codeBlockLineHeights.normalLine)).toBeLessThanOrEqual(1);
    expect(Math.abs(codeBlockLineHeights.headerRow - codeBlockLineHeights.normalLine)).toBeLessThanOrEqual(1);
    expect(Math.abs(codeBlockLineHeights.footerRow - codeBlockLineHeights.normalLine)).toBeLessThanOrEqual(1);

    const lineNumbers = await page.locator('.cm-lineNumbers .cm-gutterElement').evaluateAll(elements => (
      elements
        .map(element => element.textContent?.trim() ?? '')
        .filter(Boolean)
    ));
    expect(lineNumbers).toEqual(expect.arrayContaining(['3', '4', '5', '6']));

    const codeSurface = await page.locator('.cm-hybrid-codeblock-inner').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderLeftStyle: style.borderLeftStyle,
        borderLeftWidth: style.borderLeftWidth,
        borderTopColor: style.borderTopColor,
        borderTopStyle: style.borderTopStyle,
        borderTopWidth: style.borderTopWidth,
      };
    });
    expect(codeSurface.borderTopStyle).toBe('solid');
    expect(codeSurface.borderTopWidth).toBe('1px');
    expect(codeSurface.borderLeftStyle).toBe('solid');
    expect(codeSurface.borderLeftWidth).toBe('1px');
    expect(codeSurface.borderTopColor).toBe('rgba(127, 127, 127, 0.22)');

    const codeFrameGeometry = await page.evaluate(() => {
      const elements = [
        document.querySelector<HTMLElement>('.cm-hybrid-codeblock-inner'),
        ...Array.from(document.querySelectorAll<HTMLElement>('.cm-hybrid-codeblock-content-line')),
        document.querySelector<HTMLElement>('.cm-hybrid-codeblock-footer'),
      ].filter((element): element is HTMLElement => Boolean(element));
      const rects = elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          className: element.className,
          left: rect.left,
          right: rect.right,
          borderLeftColor: style.borderLeftColor,
          borderRightColor: style.borderRightColor,
          borderTopColor: style.borderTopColor,
          borderBottomColor: style.borderBottomColor,
        };
      });
      const lefts = rects.map(rect => rect.left);
      const rights = rects.map(rect => rect.right);
      return {
        rects,
        maxLeftDelta: Math.max(...lefts) - Math.min(...lefts),
        maxRightDelta: Math.max(...rights) - Math.min(...rights),
      };
    });
    expect(codeFrameGeometry.maxLeftDelta).toBeLessThanOrEqual(1);
    expect(codeFrameGeometry.maxRightDelta).toBeLessThanOrEqual(1);

    await page.evaluate(() => {
      window.__copiedText = null;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            window.__copiedText = text;
          },
        },
      });
    });
    await page.locator('.cm-hybrid-codeblock').hover();
    await page.locator('.cm-hybrid-codeblock-copy').click();
    await expect.poll(() => page.evaluate(() => window.__copiedText)).toBe([
      'const greet = (user_name: string) => `hi ${user_name}`;',
      'console.log(greet("world_name"));',
    ].join('\n'));

    await page.evaluate(() => {
      window.__copiedText = null;
      window.__originalClipboard = navigator.clipboard;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: undefined,
      });
    });
    await page.locator('.cm-hybrid-codeblock').hover();
    await page.locator('.cm-hybrid-codeblock-copy').click();
    await expect.poll(() => page.evaluate(() => (
      window.__mockMessages?.filter((message) => message.type === 'copyText').at(-1)?.text
    ))).toBe([
      'const greet = (user_name: string) => `hi ${user_name}`;',
      'console.log(greet("world_name"));',
    ].join('\n'));
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: window.__originalClipboard,
      });
    });

    const renderedText = await page.locator('.cm-content').textContent();
    expect(renderedText).not.toContain('```ts');

    const inactiveCodeLayout = await page.evaluate(() => {
      const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-hybrid-codeblock-content-line'))
        .find(element => element.textContent?.includes('const greet'));
      const keyword = line?.querySelector<HTMLElement>('.cm-hybrid-prism-token.token.keyword');
      const lineRect = line?.getBoundingClientRect();
      const keywordStyle = keyword ? getComputedStyle(keyword) : null;
      return {
        lineLeft: lineRect?.left ?? 0,
        lineText: line?.textContent ?? '',
        keywordText: keyword?.textContent ?? '',
        keywordColor: keywordStyle?.color ?? '',
      };
    });
    expect(inactiveCodeLayout.lineText).toContain('user_name');

    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(4);
      view.dispatch({ selection: { anchor: line.from + 8 } });
    });

    await expect(page.locator('.cm-hybrid-codeblock')).toHaveCount(1);
    await expect(page.locator('.cm-hybrid-codeblock-content-line').filter({ hasText: 'const greet' })).toBeVisible();
    await expect(page.locator('.cm-hybrid-codeblock-content-line .cm-hybrid-prism-token.token.keyword').filter({ hasText: 'const' })).toBeVisible();
    const activeCodeLayout = await page.evaluate(() => {
      const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-hybrid-codeblock-content-line'))
        .find(element => element.textContent?.includes('const greet'));
      const keyword = line?.querySelector<HTMLElement>('.cm-hybrid-prism-token.token.keyword');
      const lineRect = line?.getBoundingClientRect();
      const keywordStyle = keyword ? getComputedStyle(keyword) : null;
      return {
        lineLeft: lineRect?.left ?? 0,
        lineText: line?.textContent ?? '',
        keywordText: keyword?.textContent ?? '',
        keywordColor: keywordStyle?.color ?? '',
      };
    });
    expect(activeCodeLayout.lineText).toBe(inactiveCodeLayout.lineText);
    expect(activeCodeLayout.lineText).toContain('user_name');
    expect(Math.abs(activeCodeLayout.lineLeft - inactiveCodeLayout.lineLeft)).toBeLessThanOrEqual(1);
    expect(activeCodeLayout.keywordText).toBe(inactiveCodeLayout.keywordText);
    expect(activeCodeLayout.keywordColor).toBe(inactiveCodeLayout.keywordColor);
    expect(await page.evaluate(() => [
      window.__cmView.state.doc.line(3).text,
      window.__cmView.state.doc.line(4).text,
      window.__cmView.state.doc.line(5).text,
      window.__cmView.state.doc.line(6).text,
    ])).toEqual([
      '```ts',
      'const greet = (user_name: string) => `hi ${user_name}`;',
      'console.log(greet("world_name"));',
      '```',
    ]);
  });

  test('active opening fenced code line keeps a complete Obsidian-like frame', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await expect(page.getByText('Test fixture ready')).toBeVisible();

    const doc = [
      'Prelude line',
      '',
      '```ts',
      'const greet = (user_name: string) => `hi ${user_name}`;',
      'console.log(greet("world_name"));',
      '```',
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      const openingLine = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: openingLine.from + 1 }, scrollIntoView: true });
      view.focus();
    });

    await expect(page.locator('.cm-line').filter({ hasText: '```ts' })).toBeVisible();
    await expect(page.locator('.cm-hybrid-codeblock-content-line').filter({ hasText: 'const greet' })).toBeVisible();

    const activeFrame = await page.evaluate(() => {
      const openingLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent?.includes('```ts'));
      const contentLines = Array.from(document.querySelectorAll<HTMLElement>('.cm-hybrid-codeblock-content-line'));
      const footer = document.querySelector<HTMLElement>('.cm-hybrid-codeblock-footer');
      const elements = [
        openingLine,
        ...contentLines,
        footer,
      ].filter((element): element is HTMLElement => Boolean(element));
      const rects = elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          className: element.className,
          text: element.textContent ?? '',
          left: rect.left,
          right: rect.right,
          borderLeftColor: style.borderLeftColor,
          borderLeftStyle: style.borderLeftStyle,
          borderLeftWidth: style.borderLeftWidth,
          borderRightColor: style.borderRightColor,
          borderTopColor: style.borderTopColor,
          borderTopStyle: style.borderTopStyle,
          borderTopWidth: style.borderTopWidth,
          backgroundColor: style.backgroundColor,
        };
      });
      const lefts = rects.map(rect => rect.left);
      const rights = rects.map(rect => rect.right);
      return {
        rects,
        opening: rects[0],
        maxLeftDelta: Math.max(...lefts) - Math.min(...lefts),
        maxRightDelta: Math.max(...rights) - Math.min(...rights),
      };
    });

    expect(activeFrame.opening.text).toContain('```ts');
    expect(activeFrame.opening.borderTopStyle).toBe('solid');
    expect(activeFrame.opening.borderTopWidth).toBe('1px');
    expect(activeFrame.opening.borderTopColor).toBe('rgba(127, 127, 127, 0.22)');
    expect(activeFrame.opening.borderLeftStyle).toBe('solid');
    expect(activeFrame.opening.borderLeftWidth).toBe('1px');
    expect(activeFrame.opening.borderLeftColor).toBe('rgba(127, 127, 127, 0.22)');
    expect(activeFrame.maxLeftDelta).toBeLessThanOrEqual(1);
    expect(activeFrame.maxRightDelta).toBeLessThanOrEqual(1);

    const contentTopsWithOpeningActive = await page.evaluate(() => Array.from(
      document.querySelectorAll<HTMLElement>('.cm-hybrid-codeblock-content-line'),
      line => ({ text: line.textContent ?? '', top: line.getBoundingClientRect().top }),
    ));

    await page.evaluate(() => {
      const view = window.__cmView;
      const firstContentLine = view.state.doc.line(4);
      view.dispatch({ selection: { anchor: firstContentLine.from + 1 } });
    });
    await expect(page.locator('.cm-hybrid-codeblock')).toBeVisible();

    const contentTopsWithFirstContentActive = await page.evaluate(() => Array.from(
      document.querySelectorAll<HTMLElement>('.cm-hybrid-codeblock-content-line'),
      line => ({ text: line.textContent ?? '', top: line.getBoundingClientRect().top }),
    ));

    expect(contentTopsWithFirstContentActive).toHaveLength(contentTopsWithOpeningActive.length);
    for (const before of contentTopsWithOpeningActive) {
      const after = contentTopsWithFirstContentActive.find(line => line.text === before.text);
      expect(after?.top).toBeDefined();
      expect(Math.abs((after?.top ?? 0) - before.top)).toBeLessThanOrEqual(0.5);
    }
  });

  test('hybrid rendering keeps fenced Python code highlighted and aligned while the cursor is inside it', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Intro',
      '',
      '```python',
      'm = -inf  # running max',
      'd = 0     # running sum (scaled)',
      'for x_i in tiles:',
      '    m_new = max(m, max(x_i))',
      '    d = d * exp(m - m_new) + sum(exp(x_i - m_new))',
      '    m = m_new',
      '```',
      '',
      'Outro',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-codeblock')).toBeVisible();
    const inactiveLayout = await page.evaluate(() => {
      const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-hybrid-codeblock-content-line'))
        .find(element => element.textContent?.includes('m_new = max'));
      const token = line?.querySelector<HTMLElement>('.cm-hybrid-prism-token.token.function');
      const lineRect = line?.getBoundingClientRect();
      const tokenStyle = token ? getComputedStyle(token) : null;
      return {
        text: line?.textContent ?? '',
        left: lineRect?.left ?? 0,
        paddingLeft: line ? getComputedStyle(line).paddingLeft : '',
        functionText: token?.textContent ?? '',
        functionColor: tokenStyle?.color ?? '',
        activeItalicCount: line?.querySelectorAll('.cm-active-italic').length ?? 0,
      };
    });

    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(7);
      view.dispatch({ selection: { anchor: line.from + 6 } });
    });

    await expect(page.locator('.cm-hybrid-codeblock')).toHaveCount(1);
    await expect(page.locator('.cm-hybrid-codeblock-content-line').filter({ hasText: 'm_new = max' })).toBeVisible();
    const activeLayout = await page.evaluate(() => {
      const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-hybrid-codeblock-content-line'))
        .find(element => element.textContent?.includes('m_new = max'));
      const token = line?.querySelector<HTMLElement>('.cm-hybrid-prism-token.token.function');
      const lineRect = line?.getBoundingClientRect();
      const tokenStyle = token ? getComputedStyle(token) : null;
      return {
        selectedLine: window.__cmView.state.doc.lineAt(window.__cmView.state.selection.main.head).number,
        text: line?.textContent ?? '',
        left: lineRect?.left ?? 0,
        paddingLeft: line ? getComputedStyle(line).paddingLeft : '',
        functionText: token?.textContent ?? '',
        functionColor: tokenStyle?.color ?? '',
        activeItalicCount: line?.querySelectorAll('.cm-active-italic').length ?? 0,
      };
    });

    expect(inactiveLayout.text).toBe('    m_new = max(m, max(x_i))');
    expect(activeLayout.selectedLine).toBe(7);
    expect(activeLayout.text).toBe(inactiveLayout.text);
    expect(activeLayout.paddingLeft).toBe(inactiveLayout.paddingLeft);
    expect(Math.abs(activeLayout.left - inactiveLayout.left)).toBeLessThanOrEqual(1);
    expect(activeLayout.functionText).toBe(inactiveLayout.functionText);
    expect(activeLayout.functionColor).toBe(inactiveLayout.functionColor);
    expect(activeLayout.activeItalicCount).toBe(0);

    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(8);
      view.dispatch({ selection: { anchor: line.from + 18 } });
    });

    const activeExpressionLayout = await page.evaluate(() => {
      const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-hybrid-codeblock-content-line'))
        .find(element => element.textContent?.includes('exp(m - m_new)'));
      return {
        selectedLine: window.__cmView.state.doc.lineAt(window.__cmView.state.selection.main.head).number,
        text: line?.textContent ?? '',
        tokenCount: line?.querySelectorAll('.cm-hybrid-prism-token').length ?? 0,
        activeItalicCount: line?.querySelectorAll('.cm-active-italic').length ?? 0,
      };
    });

    expect(activeExpressionLayout.selectedLine).toBe(8);
    expect(activeExpressionLayout.text).toBe('    d = d * exp(m - m_new) + sum(exp(x_i - m_new))');
    expect(activeExpressionLayout.tokenCount).toBeGreaterThan(0);
    expect(activeExpressionLayout.activeItalicCount).toBe(0);

    const neighboringCodeLine = await page.evaluate(() => {
      const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-hybrid-codeblock-content-line'))
        .find(element => element.textContent?.includes('m_new = max') || element.textContent?.includes('mnew = max'));
      return {
        text: line?.textContent ?? '',
        activeItalicCount: line?.querySelectorAll('.cm-active-italic, .cm-hybrid-italic').length ?? 0,
      };
    });

    expect(neighboringCodeLine.text).toBe('    m_new = max(m, max(x_i))');
    expect(neighboringCodeLine.activeItalicCount).toBe(0);
  });

  test('cursor inside fenced Python code keeps previous display math hidden and code highlighting stable', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const displayMathSource = '$$softmax(x_i) = exp(x_i) / sum(exp(x_j))$$';
    const doc = [
      '# Online Softmax',
      '',
      'Standard Softmax',
      '',
      'For a vector $x = [x_1, ..., x_n]$:',
      '',
      displayMathSource,
      '',
      'Online Version',
      '',
      'The online algorithm maintains running statistics:',
      '',
      '```python',
      'm = -inf  # running max',
      'd = 0     # running sum (scaled)',
      'for x_i in tiles:',
      '    m_new = max(m, max(x_i))',
      '    d = d * exp(m - m_new) + sum(exp(x_i - m_new))',
      '    m = m_new',
      '```',
      '',
      'After',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-math-block')).toBeVisible();
    await expect(page.locator('.cm-hybrid-codeblock')).toBeVisible();

    const inactiveLayout = await page.evaluate((mathSource) => {
      const codeLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-hybrid-codeblock-content-line'))
        .find(element => element.textContent?.includes('for x_i in tiles'));
      const keyword = codeLine?.querySelector<HTMLElement>('.cm-hybrid-prism-token.token.keyword');
      const firstCodeLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-hybrid-codeblock-content-line'))
        .find(element => element.textContent?.includes('m = -inf'));
      const firstCodeComment = firstCodeLine?.querySelector<HTMLElement>('.cm-hybrid-prism-token.token.comment');
      const mathLineNumber = window.__cmView.state.doc.lineAt(
        window.__cmView.state.doc.toString().indexOf(mathSource),
      ).number;
      const mathNumberRow = Array.from(document.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement'))
        .find(row => row.textContent?.trim() === String(mathLineNumber));
      const mathRow = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => mathNumberRow && Math.abs(line.getBoundingClientRect().top - mathNumberRow.getBoundingClientRect().top) <= 1);
      const codeStyle = codeLine ? getComputedStyle(codeLine) : null;
      const keywordStyle = keyword ? getComputedStyle(keyword) : null;
      const firstCodeLineStyle = firstCodeLine ? getComputedStyle(firstCodeLine) : null;
      const firstCodeCommentStyle = firstCodeComment ? getComputedStyle(firstCodeComment) : null;
      return {
        contentText: document.querySelector('.cm-content')?.textContent ?? '',
        mathRowText: mathRow?.textContent ?? '',
        codeLeft: codeLine?.getBoundingClientRect().left ?? 0,
        codeText: codeLine?.textContent ?? '',
        codeColor: codeStyle?.color ?? '',
        keywordText: keyword?.textContent ?? '',
        keywordColor: keywordStyle?.color ?? '',
        firstCodeLeft: firstCodeLine?.getBoundingClientRect().left ?? 0,
        firstCodeText: firstCodeLine?.textContent ?? '',
        firstCodeColor: firstCodeLineStyle?.color ?? '',
        firstCommentText: firstCodeComment?.textContent ?? '',
        firstCommentColor: firstCodeCommentStyle?.color ?? '',
      };
    }, displayMathSource);

    expect(inactiveLayout.contentText).not.toContain(displayMathSource);
    expect(inactiveLayout.mathRowText).not.toContain(displayMathSource);
    expect(inactiveLayout.codeText).toBe('for x_i in tiles:');
    expect(inactiveLayout.keywordText).toBe('for');
    expect(inactiveLayout.keywordColor).not.toBe(inactiveLayout.codeColor);
    expect(inactiveLayout.firstCodeText).toBe('m = -inf  # running max');
    expect(inactiveLayout.firstCommentText).toBe('# running max');
    expect(inactiveLayout.firstCommentColor).not.toBe(inactiveLayout.firstCodeColor);

    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(16);
      view.dispatch({ selection: { anchor: line.from + 2 } });
    });

    await expect(page.locator('.cm-hybrid-codeblock')).toHaveCount(1);
    await expect(page.locator('.cm-hybrid-codeblock-content-line .cm-hybrid-prism-token.token.keyword').filter({ hasText: 'for' })).toBeVisible();

    const activeLayout = await page.evaluate((mathSource) => {
      const selectedLine = window.__cmView.state.doc.lineAt(window.__cmView.state.selection.main.head);
      const codeLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-hybrid-codeblock-content-line'))
        .find(element => element.textContent?.includes('for x_i in tiles'));
      const keyword = codeLine?.querySelector<HTMLElement>('.cm-hybrid-prism-token.token.keyword');
      const firstCodeLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-hybrid-codeblock-content-line'))
        .find(element => element.textContent?.includes('m = -inf'));
      const firstCodeComment = firstCodeLine?.querySelector<HTMLElement>('.cm-hybrid-prism-token.token.comment');
      const mathLineNumber = window.__cmView.state.doc.lineAt(
        window.__cmView.state.doc.toString().indexOf(mathSource),
      ).number;
      const mathNumberRow = Array.from(document.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement'))
        .find(row => row.textContent?.trim() === String(mathLineNumber));
      const mathRow = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => mathNumberRow && Math.abs(line.getBoundingClientRect().top - mathNumberRow.getBoundingClientRect().top) <= 1);
      const codeStyle = codeLine ? getComputedStyle(codeLine) : null;
      const keywordStyle = keyword ? getComputedStyle(keyword) : null;
      const firstCodeLineStyle = firstCodeLine ? getComputedStyle(firstCodeLine) : null;
      const firstCodeCommentStyle = firstCodeComment ? getComputedStyle(firstCodeComment) : null;
      return {
        selectedLineNumber: selectedLine.number,
        selectedLineText: selectedLine.text,
        contentText: document.querySelector('.cm-content')?.textContent ?? '',
        mathRowText: mathRow?.textContent ?? '',
        codeLeft: codeLine?.getBoundingClientRect().left ?? 0,
        codeText: codeLine?.textContent ?? '',
        codeColor: codeStyle?.color ?? '',
        keywordText: keyword?.textContent ?? '',
        keywordColor: keywordStyle?.color ?? '',
        firstCodeLeft: firstCodeLine?.getBoundingClientRect().left ?? 0,
        firstCodeText: firstCodeLine?.textContent ?? '',
        firstCodeColor: firstCodeLineStyle?.color ?? '',
        firstCommentText: firstCodeComment?.textContent ?? '',
        firstCommentColor: firstCodeCommentStyle?.color ?? '',
      };
    }, displayMathSource);

    expect(activeLayout.selectedLineNumber).toBe(16);
    expect(activeLayout.selectedLineText).toBe('for x_i in tiles:');
    expect(activeLayout.contentText).not.toContain(displayMathSource);
    expect(activeLayout.mathRowText).not.toContain(displayMathSource);
    expect(activeLayout.codeText).toBe(inactiveLayout.codeText);
    expect(Math.abs(activeLayout.codeLeft - inactiveLayout.codeLeft)).toBeLessThanOrEqual(1);
    expect(activeLayout.keywordText).toBe(inactiveLayout.keywordText);
    expect(activeLayout.keywordColor).toBe(inactiveLayout.keywordColor);
    expect(activeLayout.keywordColor).not.toBe(activeLayout.codeColor);
    expect(activeLayout.firstCodeText).toBe(inactiveLayout.firstCodeText);
    expect(Math.abs(activeLayout.firstCodeLeft - inactiveLayout.firstCodeLeft)).toBeLessThanOrEqual(1);
    expect(activeLayout.firstCommentText).toBe(inactiveLayout.firstCommentText);
    expect(activeLayout.firstCommentColor).toBe(inactiveLayout.firstCommentColor);
    expect(activeLayout.firstCommentColor).not.toBe(activeLayout.firstCodeColor);
  });

  test('hybrid rendering treats fenced code info strings like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Intro',
      '',
      '```python title="online.py"',
      'def online_softmax(x_i):',
      '    return x_i',
      '```',
      '',
      'Outro',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-codeblock')).toBeVisible();
    await expect(page.locator('.cm-hybrid-codeblock-language')).toContainText(['Python']);
    await expect(page.locator('.cm-hybrid-codeblock-content-line').filter({ hasText: 'online_softmax' })).toBeVisible();
    await expect(page.locator('.cm-content')).not.toContainText('```python title');

    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(4);
      view.dispatch({ selection: { anchor: line.from + line.text.indexOf('online') + 2 } });
    });

    const activeCodeLine = await page.evaluate(() => {
      const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-hybrid-codeblock-content-line'))
        .find(element => element.textContent?.includes('online_softmax') || element.textContent?.includes('onlinesoftmax'));
      return {
        text: line?.textContent ?? '',
        activeItalicCount: line?.querySelectorAll('.cm-active-italic, .cm-hybrid-italic').length ?? 0,
      };
    });

    expect(activeCodeLine.text).toBe('def online_softmax(x_i):');
    expect(activeCodeLine.activeItalicCount).toBe(0);
  });

  test('hybrid rendering keeps four-space indented code fences literal like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Intro',
      '',
      '    ```python',
      '    print("literal fence")',
      '    ```',
      '',
      'Outro',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    await expect(page.locator('.cm-hybrid-codeblock')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toContainText('```python');
    await expect(page.locator('.cm-content')).toContainText('print("literal fence")');
  });

  test('hybrid rendering renders Mermaid fences as Obsidian-like diagrams until the block is active', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const mermaidSource = [
      '```mermaid',
      'graph TD',
      '  A[Online softmax] --> B[Running max]',
      '  A --> C[Running denominator]',
      '```',
    ].join('\n');
    const doc = [
      '# Mermaid Preview',
      '',
      mermaidSource,
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-mermaid-block')).toBeVisible();
    await expect(page.locator('.cm-hybrid-mermaid-block svg')).toBeVisible();
    await expect(page.locator('.cm-hybrid-codeblock')).toHaveCount(0);
    await expect(page.locator('.cm-hybrid-mermaid-block')).toContainText('Online softmax');
    await expect(page.locator('.cm-hybrid-mermaid-block')).not.toContainText('```mermaid');

    const copiedMermaid = await page.evaluate(() => new Promise<string>((resolve) => {
      const mermaid = document.querySelector('.cm-hybrid-mermaid-block');
      if (!mermaid) throw new Error('Missing rendered Mermaid block');
      const range = document.createRange();
      range.selectNodeContents(mermaid);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copiedMermaid).toBe(mermaidSource);

    await page.evaluate(() => {
      window.getSelection()?.removeAllRanges();
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    await expect(page.locator('.cm-hybrid-mermaid-block')).toBeVisible();
    await page.locator('.cm-hybrid-mermaid-block').click();
    await expect(page.locator('.cm-hybrid-mermaid-block')).toHaveCount(0);
    await expect(page.locator('.cm-line').filter({ hasText: '```mermaid' })).toBeVisible();
    await expect(page.locator('.cm-line').filter({ hasText: 'graph TD' })).toBeVisible();
  });

  test('hybrid rendering keeps compact Mermaid diagrams at natural Obsidian-like scale', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto('http://localhost:8979/test.html');

    const mermaidSource = [
      '```mermaid',
      'graph TD',
      '  A[Markdown note] --> B[Rendered diagram]',
      '  B --> C[Click to edit source]',
      '```',
    ].join('\n');
    const doc = [
      '# Mermaid Preview',
      '',
      mermaidSource,
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-mermaid-block svg')).toBeVisible({ timeout: 10_000 });

    const metrics = await page.evaluate(() => {
      const inner = document.querySelector<HTMLElement>('.cm-hybrid-mermaid-block-inner');
      const svg = inner?.querySelector<SVGSVGElement>('svg');
      const firstLabel = svg?.querySelector<Element>('.nodeLabel, foreignObject p, text');
      if (!inner || !svg) throw new Error('Missing rendered Mermaid diagram');
      const svgRect = svg.getBoundingClientRect();
      const labelRect = firstLabel?.getBoundingClientRect();
      return {
        containerWidth: inner.clientWidth,
        scrollWidth: inner.scrollWidth,
        svgWidth: svgRect.width,
        svgHeight: svgRect.height,
        labelHeight: labelRect?.height ?? 0,
      };
    });

    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.containerWidth + 1);
    expect(metrics.svgWidth).toBeGreaterThan(150);
    expect(metrics.svgWidth).toBeLessThan(320);
    expect(metrics.svgHeight).toBeLessThan(260);
    expect(metrics.labelHeight).toBeGreaterThan(10);
    expect(metrics.labelHeight).toBeLessThan(20);
  });

  test('hybrid rendering shows a solid glowing Obsidian-like frame when hovering Mermaid diagrams', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto('http://localhost:8979/test.html');

    const mermaidSource = [
      '```mermaid',
      'sequenceDiagram',
      '  participant User',
      '  participant Agent',
      '  User->>Agent: Reference a PDF paragraph',
      '```',
    ].join('\n');
    const doc = [
      '# Mermaid Hover',
      '',
      mermaidSource,
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    const mermaidBlock = page.locator('.cm-hybrid-mermaid-block');
    await expect(mermaidBlock.locator('svg')).toBeVisible({ timeout: 10_000 });

    const boundary = async () => mermaidBlock.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        boxShadow: style.boxShadow,
        outlineColor: style.outlineColor,
        outlineOffset: style.outlineOffset,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });

    await page.mouse.move(8, 8);
    await expect.poll(boundary).toMatchObject({
      outlineColor: 'rgba(0, 0, 0, 0)',
      outlineStyle: 'solid',
      outlineWidth: '1px',
    });
    const beforeHover = await boundary();
    expect(beforeHover.boxShadow).toMatch(/none|rgba\(0,\s*0,\s*0,\s*0\)/);

    await mermaidBlock.hover();

    await expect.poll(boundary).toMatchObject({
      outlineColor: 'rgba(142, 120, 255, 0.65)',
      outlineOffset: '-1px',
      outlineStyle: 'solid',
      outlineWidth: '1px',
    });
    const afterHover = await boundary();
    expect(afterHover.boxShadow).not.toBe('none');
    expect(afterHover.boxShadow).toContain('rgba(142, 120, 255');
  });

  test('hybrid rendering keeps wide Mermaid diagrams readable by scrolling instead of shrinking', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto('http://localhost:8979/test.html');

    const mermaidSource = [
      '```mermaid',
      'graph LR',
      '  A[Input activations with a deliberately long readable label] --> B[Tile 1 computes local statistics]',
      '  B --> C[Tile 2 updates the running maximum]',
      '  C --> D[Tile 3 rescales the denominator]',
      '  D --> E[Tile 4 accumulates the partial output]',
      '  E --> F[Tile 5 writes the normalized result]',
      '  F --> G[Output stays readable without shrinking the diagram]',
      '```',
    ].join('\n');
    const doc = [
      '# Mermaid Preview',
      '',
      mermaidSource,
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-mermaid-block svg')).toBeVisible({ timeout: 10_000 });

    const metrics = await page.evaluate(() => {
      const inner = document.querySelector<HTMLElement>('.cm-hybrid-mermaid-block-inner');
      const svg = inner?.querySelector<SVGSVGElement>('svg');
      const firstLabel = svg?.querySelector<Element>('.nodeLabel, foreignObject p, text');
      if (!inner || !svg) throw new Error('Missing rendered Mermaid diagram');
      const svgRect = svg.getBoundingClientRect();
      const labelRect = firstLabel?.getBoundingClientRect();
      return {
        containerWidth: inner.clientWidth,
        scrollWidth: inner.scrollWidth,
        svgWidth: svgRect.width,
        labelHeight: labelRect?.height ?? 0,
        overflowX: getComputedStyle(inner).overflowX,
      };
    });

    expect(metrics.overflowX).toMatch(/auto|scroll/);
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.containerWidth + 32);
    expect(metrics.svgWidth).toBeGreaterThan(metrics.containerWidth + 32);
    expect(metrics.labelHeight).toBeGreaterThan(8);
  });

  test('hybrid rendering lets Mermaid diagrams zoom without activating source editing', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto('http://localhost:8979/test.html');

    const mermaidSource = [
      '```mermaid',
      'graph TD',
      '  A[Markdown note] --> B[Rendered diagram]',
      '  B --> C[Zoom controls]',
      '```',
    ].join('\n');
    const doc = [
      '# Mermaid Preview',
      '',
      mermaidSource,
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-mermaid-block svg')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('Zoom in Mermaid diagram')).toBeVisible();
    await expect(page.getByLabel('Zoom out Mermaid diagram')).toBeVisible();

    const metrics = async () => page.evaluate(() => {
      const block = document.querySelector<HTMLElement>('.cm-hybrid-mermaid-block');
      const svg = block?.querySelector<SVGSVGElement>('svg');
      const label = block?.querySelector<HTMLElement>('.cm-hybrid-mermaid-zoom-level');
      if (!block || !svg || !label) throw new Error('Missing Mermaid zoom controls');
      return {
        svgWidth: svg.getBoundingClientRect().width,
        zoomLabel: label.textContent?.trim(),
        blockCount: document.querySelectorAll('.cm-hybrid-mermaid-block').length,
        sourceFenceLines: Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
          .filter(line => line.textContent?.includes('```mermaid')).length,
      };
    });

    const initial = await metrics();
    expect(initial.zoomLabel).toBe('100%');

    await page.getByLabel('Zoom in Mermaid diagram').click();
    await expect.poll(metrics).toMatchObject({
      zoomLabel: '125%',
      blockCount: 1,
      sourceFenceLines: 0,
    });
    const zoomedIn = await metrics();
    expect(zoomedIn.svgWidth).toBeGreaterThan(initial.svgWidth * 1.2);

    await page.getByLabel('Zoom out Mermaid diagram').click();
    await expect.poll(metrics).toMatchObject({
      zoomLabel: '100%',
      blockCount: 1,
      sourceFenceLines: 0,
    });
    const zoomedBack = await metrics();
    expect(zoomedBack.svgWidth).toBeLessThan(zoomedIn.svgWidth);
    expect(zoomedBack.svgWidth).toBeGreaterThan(initial.svgWidth * 0.95);

    await page.getByLabel('Zoom out Mermaid diagram').click();
    await expect.poll(metrics).toMatchObject({
      zoomLabel: '75%',
      blockCount: 1,
      sourceFenceLines: 0,
    });
    const zoomedOut = await metrics();
    expect(zoomedOut.svgWidth).toBeLessThan(initial.svgWidth * 0.8);
  });

  test('hybrid rendering displays fenced code language names like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, [
      'Prelude',
      '',
      '```python',
      'm = -inf',
      'd = 0',
      '```',
    ].join('\n'));

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-codeblock-language')).toHaveText('Python');
  });

  test('hybrid rendering hides markdown syntax on inactive lines and keeps widgets interactive', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      '# Hybrid Heading',
      '',
      'This has **bold text**, *italic text*, `inline code`, and [external docs](https://example.com).',
      '> A useful quoted idea.',
      '- [x] reviewed task',
      '- bullet item',
      '',
      '| Name | Description |',
      '| --- | --- |',
      '| vkid.official_account | 小企鹅公众号 |',
      'Keep [PDF link](raw/paper.pdf#page=7&anchor=anc_hybrid) clickable.',
      '',
      'cursor lands here',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-heading-line-1')).toBeVisible();
    await expect(page.locator('.cm-hybrid-bold')).toBeVisible();
    await expect(page.locator('.cm-hybrid-italic')).toBeVisible();
    await expect(page.locator('.cm-hybrid-inline-code')).toBeVisible();
    await expect(page.locator('.cm-hybrid-blockquote-line')).toBeVisible();
    await expect(page.locator('.cm-hybrid-task-checkbox')).toBeVisible();
    await expect(page.locator('.cm-hybrid-bullet')).toHaveText('•');
    await expect(page.locator('.cm-hybrid-table-widget')).toBeVisible();
    await expect(page.locator('.cm-hybrid-table')).toContainText('vkid.official_account');
    await expect(page.locator('.cm-hl-link')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'external docs' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'PDF link' })).toBeVisible();

    await page.locator('.cm-hybrid-task-checkbox').click();
    const toggledDoc = await page.evaluate(() => window.__cmView.state.doc.toString());
    expect(toggledDoc).toContain('- [ ] reviewed task');
  });

  test('hybrid rendering treats non-space task markers as checked like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, ['- [1] benchmark kernel', '- [ ] next task', ''].join('\n'));

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    });

    await expect(page.locator('.cm-hybrid-task-checkbox')).toHaveCount(2);
    const checkedStates = await page.locator('.cm-hybrid-task-checkbox').evaluateAll(inputs =>
      inputs.map(input => (input as HTMLInputElement).checked),
    );
    expect(checkedStates).toEqual([true, false]);
    await expect(page.locator('.cm-content')).not.toContainText('[1]');

    await page.locator('.cm-hybrid-task-checkbox').first().click();
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.line(1).text))
      .toBe('- [ ] benchmark kernel');
  });

  test('hybrid rendering renders list and task markers inside blockquotes like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '> - [ ] quoted task',
      '> - quoted bullet',
      '> 1. quoted ordered item',
      '',
      'cursor lands here',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-blockquote-line')).toHaveCount(3);
    await expect(page.locator('.cm-hybrid-task-checkbox')).toHaveCount(1);
    await expect(page.locator('.cm-hybrid-bullet')).toHaveCount(1);
    await expect(page.locator('.cm-hybrid-number')).toContainText('1.');
    await expect(page.locator('.cm-content')).not.toContainText('> - [ ]');
    await expect(page.locator('.cm-content')).not.toContainText('> - quoted bullet');

    await page.locator('.cm-hybrid-task-checkbox').click();
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toContain('> - [x] quoted task');
  });

  test('hybrid rendering copies thematic breaks as raw markdown like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const hrSource = '---';
    const doc = [
      'Before',
      '',
      hrSource,
      '',
      'After',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-hr')).toBeVisible();
    await expect(page.locator('.cm-line').nth(2)).not.toContainText(hrSource);

    await page.locator('.cm-hybrid-hr').click();
    await expect(page.locator('.cm-line').filter({ hasText: hrSource })).toBeVisible();

    await page.evaluate(() => {
      window.getSelection()?.removeAllRanges();
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    await expect(page.locator('.cm-hybrid-hr')).toBeVisible();

    const copied = await page.evaluate(() => new Promise<string>((resolve) => {
      const rule = document.querySelector('.cm-hybrid-hr');
      if (!rule) throw new Error('Missing rendered thematic break');
      const range = document.createRange();
      range.selectNode(rule);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copied).toBe(hrSource);
  });

  test('clicking a rendered table enters raw table editing like Obsidian live preview', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      'Before table',
      '',
      '| Term | Detail |',
      '| --- | --- |',
      '| Online softmax | Running max and denominator |',
      '',
      'After table',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-table-widget')).toBeVisible();
    await page.getByText('Online softmax').click();

    await expect(page.locator('.cm-hybrid-table-widget')).toHaveCount(0);
    expect(await page.evaluate(() => {
      const view = window.__cmView;
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    })).toBe(3);
    await page.keyboard.type('edited ');
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.line(3).text))
      .toBe('edited | Term | Detail |');
  });

  test('hybrid rendering renders inline Markdown inside table cells like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      'Before table',
      '',
      '| Term | Detail |',
      '| --- | --- |',
      '| **Online softmax** | Keep $m_i$ and `d_i`; see [[FlashAttention]] and [docs](https://example.com). |',
      '| ==Stable tiles== | ~~discarded~~ *inactive* text |',
      '',
      'After table',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    const table = page.locator('.cm-hybrid-table');
    await expect(table).toBeVisible();
    await expect(table.locator('.cm-hybrid-table-bold')).toContainText('Online softmax');
    await expect(table.locator('.cm-hybrid-table-inline-math')).toBeVisible();
    await expect(table.locator('.cm-hybrid-table-inline-code')).toContainText('d_i');
    await expect(table.locator('.cm-hybrid-table-highlight')).toContainText('Stable tiles');
    await expect(table.locator('.cm-hybrid-table-strike')).toContainText('discarded');
    await expect(table.locator('.cm-hybrid-table-italic')).toContainText('inactive');
    await expect(table.getByRole('button', { name: 'FlashAttention' })).toBeVisible();
    await expect(table.getByRole('button', { name: 'docs' })).toBeVisible();
    await expect(table).not.toContainText('**Online softmax**');
    await expect(table).not.toContainText('[[FlashAttention]]');

    await table.getByRole('button', { name: 'FlashAttention' }).click({ modifiers: ['Meta'] });
    await expect.poll(() => page.evaluate(() => window.__mockMessages.filter((message) => message.type === 'openUri')))
      .toEqual([{ type: 'openUri', uri: 'notes/Concepts/FlashAttention.md' }]);
  });

  test('hybrid rendering resolves reference links and images inside table cells like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const imageSource = '![Tiny diagram][tiny]';
    const testDoc = [
      'Before table',
      '',
      '| Term | Detail |',
      '| --- | --- |',
      `| Reference syntax | See [external docs][docs] and ${imageSource}. |`,
      '',
      '[docs]: https://example.com/docs',
      '[tiny]: data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
      '',
      'After table',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    const table = page.locator('.cm-hybrid-table');
    await expect(table).toBeVisible();
    await expect(table.getByRole('button', { name: 'external docs' })).toBeVisible();
    await expect(table.locator('.cm-hybrid-image-img')).toHaveAttribute('alt', 'Tiny diagram');
    await expect(table).not.toContainText('[external docs][docs]');
    await expect(page.locator('.cm-content')).not.toContainText('[docs]: https://example.com/docs');
    await expect(page.locator('.cm-content')).not.toContainText('[tiny]: data:image/gif');

    await table.getByRole('button', { name: 'external docs' }).click({ modifiers: ['Meta'] });
    await expect.poll(() => page.evaluate(() => window.__mockMessages.filter((message) => message.type === 'openUri')))
      .toEqual([{ type: 'openUri', uri: 'https://example.com/docs' }]);

    const copiedImage = await page.evaluate(() => new Promise<string>((resolve) => {
      const image = document.querySelector('.cm-hybrid-table .cm-hybrid-image-img');
      if (!image) throw new Error('Missing rendered table reference image');
      const range = document.createRange();
      range.selectNode(image);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copiedImage).toBe(imageSource);
  });

  test('hybrid rendering respects pipe table alignment markers like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      'Before table',
      '',
      '| Left | Center | Right |',
      '| :--- | :---: | ---: |',
      '| alpha | beta | gamma |',
      '',
      'After table',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-table')).toBeVisible();
    const alignments = await page.locator('.cm-hybrid-table tbody tr').nth(1).locator('td').evaluateAll(cells =>
      cells.map(cell => getComputedStyle(cell).textAlign),
    );
    expect(alignments).toEqual(['left', 'center', 'right']);
  });

  test('hybrid rendering keeps escaped pipes inside table cells like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      'Before table',
      '',
      '| Term | Detail |',
      '| --- | --- |',
      '| online softmax \\| tiled | keeps code `a|b` in one cell |',
      '',
      'After table',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-table')).toBeVisible();
    const bodyCells = page.locator('.cm-hybrid-table tbody tr').nth(1).locator('td');
    await expect(bodyCells).toHaveCount(2);
    await expect(bodyCells.nth(0)).toHaveText('online softmax | tiled');
    await expect(bodyCells.nth(1)).toContainText('keeps code a|b in one cell');
    await expect(bodyCells.nth(1).locator('.cm-hybrid-table-inline-code')).toContainText('a|b');
  });

  test('clicking a rendered image enters raw image editing like Obsidian live preview', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      'Before image',
      '',
      '![Attention diagram](data:image/gif;base64,R0lGODlhAQABAAAAACw=)',
      '',
      'After image',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-image')).toBeVisible();
    await page.locator('.cm-hybrid-image').click();

    await expect(page.locator('.cm-hybrid-image')).toHaveCount(0);
    expect(await page.evaluate(() => {
      const view = window.__cmView;
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    })).toBe(3);
    await page.keyboard.type('edited ');
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.line(3).text))
      .toBe('edited ![Attention diagram](data:image/gif;base64,R0lGODlhAQABAAAAACw=)');
  });

  test('hybrid rendering turns Obsidian callouts into titled preview blocks until active', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const calloutSource = [
      '> [!tip] Stability trick',
      '> Keep $m$ and $d$ as streaming statistics.',
      '> - Works across tiles.',
    ].join('\n');
    const testDoc = [
      '# Callout Note',
      '',
      calloutSource,
      '',
      'cursor lands here',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-callout')).toBeVisible();
    await expect(page.locator('.cm-hybrid-callout-title')).toContainText('Stability trick');
    await expect(page.locator('.cm-hybrid-callout-body')).toContainText('streaming statistics.');
    await expect(page.locator('.cm-hybrid-callout-body')).toContainText('Works across tiles.');
    await expect(page.locator('.cm-hybrid-callout')).not.toContainText('[!tip]');

    const copiedCallout = await page.evaluate(() => new Promise<string>((resolve) => {
      const callout = document.querySelector('.cm-hybrid-callout');
      if (!callout) throw new Error('Missing rendered callout');
      const range = document.createRange();
      range.selectNodeContents(callout);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copiedCallout).toBe(calloutSource);

    await page.evaluate(() => {
      const view = window.__cmView;
      const calloutPosition = view.state.doc.toString().indexOf('[!tip]');
      view.dispatch({ selection: { anchor: calloutPosition } });
    });

    await expect(page.locator('.cm-hybrid-callout')).toHaveCount(0);
    await expect(page.locator('.cm-line').filter({ hasText: '[!tip] Stability trick' })).toBeVisible();
  });

  test('hybrid rendering starts folded Obsidian callouts collapsed and expands them from preview', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const calloutSource = [
      '> [!tip]- Stability trick',
      '> Hidden body starts collapsed.',
      '> - Hidden list item.',
    ].join('\n');
    const testDoc = [
      '# Folded Callout',
      '',
      calloutSource,
      '',
      'cursor lands here',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-callout')).toBeVisible();
    await expect(page.locator('.cm-hybrid-callout-title')).toContainText('Stability trick');
    await expect(page.locator('.cm-hybrid-callout-title')).not.toContainText('- Stability trick');
    await expect(page.locator('.cm-hybrid-callout-body')).toBeHidden();
    expect(await page.locator('.cm-hybrid-callout').evaluate(element => (element as HTMLElement).innerText))
      .not.toContain('Hidden body starts collapsed.');

    await page.locator('.cm-hybrid-callout-fold').click();

    await expect(page.locator('.cm-hybrid-callout-body')).toBeVisible();
    await expect(page.locator('.cm-hybrid-callout-body')).toContainText('Hidden body starts collapsed.');
    await expect(page.locator('.cm-hybrid-callout-body')).toContainText('Hidden list item.');

    const selectedLine = await page.evaluate(() => {
      const view = window.__cmView;
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    });
    expect(selectedLine).toBe(7);
  });

  test('hybrid rendering renders inline markdown inside Obsidian callouts', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      '> [!note] Streaming invariant',
      '> Keep $m_i$ and **normalizer** as `running stats` with ==stable tiles==.',
      '',
      'cursor lands here',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-callout')).toBeVisible();
    await expect(page.locator('.cm-hybrid-callout-inline-math')).toBeVisible();
    await expect(page.locator('.cm-hybrid-callout-bold')).toContainText('normalizer');
    await expect(page.locator('.cm-hybrid-callout-inline-code')).toContainText('running stats');
    await expect(page.locator('.cm-hybrid-callout-highlight')).toContainText('stable tiles');

    const calloutText = await page.locator('.cm-hybrid-callout').innerText();
    expect(calloutText).not.toContain('$m_i$');
    expect(calloutText).not.toContain('**normalizer**');
    expect(calloutText).not.toContain('`running stats`');
    expect(calloutText).not.toContain('==stable tiles==');
  });

  test('hybrid rendering renders task and list lines inside Obsidian callouts', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      '> [!todo] Streaming checklist',
      '> - [ ] Update denominator',
      '> - [x] Keep running max',
      '>   - Nested tile note',
      '> 1. Recompute scores',
      '',
      'tail',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-callout')).toBeVisible();
    await expect(page.locator('.cm-hybrid-callout-task-checkbox')).toHaveCount(2);
    await expect(page.locator('.cm-hybrid-callout-task-checkbox').nth(0)).not.toBeChecked();
    await expect(page.locator('.cm-hybrid-callout-task-checkbox').nth(1)).toBeChecked();
    await expect(page.locator('.cm-hybrid-callout-list-marker')).toContainText(['•', '1.']);

    const calloutText = await page.locator('.cm-hybrid-callout').innerText();
    expect(calloutText).not.toContain('- [ ]');
    expect(calloutText).not.toContain('- [x]');

    await page.locator('.cm-hybrid-callout-task-checkbox').nth(0).click();
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.line(2).text))
      .toBe('> - [x] Update denominator');
  });

  test('hybrid rendering treats non-space callout task markers as checked like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      '> [!todo] Streaming checklist',
      '> - [1] Update denominator',
      '> - [ ] Keep running max',
      '',
      'tail',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-callout-task-checkbox')).toHaveCount(2);
    await expect(page.locator('.cm-hybrid-callout-task-checkbox').nth(0)).toBeChecked();
    await expect(page.locator('.cm-hybrid-callout-task-checkbox').nth(1)).not.toBeChecked();

    const calloutText = await page.locator('.cm-hybrid-callout').innerText();
    expect(calloutText).not.toContain('- [1]');

    await page.locator('.cm-hybrid-callout-task-checkbox').nth(0).click();
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.line(2).text))
      .toBe('> - [ ] Update denominator');
  });

  test('hybrid rendering renders images inside Obsidian callouts', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    const markdownImage = `![Attention diagram](${gif})`;
    const obsidianImage = `![[${gif}|320x180]]`;
    const testDoc = [
      '> [!note] Visual intuition',
      `> ${markdownImage}`,
      `> ${obsidianImage}`,
      '',
      'tail',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-callout')).toBeVisible();
    await expect(page.locator('.cm-hybrid-callout .cm-hybrid-image-img')).toHaveCount(2);
    await expect(page.locator('.cm-hybrid-callout .cm-hybrid-image-img').nth(0))
      .toHaveAttribute('alt', 'Attention diagram');
    const sizedImage = await page.locator('.cm-hybrid-callout .cm-hybrid-image-img').nth(1).evaluate(image => ({
      alt: (image as HTMLImageElement).alt,
      width: image.getAttribute('width'),
      height: image.getAttribute('height'),
      cssWidth: (image as HTMLImageElement).style.width,
      cssHeight: (image as HTMLImageElement).style.height,
    }));
    expect(sizedImage).toEqual({
      alt: gif,
      width: '320',
      height: '180',
      cssWidth: '320px',
      cssHeight: '180px',
    });

    const calloutText = await page.locator('.cm-hybrid-callout').innerText();
    expect(calloutText).not.toContain(markdownImage);
    expect(calloutText).not.toContain(obsidianImage);

    await page.locator('.cm-hybrid-callout .cm-hybrid-image').nth(0).click();
    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    })).toBe(2);
  });

  test('hybrid rendering renders pipe tables inside Obsidian callouts', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      '> [!summary] Attention stats',
      '> | Symbol | Meaning |',
      '> | --- | --- |',
      '> | m | running max |',
      '> | d | denominator |',
      '',
      'tail',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-callout')).toBeVisible();
    await expect(page.locator('.cm-hybrid-callout .cm-hybrid-table')).toBeVisible();
    await expect(page.locator('.cm-hybrid-callout .cm-hybrid-table th')).toContainText(['Symbol', 'Meaning']);
    await expect(page.locator('.cm-hybrid-callout .cm-hybrid-table td')).toContainText([
      'm',
      'running max',
      'd',
      'denominator',
    ]);
    const calloutText = await page.locator('.cm-hybrid-callout').innerText();
    expect(calloutText).not.toContain('| --- | --- |');

    await page.locator('.cm-hybrid-callout-table-widget').click();
    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    })).toBe(2);
  });

  test('hybrid rendering resolves reference links and images inside callout table cells', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const imageSource = '![Tiny diagram][tiny]';
    const testDoc = [
      '> [!summary] Attention stats',
      '> | Symbol | Meaning |',
      '> | --- | --- |',
      `> | docs | [external docs][docs] and ${imageSource} |`,
      '',
      '[docs]: https://example.com/docs',
      '[tiny]: data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
      '',
      'tail',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    const table = page.locator('.cm-hybrid-callout .cm-hybrid-table');
    await expect(table).toBeVisible();
    await expect(table.getByRole('button', { name: 'external docs' })).toBeVisible();
    await expect(table.locator('.cm-hybrid-image-img')).toHaveAttribute('alt', 'Tiny diagram');
    await expect(table).not.toContainText('[external docs][docs]');
    await expect(page.locator('.cm-content')).not.toContainText('[docs]: https://example.com/docs');
    await expect(page.locator('.cm-content')).not.toContainText('[tiny]: data:image/gif');

    await table.getByRole('button', { name: 'external docs' }).click();
    await expect.poll(() => page.evaluate(() => window.__mockMessages.filter((message) => message.type === 'openUri')))
      .toEqual([{ type: 'openUri', uri: 'https://example.com/docs' }]);

    const copiedImage = await page.evaluate(() => new Promise<string>((resolve) => {
      const image = document.querySelector('.cm-hybrid-callout .cm-hybrid-table .cm-hybrid-image-img');
      if (!image) throw new Error('Missing rendered callout table reference image');
      const range = document.createRange();
      range.selectNode(image);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.addEventListener('copy', event => {
        resolve(event.clipboardData?.getData('text/plain') ?? '');
      }, { once: true });
      document.execCommand('copy');
    }));

    expect(copiedImage).toBe(imageSource);
  });

  test('hybrid rendering renders inline markdown in Obsidian callout titles', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      '> [!warning] **Invariant** $m_i$',
      '> The title should render like Obsidian.',
      '',
      'cursor lands here',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-callout')).toBeVisible();
    await expect(page.locator('.cm-hybrid-callout-title .cm-hybrid-callout-bold')).toContainText('Invariant');
    await expect(page.locator('.cm-hybrid-callout-title .cm-hybrid-callout-inline-math')).toBeVisible();

    const titleText = await page.locator('.cm-hybrid-callout-title').innerText();
    expect(titleText).not.toContain('**Invariant**');
    expect(titleText).not.toContain('$m_i$');
  });

  test('hybrid rendering makes links inside Obsidian callouts navigable', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      '> [!tip] Related [[FlashAttention]]',
      '> See [[Online Softmax]] and [paper](raw/pdf/flash-attention.pdf#page=7&anchor=anc_callout).',
      '',
      'cursor lands here',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-callout')).toBeVisible();
    await expect(page.locator('.cm-hybrid-callout-link')).toHaveCount(3);
    await expect(page.locator('.cm-hybrid-callout-title .cm-hybrid-callout-link')).toContainText('FlashAttention');
    await expect(page.locator('.cm-hybrid-callout-body .cm-hybrid-callout-link')).toContainText([
      'Online Softmax',
      'paper',
    ]);

    const calloutText = await page.locator('.cm-hybrid-callout').innerText();
    expect(calloutText).not.toContain('[[FlashAttention]]');
    expect(calloutText).not.toContain('[[Online Softmax]]');
    expect(calloutText).not.toContain('[paper](');

    await page.locator('.cm-hybrid-callout-link').nth(0).click();
    await page.locator('.cm-hybrid-callout-link').nth(1).click();
    await page.locator('.cm-hybrid-callout-link').nth(2).click();

    const openMessages = await page.evaluate(() => window.__mockMessages.filter((m) => m.type === 'openUri'));
    expect(openMessages).toEqual([
      { type: 'openUri', uri: 'notes/Concepts/FlashAttention.md' },
      { type: 'openUri', uri: 'notes/Concepts/Online Softmax.md' },
      { type: 'openUri', uri: 'raw/pdf/flash-attention.pdf#page=7&anchor=anc_callout' },
    ]);
  });

  test('hybrid rendering resolves reference links and images inside Obsidian callouts', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      '> [!tip] Related [external docs][docs]',
      '> Diagram ![Tiny diagram][tiny]',
      '',
      '[docs]: https://example.com/docs',
      '[tiny]: data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
      '',
      'cursor lands here',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-hybrid-callout')).toBeVisible();
    await expect(page.locator('.cm-hybrid-callout-link')).toHaveText('external docs');
    await expect(page.locator('.cm-hybrid-callout .cm-hybrid-image-img')).toHaveAttribute('alt', 'Tiny diagram');
    await expect(page.locator('.cm-content')).not.toContainText('[docs]: https://example.com/docs');
    await expect(page.locator('.cm-content')).not.toContainText('[tiny]: data:image/gif');

    await page.locator('.cm-hybrid-callout-link').click();

    const openMessages = await page.evaluate(() => window.__mockMessages.filter((m) => m.type === 'openUri'));
    expect(openMessages).toEqual([
      { type: 'openUri', uri: 'https://example.com/docs' },
    ]);
  });

  test('Obsidian-like editor commands format, toggle preview, and follow links', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      'plain text',
      '- [ ] task',
      'Click [PDF link](raw/paper.pdf#page=7&anchor=anc_cmd).',
      '',
      '| A | B |',
      '| --- | --- |',
      '| one | two |',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: 0, head: 5 } });
      window.postMessage({ type: 'executeCommand', command: 'editor:toggle-bold' }, '*');
    });

    let doc = await page.evaluate(() => window.__cmView.state.doc.toString());
    expect(doc).toContain('**plain** text');

    await page.evaluate(() => {
      const view = window.__cmView;
      const taskPos = view.state.doc.toString().indexOf('- [ ] task') + 2;
      view.dispatch({ selection: { anchor: taskPos } });
      window.postMessage({ type: 'executeCommand', command: 'editor:toggle-checklist-status' }, '*');
    });
    doc = await page.evaluate(() => window.__cmView.state.doc.toString());
    expect(doc).toContain('- [x] task');

    await expect(page.locator('.cm-hybrid-table-widget')).toBeVisible();
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      window.postMessage({ type: 'executeCommand', command: 'markdown:toggle-preview' }, '*');
    });
    await expect(page.locator('.cm-hybrid-table-widget')).toHaveCount(0);
    await expect(page.locator('.cm-hl-link')).toHaveCount(0);

    await page.evaluate(() => {
      window.__cmView.dispatch({ selection: { anchor: 0 } });
      window.postMessage({ type: 'executeCommand', command: 'markdown:toggle-preview' }, '*');
    });
    await expect(page.locator('.cm-hybrid-table-widget')).toBeVisible();

    await page.evaluate(() => {
      window.__mockMessages = [];
      const view = window.__cmView;
      const linkPos = view.state.doc.toString().indexOf('PDF link') + 2;
      view.dispatch({ selection: { anchor: linkPos } });
      window.postMessage({ type: 'executeCommand', command: 'editor:follow-link' }, '*');
    });
    const openMessages = await page.evaluate(() => window.__mockMessages.filter((m) => m.type === 'openUri'));
    expect(openMessages).toEqual([{ type: 'openUri', uri: 'raw/paper.pdf#page=7&anchor=anc_cmd' }]);
  });

  test('Obsidian-like formatting commands unwrap the current formatted span when the cursor is inside it', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const cases = [
      {
        command: 'editor:toggle-bold',
        source: '**plain** text',
        cursorOffset: 4,
        expected: 'plain text',
      },
      {
        command: 'editor:toggle-italics',
        source: '*italic* text',
        cursorOffset: 3,
        expected: 'italic text',
      },
      {
        command: 'editor:toggle-strikethrough',
        source: '~~gone~~ text',
        cursorOffset: 4,
        expected: 'gone text',
      },
      {
        command: 'editor:toggle-highlight',
        source: '==mark== text',
        cursorOffset: 4,
        expected: 'mark text',
      },
      {
        command: 'editor:toggle-code',
        source: '`code` text',
        cursorOffset: 2,
        expected: 'code text',
      },
    ];

    for (const testCase of cases) {
      await page.evaluate((text) => {
        window.postMessage({ type: 'setText', text }, '*');
      }, testCase.source);
      await page.waitForFunction(
        (text) => window.__cmView?.state.doc.toString() === text,
        testCase.source,
      );

      await page.evaluate((cursorOffset) => {
        const view = window.__cmView;
        view.dispatch({ selection: { anchor: cursorOffset } });
      }, testCase.cursorOffset);
      await page.evaluate((command) => {
        window.postMessage({ type: 'executeCommand', command }, '*');
      }, testCase.command);

      await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
        .toBe(testCase.expected);
      expect(await page.evaluate(() => {
        const selection = window.__cmView.state.selection.main;
        return selection.empty;
      })).toBe(true);
    }
  });

  test('Obsidian-like formatting commands unwrap selected formatted spans including delimiters', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const cases = [
      {
        command: 'editor:toggle-bold',
        source: '**plain** text',
        selection: { anchor: 0, head: 9 },
        expected: 'plain text',
        expectedSelection: { from: 0, to: 5 },
      },
      {
        command: 'editor:toggle-italics',
        source: '*italic* text',
        selection: { anchor: 0, head: 8 },
        expected: 'italic text',
        expectedSelection: { from: 0, to: 6 },
      },
      {
        command: 'editor:toggle-strikethrough',
        source: '~~gone~~ text',
        selection: { anchor: 0, head: 8 },
        expected: 'gone text',
        expectedSelection: { from: 0, to: 4 },
      },
      {
        command: 'editor:toggle-highlight',
        source: '==mark== text',
        selection: { anchor: 0, head: 8 },
        expected: 'mark text',
        expectedSelection: { from: 0, to: 4 },
      },
      {
        command: 'editor:toggle-code',
        source: '`code` text',
        selection: { anchor: 0, head: 6 },
        expected: 'code text',
        expectedSelection: { from: 0, to: 4 },
      },
    ];

    for (const testCase of cases) {
      await page.evaluate((text) => {
        window.postMessage({ type: 'setText', text }, '*');
      }, testCase.source);
      await page.waitForFunction(
        (text) => window.__cmView?.state.doc.toString() === text,
        testCase.source,
      );

      await page.evaluate((selection) => {
        const view = window.__cmView;
        view.dispatch({ selection });
      }, testCase.selection);
      await page.evaluate((command) => {
        window.postMessage({ type: 'executeCommand', command }, '*');
      }, testCase.command);

      await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
        .toBe(testCase.expected);
      expect(await page.evaluate(() => {
        const selection = window.__cmView.state.selection.main;
        return { from: selection.from, to: selection.to };
      })).toEqual(testCase.expectedSelection);
    }
  });

  test('Obsidian-like inline math command wraps and unwraps dollar delimiters', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setText', text: 'alpha beta gamma' }, '*');
    });
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    await page.evaluate(() => {
      const view = window.__cmView;
      const from = view.state.doc.toString().indexOf('beta');
      view.dispatch({ selection: { anchor: from, head: from + 'beta'.length } });
      window.postMessage({ type: 'executeCommand', command: 'editor:toggle-inline-math' }, '*');
    });
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe('alpha $beta$ gamma');

    await page.evaluate(() => {
      const view = window.__cmView;
      const cursor = view.state.doc.toString().indexOf('beta') + 1;
      view.dispatch({ selection: { anchor: cursor } });
      window.postMessage({ type: 'executeCommand', command: 'editor:toggle-inline-math' }, '*');
    });
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe('alpha beta gamma');
  });

  test('right-clicking selected markdown opens a formatting panel and applies inline style commands', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setText', text: 'alpha beta gamma' }, '*');
      window.__mockMessages = [];
    });
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    await page.evaluate(() => {
      const view = window.__cmView;
      const from = view.state.doc.toString().indexOf('beta');
      view.dispatch({ selection: { anchor: from, head: from + 'beta'.length } });
      view.focus();
      const line = document.querySelector('.cm-line');
      const rect = line.getBoundingClientRect();
      line.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 80,
        clientY: rect.top + 8,
      }));
    });

    await expect(page.locator('#selection-toolbar')).toBeVisible();
    await expect(page.locator('#selection-toolbar')).toContainText('Look Up');
    await expect(page.locator('#selection-toolbar')).toContainText('Heading');

    await page.locator('#selection-toolbar button[aria-label="Bold"]').click();
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe('alpha **beta** gamma');
  });

  test('markdown selection panel applies heading levels to selected lines', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setText', text: ['Intro', 'Selected heading', 'Tail'].join('\n') }, '*');
      window.__mockMessages = [];
    });
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(2);
      view.dispatch({ selection: { anchor: line.from, head: line.to } });
      view.focus();
      const secondLine = document.querySelectorAll('.cm-line')[1];
      const rect = secondLine.getBoundingClientRect();
      secondLine.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 40,
        clientY: rect.top + 8,
      }));
    });

    await page.locator('#selection-toolbar button', { hasText: 'Heading' }).click();
    await expect(page.locator('#selection-toolbar .menu.open')).toBeVisible();
    await page.locator('#selection-toolbar button', { hasText: 'H2' }).click();

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['Intro', '## Selected heading', 'Tail'].join('\n'));
  });

  test('force-clicking selected markdown asks the host to look it up', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setText', text: 'alpha beta gamma' }, '*');
      window.__mockMessages = [];
    });
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    await page.evaluate(() => {
      const view = window.__cmView;
      const from = view.state.doc.toString().indexOf('beta');
      view.dispatch({ selection: { anchor: from, head: from + 'beta'.length } });
      view.focus();
      const line = document.querySelector('.cm-line');
      const rect = line.getBoundingClientRect();
      line.dispatchEvent(new MouseEvent('webkitmouseforcedown', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 80,
        clientY: rect.top + 8,
      }));
    });

    await expect.poll(() => page.evaluate(() =>
      window.__mockMessages.filter(message => message.type === 'lookupSelection')
    )).toEqual([
      {
        type: 'lookupSelection',
        text: 'beta',
        from: 6,
        to: 10,
      },
    ]);
  });

  test('Obsidian-like math block command wraps and unwraps display math blocks', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setText', text: ['Before', 'a_i + b_i', 'c_i + d_i', 'After'].join('\n') }, '*');
    });
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    await page.evaluate(() => {
      const view = window.__cmView;
      const doc = view.state.doc;
      const first = doc.line(2);
      const second = doc.line(3);
      view.dispatch({ selection: { anchor: first.from, head: second.to } });
      window.postMessage({ type: 'executeCommand', command: 'editor:insert-mathblock' }, '*');
    });
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['Before', '$$', 'a_i + b_i', 'c_i + d_i', '$$', 'After'].join('\n'));

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 1 } });
      window.postMessage({ type: 'executeCommand', command: 'editor:insert-mathblock' }, '*');
    });
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['Before', 'a_i + b_i', 'c_i + d_i', 'After'].join('\n'));
  });

  test('pressing Enter in a Markdown list continues the list like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, '- first');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    });

    await page.keyboard.press('Enter');
    await page.keyboard.type('second');

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['- first', '- second'].join('\n'));

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, '- [x] done');

    await page.waitForFunction(() => window.__cmView.state.doc.toString() === '- [x] done');
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    });

    await page.keyboard.press('Enter');
    await page.keyboard.type('next');

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['- [x] done', '- [ ] next'].join('\n'));
  });

  test('pressing Enter on an empty Markdown blockquote exits the quote like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, '> quote');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    });

    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['> quote', '> '].join('\n'));

    await page.keyboard.press('Enter');
    await page.keyboard.type('after');

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['> quote', 'after'].join('\n'));
  });

  test('pressing Enter on an empty nested Markdown blockquote outdents one quote level like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, '> > inner');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    });

    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['> > inner', '> > '].join('\n'));

    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['> > inner', '> '].join('\n'));

    await page.keyboard.type('outer');
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['> > inner', '> outer'].join('\n'));
  });

  test('pressing Enter on an empty Markdown task exits the task list like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, '- [ ] ');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    });

    await page.keyboard.press('Enter');

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe('');
  });

  test('pressing Enter in an ordered Markdown list increments and exits like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, '1. first');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    });

    await page.keyboard.press('Enter');
    await page.keyboard.type('second');

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['1. first', '2. second'].join('\n'));

    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['1. first', '2. second', '3. '].join('\n'));

    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['1. first', '2. second', ''].join('\n'));
  });

  test('pressing Enter in an ordered Markdown task continues and exits like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, '1. [x] done');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.waitForFunction(() => window.__cmView.state.doc.toString() === '1. [x] done');
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    });

    await page.keyboard.press('Enter');
    await page.keyboard.type('next');

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['1. [x] done', '2. [ ] next'].join('\n'));

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, '1. [ ] ');
    await page.waitForFunction(() => window.__cmView.state.doc.toString() === '1. [ ] ');
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    });

    await page.keyboard.press('Enter');

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe('');
  });

  test('toggle checklist status preserves ordered list markers like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, '1. first task');

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      window.postMessage({ type: 'executeCommand', command: 'editor:toggle-checklist-status' }, '*');
    });

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe('1. [ ] first task');

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      window.postMessage({ type: 'executeCommand', command: 'editor:toggle-checklist-status' }, '*');
    });

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe('1. [x] first task');
  });

  test('hybrid rendering displays ordered task lists like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, ['1. [ ] first task', '2. [x] done task', ''].join('\n'));

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.waitForFunction(() => window.__cmView.state.doc.lines === 3, { timeout: 5000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    });

    await expect(page.locator('.cm-hybrid-task-checkbox')).toHaveCount(2);
    await expect(page.locator('.cm-hybrid-number')).toContainText(['1.', '2.']);
    await expect(page.locator('.cm-content')).not.toContainText('[ ]');
    await expect(page.locator('.cm-content')).not.toContainText('[x]');

    const checkedStates = await page.locator('.cm-hybrid-task-checkbox').evaluateAll(inputs =>
      inputs.map(input => (input as HTMLInputElement).checked),
    );
    expect(checkedStates).toEqual([false, true]);
  });

  test('Backspace at the start of nested Markdown list content outdents like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const cases = [
      {
        doc: ['- parent', '  - child'].join('\n'),
        cursorText: 'child',
        expected: ['- parent', '- child'].join('\n'),
      },
      {
        doc: ['- parent', '  - [ ] child'].join('\n'),
        cursorText: 'child',
        expected: ['- parent', '- [ ] child'].join('\n'),
      },
      {
        doc: ['1. parent', '   1. child'].join('\n'),
        cursorText: 'child',
        expected: ['1. parent', '1. child'].join('\n'),
      },
      {
        doc: ['- parent', '  - '].join('\n'),
        cursorText: null,
        expected: ['- parent', '- '].join('\n'),
      },
    ];

    for (const testCase of cases) {
      await page.evaluate((text) => {
        window.postMessage({ type: 'setText', text }, '*');
        window.__mockMessages = [];
      }, testCase.doc);

      await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
      await page.waitForFunction(
        (text) => window.__cmView.state.doc.toString() === text,
        testCase.doc,
        { timeout: 5000 },
      );
      await page.evaluate((cursorText) => {
        const view = window.__cmView;
        const anchor = cursorText == null
          ? view.state.doc.length
          : view.state.doc.toString().indexOf(cursorText);
        view.dispatch({ selection: { anchor } });
        view.focus();
      }, testCase.cursorText);

      await page.keyboard.press('Backspace');
      await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(testCase.expected);
    }
  });

  test('Backspace at the start of top-level task content removes the checkbox like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const cases = [
      {
        doc: '- [ ] child',
        cursorText: 'child',
        expected: '- child',
      },
      {
        doc: '- [x] child',
        cursorText: 'child',
        expected: '- child',
      },
      {
        doc: '1. [ ] child',
        cursorText: 'child',
        expected: '1. child',
      },
      {
        doc: '1. [x] child',
        cursorText: 'child',
        expected: '1. child',
      },
    ];

    for (const testCase of cases) {
      await page.evaluate((text) => {
        window.postMessage({ type: 'setText', text }, '*');
        window.__mockMessages = [];
      }, testCase.doc);

      await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
      await page.waitForFunction(
        (text) => window.__cmView.state.doc.toString() === text,
        testCase.doc,
        { timeout: 5000 },
      );
      await page.evaluate((cursorText) => {
        const view = window.__cmView;
        const anchor = view.state.doc.toString().indexOf(cursorText);
        view.dispatch({ selection: { anchor } });
        view.focus();
      }, testCase.cursorText);

      await page.keyboard.press('Backspace');
      await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
        .toBe(testCase.expected);
    }
  });

  test('Tab and Shift+Tab indent Markdown list items like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, ['- parent', '- child'].join('\n'));

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    });

    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['- parent', '  - child'].join('\n'));

    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe(['- parent', '- child'].join('\n'));
  });

  test('Tab and Shift+Tab indent fenced code lines like Obsidian', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, ['Intro', '', '```python', 'value = 1', '```', '', 'Outro'].join('\n'));

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(4);
      view.dispatch({ selection: { anchor: line.from } });
      view.focus();
    });

    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.line(4).text))
      .toBe('    value = 1');

    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.line(4).text))
      .toBe('value = 1');
  });

  test('Tab and Shift+Tab indent selected fenced code lines without touching the closing fence', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, [
      'Intro',
      '',
      '```python',
      'm = -inf',
      'd = 0',
      '```',
      '',
      'Outro',
    ].join('\n'));

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({
        selection: {
          anchor: view.state.doc.line(4).from,
          head: view.state.doc.line(6).from,
        },
      });
      view.focus();
    });

    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => [
      window.__cmView.state.doc.line(4).text,
      window.__cmView.state.doc.line(5).text,
      window.__cmView.state.doc.line(6).text,
    ])).toEqual([
      '    m = -inf',
      '    d = 0',
      '```',
    ]);

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({
        selection: {
          anchor: view.state.doc.line(4).from,
          head: view.state.doc.line(6).from,
        },
      });
      view.focus();
    });

    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => page.evaluate(() => [
      window.__cmView.state.doc.line(4).text,
      window.__cmView.state.doc.line(5).text,
      window.__cmView.state.doc.line(6).text,
    ])).toEqual([
      'm = -inf',
      'd = 0',
      '```',
    ]);
  });

  test('Cmd+Enter follows the link under the cursor in Vim mode', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = 'Jump to [PDF link](raw/paper.pdf#page=7&anchor=anc_cmd_enter).';

    await page.evaluate((text) => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.click('.cm-content');
    await page.evaluate(() => {
      const view = window.__cmView;
      const linkPos = view.state.doc.toString().indexOf('PDF link') + 2;
      view.dispatch({ selection: { anchor: linkPos } });
    });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+Enter');

    const openMessages = await page.evaluate(() => window.__mockMessages.filter((m) => m.type === 'openUri'));
    expect(openMessages).toEqual([{ type: 'openUri', uri: 'raw/paper.pdf#page=7&anchor=anc_cmd_enter' }]);
  });

  test('Cmd+Enter also follows regular markdown links in Vim mode', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = 'Jump to [external docs](https://example.com/docs).';

    await page.evaluate((text) => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text }, '*');
      window.__mockMessages = [];
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.click('.cm-content');
    await page.evaluate(() => {
      const view = window.__cmView;
      const linkPos = view.state.doc.toString().indexOf('external docs') + 2;
      view.dispatch({ selection: { anchor: linkPos } });
    });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+Enter');

    const openMessages = await page.evaluate(() => window.__mockMessages.filter((m) => m.type === 'openUri'));
    expect(openMessages).toEqual([{ type: 'openUri', uri: 'https://example.com/docs' }]);
  });

  test('insertText via postMessage inserts text at cursor', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const initialText = '# Note\n\nsome text here\n';

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, initialText);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    // Select "some" using the CM view exposed on window
    await page.evaluate(() => {
      const view = window.__cmView;
      if (!view) return;
      const pos = '# Note\n\n'.length;
      view.dispatch({
        selection: { anchor: pos, head: pos + 4 },
      });
    });

    // Send insertText (simulates PDF viewer sending a link)
    const insertMd = '[PDF](raw/paper.pdf#page=7&anchor=anc_insert)';
    await page.evaluate((md) => {
      window.postMessage({ type: 'insertText', text: md }, '*');
    }, insertMd);

    // Wait for the change to propagate
    await page.waitForFunction((expected) => {
      const el = document.querySelector('.cm-content');
      return el?.textContent?.includes(expected);
    }, insertMd, { timeout: 5000 });

    const content = await page.evaluate(() => {
      const el = document.querySelector('.cm-content');
      return el?.textContent ?? '';
    });

    expect(content).toContain('[PDF](raw/paper.pdf#page=7&anchor=anc_insert)');
  });
});
