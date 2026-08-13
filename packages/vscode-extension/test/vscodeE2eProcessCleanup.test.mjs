import test from 'node:test';
import assert from 'node:assert/strict';

import { selectStaleE2eProcesses } from './vscode-e2e/processCleanup.mjs';

test('E2E cleanup ignores manual extension development windows that share the debug port', () => {
  const userDataDir = '/repo/packages/vscode-extension/test/vscode-e2e/.vscode-test/user-data';
  const processes = [
    {
      pid: 101,
      command:
        '/Applications/Visual Studio Code.app/Contents/MacOS/Electron ' +
        '--extensionDevelopmentPath=/Users/t04dj14n9/Code/llm-wiki/packages/vscode-extension ' +
        '--remote-debugging-port=9229 /Users/t04dj14n9/Code/human-learning',
    },
    {
      pid: 102,
      command:
        '/private/var/folders/vscode-test/Visual Studio Code.app/Contents/MacOS/Electron ' +
        `--user-data-dir=${userDataDir} --remote-debugging-port=9229`,
    },
  ];

  assert.deepEqual(
    selectStaleE2eProcesses(processes, { userDataDir, currentPid: 999 }).map(({ pid }) => pid),
    [102],
  );
});

test('E2E cleanup never selects the current Node process', () => {
  const userDataDir = '/repo/packages/vscode-extension/test/vscode-e2e/.vscode-test/user-data';
  const processes = [
    {
      pid: 123,
      command:
        '/private/var/folders/vscode-test/Visual Studio Code.app/Contents/MacOS/Electron ' +
        `--user-data-dir=${userDataDir} --remote-debugging-port=9229`,
    },
  ];

  assert.deepEqual(
    selectStaleE2eProcesses(processes, { userDataDir, currentPid: 123 }).map(({ pid }) => pid),
    [],
  );
});
