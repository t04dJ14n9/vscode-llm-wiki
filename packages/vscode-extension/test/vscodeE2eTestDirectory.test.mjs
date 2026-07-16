import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'path';
import { resolveVsCodeE2eTestDir } from './vscode-e2e/testDirectory.mjs';

test('macOS default VS Code IPC path stays within the 103-byte socket limit', () => {
  const testDir = resolveVsCodeE2eTestDir({
    platform: 'darwin',
    localTestDir: '/Users/example/a-very-long-workspace/packages/vscode-extension/test/vscode-e2e/.vscode-test',
    temporaryRoot: '/tmp',
  });
  const socketPath = resolve(testDir, 'user-data', '1.12-main.sock');

  assert.ok(
    Buffer.byteLength(socketPath) <= 103,
    `expected a socket path no longer than 103 bytes, got ${Buffer.byteLength(socketPath)}: ${socketPath}`,
  );
});
