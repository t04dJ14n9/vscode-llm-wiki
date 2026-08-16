import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadTsModule(relativePath, mocks = {}) {
  const filename = join(packageRoot, relativePath);
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
    return mod.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const {
  markdownFootnoteIndex,
  obsidianCommentSourceSpans,
} = loadTsModule('webview-src/markdownSpans.ts', {
  './markdownFences': loadTsModule('webview-src/markdownFences.ts'),
});

test('literal Obsidian comment markers in inline code do not hide later footnotes', () => {
  const markdown = [
    'A percentage literal is `100%%` in inline code.',
    '',
    'The documented claim has evidence.[^real]',
    '',
    '[^real]: The rendered footnote remains visible.',
  ].join('\n');

  const index = markdownFootnoteIndex(markdown);

  assert.deepEqual(obsidianCommentSourceSpans(markdown), []);
  assert.equal(index.definitions.get('real')?.text, 'The rendered footnote remains visible.');
  assert.equal(index.references.get('real')?.length, 1);
});
