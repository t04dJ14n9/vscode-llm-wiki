import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extractionSource = join(
  packageRoot,
  '../pdf-editor/src/webview/domain/pdfTextExtraction.ts',
);

function loadExtractionModule() {
  const source = readFileSync(extractionSource, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: extractionSource,
  });
  const mod = new Module(extractionSource);
  mod.filename = extractionSource;
  mod.paths = Module._nodeModulePaths(dirname(extractionSource));
  mod._compile(outputText, extractionSource);
  return mod.exports;
}

const extraction = loadExtractionModule();

function rect(left, top, width = 10, height = 8) {
  return {
    origin: { x: left, y: top },
    size: { width, height },
  };
}

test('PDF text rectangles accept finite numeric coordinates and reject malformed geometry', () => {
  assert.deepEqual(extraction.finitePdfTextRect({
    origin: { x: '12.5', y: 4 },
    size: { width: '0', height: 8 },
  }), {
    left: 12.5,
    top: 4,
    width: 0,
    height: 8,
  });

  assert.equal(extraction.finitePdfTextRect(rect(0, 0, -1, 8)), undefined);
  assert.equal(extraction.finitePdfTextRect(rect(0, 0, 10, 0)), undefined);
  assert.equal(extraction.finitePdfTextRect(rect(Number.POSITIVE_INFINITY, 0)), undefined);
  assert.equal(extraction.finitePdfTextRect(undefined), undefined);
});

test('basic PDF text extraction sanitizes artifacts, orders reading flow, and creates glyph fallbacks', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'B', rect: rect(20, 0) },
    { content: 'A\u200b', rect: rect(0, 0) },
    { content: 'ignored', rect: rect(0, 10, -1, 8) },
    { content: '😀', rect: rect(0, 20, 20, 8) },
    { content: '\u0001\u2060', rect: rect(0, 30) },
  ]);

  assert.deepEqual(normalized.map(item => item.content), ['A', 'B', '😀']);
  assert.deepEqual(normalized[0].selectionGlyphs, [{
    offsetStart: 0,
    offsetEnd: 1,
    sourceCharIndex: 100_000,
    looseRect: [0, 0, 10, 8],
    hitRect: [0, 0, 10, 8],
  }]);
  assert.deepEqual(normalized[2].selectionGlyphs, [{
    offsetStart: 0,
    offsetEnd: 2,
    sourceCharIndex: 300_000,
    looseRect: [0, 20, 20, 28],
    hitRect: [0, 20, 20, 28],
  }]);
});

test('run extraction uses source characters and exact PDF glyph geometry when available', () => {
  const pageGlyphs = [];
  pageGlyphs[5] = {
    origin: { x: 10, y: 20 },
    size: { width: 0, height: 8 },
    tightOrigin: { x: 10.1, y: 20.2 },
    tightSize: { width: 0, height: 7 },
  };
  pageGlyphs[6] = {
    origin: { x: 20, y: 20 },
    size: { width: 5, height: 8 },
  };
  pageGlyphs[7] = {
    origin: { x: 30, y: 20 },
    size: { width: 6, height: 8 },
  };

  const normalized = extraction.normalizePdfTextRuns([
    {
      text: 'corrupt source',
      charIndex: 5,
      charCount: 3,
      rect: rect(10, 20, 26, 8),
      fontSize: 12,
      font: { familyName: '  Charter  ', weight: 600, italic: true },
    },
  ], pageGlyphs, new Map([[0, ['A', '\u200b', 'B']]]));

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].content, 'AB');
  assert.deepEqual(normalized[0].font, {
    family: 'Charter',
    size: 12,
    weight: 600,
    italic: true,
  });
  assert.deepEqual(normalized[0].selectionGlyphs, [
    {
      offsetStart: 0,
      offsetEnd: 1,
      sourceCharIndex: 5,
      looseRect: [10, 20, 10.25, 28],
      hitRect: [10.1, 20.2, 10.35, 27.2],
    },
    {
      offsetStart: 1,
      offsetEnd: 2,
      sourceCharIndex: 7,
      looseRect: [30, 20, 36, 28],
      hitRect: [30, 20, 36, 28],
    },
  ]);
});

test('missing glyph data falls back to evenly partitioned run geometry', () => {
  const [normalized] = extraction.normalizePdfTextRuns([
    {
      text: 'A😀',
      charIndex: 40,
      rect: rect(4, 6, 30, 10),
      font: { name: 'Fallback' },
    },
  ]);

  assert.equal(normalized.content, 'A😀');
  assert.deepEqual(normalized.selectionGlyphs, [
    {
      offsetStart: 0,
      offsetEnd: 1,
      sourceCharIndex: 40,
      looseRect: [4, 6, 19, 16],
      hitRect: [4, 6, 19, 16],
    },
    {
      offsetStart: 1,
      offsetEnd: 3,
      sourceCharIndex: 41,
      looseRect: [19, 6, 34, 16],
      hitRect: [19, 6, 34, 16],
    },
  ]);
});

test('word-join artifacts survive as non-selectable soft-hyphen markers', () => {
  const normalized = extraction.normalizePdfTextRuns([
    { text: '', charCount: 1, rect: rect(0, 0) },
    { text: '\ufffe', charIndex: 2, charCount: 1, rect: rect(0, 10) },
    { text: '\u0001', charCount: 1, rect: rect(0, 20) },
  ]);

  assert.deepEqual(normalized.map(item => item.content), ['\u00ad', '\u00ad']);
  assert.deepEqual(normalized.map(item => item.selectionGlyphs), [[], []]);
  assert.equal(extraction.isPdfWordJoinMarker('\u00ad\u00ad'), true);
  assert.equal(extraction.isPdfWordJoinMarker(''), false);
  assert.equal(extraction.isPdfWordJoinMarker(`a\u00ad`), false);
  assert.equal(extraction.endsWithPdfWordJoinMarker(`word\u00ad`), true);
  assert.equal(extraction.endsWithPdfWordJoinMarker('word'), false);
});

test('column detection keeps each PDF reading lane contiguous', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'left 1', rect: rect(0, 0, 20, 8) },
    { content: 'left 2', rect: rect(0, 10, 20, 8) },
    { content: 'left 3', rect: rect(0, 20, 20, 8) },
    { content: 'right 1', rect: rect(100, 0, 20, 8) },
    { content: 'right 2', rect: rect(100, 10, 20, 8) },
    { content: 'right 3', rect: rect(100, 20, 20, 8) },
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'left 1',
    'left 2',
    'left 3',
    'right 1',
    'right 2',
    'right 3',
  ]);
});
