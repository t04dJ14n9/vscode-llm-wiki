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

function loadOutlineModule() {
  const source = readFileSync(outlineSource, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: outlineSource,
  });
  const mod = new Module(outlineSource);
  mod.filename = outlineSource;
  mod.paths = Module._nodeModulePaths(dirname(outlineSource));
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@embedpdf/models') return { PdfActionType, PdfZoomMode };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    mod._compile(outputText, outlineSource);
  } finally {
    Module._load = originalLoad;
  }
  return mod.exports;
}

const outline = loadOutlineModule();

test('bookmark conversion preserves hierarchy and only exposes internal destinations', () => {
  const direct = fitPageDestination(2);
  const goto = xyzDestination(8, { x: 12, y: 34, zoom: 1.5 });
  const entries = outline.pdfBookmarksToOutlineEntries([
    {
      title: '  Chapter   One ',
      target: { type: 'destination', destination: direct },
      children: [
        {
          title: 'Remote section',
          target: {
            type: 'action',
            action: {
              type: PdfActionType.RemoteGoto,
              destination: fitPageDestination(100),
            },
          },
          children: [{
            title: 'Internal child',
            target: {
              type: 'action',
              action: { type: PdfActionType.Goto, destination: goto },
            },
          }],
        },
        {
          title: 'Website',
          target: {
            type: 'action',
            action: { type: PdfActionType.URI, uri: 'https://example.com' },
          },
        },
      ],
    },
  ]);

  assert.deepEqual(entries, [{
    title: 'Chapter One',
    destination: direct,
    children: [
      {
        title: 'Remote section',
        children: [{
          title: 'Internal child',
          destination: goto,
          children: [],
        }],
      },
      {
        title: 'Website',
        children: [],
      },
    ],
  }]);
  assert.doesNotThrow(() => JSON.stringify(entries));
});

test('destination normalization accepts every supported mode and strips extra fields', () => {
  for (const mode of [
    PdfZoomMode.Unknown,
    PdfZoomMode.FitPage,
    PdfZoomMode.FitHorizontal,
    PdfZoomMode.FitVertical,
    PdfZoomMode.FitRectangle,
    PdfZoomMode.FitBoundingBox,
    PdfZoomMode.FitBoundingBoxHorizontal,
    PdfZoomMode.FitBoundingBoxVertical,
  ]) {
    assert.deepEqual(outline.normalizePdfOutlineDestination({
      pageIndex: 4,
      zoom: { mode, params: { ignored: true }, extra: true },
      view: ['1.25', -0],
      extra: 'discarded',
    }), {
      pageIndex: 4,
      zoom: { mode },
      view: [1.25, 0],
    });
  }

  assert.deepEqual(outline.normalizePdfOutlineDestination({
    pageIndex: 7,
    zoom: {
      mode: PdfZoomMode.XYZ,
      params: { x: '12', y: -4.5, zoom: '2', ignored: true },
    },
    view: [],
  }), xyzDestination(7, { x: 12, y: -4.5, zoom: 2 }));
});

test('destination normalization rejects malformed and non-finite values', () => {
  const valid = fitPageDestination(0);
  for (const value of [
    undefined,
    null,
    {},
    { ...valid, pageIndex: -1 },
    { ...valid, pageIndex: 1.5 },
    { ...valid, pageIndex: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, zoom: { mode: 99 } },
    { ...valid, zoom: { mode: PdfZoomMode.XYZ } },
    {
      ...valid,
      zoom: {
        mode: PdfZoomMode.XYZ,
        params: { x: 1, y: 2, zoom: Number.POSITIVE_INFINITY },
      },
    },
    { ...valid, view: [Number.NaN] },
    { ...valid, view: new Array(9).fill(0) },
    { ...valid, view: undefined },
  ]) {
    assert.equal(outline.normalizePdfOutlineDestination(value), undefined);
  }

  const sparseView = [];
  sparseView.length = 1;
  assert.equal(outline.normalizePdfOutlineDestination({
    ...valid,
    view: sparseView,
  }), undefined);
});

test('incoming outline normalization cleans titles, targets, and malformed entries', () => {
  const destination = fitPageDestination(3);
  const entries = outline.normalizePdfOutlineEntries([
    null,
    { title: 123, destination },
    {
      title: '\n First \t section ',
      destination: { ...destination, untrusted: 'removed' },
      children: [
        { title: 'External-shaped node', destination: { uri: 'https://example.com' } },
        { title: 'Child', destination: xyzDestination(5, { x: 1, y: 2, zoom: 3 }) },
      ],
      untrusted: 'removed',
    },
  ]);

  assert.deepEqual(entries, [{
    title: 'First section',
    destination,
    children: [
      { title: 'External-shaped node', children: [] },
      {
        title: 'Child',
        destination: xyzDestination(5, { x: 1, y: 2, zoom: 3 }),
        children: [],
      },
    ],
  }]);
});

test('outline normalization enforces title, depth, entry-count, and cycle bounds', () => {
  const longTitle = 'x'.repeat(outline.PDF_OUTLINE_MAX_TITLE_LENGTH + 100);
  assert.equal(
    outline.normalizePdfOutlineEntries([{ title: longTitle }])[0].title.length,
    outline.PDF_OUTLINE_MAX_TITLE_LENGTH,
  );

  const root = { title: 'level-0', children: [] };
  let current = root;
  for (let depth = 1; depth < outline.PDF_OUTLINE_MAX_DEPTH + 5; depth++) {
    const child = { title: `level-${depth}`, children: [] };
    current.children.push(child);
    current = child;
  }
  const depthBounded = outline.normalizePdfOutlineEntries([root]);
  let depth = 0;
  let cursor = depthBounded[0];
  while (cursor) {
    depth += 1;
    cursor = cursor.children[0];
  }
  assert.equal(depth, outline.PDF_OUTLINE_MAX_DEPTH);

  const many = Array.from(
    { length: outline.PDF_OUTLINE_MAX_ENTRIES + 100 },
    (_, index) => ({ title: `entry-${index}` }),
  );
  assert.equal(
    outline.normalizePdfOutlineEntries(many).length,
    outline.PDF_OUTLINE_MAX_ENTRIES,
  );

  const cyclic = { title: 'cycle', children: [] };
  cyclic.children.push(cyclic);
  assert.deepEqual(outline.normalizePdfOutlineEntries([cyclic]), [{
    title: 'cycle',
    children: [],
  }]);
});

test('invalid entries also consume the traversal budget', () => {
  const invalid = Array.from(
    { length: outline.PDF_OUTLINE_MAX_ENTRIES },
    () => ({ title: '' }),
  );
  invalid.push({ title: 'must not be reached' });
  assert.deepEqual(outline.normalizePdfOutlineEntries(invalid), []);
});

test('nested outline cycles stop at the repeated node without dropping later siblings', () => {
  const destination = fitPageDestination(6);
  const root = { title: 'Part I', children: [] };
  const chapter = {
    title: 'Chapter 7',
    destination,
    children: [root],
  };
  root.children.push(chapter);

  assert.deepEqual(outline.normalizePdfOutlineEntries([
    root,
    { title: 'Appendix', destination: fitPageDestination(9) },
  ]), [
    {
      title: 'Part I',
      children: [{
        title: 'Chapter 7',
        destination,
        children: [],
      }],
    },
    {
      title: 'Appendix',
      destination: fitPageDestination(9),
      children: [],
    },
  ]);
});

function fitPageDestination(pageIndex) {
  return {
    pageIndex,
    zoom: { mode: PdfZoomMode.FitPage },
    view: [],
  };
}

function xyzDestination(pageIndex, params) {
  return {
    pageIndex,
    zoom: { mode: PdfZoomMode.XYZ, params },
    view: [],
  };
}
