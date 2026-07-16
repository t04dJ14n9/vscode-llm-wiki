import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const markdownDist = path.join(repoRoot, 'packages/vscode-markdown-extension/dist');
const sqlJsRuntime = path.join(markdownDist, 'node_modules/sql.js');

test('markdown extension build includes externalized sql.js runtime', () => {
  const packageJsonPath = path.join(sqlJsRuntime, 'package.json');
  assert.ok(
    existsSync(packageJsonPath),
    'expected dist/node_modules/sql.js/package.json for installed VSIX activation',
  );

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  assert.equal(packageJson.main, './dist/sql-wasm.js');

  assert.ok(
    existsSync(path.join(sqlJsRuntime, 'dist/sql-wasm.js')),
    'expected sql.js CommonJS entrypoint in packaged runtime',
  );
  assert.ok(
    existsSync(path.join(sqlJsRuntime, 'dist/sql-wasm.wasm')),
    'expected sql.js WASM asset in packaged runtime',
  );
});
