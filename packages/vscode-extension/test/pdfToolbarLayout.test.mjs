import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolbarSource = join(
  packageRoot,
  '../pdf-editor/src/webview/domain/pdfToolbarLayout.ts',
);

function loadToolbarModule() {
  const source = readFileSync(toolbarSource, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: toolbarSource,
  });
  const mod = new Module(toolbarSource);
  mod.filename = toolbarSource;
  mod.paths = Module._nodeModulePaths(dirname(toolbarSource));
  mod._compile(outputText, toolbarSource);
  return mod.exports;
}

const toolbar = loadToolbarModule();

test('PDF toolbar preferences normalize to a visible top dock and preserve valid state', () => {
  assert.deepEqual(toolbar.normalizePdfToolbarPreference(undefined), {
    dock: 'top',
    hidden: false,
  });
  assert.deepEqual(toolbar.normalizePdfToolbarPreference({
    dock: 'left',
    hidden: true,
    ignored: 'value',
  }), {
    dock: 'left',
    hidden: true,
  });
  assert.deepEqual(toolbar.normalizePdfToolbarPreference({
    dock: 'floating',
    hidden: 'yes',
  }), {
    dock: 'top',
    hidden: false,
  });
  assert.notEqual(
    toolbar.normalizePdfToolbarPreference(undefined),
    toolbar.DEFAULT_PDF_TOOLBAR_PREFERENCE,
  );
});

test('PDF toolbar toggle hides and restores the last visible dock', () => {
  assert.deepEqual(toolbar.togglePdfToolbarPreference({
    dock: 'left',
    hidden: false,
  }), {
    dock: 'left',
    hidden: true,
  });
  assert.deepEqual(toolbar.togglePdfToolbarPreference({
    dock: 'left',
    hidden: true,
  }), {
    dock: 'left',
    hidden: false,
  });
});

test('PDF toolbar docking resolves only bounded top and left edge targets', () => {
  const viewport = { width: 1000, height: 700 };
  assert.equal(
    toolbar.pdfToolbarDockAtPoint({ clientX: 4, clientY: 300 }, viewport),
    'left',
  );
  assert.equal(
    toolbar.pdfToolbarDockAtPoint({ clientX: 300, clientY: 4 }, viewport),
    'top',
  );
  assert.equal(
    toolbar.pdfToolbarDockAtPoint({ clientX: 300, clientY: 300 }, viewport),
    undefined,
  );
  assert.equal(
    toolbar.pdfToolbarDockAtPoint({ clientX: 8, clientY: 20 }, viewport),
    'left',
    'the closest edge wins when both docking regions overlap',
  );
  assert.equal(
    toolbar.pdfToolbarDockAtPoint({ clientX: 20, clientY: 8 }, viewport),
    'top',
  );
  assert.equal(
    toolbar.pdfToolbarDockAtPoint({ clientX: Number.NaN, clientY: 4 }, viewport),
    undefined,
  );
  assert.equal(
    toolbar.pdfToolbarDockAtPoint({ clientX: 15, clientY: 400 }, viewport, 1),
    'left',
    'edge sizes below the lower bound clamp to 16 pixels',
  );
  assert.equal(
    toolbar.pdfToolbarDockAtPoint({ clientX: 159, clientY: 400 }, viewport, 500),
    'left',
    'edge sizes above the upper bound clamp to 160 pixels',
  );
  assert.equal(
    toolbar.pdfToolbarDockAtPoint({ clientX: 161, clientY: 400 }, viewport, 500),
    undefined,
  );
});
