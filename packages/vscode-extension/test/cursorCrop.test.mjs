import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 5 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function loadCursorCrop() {
  const filename = join(packageRoot, 'src/cursorCrop.ts');
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
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
  Module._load = request => request === './pdfDiscussionController'
    ? { PDF_DISCUSSION_MAX_PNG_BYTES: MAX_BYTES }
    : originalLoad(request);
  try {
    mod._compile(outputText, filename);
    return mod.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const {
  decodeCursorCropPngBase64,
  validateCursorCropPng,
} = loadCursorCrop();

test('Cursor crop validator accepts a complete bounded PNG and canonical base64', () => {
  const png = makePng();

  assert.deepEqual(Buffer.from(validateCursorCropPng(png)), png);
  assert.deepEqual(
    Buffer.from(decodeCursorCropPngBase64(png.toString('base64'))),
    png,
  );
  assert.equal(decodeCursorCropPngBase64(`${png.toString('base64')}\n`), undefined);
  assert.equal(decodeCursorCropPngBase64(42), undefined);
});

test('Cursor crop validator rejects signature stubs, malformed framing, CRC errors, and trailing bytes', () => {
  const png = makePng();
  const badCrc = Buffer.from(png);
  badCrc[badCrc.length - 5] ^= 1;
  const impossibleLength = Buffer.from(png);
  impossibleLength.writeUInt32BE(0xffffffff, 8);

  for (const invalid of [
    Buffer.concat([PNG_SIGNATURE, Buffer.from([0])]),
    png.subarray(0, png.length - 1),
    Buffer.concat([png, Buffer.from([0])]),
    badCrc,
    impossibleLength,
    Buffer.alloc(MAX_BYTES + 1),
  ]) {
    assert.equal(validateCursorCropPng(invalid), undefined);
  }
});

test('Cursor crop validator enforces one leading IHDR and a terminal IEND around IDAT', () => {
  const header = ihdr();
  const data = chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0])));
  const end = chunk('IEND');
  const ancillary = chunk('tEXt', Buffer.from('key\u0000value'));

  for (const invalid of [
    assemble([data, chunk('IHDR', header), end]),
    assemble([chunk('IHDR', header), chunk('IHDR', header), data, end]),
    assemble([chunk('IHDR', header), end]),
    assemble([chunk('IHDR', header), chunk('IDAT'), end]),
    assemble([chunk('IHDR', header), data]),
    assemble([chunk('IHDR', header), data, ancillary, data, end]),
    assemble([chunk('IHDR', header), data, chunk('IEND', Buffer.from([0]))]),
    assemble([chunk('IHDR', header), chunk('ABCD'), data, end]),
  ]) {
    assert.equal(validateCursorCropPng(invalid), undefined);
  }
});

test('Cursor crop validator bounds dimensions and accepts only legal IHDR modes', () => {
  assert.ok(validateCursorCropPng(makePng({ width: 1600, height: 1600 })));
  assert.equal(validateCursorCropPng(makePng({ width: 0 })), undefined);
  assert.equal(validateCursorCropPng(makePng({ width: 1601 })), undefined);

  for (const options of [
    { bitDepth: 4, colorType: 2 },
    { bitDepth: 8, colorType: 1 },
    { compression: 1 },
    { filter: 1 },
    { interlace: 1 },
    { interlace: 2 },
  ]) {
    assert.equal(validateCursorCropPng(makePng(options)), undefined);
  }
});

test('Cursor crop validator decodes every supported non-interlaced color mode', () => {
  const modes = [
    ...[1, 2, 4, 8, 16].map(bitDepth => ({ bitDepth, colorType: 0 })),
    ...[8, 16].map(bitDepth => ({ bitDepth, colorType: 2 })),
    ...[1, 2, 4, 8].map(bitDepth => ({
      bitDepth,
      colorType: 3,
      palette: Buffer.from([0, 0, 0, 255, 255, 255]),
    })),
    ...[8, 16].map(bitDepth => ({ bitDepth, colorType: 4 })),
    ...[8, 16].map(bitDepth => ({ bitDepth, colorType: 6 })),
  ];

  for (const mode of modes) {
    assert.ok(validateCursorCropPng(makePng({ ...mode, width: 3, height: 2 })));
  }
});

test('Cursor crop validator rejects malformed or inconsistent decoded scanlines', () => {
  const header = chunk('IHDR', ihdr());
  const end = chunk('IEND');
  for (const data of [
    Buffer.from('not-zlib'),
    deflateSync(Buffer.alloc(4)),
    deflateSync(Buffer.alloc(6)),
    deflateSync(Buffer.from([5, 0, 0, 0, 0])),
  ]) {
    assert.equal(
      validateCursorCropPng(assemble([header, chunk('IDAT', data), end])),
      undefined,
    );
  }

  const compressed = deflateSync(scanlines({ width: 3, height: 2 }));
  const split = Math.floor(compressed.length / 2);
  assert.ok(validateCursorCropPng(assemble([
    chunk('IHDR', ihdr({ width: 3, height: 2 })),
    chunk('IDAT', compressed.subarray(0, split)),
    chunk('IDAT', compressed.subarray(split)),
    end,
  ])));
});

test('indexed Cursor crops require a valid leading palette', () => {
  assert.equal(
    validateCursorCropPng(makePng({ bitDepth: 1, colorType: 3 })),
    undefined,
  );
  assert.ok(validateCursorCropPng(makePng({
    bitDepth: 1,
    colorType: 3,
    palette: Buffer.from([0, 0, 0, 255, 255, 255]),
  })));
  assert.equal(validateCursorCropPng(makePng({
    bitDepth: 1,
    colorType: 3,
    palette: Buffer.from([0, 0, 0, 1, 1, 1, 2, 2, 2]),
  })), undefined);
});

function makePng({
  width = 1,
  height = 1,
  bitDepth = 8,
  colorType = 6,
  compression = 0,
  filter = 0,
  interlace = 0,
  palette,
} = {}) {
  const chunks = [chunk('IHDR', ihdr({
    width,
    height,
    bitDepth,
    colorType,
    compression,
    filter,
    interlace,
  }))];
  if (palette) chunks.push(chunk('PLTE', palette));
  chunks.push(
    chunk('IDAT', deflateSync(scanlines({ width, height, bitDepth, colorType }))),
    chunk('IEND'),
  );
  return assemble(chunks);
}

function scanlines({ width, height, bitDepth = 8, colorType = 6 }) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType] ?? 4;
  const stride = Math.ceil(width * channels * bitDepth / 8) + 1;
  return Buffer.alloc(height * stride);
}

function ihdr({
  width = 1,
  height = 1,
  bitDepth = 8,
  colorType = 6,
  compression = 0,
  filter = 0,
  interlace = 0,
} = {}) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = bitDepth;
  data[9] = colorType;
  data[10] = compression;
  data[11] = filter;
  data[12] = interlace;
  return data;
}

function assemble(chunks) {
  return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
