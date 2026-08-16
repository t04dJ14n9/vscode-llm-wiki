import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(packageRoot, '../..');
const outlineSource = join(
  workspaceRoot,
  'packages/pdf-editor/src/webview/domain/pdfOutline.ts',
);
const inferredOutlineSource = join(
  workspaceRoot,
  'packages/pdf-editor/src/webview/domain/pdfInferredOutline.ts',
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

const outline = compileTsModule(outlineSource, {
  '@embedpdf/models': { PdfActionType, PdfZoomMode },
});
const inferred = compileTsModule(inferredOutlineSource, {
  './pdfOutline': outline,
});

function item(content, left, top, width, height, font = {}) {
  return {
    content,
    rect: {
      origin: { x: left, y: top },
      size: { width, height },
    },
    font: {
      family: font.family ?? 'Times',
      size: font.size ?? height,
      weight: font.weight ?? 400,
      italic: font.italic ?? false,
    },
  };
}

function xyz(pageIndex, x, y) {
  return {
    pageIndex,
    zoom: {
      mode: PdfZoomMode.XYZ,
      params: { x, y, zoom: 0 },
    },
    view: [],
  };
}

function bodyLines(startTop = 150) {
  return Array.from({ length: 6 }, (_, index) => (
    item(
      `Body text line ${index + 1} establishes the ordinary document typography.`,
      72,
      startTop + index * 15,
      340,
      10,
    )
  ));
}

test('inferred outline reconstructs fragmented numbered headings and nests decimal sections', () => {
  const result = inferred.inferPdfOutline([{
    pageIndex: 0,
    width: 612,
    height: 792,
    items: [
      item('1', 72, 120, 8, 14, { size: 14, weight: 700 }),
      item('Introduction', 86, 120, 90, 14, { size: 14, weight: 700 }),
      ...bodyLines(),
      item('1.1', 72, 280, 18, 12, { size: 12, weight: 700 }),
      item('Motivation', 96, 280, 70, 12, { size: 12, weight: 700 }),
      ...bodyLines(310),
      item('2', 72, 430, 8, 14, { size: 14, weight: 700 }),
      item('Method', 86, 430, 54, 14, { size: 14, weight: 700 }),
    ],
  }]);

  assert.deepEqual(result.entries, [{
    title: '1 Introduction',
    destination: xyz(0, 72, 672),
    children: [{
      title: '1.1 Motivation',
      destination: xyz(0, 72, 512),
      children: [],
    }],
  }, {
    title: '2 Method',
    destination: xyz(0, 72, 362),
    children: [],
  }]);
  assert.equal(result.candidateCount, 3);
});

test('inferred outline flattens a numbered child when no compatible visible ancestor exists', () => {
  const result = inferred.inferPdfOutline([{
    pageIndex: 0,
    width: 612,
    height: 792,
    items: [
      ...bodyLines(),
      item('3.2.1 Detached detail', 72, 300, 150, 13, { size: 13, weight: 700 }),
      ...bodyLines(330),
    ],
  }]);

  assert.deepEqual(result.entries, [{
    title: '3.2.1 Detached detail',
    destination: xyz(0, 72, 492),
    children: [],
  }]);
});

test('inferred outline accepts recurring typographic headings and rejects common PDF false positives', () => {
  const headingFont = { size: 14, weight: 700 };
  const pages = [{
    pageIndex: 0,
    width: 612,
    height: 792,
    items: [
      item('Running Conference Header', 72, 24, 160, 9),
      item('A One-Off Paper Title', 72, 70, 260, 22, { size: 22, weight: 700 }),
      item('Ada Author and Bert Writer', 72, 96, 200, 11),
      item('authors@example.org', 72, 112, 120, 10),
      item('Abstract', 72, 150, 62, 14, headingFont),
      ...bodyLines(180),
      item('Figure 1: A model overview.', 72, 310, 180, 11, headingFont),
      item('Algorithm 1 Learn merge operations', 72, 340, 210, 11, headingFont),
      item('• Experimental setup', 72, 370, 140, 11, headingFont),
      item('[1] A. Author. A cited paper.', 72, 400, 180, 11, headingFont),
      item('x = softmax(QK)', 72, 430, 120, 12, headingFont),
      item('1 Introduction', 72, 470, 110, 14, headingFont),
      ...bodyLines(500),
      item('1', 300, 760, 6, 9),
    ],
  }, {
    pageIndex: 1,
    width: 612,
    height: 792,
    items: [
      item('Running Conference Header', 72, 24, 160, 9),
      item('2 Method', 72, 90, 82, 14, headingFont),
      ...bodyLines(120),
      item('Conclusion', 72, 260, 72, 14, headingFont),
      ...bodyLines(290),
      item('2', 300, 760, 6, 9),
    ],
  }];

  assert.deepEqual(
    flattenTitles(inferred.inferPdfOutline(pages).entries),
    ['Abstract', '1 Introduction', '2 Method', 'Conclusion'],
  );
});

test('conventional labels without independent typography remain excluded', () => {
  const result = inferred.inferPdfOutline([{
    pageIndex: 0,
    width: 612,
    height: 792,
    items: [
      ...bodyLines(100),
      item('Introduction', 72, 210, 80, 10),
      ...bodyLines(240),
    ],
  }]);

  assert.deepEqual(result.entries, []);
});

test('empty and image-only pages fail closed without inferred entries', () => {
  assert.deepEqual(inferred.inferPdfOutline([]), {
    entries: [],
    candidateCount: 0,
  });
  assert.deepEqual(inferred.inferPdfOutline([{
    pageIndex: 0,
    width: 612,
    height: 792,
    items: [],
  }]), {
    entries: [],
    candidateCount: 0,
  });
});

test('recurring typography tiers create conservative unnumbered nesting', () => {
  const pages = [{
    pageIndex: 0,
    width: 612,
    height: 792,
    items: [
      item('Background', 72, 80, 92, 16, { size: 16, weight: 700 }),
      ...bodyLines(110),
      item('Data', 72, 230, 34, 13, { size: 13, weight: 700 }),
      ...bodyLines(260),
    ],
  }, {
    pageIndex: 1,
    width: 612,
    height: 792,
    items: [
      item('Results', 72, 80, 62, 16, { size: 16, weight: 700 }),
      ...bodyLines(110),
      item('Metrics', 72, 230, 48, 13, { size: 13, weight: 700 }),
      ...bodyLines(260),
    ],
  }];

  assert.deepEqual(inferred.inferPdfOutline(pages).entries, [{
    title: 'Background',
    destination: xyz(0, 72, 712),
    children: [{
      title: 'Data',
      destination: xyz(0, 72, 562),
      children: [],
    }],
  }, {
    title: 'Results',
    destination: xyz(1, 72, 712),
    children: [{
      title: 'Metrics',
      destination: xyz(1, 72, 562),
      children: [],
    }],
  }]);
});

function flattenTitles(entries) {
  return entries.flatMap(entry => [
    entry.title,
    ...flattenTitles(entry.children ?? []),
  ]);
}
