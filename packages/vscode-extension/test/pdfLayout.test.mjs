import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharedPdfRoot = resolve(packageRoot, '../pdf-editor');

function loadTsModule(relativePath) {
  const filename = join(sharedPdfRoot, relativePath);
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

test('pdf layout preserves exact scaled CSS size and DPR backing store', () => {
  const { createPdfPageLayout, formatCssPx } = loadTsModule('src/webview/pdfLayout.ts');

  const layout = createPdfPageLayout({ width: 612, height: 792 }, 1.35, 2);

  assert.deepEqual(layout, {
    cssWidth: 826.2,
    cssHeight: 1069.2,
    bitmapWidth: 1652,
    bitmapHeight: 2138,
    dpr: 2,
    scale: 1.35,
  });
  assert.equal(formatCssPx(layout.cssWidth), '826.2px');
});

test('pdf layout clamps invalid device pixel ratios to one', () => {
  const { createPdfPageLayout } = loadTsModule('src/webview/pdfLayout.ts');

  const layout = createPdfPageLayout({ width: 612, height: 792 }, 1.35, 0);

  assert.equal(layout.dpr, 1);
  assert.equal(layout.bitmapWidth, 826);
  assert.equal(layout.bitmapHeight, 1069);
});
