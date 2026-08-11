import { expect, test, type Page } from '@playwright/test';

type ModelState = {
  text: string;
  cursor: number;
};

type EditOperation =
  | { kind: 'insertText'; text: string }
  | { kind: 'type'; text: string }
  | { kind: 'press'; key: 'ArrowLeft' | 'ArrowRight' | 'Backspace' | 'Delete' };

type EditTestSet = {
  seed: number;
  initialText: string;
  initialCursor: number;
  operations: EditOperation[];
  expectedText: string;
  expectedCursor: number;
};

type BacktickNoopOperation =
  | { kind: 'rawBackticks'; text: string }
  | { kind: 'keyBackquote'; count: number };

type BacktickNoopTestSet = {
  seed: number;
  initialText: string;
  initialCursor: number;
  operations: BacktickNoopOperation[];
};

const PLAIN_TESTSET_COUNT = 48;
const PLAIN_OPERATIONS_PER_TESTSET = 160;
const VIM_INSERT_TESTSET_COUNT = 32;
const VIM_INSERT_OPERATIONS_PER_TESTSET = 140;
const VIM_NORMAL_BACKTICK_TESTSET_COUNT = 128;

const INITIAL_TEXTS = [
  'alpha beta\ngamma delta\nplain words',
  '# Scratch Note\n\nLinks stay editable beside [[Wiki Note]] and [raw link](raw/pdf/paper.pdf#page=4).',
  'Inline `code`, **bold**, ==highlight==, and $a + b = c$ all share a paragraph.',
  'Before fence\n\n```ts\nconst value = 1;\n```\n\nAfter fence',
];

const INSERT_TEXT_FRAGMENTS = [
  'a',
  ' beta',
  ' ',
  '`',
  '``',
  '```',
  ' **bold** ',
  ' *italic* ',
  ' ==mark== ',
  ' [[Daily Note]] ',
  ' [paper](raw/pdf/paper.pdf#page=7) ',
  ' $x + y = z$ ',
  ' ## Generated Heading ',
  ' > generated quote ',
  ' ```ts ',
  ' const n = 1; ',
  ' a^2 + b^2 = c^2 ',
];

const GENERATED_MARKDOWN_TEXT_FRAGMENTS = [
  ...INSERT_TEXT_FRAGMENTS,
  '\n',
  '\n## Generated Heading\n',
  '\n> generated quote\n',
  '\n```ts\nconst n = 1;\n```\n',
  '\n$$\na^2 + b^2 = c^2\n$$\n',
];

const TYPE_TEXT_FRAGMENTS = [
  'a',
  ' beta',
  ' ',
  '`',
  '```',
  '**',
  '[]',
  '()',
  '$x$',
  '#',
  '-',
  '_',
];

test.describe('Human Learning Markdown deterministic keystroke fuzzing', () => {
  test.setTimeout(180_000);

  test('Vim inserts after a rendered wikilink without entering its closing brackets', async ({ page }) => {
    await openHarness(page);
    const text = 'Links stay editable beside [[Wiki Note]] and more.';
    const cursor = text.indexOf(']]') + 2;
    await prepareEditor(page, { text, cursor, vimMode: true });
    await enterVimInsertModeAt(page, cursor);
    await page.keyboard.type('`', { delay: 0 });

    await expectEditorState(page, {
      text: 'Links stay editable beside [[Wiki Note]]` and more.',
      cursor: cursor + 1,
    }, 'Vim insert at the half-open end of a rendered wikilink');
  });

  const plainBatches = chunkTestSets(generateEditTestSets({
    count: PLAIN_TESTSET_COUNT,
    operationsPerTestSet: PLAIN_OPERATIONS_PER_TESTSET,
    seedBase: 0x5000,
  }), 12);
  for (const [batchIndex, testSets] of plainBatches.entries()) {
    test(`plain editor keystroke sequences match the generated final markdown text model (batch ${batchIndex + 1}/${plainBatches.length})`, async ({ page }) => {
      await openHarness(page);

      for (const testSet of testSets) {
        await test.step(`plain seed ${testSet.seed}`, async () => {
          await prepareEditor(page, {
            text: testSet.initialText,
            cursor: testSet.initialCursor,
            vimMode: false,
          });
          await runEditOperations(page, testSet, 'plain');
          await expectEditorMatches(page, testSet, 'plain');
        });
      }
    });
  }

  const vimInsertBatches = chunkTestSets(generateEditTestSets({
    count: VIM_INSERT_TESTSET_COUNT,
    operationsPerTestSet: VIM_INSERT_OPERATIONS_PER_TESTSET,
    seedBase: 0x7000,
    keepInitialCursorInsideText: true,
  }), 16);
  for (const [batchIndex, testSets] of vimInsertBatches.entries()) {
    test(`Vim insert-mode keystroke sequences match the generated final markdown text model (batch ${batchIndex + 1}/${vimInsertBatches.length})`, async ({ page }) => {
      await openHarness(page);

      for (const testSet of testSets) {
        await test.step(`vim insert seed ${testSet.seed}`, async () => {
          await prepareEditor(page, {
            text: testSet.initialText,
            cursor: testSet.initialCursor,
            vimMode: true,
          });
          await enterVimInsertModeAt(page, testSet.initialCursor);
          await runEditOperations(page, testSet, 'vim insert');
          await expectEditorMatches(page, testSet, 'vim insert');
        });
      }
    });
  }

  test('Vim normal-mode raw backtick sequences are no-ops for every generated testset', async ({ page }) => {
    await openHarness(page);

    const testSets = generateBacktickNoopTestSets(VIM_NORMAL_BACKTICK_TESTSET_COUNT, 0x9000);

    for (const testSet of testSets) {
      await test.step(`vim normal backticks seed ${testSet.seed}`, async () => {
        await prepareEditor(page, {
          text: testSet.initialText,
          cursor: testSet.initialCursor,
          vimMode: true,
        });
        await enterVimNormalModeAt(page, testSet.initialCursor);
        await runBacktickNoopOperations(page, testSet.operations);
        await expectEditorMatches(page, {
          ...testSet,
          operations: [],
          expectedText: testSet.initialText,
          expectedCursor: testSet.initialCursor,
        }, 'vim normal backtick noop');
      });
    }
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

async function enterVimInsertModeAt(page: Page, cursor: number): Promise<void> {
  await enterVimNormalModeAt(page, cursor);
  await page.keyboard.press('i');
  await page.waitForFunction(() => window.__cmView?.cm?.state?.vim?.insertMode === true);
}

async function setCursor(page: Page, cursor: number): Promise<void> {
  await page.evaluate((position) => {
    const view = window.__cmView;
    view.dispatch({ selection: { anchor: position } });
    view.focus();
  }, cursor);
}

async function runEditOperations(
  page: Page,
  testSet: EditTestSet,
  label: string,
): Promise<void> {
  let model: ModelState = {
    text: testSet.initialText,
    cursor: testSet.initialCursor,
  };

  for (const [operationIndex, operation] of testSet.operations.entries()) {
    if (operation.kind === 'insertText') {
      await page.keyboard.insertText(operation.text);
    } else if (operation.kind === 'type') {
      await page.keyboard.type(operation.text, { delay: 0 });
    } else {
      await page.keyboard.press(operation.key);
    }

    model = applyEditOperation(model, operation);
    await expectEditorState(page, model, [
      `${label} seed ${testSet.seed}`,
      `after operation ${operationIndex + 1}/${testSet.operations.length}: ${formatOperation(operation)}`,
      `operations: ${testSet.operations.slice(0, operationIndex + 1).map(formatOperation).join(' ')}`,
    ].join('\n'));
  }
}

async function runBacktickNoopOperations(page: Page, operations: BacktickNoopOperation[]): Promise<void> {
  for (const operation of operations) {
    if (operation.kind === 'rawBackticks') {
      await page.keyboard.insertText(operation.text);
    } else {
      for (let index = 0; index < operation.count; index++) {
        await page.keyboard.press('Backquote');
      }
    }
  }
}

async function expectEditorMatches(
  page: Page,
  testSet: EditTestSet,
  label: string,
): Promise<void> {
  const expected = {
    text: testSet.expectedText,
    cursor: testSet.expectedCursor,
  };
  const message = [
    `${label} seed ${testSet.seed}`,
    `operations: ${testSet.operations.map(formatOperation).join(' ')}`,
  ].join('\n');

  await expectEditorState(page, expected, message);
}

async function expectEditorState(
  page: Page,
  expected: { text: string; cursor: number },
  message: string,
): Promise<void> {
  await expect.poll(
    () => page.evaluate(({ text, cursor }) => {
      const view = window.__cmView;
      const actualText = view.state.doc.toString();
      const actualCursor = view.state.selection.main.head;
      const firstMismatch = firstDifferentIndex(actualText, text);
      return {
        textMatches: actualText === text,
        actualLength: actualText.length,
        expectedLength: text.length,
        actualCursor,
        expectedCursor: cursor,
        firstMismatch,
        actualSnippet: snippetAround(actualText, firstMismatch),
        expectedSnippet: snippetAround(text, firstMismatch),
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
    firstMismatch: -1,
    actualSnippet: '',
    expectedSnippet: '',
  });
}

function generateEditTestSets(options: {
  count: number;
  operationsPerTestSet: number;
  seedBase: number;
  keepInitialCursorInsideText?: boolean;
}): EditTestSet[] {
  return Array.from({ length: options.count }, (_, index) => {
    const seed = options.seedBase + index;
    const random = seededRandom(seed);
    const initialText = INITIAL_TEXTS[randomInt(random, INITIAL_TEXTS.length)];
    const maxInitialCursor = options.keepInitialCursorInsideText
      ? Math.max(0, initialText.length - 1)
      : initialText.length;
    const initialCursor = randomInt(random, maxInitialCursor + 1);
    const operations: EditOperation[] = [];
    let model: ModelState = { text: initialText, cursor: initialCursor };

    for (let operationIndex = 0; operationIndex < options.operationsPerTestSet; operationIndex++) {
      const operation = generateEditOperation(random, model);
      operations.push(operation);
      model = applyEditOperation(model, operation);
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

function generateBacktickNoopTestSets(count: number, seedBase: number): BacktickNoopTestSet[] {
  return Array.from({ length: count }, (_, index) => {
    const seed = seedBase + index;
    const random = seededRandom(seed);
    const text = generateMarkdownText(random);
    const operations: BacktickNoopOperation[] = [];
    const operationCount = 4 + randomInt(random, 8);

    for (let operationIndex = 0; operationIndex < operationCount; operationIndex++) {
      if (random() < 0.55) {
        operations.push({ kind: 'rawBackticks', text: '`'.repeat(1 + randomInt(random, 6)) });
      } else {
        operations.push({ kind: 'keyBackquote', count: 1 + randomInt(random, 6) });
      }
    }

    return {
      seed,
      initialText: text,
      initialCursor: randomInt(random, text.length + 1),
      operations,
    };
  });
}

function generateEditOperation(random: () => number, model: ModelState): EditOperation {
  const roll = random();
  const preferDeletion = model.text.length > 4_000;

  if (!preferDeletion && roll < 0.48) {
    return {
      kind: 'insertText',
      text: INSERT_TEXT_FRAGMENTS[randomInt(random, INSERT_TEXT_FRAGMENTS.length)],
    };
  }

  if (!preferDeletion && roll < 0.72) {
    return {
      kind: 'type',
      text: TYPE_TEXT_FRAGMENTS[randomInt(random, TYPE_TEXT_FRAGMENTS.length)],
    };
  }

  if (roll < 0.865) return { kind: 'press', key: 'ArrowLeft' };
  if (roll < 0.93) return { kind: 'press', key: 'ArrowRight' };
  if (roll < 0.975) return { kind: 'press', key: 'Backspace' };
  return { kind: 'press', key: 'Delete' };
}

function applyEditOperation(model: ModelState, operation: EditOperation): ModelState {
  if (operation.kind === 'insertText' || operation.kind === 'type') {
    const nextText = model.text.slice(0, model.cursor) + operation.text + model.text.slice(model.cursor);
    return {
      text: nextText,
      cursor: model.cursor + operation.text.length,
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

function generateMarkdownText(random: () => number): string {
  const model: ModelState = {
    text: INITIAL_TEXTS[randomInt(random, INITIAL_TEXTS.length)],
    cursor: 0,
  };
  let current = model;
  for (let index = 0; index < 40; index++) {
    current = applyEditOperation(current, {
      kind: 'insertText',
      text: GENERATED_MARKDOWN_TEXT_FRAGMENTS[randomInt(random, GENERATED_MARKDOWN_TEXT_FRAGMENTS.length)],
    });
  }
  return current.text;
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

function chunkTestSets<T>(testSets: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < testSets.length; index += size) {
    chunks.push(testSets.slice(index, index + size));
  }
  return chunks;
}

function formatOperation(operation: EditOperation | BacktickNoopOperation): string {
  if (operation.kind === 'insertText' || operation.kind === 'type') {
    return `${operation.kind}(${JSON.stringify(operation.text)})`;
  }
  if (operation.kind === 'rawBackticks') {
    return `rawBackticks(${operation.text.length})`;
  }
  if (operation.kind === 'keyBackquote') {
    return `keyBackquote(${operation.count})`;
  }
  return operation.key;
}
