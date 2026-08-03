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

test('column detection reconnects a body lane after vertically overlapping margin captions', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'body intro', rect: rect(0, 0, 60, 8) },
    { content: 'body reference', rect: rect(0, 10, 60, 8) },
    { content: 'caption 1', rect: rect(80, 16, 20, 8) },
    { content: 'caption 2', rect: rect(80, 26, 20, 8) },
    { content: 'caption 3', rect: rect(80, 36, 20, 8) },
    { content: 'body line 3', rect: rect(0, 20, 60, 8) },
    { content: 'body line 4', rect: rect(0, 30, 60, 8) },
    { content: 'body line 5', rect: rect(0, 40, 60, 8) },
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'body intro',
    'body reference',
    'body line 3',
    'body line 4',
    'body line 5',
    'caption 1',
    'caption 2',
    'caption 3',
  ]);
});

test('a full-width heading does not bridge otherwise separate PDF text lanes', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'full-width heading', rect: rect(0, 0, 120, 8) },
    { content: 'left 1', rect: rect(0, 20, 50, 8) },
    { content: 'left 2', rect: rect(0, 30, 50, 8) },
    { content: 'left 3', rect: rect(0, 40, 50, 8) },
    { content: 'right 1', rect: rect(70, 20, 50, 8) },
    { content: 'right 2', rect: rect(70, 30, 50, 8) },
    { content: 'right 3', rect: rect(70, 40, 50, 8) },
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'full-width heading',
    'left 1',
    'left 2',
    'left 3',
    'right 1',
    'right 2',
    'right 3',
  ]);
});

test('source-adjacent runs on one visual line stay together across a wide word gap', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'Page', rect: rect(0, 0, 10, 8) },
    { content: 'Two', rect: rect(34, 0, 10, 8) },
    { content: 'lower line', rect: rect(0, 20, 44, 8) },
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'Page',
    'Two',
    'lower line',
  ]);
});

test('row-major source order still keeps neighboring PDF columns separate', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'left 1', rect: rect(0, 0, 50, 8) },
    { content: 'right 1', rect: rect(70, 0, 50, 8) },
    { content: 'left 2', rect: rect(0, 10, 50, 8) },
    { content: 'right 2', rect: rect(70, 10, 50, 8) },
    { content: 'left 3', rect: rect(0, 20, 50, 8) },
    { content: 'right 3', rect: rect(70, 20, 50, 8) },
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

test('a one-line neighboring caption does not rejoin a multi-line body lane', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'body 1', rect: rect(0, 0, 50, 8) },
    { content: 'one-line caption', rect: rect(70, 0, 50, 8) },
    { content: 'body 2', rect: rect(0, 10, 50, 8) },
    { content: 'body 3', rect: rect(0, 20, 50, 8) },
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'body 1',
    'body 2',
    'body 3',
    'one-line caption',
  ]);
});

test('row-major source order keeps three neighboring PDF columns contiguous', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'left 1', rect: rect(0, 0, 30, 8) },
    { content: 'middle 1', rect: rect(50, 0, 30, 8) },
    { content: 'right 1', rect: rect(100, 0, 30, 8) },
    { content: 'left 2', rect: rect(0, 10, 30, 8) },
    { content: 'middle 2', rect: rect(50, 10, 30, 8) },
    { content: 'right 2', rect: rect(100, 10, 30, 8) },
    { content: 'left 3', rect: rect(0, 20, 30, 8) },
    { content: 'middle 3', rect: rect(50, 20, 30, 8) },
    { content: 'right 3', rect: rect(100, 20, 30, 8) },
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'left 1',
    'left 2',
    'left 3',
    'middle 1',
    'middle 2',
    'middle 3',
    'right 1',
    'right 2',
    'right 3',
  ]);
});

test('a fragmented full-width heading stays ahead of row-major columns', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'Chapter', rect: rect(0, 0, 50, 14) },
    { content: 'One', rect: rect(51, 0, 25, 14) },
    { content: 'left 1', rect: rect(0, 24, 45, 8) },
    { content: 'right 1', rect: rect(70, 24, 45, 8) },
    { content: 'left 2', rect: rect(0, 34, 45, 8) },
    { content: 'right 2', rect: rect(70, 34, 45, 8) },
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'Chapter',
    'One',
    'left 1',
    'left 2',
    'right 1',
    'right 2',
  ]);
});

test('column lanes tolerate small coordinate noise and mixed text heights', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'left 1', rect: rect(-0.3, 0, 50, 8) },
    { content: 'right 1', rect: rect(70.2, 0, 50, 8) },
    { content: 'left 2', rect: rect(1.5, 10.4, 49, 8.5) },
    { content: 'right 2', rect: rect(68.8, 10.1, 51, 7.5) },
    { content: 'left 3', rect: rect(0.2, 21, 50, 8) },
    { content: 'right 3', rect: rect(70.4, 20.7, 50, 8) },
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

test('touching and near-touching source runs remain in sentence order', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'Hello', rect: rect(0, 0, 20, 8) },
    { content: ',', rect: rect(20, 0, 2, 8) },
    { content: 'world', rect: rect(22.1, 0, 20, 8) },
    { content: 'next line', rect: rect(0, 10, 42, 8) },
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'Hello',
    ',',
    'world',
    'next line',
  ]);
});

test('alternating body and caption source runs still form separate selection lanes', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'body 1', rect: rect(0, 0, 50, 8) },
    { content: 'caption 1', rect: rect(75, 0, 20, 8) },
    { content: 'body 2', rect: rect(0, 10, 50, 8) },
    { content: 'caption 2', rect: rect(75, 10, 20, 8) },
    { content: 'body 3', rect: rect(0, 20, 50, 8) },
    { content: 'caption 3', rect: rect(75, 20, 20, 8) },
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'body 1',
    'body 2',
    'body 3',
    'caption 1',
    'caption 2',
    'caption 3',
  ]);
});

test('a tightly adjacent multi-line caption does not enter the body selection lane', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'body 1', rect: rect(0, 0, 50, 8) },
    { content: 'caption 1', rect: rect(60, 0, 20, 8) },
    { content: 'caption 2', rect: rect(60, 10, 20, 8) },
    { content: 'caption 3', rect: rect(60, 20, 20, 8) },
    { content: 'body 2', rect: rect(0, 10, 50, 8) },
    { content: 'body 3', rect: rect(0, 20, 50, 8) },
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'body 1',
    'body 2',
    'body 3',
    'caption 1',
    'caption 2',
    'caption 3',
  ]);
});
