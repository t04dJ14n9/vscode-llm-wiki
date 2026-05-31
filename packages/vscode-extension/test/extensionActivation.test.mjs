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
  assert.deepEqual(dispatched, [['/vault', 'https://example.com/docs']]);
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

test('addSelectionToContext command passes the active custom markdown selection provider', async () => {
  const executeCommandCalls = [];
  const selectionContext = {
    uri: { fsPath: '/vault/notes/Concepts/Online Softmax.md', scheme: 'file' },
    text: '## Standard Softmax',
    startLine: 12,
    endLine: 12,
  };
  const addSelectionCalls = [];
  let agentProviderInstance;
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri: undefined,
  });
  const mocks = createActivationMocks({ vscode });
  mocks['./agentContext'] = {
    AgentContextProvider: class {
      constructor() {
        this.refreshCount = 0;
        agentProviderInstance = this;
      }
      refresh() {
        this.refreshCount += 1;
      }
    },
    addSelectionToContext: async (...args) => {
      addSelectionCalls.push(args);
      return true;
    },
  };
  mocks['./markdownEditorProvider'] = {
    MarkdownEditorProvider: class {
      static viewType = 'human-learning.markdownEditor';
      constructor() {}
      getActiveSelectionContext() {
        return selectionContext;
      }
    },
  };

  const { activate } = loadTsModule('src/extension.ts', mocks);

  activate({ subscriptions: [] });
  await vscode.__registeredCommands['human-learning.addSelectionToContext']();

  assert.equal(addSelectionCalls.length, 1);
  assert.equal(addSelectionCalls[0][0], '/vault');
  assert.equal(addSelectionCalls[0][1].getActiveSelectionContext(), selectionContext);
  assert.equal(agentProviderInstance.refreshCount, 2);
});

test('addSelectionToContext command does not refresh Agent Context when export fails', async () => {
  let agentProviderInstance;
  const vscode = createVscodeMock({
    activeDocumentUri: undefined,
  });
  const mocks = createActivationMocks({ vscode });
  mocks['./agentContext'] = {
    AgentContextProvider: class {
      constructor() {
        this.refreshCount = 0;
        agentProviderInstance = this;
      }
      refresh() {
        this.refreshCount += 1;
      }
    },
    addSelectionToContext: async () => false,
  };
  mocks['./markdownEditorProvider'] = {
    MarkdownEditorProvider: class {
      static viewType = 'human-learning.markdownEditor';
      constructor() {}
      getActiveSelectionContext() {
        return undefined;
      }
    },
  };

  const { activate } = loadTsModule('src/extension.ts', mocks);

  activate({ subscriptions: [] });
  assert.equal(agentProviderInstance.refreshCount, 1);

  await vscode.__registeredCommands['human-learning.addSelectionToContext']();

  assert.equal(agentProviderInstance.refreshCount, 1);
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
      registerCustomEditorProvider: () => ({ dispose() {} }),
      registerTreeDataProvider: () => ({ dispose() {} }),
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
