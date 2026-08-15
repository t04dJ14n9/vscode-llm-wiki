import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageManifest = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf8'),
);

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

test('markdownlint adapter delegates content and config to the pinned runtime', async () => {
  assert.equal(
    packageManifest.dependencies?.markdownlint,
    '^0.40.0',
    'markdownlint stays on the Node 20-compatible major/minor used by the extension',
  );

  const { lintMarkdownContent } = loadTsModule('src/markdownLint.ts');
  const results = await lintMarkdownContent({
    filePath: 'fixture.md',
    content: '# Heading\n\nThis paragraph is definitely too long.\n',
    config: { MD013: { line_length: 10 } },
  });

  assert.equal(results['fixture.md']?.length, 1);
  assert.deepEqual(results['fixture.md']?.[0], {
    lineNumber: 3,
    ruleNames: ['MD013', 'line-length'],
    ruleDescription: 'Line length',
    ruleInformation: 'https://github.com/DavidAnson/markdownlint/blob/v0.40.0/doc/md013.md',
    errorDetail: 'Expected: 10; Actual: 38',
    errorContext: null,
    errorRange: [11, 28],
    fixInfo: null,
    severity: 'error',
  });
});
