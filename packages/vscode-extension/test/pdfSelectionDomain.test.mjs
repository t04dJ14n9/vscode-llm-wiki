import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const selectionSource = join(
  packageRoot,
  '../pdf-editor/src/webview/domain/pdfSelection.ts',
);
const extractionSource = join(
  packageRoot,
  '../pdf-editor/src/webview/domain/pdfTextExtraction.ts',
);
const searchSource = join(
  packageRoot,
  '../pdf-editor/src/webview/domain/pdfSearch.ts',
);

function compileTsModule(filename, mocks = {}) {
  const source = readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(dirname(filename));
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    mod._compile(outputText, filename);
  } finally {
    Module._load = originalLoad;
  }
  return mod.exports;
}

const pdfSearch = compileTsModule(searchSource);
const pdfTextExtraction = compileTsModule(extractionSource);
const pdfSelection = compileTsModule(selectionSource, {
  './pdfSearch': pdfSearch,
  './pdfTextExtraction': pdfTextExtraction,
});

function textItem(content, left = 0, top = 0, width = 20, height = 10) {
  return {
    content,
    rect: {
      origin: { x: left, y: top },
      size: { width, height },
    },
  };
}

function glyph(left, top, width = 5, height = 10, offsetStart = 0) {
  return {
    offsetStart,
    offsetEnd: offsetStart + 1,
    sourceCharIndex: offsetStart,
    looseRect: [left, top, left + width, top + height],
    hitRect: [left, top, left + width, top + height],
  };
}

test('PDF carets have stable page, item, and character ordering', () => {
  const first = { page: 1, itemIndex: 8, offset: 4 };
  const second = { page: 2, itemIndex: 0, offset: 0 };
  const laterInItem = { ...first, offset: 5 };

  assert.ok(pdfSelection.comparePdfCarets(first, second) < 0);
  assert.ok(pdfSelection.comparePdfCarets(laterInItem, first) > 0);
  assert.deepEqual(pdfSelection.orderedPdfCarets(second, first), [first, second]);
  assert.equal(pdfSelection.samePdfCaret(first, { ...first }), true);
  assert.equal(pdfSelection.samePdfCaret(first, laterInItem), false);

  const backwardsSelection = { page: 2, anchor: second, focus: first };
  assert.equal(pdfSelection.pdfSelectionContainsPage(backwardsSelection, 1), true);
  assert.equal(pdfSelection.pdfSelectionContainsPage(backwardsSelection, 2), true);
  assert.equal(pdfSelection.pdfSelectionContainsPage(backwardsSelection, 3), false);
});

test('selection glyphs are grouped into visual lines independent of item order', () => {
  const firstLineRight = glyph(20, 10.5, 5, 10, 1);
  const secondLine = glyph(0, 32, 5, 9, 0);
  const firstLineLeft = glyph(0, 10, 5, 10, 0);

  const lines = pdfSelection.buildPdfSelectionLines([
    [firstLineRight, secondLine],
    [firstLineLeft],
  ]);

  assert.equal(lines.length, 2);
  assert.equal(lines[0].count, 2);
  assert.deepEqual(
    lines[0].glyphs.map(candidate => candidate.glyph),
    [firstLineLeft, firstLineRight],
  );
  assert.equal(lines[1].count, 1);
  assert.equal(lines[1].glyphs[0].glyph, secondLine);
});

test('selectable-item traversal skips empty and soft-hyphen marker runs', () => {
  const items = [
    textItem('render'),
    textItem('\u00ad'),
    textItem(''),
    textItem('ing'),
    textItem('next'),
  ];

  assert.equal(pdfSelection.nextSelectablePdfTextItem(items, 0), 3);
  assert.equal(pdfSelection.previousSelectablePdfTextItem(items, 4), 3);
  assert.equal(pdfSelection.previousSelectablePdfTextItem(items, 0), -1);
  assert.equal(pdfSelection.nextSelectablePdfTextItem(items, 4), -1);
});

test('word joining, separators, and line ranges follow extraction geometry', () => {
  const markerJoined = [
    textItem('render', 0, 0, 30),
    textItem('\u00ad', 0, 10),
    textItem('ing', 0, 20, 15),
  ];
  assert.equal(pdfSelection.pdfTextItemsJoinWord(markerJoined, 0, 2), true);
  assert.equal(pdfSelection.pdfTextItemSelectionSeparator(markerJoined, 0), false);

  const lineItems = [
    textItem('first', 0, 10, 20),
    textItem('\u00ad', 20, 10, 1),
    textItem('second', 24, 10.5, 24),
    textItem('next', 0, 30, 20),
  ];
  assert.equal(pdfSelection.pdfTextItemsJoinWord(lineItems, 0, 2), true);
  assert.deepEqual(pdfSelection.pdfTextLineItemRange(lineItems, 2), { from: 0, to: 2 });
  assert.equal(pdfSelection.pdfTextItemSelectionSeparator(lineItems, 2), true);

  assert.equal(pdfSelection.pdfTextLineItemRange([{ content: 'bad' }], 0), undefined);
  assert.equal(pdfSelection.isPdfWordCharacter('猫'), true);
  assert.equal(pdfSelection.isPdfWordCharacter('_'), true);
  assert.equal(pdfSelection.isPdfWordCharacter('-'), false);
});

test('selection search ranges map source offsets through normalized item gaps', () => {
  const items = [
    textItem('  Alpha'),
    textItem('Beta  '),
  ];

  const range = pdfSelection.pdfSearchRangeForSelection(items, true, 0, 4, 1, 2);
  assert.equal(range?.text, 'pha Be');
  assert.equal(
    range?.index.slice(range.from, range.to).map(character => character.value).join(''),
    'pha Be',
  );

  assert.equal(
    pdfSelection.pdfSearchRangeForSelection([textItem('   ')], true, 0, 0, 0, 3),
    undefined,
  );
});

test('portable text fragments include bounded surrounding context when offsets match', () => {
  const items = [
    textItem('intro words '),
    textItem('target'),
    textItem(' after words'),
  ];

  assert.deepEqual(
    pdfSelection.pdfTextFragmentForSelection(items, 1, 0, 1, 6, 'target'),
    {
      textStart: 'target',
      prefix: 'intro words',
      suffix: 'after words',
    },
  );
  assert.deepEqual(
    pdfSelection.pdfTextFragmentForSelection(items, 1, 0, 1, 6, 'different'),
    { textStart: 'different' },
  );
});

test('text-fragment context respects word boundaries and the 32-character cap', () => {
  assert.equal(pdfSelection.boundedTextFragmentPrefix('  one   two  '), 'one two');
  assert.equal(pdfSelection.boundedTextFragmentSuffix('  one   two  '), 'one two');

  const longContext = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda';
  const prefix = pdfSelection.boundedTextFragmentPrefix(longContext);
  const suffix = pdfSelection.boundedTextFragmentSuffix(longContext);
  assert.ok(prefix);
  assert.ok(suffix);
  assert.ok(Array.from(prefix).length <= 32);
  assert.ok(Array.from(suffix).length <= 32);
  assert.equal(longContext.endsWith(prefix), true);
  assert.equal(longContext.startsWith(suffix), true);

  assert.equal(pdfSelection.boundedTextFragmentPrefix('x'.repeat(40)), undefined);
  assert.equal(pdfSelection.boundedTextFragmentSuffix('x'.repeat(40)), undefined);
});
