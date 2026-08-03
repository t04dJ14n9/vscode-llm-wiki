import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { resolveVsCodeE2eTestDir } from './vscode-e2e/testDirectory.mjs';

const testDir = dirname(fileURLToPath(import.meta.url));

test('macOS default VS Code IPC path stays within the 103-byte socket limit', () => {
  const resolvedTestDir = resolveVsCodeE2eTestDir({
    platform: 'darwin',
    localTestDir: '/Users/example/a-very-long-workspace/packages/vscode-extension/test/vscode-e2e/.vscode-test',
    temporaryRoot: '/tmp',
  });
  const socketPath = resolve(resolvedTestDir, 'user-data', '1.12-main.sock');

  assert.ok(
    Buffer.byteLength(socketPath) <= 103,
    `expected a socket path no longer than 103 bytes, got ${Buffer.byteLength(socketPath)}: ${socketPath}`,
  );
});

test('manual VS Code runner uses the same short test directory as automated setup', () => {
  const source = readFileSync(resolve(testDir, 'vscode-e2e', 'vscode-runner.mjs'), 'utf8');

  assert.match(source, /resolveVsCodeE2eTestDir/);
  assert.doesNotMatch(source, /resolve\(__dirname,\s*['"]\.vscode-test['"]/);
});
