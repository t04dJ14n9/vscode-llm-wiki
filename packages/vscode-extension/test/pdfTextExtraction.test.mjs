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
const searchSource = join(
  packageRoot,
  '../pdf-editor/src/webview/domain/pdfSearch.ts',
);

function loadTypeScriptModule(filename) {
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

const extraction = loadTypeScriptModule(extractionSource);
const pdfSearch = loadTypeScriptModule(searchSource);

function rect(left, top, width = 10, height = 8) {
  return {
    origin: { x: left, y: top },
    size: { width, height },
  };
}

function terminalGhostGlyph(runRect, {
  looseWidth = 3,
  looseHeight = runRect.size.height,
  looseRight = runRect.origin.x + runRect.size.width,
  tightWidth = 2,
  tightHeight = 1,
  tightRight = runRect.origin.x + runRect.size.width,
} = {}) {
  return {
    origin: { x: looseRight - looseWidth, y: runRect.origin.y },
    size: { width: looseWidth, height: looseHeight },
    tightOrigin: {
      x: tightRight - tightWidth,
      y: runRect.origin.y + (runRect.size.height - tightHeight) / 2,
    },
    tightSize: { width: tightWidth, height: tightHeight },
  };
}

function terminalGhostFixture({
  stem = 'representa',
  continuation = 'tion',
  charIndex = 100,
  nextCharIndex,
  runRect = rect(40, 100, 80, 10),
  nextRect = rect(40, 110, 60, 10),
  sourceCharacters,
  terminalGhost = true,
  ghostGeometry,
  ghostGlyphState = 'present',
} = {}) {
  const stemCharacters = Array.from(stem);
  const continuationCharacters = Array.from(continuation);
  const charCount = stemCharacters.length + (terminalGhost ? 1 : 0);
  const resolvedNextCharIndex = nextCharIndex ?? charIndex + charCount;
  const glyphs = [];
  if (terminalGhost && ghostGlyphState !== 'missing') {
    const glyph = terminalGhostGlyph(runRect, ghostGeometry);
    if (ghostGlyphState === 'empty') glyph.isEmpty = true;
    if (ghostGlyphState === 'no-tight') {
      delete glyph.tightOrigin;
      delete glyph.tightSize;
    }
    glyphs[charIndex + charCount - 1] = glyph;
  }
  const runSourceCharacters = sourceCharacters ?? [
    ...stemCharacters,
    ...(terminalGhost ? [''] : []),
  ];
  return {
    runs: [
      {
        text: stem,
        charIndex,
        charCount,
        rect: runRect,
        fontSize: runRect.size.height,
      },
      {
        text: continuation,
        charIndex: resolvedNextCharIndex,
        charCount: continuationCharacters.length,
        rect: nextRect,
        fontSize: nextRect.size.height,
      },
    ],
    glyphs,
    sourceCharacters: new Map([
      [0, runSourceCharacters],
    ]),
  };
}

function normalizedGhostFixture(options) {
  const fixture = terminalGhostFixture(options);
  return extraction.normalizePdfTextRuns(
    fixture.runs,
    fixture.glyphs,
    fixture.sourceCharacters,
  );
}

function searchText(items) {
  return pdfSearch
    .buildPdfSearchIndex(items, 'geometry', false, false, true)
    .map(character => character.value)
    .join('');
}

function hasInferredWordJoin(items) {
  return items.some(item => item.wordJoinAfter === true);
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

test('whitespace artifacts cannot split word-joined rows with an italic fragment', () => {
  const normalized = extraction.normalizePdfTextRuns([
    { text: ' \r\n', charIndex: 54, charCount: 3, rect: rect(456, 586, 3, 17) },
    {
      text: ' \r\n',
      charIndex: 57,
      charCount: 3,
      rect: rect(456, 614, 3, 15),
      font: { italic: true },
    },
    {
      text: 'Many cities further report that, rather than help allevi',
      charIndex: 117,
      charCount: 56,
      rect: rect(167, 154, 285, 16),
    },
    { text: '', charIndex: 173, charCount: 1, rect: rect(452, 154, 4, 16) },
    {
      text: 'ate the homelessness crisis, ',
      charIndex: 174,
      charCount: 29,
      rect: rect(156, 167, 145, 17),
    },
    {
      text: 'Martin',
      charIndex: 203,
      charCount: 6,
      rect: rect(302, 168, 36, 16),
      font: { italic: true },
    },
    {
      text: ' injunctions have inad',
      charIndex: 209,
      charCount: 22,
      rect: rect(338, 167, 114, 17),
    },
    { text: '', charIndex: 231, charCount: 1, rect: rect(452, 167, 4, 17) },
    {
      text: 'vertently contributed to it. The numbers of “[u]nsheltered\r\n',
      charIndex: 232,
      charCount: 60,
      rect: rect(156, 180, 300, 17),
    },
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'Many cities further report that, rather than help allevi',
    'ate the homelessness crisis, ',
    'Martin',
    ' injunctions have inad',
    'vertently contributed to it. The numbers of “[u]nsheltered',
  ]);
  assert.equal(normalized[0].wordJoinAfter, true);
  assert.equal(normalized[2].font.italic, true);
  assert.equal(normalized[3].wordJoinAfter, true);
  assert.equal(
    searchText(normalized),
    [
      'many cities further report that, rather than help alleviate the homelessness crisis, ',
      'martin injunctions have inadvertently contributed to it. the numbers of “[u]nsheltered',
    ].join(''),
  );
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

test('an internal soft hyphen does not suppress the gap after its text run', () => {
  const first = 'co\u00adoperate';
  const second = 'well';
  const normalized = extraction.normalizePdfTextRuns([
    {
      text: first,
      charIndex: 0,
      charCount: Array.from(first).length,
      rect: rect(0, 0, 60, 10),
    },
    {
      text: second,
      charIndex: Array.from(first).length,
      charCount: second.length,
      rect: rect(80, 0, 30, 10),
    },
  ], [], new Map([
    [0, Array.from(first)],
    [1, Array.from(second)],
  ]));

  assert.deepEqual(normalized.map(item => item.content), ['cooperate', 'well']);
  assert.equal(normalized[0].wordJoinAfter, undefined);
  assert.equal(searchText(normalized), 'cooperate well');
});

for (const [stem, continuation, joined] of [
  ['representa', 'tion model', 'representation model'],
  ['qual', 'ity to reduce', 'quality to reduce'],
]) {
  test(`terminal ghost recovers ${stem}|${continuation.split(' ')[0]} as a metadata-only word join`, () => {
    const normalized = normalizedGhostFixture({ stem, continuation });

    assert.equal(normalized[0].content, stem);
    assert.equal(normalized[1].content, continuation);
    assert.equal(normalized[0].wordJoinAfter, true);
    assert.equal(normalized[0].content.includes('\u00ad'), false);
    assert.equal(searchText(normalized), joined);
    assert.equal(
      normalized[0].selectionGlyphs.some(glyph => glyph.offsetEnd > stem.length),
      false,
    );
  });
}

test('ordinary wrapped lines without a terminal ghost remain separate words', () => {
  const normalized = normalizedGhostFixture({
    stem: 'ordinary',
    continuation: 'wrapped',
    terminalGhost: false,
  });

  assert.deepEqual(normalized.map(item => item.content), ['ordinary', 'wrapped']);
  assert.equal(hasInferredWordJoin(normalized), false);
  assert.equal(searchText(normalized), 'ordinary wrapped');
});

test('terminal ghosts do not join text into a later column', () => {
  const normalized = normalizedGhostFixture({
    nextRect: rect(180, 110, 60, 10),
  });

  assert.deepEqual(normalized.map(item => item.content), ['representa', 'tion']);
  assert.equal(hasInferredWordJoin(normalized), false);
  assert.equal(searchText(normalized), 'representa tion');
});

for (const [name, options] of [
  ['the terminal ghost glyph is missing', { ghostGlyphState: 'missing' }],
  ['the terminal ghost glyph is marked empty', { ghostGlyphState: 'empty' }],
  ['the terminal ghost has no tight geometry', { ghostGlyphState: 'no-tight' }],
]) {
  test(`terminal ghost is not inferred when ${name}`, () => {
    const normalized = normalizedGhostFixture(options);

    assert.deepEqual(normalized.map(item => item.content), ['representa', 'tion']);
    assert.equal(hasInferredWordJoin(normalized), false);
    assert.equal(searchText(normalized), 'representa tion');
  });
}

test('an empty source character before the terminal ghost is not inferred as a word join', () => {
  const sourceCharacters = [...Array.from('representa'), ''];
  sourceCharacters[4] = '';
  const normalized = normalizedGhostFixture({ sourceCharacters });

  assert.equal(hasInferredWordJoin(normalized), false);
  assert.equal(searchText(normalized), 'reprsenta tion');
});

for (const [name, options] of [
  [
    'the preceding character is not alphanumeric',
    { stem: 'representa.', continuation: 'tion' },
  ],
  [
    'the following character is not alphanumeric',
    { stem: 'representa', continuation: '.tion' },
  ],
]) {
  test(`terminal ghost is not inferred when ${name}`, () => {
    const normalized = normalizedGhostFixture(options);

    assert.equal(hasInferredWordJoin(normalized), false);
  });
}

for (const [name, ghostGeometry] of [
  ['loose glyph is too wide', { looseWidth: 6 }],
  ['tight glyph is too wide', { tightWidth: 6 }],
  ['tight glyph is too tall', { tightHeight: 3 }],
  ['loose glyph is not flush with the run end', { looseRight: 117 }],
  ['tight glyph is not flush with the run end', { tightRight: 117 }],
]) {
  test(`terminal ghost is not inferred when its ${name}`, () => {
    const normalized = normalizedGhostFixture({ ghostGeometry });

    assert.deepEqual(normalized.map(item => item.content), ['representa', 'tion']);
    assert.equal(hasInferredWordJoin(normalized), false);
    assert.equal(searchText(normalized), 'representa tion');
  });
}

test('terminal ghost is not inferred across noncontiguous source indices', () => {
  const normalized = normalizedGhostFixture({ nextCharIndex: 114 });

  assert.deepEqual(normalized.map(item => item.content), ['representa', 'tion']);
  assert.equal(hasInferredWordJoin(normalized), false);
  assert.equal(searchText(normalized), 'representa tion');
});

for (const [name, nextTop] of [
  ['too close', 104],
  ['too far away', 118],
]) {
  test(`terminal ghost is not inferred when the following line is ${name}`, () => {
    const normalized = normalizedGhostFixture({
      nextRect: rect(40, nextTop, 60, 10),
    });

    assert.deepEqual(normalized.map(item => item.content), ['representa', 'tion']);
    assert.equal(hasInferredWordJoin(normalized), false);
  });
}

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

test('section gaps keep short indented blocks in each two-column lane contiguous', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'left upper 1', rect: rect(0, 0, 50, 8) },
    { content: 'left upper 2', rect: rect(0, 10, 50, 8) },
    { content: 'left indented lower', rect: rect(8, 50, 32, 8) },
    { content: 'right upper 1', rect: rect(70, 0, 50, 8) },
    { content: 'right upper 2', rect: rect(70, 10, 50, 8) },
    { content: 'right indented lower', rect: rect(78, 50, 32, 8) },
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'left upper 1',
    'left upper 2',
    'left indented lower',
    'right upper 1',
    'right upper 2',
    'right indented lower',
  ]);
});

for (const [gutter, lowerWidth] of [
  ['touching', 42],
  ['one-pixel', 41],
]) {
  test(`${gutter} column gutters keep short indented section blocks lane-major`, () => {
    const normalized = extraction.normalizeBasicPdfTextRects([
      { content: 'left upper 1', rect: rect(0, 0, 40, 8) },
      { content: 'left upper 2', rect: rect(0, 10, 40, 8) },
      { content: 'left indented lower', rect: rect(8, 50, lowerWidth, 8) },
      { content: 'right upper 1', rect: rect(50, 0, 40, 8) },
      { content: 'right upper 2', rect: rect(50, 10, 40, 8) },
      { content: 'right indented lower', rect: rect(58, 50, 32, 8) },
    ]);

    assert.deepEqual(normalized.map(item => item.content), [
      'left upper 1',
      'left upper 2',
      'left indented lower',
      'right upper 1',
      'right upper 2',
      'right indented lower',
    ]);
  });
}

test('section gaps preserve lane-major order across three PDF columns', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'left upper 1', rect: rect(0, 0, 30, 8) },
    { content: 'left upper 2', rect: rect(0, 10, 30, 8) },
    { content: 'left lower 1', rect: rect(0, 40, 30, 8) },
    { content: 'left lower 2', rect: rect(0, 50, 30, 8) },
    { content: 'middle upper 1', rect: rect(50, 0, 30, 8) },
    { content: 'middle upper 2', rect: rect(50, 10, 30, 8) },
    { content: 'middle lower 1', rect: rect(50, 40, 30, 8) },
    { content: 'middle lower 2', rect: rect(50, 50, 30, 8) },
    { content: 'right upper 1', rect: rect(100, 0, 30, 8) },
    { content: 'right upper 2', rect: rect(100, 10, 30, 8) },
    { content: 'right lower 1', rect: rect(100, 40, 30, 8) },
    { content: 'right lower 2', rect: rect(100, 50, 30, 8) },
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'left upper 1',
    'left upper 2',
    'left lower 1',
    'left lower 2',
    'middle upper 1',
    'middle upper 2',
    'middle lower 1',
    'middle lower 2',
    'right upper 1',
    'right upper 2',
    'right lower 1',
    'right lower 2',
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

test('figure regions stay ahead of a caption and split body lane despite source-order interleaving', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'chart left 1', rect: rect(140, 0, 10, 8) },
    { content: 'chart left 2', rect: rect(140, 10, 10, 8) },
    { content: 'body continuation 2', rect: rect(0, 100, 10, 8) },
    { content: 'body continuation 3', rect: rect(0, 110, 10, 8) },
    { content: 'chart middle 1', rect: rect(180, 0, 10, 8) },
    { content: 'chart middle 2', rect: rect(180, 10, 10, 8) },
    { content: 'Figure 1: chart caption', rect: rect(20, 40, 100, 8) },
    { content: 'caption continuation', rect: rect(20, 50, 100, 8) },
    { content: '1 Introduction', rect: rect(20, 70, 100, 8) },
    { content: 'body opening 1', rect: rect(20, 90, 100, 8) },
    { content: 'chart right 1', rect: rect(220, 0, 10, 8) },
    { content: 'chart right 2', rect: rect(220, 10, 10, 8) },
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'chart left 1',
    'chart left 2',
    'chart middle 1',
    'chart middle 2',
    'chart right 1',
    'chart right 2',
    'Figure 1: chart caption',
    'caption continuation',
    '1 Introduction',
    'body opening 1',
    'body continuation 2',
    'body continuation 3',
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

test('a multi-row full-width masthead does not bridge neighboring PDF columns', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'title', rect: rect(0, 0, 120, 10) },
    { content: 'authors', rect: rect(20, 14, 80, 10) },
    { content: 'affiliation', rect: rect(10, 28, 100, 10) },
    { content: 'left 1', rect: rect(0, 50, 50, 10) },
    { content: 'right 1', rect: rect(70, 50, 50, 10) },
    { content: 'left 2', rect: rect(0, 62, 50, 10) },
    { content: 'right 2', rect: rect(70, 62, 50, 10) },
    { content: 'left 3', rect: rect(0, 74, 50, 10) },
    { content: 'right 3', rect: rect(70, 74, 50, 10) },
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'title',
    'authors',
    'affiliation',
    'left 1',
    'left 2',
    'left 3',
    'right 1',
    'right 2',
    'right 3',
  ]);
});

test('a fragmented three-column author grid stays row-major before shared metadata and body text', () => {
  const nameFont = {
    familyName: 'Nimbus Roman No9 L',
    weight: 700,
    italic: false,
  };
  const markerFont = {
    familyName: 'Computer Modern',
    weight: 245,
    italic: true,
  };
  const bodyFont = {
    familyName: 'Nimbus Roman No9 L',
    weight: 425,
    italic: false,
  };
  const run = (text, left, top, width, height, font, fontSize = height) => ({
    text,
    rect: rect(left, top, width, height),
    font,
    fontSize,
  });
  const normalized = extraction.normalizePdfTextRuns([
    run('Direct Preference Optimization:\r\n', 189, 97, 237, 22, nameFont, 17.2),
    run('Your Language Model is Secretly a Reward Model\r\n', 120, 116, 371, 23, nameFont, 17.2),
    run('Rafael Rafailov', 155, 179, 66, 13, nameFont, 10),
    run('∗† ', 221, 180, 7, 12, markerFont, 7),
    run('Archit Sharma', 277, 179, 64, 13, nameFont, 10),
    run('∗† ', 341, 180, 7, 12, markerFont, 7),
    run('Eric Mitchell', 397, 179, 57, 13, nameFont, 10),
    run('∗†\r\n', 454, 180, 7, 12, markerFont, 7),
    run('Stefano Ermon', 147, 207, 64, 13, nameFont, 10),
    run('†‡ ', 211, 208, 7, 12, markerFont, 7),
    run('Christopher D. Manning', 259, 207, 106, 13, nameFont, 10),
    run('† ', 365, 208, 3, 12, markerFont, 7),
    run('Chelsea Finn', 410, 207, 55, 13, nameFont, 10),
    run('†\r\n', 465, 208, 4, 12, markerFont, 7),
    run('†', 239, 236, 4, 12, markerFont, 7),
    run('Stanford University ', 243, 236, 78, 12, bodyFont, 10),
    run('‡', 324, 236, 3, 12, markerFont, 7),
    run('CZ Biohub\r\n', 328, 236, 45, 12, bodyFont, 10),
    run('{rafailov,architsh,eric.mitchell}@cs.stanford.edu\r\n', 178, 248, 256, 12, {
      familyName: 'Computer Modern',
      weight: 250,
      italic: false,
    }, 10),
    run('Abstract\r\n', 284, 286, 44, 15, nameFont, 12),
    run('While large-scale unsupervised language models (LMs) learn broad world knowl', 143, 313, 327, 12, bodyFont, 10),
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'Direct Preference Optimization:',
    'Your Language Model is Secretly a Reward Model',
    'Rafael Rafailov',
    '∗† ',
    'Archit Sharma',
    '∗† ',
    'Eric Mitchell',
    '∗†',
    'Stefano Ermon',
    '†‡ ',
    'Christopher D. Manning',
    '† ',
    'Chelsea Finn',
    '†',
    '†',
    'Stanford University ',
    '‡',
    'CZ Biohub',
    '{rafailov,architsh,eric.mitchell}@cs.stanford.edu',
    'Abstract',
    'While large-scale unsupervised language models (LMs) learn broad world knowl',
  ]);
});

test('a centered multi-affiliation masthead stays source-contiguous before abstract body text', () => {
  const regularFont = {
    familyName: 'Nimbus Roman No9 L',
    weight: 425,
    italic: false,
  };
  const authorFont = {
    familyName: 'Nimbus Roman No9 L',
    weight: 700,
    italic: false,
  };
  const emailFont = {
    familyName: 'Computer Modern',
    weight: 250,
    italic: false,
  };
  const run = (text, left, top, width, height, font, fontSize = height) => ({
    text,
    rect: rect(left, top, width, height),
    font,
    fontSize,
  });
  const normalized = extraction.normalizePdfTextRuns([
    run('FP8 F', 172, 95, 44, 21, regularFont, 14),
    run('ORMATS ', 217, 98, 60, 17, regularFont, 11),
    run('F', 282, 95, 9, 21, regularFont, 14),
    run('OR ', 292, 98, 20, 17, regularFont, 11),
    run('D', 317, 95, 13, 21, regularFont, 14),
    run('EEP ', 331, 98, 26, 17, regularFont, 11),
    run('L', 362, 95, 11, 21, regularFont, 14),
    run('EARNING\r\n', 373, 98, 67, 17, regularFont, 11),
    run(
      'Paulius Micikevicius, Dusan Stosic, Patrick Judd, John Kamalu, Stuart Oberman, Mohammad Shoeybi,\r\n',
      87,
      162,
      441,
      13,
      authorFont,
      10,
    ),
    run('Michael Siu, Hao Wu\r\n', 261, 173, 90, 13, authorFont, 10),
    run('NVIDIA\r\n', 288, 184, 36, 12, regularFont, 10),
    run(
      '{pauliusm, dstosic, pjudd, jkamalu, soberman, mshoeybi, msiu, skyw}@nvidia.com\r\n',
      102,
      196,
      407,
      12,
      emailFont,
      10,
    ),
    run('Neil Burgess, Sangwon Ha, Richard Grisenthwaite\r\n', 199, 223, 214, 13, authorFont, 10),
    run('Arm\r\n', 297, 234, 18, 12, regularFont, 10),
    run(
      '{neil.burgess, sangwon.ha, richard.grisenthwaite}@arm.com\r\n',
      157,
      246,
      298,
      12,
      emailFont,
      10,
    ),
    run(
      'Naveen Mellempudi, Marius Cornea, Alexander Heinecke, Pradeep Dubey\r\n',
      148,
      273,
      316,
      13,
      authorFont,
      10,
    ),
    run('Intel\r\n', 297, 284, 18, 12, regularFont, 10),
    run(
      '{naveen.k.mellempudi, marius.cornea, alexander.heinecke, pradeep.dubey}@intel.com\r\n',
      94,
      296,
      423,
      12,
      emailFont,
      10,
    ),
    run('A', 277, 345, 9, 15, authorFont, 12),
    run('BSTRACT\r\n', 287, 347, 48, 12, authorFont, 10),
    run(
      'FP8 is a natural progression for accelerating deep learning training inference beyond the 16-bit',
      72,
      371,
      468,
      12,
      regularFont,
      10,
    ),
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'FP8 F',
    'ORMATS ',
    'F',
    'OR ',
    'D',
    'EEP ',
    'L',
    'EARNING',
    'Paulius Micikevicius, Dusan Stosic, Patrick Judd, John Kamalu, Stuart Oberman, Mohammad Shoeybi,',
    'Michael Siu, Hao Wu',
    'NVIDIA',
    '{pauliusm, dstosic, pjudd, jkamalu, soberman, mshoeybi, msiu, skyw}@nvidia.com',
    'Neil Burgess, Sangwon Ha, Richard Grisenthwaite',
    'Arm',
    '{neil.burgess, sangwon.ha, richard.grisenthwaite}@arm.com',
    'Naveen Mellempudi, Marius Cornea, Alexander Heinecke, Pradeep Dubey',
    'Intel',
    '{naveen.k.mellempudi, marius.cornea, alexander.heinecke, pradeep.dubey}@intel.com',
    'A',
    'BSTRACT',
    'FP8 is a natural progression for accelerating deep learning training inference beyond the 16-bit',
  ]);
});

test('a fragmented numeric table keeps every value in its visual row', () => {
  const regularFont = {
    familyName: 'Nimbus Roman No9 L',
    weight: 425,
    italic: false,
  };
  const boldFont = {
    familyName: 'Nimbus Roman No9 L',
    weight: 700,
    italic: false,
  };
  const numberFont = {
    familyName: 'Computer Modern',
    weight: 345,
    italic: false,
  };
  const decimalFont = {
    familyName: 'Computer Modern',
    weight: 360,
    italic: true,
  };
  const run = (text, left, top, width, height, font) => ({
    text,
    rect: rect(left, top, width, height),
    font,
    fontSize: 9.962599754333496,
  });
  const normalized = extraction.normalizePdfTextRuns([
    run('Model Dataset (metric) 16-bit FP int8 E4M3\r\n', 165, 510, 280, 12, regularFont),
    run('BERT Base SQuAD v1.1 (F1) ', 165, 526, 134, 12, regularFont),
    run('88', 343, 528, 10, 10, numberFont),
    run('.', 353, 528, 3, 10, decimalFont),
    run('19 76', 356, 528, 39, 10, numberFont),
    run('.', 395, 528, 3, 10, decimalFont),
    run('89 ', 398, 528, 10, 10, numberFont),
    run('88.09\r\n', 422, 526, 23, 13, boldFont),
    run('BERT Large SQuAD v1.1 (F1) ', 165, 537, 134, 12, regularFont),
    run('90', 343, 539, 10, 10, numberFont),
    run('.', 353, 539, 3, 10, decimalFont),
    run('87 89', 356, 539, 39, 10, numberFont),
    run('.', 395, 539, 3, 10, decimalFont),
    run('65 ', 398, 539, 10, 10, numberFont),
    run('90.94\r\n', 422, 537, 23, 13, boldFont),
    run('GPT3 126M wikitext103 (perplexity) ', 165, 548, 159, 12, regularFont),
    run('19', 343, 550, 10, 10, numberFont),
    run('.', 353, 550, 3, 10, decimalFont),
    run('01 28', 356, 550, 39, 10, numberFont),
    run('.', 395, 550, 3, 10, decimalFont),
    run('37 ', 398, 550, 10, 10, numberFont),
    run('19.43\r\n', 422, 548, 23, 13, boldFont),
    run('GPT3 1.3B wikitext103 (perplexity) ', 165, 559, 159, 12, regularFont),
    run('10', 343, 561, 10, 10, numberFont),
    run('.', 353, 561, 3, 10, decimalFont),
    run('19 12', 356, 561, 39, 10, numberFont),
    run('.', 395, 561, 3, 10, decimalFont),
    run('74 ', 398, 561, 10, 10, numberFont),
    run('10.29\r\n', 422, 559, 23, 13, boldFont),
    run('GPT3 6.7B wikitext103 (perplexity) ', 165, 570, 159, 12, regularFont),
    run('8', 348, 572, 5, 10, numberFont),
    run('.', 353, 572, 3, 10, decimalFont),
    run('51 10', 356, 572, 39, 10, numberFont),
    run('.', 395, 572, 3, 10, decimalFont),
    run('29 ', 398, 572, 10, 10, numberFont),
    run('8.41\r\n', 427, 570, 18, 13, boldFont),
    run('4.3 Per-tensor scaling factors\r\n', 72, 603, 130, 13, boldFont),
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'Model Dataset (metric) 16-bit FP int8 E4M3',
    'BERT Base SQuAD v1.1 (F1) ',
    '88',
    '.',
    '19 76',
    '.',
    '89 ',
    '88.09',
    'BERT Large SQuAD v1.1 (F1) ',
    '90',
    '.',
    '87 89',
    '.',
    '65 ',
    '90.94',
    'GPT3 126M wikitext103 (perplexity) ',
    '19',
    '.',
    '01 28',
    '.',
    '37 ',
    '19.43',
    'GPT3 1.3B wikitext103 (perplexity) ',
    '10',
    '.',
    '19 12',
    '.',
    '74 ',
    '10.29',
    'GPT3 6.7B wikitext103 (perplexity) ',
    '8',
    '.',
    '51 10',
    '.',
    '29 ',
    '8.41',
    '4.3 Per-tensor scaling factors',
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

test('a forward styled fragment stays ahead of the following body line', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'body 1', rect: rect(0, 0, 10, 8), font: { weight: 400 } },
    { content: 'body 2', rect: rect(0, 10, 10, 8), font: { weight: 400 } },
    { content: 'part A', rect: rect(0, 20, 10, 8), font: { weight: 400 } },
    { content: 'part B', rect: rect(34, 20, 10, 8), font: { weight: 700 } },
    { content: 'body 4', rect: rect(0, 30, 10, 8), font: { weight: 400 } },
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'body 1',
    'body 2',
    'part A',
    'part B',
    'body 4',
  ]);
});

test('a forward style change does not outrank an aligned neighboring column', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'left 1', rect: rect(0, 0, 50, 10), font: { weight: 400 } },
    { content: 'right 1', rect: rect(70, 0, 50, 10), font: { weight: 400 } },
    { content: 'left 2', rect: rect(0, 12, 50, 10), font: { weight: 400 } },
    { content: 'right 2', rect: rect(70, 12, 50, 10), font: { weight: 700 } },
    { content: 'left 3', rect: rect(0, 24, 50, 10), font: { weight: 400 } },
    { content: 'right 3', rect: rect(70, 24, 50, 10), font: { weight: 700 } },
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

test('reverse-x source transitions do not pull neighboring columns into one PDF reading lane', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'left 1', rect: rect(0, 8, 315, 17.36) },
    { content: 'right 1', rect: rect(339, 0, 315, 17.36) },
    { content: 'left 2', rect: rect(0, 28, 315, 17.36) },
    { content: 'right 2', rect: rect(339, 20, 315, 17.36) },
    { content: 'right 3', rect: rect(339, 40, 315, 17.36) },
    { content: 'left 3', rect: rect(0, 48, 315, 17.36) },
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

test('large text keeps an aligned lane ahead of a relaxed reverse-x match', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'left 1', rect: rect(0, 8, 20, 30) },
    { content: 'right 1', rect: rect(150, 0, 20, 30) },
    { content: 'left 2', rect: rect(0, 42, 20, 30) },
    { content: 'right 2', rect: rect(150, 34, 20, 30) },
    { content: 'right 3', rect: rect(150, 68, 20, 30) },
    { content: 'left 3', rect: rect(60, 76, 48, 30) },
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

test('relaxed reverse support rows do not outrank a sparse aligned lane', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'left 1', rect: rect(0, 0, 5, 10) },
    { content: 'right 1', rect: rect(66, 0, 20, 10) },
    { content: 'left 2', rect: rect(0, 12, 5, 10) },
    { content: 'right 2', rect: rect(66, 12, 20, 10) },
    { content: 'right 3', rect: rect(70, 24, 20, 10) },
    { content: 'left 3', rect: rect(20, 24, 40, 10) },
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

test('four neighboring prose columns do not become a compact grid from run count alone', () => {
  const normalized = extraction.normalizeBasicPdfTextRects([
    { content: 'one 1', rect: rect(0, 0, 20, 8), font: { weight: 400 } },
    { content: 'two 1', rect: rect(35, 0, 20, 8), font: { weight: 400 } },
    { content: 'three 1', rect: rect(70, 0, 20, 8), font: { weight: 400 } },
    { content: 'four 1', rect: rect(105, 0, 20, 8), font: { weight: 400 } },
    { content: 'one 2', rect: rect(0, 10, 20, 8), font: { weight: 400 } },
    { content: 'two 2', rect: rect(35, 10, 20, 8), font: { weight: 400 } },
    { content: 'three 2', rect: rect(70, 10, 20, 8), font: { weight: 400 } },
    { content: 'four 2', rect: rect(105, 10, 20, 8), font: { weight: 400 } },
    { content: 'one 3', rect: rect(0, 20, 20, 8), font: { weight: 400 } },
    { content: 'two 3', rect: rect(35, 20, 20, 8), font: { weight: 400 } },
    { content: 'three 3', rect: rect(70, 20, 20, 8), font: { weight: 400 } },
    { content: 'four 3', rect: rect(105, 20, 20, 8), font: { weight: 400 } },
  ]);

  assert.deepEqual(normalized.map(item => item.content), [
    'one 1',
    'one 2',
    'one 3',
    'two 1',
    'two 2',
    'two 3',
    'three 1',
    'three 2',
    'three 3',
    'four 1',
    'four 2',
    'four 3',
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
