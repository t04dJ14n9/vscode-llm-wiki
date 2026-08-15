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
const viewerSource = join(
  packageRoot,
  '../pdf-editor/src/webview/pdf-viewer.ts',
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
const originalWindow = globalThis.window;
const originalAcquireVsCodeApi = globalThis.acquireVsCodeApi;
const postedViewerMessages = [];
globalThis.window = {};
globalThis.acquireVsCodeApi = () => ({
  getState: () => undefined,
  postMessage: message => { postedViewerMessages.push(message); },
  setState: () => undefined,
});
const pdfViewer = compileTsModule(viewerSource, {
  '@embedpdf/engines/pdfium-direct-engine': {
    createPdfiumEngine: () => new Promise(() => {}),
  },
  '@embedpdf/models': {},
  './domain/pdfNavigation': {},
  './domain/pdfSearch': pdfSearch,
  './domain/pdfSelection': pdfSelection,
  './domain/pdfTextExtraction': pdfTextExtraction,
  './domain/pdfOutline': {},
  './pdfLayout': {},
  './pdfTextLayer': {},
  './obsidianContextMenu': {},
  './pdfAskPanel': {},
  './pdfTextBands': {},
});
if (originalWindow === undefined) delete globalThis.window;
else globalThis.window = originalWindow;
if (originalAcquireVsCodeApi === undefined) delete globalThis.acquireVsCodeApi;
else globalThis.acquireVsCodeApi = originalAcquireVsCodeApi;

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

function restoreClipboardSelectionAfterPageRender(
  pendingSelection,
  currentSelection,
  snapshot,
) {
  assert.equal(typeof pdfViewer.PdfViewer, 'function');
  const viewer = Object.create(pdfViewer.PdfViewer.prototype);
  viewer.selectionState = currentSelection;
  viewer.pendingAgentClipboardSelection = pendingSelection;
  viewer.agentClipboardSelection = null;
  viewer.agentClipboardContexts = new Map();
  viewer.latestSelectionAnchor = null;
  viewer.applyNativeSelection = () => ({});
  viewer.drawSelectionOverlay = () => undefined;
  viewer.selectionAnchorFromState = () => snapshot;
  postedViewerMessages.length = 0;

  viewer.restoreSelectionForPage(3);

  return [...postedViewerMessages];
}

function selectionSnapshotWithMiddlePage(selection, middlePageReady) {
  assert.equal(typeof pdfViewer.PdfViewer, 'function');
  const viewer = Object.create(pdfViewer.PdfViewer.prototype);
  viewer.selectionState = selection;
  viewer.pages = new Map([
    [2, { textExtractionReady: true }],
    [3, { textExtractionReady: middlePageReady }],
    [4, { textExtractionReady: true }],
  ]);
  viewer.applyNativeSelection = () => ({});
  viewer.selectionTextFromState = () => middlePageReady
    ? 'page two page three page four'
    : 'page two page four';
  viewer.selectionRectsForState = (_selection, page) => new Map([
    [2, [[10, 20, 110, 36]]],
    [3, [[12, 18, 140, 34]]],
    [4, [[8, 16, 96, 32]]],
  ]).get(page) ?? [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    getSelection: () => ({ isCollapsed: false }),
  };
  try {
    return viewer.selectionAnchorFromState();
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

test('multi-page PDF clipboard selection includes every page and complete normalized text', () => {
  assert.equal(typeof pdfViewer.pdfAgentClipboardSelectionForState, 'function');
  const selection = {
    page: 2,
    anchor: { page: 2, itemIndex: 4, offset: 2 },
    focus: { page: 4, itemIndex: 1, offset: 5 },
  };
  const rectsByPage = new Map([
    [2, [[10, 20, 110, 36]]],
    [3, [[12, 18, 140, 34], [12, 38, 120, 54]]],
    [4, [[8, 16, 96, 32]]],
  ]);

  assert.deepEqual(
    pdfViewer.pdfAgentClipboardSelectionForState(
      selection,
      ' complete \n normalized   text across all pages ',
      page => rectsByPage.get(page) ?? [],
    ),
    {
      startPage: 2,
      endPage: 4,
      pages: [
        { page: 2, rects: [[10, 20, 110, 36]] },
        { page: 3, rects: [[12, 18, 140, 34], [12, 38, 120, 54]] },
        { page: 4, rects: [[8, 16, 96, 32]] },
      ],
      selectedText: 'complete normalized text across all pages',
    },
  );
});

function assertDelayedMiddlePageRepublish(selection, changedSelection) {
  const rectsByPage = new Map([
    [2, [[10, 20, 110, 36]]],
    [4, [[8, 16, 96, 32]]],
  ]);

  assert.equal(
    pdfViewer.pdfAgentClipboardSelectionForState(
      selection,
      'page two page four',
      page => rectsByPage.get(page),
    ),
    undefined,
  );
  assert.equal(
    selectionSnapshotWithMiddlePage(selection, false)?.clipboardSelection,
    undefined,
  );

  rectsByPage.set(3, [[12, 18, 140, 34]]);
  const clipboardSelection = pdfViewer.pdfAgentClipboardSelectionForState(
    selection,
    'page two page three page four',
    page => rectsByPage.get(page),
  );
  assert.deepEqual(clipboardSelection, {
    startPage: 2,
    endPage: 4,
    pages: [
      { page: 2, rects: [[10, 20, 110, 36]] },
      { page: 3, rects: [[12, 18, 140, 34]] },
      { page: 4, rects: [[8, 16, 96, 32]] },
    ],
    selectedText: 'page two page three page four',
  });

  assert.equal(
    typeof pdfViewer.pdfAgentClipboardSelectionMessageAfterPageRender,
    'function',
  );
  const snapshot = selectionSnapshotWithMiddlePage(selection, true);
  assert.deepEqual(snapshot?.clipboardSelection, clipboardSelection);
  assert.deepEqual(
    pdfViewer.pdfAgentClipboardSelectionMessageAfterPageRender(
      selection,
      selection,
      snapshot,
    ),
    {
      type: 'selectionChanged',
      anchor: snapshot.anchor,
      clipboardSelection,
    },
  );
  assert.equal(
    pdfViewer.pdfAgentClipboardSelectionMessageAfterPageRender(
      selection,
      changedSelection,
      snapshot,
    ),
    undefined,
  );
  assert.deepEqual(
    restoreClipboardSelectionAfterPageRender(selection, selection, snapshot),
    [{
      type: 'selectionChanged',
      anchor: snapshot.anchor,
      clipboardSelection,
    }],
  );
  assert.deepEqual(
    restoreClipboardSelectionAfterPageRender(
      selection,
      changedSelection,
      snapshot,
    ),
    [],
  );
}

test('forward multi-page clipboard waits for a delayed middle page before republishing', () => {
  const selection = {
    page: 2,
    anchor: { page: 2, itemIndex: 4, offset: 2 },
    focus: { page: 4, itemIndex: 1, offset: 5 },
  };
  assertDelayedMiddlePageRepublish(
    selection,
    {
      ...selection,
      focus: { ...selection.focus, offset: 6 },
    },
  );
});

test('reverse multi-page clipboard waits for a delayed middle page before republishing', () => {
  const selection = {
    page: 4,
    anchor: { page: 4, itemIndex: 1, offset: 5 },
    focus: { page: 2, itemIndex: 4, offset: 2 },
  };
  assertDelayedMiddlePageRepublish(
    selection,
    {
      ...selection,
      anchor: { ...selection.anchor, offset: 6 },
    },
  );
});

test('stale PDF clipboard context is rejected before webview caching', () => {
  assert.equal(typeof pdfViewer.correlatePdfAgentClipboardContext, 'function');
  const currentSelection = {
    startPage: 4,
    endPage: 4,
    pages: [{ page: 4, rects: [[30, 40, 130, 56]] }],
    selectedText: 'same selected text',
  };
  const staleContext = {
    selectionKey: JSON.stringify({
      startPage: 4,
      endPage: 4,
      selectedText: currentSelection.selectedText,
      pages: [{ page: 4, rects: [[10, 20, 110, 36]] }],
    }),
    sourceLabel: 'raw/pdf/paper.pdf (page 4)',
    sourceHref: 'cursor://llm-wiki/open-anchor?target=raw%2Fpdf%2Fpaper.pdf%23page%3D4',
    selectedText: currentSelection.selectedText,
    plainText: 'old clipboard payload',
  };

  assert.equal(
    pdfViewer.correlatePdfAgentClipboardContext(currentSelection, staleContext),
    undefined,
  );
  const currentContext = {
    ...staleContext,
    selectionKey: JSON.stringify(currentSelection),
    sourceLabel: 'raw/pdf/paper.pdf (page 4)',
    selectedText: currentSelection.selectedText,
    plainText: 'current clipboard payload',
  };
  assert.equal(
    pdfViewer.correlatePdfAgentClipboardContext(currentSelection, currentContext),
    currentContext,
  );
});

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

test('overlapping equal-height glyph boxes remain separate visual rows', () => {
  const lines = pdfSelection.buildPdfSelectionLines([
    Array.from({ length: 5 }, (_, index) => glyph(0, 14 + index * 12, 60, 20, index)),
  ]);

  assert.equal(lines.length, 5);
  assert.deepEqual(lines.map(line => line.center), [24, 36, 48, 60, 72]);
});

test('smaller overlapping formula scripts stay attached to their baseline row', () => {
  const baseline = glyph(0, 20, 12, 16, 0);
  const superscript = glyph(12, 17, 6, 12, 1);
  const lines = pdfSelection.buildPdfSelectionLines([[superscript, baseline]]);

  assert.equal(lines.length, 1);
  assert.deepEqual(
    lines[0].glyphs.map(candidate => candidate.glyph),
    [baseline, superscript],
  );
  assert.equal(lines[0].center, 28);
  assert.equal(lines[0].height, 16);
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
