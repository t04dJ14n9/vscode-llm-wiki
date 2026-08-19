import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadTsModule(relativePath) {
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
  mod._compile(outputText, filename);
  return mod.exports;
}

const { parseTableRow, tableAlignmentsFromSeparator } = loadTsModule(
  'webview-src/extensions/hybridTables.ts',
);

test('parses short table separators and preserves HTML line breaks in cells', () => {
  const separator = '| - | - | - |';
  const cellText = 'first item<br/><br/>second item';

  assert.deepEqual(parseTableRow(separator), ['-', '-', '-']);
  assert.deepEqual(tableAlignmentsFromSeparator(separator), ['left', 'left', 'left']);
  assert.deepEqual(
    parseTableRow(`| ${cellText} |  |  |`),
    [cellText, '', ''],
  );
});
