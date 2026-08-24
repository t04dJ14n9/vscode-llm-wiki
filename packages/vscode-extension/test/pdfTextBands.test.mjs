import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(packageRoot, '../pdf-editor/src/webview/pdfTextBands.ts');

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

const { normalizePdfTextBands } = loadTypeScriptModule(sourcePath);

test('staggered neighboring columns keep independent full-height text bands', () => {
  assert.deepEqual(normalizePdfTextBands([
    [0, 0, 50, 10],
    [70, 2, 120, 12],
    [0, 12, 50, 22],
    [70, 14, 120, 24],
  ]), [
    [0, 0, 50, 10],
    [70, 2, 120, 12],
    [0, 12, 50, 22],
    [70, 14, 120, 24],
  ]);
});

test('a staggered cross-column band cannot bridge and absorb the next local row', () => {
  assert.deepEqual(normalizePdfTextBands([
    [0, 0, 40, 10],
    [60, 6, 120, 16],
    [0, 12, 40, 22],
    [60, 18, 120, 28],
  ]), [
    [0, 0, 40, 10],
    [60, 6, 120, 16],
    [0, 12, 40, 22],
    [60, 18, 120, 28],
  ]);
});

test('tightly spaced bands clip only against vertically adjacent overlapping text', () => {
  assert.deepEqual(normalizePdfTextBands([
    [0, 0, 50, 10],
    [0, 8, 50, 18],
  ]), [
    [0, 0, 50, 8.75],
    [0, 9.25, 50, 18],
  ]);
});

test('disjoint segments on one baseline receive identical vertical coverage', () => {
  assert.deepEqual(normalizePdfTextBands([
    [0, 0, 20, 10],
    [60, 0, 80, 10],
  ]), [
    [0, 0, 20, 10],
    [60, 0, 80, 10],
  ]);
});

test('pre-unioned bold, italic, and small-cap fragments retain the full run band', () => {
  assert.deepEqual(normalizePdfTextBands([
    [0, 0, 90, 12],
    [0, 18, 110, 30],
  ]), [
    [0, 0, 90, 12],
    [0, 18, 110, 30],
  ]);
});

test('pre-unioned arrows, superscripts, subscripts, and stacked equations retain painted bounds', () => {
  assert.deepEqual(normalizePdfTextBands([
    [0, 4, 60, 22],
    [0, 26, 80, 38],
  ]), [
    [0, 4, 60, 22],
    [0, 26, 80, 38],
  ]);
});
