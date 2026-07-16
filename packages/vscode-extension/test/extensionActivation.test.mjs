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
    if (request === './webBrowserProvider') {
      return {
        WebBrowserProvider: class {
          open() {}
        },
      };
    }
    if (request === './navigationHistory') {
      return {
        NavigationHistoryProvider: class {
          record() {}
          refresh() {}
          clear() {}
          async back() {
            return false;
          }
          async retractTo() {
            return false;
          }
        },
      };
    }
    if (request === './codexAppServerClient') {
      return {
        CodexAppServerClient: class {
          dispose() {}
        },
      };
    }
    if (request === './pdfDiscussionController') {
      return {
        PdfDiscussionController: class {
          dispose() {}
        },
      };
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

test('activation reopens an already-open markdown vault note in the custom editor', async () => {
  const executeCommandCalls = [];
  const activeDocumentUri = { fsPath: '/vault/notes/Concepts/FlashAttention.md', scheme: 'file' };
  let outlineRegisterCount = 0;
  const vscode = createVscodeMock({ executeCommandCalls, activeDocumentUri });

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@human-learning/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      AgentContextProvider: class {
        refresh() {}
      },
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'human-learning.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'human-learning.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => {
        outlineRegisterCount += 1;
      },
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `hl://note/${value}` },
  });

  const context = {
    subscriptions: [],
  };

  activate(context);
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(
    executeCommandCalls.find(([command]) => command === 'vscode.openWith'),
    [
      'vscode.openWith',
      activeDocumentUri,
      'human-learning.markdownEditor',
    ],
  );
  assert.equal(outlineRegisterCount, 1);
});

test('activation registers selection export command without Agent Context or Problems tree views', async () => {
  const treeProviderIds = [];
  const calls = [];
  const pdfSelection = {
    uri: { fsPath: '/vault/raw/papers/attention.pdf' },
    text: 'FlashAttention uses tiling',
    startLine: 2,
    endLine: 2,
  };
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    treeProviderIds,
  });

  const mocks = createActivationMocks({ vscode });
  mocks['./agentContext'] = {
    addSelectionToContext: async (vaultRoot, options) => {
      calls.push({
        vaultRoot,
        selection: await options.getActiveSelectionContext(),
      });
      return true;
    },
  };
  mocks['./pdfEditorProvider'] = {
    PdfEditorProvider: class {
      static viewType = 'human-learning.pdfViewer';
      constructor() {}
      getActiveWebview() {
        return undefined;
      }
      async getActiveSelectionContext() {
        return pdfSelection;
      }
    },
  };

  const { activate } = loadTsModule('src/extension.ts', mocks);

  activate({ subscriptions: [] });
  await vscode.__registeredCommands['human-learning.addSelectionToContext']();

  assert.deepEqual(treeProviderIds.sort(), [
    'hl-backlinks',
    'hl-forward-links',
    'hl-jump-stack',
  ]);
  assert.deepEqual(calls, [{
    vaultRoot: '/vault',
    selection: pdfSelection,
  }]);
});

test('activation reopens an already-open PDF vault file in the custom viewer', async () => {
  const executeCommandCalls = [];
  const activeDocumentUri = { fsPath: '/vault/raw/pdf/ddia.pdf', scheme: 'file' };
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri,
    activeDocumentLanguageId: 'plaintext',
  });

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@human-learning/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      AgentContextProvider: class {
        refresh() {}
      },
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'human-learning.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'human-learning.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `hl://note/${value}` },
  });

  const context = {
    subscriptions: [],
  };

  activate(context);
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(
    executeCommandCalls.find(([command, uri]) =>
      command === 'vscode.openWith' && uri?.fsPath === activeDocumentUri.fsPath
    ),
    [
      'vscode.openWith',
      activeDocumentUri,
      'human-learning.pdfViewer',
    ],
  );
});

test('activation reopens a startup PDF when it becomes the active text editor after activation', async () => {
  const executeCommandCalls = [];
  const activeDocumentUri = { fsPath: '/vault/raw/pdf/ddia.pdf', scheme: 'file' };
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri: undefined,
  });

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@human-learning/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      AgentContextProvider: class {
        refresh() {}
      },
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'human-learning.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'human-learning.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `hl://note/${value}` },
  });

  const context = {
    subscriptions: [],
  };

  activate(context);
  vscode.__fireActiveEditorChange({
    document: {
      uri: activeDocumentUri,
      languageId: 'plaintext',
    },
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(
    executeCommandCalls.find(([command, uri]) =>
      command === 'vscode.openWith' && uri?.fsPath === activeDocumentUri.fsPath
    ),
    [
      'vscode.openWith',
      activeDocumentUri,
      'human-learning.pdfViewer',
    ],
  );
});

test('activation retries reopening a startup PDF while VS Code keeps it in the text editor', async () => {
  const executeCommandCalls = [];
  const activeDocumentUri = { fsPath: '/vault/raw/pdf/ddia.pdf', scheme: 'file' };
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri,
    activeDocumentLanguageId: 'plaintext',
  });

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@human-learning/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      AgentContextProvider: class {
        refresh() {}
      },
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'human-learning.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'human-learning.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `hl://note/${value}` },
  });

  const context = {
    subscriptions: [],
  };

  activate(context);
  await new Promise(resolve => setTimeout(resolve, 1300));

  const pdfReopenCalls = executeCommandCalls.filter(([command, uri, viewType]) =>
    command === 'vscode.openWith'
    && uri?.fsPath === activeDocumentUri.fsPath
    && viewType === 'human-learning.pdfViewer'
  );

  assert.ok(
    pdfReopenCalls.length >= 2,
    `expected at least two reopen attempts for the startup PDF, received ${pdfReopenCalls.length}`,
  );
});

test('activation reopens a startup PDF that is visible even when no active text editor is focused', async () => {
  const executeCommandCalls = [];
  const visiblePdfEditor = {
    document: {
      uri: { fsPath: '/vault/raw/pdf/ddia.pdf', scheme: 'file' },
      languageId: 'plaintext',
    },
  };
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri: undefined,
    visibleTextEditors: [visiblePdfEditor],
  });

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@human-learning/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      AgentContextProvider: class {
        refresh() {}
      },
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'human-learning.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'human-learning.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `hl://note/${value}` },
  });

  const context = {
    subscriptions: [],
  };

  activate(context);
  await new Promise(resolve => setTimeout(resolve, 50));

  assert.deepEqual(
    executeCommandCalls.find(([command, uri, viewType]) =>
      command === 'vscode.openWith'
      && uri?.fsPath === '/vault/raw/pdf/ddia.pdf'
      && viewType === 'human-learning.pdfViewer'
    ),
    [
      'vscode.openWith',
      { fsPath: '/vault/raw/pdf/ddia.pdf', scheme: 'file' },
      'human-learning.pdfViewer',
    ],
  );
});

test('activation reopens a startup PDF tab even when VS Code has not created a text editor for it yet', async () => {
  const executeCommandCalls = [];
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri: undefined,
    visibleTextEditors: [],
    activeTabUri: { fsPath: '/vault/raw/pdf/ddia.pdf', scheme: 'file' },
  });

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@human-learning/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      AgentContextProvider: class {
        refresh() {}
      },
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'human-learning.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'human-learning.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `hl://note/${value}` },
  });

  const context = {
    subscriptions: [],
  };

  activate(context);
  await new Promise(resolve => setTimeout(resolve, 50));

  assert.deepEqual(
    executeCommandCalls.find(([command, uri, viewType]) =>
      command === 'vscode.openWith'
      && uri?.fsPath === '/vault/raw/pdf/ddia.pdf'
      && viewType === 'human-learning.pdfViewer'
    ),
    [
      'vscode.openWith',
      { fsPath: '/vault/raw/pdf/ddia.pdf', scheme: 'file' },
      'human-learning.pdfViewer',
    ],
  );
});

test('activation registers a Vim mode toggle command for the markdown custom editor', async () => {
  const executeCommandCalls = [];
  let toggleCount = 0;
  const informationMessages = [];
  const activeDocumentUri = { fsPath: '/vault/notes/Concepts/FlashAttention.md', scheme: 'file' };
  const vscode = createVscodeMock({ executeCommandCalls, activeDocumentUri, informationMessages });

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@human-learning/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      AgentContextProvider: class {
        refresh() {}
      },
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'human-learning.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'human-learning.markdownEditor';
        constructor() {}
        async toggleVimMode() {
          toggleCount += 1;
          return true;
        }
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `hl://note/${value}` },
  });

  const context = {
    subscriptions: [],
  };

  activate(context);
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.ok(vscode.__registeredCommands['human-learning.toggleVimMode']);
  await vscode.__registeredCommands['human-learning.toggleVimMode']();

  assert.equal(toggleCount, 1);
  assert.deepEqual(informationMessages.at(-1), 'Human Learning Vim mode enabled');
});

test('activation registers PDF view mode toggle commands', async () => {
  const pdfMessages = [];
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
  });
  const mocks = createActivationMocks({ vscode });
  mocks['./pdfEditorProvider'] = {
    PdfEditorProvider: class {
      static viewType = 'human-learning.pdfViewer';
      constructor() {}
      getActiveWebview() {
        return {
          postMessage: message => {
            pdfMessages.push(message);
            return true;
          },
        };
      }
    },
  };

  const { activate } = loadTsModule('src/extension.ts', mocks);

  activate({ subscriptions: [] });
  await vscode.__registeredCommands['human-learning.pdfToggleContinuousScroll']();
  await vscode.__registeredCommands['human-learning.pdfToggleTwoPageView']();

  assert.deepEqual(pdfMessages, [
    { type: 'toggleContinuousScroll' },
    { type: 'toggleTwoPageView' },
  ]);
});

test('openPdfMarkdownColumns command opens the active PDF beside an available markdown note', async () => {
  const executeCommandCalls = [];
  const pdfUri = { fsPath: '/vault/raw/pdf/ddia.pdf', scheme: 'file' };
  const markdownUri = { fsPath: '/vault/notes/Concepts/FlashAttention.md', scheme: 'file' };
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri: undefined,
    visibleTextEditors: [{
      document: {
        uri: markdownUri,
        languageId: 'markdown',
      },
    }],
  });
  const mocks = createActivationMocks({ vscode });
  mocks['./pdfEditorProvider'] = {
    PdfEditorProvider: class {
      static viewType = 'human-learning.pdfViewer';
      constructor() {}
      getActiveWebview() {
        return { pdfUri };
      }
    },
  };

  const { activate } = loadTsModule('src/extension.ts', mocks);

  activate({ subscriptions: [] });
  await vscode.__registeredCommands['human-learning.openPdfMarkdownColumns']();

  assert.deepEqual(executeCommandCalls.filter(([command]) => command === 'vscode.openWith'), [
    [
      'vscode.openWith',
      pdfUri,
      'human-learning.pdfViewer',
      vscode.ViewColumn.One,
    ],
    [
      'vscode.openWith',
      markdownUri,
      'human-learning.markdownEditor',
      vscode.ViewColumn.Beside,
    ],
  ]);
});

test('activation routes markdown link targets through the Human Learning dispatcher', async () => {
  const executeCommandCalls = [];
  const openExternalCalls = [];
  const dispatched = [];
  const vscode = createVscodeMock({
    executeCommandCalls,
    openExternalCalls,
  });

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@human-learning/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      AgentContextProvider: class {
        refresh() {}
      },
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: (...args) => dispatched.push(args) },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'human-learning.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'human-learning.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `hl://note/${value}` },
  });

  activate({ subscriptions: [] });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.ok(vscode.__registeredCommands['human-learning.openLinkTarget']);
  await vscode.__registeredCommands['human-learning.openLinkTarget']('https://example.com/docs');

  assert.equal(openExternalCalls.length, 0);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0][0], '/vault');
  assert.equal(dispatched[0][1], 'https://example.com/docs');
  assert.equal(typeof dispatched[0][2].openWebTarget, 'function');
});

test('activation refreshes Human Learning side panes when the active custom editor tab changes', async () => {
  const executeCommandCalls = [];
  const providerInstances = [];
  const activeDocumentUri = { fsPath: '/vault/notes/Concepts/FlashAttention.md', scheme: 'file' };
  const vscode = createVscodeMock({ executeCommandCalls, activeDocumentUri });

  class TestTreeProvider {
    constructor(_vaultRoot, mode) {
      this.mode = mode;
      this.refreshCount = 0;
      providerInstances.push(this);
    }
    refresh() {
      this.refreshCount += 1;
    }
  }

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@human-learning/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': { BacklinksProvider: TestTreeProvider },
    './agentContext': {
      AgentContextProvider: TestTreeProvider,
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'human-learning.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'human-learning.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `hl://note/${value}` },
  });

  activate({ subscriptions: [] });
  await new Promise(resolve => setTimeout(resolve, 0));
  const refreshCountsAfterActivation = providerInstances.map(provider => provider.refreshCount);

  vscode.__fireTabChange({ changed: [], opened: [], closed: [] });

  assert.deepEqual(
    providerInstances.map(provider => provider.refreshCount),
    refreshCountsAfterActivation.map(count => count + 1),
  );
});

test('openInMarkdownEditor command opens the active custom markdown tab URI', async () => {
  const executeCommandCalls = [];
  const activeTabUri = { fsPath: '/vault/notes/Concepts/Online Softmax.md', scheme: 'file' };
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri: undefined,
    activeTabUri,
  });

  const { activate } = loadTsModule('src/extension.ts', createActivationMocks({ vscode }));

  activate({ subscriptions: [] });
  await vscode.__registeredCommands['human-learning.openInMarkdownEditor']();

  assert.deepEqual(
    executeCommandCalls.find(([command]) => command === 'vscode.openWith'),
    [
      'vscode.openWith',
      activeTabUri,
      'human-learning.markdownEditor',
    ],
  );
});

test('ingestCurrentFile command ingests the active custom markdown tab URI', async () => {
  const executeCommandCalls = [];
  const informationMessages = [];
  const activeTabUri = { fsPath: '/vault/notes/Concepts/Online Softmax.md', scheme: 'file' };
  const calls = { registeredPath: undefined, ingestedPath: undefined, closed: 0 };
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri: undefined,
    activeTabUri,
    informationMessages,
  });

  const { activate } = loadTsModule('src/extension.ts', createActivationMocks({
    vscode,
    core: {
      registerSource: (_db, _root, relPath) => {
        calls.registeredPath = relPath;
        return { id: 42 };
      },
      ingestFile: async (_db, _root, relPath, sourceId) => {
        calls.ingestedPath = `${relPath}:${sourceId}`;
      },
      closeDatabase: () => {
        calls.closed += 1;
      },
    },
  }));

  activate({ subscriptions: [] });
  await vscode.__registeredCommands['human-learning.ingestCurrentFile']();

  assert.equal(calls.registeredPath, 'notes/Concepts/Online Softmax.md');
  assert.equal(calls.ingestedPath, 'notes/Concepts/Online Softmax.md:42');
  assert.equal(calls.closed, 1);
  assert.ok(informationMessages.includes('Ingested: notes/Concepts/Online Softmax.md'));
});

test('showBacklinks command reads backlinks for the active custom markdown tab URI', async () => {
  const executeCommandCalls = [];
  const quickPickCalls = [];
  const activeTabUri = { fsPath: '/vault/notes/Concepts/Online Softmax.md', scheme: 'file' };
  const calls = { backlinksUri: undefined };
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri: undefined,
    activeTabUri,
    quickPickCalls,
  });

  const { activate } = loadTsModule('src/extension.ts', createActivationMocks({
    vscode,
    core: {
      getBacklinks: (_db, uri) => {
        calls.backlinksUri = uri;
        return [{
          from_note_path: 'notes/Concepts/FlashAttention.md',
          from_line: 18,
          label: 'Online Softmax',
        }];
      },
    },
  }));

  activate({ subscriptions: [] });
  await vscode.__registeredCommands['human-learning.showBacklinks']();

  assert.equal(calls.backlinksUri, 'hl://note/notes/Concepts/Online%20Softmax.md');
  assert.deepEqual(quickPickCalls, [
    [
      [{ label: 'notes/Concepts/FlashAttention.md:18', description: 'Online Softmax' }],
      { title: 'Backlinks to notes/Concepts/Online Softmax.md' },
    ],
  ]);
});

test('combined activation registers the standalone PDF Ask workflow without a vault', async () => {
  const customEditorRegistrations = [];
  const providerOptions = [];
  let askSelectionCount = 0;
  let vaultWorkCount = 0;
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
  });
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: '/documents' } }];
  vscode.window.registerCustomEditorProvider = (viewType, provider, options) => {
    customEditorRegistrations.push({ viewType, provider, options });
    return { dispose() {} };
  };

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@human-learning/core': {
      detectVaultRoot: () => undefined,
      openDatabase: async () => {
        vaultWorkCount += 1;
        throw new Error('vault database must not open outside a vault');
      },
    },
    './linkProvider': {
      registerLinkProvider: () => {
        vaultWorkCount += 1;
      },
    },
    './backlinksProvider': {
      BacklinksProvider: class {
        constructor() {
          vaultWorkCount += 1;
        }
      },
    },
    './agentContext': { addSelectionToContext: async () => undefined },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'human-learning.pdfViewer';
        constructor(_context, options) {
          providerOptions.push(options);
        }
        async openAskPdfForSelection() {
          askSelectionCount += 1;
        }
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        constructor() {
          vaultWorkCount += 1;
        }
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => {
        vaultWorkCount += 1;
      },
      registerMarkdownOutlineTreeProvider: () => {
        vaultWorkCount += 1;
      },
    },
    './webBrowserProvider': {
      WebBrowserProvider: class {
        constructor() {
          vaultWorkCount += 1;
        }
      },
    },
    './navigationHistory': {
      NavigationHistoryProvider: class {
        constructor() {
          vaultWorkCount += 1;
        }
      },
    },
    './codexAppServerClient': {
      CodexAppServerClient: class {
        dispose() {}
      },
    },
    './pdfDiscussionController': {
      PdfDiscussionController: class {
        dispose() {}
      },
    },
    './wikiLinks': { notePathToUri: value => value },
  });

  activate({
    subscriptions: [],
    extension: { packageJSON: { version: '0.1.0-test' } },
    extensionUri: { fsPath: '/extension' },
    globalStorageUri: { fsPath: '/global-storage' },
  });

  assert.equal(customEditorRegistrations.length, 1);
  assert.equal(customEditorRegistrations[0].viewType, 'human-learning.pdfViewer');
  assert.equal(providerOptions.length, 1);
  assert.equal(providerOptions[0].vaultRoot, undefined);
  assert.equal(providerOptions[0].documentRoot, '/documents');
  assert.equal(providerOptions[0].globalStoragePath, '/global-storage');
  assert.equal(providerOptions[0].annotationsEnabled, false);
  assert.equal(typeof vscode.__registeredCommands['human-learning.pdfAskSelection'], 'function');
  await vscode.__registeredCommands['human-learning.pdfAskSelection']();
  assert.equal(askSelectionCount, 1);
  assert.equal(vaultWorkCount, 0);
});

test('combined extension activation owns a dedicated Codex output channel and passes its logger', () => {
  const outputChannels = [];
  const clientOptions = [];
  let clientDisposeCount = 0;
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    outputChannels,
  });
  const mocks = createActivationMocks({ vscode });
  mocks['./codexAppServerClient'] = {
    CodexAppServerClient: class {
      constructor(options) {
        clientOptions.push(options);
      }
      dispose() {
        clientDisposeCount += 1;
      }
    },
  };

  const { activate, deactivate } = loadTsModule('src/extension.ts', mocks);
  activate({ subscriptions: [], extension: { packageJSON: { version: '7.6.5-test' } } });

  assert.equal(outputChannels.length, 1);
  assert.equal(outputChannels[0].name, 'Human Learning PDF — Codex');
  assert.equal(clientOptions.length, 1);
  assert.equal(clientOptions[0].extensionVersion, '7.6.5-test');
  assert.equal(typeof clientOptions[0].logger, 'function');
  clientOptions[0].logger('safe diagnostic');
  assert.deepEqual(outputChannels[0].lines, ['safe diagnostic']);

  deactivate();
  assert.equal(clientDisposeCount, 1);
  assert.equal(outputChannels[0].disposeCount, 1);
});

function createActivationMocks({ vscode, core = {} }) {
  return {
    vscode,
    '@human-learning/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
      ...core,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      AgentContextProvider: class {
        refresh() {}
      },
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'human-learning.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'human-learning.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `hl://note/${value.split('/').map(encodeURIComponent).join('/')}` },
  };
}

function createVscodeMock({
  executeCommandCalls,
  activeDocumentUri,
  activeDocumentLanguageId = 'markdown',
  visibleTextEditors,
  activeTabUri,
  informationMessages = [],
  openExternalCalls = [],
  quickPickCalls = [],
  treeProviderIds = [],
  outputChannels = [],
}) {
  const watcher = {
    onDidChange: () => undefined,
    onDidCreate: () => undefined,
    dispose: () => undefined,
  };
  const registeredCommands = {};
  const activeEditorChangeHandlers = [];
  const tabChangeHandlers = [];

  return {
    __registeredCommands: registeredCommands,
    __fireActiveEditorChange: editor => {
      for (const handler of activeEditorChangeHandlers) handler(editor);
    },
    __fireTabChange: event => {
      for (const handler of tabChangeHandlers) handler(event);
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: '/vault' } }],
      asRelativePath: uri => uri?.fsPath?.replace('/vault/', '') ?? 'notes/Concepts/FlashAttention.md',
      createFileSystemWatcher: () => watcher,
    },
    window: {
      activeTextEditor: activeDocumentUri ? {
        document: {
          uri: activeDocumentUri,
          languageId: activeDocumentLanguageId,
        },
      } : undefined,
      visibleTextEditors: visibleTextEditors ?? [],
      tabGroups: {
        onDidChangeTabs: callback => {
          tabChangeHandlers.push(callback);
          return { dispose() {} };
        },
        activeTabGroup: {
          activeTab: activeTabUri ? {
            input: { uri: activeTabUri },
          } : undefined,
        },
      },
      onDidChangeActiveTextEditor: callback => {
        activeEditorChangeHandlers.push(callback);
        return { dispose() {} };
      },
      createOutputChannel: name => {
        const channel = {
          name,
          lines: [],
          disposeCount: 0,
          appendLine(message) {
            this.lines.push(message);
          },
          dispose() {
            this.disposeCount += 1;
          },
        };
        outputChannels.push(channel);
        return channel;
      },
      registerCustomEditorProvider: () => ({ dispose() {} }),
      registerTreeDataProvider: id => {
        treeProviderIds.push(id);
        return { dispose() {} };
      },
      showInformationMessage: message => {
        informationMessages.push(message);
        return undefined;
      },
      showQuickPick: async (...args) => {
        quickPickCalls.push(args);
        return undefined;
      },
    },
    commands: {
      executeCommand: async (...args) => {
        executeCommandCalls.push(args);
        return undefined;
      },
      registerCommand: (command, callback) => {
        registeredCommands[command] = callback;
        return { dispose() {} };
      },
    },
    env: {
      openExternal: async (...args) => {
        openExternalCalls.push(args);
        return true;
      },
    },
    ViewColumn: {
      One: 1,
      Beside: -2,
    },
    Uri: {
      parse: value => ({ toString: () => value }),
    },
  };
}
