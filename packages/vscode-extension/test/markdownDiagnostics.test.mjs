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

test('mapMarkdownLintResults maps a markdownlint range to document offsets', () => {
  const { mapMarkdownLintResults } = loadTsModule('src/markdownLint.ts');

  assert.deepEqual(
    mapMarkdownLintResults(
      'fixture.md',
      '# Title\n\nA very long paragraph.\n',
      {
        'fixture.md': [{
          lineNumber: 3,
          ruleNames: ['MD013', 'line-length'],
          ruleDescription: 'Line length',
          ruleInformation: 'https://example.test/md013',
          errorDetail: 'Expected: 10; Actual: 21',
          errorContext: null,
          errorRange: [11, 11],
          fixInfo: null,
          severity: 'error',
        }],
      },
    ),
    [{
      from: 20,
      to: 31,
      line: 3,
      message: 'Line length: Expected: 10; Actual: 21',
      source: 'markdownlint',
      code: 'MD013',
      severity: 'warning',
    }],
  );
});

test('collectMarkdownDiagnostics reports a missing local link at its destination', async () => {
  const markdownLinkDiagnostics = loadTsModule('src/markdownLinkDiagnostics.ts');
  const {
    collectMarkdownDiagnostics,
  } = loadTsModule('src/markdownDiagnostics.ts', {
    './markdownLint': {
      lintMarkdownContent: async () => ({}),
      mapMarkdownLintResults: () => [],
    },
    './markdownLinkDiagnostics': markdownLinkDiagnostics,
  });

  const content = 'Read [the missing note](notes/missing.md) now.\n';
  const destinationStart = content.indexOf('notes/missing.md');

  const diagnostics = await collectMarkdownDiagnostics({
    content,
    filePath: '/workspace/_index.md',
    workspaceRoot: '/workspace',
    fileSystem: {
      exists: candidate => candidate === '/workspace/_index.md',
      isDirectory: () => false,
      readText: async () => '',
    },
  });

  assert.deepEqual(diagnostics, [{
    from: destinationStart,
    to: destinationStart + 'notes/missing.md'.length,
    line: 1,
    message: 'Cannot find linked file "notes/missing.md".',
    source: 'markdown-link',
    code: 'MD-LINK',
    severity: 'error',
  }]);
});

test('directory link diagnostics accept the canonical underscore index', async () => {
  const markdownLinkDiagnostics = loadTsModule('src/markdownLinkDiagnostics.ts');
  const { collectMarkdownDiagnostics } = loadTsModule('src/markdownDiagnostics.ts', {
    './markdownLint': {
      lintMarkdownContent: async () => ({}),
      mapMarkdownLintResults: () => [],
    },
    './markdownLinkDiagnostics': markdownLinkDiagnostics,
  });

  const files = new Set(['/workspace/home.md', '/workspace/notes/_index.md']);
  const diagnostics = await collectMarkdownDiagnostics({
    content: '[Notes](notes/)\n',
    filePath: '/workspace/home.md',
    workspaceRoot: '/workspace',
    fileSystem: {
      exists: candidate => files.has(candidate) || candidate === '/workspace/notes',
      isDirectory: candidate => candidate === '/workspace/notes',
      readText: async () => '',
    },
  });
  assert.equal(diagnostics.some(diagnostic => diagnostic.code === 'MD-LINK'), false);
});
