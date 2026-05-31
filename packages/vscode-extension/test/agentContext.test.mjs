import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    mod._compile(outputText, filename);
    return mod.exports;
  } finally {
    Module._load = originalLoad;
  }
}

test('addSelectionToContext exports a custom markdown editor selection when no native editor is active', async () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'hl-agent-context-'));
  const errors = [];
  const informationMessages = [];
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace(`${vaultRoot}/`, ''),
    },
    window: {
      activeTextEditor: undefined,
      showErrorMessage: message => errors.push(message),
      showInformationMessage: message => informationMessages.push(message),
    },
  };
  const { addSelectionToContext } = loadTsModule('src/agentContext.ts', {
    vscode,
    '@human-learning/core': {
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      runMigrations: () => undefined,
    },
    './wikiLinks': {
      notePathToUri: value => `hl://note/${value.split('/').map(encodeURIComponent).join('/')}`,
    },
  });

  try {
    const exported = await addSelectionToContext(vaultRoot, {
      getActiveSelectionContext: () => ({
        uri: { fsPath: `${vaultRoot}/notes/Concepts/Online Softmax.md` },
        text: '## Standard Softmax\n\n$softmax(x_i)$',
        startLine: 5,
        endLine: 7,
      }),
    });

    const markdown = readFileSync(join(vaultRoot, '.hl', 'agent', 'selection.md'), 'utf8');
    const json = JSON.parse(readFileSync(join(vaultRoot, '.hl', 'agent', 'selection.json'), 'utf8'));

    assert.equal(errors.length, 0);
    assert.equal(exported, true);
    assert.match(markdown, /\*\*Source\*\*: notes\/Concepts\/Online Softmax\.md \(lines 5–7\)/);
    assert.match(markdown, /## Standard Softmax\n\n\$softmax\(x_i\)\$/);
    assert.equal(json.source, 'notes/Concepts/Online Softmax.md');
    assert.equal(json.anchor_uri, 'hl://note/notes/Concepts/Online%20Softmax.md#L5-L7');
    assert.deepEqual(json.lines, { start: 5, end: 7 });
    assert.equal(json.text, '## Standard Softmax\n\n$softmax(x_i)$');
    assert.deepEqual(informationMessages, [
      'Selection exported to .hl/agent/selection.md + .hl/agent/selection.json',
    ]);
  } finally {
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});

test('addSelectionToContext returns false and skips files when no exportable selection exists', async () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'hl-agent-context-empty-'));
  const errors = [];
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace(`${vaultRoot}/`, ''),
    },
    window: {
      activeTextEditor: undefined,
      showErrorMessage: message => errors.push(message),
      showInformationMessage: () => undefined,
    },
  };
  const { addSelectionToContext } = loadTsModule('src/agentContext.ts', {
    vscode,
    '@human-learning/core': {
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      runMigrations: () => undefined,
    },
    './wikiLinks': {
      notePathToUri: value => `hl://note/${value}`,
    },
  });

  try {
    const exported = await addSelectionToContext(vaultRoot, {
      getActiveSelectionContext: () => ({
        uri: { fsPath: `${vaultRoot}/notes/empty.md` },
        text: '   \n',
        startLine: 1,
        endLine: 1,
      }),
    });

    assert.equal(exported, false);
    assert.deepEqual(errors, ['No text selected']);
    assert.throws(() => readFileSync(join(vaultRoot, '.hl', 'agent', 'selection.md'), 'utf8'), {
      code: 'ENOENT',
    });
  } finally {
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});
