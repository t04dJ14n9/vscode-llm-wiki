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

test('link rectangles keep their horizontal hit area and align vertically to covered text runs', () => {
  const link = { left: 40, top: 110, width: 160, height: 26 };
  assert.deepEqual(navigation.alignPdfLinkRectToTextLayer(link, [
    { left: 42, top: 116, width: 96, height: 16 },
    { left: 150, top: 117, width: 18, height: 14 },
    // A neighboring row only grazes the padded annotation and must not expand it.
    { left: 42, top: 134, width: 100, height: 16 },
  ]), {
    left: 40,
    top: 116,
    width: 160,
    height: 16,
  });
});

test('link alignment supports multi-line links and preserves annotations without matching text', () => {
  const link = { left: 20, top: 100, width: 180, height: 50 };
  assert.deepEqual(navigation.alignPdfLinkRectToTextLayer(link, [
    { left: 24, top: 105, width: 120, height: 14 },
    { left: 24, top: 130, width: 160, height: 14 },
  ]), {
    left: 20,
    top: 105,
    width: 180,
    height: 39,
  });
  assert.equal(navigation.alignPdfLinkRectToTextLayer(link, [
    { left: 220, top: 105, width: 20, height: 14 },
  ]), link);
});

test('link hit regions exclude blank space between visible glyph runs', () => {
  const link = { left: 20, top: 100, width: 180, height: 16 };
  const hitRects = navigation.pdfLinkHitRects(link, [
    { left: 24, top: 102, width: 18, height: 12 },
    { left: 42, top: 102, width: 16, height: 12 },
    { left: 164, top: 102, width: 12, height: 12 },
  ]);

  assert.deepEqual(hitRects, [
    { left: 24, top: 102, width: 34, height: 12 },
    { left: 164, top: 102, width: 12, height: 12 },
  ]);
  assert.equal(hitRects.some(rect => (
    100 >= rect.left
    && 100 <= rect.left + rect.width
    && 108 >= rect.top
    && 108 <= rect.top + rect.height
  )), false);
});

test('link hit regions remain split across visual lines and fall back without glyphs', () => {
  const link = { left: 20, top: 100, width: 180, height: 50 };
  assert.deepEqual(navigation.pdfLinkHitRects(link, [
    { left: 24, top: 105, width: 80, height: 14 },
    { left: 24, top: 130, width: 120, height: 14 },
  ]), [
    { left: 24, top: 105, width: 80, height: 14 },
    { left: 24, top: 130, width: 120, height: 14 },
  ]);
  assert.deepEqual(navigation.pdfLinkHitRects(link, []), [link]);
});

test('link hit regions promote a thin annotation overlap to the full visible glyph box', () => {
  const link = { left: 20, top: 108, width: 80, height: 4 };
  assert.deepEqual(navigation.pdfLinkHitRects(link, [
    { left: 24, top: 100, width: 20, height: 12 },
    // A one-pixel edge intersection must not turn adjacent ordinary text
    // into a link.
    { left: 99, top: 100, width: 10, height: 12 },
  ]), [
    { left: 24, top: 100, width: 20, height: 12 },
  ]);
});

test('link hit regions do not expand horizontally beyond the annotation', () => {
  const link = { left: 100, top: 108, width: 80, height: 4 };
  assert.deepEqual(navigation.pdfLinkHitRects(link, [
    { left: 100, top: 100, width: 20, height: 12 },
    // This adjacent glyph has enough overlap to qualify vertically and
    // horizontally, but its ordinary-text portion left of x=100 is not linked.
    { left: 93, top: 100, width: 10, height: 12 },
  ]), [
    { left: 100, top: 100, width: 20, height: 12 },
  ]);
});

test('page-level link calibration keeps shifted contents destinations on their own rows', () => {
  const links = [
    // Intentionally out of visual order, matching the source PDF's annotation order.
    { left: 80.929, top: 522.636, width: 318.966, height: 13.846 }, // 12.4
    { left: 80.929, top: 492.748, width: 318.966, height: 13.846 }, // 12.2
    { left: 80.929, top: 507.692, width: 318.966, height: 13.846 }, // 12.3
  ];
  const aligned = navigation.alignPdfLinkRectsToTextLayer(links, [
    { left: 70, top: 529, width: 284, height: 12 }, // 12.2
    { left: 70, top: 544, width: 133, height: 12 },
    { left: 342, top: 544, width: 12, height: 12 }, // 12.3 page number
    { left: 70, top: 559, width: 124, height: 11 },
    { left: 340, top: 559, width: 14, height: 11 }, // 12.4 page number
  ], { width: 504, height: 720 });

  assert.equal(aligned[0].top, 559);
  assert.equal(aligned[0].height, 11);
  assert.equal(aligned[1].top, 529);
  assert.equal(aligned[1].height, 12);
  assert.equal(aligned[2].top, 544);
  assert.equal(aligned[2].height, 12);

  // The page has CropBox/MediaBox origin (36, 36); both axes need correction.
  for (const rect of aligned) {
    assert.ok(rect.left > 44 && rect.left < 47);
    assert.equal(rect.width, 318.966);
  }
  assert.ok(aligned[1].top + aligned[1].height < aligned[2].top);
  assert.ok(aligned[2].top + aligned[2].height < aligned[0].top);
});

test('page-level link calibration prefers a shared crop-origin shift for narrow links', () => {
  const links = [
    { left: 302, top: 63.867, width: 61.6, height: 13.067 },
    { left: 87.333, top: 124.533, width: 55.067, height: 12.133 },
    { left: 101.333, top: 379.333, width: 56, height: 13.067 },
  ];
  const aligned = navigation.alignPdfLinkRectsToTextLayer(links, [
    // Full-width neighboring lines occupy the uncorrected annotation rows.
    // A vertical-only calibration therefore has an equally strong zero-shift
    // explanation, even though these runs cannot be the annotated labels.
    { left: 51, top: 63.867, width: 280, height: 13.067 },
    { left: 51, top: 124.533, width: 280, height: 12.133 },
    { left: 51, top: 379.333, width: 280, height: 13.067 },
    // The actual labels share the page's (-36, +36) CropBox correction and
    // retain the annotation dimensions.
    { left: 266, top: 99.867, width: 61.6, height: 13.067 },
    { left: 51.333, top: 160.533, width: 55.067, height: 12.133 },
    { left: 65.333, top: 415.333, width: 56, height: 13.067 },
  ], { width: 504, height: 720 });

  assert.deepEqual(aligned.map(rect => ({
    left: Math.round(rect.left * 1000) / 1000,
    top: Math.round(rect.top * 1000) / 1000,
    width: Math.round(rect.width * 1000) / 1000,
    height: Math.round(rect.height * 1000) / 1000,
  })), [
    { left: 266, top: 99.867, width: 61.6, height: 13.067 },
    { left: 51.333, top: 160.533, width: 55.067, height: 12.133 },
    { left: 65.333, top: 415.333, width: 56, height: 13.067 },
  ]);
});

test('page-level crop-origin inference preserves already aligned narrow links', () => {
  const links = [
    { left: 100, top: 100, width: 40, height: 10 },
    { left: 220, top: 260, width: 52, height: 12 },
  ];
  assert.deepEqual(navigation.alignPdfLinkRectsToTextLayer(links, [
    // Exact current-position matches are stronger evidence than coincidental
    // same-sized runs one page-box origin away.
    { left: 100, top: 100, width: 40, height: 10 },
    { left: 220, top: 260, width: 52, height: 12 },
    { left: 64, top: 136, width: 40, height: 10 },
    { left: 184, top: 296, width: 52, height: 12 },
  ], { width: 504, height: 720 }), links);
});

test('DDIA page 115 keeps Chapter 2 and Figure 3-9 links on their own glyphs', () => {
  const links = [
    // Captured EmbedPDF annotation geometry from DDIA page 115, in source
    // order. Entries 6 and 8 target Chapter 2 and Figure 3-9.
    { left: 262.8999938965, top: 273.141998291, width: 10.0800170898, height: 10.5 },
    { left: 277.7579956055, top: 273.141998291, width: 10.0800170898, height: 10.5 },
    { left: 292.6159973145, top: 273.141998291, width: 10.0800170898, height: 10.5 },
    { left: 321.7919921875, top: 354.7420043945, width: 10.0800170898, height: 10.5 },
    { left: 337.2550048828, top: 354.7420043945, width: 10.0799865723, height: 10.5 },
    { left: 235.3070068359, top: 367.342010498, width: 10.0799865723, height: 10.5 },
    { left: 136.3489990234, top: 412.7510070801, width: 41.9179992676, height: 10.5 },
    { left: 143.3059997559, top: 463.1510009766, width: 10.0800018311, height: 10.5 },
    { left: 175.7369995117, top: 481.7510070801, width: 43.9869995117, height: 10.5 },
  ];
  const textRects = [
    { left: 72, top: 270, width: 360, height: 14 },
    { left: 72, top: 352, width: 360, height: 14 },
    { left: 72, top: 364, width: 360, height: 14 },
    { left: 72, top: 410, width: 360, height: 14 },
    { left: 72, top: 460, width: 360, height: 14 },
    { left: 72, top: 479, width: 360, height: 14 },
    { left: 136, top: 410, width: 42, height: 14 }, // Chapter 2
    { left: 280, top: 447, width: 50, height: 15 }, // star schema (ordinary prose)
    { left: 72, top: 479, width: 103, height: 14 }, // The example schema in
    { left: 176, top: 479, width: 44, height: 14 }, // Figure 3-9
  ];

  const aligned = navigation.alignPdfLinkRectsToTextLayer(
    links,
    textRects,
    { width: 504, height: 661.464 },
  );

  assert.equal(aligned.length, links.length);
  assert.equal(aligned[6].left, links[6].left);
  assert.equal(aligned[8].left, links[8].left);

  const glyphs = [
    { left: 83.51, top: 410, width: 42, height: 14 }, // unrelated prose
    { left: 136, top: 410, width: 42, height: 14 }, // Chapter 2
    { left: 122.898, top: 479, width: 44, height: 14 }, // ordinary "schema"
    { left: 176, top: 479, width: 44, height: 14 }, // Figure 3-9
  ];
  assert.deepEqual(
    navigation.pdfLinkHitRects(aligned[6], glyphs).map(rect => rect.left),
    [links[6].left],
  );
  assert.deepEqual(
    navigation.pdfLinkHitRects(aligned[8], glyphs).map(rect => rect.left),
    [176],
  );
});

test('single shifted body link aligns to its unique text run instead of an overlapping prior row', () => {
  const link = {
    left: 103.1729965209961,
    top: 136.76397705078125,
    width: 67.2770004272461,
    height: 13.3699951171875,
  };
  const [aligned] = navigation.alignPdfLinkRectsToTextLayer([link], [
    // This unrelated line occupies the raw annotation rectangle and used to
    // win the per-link overlap fallback.
    { left: 55, top: 137, width: 299, height: 13 },
    { left: 67, top: 173, width: 67, height: 13 },
  ], { width: 504, height: 720 });

  assert.deepEqual(aligned, {
    left: 67,
    top: 173,
    width: 67.2770004272461,
    height: 13,
  });
});

test('single-link crop-origin inference rejects equally plausible text runs', () => {
  const link = { left: 103, top: 137, width: 67, height: 13 };
  assert.deepEqual(navigation.alignPdfLinkRectsToTextLayer([link], [
    { left: 67, top: 173, width: 67, height: 13 },
    { left: 53, top: 187, width: 67, height: 13 },
  ], { width: 504, height: 720 }), [link]);
});

test('page-level link calibration preserves weak or ambiguous geometry', () => {
  const links = [
    { left: 10, top: 10, width: 40, height: 10 },
    { left: 10, top: 80, width: 40, height: 10 },
  ];
  assert.deepEqual(navigation.alignPdfLinkRectsToTextLayer(links, [
    { left: 200, top: 30, width: 20, height: 10 },
    { left: 200, top: 50, width: 20, height: 10 },
    { left: 200, top: 100, width: 20, height: 10 },
  ]), links);
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

test('XYZ destination coordinates come from normalized params even when the raw view is empty', () => {
  assert.deepEqual(navigation.pdfDestinationViewerTarget({
    pageIndex: 0,
    view: [],
    zoom: {
      mode: PdfZoomMode.XYZ,
      params: { x: 20, y: 70, zoom: 1 },
    },
  }, {
    size: { width: 100, height: 200 },
    rotation: 0,
  }, false), {
    x: 20,
    y: 130,
    alignX: true,
  });
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
