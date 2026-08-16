import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clipboardSource = join(
  packageRoot,
  '../pdf-editor/src/webview/pdfAgentClipboard.ts',
);
const MAX_PNG_BYTES = 5 * 1024 * 1024;
const MAX_CROP_EDGE = 1600;

function compileTsModule(filename) {
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

let canvasState;

class FakeCanvasContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '';
    this.strokeStyle = '';
    this.lineWidth = 1;
    this.operations = [];
  }

  fillRect(...args) {
    this.operations.push({
      type: 'fillRect',
      fillStyle: this.fillStyle,
      args,
    });
  }

  drawImage(source, ...args) {
    if (source?.invalidCanvasImageSource) {
      throw new TypeError('The provided value is not a valid CanvasImageSource');
    }
    this.operations.push({ type: 'drawImage', source, args });
    if (Number.isSafeInteger(source.sourcePage)) {
      canvasState.renderedPages.push(source.sourcePage);
    }
  }

  strokeRect(...args) {
    this.operations.push({
      type: 'strokeRect',
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      args,
    });
  }
}

class FakeCanvas {
  constructor(width = 0, height = 0, sourcePage = undefined) {
    this.width = width;
    this.height = height;
    this.sourcePage = sourcePage;
    this.context = new FakeCanvasContext(this);
  }

  getContext(kind) {
    assert.equal(kind, '2d');
    if (canvasState.contextFailures > 0) {
      canvasState.contextFailures--;
      return null;
    }
    return this.context;
  }

  toDataURL(kind) {
    assert.equal(kind, 'image/png');
    if (canvasState.dataUrlError) throw canvasState.dataUrlError;
    return canvasState.dataUrl;
  }

  toBlob(callback, kind) {
    assert.equal(kind, 'image/png');
    if (canvasState.blobMode === 'throw') {
      throw new Error('PNG encoding failed');
    }
    const size = Math.max(
      1,
      canvasState.blobSizeOverride
        ?? Math.ceil(this.width * this.height * canvasState.blobBytesPerPixel),
    );
    const blob = new Blob([new Uint8Array(size)], { type: kind });
    canvasState.encoded.push({
      canvas: this,
      width: this.width,
      height: this.height,
      size,
    });
    if (canvasState.blobMode === 'null') {
      callback(null);
    } else if (canvasState.blobMode === 'async') {
      queueMicrotask(() => callback(blob));
    } else {
      callback(blob);
    }
  }
}

function resetCanvasState(overrides = {}) {
  canvasState = {
    blobBytesPerPixel: 0.01,
    blobMode: 'sync',
    blobSizeOverride: undefined,
    contextFailures: 0,
    created: [],
    dataUrl: 'data:image/png;base64,AAAA',
    dataUrlError: undefined,
    encoded: [],
    renderedPages: [],
    ...overrides,
  };
}

function sourceCanvas(page, width = 1224, height = 1584) {
  return new FakeCanvas(width, height, page);
}

function singlePageCropInput(canvas = sourceCanvas(2)) {
  return {
    pages: [{
      page: 2,
      canvas,
      pageWidth: 612,
      pageHeight: 792,
      rects: [[10, 20, 100, 40]],
    }],
  };
}

const originalDocument = globalThis.document;
globalThis.document = {
  createElement: tagName => {
    assert.equal(tagName, 'canvas');
    const canvas = new FakeCanvas();
    canvasState.created.push(canvas);
    return canvas;
  },
};

const pdfAgentClipboard = compileTsModule(clipboardSource);

test.after(() => {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
});

test.beforeEach(() => {
  resetCanvasState();
});

test('single-page crop preserves Ask PDF bounds, background, and selection outline', () => {
  const canvas = sourceCanvas(2);

  const dataUrl = pdfAgentClipboard.capturePdfSelectionCrop(
    {
      canvas,
      pageWidth: 612,
      pageHeight: 792,
    },
    {
      page: 2,
      rects: [[100, 200, 300, 260]],
    },
  );

  assert.equal(dataUrl, canvasState.dataUrl);
  assert.equal(canvasState.created.length, 1);
  const [output] = canvasState.created;
  assert.equal(output.width, 496);
  assert.equal(output.height, 216);
  assert.deepEqual(output.context.operations, [
    {
      type: 'fillRect',
      fillStyle: '#ffffff',
      args: [0, 0, 496, 216],
    },
    {
      type: 'drawImage',
      source: canvas,
      args: [152, 352, 496, 216, 0, 0, 496, 216],
    },
    {
      type: 'strokeRect',
      strokeStyle: '#4dabf7',
      lineWidth: 2.7,
      args: [48, 48, 400, 120],
    },
  ]);
});

test('stitches crops in page order at a common width with a white 12-pixel gutter', () => {
  const page2 = new FakeCanvas(200, 100, 2);
  const page3 = new FakeCanvas(100, 100, 3);

  const output = pdfAgentClipboard.stitchPdfSelectionCrops([
    { page: 3, canvas: page3, cropRect: [0, 0, 50, 50] },
    { page: 2, canvas: page2, cropRect: [0, 0, 100, 50] },
  ]);

  assert.ok(output);
  assert.equal(output.width, 200);
  assert.equal(output.height, 312);
  assert.deepEqual(output.context.operations, [
    {
      type: 'fillRect',
      fillStyle: '#ffffff',
      args: [0, 0, 200, 312],
    },
    {
      type: 'drawImage',
      source: page2,
      args: [0, 0, 200, 100],
    },
    {
      type: 'drawImage',
      source: page3,
      args: [0, 112, 200, 200],
    },
  ]);
});

test('captures unsorted PDF pages in page order within edge and byte limits', async () => {
  const blob = await pdfAgentClipboard.capturePdfAgentClipboardPng({
    pages: [
      {
        page: 3,
        canvas: sourceCanvas(3),
        pageWidth: 612,
        pageHeight: 792,
        rects: [[80, 120, 340, 240]],
      },
      {
        page: 2,
        canvas: sourceCanvas(2),
        pageWidth: 612,
        pageHeight: 792,
        rects: [[100, 200, 300, 260]],
      },
    ],
  });

  assert.ok(blob);
  assert.equal(canvasState.renderedPages.join(','), '2,3');
  const encoded = canvasState.encoded.at(-1);
  assert.ok(encoded.width <= MAX_CROP_EDGE);
  assert.ok(encoded.height <= MAX_CROP_EDGE);
  assert.ok(blob.size <= MAX_PNG_BYTES);
  assert.equal(blob.type, 'image/png');
});

test('keeps a literal 12-pixel gutter after edge bounding', () => {
  const output = pdfAgentClipboard.stitchPdfSelectionCrops([
    {
      page: 2,
      canvas: sourceCanvas(2, 2400, 2400),
      cropRect: [0, 0, 600, 600],
    },
    {
      page: 3,
      canvas: sourceCanvas(3, 2400, 2400),
      cropRect: [0, 0, 600, 600],
    },
  ]);

  assert.ok(output);
  assert.equal(output.height, MAX_CROP_EDGE);
  const draws = output.context.operations.filter(
    operation => operation.type === 'drawImage',
  );
  assert.equal(draws.length, 2);
  assert.equal(
    draws[1].args[1] - (draws[0].args[1] + draws[0].args[3]),
    12,
  );
});

test('keeps a literal 12-pixel gutter through PNG byte retries', async () => {
  resetCanvasState({ blobBytesPerPixel: 6 });

  const blob = await pdfAgentClipboard.capturePdfAgentClipboardPng({
    pages: [
      {
        page: 2,
        canvas: sourceCanvas(2, 2400, 2400),
        pageWidth: 600,
        pageHeight: 600,
        rects: [[0, 0, 600, 600]],
      },
      {
        page: 3,
        canvas: sourceCanvas(3, 2400, 2400),
        pageWidth: 600,
        pageHeight: 600,
        rects: [[0, 0, 600, 600]],
      },
    ],
  });

  assert.ok(blob);
  assert.ok(canvasState.encoded.length > 1);
  assert.equal(canvasState.encoded[0].height, MAX_CROP_EDGE);
  assert.ok(canvasState.encoded[0].size > MAX_PNG_BYTES);
  assert.ok(blob.size <= MAX_PNG_BYTES);
  for (const encoded of canvasState.encoded) {
    const draws = encoded.canvas.context.operations.filter(
      operation => operation.type === 'drawImage',
    );
    assert.equal(draws.length, 2);
    assert.equal(
      draws[1].args[1] - (draws[0].args[1] + draws[0].args[3]),
      12,
    );
  }
  assert.ok(canvasState.encoded.at(-1).width < canvasState.encoded[0].width);
  assert.ok(canvasState.encoded.at(-1).height < canvasState.encoded[0].height);
  assert.ok(canvasState.encoded.at(-1).width <= MAX_CROP_EDGE);
  assert.ok(canvasState.encoded.at(-1).height <= MAX_CROP_EDGE);
});

test('rejects a page when any selection rectangle is malformed', async () => {
  const blob = await pdfAgentClipboard.capturePdfAgentClipboardPng({
    pages: [{
      page: 2,
      canvas: sourceCanvas(2),
      pageWidth: 612,
      pageHeight: 792,
      rects: [[10, 20, 100, 40], [100, 20, 10, 40]],
    }],
  });

  assert.equal(blob, undefined);
});

test('rejects malformed crop geometry instead of producing a partial image', async () => {
  const malformedInputs = [
    { pages: [] },
    {
      pages: [{
        page: 2,
        canvas: sourceCanvas(2),
        pageWidth: 0,
        pageHeight: 792,
        rects: [[10, 20, 100, 40]],
      }],
    },
    {
      pages: [{
        page: 2,
        canvas: sourceCanvas(2),
        pageWidth: 612,
        pageHeight: 792,
        rects: [[10, 20, Number.NaN, 40], [100, 20, 10, 40]],
      }],
    },
    {
      pages: [
        {
          page: 2,
          canvas: sourceCanvas(2),
          pageWidth: 612,
          pageHeight: 792,
          rects: [[10, 20, 100, 40]],
        },
        {
          page: 2,
          canvas: sourceCanvas(2),
          pageWidth: 612,
          pageHeight: 792,
          rects: [[110, 20, 200, 40]],
        },
      ],
    },
    {
      pages: [
        null,
        {
          page: 2,
          canvas: sourceCanvas(2),
          pageWidth: 612,
          pageHeight: 792,
          rects: [[10, 20, 100, 40]],
        },
      ],
    },
  ];

  for (const input of malformedInputs) {
    assert.equal(
      await pdfAgentClipboard.capturePdfAgentClipboardPng(input),
      undefined,
    );
  }

  assert.equal(
    pdfAgentClipboard.stitchPdfSelectionCrops([
      null,
      {
        page: 2,
        canvas: sourceCanvas(2),
        cropRect: [10, 20, 100, 40],
      },
    ]),
    undefined,
  );
});

test('fails closed when any selected page canvas is missing', async () => {
  const blob = await pdfAgentClipboard.capturePdfAgentClipboardPng({
    pages: [{
      page: 2,
      canvas: undefined,
      pageWidth: 612,
      pageHeight: 792,
      rects: [[10, 20, 100, 40]],
    }],
  });

  assert.equal(blob, undefined);
});

test('fails closed when a crop cannot obtain a 2D context', async () => {
  resetCanvasState({ contextFailures: 1 });

  const blob = await pdfAgentClipboard.capturePdfAgentClipboardPng({
    pages: [{
      page: 2,
      canvas: sourceCanvas(2),
      pageWidth: 612,
      pageHeight: 792,
      rects: [[10, 20, 100, 40]],
    }],
  });

  assert.equal(blob, undefined);
});

function throwingCanvasImageSource() {
  return {
    width: 1224,
    height: 1584,
    invalidCanvasImageSource: true,
    getContext: () => ({}),
  };
}

test('clipboard capture fails closed when a source throws during drawImage', async () => {
  const canvas = throwingCanvasImageSource();

  assert.equal(
    await pdfAgentClipboard.capturePdfAgentClipboardPng(
      singlePageCropInput(canvas),
    ),
    undefined,
  );
});

test('Ask PDF rethrows drawImage failures only in explicit throw mode', () => {
  const canvas = throwingCanvasImageSource();
  const invalidCanvasImageSource = {
    canvas,
    pageWidth: 612,
    pageHeight: 792,
  };

  assert.equal(
    pdfAgentClipboard.capturePdfSelectionCrop(
      invalidCanvasImageSource,
      { page: 2, rects: [[10, 20, 100, 40]] },
    ),
    undefined,
  );
  assert.throws(
    () => pdfAgentClipboard.capturePdfSelectionCrop(
      invalidCanvasImageSource,
      { page: 2, rects: [[10, 20, 100, 40]] },
      { throwOnCaptureError: true },
    ),
    /valid CanvasImageSource/,
  );
});

test('direct stitching fails closed when a crop throws during drawImage', () => {
  assert.equal(
    pdfAgentClipboard.stitchPdfSelectionCrops([{
      page: 2,
      canvas: throwingCanvasImageSource(),
      cropRect: [10, 20, 100, 40],
    }]),
    undefined,
  );
});

test('fails closed for null and throwing PNG encoders', async () => {
  for (const blobMode of ['null', 'throw']) {
    resetCanvasState({ blobMode });
    assert.equal(
      await pdfAgentClipboard.capturePdfAgentClipboardPng(singlePageCropInput()),
      undefined,
      blobMode,
    );
  }
});

test('accepts an asynchronously encoded PNG Blob', async () => {
  resetCanvasState({ blobMode: 'async' });

  const blob = await pdfAgentClipboard.capturePdfAgentClipboardPng(
    singlePageCropInput(),
  );

  assert.ok(blob);
  assert.equal(blob.type, 'image/png');
  assert.ok(blob.size <= MAX_PNG_BYTES);
});

test('returns undefined after exhausting all oversized PNG retries', async () => {
  resetCanvasState({ blobSizeOverride: MAX_PNG_BYTES + 1 });

  const blob = await pdfAgentClipboard.capturePdfAgentClipboardPng(
    singlePageCropInput(),
  );

  assert.equal(blob, undefined);
  assert.equal(canvasState.encoded.length, 8);
});
