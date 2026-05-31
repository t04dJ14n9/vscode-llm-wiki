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

test('backlinks provider reads the active custom markdown tab when no text editor is active', async () => {
  const activeTabUri = {
    scheme: 'file',
    fsPath: '/vault/notes/Concepts/Online Softmax.md',
    toString: () => 'file:///vault/notes/Concepts/Online%20Softmax.md',
  };
  const calls = { backlinksToUri: undefined, migrations: 0, closed: 0 };
  const vscode = createVscodeMock({ activeTabUri });
  const { BacklinksProvider } = loadTsModule('src/backlinksProvider.ts', {
    vscode,
    '@human-learning/core': createCoreMock({
      calls,
      backlinks: [{
        from_note_path: 'notes/Concepts/FlashAttention.md',
        from_line: 18,
        to_uri: 'hl://note/notes/Concepts/Online%20Softmax.md',
        label: 'Online Softmax',
      }],
    }),
    './wikiLinks': { notePathToUri },
  });
  const provider = new BacklinksProvider('/vault', 'backlinks');

  const children = await provider.getChildren();

  assert.equal(calls.backlinksToUri, 'hl://note/notes/Concepts/Online%20Softmax.md');
  assert.equal(calls.migrations, 1);
  assert.equal(calls.closed, 1);
  assert.equal(children.length, 1);
  assert.equal(children[0].label, 'notes/Concepts/FlashAttention.md:18');
  assert.equal(children[0].description, 'Online Softmax');
});

test('forward links provider reads the active custom markdown tab when no text editor is active', async () => {
  const activeTabUri = {
    scheme: 'file',
    fsPath: '/vault/notes/Concepts/FlashAttention.md',
    toString: () => 'file:///vault/notes/Concepts/FlashAttention.md',
  };
  const calls = { forwardFromPath: undefined };
  const vscode = createVscodeMock({ activeTabUri });
  const { BacklinksProvider } = loadTsModule('src/backlinksProvider.ts', {
    vscode,
    '@human-learning/core': createCoreMock({
      calls,
      forward: [{
        from_line: 18,
        to_uri: 'hl://note/notes/Concepts/Online%20Softmax.md',
        label: 'Online Softmax',
      }],
    }),
    './wikiLinks': { notePathToUri },
  });
  const provider = new BacklinksProvider('/vault', 'forward');

  const children = await provider.getChildren();

  assert.equal(calls.forwardFromPath, 'notes/Concepts/FlashAttention.md');
  assert.equal(children.length, 1);
  assert.equal(children[0].label, 'Online Softmax');
  assert.equal(children[0].description, 'line 18');
  assert.equal(children[0].tooltip, 'hl://note/notes/Concepts/Online%20Softmax.md');
});

test('forward links provider falls back to decoded target note title without exposing raw hl URI', () => {
  const { formatForwardLinkLabel } = loadTsModule('src/backlinksProvider.ts', {
    vscode: createVscodeMock(),
    '@human-learning/core': createCoreMock({ calls: {} }),
    './wikiLinks': { notePathToUri },
  });

  assert.equal(
    formatForwardLinkLabel({
      from_line: 12,
      to_uri: 'hl://note/notes/Papers/FlashAttention%20Paper.md#Algorithm',
      label: '',
    }),
    'FlashAttention Paper',
  );
});

test('problems provider reports global link diagnostics even without an active editor', async () => {
  const calls = { checked: 0 };
  const vscode = createVscodeMock();
  const { BacklinksProvider } = loadTsModule('src/backlinksProvider.ts', {
    vscode,
    '@human-learning/core': createCoreMock({
      calls,
      issues: [{
        link_id: 'lnk_missing',
        status: 'broken',
        message: 'Target note not found: notes/Concepts/Missing.md',
      }],
    }),
    './wikiLinks': { notePathToUri },
  });
  const provider = new BacklinksProvider('/vault', 'problems');

  const children = await provider.getChildren();

  assert.equal(calls.checked, 1);
  assert.equal(children.length, 1);
  assert.equal(children[0].label, 'Target note not found: notes/Concepts/Missing.md');
  assert.equal(children[0].iconPath.id, 'error');
});

function createCoreMock({ calls, backlinks = [], forward = [], issues = [] }) {
  return {
    openDatabase: async () => ({}),
    closeDatabase: () => {
      calls.closed = (calls.closed ?? 0) + 1;
    },
    runMigrations: () => {
      calls.migrations = (calls.migrations ?? 0) + 1;
    },
    getBacklinks: (_db, uri) => {
      calls.backlinksToUri = uri;
      return backlinks;
    },
    getForwardLinks: (_db, path) => {
      calls.forwardFromPath = path;
      return forward;
    },
    checkLinks: () => {
      calls.checked = (calls.checked ?? 0) + 1;
      return issues;
    },
  };
}

function notePathToUri(notePath) {
  return `hl://note/${notePath.split('/').map(encodeURIComponent).join('/')}`;
}

function createVscodeMock({ activeTabUri } = {}) {
  return {
    EventEmitter: class EventEmitter {
      constructor() {
        this.event = () => ({ dispose() {} });
      }
      fire() {}
    },
    ThemeIcon: class ThemeIcon {
      constructor(id) {
        this.id = id;
      }
    },
    TreeItem: class TreeItem {
      constructor(label, collapsibleState) {
        this.label = label;
        this.collapsibleState = collapsibleState;
      }
    },
    TreeItemCollapsibleState: {
      None: 0,
    },
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
    },
    window: {
      activeTextEditor: undefined,
      tabGroups: {
        activeTabGroup: {
          activeTab: activeTabUri ? { input: { uri: activeTabUri } } : undefined,
        },
      },
    },
  };
}
