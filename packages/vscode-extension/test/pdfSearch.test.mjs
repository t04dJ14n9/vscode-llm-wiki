import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharedPdfRoot = resolve(packageRoot, '../pdf-editor');

function loadTsModule(relativePath) {
  const filename = join(sharedPdfRoot, relativePath);
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
  mod._compile(outputText, filename);
  return mod.exports;
}

function textItem(content, left = 0, top = 0, width = 20, height = 10) {
  return {
    content,
    rect: {
      origin: { x: left, y: top },
      size: { width, height },
    },
  };
}

function indexText(index) {
  return index.map(char => char.value).join('');
}

const pdfSearch = loadTsModule('src/webview/domain/pdfSearch.ts');

test('search index removes PDF extraction artifacts and supports an ASCII-only fallback', () => {
  const textRects = [textItem(`A\u0001\u009f\uE000éB`)];

  assert.equal(
    indexText(pdfSearch.buildPdfSearchIndex(textRects, false, false, false, true)),
    'aéb',
  );
  assert.equal(
    indexText(pdfSearch.buildPdfSearchIndex(textRects, false, true, false, true)),
    'ab',
  );
});

test('search normalization folds case and diacritics while preserving exact mode', () => {
  assert.equal(
    pdfSearch.normalizeSearchText('  CAFÉ\tΣς  ', false, false),
    'cafe σσ',
  );
  assert.equal(
    pdfSearch.normalizeSearchText('  CAFÉ\tΣς  ', true, true),
    'CAFÉ Σς',
  );
  assert.equal(pdfSearch.isAsciiSearchQuery('game engine'), true);
  assert.equal(pdfSearch.isAsciiSearchQuery('café'), false);
});

test('whole-word matching respects Unicode letters, numbers, and underscores', () => {
  assert.equal(pdfSearch.isWholeWordSearchMatch('cat catalog', 0, 3), true);
  assert.equal(pdfSearch.isWholeWordSearchMatch('cat catalog', 4, 3), false);
  assert.equal(pdfSearch.isWholeWordSearchMatch('猫cat dog', 1, 3), false);
  assert.equal(pdfSearch.isWholeWordSearchMatch('_cat dog', 1, 3), false);
  assert.equal(pdfSearch.isWholeWordSearchMatch('dog cat!', 4, 3), true);
});

test('geometry gaps distinguish separated words and lines without splitting hyphen joins', () => {
  assert.equal(
    indexText(pdfSearch.buildPdfSearchIndex([
      textItem('near', 0, 0, 20, 10),
      textItem('by', 21, 0, 10, 10),
    ], 'geometry', false, false, true)),
    'nearby',
  );

  assert.equal(
    indexText(pdfSearch.buildPdfSearchIndex([
      textItem('near', 0, 0, 20, 10),
      textItem('word', 24, 0, 20, 10),
      textItem('next', 0, 20, 20, 10),
    ], 'geometry', false, false, true)),
    'near word next',
  );

  assert.equal(
    indexText(pdfSearch.buildPdfSearchIndex([
      textItem('render-', 0, 0, 30, 10),
      textItem('ing', 0, 20, 15, 10),
    ], 'geometry', false, false, true)),
    'render-ing',
  );
});

test('search ranges map normalized matches back to source text items', () => {
  const index = pdfSearch.buildPdfSearchIndex([
    textItem('Hello'),
    textItem('World'),
  ], true, false, false, true);

  assert.equal(indexText(index), 'hello world');
  assert.deepEqual(pdfSearch.segmentsForSearchRange(index, 3, 8), [
    { textItemIndex: 0, from: 3, to: 5 },
    { textItemIndex: 1, from: 0, to: 2 },
  ]);
});

test('text fragments use prefix and suffix context to select the intended duplicate', () => {
  const textRects = [
    textItem('alpha '),
    textItem('target'),
    textItem(' omega '),
    textItem('beta '),
    textItem('target'),
    textItem(' gamma'),
  ];

  assert.deepEqual(pdfSearch.segmentsForPdfTextFragment(textRects, {
    textStart: 'TARGET',
    prefix: 'beta',
    suffix: 'gamma',
  }), [
    { textItemIndex: 4, from: 0, to: 6 },
  ]);

  assert.deepEqual(pdfSearch.segmentsForPdfTextFragment(textRects, {
    textStart: 'missing',
  }), []);
});
