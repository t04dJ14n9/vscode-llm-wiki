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
let pdfAgentClipboardState;
const pdfAgentClipboardMock = {
  capturePdfAgentClipboardPng: input => {
    pdfAgentClipboardState.captureInputs.push(input);
    return pdfAgentClipboardState.pngPromise;
  },
  writePdfAgentClipboard: input => {
    pdfAgentClipboardState.writeInputs.push(input);
    return pdfAgentClipboardState.writePromise;
  },
};
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
  './pdfAgentClipboard': pdfAgentClipboardMock,
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

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

function resetPdfAgentClipboardState() {
  const pendingPng = deferred();
  const pendingWrite = deferred();
  pdfAgentClipboardState = {
    captureInputs: [],
    pngPromise: pendingPng.promise,
    pendingPng,
    pendingWrite,
    writeInputs: [],
    writePromise: pendingWrite.promise,
  };
  return pdfAgentClipboardState;
}

function agentClipboardCopyViewer() {
  const selection = {
    startPage: 2,
    endPage: 2,
    pages: [{ page: 2, rects: [[10, 20, 110, 36]] }],
    selectedText: 'selected passage',
  };
  const selectionKey = JSON.stringify(selection);
  const context = {
    selectionKey,
    sourceLabel: 'raw/pdf/paper.pdf (page 2)',
    sourceHref: 'cursor://llm-wiki/open-anchor?target=paper.pdf',
    selectedText: selection.selectedText,
    plainText: 'host-precomputed plain text',
  };
  const viewer = Object.create(pdfViewer.PdfViewer.prototype);
  viewer.agentClipboardSelection = selection;
  viewer.agentClipboardContexts = new Map([[selectionKey, context]]);
  viewer.pages = new Map([[
    2,
    {
      canvas: { width: 100, height: 100 },
      pageObj: { size: { width: 612, height: 792 } },
    },
  ]]);
  viewer.updateAgentClipboardCopyControl = () => undefined;
  return { context, selection, viewer };
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

function glyph(left, top, width = 5, height = 10, offsetStart = 0) {
  return {
    offsetStart,
    offsetEnd: offsetStart + 1,
    sourceCharIndex: offsetStart,
    looseRect: [left, top, left + width, top + height],
    hitRect: [left, top, left + width, top + height],
  };
}

function pendingClipboardViewer(
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
  viewer.drawSelectionOverlays = () => undefined;
  viewer.selectionAnchorFromState = () => snapshot;
  viewer.selectionToolbarViewportRect = () => undefined;
  return viewer;
}

function restoreClipboardSelectionAfterPageRender(
  pendingSelection,
  currentSelection,
  snapshot,
) {
  const viewer = pendingClipboardViewer(
    pendingSelection,
    currentSelection,
    snapshot,
  );
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

test('gesture-bound PDF copy invokes crop and writer in the click stack', async () => {
  const state = resetPdfAgentClipboardState();
  const { viewer } = agentClipboardCopyViewer();

  viewer.copySelectionForAgent();

  assert.equal(state.captureInputs.length, 1);
  assert.equal(state.writeInputs.length, 1);
  assert.equal(state.writeInputs[0].pngBlob, state.pngPromise);

  state.pendingWrite.resolve('rich');
  await Promise.resolve();
});

test('duplicate PDF clipboard clicks share one in-flight attempt', async () => {
  const state = resetPdfAgentClipboardState();
  const { viewer } = agentClipboardCopyViewer();

  viewer.copySelectionForAgent();
  viewer.copySelectionForAgent();

  assert.equal(state.captureInputs.length, 1);
  assert.equal(state.writeInputs.length, 1);

  state.pendingWrite.resolve('rich');
  await Promise.resolve();
});

test('selection change invalidates an in-flight PDF clipboard attempt', async () => {
  const state = resetPdfAgentClipboardState();
  const { viewer } = agentClipboardCopyViewer();
  viewer.copySelectionForAgent();
  assert.equal(state.writeInputs.length, 1);
  assert.equal(state.writeInputs[0].isCurrent(), true);

  const nextSelection = {
    startPage: 3,
    endPage: 3,
    pages: [{ page: 3, rects: [[20, 30, 120, 46]] }],
    selectedText: 'new selected passage',
  };
  viewer.selectionState = null;
  viewer.selectionAnchorFromNativeRange = () => ({
    anchor: {
      page: 3,
      snippet: nextSelection.selectedText,
      rects: nextSelection.pages[0].rects,
    },
    clipboardSelection: nextSelection,
    range: { getBoundingClientRect: () => ({ page: 3 }) },
  });
  viewer.selectionViewportRect = () => ({ page: 3 });
  viewer.showSelectionToolbar = () => undefined;

  postedViewerMessages.length = 0;
  viewer.handleSelection();

  assert.equal(state.writeInputs[0].isCurrent(), false);
  state.writeInputs[0].host.postMessage({
    type: 'agentClipboardResult',
    status: 'rich',
    selectionKey: 'stale-key',
  });
  state.writeInputs[0].host.postMessage({
    type: 'agentClipboardResult',
    status: 'text-fallback',
    selectionKey: 'stale-key',
    plainText: 'stale text',
  });
  assert.equal(
    postedViewerMessages.filter(message => message.type === 'agentClipboardResult').length,
    0,
  );
  state.pendingWrite.resolve('text-fallback');
  await Promise.resolve();
});

test('selection clear invalidates an in-flight PDF clipboard attempt', async () => {
  const state = resetPdfAgentClipboardState();
  const { viewer } = agentClipboardCopyViewer();
  viewer.copySelectionForAgent();
  assert.equal(state.writeInputs.length, 1);
  assert.equal(state.writeInputs[0].isCurrent(), true);

  viewer.cancelSelectionUpdate = () => undefined;
  viewer.stopSelectionAutoScroll = () => undefined;
  viewer.pages = new Map();
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    viewer.clearSelection();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.equal(state.writeInputs[0].isCurrent(), false);
  state.pendingWrite.resolve('text-fallback');
  await Promise.resolve();
});

function multiPageToolbarViewer(anchorCaret, focusCaret) {
  const viewer = Object.create(pdfViewer.PdfViewer.prototype);
  viewer.selectionState = {
    page: anchorCaret.page,
    anchor: anchorCaret,
    focus: focusCaret,
  };
  viewer.pendingAgentClipboardSelection = null;
  viewer.agentClipboardContexts = new Map();
  viewer.agentClipboardSelection = null;
  viewer.selectionRectsForState = (_selection, page) => [[page, 10, page + 20, 30]];
  viewer.selectionViewportRect = anchor => ({ page: anchor.page });
  return viewer;
}

test('forward multi-page toolbar is positioned at the visible focus endpoint', () => {
  const viewer = multiPageToolbarViewer(
    { page: 2, itemIndex: 4, offset: 2 },
    { page: 4, itemIndex: 1, offset: 5 },
  );
  let toolbarRect;
  viewer.selectionAnchorFromNativeRange = () => ({
    anchor: {
      page: 2,
      multiPage: true,
      snippet: 'page two page three page four',
      rects: [[10, 20, 110, 36]],
    },
    clipboardSelection: {
      startPage: 2,
      endPage: 4,
      pages: [
        { page: 2, rects: [[10, 20, 110, 36]] },
        { page: 3, rects: [[12, 18, 140, 34]] },
        { page: 4, rects: [[8, 16, 96, 32]] },
      ],
      selectedText: 'page two page three page four',
    },
    range: { getBoundingClientRect: () => ({ page: 'range' }) },
  });
  viewer.showSelectionToolbar = (_anchor, rect) => { toolbarRect = rect; };

  viewer.handleSelection();

  assert.equal(toolbarRect.page, 4);
});

test('reverse multi-page toolbar returns at the visible focus endpoint after rerender', () => {
  const viewer = multiPageToolbarViewer(
    { page: 4, itemIndex: 1, offset: 5 },
    { page: 2, itemIndex: 4, offset: 2 },
  );
  const anchor = {
    page: 2,
    multiPage: true,
    snippet: 'page two page three page four',
    rects: [[10, 20, 110, 36]],
  };
  const shown = [];
  viewer.applyNativeSelection = () => ({});
  viewer.drawSelectionOverlays = () => undefined;
  viewer.retryPendingAgentClipboardSelection = () => false;
  viewer.selectionAnchorFromState = () => ({
    anchor,
    range: { getBoundingClientRect: () => ({ page: 'range' }) },
  });
  viewer.showSelectionToolbar = (_anchor, rect) => { shown.push(rect); };

  viewer.refreshSelectionAfterRender();

  assert.deepEqual(shown, [{ page: 2 }]);
});

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
    typeof pdfViewer.pdfAgentClipboardSelectionRetryMessage,
    'function',
  );
  const snapshot = selectionSnapshotWithMiddlePage(selection, true);
  assert.deepEqual(snapshot?.clipboardSelection, clipboardSelection);
  assert.deepEqual(
    pdfViewer.pdfAgentClipboardSelectionRetryMessage(
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
    pdfViewer.pdfAgentClipboardSelectionRetryMessage(
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

test('search-only PDF text extraction settlement republishes complete current clipboard context', async () => {
  const selection = {
    page: 2,
    anchor: { page: 2, itemIndex: 4, offset: 2 },
    focus: { page: 4, itemIndex: 1, offset: 5 },
  };
  const snapshot = selectionSnapshotWithMiddlePage(selection, true);
  const viewer = pendingClipboardViewer(selection, selection, snapshot);
  const pageState = {
    pageNum: 3,
    rendered: false,
    renderGeneration: 1,
    textExtractionReady: false,
  };
  const rects = [{ content: 'page three' }];
  postedViewerMessages.length = 0;

  assert.equal(typeof viewer.trackPdfTextExtraction, 'function');
  assert.equal(
    await viewer.trackPdfTextExtraction(pageState, Promise.resolve(rects)),
    rects,
  );
  assert.equal(pageState.textExtractionReady, true);
  assert.equal(pageState.rendered, false);
  assert.deepEqual(postedViewerMessages, [{
    type: 'selectionChanged',
    anchor: snapshot.anchor,
    clipboardSelection: snapshot.clipboardSelection,
  }]);
  viewer.refreshSelectionAfterRender();
  assert.equal(postedViewerMessages.length, 1);

  const staleViewer = pendingClipboardViewer(
    selection,
    {
      ...selection,
      focus: { ...selection.focus, offset: 6 },
    },
    snapshot,
  );
  postedViewerMessages.length = 0;
  await staleViewer.trackPdfTextExtraction(
    { ...pageState, textExtractionReady: false },
    Promise.resolve(rects),
  );
  assert.deepEqual(postedViewerMessages, []);
});

test('generation-mismatched PDF render republishes when extraction settles before return', async () => {
  const selection = {
    page: 4,
    anchor: { page: 4, itemIndex: 1, offset: 5 },
    focus: { page: 2, itemIndex: 4, offset: 2 },
  };
  const snapshot = selectionSnapshotWithMiddlePage(selection, true);
  const viewer = pendingClipboardViewer(selection, selection, snapshot);
  const startedRenderGeneration = 1;
  const pageState = {
    pageNum: 3,
    rendered: false,
    renderGeneration: 2,
    textExtractionReady: false,
  };
  postedViewerMessages.length = 0;

  assert.equal(typeof viewer.trackPdfTextExtraction, 'function');
  await viewer.trackPdfTextExtraction(
    pageState,
    Promise.resolve([{ content: 'page three' }]),
  );
  assert.notEqual(startedRenderGeneration, pageState.renderGeneration);
  assert.deepEqual(postedViewerMessages, [{
    type: 'selectionChanged',
    anchor: snapshot.anchor,
    clipboardSelection: snapshot.clipboardSelection,
  }]);
});

test('PDF selection refresh retries current pending context but rejects stale carets', () => {
  const selection = {
    page: 2,
    anchor: { page: 2, itemIndex: 4, offset: 2 },
    focus: { page: 4, itemIndex: 1, offset: 5 },
  };
  const snapshot = selectionSnapshotWithMiddlePage(selection, true);
  const viewer = pendingClipboardViewer(selection, selection, snapshot);
  postedViewerMessages.length = 0;

  viewer.refreshSelectionAfterRender();
  assert.deepEqual(postedViewerMessages, [{
    type: 'selectionChanged',
    anchor: snapshot.anchor,
    clipboardSelection: snapshot.clipboardSelection,
  }]);

  const staleViewer = pendingClipboardViewer(
    selection,
    {
      ...selection,
      anchor: { ...selection.anchor, offset: 3 },
    },
    snapshot,
  );
  postedViewerMessages.length = 0;
  staleViewer.refreshSelectionAfterRender();
  assert.deepEqual(postedViewerMessages, []);
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
