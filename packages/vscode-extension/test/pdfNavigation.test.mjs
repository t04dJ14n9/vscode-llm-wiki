import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(packageRoot, '../..');
const navigationSource = join(
  workspaceRoot,
  'packages/pdf-editor/src/webview/domain/pdfNavigation.ts',
);

const PdfActionType = {
  Unsupported: 0,
  Goto: 1,
  RemoteGoto: 2,
  URI: 3,
  LaunchAppOrOpenFile: 4,
};

const PdfZoomMode = {
  Unknown: 0,
  XYZ: 1,
  FitPage: 2,
  FitHorizontal: 3,
  FitVertical: 4,
  FitRectangle: 5,
  FitBoundingBox: 6,
  FitBoundingBoxHorizontal: 7,
  FitBoundingBoxVertical: 8,
};

function loadNavigationModule() {
  const source = readFileSync(navigationSource, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: navigationSource,
  });
  const mod = new Module(navigationSource);
  mod.filename = navigationSource;
  mod.paths = Module._nodeModulePaths(dirname(navigationSource));
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@embedpdf/models') return { PdfActionType, PdfZoomMode };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    mod._compile(outputText, navigationSource);
  } finally {
    Module._load = originalLoad;
  }
  return mod.exports;
}

const navigation = loadNavigationModule();

test('presentation modes round-trip to Preview-compatible policy', () => {
  for (const [mode, continuousScroll, twoPageView] of [
    ['single', false, false],
    ['single-continuous', true, false],
    ['two', false, true],
    ['two-continuous', true, true],
  ]) {
    assert.deepEqual(navigation.pdfPresentationPolicy(mode), {
      continuousScroll,
      twoPageView,
      spreadParity: 'even',
      scrollMode: 'vertical',
    });
    assert.equal(navigation.pdfPresentationMode(continuousScroll, twoPageView), mode);
  }
});

test('cover-page and odd-page spread parity preserve their page pairings', () => {
  assert.deepEqual(navigation.pdfSpreadStarts(7, 'even'), [1, 2, 4, 6]);
  assert.deepEqual(navigation.pdfSpreadPageNumbers(1, 7, 'even'), [1]);
  assert.deepEqual(navigation.pdfSpreadPageNumbers(3, 7, 'even'), [2, 3]);
  assert.deepEqual(navigation.pdfSpreadPageNumbers(7, 7, 'even'), [6, 7]);
  assert.equal(navigation.pdfSpreadStart(4, 'even'), 4);

  assert.deepEqual(navigation.pdfSpreadStarts(6, 'odd'), [1, 3, 5]);
  assert.deepEqual(navigation.pdfSpreadPageNumbers(2, 6, 'odd'), [1, 2]);
  assert.deepEqual(navigation.pdfSpreadPageNumbers(5, 6, 'odd'), [5, 6]);
  assert.equal(navigation.pdfSpreadStart(6, 'odd'), 5);

  assert.deepEqual(navigation.spreadGridPosition(1, 'even'), { row: 1, column: 2 });
  assert.deepEqual(navigation.spreadGridPosition(2, 'even'), { row: 2, column: 1 });
  assert.deepEqual(navigation.spreadGridPosition(3, 'even'), { row: 2, column: 2 });
  assert.deepEqual(navigation.spreadGridPosition(1, 'odd'), { row: 1, column: 1 });
  assert.deepEqual(navigation.spreadGridPosition(2, 'odd'), { row: 1, column: 2 });
});

test('page navigation advances by one page or one facing-page spread', () => {
  assert.equal(navigation.pdfNavigationTarget(3, 1, 7, false, 'even'), 4);
  assert.equal(navigation.pdfNavigationTarget(3, -1, 7, false, 'even'), 2);
  assert.equal(navigation.pdfNavigationTarget(1, -1, 7, false, 'even'), undefined);
  assert.equal(navigation.pdfNavigationTarget(7, 1, 7, false, 'even'), undefined);

  // In cover-page mode the current pages are 1 → 3 → 5 → 7.
  assert.equal(navigation.pdfNavigationTarget(1, 1, 7, true, 'even'), 3);
  assert.equal(navigation.pdfNavigationTarget(3, 1, 7, true, 'even'), 5);
  assert.equal(navigation.pdfNavigationTarget(5, 1, 7, true, 'even'), 7);
  assert.equal(navigation.pdfNavigationTarget(7, -1, 7, true, 'even'), 5);
  assert.equal(navigation.pdfNavigationTarget(1, -1, 7, true, 'even'), undefined);

  assert.equal(navigation.pdfNavigationTarget(2, 1, 6, true, 'odd'), 4);
  assert.equal(navigation.pdfNavigationTarget(4, -1, 6, true, 'odd'), 1);
});

test('viewport progress restores the same normalized location on a different page', () => {
  const progress = navigation.capturePdfViewportProgress({
    scrollLeft: 150,
    scrollTop: 600,
    scrollWidth: 900,
    scrollHeight: 1600,
    clientWidth: 600,
    clientHeight: 800,
  });
  assert.deepEqual(progress, { x: 0.5, y: 0.75 });

  assert.deepEqual(navigation.restorePdfViewportProgress(progress, {
    scrollWidth: 1200,
    scrollHeight: 1100,
    clientWidth: 600,
    clientHeight: 800,
  }), {
    left: 300,
    top: 225,
  });

  assert.deepEqual(navigation.restorePdfViewportProgress(progress, {
    scrollWidth: 1200,
    scrollHeight: 1100,
    clientWidth: 600,
    clientHeight: 800,
  }, { y: 0 }), {
    left: 300,
    top: 0,
  });
});

test('fitted viewport axes stay centered and scroll progress is clamped', () => {
  assert.deepEqual(navigation.capturePdfViewportProgress({
    scrollLeft: 20,
    scrollTop: -10,
    scrollWidth: 500,
    scrollHeight: 1000,
    clientWidth: 600,
    clientHeight: 500,
  }), {
    x: 0.5,
    y: 0,
  });

  assert.deepEqual(navigation.restorePdfViewportProgress({ x: 2, y: -1 }, {
    scrollWidth: 1000,
    scrollHeight: 1000,
    clientWidth: 400,
    clientHeight: 400,
  }), {
    left: 600,
    top: 0,
  });
});

test('fractional scroll remainders inside the four-pixel epsilon count as a boundary', () => {
  const viewport = {
    scrollLeft: 396.5,
    scrollTop: 596.5,
    scrollWidth: 1000,
    scrollHeight: 1200,
    clientWidth: 600,
    clientHeight: 600,
  };
  assert.equal(navigation.canScrollPdfViewport('horizontal', 1, viewport), false);
  assert.equal(navigation.canScrollPdfViewport('vertical', 1, viewport), false);
  assert.equal(navigation.canScrollPdfViewport('horizontal', -1, viewport), true);
  assert.equal(navigation.canScrollPdfViewport('vertical', -1, viewport), true);

  assert.equal(navigation.canScrollPdfViewport('horizontal', -1, {
    ...viewport,
    scrollLeft: 3.9,
  }), false);
  assert.equal(navigation.canScrollPdfViewport('vertical', 1, {
    ...viewport,
    scrollTop: 590,
  }), true);
});

test('internal link destinations accept direct and GoTo targets only', () => {
  const destination = xyzDestination({ x: 12, y: 34 });
  assert.equal(navigation.pdfInternalDestination({
    target: { type: 'destination', destination },
  }), destination);
  assert.equal(navigation.pdfInternalDestination({
    target: {
      type: 'action',
      action: { type: PdfActionType.Goto, destination },
    },
  }), destination);
  assert.equal(navigation.pdfInternalDestination({
    target: {
      type: 'action',
      action: { type: PdfActionType.URI, uri: 'https://example.com' },
    },
  }), undefined);
  assert.equal(navigation.pdfInternalDestination({}), undefined);
});

test('annotation rectangles normalize direction, clamp to the page, and reject invalid areas', () => {
  assert.deepEqual(navigation.normalizePdfAnnotationRect({
    origin: { x: 90, y: 80 },
    size: { width: -100, height: -100 },
  }, { width: 200, height: 100 }), {
    left: 0,
    top: 0,
    width: 90,
    height: 80,
  });

  assert.deepEqual(navigation.normalizePdfAnnotationRect({
    origin: { x: 190, y: 90 },
    size: { width: 50, height: 50 },
  }, { width: 200, height: 100 }), {
    left: 190,
    top: 90,
    width: 10,
    height: 10,
  });

  assert.equal(navigation.normalizePdfAnnotationRect({
    origin: { x: Number.NaN, y: 0 },
    size: { width: 10, height: 10 },
  }, { width: 200, height: 100 }), undefined);
  assert.equal(navigation.normalizePdfAnnotationRect({
    origin: { x: 200, y: 100 },
    size: { width: 10, height: 10 },
  }, { width: 200, height: 100 }), undefined);
});

test('destination targets convert PDF coordinates for every page rotation', () => {
  const destination = xyzDestination({ x: 20, y: 70 });
  const page = { size: { width: 100, height: 200 } };

  assert.deepEqual(navigation.pdfDestinationViewerTarget(destination, {
    ...page,
    rotation: 0,
  }, false), { x: 20, y: 130, alignX: true });
  assert.deepEqual(navigation.pdfDestinationViewerTarget(destination, {
    ...page,
    rotation: 1,
  }, false), { x: 70, y: 20, alignX: true });
  assert.deepEqual(navigation.pdfDestinationViewerTarget(destination, {
    ...page,
    rotation: 2,
  }, false), { x: 80, y: 70, alignX: true });
  assert.deepEqual(navigation.pdfDestinationViewerTarget(destination, {
    ...page,
    rotation: 3,
  }, false), { x: 30, y: 180, alignX: true });

  // A renderer that has already normalized rotation uses the ordinary mapping.
  assert.deepEqual(navigation.pdfDestinationViewerTarget(destination, {
    ...page,
    rotation: 3,
  }, true), { x: 20, y: 130, alignX: true });
});

test('destination modes select the same target coordinate policy as the viewer', () => {
  const page = { size: { width: 100, height: 200 }, rotation: 0 };
  assert.deepEqual(navigation.pdfDestinationViewerTarget({
    pageIndex: 0,
    view: [150],
    zoom: { mode: PdfZoomMode.FitHorizontal, params: {} },
  }, page, false), { x: 0, y: 50, alignX: false });

  assert.deepEqual(navigation.pdfDestinationViewerTarget({
    pageIndex: 0,
    view: [25],
    zoom: { mode: PdfZoomMode.FitVertical, params: {} },
  }, page, false), { x: 25, y: 0, alignX: true });

  assert.deepEqual(navigation.pdfDestinationViewerTarget({
    pageIndex: 0,
    view: [10, 20, 50, 80],
    zoom: { mode: PdfZoomMode.FitRectangle, params: {} },
  }, page, false), { x: 10, y: 120, alignX: true });
});

function xyzDestination({ x, y }) {
  return {
    pageIndex: 0,
    view: [x, y],
    zoom: {
      mode: PdfZoomMode.XYZ,
      params: { x, y, zoom: null },
    },
  };
}
