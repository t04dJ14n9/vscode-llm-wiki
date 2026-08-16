import { expect, test, type Page } from '@playwright/test';

type ModelState = {
  text: string;
  cursor: number;
};

type VimMotion = 'h' | 'l' | 'j' | 'k' | '0' | '$' | 'w' | 'b' | 'e' | 'gg' | 'G';
type VimInsertCommand = 'i' | 'a' | 'A' | 'o' | 'O';
type VimDeleteCommand = 'x' | 'X' | 'dd';

type VimCommandOperation =
  | { kind: 'motion'; command: VimMotion }
  | { kind: 'insert'; command: VimInsertCommand; text: string }
  | { kind: 'delete'; command: VimDeleteCommand }
  | { kind: 'replace'; text: string };

type VimCommandTestSet = {
  seed: number;
  initialText: string;
  initialCursor: number;
  operations: VimCommandOperation[];
  expectedText: string;
  expectedCursor: number;
};

type NonVimOperation =
  | { kind: 'insertText'; text: string }
  | { kind: 'type'; text: string }
  | { kind: 'press'; key: 'ArrowLeft' | 'ArrowRight' | 'Backspace' | 'Delete' }
  | { kind: 'replaceSelection'; from: number; to: number; text: string; input: 'insertText' | 'type' };

type NonVimTestSet = {
  seed: number;
  initialText: string;
  initialCursor: number;
  operations: NonVimOperation[];
  expectedText: string;
  expectedCursor: number;
};

const VIM_COMMAND_TESTSET_COUNT = 32;
const VIM_COMMAND_OPERATIONS_PER_TESTSET = 96;
const NON_VIM_TESTSET_COUNT = 24;
const NON_VIM_OPERATIONS_PER_TESTSET = 120;

const VIM_TEXTS = [
  'alpha beta\ngamma delta\nepsilon zeta',
  'first line\nsecond line\nthird line',
  'one two three\nfour five six\nseven eight nine',
  '# Heading\nshort markdown words\nfinal line',
];

const VIM_INSERT_TEXTS = ['a', ' beta', ' word', ' md', ' z'];
const VIM_REPLACE_TEXTS = ['a', 'z', 'Q', '7'];
const NON_VIM_INSERT_TEXTS = ['a', ' beta', ' ', '\t', '`', '```', '**', '[]', '()', '$x$'];
const NON_VIM_TYPE_TEXTS = ['a', ' beta', ' ', '`', '```', '**', '[]', '()', '$x$'];

test.describe('LLM Wiki Markdown expanded Vim command fuzzing', () => {
  test.setTimeout(240_000);

  // This generated final-text model intentionally covers deterministic Vim command
  // families. Search, registers, visual mode, macros, counts, and undo/redo are
  // excluded because they require modeling transient Vim state or the fixture's
  // host setText history rather than only markdown text and cursor state.
  test('generated Vim normal command sequences match the final markdown text model', async ({ page }) => {
    await openHarness(page);

    const testSets = generateVimCommandTestSets(
      VIM_COMMAND_TESTSET_COUNT,
      VIM_COMMAND_OPERATIONS_PER_TESTSET,
      0xa000,
    );

    for (const testSet of testSets) {
      await test.step(`vim command seed ${testSet.seed}`, async () => {
        await prepareEditor(page, {
          text: testSet.initialText,
          cursor: testSet.initialCursor,
          vimMode: true,
        });
        await enterVimNormalModeAt(page, testSet.initialCursor);
        await runVimCommandOperations(page, testSet);
        await expectEditorState(page, {
          text: testSet.expectedText,
          cursor: testSet.expectedCursor,
          insertMode: false,
        }, formatTestSetLabel('vim final', testSet.seed, testSet.operations));
      });
    }
  });

  test('generated non-Vim input sequences match the final markdown text model', async ({ page }) => {
    await openHarness(page);

    const testSets = generateNonVimTestSets(
      NON_VIM_TESTSET_COUNT,
      NON_VIM_OPERATIONS_PER_TESTSET,
      0xb000,
    );

    for (const testSet of testSets) {
      await test.step(`non-vim seed ${testSet.seed}`, async () => {
        await prepareEditor(page, {
          text: testSet.initialText,
          cursor: testSet.initialCursor,
          vimMode: false,
        });
        await runNonVimOperations(page, testSet);
        await expectEditorState(page, {
          text: testSet.expectedText,
          cursor: testSet.expectedCursor,
        }, formatTestSetLabel('non-vim final', testSet.seed, testSet.operations));
      });
    }
  });

  test('non-Vim multi-key typing stays anchored when replacing text creates a temporary list marker', async ({ page }) => {
    await openHarness(page);
    await prepareEditor(page, {
      text: ' `() b() beta $x$\t``',
      cursor: 17,
      vimMode: false,
    });

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: 1, head: 17 } });
      view.focus();
    });
    await page.keyboard.type('**', { delay: 0 });

    await expectEditorState(page, {
      text: ' **\t``',
      cursor: 3,
    }, 'multi-key replacement remains anchored while list rendering updates');
  });

  test('non-Vim text input replaces only the selected source inside rendered inline math', async ({ page }) => {
    await openHarness(page);
    await prepareEditor(page, {
      text: 'o`$x$ beta``$x beta$x$````[]\ta$a',
      cursor: 1,
      vimMode: false,
    });

    await page.evaluate(() => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: 1, head: 27 } });
      view.focus();
    });
    await page.keyboard.insertText('\t');

    await expectEditorState(page, {
      text: 'o\t]\ta$a',
      cursor: 2,
    }, 'input replacement retains source after an endpoint inside rendered inline math');
  });

  test('Vim j and k move by document lines from a clean cursor column', async ({ page }) => {
    await openHarness(page);
    const text = 'alpha beta\ngamma delta\nlast line';
    await prepareEditor(page, {
      text,
      cursor: 'alp'.length,
      vimMode: true,
    });
    await enterVimNormalModeAt(page, 'alp'.length);

    await page.keyboard.press('j');
    await expectEditorState(page, {
      text,
      cursor: 'alpha beta\ngam'.length,
      insertMode: false,
    }, 'Vim j moves to same document-line column');

    await page.keyboard.press('k');
    await expectEditorState(page, {
      text,
      cursor: 'alp'.length,
      insertMode: false,
    }, 'Vim k moves back to same document-line column');
  });

  test('Vim gg and G move to document endpoints from a clean state', async ({ page }) => {
    await openHarness(page);
    const text = 'alpha beta\ngamma delta\nlast line';
    await prepareEditor(page, {
      text,
      cursor: 'alpha beta\ngam'.length,
      vimMode: true,
    });
    await enterVimNormalModeAt(page, 'alpha beta\ngam'.length);

    await page.keyboard.press('g');
    await page.keyboard.press('g');
    await expectEditorState(page, {
      text,
      cursor: 0,
      insertMode: false,
    }, 'Vim gg moves to the document start');

    await page.keyboard.press('Shift+G');
    await expectEditorState(page, {
      text,
      cursor: 'alpha beta\ngamma delta\n'.length,
      insertMode: false,
    }, 'Vim G moves to the last line start');
  });

  test('Vim w, b, and e move by words from a clean state', async ({ page }) => {
    await openHarness(page);
    const text = 'alpha beta\ngamma delta';
    await prepareEditor(page, {
      text,
      cursor: 'alp'.length,
      vimMode: true,
    });
    await enterVimNormalModeAt(page, 'alp'.length);

    await page.keyboard.press('w');
    await expectEditorState(page, {
      text,
      cursor: 'alpha '.length,
      insertMode: false,
    }, 'Vim w moves to next word');

    await page.keyboard.press('e');
    await expectEditorState(page, {
      text,
      cursor: 'alpha beta'.length - 1,
      insertMode: false,
    }, 'Vim e moves to word end');

    await page.keyboard.press('b');
    await expectEditorState(page, {
      text,
      cursor: 'alpha '.length,
      insertMode: false,
    }, 'Vim b moves to word start');
  });

  test('Vim dd deletes the current document line from a clean state', async ({ page }) => {
    await openHarness(page);
    const text = 'alpha beta\ngamma delta\nlast line';
    await prepareEditor(page, {
      text,
      cursor: 'alpha beta\ngam'.length,
      vimMode: true,
    });
    await enterVimNormalModeAt(page, 'alpha beta\ngam'.length);

    await page.keyboard.press('d');
    await page.keyboard.press('d');
    await expectEditorState(page, {
      text: 'alpha beta\nlast line',
      cursor: 'alpha beta\n'.length,
      insertMode: false,
    }, 'Vim dd deletes the active document line');
  });

  test('Vim boundary motions and deletes handle line edges', async ({ page }) => {
    await openHarness(page);

    await prepareEditor(page, {
      text: '## heading',
      cursor: 6,
      vimMode: true,
    });
    await enterVimNormalModeAt(page, 6);
    await page.keyboard.press('0');
    await expectEditorState(page, {
      text: '## heading',
      cursor: 0,
      insertMode: false,
    }, 'Vim 0 moves to line start');
    await page.keyboard.press('$');
    await expectEditorState(page, {
      text: '## heading',
      cursor: 9,
      insertMode: false,
    }, 'Vim $ moves to line end');

    await prepareEditor(page, {
      text: 'abc',
      cursor: 1,
      vimMode: true,
    });
    await enterVimNormalModeAt(page, 1);
    await page.keyboard.press('x');
    await expectEditorState(page, {
      text: 'ac',
      cursor: 1,
      insertMode: false,
    }, 'Vim x deletes the character under the cursor');

    await prepareEditor(page, {
      text: 'abc',
      cursor: 0,
      vimMode: true,
    });
    await enterVimNormalModeAt(page, 0);
    await page.keyboard.press('X');
    await expectEditorState(page, {
      text: 'abc',
      cursor: 0,
      insertMode: false,
    }, 'Vim X at line start is a no-op');

    await prepareEditor(page, {
      text: 'first\n\nsecond',
      cursor: 'first\n'.length,
      vimMode: true,
    });
    await enterVimNormalModeAt(page, 'first\n'.length);
    await page.keyboard.press('d');
    await page.keyboard.press('d');
    await expectEditorState(page, {
      text: 'first\nsecond',
      cursor: 'first\n'.length,
      insertMode: false,
    }, 'Vim dd deletes a blank line');
  });

  test('Vim vertical and word motions clamp predictably on clean state', async ({ page }) => {
    await openHarness(page);

    const unevenText = 'abcdefgh\nxy\nz';
    await prepareEditor(page, {
      text: unevenText,
      cursor: 7,
      vimMode: true,
    });
    await enterVimNormalModeAt(page, 7);
    await page.keyboard.press('j');
    await expectEditorState(page, {
      text: unevenText,
      cursor: 10,
      insertMode: false,
    }, 'Vim j clamps to a shorter next line');
    await page.keyboard.press('k');
    await expectEditorState(page, {
      text: unevenText,
      cursor: 7,
      insertMode: false,
    }, 'Vim k returns to the preserved desired column');

    const wordText = 'alpha beta gamma';
    await prepareEditor(page, {
      text: wordText,
      cursor: 'alpha '.length,
      vimMode: true,
    });
    await enterVimNormalModeAt(page, 'alpha '.length);
    await page.keyboard.press('w');
    await expectEditorState(page, {
      text: wordText,
      cursor: 'alpha beta '.length,
      insertMode: false,
    }, 'Vim w moves from one word start to the next');

    await prepareEditor(page, {
      text: wordText,
      cursor: 'alpha beta '.length,
      vimMode: true,
    });
    await enterVimNormalModeAt(page, 'alpha beta '.length);
    await page.keyboard.press('b');
    await expectEditorState(page, {
      text: wordText,
      cursor: 'alpha '.length,
      insertMode: false,
    }, 'Vim b moves to the previous word start');

    await prepareEditor(page, {
      text: wordText,
      cursor: 'alpha '.length,
      vimMode: true,
    });
    await enterVimNormalModeAt(page, 'alpha '.length);
    await page.keyboard.press('e');
    await expectEditorState(page, {
      text: wordText,
      cursor: 'alpha beta'.length - 1,
      insertMode: false,
    }, 'Vim e moves to the current word end');
  });

  test('Vim line-editing commands produce deterministic final markdown', async ({ page }) => {
    const baseText = '  alpha beta\ngamma delta\nlast line';
    const baseCursor = '  alp'.length;
    const cases: Array<{
      name: string;
      run: () => Promise<void>;
      expectedText: string;
      expectedCursor: number;
    }> = [
      {
        name: '^',
        run: () => page.keyboard.press('^'),
        expectedText: baseText,
        expectedCursor: 2,
      },
      {
        name: 'I',
        run: async () => {
          await page.keyboard.press('Shift+I');
          await page.waitForFunction(() => window.__cmView?.cm?.state?.vim?.insertMode === true);
          await page.keyboard.insertText('Z');
          await page.keyboard.press('Escape');
        },
        expectedText: '  Zalpha beta\ngamma delta\nlast line',
        expectedCursor: 2,
      },
      {
        name: 'D',
        run: () => page.keyboard.press('Shift+D'),
        expectedText: '  alp\ngamma delta\nlast line',
        expectedCursor: 4,
      },
      {
        name: 'C',
        run: async () => {
          await page.keyboard.press('Shift+C');
          await page.waitForFunction(() => window.__cmView?.cm?.state?.vim?.insertMode === true);
          await page.keyboard.insertText('Z');
          await page.keyboard.press('Escape');
        },
        expectedText: '  alpZ\ngamma delta\nlast line',
        expectedCursor: 5,
      },
      {
        name: 'J',
        run: () => page.keyboard.press('Shift+J'),
        expectedText: '  alpha beta gamma delta\nlast line',
        expectedCursor: 12,
      },
      {
        name: 'r',
        run: async () => {
          await page.keyboard.press('r');
          await page.keyboard.press('Z');
        },
        expectedText: '  alpZa beta\ngamma delta\nlast line',
        expectedCursor: 5,
      },
      {
        name: 's',
        run: async () => {
          await page.keyboard.press('s');
          await page.waitForFunction(() => window.__cmView?.cm?.state?.vim?.insertMode === true);
          await page.keyboard.insertText('Z');
          await page.keyboard.press('Escape');
        },
        expectedText: '  alpZa beta\ngamma delta\nlast line',
        expectedCursor: 5,
      },
      {
        name: 'cc',
        run: async () => {
          await page.keyboard.press('c');
          await page.keyboard.press('c');
          await page.waitForFunction(() => window.__cmView?.cm?.state?.vim?.insertMode === true);
          await page.keyboard.insertText('Z');
          await page.keyboard.press('Escape');
        },
        expectedText: '  Z\ngamma delta\nlast line',
        expectedCursor: 2,
      },
      {
        name: 'S',
        run: async () => {
          await page.keyboard.press('Shift+S');
          await page.waitForFunction(() => window.__cmView?.cm?.state?.vim?.insertMode === true);
          await page.keyboard.insertText('Z');
          await page.keyboard.press('Escape');
        },
        expectedText: '  Z\ngamma delta\nlast line',
        expectedCursor: 2,
      },
      {
        name: 'd$',
        run: async () => {
          await page.keyboard.press('d');
          await page.keyboard.press('$');
        },
        expectedText: '  alp\ngamma delta\nlast line',
        expectedCursor: 4,
      },
      {
        name: 'dw',
        run: async () => {
          await page.keyboard.press('d');
          await page.keyboard.press('w');
        },
        expectedText: '  alpbeta\ngamma delta\nlast line',
        expectedCursor: 5,
      },
      {
        name: 'cw',
        run: async () => {
          await page.keyboard.press('c');
          await page.keyboard.press('w');
          await page.waitForFunction(() => window.__cmView?.cm?.state?.vim?.insertMode === true);
          await page.keyboard.insertText('Z');
          await page.keyboard.press('Escape');
        },
        expectedText: '  alpZ beta\ngamma delta\nlast line',
        expectedCursor: 5,
      },
      {
        name: 'yy p',
        run: async () => {
          await page.keyboard.press('y');
          await page.keyboard.press('y');
          await page.keyboard.press('p');
        },
        expectedText: '  alpha beta\n  alpha beta\ngamma delta\nlast line',
        expectedCursor: 15,
      },
      {
        name: 'dd p',
        run: async () => {
          await page.keyboard.press('d');
          await page.keyboard.press('d');
          await page.keyboard.press('p');
        },
        expectedText: 'gamma delta\n  alpha beta\nlast line',
        expectedCursor: 14,
      },
    ];

    await openHarness(page);

    for (const testCase of cases) {
      await test.step(testCase.name, async () => {
        await prepareEditor(page, {
          text: baseText,
          cursor: baseCursor,
          vimMode: true,
        });
        await enterVimNormalModeAt(page, baseCursor);
        await testCase.run();
        await expectEditorState(page, {
          text: testCase.expectedText,
          cursor: testCase.expectedCursor,
          insertMode: false,
        }, `Vim ${testCase.name} produces expected text`);
      });
    }
  });

  test('Vim insert entry commands insert text and return to normal mode', async ({ page }) => {
    const cases: Array<{
      command: VimInsertCommand;
      key: string;
      expectedText: string;
      expectedCursor: number;
    }> = [
      { command: 'i', key: 'i', expectedText: 'alpZha beta\ngamma delta', expectedCursor: 3 },
      { command: 'a', key: 'a', expectedText: 'alphZa beta\ngamma delta', expectedCursor: 4 },
      { command: 'A', key: 'Shift+A', expectedText: 'alpha betaZ\ngamma delta', expectedCursor: 10 },
      { command: 'o', key: 'o', expectedText: 'alpha beta\nZ\ngamma delta', expectedCursor: 11 },
      { command: 'O', key: 'Shift+O', expectedText: 'Z\nalpha beta\ngamma delta', expectedCursor: 0 },
    ];

    await openHarness(page);

    for (const testCase of cases) {
      await test.step(testCase.command, async () => {
        await prepareEditor(page, {
          text: 'alpha beta\ngamma delta',
          cursor: 'alp'.length,
          vimMode: true,
        });
        await enterVimNormalModeAt(page, 'alp'.length);

        await page.keyboard.press(testCase.key);
        await page.waitForFunction(() => window.__cmView?.cm?.state?.vim?.insertMode === true);
        await page.keyboard.insertText('Z');
        await page.keyboard.press('Escape');
        await expectEditorState(page, {
          text: testCase.expectedText,
          cursor: testCase.expectedCursor,
          insertMode: false,
        }, `Vim ${testCase.command} inserts expected text`);
      });
    }
  });

  test('non-Vim Home and End keys use logical line boundaries on short unwrapped lines', async ({ page }) => {
    await openHarness(page);
    await prepareEditor(page, {
      text: 'alpha beta\ngamma delta\nlast line',
      cursor: 'alpha beta\ngam'.length,
      vimMode: false,
    });

    await page.keyboard.press('Home');
    await expectEditorState(page, {
      text: 'alpha beta\ngamma delta\nlast line',
      cursor: 'alpha beta\n'.length,
    }, 'non-vim Home');

    await page.keyboard.press('End');
    await expectEditorState(page, {
      text: 'alpha beta\ngamma delta\nlast line',
      cursor: 'alpha beta\ngamma delta'.length,
    }, 'non-vim End');
  });

  test('non-Vim boundary and control inputs match the markdown text model', async ({ page }) => {
    await openHarness(page);

    await prepareEditor(page, {
      text: 'alpha beta',
      cursor: 'alpha '.length,
      vimMode: false,
    });
    await page.keyboard.press('Enter');
    await expectEditorState(page, {
      text: 'alpha \nbeta',
      cursor: 'alpha \n'.length,
    }, 'non-vim Enter inserts a newline');

    await prepareEditor(page, {
      text: 'abc',
      cursor: 1,
      vimMode: false,
    });
    await page.keyboard.insertText('\t');
    await expectEditorState(page, {
      text: 'a\tbc',
      cursor: 2,
    }, 'non-vim text input can insert a tab character');

    await prepareEditor(page, {
      text: 'abc',
      cursor: 0,
      vimMode: false,
    });
    await page.keyboard.press('Backspace');
    await expectEditorState(page, {
      text: 'abc',
      cursor: 0,
    }, 'non-vim Backspace at document start is a no-op');

    await prepareEditor(page, {
      text: 'abc',
      cursor: 3,
      vimMode: false,
    });
    await page.keyboard.press('Delete');
    await expectEditorState(page, {
      text: 'abc',
      cursor: 3,
    }, 'non-vim Delete at document end is a no-op');

    await prepareEditor(page, {
      text: 'alpha beta\ngamma delta\nlast line',
      cursor: 'alp'.length,
      vimMode: false,
    });
    await page.keyboard.press('ArrowDown');
    await expectEditorState(page, {
      text: 'alpha beta\ngamma delta\nlast line',
      cursor: 'alpha beta\ngam'.length,
    }, 'non-vim ArrowDown preserves the document-line column');
    await page.keyboard.press('ArrowUp');
    await expectEditorState(page, {
      text: 'alpha beta\ngamma delta\nlast line',
      cursor: 'alp'.length,
    }, 'non-vim ArrowUp returns to the previous document-line column');
  });

  test('non-Vim vertical arrows retain native movement within wrapped document lines', async ({ page }) => {
    await openHarness(page);
    await page.setViewportSize({ width: 360, height: 640 });
    const text = `${'wrapped words '.repeat(18)}end\nsecond document line`;
    await prepareEditor(page, {
      text,
      cursor: 0,
      vimMode: false,
    });

    await page.keyboard.press('ArrowDown');
    const wrappedState = await page.evaluate(() => {
      const view = window.__cmView;
      return {
        head: view.state.selection.main.head,
        lineNumber: view.state.doc.lineAt(view.state.selection.main.head).number,
      };
    });
    expect(wrappedState.lineNumber).toBe(1);
    expect(wrappedState.head).toBeGreaterThan(0);

    await page.keyboard.press('ArrowUp');
    await expectEditorState(page, {
      text,
      cursor: 0,
    }, 'non-vim ArrowUp returns within the wrapped document line');
  });

  test('non-Vim vertical arrows retain native movement when leaving a wrapped line', async ({ page }) => {
    await openHarness(page);
    await page.setViewportSize({ width: 360, height: 640 });
    const text = `${'wrapped words '.repeat(18)}end\nsecond document line with room`;
    await prepareEditor(page, {
      text,
      cursor: text.indexOf('\n') - 3,
      vimMode: false,
    });

    const before = await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.line(1);
      const range = view.state.selection.main;
      const visualFrom = view.moveToLineBoundary(range, false, true).head;
      const nativeTarget = view.moveVertically(range, true);
      return {
        visualFrom,
        lineFrom: line.from,
        nativeHead: nativeTarget.head,
        nativeLine: view.state.doc.lineAt(nativeTarget.head).number,
      };
    });
    expect(before.visualFrom).toBeGreaterThan(before.lineFrom);
    expect(before.nativeLine).toBe(2);

    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(() => window.__cmView.state.selection.main.head))
      .toBe(before.nativeHead);
  });

  test('non-Vim vertical arrows restore the goal column after crossing a short line', async ({ page }) => {
    await openHarness(page);
    const text = '0123456789\nx\nabcdefghij';
    await prepareEditor(page, {
      text,
      cursor: 8,
      vimMode: false,
    });

    await page.keyboard.press('ArrowDown');
    await expectEditorState(page, {
      text,
      cursor: '0123456789\nx'.length,
    }, 'non-vim ArrowDown clamps to the short line');

    await page.keyboard.press('ArrowDown');
    await expectEditorState(page, {
      text,
      cursor: '0123456789\nx\nabcdefgh'.length,
    }, 'non-vim ArrowDown restores the goal column');

    await page.keyboard.press('ArrowUp');
    await expectEditorState(page, {
      text,
      cursor: '0123456789\nx'.length,
    }, 'non-vim ArrowUp clamps to the short line');

    await page.keyboard.press('ArrowUp');
    await expectEditorState(page, {
      text,
      cursor: 8,
    }, 'non-vim ArrowUp restores the goal column');
  });

  test('non-Vim vertical arrows respect native targets across rendered block widgets', async ({ page }) => {
    await openHarness(page);
    const text = [
      'Before',
      '',
      '```mermaid',
      'graph TD',
      '  A --> B',
      '```',
      '',
      'After',
    ].join('\n');
    await prepareEditor(page, {
      text,
      cursor: 'Before\n'.length,
      vimMode: false,
    });
    await expect(page.locator('.cm-hybrid-mermaid-block')).toBeVisible();

    const nativeTargetLine = await page.evaluate(() => {
      const view = window.__cmView;
      const nativeTarget = view.moveVertically(view.state.selection.main, true);
      return view.state.doc.lineAt(nativeTarget.head).number;
    });
    expect(nativeTargetLine).toBeGreaterThan(3);

    await page.keyboard.press('ArrowDown');
    const actual = await page.evaluate(() => {
      const view = window.__cmView;
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        lineNumber: line.number,
        offset: view.state.selection.main.head - line.from,
      };
    });
    expect(actual).toEqual({
      lineNumber: nativeTargetLine,
      offset: 0,
    });
  });
});

async function openHarness(page: Page): Promise<void> {
  await page.goto('http://localhost:8979/test.html');
  await page.waitForFunction(() =>
    window.__mockMessages?.some((message) => message.type === 'ready'),
    { timeout: 10_000 },
  );
}

async function prepareEditor(
  page: Page,
  options: { text: string; cursor: number; vimMode: boolean },
): Promise<void> {
  await page.evaluate(({ text, vimMode }) => {
    window.postMessage({ type: 'setVimMode', enabled: vimMode }, '*');
    window.postMessage({ type: 'setText', text }, '*');
    window.__mockMessages = [];
  }, options);
  await page.waitForSelector('#editor .cm-content', { timeout: 10_000 });
  await page.waitForFunction(
    (text) => window.__cmView?.state.doc.toString() === text,
    options.text,
    { timeout: 5_000 },
  );
  await page.click('.cm-content');
  await setCursor(page, options.cursor);
}

async function enterVimNormalModeAt(page: Page, cursor: number): Promise<void> {
  await page.keyboard.press('Escape');
  await setCursor(page, cursor);
  await page.waitForFunction(() => window.__cmView?.cm?.state?.vim?.insertMode === false);
}

async function setCursor(page: Page, cursor: number): Promise<void> {
  await page.evaluate((position) => {
    const view = window.__cmView;
    view.dispatch({ selection: { anchor: position } });
    view.focus();
  }, cursor);
}

async function runVimCommandOperations(page: Page, testSet: VimCommandTestSet): Promise<void> {
  let model: ModelState = {
    text: testSet.initialText,
    cursor: testSet.initialCursor,
  };

  for (const [operationIndex, operation] of testSet.operations.entries()) {
    await runVimCommandOperation(page, operation);
    model = applyVimCommandOperation(model, operation);
    await expectEditorState(page, {
      text: model.text,
      cursor: model.cursor,
      insertMode: false,
    }, [
      `vim command seed ${testSet.seed}`,
      `after operation ${operationIndex + 1}/${testSet.operations.length}: ${formatOperation(operation)}`,
      `operations: ${testSet.operations.slice(0, operationIndex + 1).map(formatOperation).join(' ')}`,
    ].join('\n'));
  }
}

async function runVimCommandOperation(page: Page, operation: VimCommandOperation): Promise<void> {
  if (operation.kind === 'motion') {
    if (operation.command === 'gg') {
      await page.keyboard.press('g');
      await page.keyboard.press('g');
    } else if (operation.command === 'G') {
      await page.keyboard.press('Shift+G');
    } else {
      await page.keyboard.press(operation.command);
    }
    return;
  }

  if (operation.kind === 'delete') {
    if (operation.command === 'dd') {
      await page.keyboard.press('d');
      await page.keyboard.press('d');
    } else {
      await page.keyboard.press(operation.command);
    }
    return;
  }

  if (operation.kind === 'replace') {
    await page.keyboard.press('r');
    await page.keyboard.press(operation.text);
    return;
  }

  if (operation.command === 'A') {
    await page.keyboard.press('Shift+A');
  } else if (operation.command === 'O') {
    await page.keyboard.press('Shift+O');
  } else {
    await page.keyboard.press(operation.command);
  }
  await page.waitForFunction(() => window.__cmView?.cm?.state?.vim?.insertMode === true);
  await page.keyboard.insertText(operation.text);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__cmView?.cm?.state?.vim?.insertMode === false);
}

async function runNonVimOperations(page: Page, testSet: NonVimTestSet): Promise<void> {
  let model: ModelState = {
    text: testSet.initialText,
    cursor: testSet.initialCursor,
  };

  for (const [operationIndex, operation] of testSet.operations.entries()) {
    await runNonVimOperation(page, operation);
    model = applyNonVimOperation(model, operation);
    await expectEditorState(page, model, [
      `non-vim seed ${testSet.seed}`,
      `after operation ${operationIndex + 1}/${testSet.operations.length}: ${formatOperation(operation)}`,
      `operations: ${testSet.operations.slice(0, operationIndex + 1).map(formatOperation).join(' ')}`,
    ].join('\n'));
  }
}

async function runNonVimOperation(page: Page, operation: NonVimOperation): Promise<void> {
  if (operation.kind === 'insertText') {
    await page.keyboard.insertText(operation.text);
  } else if (operation.kind === 'type') {
    await page.keyboard.type(operation.text, { delay: 0 });
  } else if (operation.kind === 'replaceSelection') {
    await page.evaluate(({ from, to }) => {
      const view = window.__cmView;
      view.dispatch({ selection: { anchor: from, head: to } });
      view.focus();
    }, operation);
    if (operation.input === 'insertText') {
      await page.keyboard.insertText(operation.text);
    } else {
      await page.keyboard.type(operation.text, { delay: 0 });
    }
  } else {
    await page.keyboard.press(operation.key);
  }
}

async function expectEditorState(
  page: Page,
  expected: ModelState & { insertMode?: boolean },
  message: string,
): Promise<void> {
  await expect.poll(
    () => page.evaluate((expectedState) => {
      const view = window.__cmView;
      const actualText = view.state.doc.toString();
      const actualCursor = view.state.selection.main.head;
      const firstMismatch = firstDifferentIndex(actualText, expectedState.text);
      return {
        textMatches: actualText === expectedState.text,
        actualLength: actualText.length,
        expectedLength: expectedState.text.length,
        actualCursor,
        expectedCursor: expectedState.cursor,
        insertMode: view.cm?.state?.vim?.insertMode ?? false,
        expectedInsertMode: expectedState.insertMode ?? false,
        firstMismatch,
        actualSnippet: snippetAround(actualText, firstMismatch),
        expectedSnippet: snippetAround(expectedState.text, firstMismatch),
      };

      function firstDifferentIndex(left: string, right: string): number {
        const length = Math.min(left.length, right.length);
        for (let index = 0; index < length; index++) {
          if (left[index] !== right[index]) return index;
        }
        return left.length === right.length ? -1 : length;
      }

      function snippetAround(value: string, index: number): string {
        if (index < 0) return '';
        return value.slice(Math.max(0, index - 30), Math.min(value.length, index + 60));
      }
    }, expected),
    { message, timeout: 5_000 },
  ).toEqual({
    textMatches: true,
    actualLength: expected.text.length,
    expectedLength: expected.text.length,
    actualCursor: expected.cursor,
    expectedCursor: expected.cursor,
    insertMode: expected.insertMode ?? false,
    expectedInsertMode: expected.insertMode ?? false,
    firstMismatch: -1,
    actualSnippet: '',
    expectedSnippet: '',
  });
}

function generateVimCommandTestSets(
  count: number,
  operationsPerTestSet: number,
  seedBase: number,
): VimCommandTestSet[] {
  return Array.from({ length: count }, (_, index) => {
    const seed = seedBase + index;
    const random = seededRandom(seed);
    const initialText = VIM_TEXTS[randomInt(random, VIM_TEXTS.length)];
    const initialCursor = normalCursor(initialText, randomInt(random, initialText.length));
    const operations: VimCommandOperation[] = [];
    let model: ModelState = {
      text: initialText,
      cursor: initialCursor,
    };

    for (let operationIndex = 0; operationIndex < operationsPerTestSet; operationIndex++) {
      const operation = generateVimCommandOperation(random);
      operations.push(operation);
      model = applyVimCommandOperation(model, operation);
    }

    return {
      seed,
      initialText,
      initialCursor,
      operations,
      expectedText: model.text,
      expectedCursor: model.cursor,
    };
  });
}

function generateVimCommandOperation(random: () => number): VimCommandOperation {
  const roll = random();
  if (roll < 0.44) {
    const motions: VimMotion[] = ['h', 'l', '0', '$'];
    return { kind: 'motion', command: motions[randomInt(random, motions.length)] };
  }
  if (roll < 0.78) {
    const inserts: VimInsertCommand[] = ['i', 'a', 'A'];
    return {
      kind: 'insert',
      command: inserts[randomInt(random, inserts.length)],
      text: VIM_INSERT_TEXTS[randomInt(random, VIM_INSERT_TEXTS.length)],
    };
  }
  if (roll < 0.88) {
    return { kind: 'replace', text: VIM_REPLACE_TEXTS[randomInt(random, VIM_REPLACE_TEXTS.length)] };
  }
  const deletes: VimDeleteCommand[] = ['x', 'X'];
  return { kind: 'delete', command: deletes[randomInt(random, deletes.length)] };
}

function generateNonVimTestSets(
  count: number,
  operationsPerTestSet: number,
  seedBase: number,
): NonVimTestSet[] {
  return Array.from({ length: count }, (_, index) => {
    const seed = seedBase + index;
    const random = seededRandom(seed);
    const initialText = VIM_TEXTS[randomInt(random, VIM_TEXTS.length)];
    const initialCursor = randomInt(random, initialText.length + 1);
    const operations: NonVimOperation[] = [];
    let model: ModelState = {
      text: initialText,
      cursor: initialCursor,
    };

    for (let operationIndex = 0; operationIndex < operationsPerTestSet; operationIndex++) {
      const operation = generateNonVimOperation(random, model);
      operations.push(operation);
      model = applyNonVimOperation(model, operation);
    }

    return {
      seed,
      initialText,
      initialCursor,
      operations,
      expectedText: model.text,
      expectedCursor: model.cursor,
    };
  });
}

function generateNonVimOperation(random: () => number, model: ModelState): NonVimOperation {
  const roll = random();
  if (roll < 0.34) {
    return { kind: 'insertText', text: NON_VIM_INSERT_TEXTS[randomInt(random, NON_VIM_INSERT_TEXTS.length)] };
  }
  if (roll < 0.58) {
    return { kind: 'type', text: NON_VIM_TYPE_TEXTS[randomInt(random, NON_VIM_TYPE_TEXTS.length)] };
  }
  if (roll < 0.74) {
    const from = randomInt(random, model.text.length + 1);
    const to = randomInt(random, model.text.length + 1);
    const input = random() < 0.5 ? 'insertText' : 'type';
    return {
      kind: 'replaceSelection',
      from: Math.min(from, to),
      to: Math.max(from, to),
      text: input === 'insertText'
        ? NON_VIM_INSERT_TEXTS[randomInt(random, NON_VIM_INSERT_TEXTS.length)]
        : NON_VIM_TYPE_TEXTS[randomInt(random, NON_VIM_TYPE_TEXTS.length)],
      input,
    };
  }
  if (roll < 0.84) return { kind: 'press', key: 'ArrowLeft' };
  if (roll < 0.92) return { kind: 'press', key: 'ArrowRight' };
  if (roll < 0.96) return { kind: 'press', key: 'Backspace' };
  return { kind: 'press', key: 'Delete' };
}

function applyVimCommandOperation(model: ModelState, operation: VimCommandOperation): ModelState {
  if (operation.kind === 'motion') {
    return {
      ...model,
      cursor: applyVimMotion(model.text, model.cursor, operation.command),
    };
  }
  if (operation.kind === 'delete') {
    return applyVimDelete(model, operation.command);
  }
  if (operation.kind === 'replace') {
    return applyVimReplace(model, operation.text);
  }
  return applyVimInsert(model, operation.command, operation.text);
}

function applyVimMotion(text: string, cursor: number, motion: VimMotion): number {
  if (text.length === 0) return 0;
  const line = lineAt(text, normalCursor(text, cursor));
  if (motion === 'h') return Math.max(line.from, cursor - 1);
  if (motion === 'l') return Math.min(normalLineEnd(text, line), cursor + 1);
  if (motion === 'j') return moveVertical(text, cursor, 1);
  if (motion === 'k') return moveVertical(text, cursor, -1);
  if (motion === '0') return line.from;
  if (motion === '$') return normalLineEnd(text, line);
  if (motion === 'gg') return 0;
  if (motion === 'G') return lastLineStart(text);
  if (motion === 'w') return moveWordForward(text, cursor);
  if (motion === 'b') return moveWordBackward(text, cursor);
  return moveWordEnd(text, cursor);
}

function applyVimInsert(model: ModelState, command: VimInsertCommand, text: string): ModelState {
  const line = lineAt(model.text, model.cursor);
  let insertAt = model.cursor;
  let payload = text;
  let finalCursor = model.cursor;

  if (command === 'a') {
    insertAt = Math.min(line.to, model.cursor + 1);
    finalCursor = insertAt + text.length - 1;
  } else if (command === 'A') {
    insertAt = line.to;
    finalCursor = insertAt + text.length - 1;
  } else if (command === 'o') {
    insertAt = line.to;
    payload = `\n${text}`;
    finalCursor = line.to + text.length;
  } else if (command === 'O') {
    insertAt = line.from;
    payload = `${text}\n`;
    finalCursor = line.from + text.length - 1;
  } else {
    finalCursor = insertAt + text.length - 1;
  }

  const nextText = model.text.slice(0, insertAt) + payload + model.text.slice(insertAt);
  return {
    text: nextText,
    cursor: normalCursor(nextText, finalCursor),
  };
}

function applyVimDelete(model: ModelState, command: VimDeleteCommand): ModelState {
  if (model.text.length === 0) return model;
  const cursor = normalCursor(model.text, model.cursor);
  if (command === 'x') {
    const nextText = model.text.slice(0, cursor) + model.text.slice(cursor + 1);
    return {
      text: nextText,
      cursor: normalCursor(nextText, cursor),
    };
  }
  if (command === 'X') {
    const line = lineAt(model.text, cursor);
    if (cursor <= line.from) return { ...model, cursor };
    const nextText = model.text.slice(0, cursor - 1) + model.text.slice(cursor);
    return {
      text: nextText,
      cursor: normalCursor(nextText, cursor - 1),
    };
  }

  const line = lineAt(model.text, cursor);
  const deleteTo = line.to < model.text.length ? line.to + 1 : line.to;
  const nextText = model.text.slice(0, line.from) + model.text.slice(deleteTo);
  return {
    text: nextText,
    cursor: normalCursor(nextText, line.from),
  };
}

function applyVimReplace(model: ModelState, text: string): ModelState {
  if (model.text.length === 0) return model;
  const cursor = normalCursor(model.text, model.cursor);
  return {
    text: model.text.slice(0, cursor) + text + model.text.slice(cursor + 1),
    cursor,
  };
}

function applyNonVimOperation(model: ModelState, operation: NonVimOperation): ModelState {
  if (operation.kind === 'insertText' || operation.kind === 'type') {
    return {
      text: model.text.slice(0, model.cursor) + operation.text + model.text.slice(model.cursor),
      cursor: model.cursor + operation.text.length,
    };
  }
  if (operation.kind === 'replaceSelection') {
    return {
      text: model.text.slice(0, operation.from) + operation.text + model.text.slice(operation.to),
      cursor: operation.from + operation.text.length,
    };
  }
  if (operation.key === 'ArrowLeft') {
    return { ...model, cursor: Math.max(0, model.cursor - 1) };
  }
  if (operation.key === 'ArrowRight') {
    return { ...model, cursor: Math.min(model.text.length, model.cursor + 1) };
  }
  if (operation.key === 'Backspace') {
    if (model.cursor === 0) return model;
    return {
      text: model.text.slice(0, model.cursor - 1) + model.text.slice(model.cursor),
      cursor: model.cursor - 1,
    };
  }
  if (model.cursor === model.text.length) return model;
  return {
    text: model.text.slice(0, model.cursor) + model.text.slice(model.cursor + 1),
    cursor: model.cursor,
  };
}

function lineAt(text: string, cursor: number): { from: number; to: number } {
  const position = Math.max(0, Math.min(text.length, cursor));
  const from = text.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
  const newline = text.indexOf('\n', position);
  return { from, to: newline < 0 ? text.length : newline };
}

function normalLineEnd(text: string, line: { from: number; to: number }): number {
  return Math.max(line.from, Math.min(text.length === 0 ? 0 : text.length - 1, line.to - 1));
}

function normalCursor(text: string, cursor: number): number {
  if (text.length === 0) return 0;
  const clamped = Math.max(0, Math.min(text.length - 1, cursor));
  const line = lineAt(text, clamped);
  return Math.min(clamped, normalLineEnd(text, line));
}

function moveVertical(text: string, cursor: number, direction: -1 | 1): number {
  const line = lineAt(text, cursor);
  const column = cursor - line.from;
  const nextLine = direction > 0
    ? lineAt(text, Math.min(text.length - 1, line.to + 1))
    : lineAt(text, Math.max(0, line.from - 1));
  if (nextLine.from === line.from && nextLine.to === line.to) return cursor;
  return Math.min(nextLine.from + column, normalLineEnd(text, nextLine));
}

function lastLineStart(text: string): number {
  return text.lastIndexOf('\n') + 1;
}

function moveWordForward(text: string, cursor: number): number {
  if (text.length === 0) return 0;
  let position = Math.min(text.length - 1, cursor + 1);
  while (position < text.length && isWord(text[position])) position++;
  while (position < text.length && !isWord(text[position])) position++;
  return normalCursor(text, position >= text.length ? text.length - 1 : position);
}

function moveWordBackward(text: string, cursor: number): number {
  if (cursor <= 0) return 0;
  let position = cursor - 1;
  while (position > 0 && !isWord(text[position])) position--;
  while (position > 0 && isWord(text[position - 1])) position--;
  return normalCursor(text, position);
}

function moveWordEnd(text: string, cursor: number): number {
  if (text.length === 0) return 0;
  let position = Math.min(text.length - 1, cursor);
  if (isWord(text[position])) position++;
  while (position < text.length && !isWord(text[position])) position++;
  while (position < text.length && isWord(text[position])) position++;
  return normalCursor(text, Math.max(0, position - 1));
}

function isWord(value: string | undefined): boolean {
  return typeof value === 'string' && /[A-Za-z0-9_]/.test(value);
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function randomInt(random: () => number, upperExclusive: number): number {
  return Math.floor(random() * upperExclusive);
}

function formatTestSetLabel(
  label: string,
  seed: number,
  operations: Array<VimCommandOperation | NonVimOperation>,
): string {
  return [
    `${label} seed ${seed}`,
    `operations: ${operations.map(formatOperation).join(' ')}`,
  ].join('\n');
}

function formatOperation(operation: VimCommandOperation | NonVimOperation): string {
  if (operation.kind === 'motion' || operation.kind === 'delete') {
    return `${operation.kind}(${operation.command})`;
  }
  if (operation.kind === 'replace') {
    return `replace(${JSON.stringify(operation.text)})`;
  }
  if (operation.kind === 'insert') {
    return `insert(${operation.command},${JSON.stringify(operation.text)})`;
  }
  if (operation.kind === 'press') {
    return `press(${operation.key})`;
  }
  if (operation.kind === 'replaceSelection') {
    return `replaceSelection(${operation.from},${operation.to},${operation.input},${JSON.stringify(operation.text)})`;
  }
  return `${operation.kind}(${JSON.stringify(operation.text)})`;
}
