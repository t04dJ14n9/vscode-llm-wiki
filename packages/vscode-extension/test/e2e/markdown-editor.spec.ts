import { test, expect } from '@playwright/test';

test.describe('Human Learning — E2E Bidirectional Links', () => {

  async function waitForEditorBootstrap(page: import('@playwright/test').Page): Promise<void> {
    await page.waitForFunction(() =>
      window.__mockMessages?.some((message) => message.type === 'ready'),
      { timeout: 10_000 },
    );
  }

  async function markdownCaretColors(
    page: import('@playwright/test').Page,
    cursorForeground: string,
    editorForeground: string,
  ): Promise<{
    editorCaret: string;
    cursor: string;
    dropCursor: string;
    searchCaret: string;
    vimCaret: string;
  }> {
    await page.evaluate(({ cursor, editor }) => {
      document.documentElement.style.setProperty('--vscode-editorCursor-foreground', cursor);
      document.documentElement.style.setProperty('--vscode-editor-foreground', editor);
      window.postMessage({ type: 'setText', text: 'Theme-derived caret colors.' }, '*');
    }, { cursor: cursorForeground, editor: editorForeground });
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.click('.cm-content');
    await page.waitForSelector('.cm-cursor', { timeout: 10_000 });
    await page.evaluate(() => {
      const editor = document.querySelector<HTMLElement>('.cm-editor');
      const cursor = document.querySelector<HTMLElement>('.cm-cursor');
      if (!editor || !cursor) throw new Error('Missing CodeMirror caret surfaces');
      editor.style.color = '#abcdef';
      cursor.style.color = '#abcdef';
      const dropCursor = document.createElement('div');
      dropCursor.className = 'cm-dropCursor';
      dropCursor.style.color = '#abcdef';
      editor.appendChild(dropCursor);
    });

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
    const searchInput = page.locator('.cm-search input[name="search"]');
    await expect(searchInput).toBeVisible();
    const searchCaret = await searchInput.evaluate(input => {
      (input as HTMLElement).style.color = '#abcdef';
      return getComputedStyle(input).caretColor;
    });
    await page.keyboard.press('Escape');
    await expect(searchInput).toHaveCount(0);

    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
    });
    await page.click('.cm-content');
    await page.keyboard.press('Escape');
    await page.keyboard.type(':');
    const vimInput = page.locator('.cm-vim-panel input');
    await expect(vimInput).toBeVisible();

    return page.evaluate((capturedSearchCaret) => {
      const editor = document.querySelector<HTMLElement>('.cm-editor');
      const cursor = document.querySelector<HTMLElement>('.cm-cursor');
      const dropCursor = document.querySelector<HTMLElement>('.cm-dropCursor');
      const vimInput = document.querySelector<HTMLInputElement>('.cm-vim-panel input');
      if (!editor || !cursor || !dropCursor || !vimInput) {
        throw new Error('Missing Markdown caret surface');
      }
      vimInput.style.color = '#abcdef';
      return {
        editorCaret: getComputedStyle(editor).caretColor,
        cursor: getComputedStyle(cursor).borderLeftColor,
        dropCursor: getComputedStyle(dropCursor).borderLeftColor,
        searchCaret: capturedSearchCaret,
        vimCaret: getComputedStyle(vimInput).caretColor,
      };
    }, searchCaret);
  }

  test('markdown editor loads, receives setText, and renders native source links as clickable widgets', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    // The CodeMirror view is only created when receiving 'setText'
    const testDoc = [
      '# Test Note',
      '',
      'This references a [PDF quote](raw/pdf/paper.pdf#page=7).',
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

  test('learning annotations explain the previous question on hover and keyboard focus', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    const text = 'Alpha selected passage Omega';
    const question = 'What does the selected passage mean?';
    const summary = 'It names the invariant preserved by the online update.';
    await page.evaluate((documentText) => {
      window.postMessage({ type: 'setText', text: documentText }, '*');
    }, text);
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    await page.evaluate(({ question: previousQuestion, summary: answer }) => {
      window.__mockMessages = [];
      window.postMessage({
        type: 'setLearningAnnotations',
        annotations: [{
          discussionId: 'discussion-1',
          notePath: 'wiki/learning/selected-passage.md',
          quote: 'selected passage',
          question: previousQuestion,
          questionCount: 1,
          summary: answer,
          from: 6,
          to: 22,
        }],
      }, '*');
    }, { question, summary });

    const annotation = page.locator('.cm-learning-annotation');
    const tooltip = page.locator('.cm-learning-note-popover[role="tooltip"]');
    const noteLink = page.locator('.cm-learning-note-link');
    await expect(annotation).toHaveText('selected passage');
    await expect(noteLink).toBeVisible();
    await expect(noteLink).not.toHaveAttribute('title');
    await expect(tooltip).toBeHidden();

    await annotation.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Previous question');
    await expect(tooltip).toContainText(question);
    await expect(tooltip).toContainText(summary);
    await expect(tooltip).toContainText('Open ✦ Note for the full discussion');
    await expect.poll(() => page.evaluate(() =>
      window.__mockMessages?.filter(message => message.type === 'openLearningNote').length ?? 0
    )).toBe(0);

    await page.mouse.move(0, 0);
    await expect(tooltip).toBeHidden();
    await noteLink.focus();
    await expect(tooltip).toBeVisible();
    const tooltipId = await tooltip.getAttribute('id');
    expect(tooltipId).toBeTruthy();
    await expect(noteLink).toHaveAttribute('aria-describedby', tooltipId!);

    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
    await expect(noteLink).not.toHaveAttribute('aria-describedby', /.+/u);
    await expect(noteLink).toBeFocused();
    expect(await page.evaluate(() =>
      window.__mockMessages?.filter(message => message.type === 'openLearningNote').length ?? 0
    )).toBe(0);

    await page.keyboard.press('Enter');

    await page.waitForFunction(() =>
      window.__mockMessages?.some((message) =>
        message.type === 'openLearningNote'
        && message.notePath === 'wiki/learning/selected-passage.md'
        && message.discussionId === 'discussion-1'
      ),
      { timeout: 5000 },
    );
  });

  test('learning annotation caret activation uses exclusive ranges and exact repeated-quote offsets', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    const text = 'X same quote middle same quote Z';
    const quote = 'same quote';
    const firstFrom = text.indexOf(quote);
    const secondFrom = text.lastIndexOf(quote);
    const annotations = [
      {
        discussionId: 'discussion-first',
        notePath: 'wiki/learning/first.md',
        quote,
        question: 'What is the first occurrence?',
        questionCount: 1,
        summary: 'The first occurrence is the earlier anchored explanation.',
        from: firstFrom,
        to: firstFrom + quote.length,
      },
      {
        discussionId: 'discussion-second',
        notePath: 'wiki/learning/second.md',
        quote,
        question: 'What is the second occurrence?',
        questionCount: 2,
        summary: 'The second occurrence has its own later explanation.',
        from: secondFrom,
        to: secondFrom + quote.length,
      },
    ];
    await page.evaluate(({ text: documentText, annotations: learningAnnotations }) => {
      window.postMessage({ type: 'setText', text: documentText }, '*');
      window.postMessage({
        type: 'setLearningAnnotations',
        annotations: learningAnnotations,
      }, '*');
    }, { text, annotations });
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-learning-annotation')).toHaveCount(2);
    await page.mouse.move(0, 0);

    const tooltip = page.locator('.cm-learning-note-popover[role="tooltip"]');
    const moveCaret = async (position: number) => {
      await page.evaluate((anchor) => {
        window.__cmView.focus();
        window.__cmView.dispatch({ selection: { anchor } });
      }, position);
    };

    await moveCaret(firstFrom - 1);
    await expect(tooltip).toBeHidden();
    for (const position of [firstFrom, firstFrom + quote.length - 1]) {
      await moveCaret(position);
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText('Previous question');
      await expect(tooltip).toContainText(annotations[0].question);
      await expect(tooltip).toContainText(annotations[0].summary);
      await expect(tooltip).not.toContainText(annotations[1].question);
    }
    await moveCaret(firstFrom + quote.length);
    await expect(tooltip).toBeHidden();

    await moveCaret(secondFrom);
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('2 previous questions');
    await expect(tooltip).toContainText(annotations[1].question);
    await expect(tooltip).toContainText(annotations[1].summary);
    await expect(tooltip).not.toContainText(annotations[0].question);
    await moveCaret(secondFrom + quote.length);
    await expect(tooltip).toBeHidden();
  });

  test('learning annotation popovers clamp to a narrow viewport without shifting editor layout', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 260 });
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    const quote = 'anchored passage near the edge';
    const text = [
      ...Array.from({ length: 12 }, (_, index) => `Preamble line ${index + 1}`),
      `A deliberately long wrapping line puts the ${quote} beside the narrow viewport boundary.`,
      'Following line sentinel',
    ].join('\n');
    const from = text.indexOf(quote);
    await page.evaluate(({ text: documentText, quote: selectedQuote, from: start }) => {
      window.postMessage({ type: 'setText', text: documentText }, '*');
      window.postMessage({
        type: 'setLearningAnnotations',
        annotations: [{
          discussionId: 'discussion-edge',
          notePath: 'wiki/learning/edge.md',
          quote: selectedQuote,
          question: 'Why is this annotation near the edge?',
          questionCount: 1,
          summary: 'It verifies that the floating explanation stays inside the viewport.',
          from: start,
          to: start + selectedQuote.length,
        }],
      }, '*');
    }, { text, quote, from });

    const annotation = page.locator('.cm-learning-annotation');
    const tooltip = page.locator('.cm-learning-note-popover[role="tooltip"]');
    await expect(annotation).toBeVisible();
    await annotation.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.cm-scroller');
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });

    const measure = () => page.evaluate(() => {
      const annotation = document.querySelector<HTMLElement>('.cm-learning-annotation');
      const line = annotation?.closest<HTMLElement>('.cm-line');
      const following = line?.nextElementSibling as HTMLElement | null;
      const content = document.querySelector<HTMLElement>('.cm-content');
      if (!annotation || !line || !following || !content) {
        throw new Error('Missing annotation layout elements');
      }
      const style = getComputedStyle(line);
      const lineRect = line.getBoundingClientRect();
      const followingRect = following.getBoundingClientRect();
      const textRange = document.createRange();
      textRange.selectNodeContents(line);
      return {
        line: [lineRect.left, lineRect.top, lineRect.width, lineRect.height],
        followingTop: followingRect.top,
        scrollHeight: content.scrollHeight,
        textRows: textRange.getClientRects().length,
        font: [
          style.fontFamily,
          style.fontSize,
          style.fontStyle,
          style.fontWeight,
          style.lineHeight,
          style.letterSpacing,
        ],
      };
    });
    const baseline = await measure();

    await annotation.hover();
    await expect(tooltip).toBeVisible();
    const hoverLayout = await measure();
    expect(hoverLayout).toEqual(baseline);

    const placement = await tooltip.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        position: style.position,
        insideLine: Boolean(element.closest('.cm-line')),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });
    expect(placement.left).toBeGreaterThanOrEqual(-1);
    expect(placement.top).toBeGreaterThanOrEqual(-1);
    expect(placement.right).toBeLessThanOrEqual(placement.viewportWidth + 1);
    expect(placement.bottom).toBeLessThanOrEqual(placement.viewportHeight + 1);
    expect(['absolute', 'fixed']).toContain(placement.position);
    expect(placement.insideLine).toBe(false);

    await page.mouse.move(0, 0);
    await expect(tooltip).toBeHidden();
    await page.evaluate((anchor) => {
      window.__cmView.focus();
      window.__cmView.dispatch({ selection: { anchor } });
    }, from);
    await expect(tooltip).toBeVisible();
    expect(await measure()).toEqual(baseline);
  });

  test('selected Markdown can be added to Cursor Chat without submitting', async ({ page }) => {
    await page.setViewportSize({ width: 240, height: 320 });
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    await page.evaluate(() => {
      window.postMessage({ type: 'setText', text: 'alpha beta gamma' }, '*');
    });
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    await page.evaluate(() => {
      window.__mockMessages = [];
      const view = window.__cmView;
      const from = view.state.doc.toString().indexOf('beta');
      view.dispatch({ selection: { anchor: from, head: from + 'beta'.length } });
    });

    const prompt = page.locator('.hl-cursor-selection-prompt');
    await expect(prompt).toBeVisible();
    await expect(prompt.locator('.add-to-chat-label')).toHaveText('Add to Chat');
    await expect(prompt.locator('.add-to-chat-shortcut')).toHaveText(/^(?:⌘L|Ctrl\+L)$/);
    const promptLayout = await prompt.evaluate((element) => {
      const label = element.querySelector('.add-to-chat-label')?.getBoundingClientRect();
      const shortcut = element.querySelector('.add-to-chat-shortcut')?.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      return {
        childTags: Array.from(element.children, child => child.tagName),
        labelRight: label?.right ?? 0,
        shortcutLeft: shortcut?.left ?? 0,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });
    expect(promptLayout.childTags).toEqual(['SPAN', 'SPAN']);
    expect(promptLayout.shortcutLeft).toBeGreaterThanOrEqual(promptLayout.labelRight);
    expect(promptLayout.width).toBeLessThanOrEqual(140);
    expect(promptLayout.height).toBeLessThanOrEqual(36);
    expect(promptLayout.left).toBeGreaterThanOrEqual(7);
    expect(promptLayout.top).toBeGreaterThanOrEqual(7);
    expect(promptLayout.right).toBeLessThanOrEqual(promptLayout.viewportWidth - 7);
    expect(promptLayout.bottom).toBeLessThanOrEqual(promptLayout.viewportHeight - 7);

    await prompt.click();
    await expect.poll(() => page.evaluate(() =>
      window.__mockMessages?.filter((message) =>
        message.type === 'addSelectionToCursorChat'
        && Object.keys(message).length === 1
      ).length ?? 0
    )).toBe(1);
    await page.waitForTimeout(50);
    expect(await page.evaluate(() =>
      window.__mockMessages?.filter(message => message.type === 'addSelectionToCursorChat').length ?? 0
    )).toBe(1);
  });

  test('native rendered-text selections show the Cursor prompt and use Mod-L', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    await page.evaluate(() => {
      window.postMessage({ type: 'setText', text: 'alpha beta gamma' }, '*');
    });
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    await page.evaluate(() => {
      window.__mockMessages = [];
      const line = document.querySelector<HTMLElement>('.cm-line');
      if (!line?.firstChild) throw new Error('Missing rendered text');
      const from = (line.textContent ?? '').indexOf('beta');
      const range = document.createRange();
      range.setStart(line.firstChild, from);
      range.setEnd(line.firstChild, from + 'beta'.length);
      const nativeSelection = window.getSelection();
      nativeSelection?.removeAllRanges();
      nativeSelection?.addRange(range);
      line.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    await expect.poll(() => page.evaluate(() => {
      const range = window.__cmView.state.selection.main;
      return window.__cmView.state.sliceDoc(range.from, range.to);
    })).toBe('beta');

    await page.evaluate(() => {
      window.__mockMessages = [];
      window.postMessage({ type: 'requestSelection', requestId: 'selection-1' }, '*');
    });
    await page.waitForFunction(() =>
      window.__mockMessages?.some((message) =>
        message.type === 'selectionResponse'
        && message.requestId === 'selection-1'
        && message.selection?.from === 6
        && message.selection?.to === 10
      ),
      { timeout: 5000 },
    );

    await expect(page.locator('.hl-cursor-selection-prompt')).toBeVisible();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+L' : 'Control+L');
    await page.waitForFunction(() =>
      window.__mockMessages?.some((message) =>
        message.type === 'addSelectionToCursorChat'
        && Object.keys(message).length === 1
      ),
      { timeout: 5000 },
    );
    await expect(page.locator('.hl-cursor-selection-prompt')).toBeVisible();

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.selection.main.head } });
    });
    await expect(page.locator('.hl-cursor-selection-prompt')).toHaveCount(0);
  });

  test('markdown editor defaults to Obsidian\'s 16px prose rhythm and heading scale', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((message) => {
      window.postMessage(message, '*');
    }, {
      type: 'setText',
      title: 'Human Learning Parity',
      text: '# Human Learning Parity\n\nBody copy\n\n## Second level\n\nTail',
    });
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    const rhythm = await page.evaluate(() => {
      const body = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent === 'Body copy');
      const h1 = document.querySelector<HTMLElement>('.cm-hybrid-heading-line-1');
      const h2 = document.querySelector<HTMLElement>('.cm-hybrid-heading-line-2');
      const title = document.querySelector<HTMLElement>('.cm-hybrid-document-title');
      if (!body || !h1 || !h2 || !title) throw new Error('Missing note typography surfaces');
      return {
        bodySize: getComputedStyle(body).fontSize,
        bodyLineHeight: getComputedStyle(body).lineHeight,
        h1Size: getComputedStyle(h1).fontSize,
        h2Size: getComputedStyle(h2).fontSize,
        titleSize: getComputedStyle(title).fontSize,
      };
    });

    expect(rhythm).toEqual({
      bodySize: '16px',
      bodyLineHeight: '24px',
      h1Size: '26.4px',
      h2Size: '23.2px',
      titleSize: '28px',
    });
  });

  test('markdown editor applies host text metrics while keeping Obsidian-like prose and code families', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, '# Styled note\n\nBody copy with `inline code`.');

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
      const sourceLine = document.querySelector('.cm-hybrid-source-line');
      const inlineCode = document.querySelector('.cm-hybrid-inline-code');
      if (!scroller || !content || !sourceLine || !inlineCode) return false;
      const scrollerStyle = getComputedStyle(scroller);
      const contentStyle = getComputedStyle(content);
      const sourceLineStyle = getComputedStyle(sourceLine);
      const inlineCodeStyle = getComputedStyle(inlineCode);
      return !scrollerStyle.fontFamily.includes('Fira Code')
        && sourceLineStyle.fontFamily === scrollerStyle.fontFamily
        && inlineCodeStyle.fontFamily.includes('Fira Code')
        && scrollerStyle.fontSize === '17px'
        && scrollerStyle.fontWeight === '500'
        && contentStyle.lineHeight === '29px'
        && contentStyle.letterSpacing === '1.25px';
    }, { timeout: 5000 });

    const styles = await page.evaluate(() => {
      const scroller = document.querySelector('.cm-scroller');
      const content = document.querySelector('.cm-content');
      const sourceLine = document.querySelector('.cm-hybrid-source-line');
      const inlineCode = document.querySelector('.cm-hybrid-inline-code');
      const scrollerStyle = scroller ? getComputedStyle(scroller) : null;
      const contentStyle = content ? getComputedStyle(content) : null;
      const sourceLineStyle = sourceLine ? getComputedStyle(sourceLine) : null;
      const inlineCodeStyle = inlineCode ? getComputedStyle(inlineCode) : null;
      return {
        fontFamily: scrollerStyle?.fontFamily ?? '',
        sourceLineFontFamily: sourceLineStyle?.fontFamily ?? '',
        inlineCodeFontFamily: inlineCodeStyle?.fontFamily ?? '',
        fontSize: scrollerStyle?.fontSize ?? '',
        fontWeight: scrollerStyle?.fontWeight ?? '',
        lineHeight: contentStyle?.lineHeight ?? '',
        letterSpacing: contentStyle?.letterSpacing ?? '',
      };
    });

    expect(styles.fontFamily).not.toContain('Fira Code');
    expect(styles.sourceLineFontFamily).toBe(styles.fontFamily);
    expect(styles.inlineCodeFontFamily).toContain('Fira Code');
    expect(styles.fontSize).toBe('17px');
    expect(styles.fontWeight).toBe('500');
    expect(styles.lineHeight).toBe('29px');
    expect(styles.letterSpacing).toBe('1.25px');
  });

  test('moving the caret into prose preserves its typography and wrapping', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 600 });
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    const paragraph = 'Moving the caret through this deliberately long paragraph must not change its font, apparent size, or wrapping across the available editor width.';
    await page.evaluate(({ paragraph: text }) => {
      window.postMessage({
        type: 'setText',
        text: `# Stable prose\n\n${text}\n\nTail`,
      }, '*');
    }, { paragraph });
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(5).from } });
    });

    const measure = async () => page.evaluate((text) => {
      const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(candidate => candidate.textContent === text);
      if (!line) throw new Error('Missing target paragraph');
      const style = getComputedStyle(line);
      const range = document.createRange();
      range.selectNodeContents(line);
      const lineRect = line.getBoundingClientRect();
      const textRect = range.getBoundingClientRect();
      return {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontStyle: style.fontStyle,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        lineHeightPx: lineRect.height,
        textWidthPx: textRect.width,
        textHeightPx: textRect.height,
        textRowCount: range.getClientRects().length,
        isActiveSourceLine: line.classList.contains('cm-hybrid-source-line'),
      };
    }, paragraph);

    const inactive = await measure();
    expect(inactive.isActiveSourceLine).toBe(false);
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 8 } });
    });
    await page.waitForFunction(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent?.startsWith('Moving the caret'));
      return target?.classList.contains('cm-hybrid-source-line');
    });
    const active = await measure();
    expect(active.isActiveSourceLine).toBe(true);

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(5).from } });
    });
    await page.waitForFunction(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent?.startsWith('Moving the caret'));
      return target && !target.classList.contains('cm-hybrid-source-line');
    });
    const restored = await measure();
    expect(restored.isActiveSourceLine).toBe(false);

    for (const current of [active, restored]) {
      expect({
        fontFamily: current.fontFamily,
        fontSize: current.fontSize,
        fontStyle: current.fontStyle,
        fontWeight: current.fontWeight,
        lineHeight: current.lineHeight,
        letterSpacing: current.letterSpacing,
        textRowCount: current.textRowCount,
      }).toEqual({
        fontFamily: inactive.fontFamily,
        fontSize: inactive.fontSize,
        fontStyle: inactive.fontStyle,
        fontWeight: inactive.fontWeight,
        lineHeight: inactive.lineHeight,
        letterSpacing: inactive.letterSpacing,
        textRowCount: inactive.textRowCount,
      });
      expect(Math.abs(current.lineHeightPx - inactive.lineHeightPx)).toBeLessThanOrEqual(0.25);
      expect(Math.abs(current.textWidthPx - inactive.textWidthPx)).toBeLessThanOrEqual(0.25);
      expect(Math.abs(current.textHeightPx - inactive.textHeightPx)).toBeLessThanOrEqual(0.25);
    }
  });

  test('inline code and footnote labels keep their metrics while editing', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);
    await page.evaluate(() => {
      window.postMessage({
        type: 'setText',
        text: 'Plain caret beside `inline code`, ==highlight==, ~~strike~~, #topic, and [^note].\n\n[^note]: Footnote body\n\nTail',
      }, '*');
      window.postMessage({
        type: 'updateSettings',
        settings: {
          fontFamily: 'Fira Code',
          fontSize: '17px',
          fontWeight: '400',
          lineHeight: '27px',
          letterSpacing: '0.5px',
        },
      }, '*');
    });
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(5).from } });
    });
    await page.waitForSelector('.cm-hybrid-inline-code');
    await page.waitForSelector('.cm-hybrid-footnote-def-label');

    const measure = async (selector: string) => page.locator(selector).first().evaluate(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontStyle: style.fontStyle,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        verticalAlign: style.verticalAlign,
        opacity: style.opacity,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        width: rect.width,
        height: rect.height,
      };
    });

    const inactiveCode = await measure('.cm-hybrid-inline-code');
    const inactiveFootnote = await measure('.cm-hybrid-footnote-def-label');
    const preservedSelectors = [
      '.cm-hybrid-inline-code',
      '.cm-hybrid-highlight',
      '.cm-hybrid-strikethrough',
      '.cm-hybrid-tag',
      '.cm-hybrid-footnote-ref',
    ];
    const inactiveFormatted = await Promise.all(preservedSelectors.map(measure));

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from + 2 } });
    });
    await page.waitForFunction(() => document.querySelector('.cm-line')?.classList.contains('cm-hybrid-source-line'));
    const sameLineFormatted = await Promise.all(preservedSelectors.map(measure));
    expect(await page.locator([
      '.cm-active-inline-code',
      '.cm-active-highlight',
      '.cm-active-strikethrough',
      '.cm-active-tag',
      '.cm-active-footnote-ref',
    ].join(',')).count()).toBe(0);
    expect(sameLineFormatted).toEqual(inactiveFormatted);

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from + 22 } });
    });
    await page.waitForSelector('.cm-active-inline-code');
    const activeCode = await measure('.cm-active-inline-code');

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 3 } });
    });
    await page.waitForSelector('.cm-active-footnote-def-label');
    const activeFootnote = await measure('.cm-active-footnote-def-label');

    for (const [active, inactive] of [
      [activeCode, inactiveCode],
      [activeFootnote, inactiveFootnote],
    ]) {
      expect({
        fontFamily: active.fontFamily,
        fontSize: active.fontSize,
        fontStyle: active.fontStyle,
        fontWeight: active.fontWeight,
        lineHeight: active.lineHeight,
        letterSpacing: active.letterSpacing,
        verticalAlign: active.verticalAlign,
        opacity: active.opacity,
        paddingLeft: active.paddingLeft,
        paddingRight: active.paddingRight,
      }).toEqual({
        fontFamily: inactive.fontFamily,
        fontSize: inactive.fontSize,
        fontStyle: inactive.fontStyle,
        fontWeight: inactive.fontWeight,
        lineHeight: inactive.lineHeight,
        letterSpacing: inactive.letterSpacing,
        verticalAlign: inactive.verticalAlign,
        opacity: inactive.opacity,
        paddingLeft: inactive.paddingLeft,
        paddingRight: inactive.paddingRight,
      });
      expect(Math.abs(active.width - inactive.width)).toBeLessThanOrEqual(0.25);
      expect(Math.abs(active.height - inactive.height)).toBeLessThanOrEqual(0.25);
    }
  });

  test('selection backgrounds follow the active VS Code editor theme', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    await page.evaluate(() => {
      document.documentElement.style.setProperty('--vscode-editor-selectionBackground', '#123456');
      document.documentElement.style.setProperty('--vscode-editor-inactiveSelectionBackground', '#654321');
      window.postMessage({
        type: 'setText',
        text: 'First selected line.\nSecond selected line.\nThird selected line.',
      }, '*');
    });
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: 2, head: view.state.doc.length - 2 } });
      view.focus();
    });

    const selections = page.locator('.cm-selectionLayer .cm-selectionBackground');
    await expect(selections.first()).toBeVisible();
    expect(await selections.count()).toBeGreaterThan(1);
    const colors = async () => selections.evaluateAll(elements =>
      [...new Set(elements.map(element => getComputedStyle(element).backgroundColor))],
    );
    await expect.poll(colors).toEqual(['rgb(18, 52, 86)']);

    await page.evaluate(() => {
      document.querySelector<HTMLElement>('#tab-editor')?.focus();
    });
    await page.waitForFunction(() => !document.querySelector('.cm-editor')?.classList.contains('cm-focused'));
    await expect.poll(colors).toEqual(['rgb(101, 67, 33)']);

    await page.evaluate(() => window.__cmView.focus());
    await page.waitForFunction(() => document.querySelector('.cm-editor')?.classList.contains('cm-focused'));
    await expect.poll(colors).toEqual(['rgb(18, 52, 86)']);

    await page.evaluate(() => {
      document.documentElement.style.setProperty('--vscode-editor-selectionBackground', 'initial');
    });
    await expect.poll(colors).toEqual(['rgba(38, 79, 120, 0.65)']);
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--vscode-editor-inactiveSelectionBackground', 'initial');
      document.querySelector<HTMLElement>('#tab-editor')?.focus();
    });
    await page.waitForFunction(() => !document.querySelector('.cm-editor')?.classList.contains('cm-focused'));
    await expect.poll(colors).toEqual(['rgba(127, 127, 127, 0.24)']);
    expect(await page.evaluate(() => window.__cmView.state.selection.main.empty)).toBe(false);
  });

  test('caret surfaces use the explicit VS Code cursor token', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    const colors = await markdownCaretColors(page, '#123456', '#654321');

    expect(colors).toEqual({
      editorCaret: 'rgb(18, 52, 86)',
      cursor: 'rgb(18, 52, 86)',
      dropCursor: 'rgb(18, 52, 86)',
      searchCaret: 'rgb(18, 52, 86)',
      vimCaret: 'rgb(18, 52, 86)',
    });
  });

  test('caret surfaces fall back to the VS Code editor foreground', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    const colors = await markdownCaretColors(page, 'initial', '#654321');

    expect(colors).toEqual({
      editorCaret: 'rgb(101, 67, 33)',
      cursor: 'rgb(101, 67, 33)',
      dropCursor: 'rgb(101, 67, 33)',
      searchCaret: 'rgb(101, 67, 33)',
      vimCaret: 'rgb(101, 67, 33)',
    });
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

  test('markdown editor uses native full-width text editor geometry', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

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
    expect(layout.contentWidth).toBeGreaterThan(layout.scrollerWidth - 180);
    expect(layout.contentWidth).toBeLessThan(layout.scrollerWidth);
    expect(layout.codeWidth).toBeLessThanOrEqual(layout.contentWidth + 1);
    expect(layout.paragraphHeight).toBeLessThanOrEqual(layout.normalHeight * 2.5);
  });

  test('markdown editor uses Obsidian-like sans prose and monospace code while headings keep visual hierarchy', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

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
      window.postMessage({
        type: 'updateSettings',
        settings: {
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          fontSize: '14px',
          fontWeight: '400',
          lineHeight: '20px',
          letterSpacing: '0px',
        },
      }, '*');
    });
    await page.waitForFunction(() => {
      const content = document.querySelector('.cm-content');
      return content ? getComputedStyle(content).lineHeight === '20px' : false;
    }, { timeout: 5000 });
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
        bodyLineHeight: bodyStyle?.lineHeight ?? '',
        headingFontFamily: headingStyle?.fontFamily ?? '',
        headingFontSize: headingStyle?.fontSize ?? '',
        headingLineHeight: headingStyle?.lineHeight ?? '',
        inlineCodeFontFamily: inlineCodeStyle?.fontFamily ?? '',
        inlineCodeFontSize: inlineCodeStyle?.fontSize ?? '',
        inlineCodeLineHeight: inlineCodeStyle?.lineHeight ?? '',
        codeBlockFontFamily: codeBlockStyle?.fontFamily ?? '',
        codeBlockFontSize: codeBlockStyle?.fontSize ?? '',
        codeBlockLineHeight: codeBlockStyle?.lineHeight ?? '',
      };
    });

    const monospaceFamily = /monospace|ui-monospace|Menlo|Monaco|Consolas|Courier|Fira Code/i;
    expect(styles.bodyFontFamily).not.toMatch(monospaceFamily);
    expect(styles.headingFontFamily).not.toMatch(monospaceFamily);
    expect(styles.inlineCodeFontFamily).toMatch(monospaceFamily);
    expect(styles.codeBlockFontFamily).toMatch(monospaceFamily);
    expect(styles.bodyFontSize).toBe('14px');
    expect(styles.inlineCodeFontSize).toBe('14px');
    expect(styles.codeBlockFontSize).toBe('14px');
    expect(styles.bodyLineHeight).toBe('20px');
    expect(Number.parseFloat(styles.headingFontSize)).toBeGreaterThan(Number.parseFloat(styles.bodyFontSize));
    expect(Number.parseFloat(styles.headingLineHeight)).toBeGreaterThan(Number.parseFloat(styles.bodyLineHeight));
    expect(styles.inlineCodeLineHeight).toBe('20px');
    expect(styles.codeBlockLineHeight).toBe('20px');
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

  test('markdown line numbers use the built-in editor typography and theme color', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      const root = document.documentElement.style;
      root.setProperty('--vscode-editorLineNumber-foreground', 'rgb(101, 102, 103)');
      root.setProperty('--vscode-editor-font-family', '"Courier New", monospace');
      root.setProperty('--vscode-editor-font-size', '13px');
      root.setProperty('--vscode-editor-font-weight', '500');
      root.setProperty('--hl-editor-letter-spacing', '1.25px');
    });
    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, '# Native gutter\n\nBody copy\n\nLast line');

    await page.waitForFunction(() => (
      [...document.querySelectorAll<HTMLElement>('#editor .cm-lineNumbers .cm-gutterElement')]
        .some(element => element.textContent?.trim() === '3' && element.getBoundingClientRect().height > 0)
    ), { timeout: 10_000 });
    const styles = await page.evaluate(() => {
      const lineNumber = [...document.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement')]
        .find(element => element.textContent?.trim() === '3');
      if (!lineNumber) throw new Error('Missing line-number row');
      const computed = getComputedStyle(lineNumber);
      return {
        color: computed.color,
        cursor: computed.cursor,
        fontFamily: computed.fontFamily,
        fontSize: computed.fontSize,
        fontVariantNumeric: computed.fontVariantNumeric,
        fontWeight: computed.fontWeight,
        letterSpacing: computed.letterSpacing,
        lineHeight: computed.lineHeight,
      };
    });

    expect(styles.color).toBe('rgb(101, 102, 103)');
    expect(styles.cursor).toBe('default');
    expect(styles.fontFamily).toContain('Courier New');
    expect(styles.fontSize).toBe('13px');
    expect(styles.fontVariantNumeric).toContain('tabular-nums');
    expect(styles.fontWeight).toBe('500');
    expect(styles.letterSpacing).toBe('1.25px');
    expect(styles.lineHeight).toBe('24px');
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
    await expect(page.getByLabel('tags property values')).toBeHidden();

    const propertiesHeading = page.getByRole('button', { name: 'Properties' });
    await expect(propertiesHeading).toHaveAttribute('aria-expanded', 'true');
    await propertiesHeading.click();
    await expect(propertiesHeading).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.cm-hybrid-properties-rows')).toBeHidden();
    await propertiesHeading.click();
    await expect(page.locator('.cm-hybrid-properties-rows')).toBeVisible();

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

  test('frontmatter property icons and removable chips match Obsidian controls', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    const doc = [
      '---',
      'tags: [test, math, code]',
      'aliases: [Parity Fixture]',
      '---',
      '',
      '# Property controls',
    ].join('\n');
    await page.evaluate(text => {
      window.postMessage({ type: 'setText', text, title: 'Property controls' }, '*');
    }, doc);
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    await expect(page.locator('[data-property-icon="tags"]')).toBeVisible();
    await expect(page.locator('[data-property-icon="aliases"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove math from tags' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove Parity Fixture from aliases' })).toBeVisible();

    await page.getByRole('button', { name: 'Remove math from tags' }).click();
    await page.waitForFunction(() => /^tags: \[test, code\]$/m.test(window.__cmView.state.doc.toString()));
    const state = await page.evaluate(() => ({
      text: window.__cmView.state.doc.toString(),
      chips: Array.from(document.querySelectorAll('.cm-hybrid-property-chip'))
        .map(chip => chip.textContent?.replace(/×$/, '')),
    }));
    expect(state.text).toContain('tags: [test, code]');
    expect(state.chips).toEqual(['test', 'code', 'Parity Fixture']);
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
      'For details see [[FlashAttention]] and [PDF link](raw/pdf/flash-attention.pdf#page=7).',
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
    await expect(titleInput).toBeHidden();
    await page.getByLabel('title property display').click();
    await expect(titleInput).toBeVisible();

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
    await expect(tagsInput).toBeHidden();
    await page.getByLabel('tags property display').click();
    await expect(tagsInput).toBeVisible();

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
    await expect(tagsInput).toBeHidden();
    await page.getByLabel('tags property display').click();
    await expect(tagsInput).toBeVisible();

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

  test('active heading lines keep the Markdown heading marker visible with heading scale', async ({ page }) => {
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

  test('heading gutter affordances collapse and expand Markdown sections like Obsidian live preview', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '# Root',
      'Root introduction',
      '## First section',
      'Detail A',
      'Detail B',
      '## Second section',
      'Tail detail',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });

    await expect(page.locator('.cm-foldGutter')).toBeVisible();
    await expect.poll(async () => page.locator('.cm-foldGutter .cm-gutterElement').filter({ hasText: '⌄' }).count())
      .toBeGreaterThanOrEqual(3);
    await page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll<HTMLElement>('.cm-hybrid-heading-line-2'))
        .find(line => line.textContent?.includes('First section'));
      const markers = Array.from(document.querySelectorAll<HTMLElement>('.cm-foldGutter .cm-gutterElement'))
        .filter(marker => marker.textContent?.trim() === '⌄');
      if (!heading || markers.length === 0) throw new Error('Missing first section fold affordance');
      const headingTop = heading.getBoundingClientRect().top;
      const marker = markers.sort((left, right) => (
        Math.abs(left.getBoundingClientRect().top - headingTop)
        - Math.abs(right.getBoundingClientRect().top - headingTop)
      ))[0];
      marker!.dataset.testHeadingFold = 'first-section';
    });
    const firstSectionMarker = page.locator('[data-test-heading-fold="first-section"]');
    await firstSectionMarker.hover();
    await expect(firstSectionMarker).toHaveCSS('opacity', '1');
    await firstSectionMarker.click();

    await expect(page.locator('.cm-content')).not.toContainText('Detail A');
    await expect(page.locator('.cm-content')).not.toContainText('Detail B');
    await expect(page.locator('.cm-content')).toContainText('Second section');
    expect(await page.evaluate(() => window.__cmView.state.doc.toString())).toBe(doc);

    await page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll<HTMLElement>('.cm-hybrid-heading-line-2'))
        .find(line => line.textContent?.includes('First section'));
      const markers = Array.from(document.querySelectorAll<HTMLElement>('.cm-foldGutter .cm-gutterElement'))
        .filter(marker => marker.textContent?.trim() === '›' && marker.getBoundingClientRect().height > 0);
      if (!heading || markers.length === 0) throw new Error('Missing collapsed first section affordance');
      const headingTop = heading.getBoundingClientRect().top;
      const marker = markers.sort((left, right) => (
        Math.abs(left.getBoundingClientRect().top - headingTop)
        - Math.abs(right.getBoundingClientRect().top - headingTop)
      ))[0];
      marker!.dataset.testHeadingFold = 'first-section-closed';
    });
    const closedMarker = page.locator('[data-test-heading-fold="first-section-closed"]');
    await closedMarker.hover();
    await expect(closedMarker).toHaveCSS('opacity', '1');
    await closedMarker.click();
    await expect(page.locator('.cm-content')).toContainText('Detail A');
    await expect(page.locator('.cm-content')).toContainText('Detail B');
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

  test('Vim mode ignores the markdown italics shortcut so the cursor stays put', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text: 'alpha beta' }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.click('.cm-content');
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from + 'alpha '.length } });
    });
    await page.keyboard.press('Escape');

    const before = await page.evaluate(() => ({
      text: window.__cmView.state.doc.toString(),
      head: window.__cmView.state.selection.main.head,
    }));
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+I`);

    await expect.poll(() => page.evaluate(() => ({
      text: window.__cmView.state.doc.toString(),
      head: window.__cmView.state.selection.main.head,
    }))).toEqual(before);
  });

  test('Vim mode consumes the open-file shortcut without moving the cursor', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text: 'alpha beta' }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.click('.cm-content');
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from + 'alpha '.length } });
    });
    await page.keyboard.press('Escape');

    const before = await page.evaluate(() => ({
      text: window.__cmView.state.doc.toString(),
      head: window.__cmView.state.selection.main.head,
      focused: document.querySelector('.cm-editor')?.classList.contains('cm-focused') ?? false,
    }));
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+O`);

    await expect.poll(() => page.evaluate(() => ({
      text: window.__cmView.state.doc.toString(),
      head: window.__cmView.state.selection.main.head,
      focused: document.querySelector('.cm-editor')?.classList.contains('cm-focused') ?? false,
    }))).toEqual(before);
  });

  test('Vim mode ignores stray backtick mark-motion input so the cursor stays put', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text: 'alpha beta\ngamma delta' }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.click('.cm-content');
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from + 'gamma '.length } });
    });
    await page.keyboard.press('Escape');

    const before = await page.evaluate(() => ({
      text: window.__cmView.state.doc.toString(),
      head: window.__cmView.state.selection.main.head,
      focused: document.querySelector('.cm-editor')?.classList.contains('cm-focused') ?? false,
    }));

    await page.keyboard.press('Backquote');
    await page.keyboard.press('Backquote');
    await page.keyboard.press('Backquote');

    await expect.poll(() => page.evaluate(() => ({
      text: window.__cmView.state.doc.toString(),
      head: window.__cmView.state.selection.main.head,
      focused: document.querySelector('.cm-editor')?.classList.contains('cm-focused') ?? false,
    }))).toEqual(before);
  });

  test('Vim normal mode ignores raw repeated backtick text input', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text: 'alpha beta\ngamma delta' }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.click('.cm-content');
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from + 'gamma '.length } });
    });
    await page.keyboard.press('Escape');

    const before = await page.evaluate(() => ({
      text: window.__cmView.state.doc.toString(),
      head: window.__cmView.state.selection.main.head,
      focused: document.querySelector('.cm-editor')?.classList.contains('cm-focused') ?? false,
    }));

    await page.keyboard.insertText('```');

    await expect.poll(() => page.evaluate(() => ({
      text: window.__cmView.state.doc.toString(),
      head: window.__cmView.state.selection.main.head,
      focused: document.querySelector('.cm-editor')?.classList.contains('cm-focused') ?? false,
    }))).toEqual(before);
  });

  test('Vim insert mode leaves Markdown fence backticks typable', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text: 'alpha beta' }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.click('.cm-content');
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from + 'alpha '.length } });
      window.__backtickKeydowns = [];
      document.querySelector('.cm-editor')?.addEventListener('keydown', event => {
        if (event.key === '`' || event.code === 'Backquote') {
          window.__backtickKeydowns.push({
            defaultPrevented: event.defaultPrevented,
            insertMode: view.cm.state.vim?.insertMode ?? false,
          });
        }
      }, true);
    });
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from + 'alpha '.length } });
    });
    await page.keyboard.press('i');
    await page.keyboard.press('Backquote');
    await page.keyboard.press('Backquote');
    await page.keyboard.press('Backquote');

    const state = await page.evaluate(() => ({
      text: window.__cmView.state.doc.toString(),
      head: window.__cmView.state.selection.main.head,
      keydowns: window.__backtickKeydowns,
    }));

    expect(state.keydowns).toEqual([
      { defaultPrevented: false, insertMode: true },
      { defaultPrevented: false, insertMode: true },
      { defaultPrevented: false, insertMode: true },
    ]);
    expect(state.text).toBe('alpha ```beta');
    expect(state.head).toBe('alpha ```'.length);
  });

  test('Vim mode keeps markdown modifier shortcuts from changing text cursor or focus', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const cases = [
      { label: 'bold', key: `${modifier}+B`, text: 'alpha beta', line: 1, offset: 'alpha '.length },
      { label: 'italics', key: `${modifier}+I`, text: 'alpha beta', line: 1, offset: 'alpha '.length },
      { label: 'strikethrough', key: `${modifier}+Shift+X`, text: 'alpha beta', line: 1, offset: 'alpha '.length },
      { label: 'inline code', key: `${modifier}+Backquote`, text: 'alpha beta', line: 1, offset: 'alpha '.length },
      { label: 'insert link', key: `${modifier}+K`, text: 'alpha beta', line: 1, offset: 'alpha '.length },
      { label: 'toggle checklist', key: `${modifier}+L`, text: '- [ ] task', line: 1, offset: '- [ ] '.length },
      { label: 'remove heading', key: `${modifier}+Alt+0`, text: '# alpha beta', line: 1, offset: '# alpha '.length },
      { label: 'heading 1', key: `${modifier}+Alt+1`, text: 'alpha beta', line: 1, offset: 'alpha '.length },
      { label: 'heading 2', key: `${modifier}+Alt+2`, text: 'alpha beta', line: 1, offset: 'alpha '.length },
      { label: 'heading 3', key: `${modifier}+Alt+3`, text: 'alpha beta', line: 1, offset: 'alpha '.length },
      { label: 'heading 4', key: `${modifier}+Alt+4`, text: 'alpha beta', line: 1, offset: 'alpha '.length },
      { label: 'heading 5', key: `${modifier}+Alt+5`, text: 'alpha beta', line: 1, offset: 'alpha '.length },
      { label: 'heading 6', key: `${modifier}+Alt+6`, text: 'alpha beta', line: 1, offset: 'alpha '.length },
      { label: 'insert table', key: `${modifier}+Shift+T`, text: 'alpha beta', line: 1, offset: 'alpha '.length },
      { label: 'highlight', key: `${modifier}+Shift+H`, text: 'alpha beta', line: 1, offset: 'alpha '.length },
      { label: 'open file', key: `${modifier}+O`, text: 'alpha beta', line: 1, offset: 'alpha '.length },
    ];

    await page.waitForSelector('body', { timeout: 10_000 });

    for (const testCase of cases) {
      await test.step(testCase.label, async () => {
        await page.evaluate((text) => {
          window.postMessage({ type: 'setVimMode', enabled: true }, '*');
          window.postMessage({ type: 'setText', text }, '*');
        }, testCase.text);
        await page.waitForFunction(
          (text) => window.__cmView?.state.doc.toString() === text,
          testCase.text,
          { timeout: 5000 },
        );

        await page.click('.cm-content');
        await page.evaluate(({ line, offset }) => {
          const view = window.__cmView;
          const targetLine = view.state.doc.line(line);
          view.dispatch({ selection: { anchor: targetLine.from + offset } });
        }, { line: testCase.line, offset: testCase.offset });
        await page.keyboard.press('Escape');

        const before = await page.evaluate(() => ({
          text: window.__cmView.state.doc.toString(),
          head: window.__cmView.state.selection.main.head,
          focused: document.querySelector('.cm-editor')?.classList.contains('cm-focused') ?? false,
        }));
        await page.keyboard.press(testCase.key);

        await expect.poll(() => page.evaluate(() => ({
          text: window.__cmView.state.doc.toString(),
          head: window.__cmView.state.selection.main.head,
          focused: document.querySelector('.cm-editor')?.classList.contains('cm-focused') ?? false,
        }))).toEqual(before);
      });
    }
  });

  test('markdown modifier shortcuts still edit text outside Vim mode', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const cases = [
      {
        label: 'bold',
        key: `${modifier}+B`,
        text: 'alpha beta',
        selection: { anchor: 0, head: 'alpha'.length },
        expected: '**alpha** beta',
      },
      {
        label: 'italics',
        key: `${modifier}+I`,
        text: 'alpha beta',
        selection: { anchor: 0, head: 'alpha'.length },
        expected: '*alpha* beta',
      },
      {
        label: 'insert link',
        key: `${modifier}+K`,
        text: 'alpha beta',
        selection: { anchor: 0, head: 'alpha'.length },
        expected: '[alpha](url) beta',
      },
      {
        label: 'toggle checklist',
        key: `${modifier}+L`,
        text: '- [ ] task',
        selection: { anchor: '- [ ] '.length },
        expected: '- [x] task',
      },
      {
        label: 'heading',
        key: `${modifier}+Alt+2`,
        text: 'alpha beta',
        selection: { anchor: 'alpha '.length },
        expected: '## alpha beta',
      },
      {
        label: 'insert table',
        key: `${modifier}+Shift+T`,
        text: 'alpha beta',
        selection: { anchor: 'alpha '.length },
        expected: [
          'alpha | Column 1 | Column 2 |',
          '| --- | --- |',
          '|  |  |beta',
        ].join('\n'),
      },
    ];

    await page.waitForSelector('body', { timeout: 10_000 });

    for (const testCase of cases) {
      await test.step(testCase.label, async () => {
        await page.evaluate((text) => {
          window.postMessage({ type: 'setVimMode', enabled: false }, '*');
          window.postMessage({ type: 'setText', text }, '*');
        }, testCase.text);
        await page.waitForFunction(
          (text) => window.__cmView?.state.doc.toString() === text,
          testCase.text,
          { timeout: 5000 },
        );

        await page.click('.cm-content');
        await page.evaluate((selection) => {
          window.__cmView.dispatch({ selection });
        }, testCase.selection);
        await page.keyboard.press(testCase.key);

        await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
          .toBe(testCase.expected);
      });
    }
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

  test('Vim command line uses VS Code editor styling', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text: '# Note\n\nBody' }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.click('.cm-content');
    await page.keyboard.press('Escape');
    await page.keyboard.type(':');

    const panel = page.locator('.cm-vim-panel.cm-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(':');

    const styles = await panel.evaluate((element) => {
      const input = element.querySelector('input');
      const panelStyle = getComputedStyle(element);
      const inputStyle = input ? getComputedStyle(input) : null;
      const rect = element.getBoundingClientRect();
      return {
        panelBackground: panelStyle.backgroundColor,
        panelColor: panelStyle.color,
        panelBorderTopColor: panelStyle.borderTopColor,
        panelBorderTopWidth: panelStyle.borderTopWidth,
        panelHeight: rect.height,
        inputBackground: inputStyle?.backgroundColor ?? '',
        inputColor: inputStyle?.color ?? '',
        inputOutlineStyle: inputStyle?.outlineStyle ?? '',
      };
    });

    expect(styles.panelBackground).toBe('rgb(37, 37, 38)');
    expect(styles.panelColor).toBe('rgb(212, 212, 212)');
    expect(styles.panelBorderTopColor).toBe('rgb(62, 62, 62)');
    expect(styles.panelBorderTopWidth).toBe('1px');
    expect(styles.panelHeight).toBeGreaterThanOrEqual(28);
    expect(styles.inputBackground).toBe('rgba(0, 0, 0, 0)');
    expect(styles.inputColor).toBe('rgb(212, 212, 212)');
    expect(styles.inputOutlineStyle).toBe('none');
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

  test('active fenced code content keeps both rendered fence edges like Obsidian', async ({ page }) => {
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
      view.dispatch({ selection: { anchor: view.state.doc.line(4).from + 2 } });
    });

    await expect.poll(visibleFenceLines).toEqual(['```python']);
    await expect(page.locator('.cm-hybrid-codeblock')).toHaveCount(1);
    await expect(page.locator('.cm-hybrid-codeblock-footer')).toHaveCount(1);
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

  test('Vim insert command keeps the cursor on a scaled rendered heading source line', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Intro',
      '# Rendered Heading',
      'Tail',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-heading-line-1')).toBeVisible();
    await page.click('.cm-content');
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });

    await page.keyboard.press('Escape');
    await page.keyboard.press('j');

    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        number: selectedLine.number,
        offset: view.state.selection.main.head - selectedLine.from,
        text: selectedLine.text,
      };
    })).toEqual({ number: 2, offset: 0, text: '# Rendered Heading' });

    await page.keyboard.press('i');
    await page.keyboard.type('X');

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.line(2).text))
      .toBe('X# Rendered Heading');
    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        number: selectedLine.number,
        offset: view.state.selection.main.head - selectedLine.from,
      };
    })).toEqual({ number: 2, offset: 1 });
  });

  test('Vim open-line command inserts below a scaled rendered heading source line', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Intro',
      '# Rendered Heading',
      'Tail',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-heading-line-1')).toBeVisible();
    await page.click('.cm-content');
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });

    await page.keyboard.press('Escape');
    await page.keyboard.press('j');

    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        number: selectedLine.number,
        offset: view.state.selection.main.head - selectedLine.from,
        text: selectedLine.text,
      };
    })).toEqual({ number: 2, offset: 0, text: '# Rendered Heading' });

    await page.keyboard.press('o');
    await page.keyboard.type('Inserted');

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe([
        'Intro',
        '# Rendered Heading',
        'Inserted',
        'Tail',
      ].join('\n'));
    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        number: selectedLine.number,
        offset: view.state.selection.main.head - selectedLine.from,
      };
    })).toEqual({ number: 3, offset: 'Inserted'.length });
  });

  test('Vim insert command after clicking a scaled rendered heading edits the heading source line', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '# Rendered Heading',
      'Tail',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-heading-line-1')).toBeVisible();
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
      view.focus();
    });
    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    })).toBe(2);

    const renderedHeadingText = page.locator('.cm-hybrid-heading-line-1 span', { hasText: 'Rendered Heading' }).first();
    await expect(renderedHeadingText).toBeVisible();
    await renderedHeadingText.click({ position: { x: 1, y: 8 } });
    await page.keyboard.press('Escape');

    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        number: selectedLine.number,
        offset: view.state.selection.main.head - selectedLine.from,
        text: selectedLine.text,
      };
    })).toEqual({ number: 1, offset: 2, text: '# Rendered Heading' });

    await page.keyboard.press('i');
    await page.keyboard.type('X');

    await expect.poll(() => page.evaluate(() => ({
      fullText: window.__cmView.state.doc.toString(),
      selectedLineNumber: window.__cmView.state.doc.lineAt(window.__cmView.state.selection.main.head).number,
    }))).toEqual({
      fullText: '# XRendered Heading\nTail',
      selectedLineNumber: 1,
    });
  });

  test('Vim open-line command after clicking a scaled rendered heading inserts below the heading', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      '# Rendered Heading',
      'Tail',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-heading-line-1')).toBeVisible();
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
      view.focus();
    });
    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    })).toBe(2);

    const renderedHeadingText = page.locator('.cm-hybrid-heading-line-1 span', { hasText: 'Rendered Heading' }).first();
    await expect(renderedHeadingText).toBeVisible();
    await renderedHeadingText.click({ position: { x: 1, y: 8 } });
    await page.keyboard.press('Escape');

    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        number: selectedLine.number,
        offset: view.state.selection.main.head - selectedLine.from,
        text: selectedLine.text,
      };
    })).toEqual({ number: 1, offset: 2, text: '# Rendered Heading' });

    await page.keyboard.press('o');
    await page.keyboard.type('Inserted');

    await expect.poll(() => page.evaluate(() => ({
      fullText: window.__cmView.state.doc.toString(),
      selectedLineNumber: window.__cmView.state.doc.lineAt(window.__cmView.state.selection.main.head).number,
    }))).toEqual({
      fullText: '# Rendered Heading\nInserted\nTail',
      selectedLineNumber: 2,
    });
  });

  test('Vim insert command keeps the cursor on the rendered source line', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Intro',
      '[Rendered link](https://example.com)',
      'Tail',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hl-link')).toBeVisible();
    await page.click('.cm-content');
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });

    await page.keyboard.press('Escape');
    await page.keyboard.press('j');
    await page.keyboard.press('i');
    await page.keyboard.type('X');

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.line(2).text))
      .toBe('X[Rendered link](https://example.com)');
    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        number: selectedLine.number,
        offset: view.state.selection.main.head - selectedLine.from,
      };
    })).toEqual({ number: 2, offset: 1 });
  });

  test('Vim open-line command inserts below the rendered source line', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Intro',
      '[Rendered link](https://example.com)',
      'Tail',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hl-link')).toBeVisible();
    await page.click('.cm-content');
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    });

    await page.keyboard.press('Escape');
    await page.keyboard.press('j');
    await page.keyboard.press('o');
    await page.keyboard.type('Inserted');

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe([
        'Intro',
        '[Rendered link](https://example.com)',
        'Inserted',
        'Tail',
      ].join('\n'));
    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        number: selectedLine.number,
        offset: view.state.selection.main.head - selectedLine.from,
      };
    })).toEqual({ number: 3, offset: 'Inserted'.length });
  });

  test('Vim insert command keeps the cursor inside rendered fenced code content', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Intro',
      '',
      '```python',
      'value = 1',
      '```',
      '',
      'Tail',
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
    await page.keyboard.press('i');
    await page.keyboard.type('X');

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.line(4).text))
      .toBe('Xvalue = 1');
    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        number: selectedLine.number,
        offset: view.state.selection.main.head - selectedLine.from,
      };
    })).toEqual({ number: 4, offset: 1 });
  });

  test('Vim open-line command inserts below rendered fenced code content', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Intro',
      '',
      '```python',
      'value = 1',
      '```',
      '',
      'Tail',
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
    await page.keyboard.press('o');
    await page.keyboard.type('inserted = true');

    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe([
        'Intro',
        '',
        '```python',
        'value = 1',
        'inserted = true',
        '```',
        '',
        'Tail',
      ].join('\n'));
    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        number: selectedLine.number,
        offset: view.state.selection.main.head - selectedLine.from,
      };
    })).toEqual({ number: 5, offset: 'inserted = true'.length });
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

  test('Vim mode selects the opening fence when clicking the rendered fenced code block header', async ({ page }) => {
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
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        number: selectedLine.number,
        text: selectedLine.text,
      };
    })).toEqual({
      number: 3,
      text: '```python',
    });
    expect(await page.evaluate(() => window.__mockMessages?.filter(message => message.type === 'error') ?? []))
      .toEqual([]);
  });

  test('link widgets render and clicking them sends openUri messages', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = '# Note\n\nClick [the PDF link](raw/paper.pdf#page=7) here.\n';

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
    expect(openUriMessages[0].uri).toBe('raw/paper.pdf#page=7');
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
    }, '# Note\n\nClick [the PDF link](raw/paper.pdf#page=7) here.\n');

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

  test('active Markdown links separate theme label, destination, punctuation, and focus colors', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({
        type: 'setText',
        text: [
          'Read [docs](https://example.com/docs) now.',
          '',
          'Rendered [guide](https://example.com/guide).',
        ].join('\n'),
      }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(1);
      view.dispatch({ selection: { anchor: line.from + line.text.indexOf('https') } });
    });

    await expect(page.locator('.cm-active-link-label')).toHaveText('docs');
    await expect(page.locator('.cm-active-link-destination')).toHaveText('https://example.com/docs');
    await expect(page.locator('.cm-active-link-punctuation')).toHaveText(['[', '](', ')']);
    await expect(page.locator('.cm-hl-link')).toHaveText('guide');

    const palettes = [
      {
        name: 'dark',
        link: 'rgb(51, 151, 251)',
        secondary: 'rgb(161, 162, 163)',
        focus: 'rgb(71, 171, 241)',
      },
      {
        name: 'light',
        link: 'rgb(11, 81, 171)',
        secondary: 'rgb(91, 92, 93)',
        focus: 'rgb(31, 101, 191)',
      },
      {
        name: 'high contrast',
        link: 'rgb(255, 255, 0)',
        secondary: 'rgb(255, 255, 255)',
        focus: 'rgb(0, 255, 255)',
        contrast: 'rgb(255, 0, 255)',
      },
    ];

    for (const palette of palettes) {
      await page.evaluate((colors) => {
        const root = document.documentElement.style;
        root.setProperty('--vscode-textLink-foreground', colors.link);
        root.setProperty('--vscode-descriptionForeground', colors.secondary);
        root.setProperty('--vscode-focusBorder', colors.focus);
        if (colors.contrast) {
          root.setProperty('--vscode-contrastBorder', colors.contrast);
        } else {
          root.removeProperty('--vscode-contrastBorder');
        }
      }, palette);

      await expect(page.locator('.cm-active-link-label'), palette.name).toHaveCSS('color', palette.link);
      await expect(page.locator('.cm-active-link-destination'), palette.name).toHaveCSS('color', palette.secondary);
      await expect(page.locator('.cm-active-link-punctuation').first(), palette.name).toHaveCSS('color', palette.secondary);

      const renderedLink = page.locator('.cm-hl-link');
      await renderedLink.focus();
      const focusStyle = await renderedLink.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          color: style.color,
          focusVisible: element.matches(':focus-visible'),
          outlineColor: style.outlineColor,
          outlineStyle: style.outlineStyle,
        };
      });
      expect(focusStyle.color, palette.name).toBe(palette.link);
      expect(focusStyle.focusVisible, palette.name).toBe(true);
      expect(focusStyle.outlineStyle, palette.name).toBe('solid');
      expect(focusStyle.outlineColor, palette.name).toBe(palette.contrast ?? palette.focus);
    }
  });

  test('Markdown source and fenced-code colors follow semantic VS Code theme variables', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      const root = document.documentElement.style;
      root.setProperty('--vscode-editor-foreground', 'rgb(231, 232, 233)');
      root.setProperty('--vscode-descriptionForeground', 'rgb(151, 152, 153)');
      root.setProperty('--vscode-textLink-foreground', 'rgb(21, 121, 221)');
      root.setProperty('--vscode-symbolIcon-keywordForeground', 'rgb(101, 111, 121)');
      root.setProperty('--vscode-symbolIcon-stringForeground', 'rgb(131, 141, 151)');
      root.setProperty('--vscode-symbolIcon-functionForeground', 'rgb(161, 121, 131)');
      window.postMessage({
        type: 'setText',
        text: [
          'Reference [docs](https://example.com/theme).',
          '',
          '```ts',
          'const theme = getTheme("adaptive"); // note',
          '```',
        ].join('\n'),
      }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-codeblock')).toBeVisible();
    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(1);
      view.dispatch({ selection: { anchor: line.from + line.text.indexOf('https') } });
    });

    const sourceColors = await page.locator('.cm-line').filter({ hasText: 'https://example.com/theme' }).evaluate((line) => {
      const token = Array.from(line.querySelectorAll<HTMLElement>('span'))
        .find(element => element.textContent?.includes('https://example.com/theme'));
      return {
        url: token ? getComputedStyle(token).color : '',
        tokens: Array.from(line.querySelectorAll<HTMLElement>('span')).map(element => ({
          text: element.textContent ?? '',
          color: getComputedStyle(element).color,
        })),
      };
    });

    const codeColors = await page.locator('.cm-hybrid-codeblock-content-line')
      .filter({ hasText: 'const theme' })
      .evaluate((line) => {
        const colorOf = (selector: string) => {
          const token = line.querySelector<HTMLElement>(selector);
          return token ? getComputedStyle(token).color : '';
        };
        return {
          keyword: colorOf('.token.keyword'),
          string: colorOf('.token.string'),
          function: colorOf('.token.function'),
          comment: colorOf('.token.comment'),
        };
      });

    expect(sourceColors.url, JSON.stringify(sourceColors.tokens)).toBe('rgb(151, 152, 153)');
    expect(codeColors).toEqual({
      keyword: 'rgb(101, 111, 121)',
      string: 'rgb(131, 141, 151)',
      function: 'rgb(161, 121, 131)',
      comment: 'rgb(151, 152, 153)',
    });
  });

  test('Markdown callout accent text follows semantic VS Code theme variables', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      document.documentElement.style.setProperty('--vscode-charts-blue', 'rgb(71, 81, 191)');
      window.postMessage({
        type: 'setText',
        text: [
          '> [!note] Theme-aware note',
          '> Body',
          '',
          'Tail',
        ].join('\n'),
      }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(4);
      view.dispatch({ selection: { anchor: line.from } });
    });
    await expect(page.locator('.cm-hybrid-callout-title')).toBeVisible();
    await expect(page.locator('.cm-hybrid-callout-title')).toHaveCSS('color', 'rgb(71, 81, 191)');
  });

  test('active raw markdown lines render wikilinks with clean Obsidian labels', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Prelude line',
      '',
      'Keep [[FlashAttention]] and [[Online Softmax|online softmax]] visible while editing.',
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
      view.dispatch({ selection: { anchor: target.from + target.text.indexOf('visible') } });
    });

    const activeLineText = await page.locator('.cm-line').nth(2).evaluate(line => line.textContent);
    expect(activeLineText).toBe('Keep FlashAttention and online softmax visible while editing.');
    expect(activeLineText).not.toContain('[[');
    expect(activeLineText).not.toContain(']]');
    expect(activeLineText).not.toContain('|');

    await expect(page.locator('.cm-active-link-label')).toContainText(['FlashAttention', 'online softmax']);
  });

  test('active raw markdown lines reveal source for the wikilink under the cursor only', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Prelude line',
      '',
      'Keep [[FlashAttention]] and [[Online Softmax|online softmax]] visible while editing.',
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
      view.dispatch({ selection: { anchor: target.from + target.text.indexOf('FlashAttention') + 2 } });
    });

    const activeLineText = await page.locator('.cm-line').nth(2).evaluate(line => line.textContent);
    expect(activeLineText).toBe('Keep [[FlashAttention]] and online softmax visible while editing.');
    expect(activeLineText).not.toContain('[[Online Softmax|online softmax]]');
    expect(activeLineText).not.toContain('|');

    await expect(page.locator('.cm-active-link-label').first()).toHaveText('[[FlashAttention]]');
    const activeRawLinkStyles = await page.locator('.cm-active-link-label').first().evaluate((element) => {
      const parentColor = getComputedStyle(element).color;
      const childStyles = Array.from(element.querySelectorAll<HTMLElement>('*')).map(child => ({
        text: child.textContent ?? '',
        color: getComputedStyle(child).color,
        opacity: getComputedStyle(child).opacity,
      }));
      return { parentColor, childStyles };
    });
    expect(activeRawLinkStyles.childStyles.every(style => style.color === activeRawLinkStyles.parentColor)).toBe(true);
    expect(activeRawLinkStyles.childStyles.every(style => style.opacity === '1')).toBe(true);
    await expect(page.locator('.cm-active-link-label')).toContainText(['FlashAttention', 'online softmax']);
  });

  test('typing an Obsidian wikilink opener shows a note selector and inserts the selected note', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({
        type: 'setText',
        text: '# Selector Test\n\n',
        currentNotePath: 'notes/Concepts/Selector Test.md',
        notePaths: [
          'notes/Concepts/FlashAttention.md',
          'notes/Concepts/Online Softmax.md',
          'notes/Papers/FlashAttention Paper.md',
        ],
      }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.locator('.cm-content').click();
    await page.keyboard.type('[[On');

    const selector = page.locator('.cm-tooltip-autocomplete');
    await expect(selector).toBeVisible();
    await expect(selector).toContainText('Online Softmax');
    await expect(selector).not.toContainText('notes/Concepts/Online Softmax.md');

    await page.keyboard.press('Enter');

    const documentText = await page.evaluate(() => window.__cmView?.state.doc.toString());
    expect(documentText).toContain('[[Online Softmax]]');
  });

  test('Vim mode types an Obsidian wikilink opener instead of jumping sections', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({
        type: 'setText',
        text: [
          '# First',
          '',
          'Alpha beta',
          '',
          '# Second',
          '',
          'Tail line',
        ].join('\n'),
        notePaths: [
          'notes/Concepts/Alpha.md',
          'notes/Concepts/Online Softmax.md',
        ],
      }, '*');
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: line.to } });
      view.focus();
    });

    await page.keyboard.press('[');
    await page.keyboard.press('[');

    const cursor = await page.evaluate(() => {
      const view = window.__cmView;
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      return {
        text: view.state.doc.toString(),
        lineNumber: line.number,
        column: head - line.from,
        lineText: line.text,
      };
    });

    expect(cursor.lineNumber).toBe(3);
    expect(cursor.lineText).toBe('Alpha beta[[');
    expect(cursor.column).toBe('Alpha beta[['.length);
    expect(cursor.text).toContain('Alpha beta[[');
    await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
  });

  test('Vim mode starts in normal mode and requires an insert command', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text: 'Alpha beta' }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.waitForFunction(() => window.__cmView?.cm?.state?.vim);

    expect(await page.evaluate(() =>
      window.__cmView.cm.state.vim?.insertMode
    )).toBe(false);

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: 0 } });
      view.focus();
    });

    await page.keyboard.press('i');
    await page.keyboard.type('X');

    expect(await page.evaluate(() => ({
      insertMode: window.__cmView.cm.state.vim?.insertMode,
      text: window.__cmView.state.doc.toString(),
    }))).toEqual({ insertMode: true, text: 'XAlpha beta' });
  });

  test('Vim mode remains normal after clicking into the editor', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({
        type: 'setText',
        text: [
          '# First',
          '',
          'Alpha beta',
          '',
          '# Second',
          '',
          'Tail line',
        ].join('\n'),
      }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.locator('.cm-line').nth(2).click();

    expect(await page.evaluate(() =>
      window.__cmView.cm.state.vim?.insertMode
    )).toBe(false);
  });

  test('Vim mode preserves insert and normal state across host focus requests', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text: 'Alpha beta' }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.locator('.cm-content').click();
    await page.keyboard.press('i');
    await page.evaluate(() => {
      window.postMessage({ type: 'focus' }, '*');
    });
    expect(await page.evaluate(() =>
      window.__cmView.cm.state.vim?.insertMode
    )).toBe(true);

    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      window.postMessage({ type: 'focus' }, '*');
    });
    expect(await page.evaluate(() =>
      window.__cmView.cm.state.vim?.insertMode
    )).toBe(false);
  });

  test('Vim mode preserves insert and normal state across host reveal requests', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({ type: 'setText', text: 'Alpha beta' }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.locator('.cm-content').click();
    await page.evaluate(() => {
      const view = window.__cmView;
      window.postMessage({
        type: 'revealPosition',
        anchor: view.state.doc.length,
        head: view.state.doc.length,
      }, '*');
    });
    expect(await page.evaluate(() =>
      window.__cmView.cm.state.vim?.insertMode
    )).toBe(false);

    await page.keyboard.press('i');
    await page.evaluate(() => {
      window.postMessage({
        type: 'revealPosition',
        anchor: 0,
        head: 0,
      }, '*');
    });
    expect(await page.evaluate(() =>
      window.__cmView.cm.state.vim?.insertMode
    )).toBe(true);
  });

  test('Vim mode inserts on the current preview line after pressing i from normal mode', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({
        type: 'setText',
        text: [
          '# First',
          '',
          'Alpha beta',
          '',
          '# Second',
          '',
          'Tail line',
        ].join('\n'),
      }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: line.to } });
      view.focus();
    });

    await page.keyboard.press('Escape');
    await page.keyboard.press('i');
    await page.keyboard.type('whoami');

    const cursor = await page.evaluate(() => {
      const view = window.__cmView;
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      return {
        text: view.state.doc.toString(),
        lineNumber: line.number,
        column: head - line.from,
        lineText: line.text,
      };
    });

    expect(cursor.lineNumber).toBe(3);
    expect(cursor.lineText).toBe('Alpha betawhoami');
    expect(cursor.column).toBe('Alpha betawhoami'.length);
    expect(cursor.text).toContain('Alpha betawhoami');

    const caret = await page.evaluate(() => {
      const cursor = document.querySelector<HTMLElement>('.cm-cursor');
      const activeLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent === 'Alpha betawhoami');
      const cursorRect = cursor?.getBoundingClientRect();
      const activeLineRect = activeLine?.getBoundingClientRect();
      return {
        cursorTop: cursorRect?.top ?? null,
        cursorBottom: cursorRect?.bottom ?? null,
        activeLineTop: activeLineRect?.top ?? null,
        activeLineBottom: activeLineRect?.bottom ?? null,
      };
    });

    expect(caret.cursorTop).not.toBeNull();
    expect(caret.activeLineTop).not.toBeNull();
    expect(caret.cursorTop!).toBeGreaterThanOrEqual(caret.activeLineTop! - 1);
    expect(caret.cursorBottom!).toBeLessThanOrEqual(caret.activeLineBottom! + 1);
  });

  test('Vim mode keeps the caret on the paragraph after rendered Mermaid when pressing i', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({
        type: 'setText',
        text: [
          '# Diagram',
          '',
          '```mermaid',
          'sequenceDiagram',
          '  participant User',
          '  participant Agent',
          '  User->>Agent: Select paragraph',
          '  Agent-->>User: Return link',
          '```',
          '',
          'Target paragraph',
          '',
          'Tail line',
        ].join('\n'),
      }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-mermaid-block')).toBeVisible();
    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(11);
      view.dispatch({ selection: { anchor: line.to } });
      view.focus();
    });

    await page.keyboard.press('Escape');
    await page.keyboard.press('i');
    await page.keyboard.type('whoami');

    const cursor = await page.evaluate(() => {
      const view = window.__cmView;
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      return {
        text: view.state.doc.toString(),
        lineNumber: line.number,
        column: head - line.from,
        lineText: line.text,
      };
    });

    expect(cursor.lineNumber).toBe(11);
    expect(cursor.lineText).toBe('Target paragraphwhoami');
    expect(cursor.column).toBe('Target paragraphwhoami'.length);
    expect(cursor.text).toContain('Target paragraphwhoami');

    const caret = await page.evaluate(() => {
      const cursor = document.querySelector<HTMLElement>('.cm-cursor');
      const activeLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent === 'Target paragraphwhoami');
      const cursorRect = cursor?.getBoundingClientRect();
      const activeLineRect = activeLine?.getBoundingClientRect();
      return {
        cursorTop: cursorRect?.top ?? null,
        cursorBottom: cursorRect?.bottom ?? null,
        activeLineTop: activeLineRect?.top ?? null,
        activeLineBottom: activeLineRect?.bottom ?? null,
      };
    });

    expect(caret.cursorTop).not.toBeNull();
    expect(caret.activeLineTop).not.toBeNull();
    expect(caret.cursorTop!).toBeGreaterThanOrEqual(caret.activeLineTop! - 1);
    expect(caret.cursorBottom!).toBeLessThanOrEqual(caret.activeLineBottom! + 1);
  });

  test('Vim mode inserts on the clicked rendered preview line after pressing i', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({
        type: 'setText',
        text: [
          '# Diagram',
          '',
          '```mermaid',
          'sequenceDiagram',
          '  participant User',
          '  participant Agent',
          '  User->>Agent: Select paragraph',
          '  Agent-->>User: Return link',
          '```',
          '',
          'Target paragraph',
          '',
          'Tail line',
        ].join('\n'),
      }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-mermaid-block')).toBeVisible();
    await page.locator('.cm-line').filter({ hasText: 'Target paragraph' }).click();

    await page.keyboard.press('Escape');
    await page.keyboard.press('i');
    await page.keyboard.type('whoami');

    const cursor = await page.evaluate(() => {
      const view = window.__cmView;
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      return {
        text: view.state.doc.toString(),
        lineNumber: line.number,
        column: head - line.from,
        lineText: line.text,
      };
    });

    expect(cursor.lineNumber).toBe(11);
    expect(cursor.lineText).toContain('whoami');

    const caret = await page.evaluate(() => {
      const cursor = document.querySelector<HTMLElement>('.cm-cursor');
      const activeLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent?.includes('whoami'));
      const cursorRect = cursor?.getBoundingClientRect();
      const activeLineRect = activeLine?.getBoundingClientRect();
      return {
        cursorTop: cursorRect?.top ?? null,
        cursorBottom: cursorRect?.bottom ?? null,
        activeLineTop: activeLineRect?.top ?? null,
        activeLineBottom: activeLineRect?.bottom ?? null,
      };
    });

    expect(caret.cursorTop).not.toBeNull();
    expect(caret.activeLineTop).not.toBeNull();
    expect(caret.cursorTop!).toBeGreaterThanOrEqual(caret.activeLineTop! - 1);
    expect(caret.cursorBottom!).toBeLessThanOrEqual(caret.activeLineBottom! + 1);
  });

  test('Vim mode inserts on the clicked rendered code line after pressing i', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({
        type: 'setText',
        text: [
          'Intro',
          '',
          '```python',
          'value = 1',
          '```',
          '',
          'Outro',
        ].join('\n'),
      }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-codeblock')).toBeVisible();
    await page.locator('.cm-hybrid-codeblock-content-line').filter({ hasText: 'value = 1' }).click();

    await page.keyboard.press('Escape');
    await page.keyboard.press('i');
    await page.keyboard.type('whoami');

    const cursor = await page.evaluate(() => {
      const view = window.__cmView;
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      return {
        text: view.state.doc.toString(),
        lineNumber: line.number,
        column: head - line.from,
        lineText: line.text,
      };
    });

    expect(cursor.lineNumber).toBe(4);
    expect(cursor.lineText).toContain('whoami');

    const caret = await page.evaluate(() => {
      const cursor = document.querySelector<HTMLElement>('.cm-cursor');
      const activeLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent?.includes('whoami'));
      const cursorRect = cursor?.getBoundingClientRect();
      const activeLineRect = activeLine?.getBoundingClientRect();
      return {
        cursorTop: cursorRect?.top ?? null,
        cursorBottom: cursorRect?.bottom ?? null,
        activeLineTop: activeLineRect?.top ?? null,
        activeLineBottom: activeLineRect?.bottom ?? null,
      };
    });

    expect(caret.cursorTop).not.toBeNull();
    expect(caret.activeLineTop).not.toBeNull();
    expect(caret.cursorTop!).toBeGreaterThanOrEqual(caret.activeLineTop! - 1);
    expect(caret.cursorBottom!).toBeLessThanOrEqual(caret.activeLineBottom! + 1);
  });

  test('Vim mode inserts inside a clicked rendered wikilink line after pressing i', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.postMessage({
        type: 'setText',
        text: [
          '# Diagram',
          '',
          '```mermaid',
          'sequenceDiagram',
          '  participant User',
          '  participant Agent',
          '  User->>Agent: Select paragraph',
          '  Agent-->>User: Return link',
          '```',
          '',
          'Without online softmax, the attention tiling would need to synchronize across all tiles.',
          '',
          'Related: [[CUDA Shared Memory]] explains how this maps to GPU hardware.',
          '',
          'Tail line',
        ].join('\n'),
        notePaths: [
          'notes/Concepts/CUDA Shared Memory.md',
        ],
      }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-mermaid-block')).toBeVisible();
    await page.locator('.cm-line').filter({ hasText: 'CUDA Shared Memory' }).click();

    await page.keyboard.press('Escape');
    await page.keyboard.press('i');
    await page.keyboard.type('whoami');

    const cursor = await page.evaluate(() => {
      const view = window.__cmView;
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      return {
        text: view.state.doc.toString(),
        lineNumber: line.number,
        column: head - line.from,
        lineText: line.text,
      };
    });

    expect(cursor.lineNumber).toBe(13);
    expect(cursor.lineText).toContain('whoami');

    const caret = await page.evaluate(() => {
      const cursor = document.querySelector<HTMLElement>('.cm-cursor');
      const activeLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent?.includes('whoami'));
      const cursorRect = cursor?.getBoundingClientRect();
      const activeLineRect = activeLine?.getBoundingClientRect();
      return {
        cursorTop: cursorRect?.top ?? null,
        cursorBottom: cursorRect?.bottom ?? null,
        activeLineTop: activeLineRect?.top ?? null,
        activeLineBottom: activeLineRect?.bottom ?? null,
      };
    });

    expect(caret.cursorTop).not.toBeNull();
    expect(caret.activeLineTop).not.toBeNull();
    expect(caret.cursorTop!).toBeGreaterThanOrEqual(caret.activeLineTop! - 1);
    expect(caret.cursorBottom!).toBeLessThanOrEqual(caret.activeLineBottom! + 1);
  });

  test('host text refreshes preserve the current cursor line and column', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({
        type: 'setText',
        text: [
          '# First',
          '',
          'Alpha beta',
          '',
          '# Second',
          '',
          'Tail line',
        ].join('\n'),
      }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: line.from + 'Alpha'.length } });
      window.postMessage({
        type: 'setText',
        text: [
          '# First changed externally',
          '',
          'Alpha beta',
          '',
          '# Second',
          '',
          'Tail line',
        ].join('\n'),
      }, '*');
    });

    await page.waitForFunction(() => window.__cmView?.state.doc.line(1).text === '# First changed externally');

    const cursor = await page.evaluate(() => {
      const view = window.__cmView;
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      return {
        lineNumber: line.number,
        column: head - line.from,
        lineText: line.text,
      };
    });

    expect(cursor.lineNumber).toBe(3);
    expect(cursor.lineText).toBe('Alpha beta');
    expect(cursor.column).toBe('Alpha'.length);
  });

  test('Vim mode types markdown list markers instead of moving the cursor up', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({
        type: 'setText',
        text: [
          '# First',
          '',
          'Alpha beta',
          '',
          '# Second',
          '',
          'Tail line',
        ].join('\n'),
      }, '*');
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
    });

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: line.to } });
      view.focus();
    });

    await page.keyboard.press('-');
    await page.keyboard.press('Space');

    const cursor = await page.evaluate(() => {
      const view = window.__cmView;
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      return {
        text: view.state.doc.toString(),
        lineNumber: line.number,
        column: head - line.from,
        lineText: line.text,
      };
    });

    expect(cursor.lineNumber).toBe(3);
    expect(cursor.lineText).toBe('Alpha beta- ');
    expect(cursor.column).toBe('Alpha beta- '.length);
    expect(cursor.text).toContain('Alpha beta- ');
  });

  test('Control+O does not transiently edit the document from insert mode', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const baseDoc = [
      '# First',
      '',
      'Alpha beta',
      '',
      '# Second',
      '',
      'Tail line',
    ].join('\n');

    for (const vimEnabled of [false, true]) {
      await page.evaluate(({ text, enabled }) => {
        window.postMessage({ type: 'setText', text }, '*');
        window.postMessage({ type: 'setVimMode', enabled }, '*');
      }, { text: baseDoc, enabled: vimEnabled });

      await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
      await page.evaluate(() => {
        const view = window.__cmView;
        const line = view.state.doc.line(3);
        view.dispatch({ selection: { anchor: line.to } });
        window.__mockMessages = [];
        view.focus();
      });

      await page.keyboard.press('Control+O');
      await page.waitForTimeout(200);

      const state = await page.evaluate(() => {
        const view = window.__cmView;
        const head = view.state.selection.main.head;
        const line = view.state.doc.lineAt(head);
        return {
          text: view.state.doc.toString(),
          lineNumber: line.number,
          column: head - line.from,
          lineText: line.text,
          editMessages: window.__mockMessages?.filter((message) => message.type === 'edit') ?? [],
        };
      });

      expect(state.text, `vim=${vimEnabled}`).toBe(baseDoc);
      expect(state.lineNumber, `vim=${vimEnabled}`).toBe(3);
      expect(state.lineText, `vim=${vimEnabled}`).toBe('Alpha beta');
      expect(state.column, `vim=${vimEnabled}`).toBe('Alpha beta'.length);
      expect(state.editMessages, `vim=${vimEnabled}`).toEqual([]);
    }
  });

  test('Vim mode keeps ordinary typed keys literal after Control+O from insert mode', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const baseDoc = [
      '# First',
      '',
      'Alpha beta',
      '',
      'Tail line',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, notePaths: [] }, '*');
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
      window.__mockMessages = [];
    }, baseDoc);
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    for (const key of ['i', 'o', 'd']) {
      await page.evaluate((text) => {
        window.postMessage({ type: 'setText', text, notePaths: [] }, '*');
        window.__mockMessages = [];
      }, baseDoc);
      await page.waitForFunction(() => window.__cmView?.state.doc.toString() === '# First\n\nAlpha beta\n\nTail line');
      await page.evaluate(() => {
        const view = window.__cmView;
        const line = view.state.doc.line(3);
        view.dispatch({ selection: { anchor: line.to } });
        view.focus();
      });

      await page.keyboard.press('Escape');
      await page.keyboard.press('a');
      await page.keyboard.press('Control+O');
      await page.keyboard.press(key);
      await page.waitForTimeout(100);

      const state = await page.evaluate(() => {
        const view = window.__cmView;
        const head = view.state.selection.main.head;
        const line = view.state.doc.lineAt(head);
        return {
          text: view.state.doc.toString(),
          lineNumber: line.number,
          column: head - line.from,
          lineText: line.text,
          editMessages: window.__mockMessages?.filter((message) => message.type === 'edit') ?? [],
        };
      });
      const expectedText = baseDoc.replace('Alpha beta', `Alpha beta${key}`);

      expect(state.text, key).toBe(expectedText);
      expect(state.lineNumber, key).toBe(3);
      expect(state.lineText, key).toBe(`Alpha beta${key}`);
      expect(state.column, key).toBe(`Alpha beta${key}`.length);
      expect(state.editMessages.map(message => message.text), key).toEqual([expectedText]);
    }
  });

  test('markdown editor supports a scratch-note human workflow with preview toggles and cursor movement', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const consoleErrors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => {
      consoleErrors.push(`PageError: ${error.message}`);
    });

    await page.evaluate(() => {
      window.postMessage({
        type: 'setText',
        text: '',
        currentNotePath: 'notes/Scratch Production Note.md',
        notePaths: [
          'notes/Concepts/FlashAttention.md',
          'notes/Concepts/Online Softmax.md',
        ],
      }, '*');
      window.postMessage({ type: 'setVimMode', enabled: false }, '*');
      window.__mockMessages = [];
    });
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    const expectedDoc = [
      '# Scratch Production Note',
      '',
      'Today I tested [[FlashAttention]] with [paper](raw/pdf/flash-attention.pdf#page=7&anchor=anc).',
      '',
      '- [ ] draft input',
      '- [x] check cursor stability',
      '',
      '| Operation | Result |',
      '| --- | --- |',
      '| Ctrl+O | stable |',
      '| Table preview | matches Obsidian |',
      '',
      '```python',
      'print("hello")',
      '```',
      '',
      '> [!note] Summary',
      '> Keep `m` and **d** stable.',
      'Final line.',
    ].join('\n');

    await page.locator('.cm-content').click();
    await page.keyboard.type('# Scratch Production Note', { delay: 1 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Today I tested [[FlashAttention]] with [paper](raw/pdf/flash-attention.pdf#page=7&anchor=anc).', { delay: 1 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- [ ] draft input', { delay: 1 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('check cursor stability', { delay: 1 });
    await page.keyboard.press(`${modifier}+L`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('| Operation | Result |', { delay: 1 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('| --- | --- |', { delay: 1 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('| Ctrl+O | stable |', { delay: 1 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('| Table preview | matches Obsidian |', { delay: 1 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('```python', { delay: 1 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('print("hello")', { delay: 1 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('```', { delay: 1 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('> [!note] Summary', { delay: 1 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('Keep `m` and **d** stable.', { delay: 1 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Final line.', { delay: 1 });

    await expect.poll(() => page.evaluate(() => window.__cmView?.state.doc.toString())).toBe(expectedDoc);
    await page.keyboard.press(`${modifier}+Home`);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.press('Control+O');
    await page.waitForTimeout(100);
    await expect.poll(() => page.evaluate(() => window.__cmView?.state.doc.toString())).toBe(expectedDoc);

    await page.keyboard.press(`${modifier}+E`);
    await expect(page.locator('.cm-hl-link').filter({ hasText: 'FlashAttention' })).toHaveCount(0);
    await page.keyboard.press(`${modifier}+E`);

    await page.evaluate(() => {
      const view = window.__cmView;
      const lastLine = view.state.doc.line(view.state.doc.lines);
      view.dispatch({ selection: { anchor: lastLine.from } });
      view.focus();
    });

    await expect(page.locator('.cm-hl-link').filter({ hasText: 'FlashAttention' })).toBeVisible();
    await expect(page.locator('.cm-hybrid-table')).toBeVisible();
    await expect(page.locator('.cm-hybrid-codeblock')).toBeVisible();
    await expect(page.locator('.cm-hybrid-callout')).toBeVisible();

    await page.locator('.cm-hybrid-table td')
      .filter({ hasText: 'matches Obsidian' })
      .click({ position: { x: 2, y: 2 } });
    await expect(page.locator('.cm-hybrid-table-widget')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toContainText('| Table preview | matches Obsidian |');

    const finalState = await page.evaluate(() => {
      const view = window.__cmView;
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      return {
        text: view.state.doc.toString(),
        lineNumber: line.number,
        lineText: line.text,
        editMessages: window.__mockMessages?.filter((message) => message.type === 'edit') ?? [],
      };
    });

    expect(finalState.text).toBe(expectedDoc);
    expect(finalState.lineNumber).toBe(11);
    expect(finalState.lineText).toBe('| Table preview | matches Obsidian |');
    expect(finalState.editMessages.at(-1)?.text).toBe(expectedDoc);
    expect(consoleErrors).toEqual([]);
  });

  test('Vim mode fuzzes markdown-like input without moving the cursor off the target line', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const baseDoc = [
      '# First',
      '',
      'Alpha beta',
      '',
      '# Second',
      '',
      'Tail line',
    ].join('\n');
    const explicitSequences: string[][] = [
      ['d', 'd'],
      ['-', 'Space'],
      ['[', '[', 'O', 'n'],
      ['i', 'w', 'h', 'o', 'a', 'm', 'i'],
      ['-', 'Space', '[', '[', 'x', ']', ']'],
    ];
    const fuzzKeys = ['d', 'i', 'w', 'h', 'o', 'a', 'm', '-', 'Space', '[', ']', 'x', '1'];
    const generatedSequences = Array.from({ length: 12 }, (_value, caseIndex) => {
      let state = caseIndex + 17;
      const length = 4 + (caseIndex % 7);
      return Array.from({ length }, () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return fuzzKeys[state % fuzzKeys.length]!;
      });
    });
    const sequences = [...explicitSequences, ...generatedSequences];
    const keyText = (key: string) => key === 'Space' ? ' ' : key;

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, notePaths: [] }, '*');
      window.postMessage({ type: 'setVimMode', enabled: true }, '*');
    }, baseDoc);
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    for (const [caseIndex, sequence] of sequences.entries()) {
      await page.evaluate((text) => {
        window.postMessage({ type: 'setText', text, notePaths: [] }, '*');
      }, caseIndex % 3 === 0
        ? baseDoc.replace('# First', `# First external refresh ${caseIndex}`)
        : baseDoc);
      await page.waitForFunction(() => window.__cmView?.state.doc.line(3).text === 'Alpha beta');
      await page.evaluate(() => {
        const view = window.__cmView;
        const line = view.state.doc.line(3);
        view.dispatch({ selection: { anchor: line.to } });
        view.focus();
      });

      await page.keyboard.press('Escape');
      await page.keyboard.press('a');
      for (const key of sequence) {
        await page.keyboard.press(key);
      }

      const expectedInsertedText = sequence.map(keyText).join('');
      const cursor = await page.evaluate(() => {
        const view = window.__cmView;
        const head = view.state.selection.main.head;
        const line = view.state.doc.lineAt(head);
        return {
          lineNumber: line.number,
          column: head - line.from,
          lineText: line.text,
        };
      });

      expect(cursor.lineNumber, `case ${caseIndex}: ${sequence.join(' ')}`).toBe(3);
      expect(cursor.lineText, `case ${caseIndex}: ${sequence.join(' ')}`).toBe(`Alpha beta${expectedInsertedText}`);
      expect(cursor.column, `case ${caseIndex}: ${sequence.join(' ')}`).toBe(`Alpha beta${expectedInsertedText}`.length);
    }
  });

  test('markdown editor fuzzes mixed input methods without cursor or document corruption', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const baseDoc = [
      '# Mixed Input Fuzz',
      '',
      'Alpha beta',
      '',
      '| Key | Value |',
      '| --- | --- |',
      '| row | target |',
      '',
      'Tail [[FlashAttention]]',
    ].join('\n');
    type FuzzOperation =
      | { kind: 'press'; key: string; text: string }
      | { kind: 'type'; text: string }
      | { kind: 'paste'; text: string }
      | { kind: 'hostInsert'; text: string }
      | { kind: 'move'; key: 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End' }
      | { kind: 'backspace' }
      | { kind: 'delete' }
      | { kind: 'replace'; needle: string; text: string }
      | { kind: 'ctrlO' };
    const cases: FuzzOperation[][] = [
      [
        { kind: 'press', key: 'i', text: 'i' },
        { kind: 'press', key: 'o', text: 'o' },
        { kind: 'press', key: 'd', text: 'd' },
        { kind: 'move', key: 'ArrowLeft' },
        { kind: 'press', key: '[', text: '[' },
        { kind: 'press', key: '[', text: '[' },
        { kind: 'type', text: 'Wiki' },
        { kind: 'press', key: ']', text: ']' },
        { kind: 'press', key: ']', text: ']' },
        { kind: 'ctrlO' },
        { kind: 'press', key: 'o', text: 'o' },
      ],
      [
        { kind: 'type', text: ' quick' },
        { kind: 'move', key: 'ArrowLeft' },
        { kind: 'move', key: 'ArrowLeft' },
        { kind: 'press', key: '-', text: '-' },
        { kind: 'press', key: 'Space', text: ' ' },
        { kind: 'press', key: 'i', text: 'i' },
        { kind: 'press', key: 'o', text: 'o' },
        { kind: 'move', key: 'End' },
        { kind: 'paste', text: ' pasted[[FlashAttention]]' },
        { kind: 'hostInsert', text: ' host' },
      ],
      [
        { kind: 'replace', needle: 'beta', text: 'BETA' },
        { kind: 'ctrlO' },
        { kind: 'press', key: 'i', text: 'i' },
        { kind: 'move', key: 'Home' },
        { kind: 'type', text: 'Start ' },
        { kind: 'move', key: 'End' },
        { kind: 'backspace' },
        { kind: 'delete' },
        { kind: 'type', text: '!' },
      ],
    ];
    const insertAt = (source: string, column: number, text: string) => (
      source.slice(0, column) + text + source.slice(column)
    );
    const lineAtPosition = (source: string, position: number) => {
      let lineNumber = 1;
      let from = 0;
      while (from <= source.length) {
        const newline = source.indexOf('\n', from);
        const to = newline === -1 ? source.length : newline;
        if (position <= to || newline === -1) {
          return {
            number: lineNumber,
            from,
            to,
            text: source.slice(from, to),
          };
        }
        lineNumber++;
        from = newline + 1;
      }
      return {
        number: lineNumber,
        from: source.length,
        to: source.length,
        text: '',
      };
    };
    const lineStartOffset = (source: string, lineNumber: number) => {
      let from = 0;
      for (let number = 1; number < lineNumber; number++) {
        const newline = source.indexOf('\n', from);
        if (newline === -1) return source.length;
        from = newline + 1;
      }
      return from;
    };

    await page.waitForSelector('body');
    for (const vimEnabled of [false, true]) {
      for (const [caseIndex, operations] of cases.entries()) {
        let expectedDoc = baseDoc;
        let expectedHead = lineStartOffset(expectedDoc, 3) + 'Alpha beta'.length;
        await page.evaluate(({ text, enabled }) => {
          window.postMessage({
            type: 'setText',
            text,
            notePaths: ['notes/Concepts/FlashAttention.md'],
          }, '*');
          window.postMessage({ type: 'setVimMode', enabled }, '*');
          window.__mockMessages = [];
        }, { text: baseDoc, enabled: vimEnabled });
        await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
        await page.waitForFunction(() => window.__cmView?.state.doc.line(3).text === 'Alpha beta');
        await page.evaluate(() => {
          const view = window.__cmView;
          const line = view.state.doc.line(3);
          view.dispatch({ selection: { anchor: line.to } });
          view.focus();
        });
        if (vimEnabled) {
          await page.keyboard.press('Escape');
          await page.keyboard.press('a');
        }

        for (const [operationIndex, operation] of operations.entries()) {
          const label = `vim=${vimEnabled} case=${caseIndex} op=${operationIndex} ${operation.kind}`;
          if (operation.kind === 'press') {
            await page.keyboard.press(operation.key);
            expectedDoc = insertAt(expectedDoc, expectedHead, operation.text);
            expectedHead += operation.text.length;
          } else if (operation.kind === 'type') {
            await page.keyboard.type(operation.text, { delay: 1 });
            expectedDoc = insertAt(expectedDoc, expectedHead, operation.text);
            expectedHead += operation.text.length;
          } else if (operation.kind === 'paste') {
            await page.locator('.cm-content').evaluate((element, text) => {
              const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
              Object.defineProperty(event, 'clipboardData', {
                value: {
                  getData: (type: string) => type === 'text/plain' ? text : '',
                },
              });
              element.dispatchEvent(event);
            }, operation.text);
            expectedDoc = insertAt(expectedDoc, expectedHead, operation.text);
            expectedHead += operation.text.length;
          } else if (operation.kind === 'hostInsert') {
            await page.evaluate((text) => {
              window.postMessage({ type: 'insertText', text }, '*');
            }, operation.text);
            expectedDoc = insertAt(expectedDoc, expectedHead, operation.text);
            expectedHead += operation.text.length;
          } else if (operation.kind === 'move') {
            await page.keyboard.press(operation.key);
            const line = lineAtPosition(expectedDoc, expectedHead);
            if (operation.key === 'ArrowLeft') expectedHead = Math.max(0, expectedHead - 1);
            if (operation.key === 'ArrowRight') expectedHead = Math.min(expectedDoc.length, expectedHead + 1);
            if (operation.key === 'Home') expectedHead = line.from;
            if (operation.key === 'End') expectedHead = line.to;
          } else if (operation.kind === 'backspace') {
            await page.keyboard.press('Backspace');
            if (expectedHead > 0) {
              expectedDoc = expectedDoc.slice(0, expectedHead - 1) + expectedDoc.slice(expectedHead);
              expectedHead--;
            }
          } else if (operation.kind === 'delete') {
            await page.keyboard.press('Delete');
            if (expectedHead < expectedDoc.length) {
              expectedDoc = expectedDoc.slice(0, expectedHead) + expectedDoc.slice(expectedHead + 1);
            }
          } else if (operation.kind === 'replace') {
            const line = lineAtPosition(expectedDoc, expectedHead);
            const fromColumn = line.text.indexOf(operation.needle);
            expect(fromColumn, label).toBeGreaterThanOrEqual(0);
            await page.evaluate(({ lineNumber, fromColumn, length }) => {
              const view = window.__cmView;
              const line = view.state.doc.line(lineNumber);
              view.dispatch({
                selection: {
                  anchor: line.from + fromColumn,
                  head: line.from + fromColumn + length,
                },
              });
              view.focus();
            }, { lineNumber: line.number, fromColumn, length: operation.needle.length });
            await page.keyboard.type(operation.text, { delay: 1 });
            const absoluteFrom = line.from + fromColumn;
            expectedDoc = expectedDoc.slice(0, absoluteFrom) + operation.text + expectedDoc.slice(absoluteFrom + operation.needle.length);
            expectedHead = absoluteFrom + operation.text.length;
          } else {
            await page.keyboard.press('Control+O');
          }

          const expectedLine = lineAtPosition(expectedDoc, expectedHead);
          await expect.poll(async () => page.evaluate(() => {
            const view = window.__cmView;
            const head = view.state.selection.main.head;
            const line = view.state.doc.lineAt(head);
            return {
              fullText: view.state.doc.toString(),
              lineNumber: line.number,
              lineText: line.text,
              column: head - line.from,
            };
          }), { message: label }).toEqual({
            fullText: expectedDoc,
            lineNumber: expectedLine.number,
            lineText: expectedLine.text,
            column: expectedHead - expectedLine.from,
          });
        }
      }
    }
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

  test('active markdown reveals only the caret token delimiters like Obsidian live preview', async ({ page }) => {
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

    await expect(page.locator('.cm-active-bold')).toContainText(['bold']);
    await expect(page.locator('.cm-hybrid-italic')).toContainText(['italic']);
    await expect(page.locator('.cm-hybrid-strikethrough')).toContainText(['strike']);
    await expect(page.locator('.cm-hybrid-highlight')).toContainText(['highlight']);
    await expect(page.locator('.cm-hybrid-inline-code')).toContainText(['code']);

    const activeLineText = await page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent?.includes('Mix'))?.textContent ?? '';
    });
    expect(activeLineText).toBe('Mix **bold**, italic, strike, highlight, and code while editing.');

    const styles = await page.evaluate(() => {
      const bold = getComputedStyle(document.querySelector('.cm-active-bold'));
      const italic = getComputedStyle(document.querySelector('.cm-hybrid-italic'));
      const strike = getComputedStyle(document.querySelector('.cm-hybrid-strikethrough'));
      const highlight = getComputedStyle(document.querySelector('.cm-hybrid-highlight'));
      const code = getComputedStyle(document.querySelector('.cm-hybrid-inline-code'));
      return {
        italicTexts: Array.from(document.querySelectorAll('.cm-hybrid-italic')).map(element => element.textContent),
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
        italicTexts: Array.from(
          activeLine?.querySelectorAll<HTMLElement>('.cm-active-italic, .cm-hybrid-italic') ?? [],
        )
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

    await expect(page.locator('.cm-active-tag, .cm-hybrid-tag'))
      .toContainText(['#flash-attention', '#gpu/memory']);
    await expect(page.locator('.cm-active-tag')).toHaveText('#flash-attention');
    await expect(page.locator('.cm-hybrid-tag')).toHaveText('#gpu/memory');

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

  test('hybrid rendering shows readable errors for invalid display math', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const doc = [
      'Before math',
      '',
      '$$',
      '\\\\frac{a}{b} = \\\\frac{c}{d',
      '$$',
      '',
      'After math',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    const error = page.locator('.cm-hybrid-math-error').first();
    await expect(error).toBeVisible();
    await expect(error.locator('.cm-hybrid-math-error-title')).toHaveText('Invalid TeX');
    await expect(error.locator('.cm-hybrid-math-error-message')).not.toHaveText('');
    await expect(error.locator('.cm-hybrid-math-error-source')).toContainText('\\\\frac{c}{d');

    const layout = await error.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        height: rect.height,
        backgroundColor: style.backgroundColor,
        borderTopColor: style.borderTopColor,
        color: style.color,
      };
    });

    expect(layout.height).toBeGreaterThan(28);
    expect(layout.height).toBeLessThan(160);
    expect(layout.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(layout.borderTopColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(layout.color).not.toBe('rgb(0, 0, 0)');
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
    await page.evaluate(() => {
      document.documentElement.style.setProperty(
        '--vscode-symbolIcon-operatorForeground',
        'rgb(121, 131, 141)',
      );
      document.documentElement.style.setProperty(
        '--vscode-symbolIcon-variableForeground',
        'rgb(151, 161, 171)',
      );
    });

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
    expect(activeMathStyles.sourceColor).toBe('rgb(151, 161, 171)');
    expect(activeMathStyles.delimiterColor).toBe('rgb(121, 131, 141)');
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

  test('code block copy keeps feedback outside the button in an accessible rounded tooltip without shifting layout', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--vscode-editorHoverWidget-background', '#313233');
      document.documentElement.style.setProperty('--vscode-editorHoverWidget-foreground', '#fafafa');
      document.documentElement.style.setProperty('--vscode-editorHoverWidget-border', '#555657');
      window.postMessage({
        type: 'setText',
        text: ['```ts', 'const answer = 42;', '```', '', 'After'].join('\n'),
      }, '*');
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

    const header = page.locator('.cm-hybrid-codeblock-header');
    const copyButton = page.locator('.cm-hybrid-codeblock-copy');
    const tooltip = page.locator('.cm-hybrid-codeblock-copy-tooltip');
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(5).from } });
    });
    await expect(copyButton).toBeVisible();
    const headerBefore = await header.boundingBox();
    await copyButton.click();

    await expect.poll(() => page.evaluate(() => window.__copiedText))
      .toBe('const answer = 42;');
    await expect(tooltip).toHaveText('Copied');
    await expect(tooltip).toHaveAttribute('role', 'status');
    await expect(tooltip).toHaveAttribute('aria-live', 'polite');
    await expect(tooltip).toHaveAttribute('aria-atomic', 'true');
    await expect(copyButton).toHaveAttribute('aria-label', 'Copy code');
    await expect(copyButton).toHaveAttribute('title', 'Copy code');
    await expect(copyButton).toHaveAccessibleName('Copy code');
    await expect(copyButton).toHaveClass(/is-copied/);

    const feedback = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>('.cm-hybrid-codeblock-header')!;
      const button = document.querySelector<HTMLElement>('.cm-hybrid-codeblock-copy')!;
      const tooltip = document.querySelector<HTMLElement>('.cm-hybrid-codeblock-copy-tooltip')!;
      const buttonRect = button.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const style = getComputedStyle(tooltip);
      const headerStyle = getComputedStyle(header);
      return {
        isHeaderChild: tooltip.parentElement === header,
        isButtonDescendant: button.contains(tooltip),
        tooltipBottom: tooltipRect.bottom,
        buttonTop: buttonRect.top,
        background: style.backgroundColor,
        foreground: style.color,
        border: style.borderColor,
        headerTopLeftRadius: headerStyle.borderTopLeftRadius,
        headerTopRightRadius: headerStyle.borderTopRightRadius,
      };
    });
    // Catches an AX-tree regression where the live status is flattened into "Copy code".
    expect(feedback.isHeaderChild).toBe(true);
    expect(feedback.isButtonDescendant).toBe(false);
    expect(feedback.tooltipBottom).toBeLessThanOrEqual(feedback.buttonTop);
    expect(feedback.background).toBe('rgb(49, 50, 51)');
    expect(feedback.foreground).toBe('rgb(250, 250, 250)');
    expect(feedback.border).toBe('rgb(85, 86, 87)');
    // Catches the header background painting square corners through its rounded container.
    expect(feedback.headerTopLeftRadius).toBe('4px');
    expect(feedback.headerTopRightRadius).toBe('4px');
    expect(await header.boundingBox()).toEqual(headerBefore);

    await copyButton.click();
    await page.waitForTimeout(700);
    await copyButton.click();
    await page.waitForTimeout(700);
    await expect(tooltip).toHaveText('Copied');
    await expect(copyButton).toHaveClass(/is-copied/);
    await expect(tooltip).toHaveText('', { timeout: 2_000 });
    // Catches hiding the empty live region with visibility:hidden, which removes it from AX.
    await expect(tooltip).toBeAttached();
    await expect(page.getByRole('status')).toHaveCount(1);

    await page.evaluate(() => {
      window.__mockMessages = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: undefined,
      });
    });
    await copyButton.click();
    await expect.poll(() => page.evaluate(() => (
      window.__mockMessages?.filter(message => message.type === 'copyText').at(-1)?.text
    ))).toBe('const answer = 42;');
    await expect(tooltip).toHaveText('Copied');
  });

  test('code block copy feedback respects reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);
    await page.evaluate(() => {
      window.postMessage({
        type: 'setText',
        text: ['```text', 'bounded feedback', '```', '', 'After'].join('\n'),
      }, '*');
    });
    const copyButton = page.locator('.cm-hybrid-codeblock-copy');
    const tooltip = page.locator('.cm-hybrid-codeblock-copy-tooltip');
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(5).from } });
    });
    await copyButton.click();
    await expect(tooltip).toHaveText('Copied');
    const motion = await tooltip.evaluate(element => {
      const style = getComputedStyle(element);
      return {
        transitionDuration: style.transitionDuration,
        transform: style.transform,
      };
    });
    expect(motion.transitionDuration.split(',').every(value => value.trim() === '0s')).toBe(true);
    expect(motion.transform).toBe('none');
    await expect(tooltip).toHaveText('', { timeout: 1_500 });
  });

  test('hybrid rendering turns fenced code blocks into Obsidian-like preview blocks until the block is active', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--vscode-descriptionForeground', '#808080');
      document.documentElement.style.setProperty('--vscode-textCodeBlock-background', '#252526');
    });

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
    const codeTheme = await page.evaluate(() => {
      const rootStyle = getComputedStyle(document.documentElement);
      const codeBlock = document.querySelector<HTMLElement>('.cm-hybrid-codeblock-inner');
      const codeLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-hybrid-codeblock-content-line'))
        .find(line => line.textContent?.includes('const greet'));
      const consoleLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-hybrid-codeblock-content-line'))
        .find(line => line.textContent?.includes('console.log'));
      const nativeHighlightProbeStyle = document.createElement('style');
      nativeHighlightProbeStyle.textContent = '.cm-native-highlight-color-probe { color: rgb(119, 0, 136); }';
      document.head.appendChild(nativeHighlightProbeStyle);
      const tokenColors = (
        root: HTMLElement | undefined,
        selector: string,
      ): { outer: string; painted: string } => {
        const token = root?.querySelector<HTMLElement>(selector);
        if (!token || !root) return { outer: '', painted: '' };
        const probe = token.cloneNode(false) as HTMLElement;
        const nativeHighlight = document.createElement('span');
        nativeHighlight.className = 'cm-native-highlight-color-probe';
        nativeHighlight.textContent = token.textContent;
        probe.appendChild(nativeHighlight);
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        root.appendChild(probe);
        const colors = {
          outer: getComputedStyle(probe).color,
          painted: getComputedStyle(nativeHighlight).color,
        };
        probe.remove();
        return colors;
      };
      const keywordColors = tokenColors(codeLine, '.cm-hybrid-prism-token.token.keyword');
      const functionColors = tokenColors(codeLine, '.cm-hybrid-prism-token.token.function');
      const typeColors = tokenColors(codeLine, '.cm-hybrid-prism-token.token.builtin');
      const punctuationColors = tokenColors(codeLine, '.cm-hybrid-prism-token.token.punctuation');
      const stringColors = tokenColors(consoleLine, '.cm-hybrid-prism-token.token.string');
      const plainNativeHighlight = document.createElement('span');
      plainNativeHighlight.className = 'cm-native-highlight-color-probe';
      plainNativeHighlight.textContent = 'name';
      plainNativeHighlight.style.position = 'absolute';
      plainNativeHighlight.style.visibility = 'hidden';
      codeLine?.appendChild(plainNativeHighlight);
      const plainIdentifierColor = getComputedStyle(plainNativeHighlight).color;
      plainNativeHighlight.remove();
      nativeHighlightProbeStyle.remove();
      return {
        editorBackground: rootStyle.getPropertyValue('--vscode-editor-background').trim(),
        codeBlockBackground: rootStyle.getPropertyValue('--vscode-textCodeBlock-background').trim(),
        lineBackground: codeLine ? getComputedStyle(codeLine).backgroundColor : '',
        surfaceBackground: codeBlock ? getComputedStyle(codeBlock).backgroundColor : '',
        lineColor: codeLine ? getComputedStyle(codeLine).color : '',
        dimDescriptionColor: rootStyle.getPropertyValue('--vscode-descriptionForeground').trim(),
        keywordOuterColor: keywordColors.outer,
        keywordColor: keywordColors.painted,
        functionOuterColor: functionColors.outer,
        functionColor: functionColors.painted,
        typeOuterColor: typeColors.outer,
        typeColor: typeColors.painted,
        punctuationOuterColor: punctuationColors.outer,
        punctuationColor: punctuationColors.painted,
        stringOuterColor: stringColors.outer,
        stringColor: stringColors.painted,
        plainIdentifierColor,
      };
    });
    expect(codeTheme.codeBlockBackground).toBe('#252526');
    expect(codeTheme.surfaceBackground).toBe('rgb(37, 37, 38)');
    expect(codeTheme.lineBackground).toBe(codeTheme.surfaceBackground);
    expect(codeTheme.surfaceBackground).not.toBe('rgb(30, 30, 30)');
    expect(codeTheme.keywordColor).toBe('rgb(86, 156, 214)');
    expect(codeTheme.functionColor).toBe('rgb(220, 220, 170)');
    expect(codeTheme.typeColor).toBe('rgb(78, 201, 176)');
    expect(codeTheme.stringColor).toBe('rgb(206, 145, 120)');
    expect(codeTheme.punctuationColor).toBe('rgb(128, 128, 128)');
    expect(codeTheme.punctuationColor).not.toBe(codeTheme.lineColor);
    expect(codeTheme.plainIdentifierColor).toBe(codeTheme.lineColor);
    expect(codeTheme.keywordColor).toBe(codeTheme.keywordOuterColor);
    expect(codeTheme.functionColor).toBe(codeTheme.functionOuterColor);
    expect(codeTheme.typeColor).toBe(codeTheme.typeOuterColor);
    expect(codeTheme.punctuationColor).toBe(codeTheme.punctuationOuterColor);
    expect(codeTheme.stringColor).toBe(codeTheme.stringOuterColor);
    expect(new Set([
      codeTheme.lineColor,
      codeTheme.keywordColor,
      codeTheme.functionColor,
      codeTheme.stringColor,
    ]).size).toBeGreaterThanOrEqual(4);
    const headerLayout = await page.locator('.cm-hybrid-codeblock-header').evaluate((header) => {
      const label = header.querySelector('.cm-hybrid-codeblock-language');
      const copy = header.querySelector('.cm-hybrid-codeblock-copy');
      const codeLine = document.querySelector('.cm-hybrid-codeblock-content-line');
      const headerRect = header.getBoundingClientRect();
      const labelRect = label?.getBoundingClientRect();
      const copyRect = copy?.getBoundingClientRect();
      const labelStyle = label ? getComputedStyle(label) : null;
      const copyStyle = copy ? getComputedStyle(copy) : null;
      const codeStyle = codeLine ? getComputedStyle(codeLine) : null;
      return {
        labelLeftGap: labelRect ? Math.round(labelRect.left - headerRect.left) : Number.POSITIVE_INFINITY,
        labelFontFamily: labelStyle?.fontFamily ?? '',
        labelFontSize: labelStyle?.fontSize ?? '',
        labelFontWeight: labelStyle?.fontWeight ?? '',
        labelLineHeight: labelStyle?.lineHeight ?? '',
        codeFontFamily: codeStyle?.fontFamily ?? '',
        codeFontSize: codeStyle?.fontSize ?? '',
        codeFontWeight: codeStyle?.fontWeight ?? '',
        codeLineHeight: codeStyle?.lineHeight ?? '',
        copyText: copy?.textContent?.trim() ?? '',
        copyAriaLabel: copy?.getAttribute('aria-label') ?? '',
        copyPosition: copyStyle?.position ?? '',
        copyWidth: copyRect?.width ?? 0,
        copyHeight: copyRect?.height ?? 0,
      };
    });
    expect(headerLayout.labelLeftGap).toBeGreaterThanOrEqual(0);
    expect(headerLayout.labelLeftGap).toBeLessThan(24);
    expect(headerLayout.labelFontFamily).toBe(headerLayout.codeFontFamily);
    expect(headerLayout.labelFontSize).toBe(headerLayout.codeFontSize);
    expect(headerLayout.labelFontWeight).toBe(headerLayout.codeFontWeight);
    expect(headerLayout.labelLineHeight).toBe(headerLayout.codeLineHeight);
    expect(headerLayout.copyText).toBe('');
    expect(headerLayout.copyAriaLabel).toBe('Copy code');
    expect(headerLayout.copyPosition).toBe('absolute');
    expect(headerLayout.copyWidth).toBeGreaterThan(0);
    expect(headerLayout.copyHeight).toBeGreaterThan(0);
    const headerRectBeforeHover = await page.locator('.cm-hybrid-codeblock-header').boundingBox();
    await page.locator('.cm-hybrid-codeblock').hover();
    await expect.poll(() => page.locator('.cm-hybrid-codeblock-copy').evaluate(element => (
      getComputedStyle(element).opacity
    ))).toBe('1');
    const headerRectAfterHover = await page.locator('.cm-hybrid-codeblock-header').boundingBox();
    expect(headerRectAfterHover).toEqual(headerRectBeforeHover);
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
    expect(Math.abs(codeBlockLineHeights.codeLine - codeBlockLineHeights.normalLine)).toBeLessThanOrEqual(1);

    const lineNumbers = await page.locator('.cm-lineNumbers .cm-gutterElement').evaluateAll(elements => (
      elements
        .map(element => element.textContent?.trim() ?? '')
        .filter(Boolean)
    ));
    expect(lineNumbers).toEqual(expect.arrayContaining(['3', '4', '5', '6']));

    const codeSurface = await page.evaluate(() => {
      const elements = [
        document.querySelector<HTMLElement>('.cm-hybrid-codeblock-inner'),
        document.querySelector<HTMLElement>('.cm-hybrid-codeblock-header'),
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
          backgroundColor: style.backgroundColor,
          borderLeftWidth: style.borderLeftWidth,
          borderRightWidth: style.borderRightWidth,
          borderTopWidth: style.borderTopWidth,
          borderBottomWidth: style.borderBottomWidth,
          boxShadow: style.boxShadow,
        };
      });
      const lefts = rects.map(rect => rect.left);
      const rights = rects.map(rect => rect.right);
      return {
        rects,
        backgrounds: [...new Set(rects.map(rect => rect.backgroundColor))],
        maxLeftDelta: Math.max(...lefts) - Math.min(...lefts),
        maxRightDelta: Math.max(...rights) - Math.min(...rights),
      };
    });
    expect(codeSurface.backgrounds).toEqual(['rgb(37, 37, 38)']);
    expect(codeSurface.maxLeftDelta).toBeLessThanOrEqual(1);
    expect(codeSurface.maxRightDelta).toBeLessThanOrEqual(1);
    for (const surface of codeSurface.rects) {
      expect(surface.borderLeftWidth).toBe('0px');
      expect(surface.borderRightWidth).toBe('0px');
      expect(surface.borderTopWidth).toBe('0px');
      expect(surface.borderBottomWidth).toBe('0px');
      expect(surface.boxShadow).toBe('none');
    }

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
    const inactiveTailTop = await page.locator('.cm-line').filter({ hasText: 'Tail line' })
      .evaluate(element => element.getBoundingClientRect().top);

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
      view.dispatch({ selection: { anchor: line.from + 9 } });
    });

    await expect(page.locator('.cm-hybrid-codeblock')).toHaveCount(1);
    await expect(page.locator('.cm-hybrid-codeblock-language')).toHaveText('```typescript');
    await expect(page.locator('.cm-hybrid-codeblock-footer')).toHaveCount(1);
    expect(await page.locator('.cm-line').evaluateAll(lines => lines
      .map(line => line.textContent?.trim() ?? '')
      .filter(text => text.startsWith('```')))).toEqual(['```typescript']);
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
    expect(Math.abs(
      await page.locator('.cm-line').filter({ hasText: 'Tail line' })
        .evaluate(element => element.getBoundingClientRect().top)
      - inactiveTailTop,
    )).toBeLessThanOrEqual(0.5);

    await page.keyboard.insertText('!');
    await expect(page.locator('.cm-hybrid-codeblock-content-line').filter({ hasText: 'const gre!et' })).toBeVisible();
    await expect(page.locator('.cm-hybrid-codeblock')).toHaveCount(1);
    await expect(page.locator('.cm-hybrid-codeblock-footer')).toHaveCount(1);
    expect(await page.evaluate(() => [
      window.__cmView.state.doc.line(3).text,
      window.__cmView.state.doc.line(4).text,
      window.__cmView.state.doc.line(5).text,
      window.__cmView.state.doc.line(6).text,
    ])).toEqual([
      '```ts',
      'const gre!et = (user_name: string) => `hi ${user_name}`;',
      'console.log(greet("world_name"));',
      '```',
    ]);
  });

  test('only the active fence edge reveals source while code content keeps the styled header and footer', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await expect(page.getByText('Test fixture ready')).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--vscode-textCodeBlock-background', '#252526');
    });

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
    const setSelection = async (anchorLine: number, headLine = anchorLine) => page.evaluate(
      ({ anchorLine, headLine }) => {
        const view = window.__cmView;
        const anchor = view.state.doc.line(anchorLine);
        const head = view.state.doc.line(headLine);
        view.dispatch({
          selection: {
            anchor: anchor.from + Math.min(1, anchor.length),
            head: head.from + Math.min(1, head.length),
          },
          scrollIntoView: true,
        });
        view.focus();
      },
      { anchorLine, headLine },
    );

    const snapshot = async () => page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'));
      const tail = lines.find(line => line.textContent?.includes('Tail line'));
      const codeLines = Array.from(document.querySelectorAll<HTMLElement>('.cm-hybrid-codeblock-content-line'));
      return {
        headerCount: document.querySelectorAll('.cm-hybrid-codeblock').length,
        headerLabel: document.querySelector('.cm-hybrid-codeblock-language')?.textContent ?? '',
        footerCount: document.querySelectorAll('.cm-hybrid-codeblock-footer').length,
        rawFences: lines
          .map(line => line.textContent?.trim() ?? '')
          .filter(text => text.startsWith('```')),
        tailTop: tail?.getBoundingClientRect().top ?? 0,
        codeLineTops: codeLines.map(line => line.getBoundingClientRect().top),
      };
    });

    await setSelection(1);
    const inactive = await snapshot();
    expect(inactive.headerCount).toBe(1);
    expect(inactive.headerLabel).toBe('TypeScript');
    expect(inactive.footerCount).toBe(1);
    expect(inactive.rawFences).toEqual([]);

    await setSelection(4);
    const contentActive = await snapshot();
    expect(contentActive.headerCount).toBe(1);
    expect(contentActive.headerLabel).toBe('```typescript');
    expect(contentActive.footerCount).toBe(1);
    expect(contentActive.rawFences).toEqual(['```typescript']);

    await setSelection(3);
    const openingActive = await snapshot();
    expect(openingActive.headerCount).toBe(0);
    expect(openingActive.headerLabel).toBe('');
    expect(openingActive.footerCount).toBe(1);
    expect(openingActive.rawFences).toEqual(['```ts']);

    await setSelection(6);
    const closingActive = await snapshot();
    expect(closingActive.headerCount).toBe(1);
    expect(closingActive.headerLabel).toBe('```typescript');
    expect(closingActive.footerCount).toBe(0);
    expect(closingActive.rawFences).toEqual(['```typescript', '```']);

    await setSelection(3, 4);
    const openingSelected = await snapshot();
    expect(openingSelected.headerCount).toBe(0);
    expect(openingSelected.headerLabel).toBe('');
    expect(openingSelected.footerCount).toBe(1);
    expect(openingSelected.rawFences).toEqual(['```ts']);

    await setSelection(4, 6);
    const closingSelected = await snapshot();
    expect(closingSelected.headerCount).toBe(1);
    expect(closingSelected.headerLabel).toBe('```typescript');
    expect(closingSelected.footerCount).toBe(0);
    expect(closingSelected.rawFences).toEqual(['```typescript', '```']);

    for (const state of [
      contentActive,
      openingActive,
      closingActive,
      openingSelected,
      closingSelected,
    ]) {
      expect(Math.abs(state.tailTop - inactive.tailTop)).toBeLessThanOrEqual(0.5);
      expect(state.codeLineTops).toHaveLength(inactive.codeLineTops.length);
      state.codeLineTops.forEach((top, index) => {
        expect(Math.abs(top - (inactive.codeLineTops[index] ?? 0))).toBeLessThanOrEqual(0.5);
      });
    }
  });

  test('subtle code surface stays continuous and adds no stroke or height to any fence row', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await expect(page.getByText('Test fixture ready')).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--vscode-textCodeBlock-background', '#252526');
    });

    const doc = [
      'Normal before',
      '',
      '```python',
      'm = -inf',
      'd = 0',
      '```',
      '',
      'Normal after',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, doc);
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    const measureRows = async (lineNumber: number) => page.evaluate((lineNumber) => {
      const view = window.__cmView;
      const line = view.state.doc.line(lineNumber);
      view.dispatch({ selection: { anchor: line.from + Math.min(1, line.length) } });
      view.focus();

      const measure = (element: Element | null) => {
        if (!(element instanceof HTMLElement)) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          className: element.className,
          text: element.textContent ?? '',
          height: rect.height,
          backgroundColor: style.backgroundColor,
          borderLeftWidth: style.borderLeftWidth,
          borderRightWidth: style.borderRightWidth,
          borderTopWidth: style.borderTopWidth,
          borderBottomWidth: style.borderBottomWidth,
          boxShadow: style.boxShadow,
        };
      };
      const lines = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'));
      return {
        selectedLine: view.state.doc.lineAt(view.state.selection.main.head).number,
        normal: measure(lines.find(element => element.textContent?.includes('Normal before')) ?? null),
        normalAfter: measure(lines.find(element => element.textContent?.includes('Normal after')) ?? null),
        headerLine: measure(document.querySelector('.cm-line:has(.cm-hybrid-codeblock)')),
        headerSurface: measure(document.querySelector('.cm-hybrid-codeblock-header')),
        codeContentLine: measure(lines.find(element => element.textContent?.includes('m = -inf')) ?? null),
        openingLine: measure(lines.find(element => element.textContent?.includes('```python')) ?? null),
        footerLine: measure(document.querySelector('.cm-line:has(.cm-hybrid-codeblock-footer)')),
        footerSurface: measure(document.querySelector('.cm-hybrid-codeblock-footer')),
        closingLine: measure(lines.find(element => element.textContent === '```') ?? null),
      };
    }, lineNumber);

    const inactiveRows = await measureRows(1);
    const activeContentRows = await measureRows(4);
    const activeOpeningRows = await measureRows(3);
    const activeClosingRows = await measureRows(6);
    const codeContentHeight = inactiveRows.codeContentLine?.height ?? 0;

    expect(inactiveRows.normal?.height).toBeDefined();
    expect(inactiveRows.headerLine?.height).toBeDefined();
    expect(inactiveRows.codeContentLine?.height).toBeDefined();
    expect(inactiveRows.footerLine?.height).toBeDefined();
    expect(activeOpeningRows.openingLine?.height).toBeDefined();
    expect(activeClosingRows.closingLine?.height).toBeDefined();

    for (const row of [
      inactiveRows.normal,
      inactiveRows.normalAfter,
      inactiveRows.headerLine,
      inactiveRows.footerLine,
      activeContentRows.headerLine,
      activeContentRows.footerLine,
      activeOpeningRows.openingLine,
      activeClosingRows.closingLine,
    ]) {
      expect(Math.abs((row?.height ?? 0) - codeContentHeight)).toBeLessThanOrEqual(0.5);
    }

    for (const surface of [
      inactiveRows.headerSurface,
      inactiveRows.codeContentLine,
      inactiveRows.footerSurface,
      activeContentRows.headerSurface,
      activeContentRows.codeContentLine,
      activeContentRows.footerSurface,
      activeOpeningRows.openingLine,
      activeOpeningRows.codeContentLine,
      activeOpeningRows.footerSurface,
      activeClosingRows.headerSurface,
      activeClosingRows.codeContentLine,
      activeClosingRows.closingLine,
    ]) {
      expect(surface).not.toBeNull();
      expect(surface?.backgroundColor).toBe('rgb(37, 37, 38)');
      expect(surface?.borderLeftWidth).toBe('0px');
      expect(surface?.borderRightWidth).toBe('0px');
      expect(surface?.borderTopWidth).toBe('0px');
      expect(surface?.borderBottomWidth).toBe('0px');
      expect(surface?.boxShadow).toBe('none');
    }
  });

  test('cursor reveal keeps Online Softmax inline math and code fence rows height-stable', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    const doc = [
      '# Online Softmax',
      '',
      "Online softmax is the numerical trick that makes FlashAttention's tiling strategy work.",
      '',
      '## Standard Softmax',
      '',
      'For a vector $x = [x_1, ..., x_n]$:',
      '',
      '$$softmax(x_i) = \\frac{exp(x_i)}  {sum(exp(x_j))}$$',
      '',
      'This requires **two passes** over the data: one to find the max (for numerical stability), and one to compute the sum and normalize.',
      '',
      '## Online Version',
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
      'For details see [[FlashAttention]] and the original paper.',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Online Softmax' }, '*');
    }, doc);
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      window.postMessage({
        type: 'updateSettings',
        settings: {
          fontSize: '14px',
          lineHeight: '22px',
        },
      }, '*');
    });
    await page.waitForFunction(() => {
      const content = document.querySelector('.cm-content');
      return content ? getComputedStyle(content).lineHeight === '22px' : false;
    }, { timeout: 5_000 });
    await expect(page.locator('.cm-hybrid-inline-math')).toBeVisible();
    await expect(page.locator('.cm-hybrid-codeblock')).toBeVisible();

    const measurements = await page.evaluate(async () => {
      const view = window.__cmView;
      const frame = () => new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      const selectLine = async (lineNumber: number) => {
        const line = view.state.doc.line(lineNumber);
        view.dispatch({ selection: { anchor: line.from + Math.min(1, line.length) } });
        view.focus();
        await frame();
      };
      const measure = (element: Element | null) => {
        if (!(element instanceof HTMLElement)) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          className: element.className,
          text: element.textContent ?? '',
          height: rect.height,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
        };
      };
      const lineContaining = (text: string) => Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent?.includes(text)) ?? null;

      await selectLine(1);
      const inactiveInlineMath = measure(lineContaining('For a vector'));
      const inactiveCodeFence = measure(document.querySelector('.cm-line:has(.cm-hybrid-codeblock)'));
      const inactiveClosingFence = measure(document.querySelector('.cm-line:has(.cm-hybrid-codeblock-footer)'));
      const codeContentLine = measure(lineContaining('m = -inf'));

      await selectLine(7);
      const activeInlineMath = measure(lineContaining('For a vector'));

      await selectLine(1);
      await selectLine(17);
      const activeOpeningFence = measure(
        document.querySelector('.cm-hybrid-codeblock-active-opening-line')
          ?? lineContaining('```python'),
      );

      await selectLine(1);
      await selectLine(24);
      const activeClosingFence = measure(
        document.querySelector('.cm-hybrid-codeblock-active-closing-line')
          ?? lineContaining('```'),
      );

      return {
        inactiveInlineMath,
        activeInlineMath,
        inactiveCodeFence,
        inactiveClosingFence,
        codeContentLine,
        activeOpeningFence,
        activeClosingFence,
      };
    });

    expect(measurements.inactiveInlineMath).not.toBeNull();
    expect(measurements.activeInlineMath).not.toBeNull();
    expect(measurements.inactiveCodeFence).not.toBeNull();
    expect(measurements.inactiveClosingFence).not.toBeNull();
    expect(measurements.codeContentLine).not.toBeNull();
    expect(measurements.activeOpeningFence).not.toBeNull();
    expect(measurements.activeClosingFence).not.toBeNull();

    expect(Math.abs(
      measurements.activeInlineMath!.height - measurements.inactiveInlineMath!.height,
    )).toBeLessThanOrEqual(0.25);
    for (const row of [
      measurements.inactiveCodeFence,
      measurements.inactiveClosingFence,
      measurements.activeOpeningFence,
      measurements.activeClosingFence,
    ]) {
      expect(Math.abs(
        row!.height - measurements.codeContentLine!.height,
      )).toBeLessThanOrEqual(0.25);
    }
    expect(measurements.activeOpeningFence!.fontSize).toBe(measurements.codeContentLine!.fontSize);
    expect(measurements.activeOpeningFence!.lineHeight).toBe(measurements.codeContentLine!.lineHeight);
    expect(measurements.activeClosingFence!.fontSize).toBe(measurements.codeContentLine!.fontSize);
    expect(measurements.activeClosingFence!.lineHeight).toBe(measurements.codeContentLine!.lineHeight);
  });

  test('moving the caret between Math Code Rendering lines 18 and 19 keeps line 18 geometry stable', async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 700 });
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    const doc = [
      '# Math Code Rendering',
      '',
      'Inline math should render like live preview: $e^{i\\pi} + 1 = 0$.',
      '',
      'Display math should render as a block:',
      '',
      '$$',
      '\\int_0^1 x^2 \\, dx = \\frac{1}{3}',
      '$$',
      '',
      'Fenced code should render as a preview card:',
      '',
      '```ts',
      'const greet = (name: string) => `hi ${name}`;',
      'console.log(greet("world"));',
      '```',
      '',
      'See also [[FlashAttention]] and [OpenAI](https://openai.com).',
      '',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Math Code Rendering' }, '*');
    }, doc);
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    const measurements = await page.evaluate(async () => {
      const view = window.__cmView;
      const frame = () => new Promise<void>(resolve => (
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
      ));
      const select = async (lineNumber: number, column = 0) => {
        const line = view.state.doc.line(lineNumber);
        view.dispatch({ selection: { anchor: line.from + Math.min(column, line.length) } });
        view.focus();
        await frame();
      };
      const measure = () => {
        const lines = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'));
        const line = lines
          .find(element => element.textContent?.includes('See also'));
        const followingLine = line?.nextElementSibling;
        if (
          !(line instanceof HTMLElement)
          || !(followingLine instanceof HTMLElement)
        ) {
          throw new Error('Missing line 18 or line 19');
        }
        const rect = line.getBoundingClientRect();
        const followingRect = followingLine.getBoundingClientRect();
        const style = getComputedStyle(line);
        return {
          normalHeight: followingRect.height,
          height: rect.height,
          bottom: rect.bottom,
          followingTop: followingRect.top,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
        };
      };

      await select(19);
      const inactive = measure();
      await select(18);
      const activeStart = measure();
      await select(18, 'See also [[Flash'.length);
      const activeWikiLink = measure();
      await select(18, 'See also [[FlashAttention]] and [Open'.length);
      const activeExternalLink = measure();
      const destinationColumn = view.state.doc.line(18).text.indexOf('openai.com') + 2;
      await select(18, destinationColumn);
      const destinationSourceVisible = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(element => element.textContent?.includes('See also'))
        ?.textContent?.includes('(https://openai.com)') ?? false;
      await select(19);
      const restored = measure();
      return {
        inactive,
        activeStart,
        activeWikiLink,
        activeExternalLink,
        destinationSourceVisible,
        restored,
      };
    });

    expect(measurements.destinationSourceVisible).toBe(true);
    expect(Math.abs(
      measurements.inactive.height - measurements.inactive.normalHeight,
    )).toBeLessThanOrEqual(0.25);

    for (const measurement of [
      measurements.activeStart,
      measurements.activeWikiLink,
      measurements.activeExternalLink,
      measurements.restored,
    ]) {
      expect({
        fontFamily: measurement.fontFamily,
        fontSize: measurement.fontSize,
        lineHeight: measurement.lineHeight,
        letterSpacing: measurement.letterSpacing,
      }).toEqual({
        fontFamily: measurements.inactive.fontFamily,
        fontSize: measurements.inactive.fontSize,
        lineHeight: measurements.inactive.lineHeight,
        letterSpacing: measurements.inactive.letterSpacing,
      });
      expect(Math.abs(measurement.height - measurements.inactive.height)).toBeLessThanOrEqual(0.25);
      expect(Math.abs(measurement.bottom - measurements.inactive.bottom)).toBeLessThanOrEqual(0.25);
      expect(Math.abs(measurement.followingTop - measurements.inactive.followingTop)).toBeLessThanOrEqual(0.25);
    }
  });

  test('mouse click can select the Online Softmax opening code fence line', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    const doc = [
      '# Online Softmax',
      '',
      "Online softmax is the numerical trick that makes FlashAttention's tiling strategy work.",
      '',
      '## Standard Softmax',
      '',
      'For a vector $x = [x_1, ..., x_n]$:',
      '',
      '$$softmax(x_i) = \\frac{exp(x_i)}  {sum(exp(x_j))}$$',
      '',
      'This requires **two passes** over the data: one to find the max (for numerical stability), and one to compute the sum and normalize.',
      '',
      '## Online Version',
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
      'For details see [[FlashAttention]] and the original paper.',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Online Softmax' }, '*');
    }, doc);
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-codeblock')).toBeVisible();

    await page.locator('.cm-hybrid-codeblock-header').click();

    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        number: selectedLine.number,
        text: selectedLine.text,
      };
    })).toEqual({
      number: 17,
      text: '```python',
    });
  });

  test('mouse click can select the Online Softmax closing code fence line', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');
    await waitForEditorBootstrap(page);

    const doc = [
      '# Online Softmax',
      '',
      "Online softmax is the numerical trick that makes FlashAttention's tiling strategy work.",
      '',
      '## Standard Softmax',
      '',
      'For a vector $x = [x_1, ..., x_n]$:',
      '',
      '$$softmax(x_i) = \\frac{exp(x_i)}  {sum(exp(x_j))}$$',
      '',
      'This requires **two passes** over the data: one to find the max (for numerical stability), and one to compute the sum and normalize.',
      '',
      '## Online Version',
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
      'For details see [[FlashAttention]] and the original paper.',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text, title: 'Online Softmax' }, '*');
    }, doc);
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await expect(page.locator('.cm-hybrid-codeblock-footer')).toBeVisible();

    await page.locator('.cm-hybrid-codeblock-footer').scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: 0 } });
    });
    const footerBox = await page.locator('.cm-hybrid-codeblock-footer').boundingBox();
    expect(footerBox).not.toBeNull();
    await page.mouse.click(
      footerBox!.x + footerBox!.width / 2,
      footerBox!.y + footerBox!.height / 2,
    );

    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        number: selectedLine.number,
        text: selectedLine.text,
      };
    })).toEqual({
      number: 24,
      text: '```',
    });
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
    await expect(page.locator('.cm-hybrid-codeblock-language')).toHaveText('```python');
    await expect(page.locator('.cm-hybrid-codeblock-footer')).toHaveCount(1);
    expect(await page.locator('.cm-line').evaluateAll(lines => lines
      .map(line => line.textContent?.trim() ?? '')
      .filter(text => text.startsWith('```')))).toEqual(['```python']);
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
    await expect(page.locator('.cm-hybrid-codeblock-language')).toHaveText('```python');
    await expect(page.locator('.cm-hybrid-codeblock-footer')).toHaveCount(1);
    expect(await page.locator('.cm-line').evaluateAll(lines => lines
      .map(line => line.textContent?.trim() ?? '')
      .filter(text => text.startsWith('```')))).toEqual(['```python']);
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

    await expect(page.locator('.cm-hybrid-codeblock-language')).toHaveText('```python');
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

  test('hybrid rendering keeps Mermaid diagrams focused until edit source is requested like Obsidian', async ({ page }) => {
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
    await expect(page.locator('.cm-hybrid-mermaid-block')).toBeVisible();
    await expect(page.getByLabel('Edit Mermaid source')).toBeVisible();
    await expect(page.locator('.cm-line').filter({ hasText: '```mermaid' })).toHaveCount(0);

    await page.getByLabel('Edit Mermaid source').click();
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

  test('hybrid rendering shows only Obsidian\'s edit affordance over Mermaid diagrams', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto('http://localhost:8979/test.html');

    const mermaidSource = [
      '```mermaid',
      'graph TD',
      '  A[Markdown note] --> B[Rendered diagram]',
      '  B --> C[Edit source]',
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

    const block = page.locator('.cm-hybrid-mermaid-block');
    await expect(block.locator('svg')).toBeVisible({ timeout: 10_000 });
    await block.hover();
    await expect(page.getByLabel('Edit Mermaid source')).toBeVisible();
    await expect(page.getByLabel('Zoom in Mermaid diagram')).toHaveCount(0);
    await expect(page.getByLabel('Zoom out Mermaid diagram')).toHaveCount(0);
    await expect(page.locator('.cm-hybrid-mermaid-zoom-level')).toHaveCount(0);
    await expect(block).toHaveCount(1);
    await expect(page.locator('.cm-line').filter({ hasText: '```mermaid' })).toHaveCount(0);
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
      'Keep [PDF link](raw/paper.pdf#page=7) clickable.',
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

  test('clicking a rendered table keeps in-place cells and normalizes edits like Obsidian live preview', async ({ page }) => {
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
    const editableCell = page.getByRole('textbox', { name: 'Table cell Online softmax' });
    await editableCell.fill('Streaming softmax');
    await page.getByText('After table').click();

    await expect(page.locator('.cm-hybrid-table-widget')).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      return [3, 4, 5].map(lineNumber => view.state.doc.line(lineNumber).text);
    })).toEqual([
      '| Term              | Detail                      |',
      '| ----------------- | --------------------------- |',
      '| Streaming softmax | Running max and denominator |',
    ]);
  });

  test('clicking rendered table cell padding enters the matching raw row like Obsidian live preview', async ({ page }) => {
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
    await page.locator('.cm-hybrid-table td')
      .filter({ hasText: 'Online softmax' })
      .click({ position: { x: 2, y: 2 } });

    await expect.poll(() => page.evaluate(() => {
      const view = window.__cmView;
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    })).toBe(5);
    await page.keyboard.type('edited ');
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.line(5).text))
      .toBe('| edited Online softmax | Running max and denominator |');
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

  test('hybrid rendering switches tables between rendered preview and raw source like Obsidian live preview', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    const testDoc = [
      'Before table',
      '',
      '| Term | Detail |',
      '| --- | --- |',
      '| Online softmax | Keep `m` and [[FlashAttention]] stable |',
      '',
      'After table',
    ].join('\n');

    await page.evaluate((text) => {
      window.postMessage({ type: 'setText', text }, '*');
    }, testDoc);

    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(7).from } });
    });

    const table = page.locator('.cm-hybrid-table');
    await expect(table).toBeVisible();
    await expect(table).toContainText('Online softmax');
    await expect(table.locator('.cm-hybrid-table-inline-code')).toContainText('m');
    await expect(table.getByRole('button', { name: 'FlashAttention' })).toBeVisible();
    await expect(page.locator('.cm-content')).not.toContainText('| --- | --- |');

    for (const lineNumber of [3, 4, 5]) {
      await page.evaluate((line) => {
        const view = window.__cmView;
        const target = view.state.doc.line(line);
        view.dispatch({ selection: { anchor: target.from } });
      }, lineNumber);
      await expect(page.locator('.cm-hybrid-table-widget')).toHaveCount(0);
      await expect(page.locator('.cm-content')).toContainText('| Term | Detail |');
      await expect(page.locator('.cm-content')).toContainText('| --- | --- |');
      await expect(page.locator('.cm-content'))
        .toContainText('| Online softmax | Keep m and FlashAttention stable |');
    }

    await page.evaluate(() => {
      const view = window.__cmView;
      const target = view.state.doc.line(5);
      view.dispatch({ selection: { anchor: target.from + target.text.indexOf('`m`') + 1 } });
    });
    await expect(page.locator('.cm-hybrid-table-widget')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toContainText('| Online softmax | Keep `m` and FlashAttention stable |');

    await page.evaluate(() => {
      const view = window.__cmView;
      const target = view.state.doc.line(5);
      view.dispatch({ selection: { anchor: target.from + target.text.indexOf('FlashAttention') + 2 } });
    });
    await expect(page.locator('.cm-hybrid-table-widget')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toContainText('| Online softmax | Keep m and [[FlashAttention]] stable |');

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: view.state.doc.line(7).from } });
    });

    await expect(table).toBeVisible();
    await expect(page.locator('.cm-content')).not.toContainText('| --- | --- |');
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
    await expect(page.locator('.cm-hybrid-callout-icon')).toHaveAttribute('data-callout-icon', 'flame');
    await expect(page.locator('.cm-hybrid-callout-icon svg')).toBeVisible();
    await expect(page.locator('.cm-hybrid-callout-body')).toContainText('streaming statistics.');
    await expect(page.locator('.cm-hybrid-callout-body')).toContainText('Works across tiles.');
    await expect(page.locator('.cm-hybrid-callout')).not.toContainText('[!tip]');

    const calloutVisual = await page.evaluate(() => {
      const callout = document.querySelector<HTMLElement>('.cm-hybrid-callout');
      const title = callout?.querySelector<HTMLElement>('.cm-hybrid-callout-title');
      const icon = callout?.querySelector<HTMLElement>('.cm-hybrid-callout-icon');
      if (!callout || !title || !icon) throw new Error('Missing rendered callout chrome');
      const calloutStyle = getComputedStyle(callout);
      return {
        backgroundColor: calloutStyle.backgroundColor,
        borderLeftWidth: calloutStyle.borderLeftWidth,
        titleColor: getComputedStyle(title).color,
        iconColor: getComputedStyle(icon).color,
      };
    });
    expect(calloutVisual.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(calloutVisual.borderLeftWidth).toBe('0px');
    expect(calloutVisual.titleColor).toBe(calloutVisual.iconColor);

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
      '> See [[Online Softmax]] and [paper](raw/pdf/flash-attention.pdf#page=7).',
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
      { type: 'openUri', uri: 'raw/pdf/flash-attention.pdf#page=7' },
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
      'Click [PDF link](raw/paper.pdf#page=7).',
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
    expect(openMessages).toEqual([{ type: 'openUri', uri: 'raw/paper.pdf#page=7' }]);
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

  test('Obsidian-style context menu exposes selected-text actions and applies Bold', async ({ page }) => {
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
      line.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: window.innerWidth - 1,
        clientY: window.innerHeight - 1,
      }));
    });

    const menu = page.getByRole('menu');
    await expect(menu).toHaveCount(1);
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText([
      /(?:⌘L|Ctrl\+L)  Add to Chat/,
      'Copy',
      'Bold',
      'Italic',
      'Strikethrough',
      'Inline code',
      'Highlight',
      'Link',
      'Look Up',
    ]);
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    expect(await menu.evaluate(element => getComputedStyle(element).flexDirection)).toBe('column');
    const bounds = await menu.evaluate(element => {
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
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);

    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem').nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitem').last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    await page.evaluate(() => {
      const line = document.querySelector('.cm-line');
      const rect = line.getBoundingClientRect();
      line.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 80,
        clientY: rect.top + 8,
      }));
    });

    await expect(menu).toHaveCount(1);
    await page.mouse.click(1, 1);
    await expect(menu).toHaveCount(0);

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

    await page.getByRole('menuitem', { name: 'Bold', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__cmView.state.doc.toString()))
      .toBe('alpha **beta** gamma');
  });

  test('Obsidian-style context menu handles native drag selections', async ({ page }) => {
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setText', text: 'alpha beta gamma' }, '*');
    });
    await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: 0 } });
      view.focus();

      const line = document.querySelector<HTMLElement>('.cm-line');
      if (!line?.firstChild) throw new Error('Missing editor text node');
      const text = line.textContent ?? '';
      const from = text.indexOf('beta');
      const range = document.createRange();
      range.setStart(line.firstChild, from);
      range.setEnd(line.firstChild, from + 'beta'.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const rect = range.getBoundingClientRect();
      line.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }));
    });

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText([
      /(?:⌘L|Ctrl\+L)  Add to Chat/,
      'Copy',
      'Bold',
      'Italic',
      'Strikethrough',
      'Inline code',
      'Highlight',
      'Link',
      'Look Up',
    ]);
  });

  test('Obsidian-style context menu stays within narrow viewport insets', async ({ page }) => {
    await page.setViewportSize({ width: 160, height: 480 });
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setText', text: 'alpha beta gamma' }, '*');
    });
    await page.waitForSelector('#editor .cm-content', { state: 'attached', timeout: 10_000 });
    await page.waitForFunction(() => window.__cmView?.state.doc.toString() === 'alpha beta gamma');

    await page.evaluate(() => {
      const view = window.__cmView;
      const from = view.state.doc.toString().indexOf('beta');
      view.dispatch({ selection: { anchor: from, head: from + 'beta'.length } });
      view.focus();
      document.querySelector('.cm-line').dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: window.innerWidth - 1,
        clientY: window.innerHeight - 1,
      }));
    });

    const bounds = await page.getByRole('menu').evaluate(element => {
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
    expect(bounds.left).toBeGreaterThanOrEqual(8);
    expect(bounds.top).toBeGreaterThanOrEqual(8);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth - 8);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight - 8);
  });

  test('Obsidian-style context menu scrolls keyboard focus into a constrained menu viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 120 });
    await page.goto('http://localhost:8979/test.html');

    await page.evaluate(() => {
      window.postMessage({ type: 'setText', text: 'alpha beta gamma' }, '*');
    });
    await page.waitForSelector('#editor .cm-content', { state: 'attached', timeout: 10_000 });
    await page.waitForFunction(() => window.__cmView?.state.doc.toString() === 'alpha beta gamma');

    await page.evaluate(() => {
      const view = window.__cmView;
      const from = view.state.doc.toString().indexOf('beta');
      view.dispatch({ selection: { anchor: from, head: from + 'beta'.length } });
      view.focus();
      document.querySelector('.cm-line').dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 24,
        clientY: 24,
      }));
    });

    const menu = page.getByRole('menu');
    const menuItems = menu.getByRole('menuitem');
    await expect(menuItems.first()).toBeFocused();
    expect(await menu.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);

    const expectFocusedItemVisible = async () => {
      const visibility = await menu.evaluate(element => {
        const activeItem = document.activeElement as HTMLElement;
        const menuBounds = element.getBoundingClientRect();
        const itemBounds = activeItem.getBoundingClientRect();
        return {
          intersects: itemBounds.bottom > menuBounds.top && itemBounds.top < menuBounds.bottom,
          scrollTop: element.scrollTop,
        };
      });
      expect(visibility.intersects).toBe(true);
      return visibility.scrollTop;
    };

    await page.keyboard.press('End');
    await expect(menuItems.last()).toBeFocused();
    expect(await expectFocusedItemVisible()).toBeGreaterThan(0);

    await page.keyboard.press('Home');
    await expect(menuItems.first()).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(menuItems.last()).toBeFocused();
    expect(await expectFocusedItemVisible()).toBeGreaterThan(0);
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

    const testDoc = 'Jump to [PDF link](raw/paper.pdf#page=7).';

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
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');

    const openMessages = await page.evaluate(() => window.__mockMessages.filter((m) => m.type === 'openUri'));
    expect(openMessages).toEqual([{ type: 'openUri', uri: 'raw/paper.pdf#page=7' }]);
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
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');

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
    const insertMd = '[PDF](raw/paper.pdf#page=7)';
    await page.evaluate((md) => {
      window.postMessage({ type: 'insertText', text: md }, '*');
    }, insertMd);

    const expectedText = initialText.replace('some', insertMd);
    await expect.poll(() => page.evaluate(() =>
      window.__cmView?.state.doc.toString()
    )).toBe(expectedText);
  });
});
