import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCustomVsCodeE2eWorkspace,
  resolveVsCodeE2eWorkspace,
} from './vscode-e2e/workspaceRoot.mjs';

test('VS Code E2E workspace defaults to the fixture vault', () => {
  assert.equal(
    resolveVsCodeE2eWorkspace({
      env: {},
      defaultWorkspace: '/repo/test-vault',
      cwd: '/repo',
    }),
    '/repo/test-vault',
  );
  assert.equal(isCustomVsCodeE2eWorkspace({ env: {} }), false);
});

test('VS Code E2E workspace accepts an explicit real vault', () => {
  const env = { LLM_WIKI_E2E_VAULT: '../demo-vault' };

  assert.equal(
    resolveVsCodeE2eWorkspace({
      env,
      defaultWorkspace: '/repo/test-vault',
      cwd: '/repo/packages/vscode-extension',
    }),
    '/repo/packages/demo-vault',
  );
  assert.equal(isCustomVsCodeE2eWorkspace({ env }), true);
});
