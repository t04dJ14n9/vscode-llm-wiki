import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const markdownRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'vscode-markdown-extension');

function loadMarkdownTsModule(relativePath, mocks = {}) {
  const filename = join(markdownRoot, relativePath);
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

test('standalone markdown activation registers the editor outside a Human Learning vault', () => {
  const calls = {
    customEditors: [],
    treeProviders: [],
    commands: [],
    informationMessages: [],
    watcherPatterns: [],
    linkProviderRegistrations: 0,
    outlineProviderRegistrations: 0,
    outlineTreeRegistrations: 0,
    agentContextProviders: 0,
  };
  const vscode = createVscodeMock({ calls });

  const { activate } = loadMarkdownTsModule('src/extension.ts', {
    vscode,
    '@human-learning/core': {
      detectVaultRoot: () => undefined,
      openDatabase: async () => {
        throw new Error('database should not open outside a vault');
      },
    },
    './linkProvider': {
      registerLinkProvider: () => {
        calls.linkProviderRegistrations += 1;
      },
    },
    './backlinksProvider': {
      BacklinksProvider: class {
        constructor(vaultRoot, mode) {
          this.vaultRoot = vaultRoot;
          this.mode = mode;
        }
        refresh() {}
      },
    },
    './agentContext': {
      AgentContextProvider: class {
        constructor() {
          calls.agentContextProviders += 1;
        }
        refresh() {}
      },
      addSelectionToContext: async () => false,
    },
    './uriDispatcher': {
      dispatchUri: async () => undefined,
      dispatchStandaloneUri: async () => undefined,
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'human-learning.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => {
        calls.outlineProviderRegistrations += 1;
      },
      registerMarkdownOutlineTreeProvider: () => {
        calls.outlineTreeRegistrations += 1;
        return { refresh() {} };
      },
    },
    './wikiLinks': { notePathToUri: value => value },
  });

  activate({ subscriptions: [] });

  assert.deepEqual(calls.customEditors, ['human-learning.markdownEditor']);
  assert.deepEqual(calls.treeProviders, ['hl-backlinks', 'hl-forward-links']);
  assert.deepEqual(
    calls.commands.filter(command => [
      'human-learning.openAnchor',
      'human-learning.openInMarkdownEditor',
      'human-learning.toggleVimMode',
      'human-learning.consumeVimHostShortcut',
    ].includes(command)).sort(),
    [
      'human-learning.consumeVimHostShortcut',
      'human-learning.openAnchor',
      'human-learning.openInMarkdownEditor',
      'human-learning.toggleVimMode',
    ],
  );
  assert.equal(calls.linkProviderRegistrations, 1);
  assert.equal(calls.outlineProviderRegistrations, 1);
  assert.equal(calls.outlineTreeRegistrations, 1);
  assert.equal(calls.agentContextProviders, 0);
  assert.deepEqual(calls.watcherPatterns, []);
  assert.ok(
    calls.informationMessages.some(message => message.includes('standalone markdown editor')),
    'activation should report standalone mode instead of refusing to activate',
  );
});

test('standalone markdown activation exposes selection export while omitting Agent Context and Problems tree views in a vault', () => {
  const calls = {
    customEditors: [],
    treeProviders: [],
    commands: [],
    informationMessages: [],
    watcherPatterns: [],
    linkProviderRegistrations: 0,
    outlineProviderRegistrations: 0,
    outlineTreeRegistrations: 0,
    agentContextProviders: 0,
  };
  const vscode = createVscodeMock({ calls });

  const { activate } = loadMarkdownTsModule('src/extension.ts', {
    vscode,
    '@human-learning/core': {
      detectVaultRoot: () => '/workspace',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      rebuildAllLinks: () => undefined,
      rebuildLinksForNote: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': {
      registerLinkProvider: () => {
        calls.linkProviderRegistrations += 1;
      },
    },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      AgentContextProvider: class {
        constructor() {
          calls.agentContextProviders += 1;
        }
        refresh() {}
      },
      addSelectionToContext: async () => false,
    },
    './uriDispatcher': {
      dispatchUri: async () => undefined,
      dispatchStandaloneUri: async () => undefined,
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'human-learning.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => {
        calls.outlineProviderRegistrations += 1;
      },
      registerMarkdownOutlineTreeProvider: () => {
        calls.outlineTreeRegistrations += 1;
        return { refresh() {} };
      },
    },
    './wikiLinks': { notePathToUri: value => value },
  });

  activate({ subscriptions: [] });

  assert.deepEqual(calls.treeProviders, ['hl-backlinks', 'hl-forward-links']);
  assert.equal(calls.commands.includes('human-learning.addSelectionToContext'), true);
  assert.equal(calls.agentContextProviders, 0);
});

test('standalone backlinks provider scans workspace markdown without opening the Human Learning database', async () => {
  const targetUri = createUri('/workspace/notes/Target.md');
  const docs = new Map([
    ['/workspace/notes/Target.md', [
      'Links out to [[Source]] and [Other](./Other.md#Details).',
      'External [site](https://example.com).',
    ].join('\n')],
    ['/workspace/notes/Source.md', 'Links back to [[Target]] and [target md](./Target.md#top).'],
    ['/workspace/notes/Other.md', 'No incoming link here.'],
  ]);
  const vscode = createVscodeMock({
    activeTabUri: targetUri,
    workspaceRoot: '/workspace',
    workspaceDocs: docs,
  });
  const { BacklinksProvider } = loadMarkdownTsModule('src/backlinksProvider.ts', {
    vscode,
    '@human-learning/core': {
      openDatabase: async () => {
        throw new Error('database should not open in standalone mode');
      },
    },
    './wikiLinks': loadMarkdownTsModule('src/wikiLinks.ts'),
  });

  const backlinks = await new BacklinksProvider(undefined, 'backlinks').getChildren();
  const forward = await new BacklinksProvider(undefined, 'forward').getChildren();

  assert.deepEqual(
    backlinks.map(item => [item.label, item.description, item.tooltip]),
    [
      ['notes/Source.md:1', 'Target', 'notes/Target.md'],
      ['notes/Source.md:1', 'target md', 'notes/Target.md#top'],
    ],
  );
  assert.deepEqual(
    forward.map(item => [item.label, item.description, item.tooltip]),
    [
      ['Source', 'line 1', 'notes/Source.md'],
      ['Other', 'line 1', 'notes/Other.md#Details'],
      ['site', 'line 2', 'https://example.com'],
    ],
  );
});

test('standalone URI dispatcher opens workspace markdown and external links without a vault', async () => {
  const calls = {
    executeCommandCalls: [],
    openExternalCalls: [],
  };
  const activeTabUri = createUri('/workspace/notes/Target.md');
  const docs = new Map([
    ['/workspace/notes/Source.md', '# Heading\n\nBody'],
  ]);
  const vscode = createVscodeMock({
    calls,
    activeTabUri,
    workspaceRoot: '/workspace',
    workspaceDocs: docs,
  });
  const { dispatchStandaloneUri } = loadMarkdownTsModule('src/uriDispatcher.ts', {
    vscode,
    child_process: { execFile: () => undefined },
    fs: { existsSync: filePath => filePath === '/workspace/notes/Source.md' },
    '@human-learning/core': {
      classifyReferenceTarget: () => ({ kind: 'unknown' }),
      openDatabase: async () => {
        throw new Error('database should not open in standalone mode');
      },
      closeDatabase: () => undefined,
      resolveWebTarget: () => undefined,
      runMigrations: () => undefined,
    },
  });

  await dispatchStandaloneUri('notes/Source.md#Heading');
  await dispatchStandaloneUri('https://example.com');

  assert.deepEqual(calls.executeCommandCalls.map(call => [
    call[0],
    call[1]?.fsPath ?? call[1]?.uri?.fsPath,
    call[2] ?? call[1]?.selection,
  ]), [
    ['vscode.openWith', '/workspace/notes/Source.md', 'human-learning.markdownEditor'],
    ['human-learning.revealInMarkdownEditor', '/workspace/notes/Source.md', { from: 0, to: 0 }],
  ]);
  assert.deepEqual(calls.openExternalCalls.map(uri => uri.toString()), ['https://example.com']);
});

test('standalone URI dispatcher creates missing markdown targets before opening them', async () => {
  const calls = {
    executeCommandCalls: [],
    openExternalCalls: [],
    createdDirectories: [],
    writtenFiles: [],
  };
  const activeTabUri = createUri('/workspace/notes/Concepts/Obsidian Smoke.md');
  const vscode = createVscodeMock({
    calls,
    activeTabUri,
    workspaceRoot: '/workspace',
    workspaceDocs: new Map(),
  });
  const { dispatchStandaloneUri } = loadMarkdownTsModule('src/uriDispatcher.ts', {
    vscode,
    child_process: { execFile: () => undefined },
    fs: {
      existsSync: () => false,
      mkdirSync: (...args) => calls.createdDirectories.push(args),
      writeFileSync: (...args) => calls.writtenFiles.push(args),
    },
    '@human-learning/core': {
      classifyReferenceTarget: () => ({ kind: 'unknown' }),
      openDatabase: async () => {
        throw new Error('database should not open in standalone mode');
      },
      closeDatabase: () => undefined,
      resolveWebTarget: () => undefined,
      runMigrations: () => undefined,
    },
  });

  await dispatchStandaloneUri('notes/Concepts/Linked Concept.md');

  assert.deepEqual(calls.createdDirectories, [
    ['/workspace/notes/Concepts', { recursive: true }],
  ]);
  assert.deepEqual(calls.writtenFiles, [
    ['/workspace/notes/Concepts/Linked Concept.md', '', { flag: 'wx' }],
  ]);
  assert.deepEqual(calls.executeCommandCalls.map(call => [
    call[0],
    call[1]?.fsPath,
    call[2],
  ]), [
    ['vscode.openWith', '/workspace/notes/Concepts/Linked Concept.md', 'human-learning.markdownEditor'],
  ]);
});

function createVscodeMock({
  calls,
  activeTabUri,
  workspaceRoot = '/workspace',
  workspaceDocs = new Map(),
} = {}) {
  const workspaceFolder = { uri: createUri(workspaceRoot) };
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
    Range: class Range {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    Uri: {
      file: createUri,
      parse: value => ({ scheme: value.split(':')[0], fsPath: value, toString: () => value }),
    },
    workspace: {
      workspaceFolders: [workspaceFolder],
      getWorkspaceFolder() {
        return workspaceFolder;
      },
      asRelativePath(uri) {
        return uri.fsPath.startsWith(`${workspaceRoot}/`)
          ? uri.fsPath.slice(workspaceRoot.length + 1)
          : uri.fsPath;
      },
      createFileSystemWatcher(pattern) {
        calls?.watcherPatterns.push(pattern);
        return {
          onDidChange() {},
          onDidCreate() {},
          dispose() {},
        };
      },
      findFiles: async () => [...workspaceDocs.keys()].map(createUri),
      openTextDocument: async (uri) => createDocument(uri, workspaceDocs.get(uri.fsPath) ?? ''),
    },
    window: {
      activeTextEditor: undefined,
      registerCustomEditorProvider(viewType) {
        calls?.customEditors.push(viewType);
        return { dispose() {} };
      },
      registerTreeDataProvider(id) {
        calls?.treeProviders.push(id);
      },
      showInformationMessage(message) {
        calls?.informationMessages.push(message);
      },
      onDidChangeActiveTextEditor() {
        return { dispose() {} };
      },
      tabGroups: {
        activeTabGroup: {
          activeTab: activeTabUri ? { input: { uri: activeTabUri } } : undefined,
        },
        onDidChangeTabs() {
          return { dispose() {} };
        },
      },
    },
    commands: {
      registerCommand(command) {
        calls?.commands.push(command);
        return { dispose() {} };
      },
      executeCommand: async (...args) => {
        calls?.executeCommandCalls?.push(args);
        return undefined;
      },
    },
    env: {
      openExternal: async (...args) => {
        calls?.openExternalCalls?.push(...args);
        return true;
      },
    },
  };
}

function createUri(fsPath) {
  return {
    scheme: 'file',
    fsPath,
    path: fsPath,
    toString: () => `file://${fsPath}`,
  };
}

function createDocument(uri, text) {
  return {
    uri,
    getText: () => text,
    positionAt(offset) {
      const prefix = text.slice(0, offset);
      const lines = prefix.split('\n');
      return {
        line: lines.length - 1,
        character: lines.at(-1).length,
      };
    },
  };
}
