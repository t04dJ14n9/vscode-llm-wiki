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

test('parseGitDiffLines returns changed current-file lines for zero-context hunks', () => {
  const { parseGitDiffLines } = loadTsModule('src/gitDiff.ts');

  assert.deepEqual(
    parseGitDiffLines([
      'diff --git a/notes/demo.md b/notes/demo.md',
      'index 1111111..2222222 100644',
      '--- a/notes/demo.md',
      '+++ b/notes/demo.md',
      '@@ -2,1 +2,2 @@',
      '-old line',
      '+new line',
      '+second new line',
      '@@ -8,2 +9,0 @@',
      '-deleted one',
      '-deleted two',
    ].join('\n')),
    [
      { line: 2, kind: 'modified', before: 'old line', after: 'new line' },
      { line: 3, kind: 'added', after: 'second new line' },
      {
        line: 9,
        kind: 'deleted',
        before: 'deleted one\ndeleted two',
      },
    ],
  );
});

test('getGitDiffForFile asks git for HEAD diff scoped to the document', async () => {
  const calls = [];
  const { getGitDiffForFile } = loadTsModule('src/gitDiff.ts');

  const result = await getGitDiffForFile(
    '/workspace/notes/demo.md',
    '/workspace',
    {
      runner: async (args, cwd) => {
        calls.push({ args, cwd });
        if (args[0] === 'rev-parse') return '/workspace\n';
        return '@@ -1,1 +1,1 @@\n-old\n+new\n';
      },
    },
  );

  assert.deepEqual(result, {
    available: true,
    lines: [{ line: 1, kind: 'modified', before: 'old', after: 'new' }],
  });
  assert.deepEqual(calls, [
    {
      args: ['rev-parse', '--show-toplevel'],
      cwd: '/workspace',
    },
    {
      args: [
        'diff',
        'HEAD',
        '--no-color',
        '--no-ext-diff',
        '--unified=0',
        '--',
        'notes/demo.md',
      ],
      cwd: '/workspace',
    },
  ]);
});

test('getGitDiffForFile reports unavailable when the document is outside the repository', async () => {
  const { getGitDiffForFile } = loadTsModule('src/gitDiff.ts');

  const result = await getGitDiffForFile(
    '/other/demo.md',
    '/workspace',
    {
      runner: async args => {
        if (args[0] === 'rev-parse') return '/workspace\n';
        throw new Error('diff should not run');
      },
    },
  );

  assert.deepEqual(result, {
    available: false,
    lines: [],
  });
});
