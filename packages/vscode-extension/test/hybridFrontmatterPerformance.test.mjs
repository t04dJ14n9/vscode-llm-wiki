import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EditorState } from '@codemirror/state';
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

test('frontmatter cache is reused for body edits and refreshed for metadata edits', () => {
  const frontmatter = loadTsModule('webview-src/extensions/hybridFrontmatter.ts');
  assert.equal(typeof frontmatter.updateFrontmatterBlock, 'function');

  const state = EditorState.create({
    doc: [
      '---',
      'type: raw',
      'status: draft',
      '---',
      '',
      '# Body',
    ].join('\n'),
  });
  const initial = frontmatter.findFrontmatterBlock(state.doc);
  assert.ok(initial);

  const bodyEdit = state.update({
    changes: { from: state.doc.length, insert: '\nMore' },
  });
  assert.equal(frontmatter.updateFrontmatterBlock(initial, bodyEdit), initial);

  const statusFrom = state.doc.toString().indexOf('draft');
  const metadataEdit = state.update({
    changes: { from: statusFrom, to: statusFrom + 'draft'.length, insert: 'stable' },
  });
  const refreshed = frontmatter.updateFrontmatterBlock(initial, metadataEdit);
  assert.notEqual(refreshed, initial);
  assert.equal(refreshed.properties.find(property => property.name === 'status')?.value, 'stable');
});
