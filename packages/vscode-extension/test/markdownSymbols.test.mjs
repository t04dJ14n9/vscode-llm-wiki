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
    if (request === './markdownHeadingSyntax') {
      return loadTsModule('src/markdownHeadingSyntax.ts', mocks);
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

test('markdown outline provider returns nested headings and ignores fenced code headings', () => {
  const vscode = createVscodeMock();
  const { MarkdownOutlineProvider } = loadTsModule('src/markdownSymbols.ts', { vscode });
  const provider = new MarkdownOutlineProvider();
  const document = {
    getText: () => [
      '# Online Softmax',
      '',
      '## Standard Softmax',
      'Body',
      '```python',
      '# not an outline heading',
      '```',
      '### Numerical Stability',
      '',
      '## Online Version',
    ].join('\n'),
    lineAt: (line) => ({
      text: [
        '# Online Softmax',
        '',
        '## Standard Softmax',
        'Body',
        '```python',
        '# not an outline heading',
        '```',
        '### Numerical Stability',
        '',
        '## Online Version',
      ][line],
    }),
    lineCount: 10,
  };

  const symbols = provider.provideDocumentSymbols(document);

  assert.equal(symbols.length, 1);
  assert.equal(symbols[0].name, 'Online Softmax');
  assert.deepEqual(
    symbols[0].children.map(child => ({
      name: child.name,
      children: child.children.map(grandchild => grandchild.name),
    })),
    [
      { name: 'Standard Softmax', children: ['Numerical Stability'] },
      { name: 'Online Version', children: [] },
    ],
  );
  assert.equal(symbols[0].range.start.line, 0);
  assert.equal(symbols[0].range.end.line, 9);
  assert.equal(symbols[0].children[0].selectionRange.start.character, 3);
});

test('markdown outline provider includes Setext headings like Obsidian', () => {
  const vscode = createVscodeMock();
  const { MarkdownOutlineProvider } = loadTsModule('src/markdownSymbols.ts', { vscode });
  const provider = new MarkdownOutlineProvider();
  const lines = [
    'Online Softmax',
    '==============',
    '',
    'Intro body',
    '```',
    'Not a heading',
    '-------------',
    '```',
    '',
    'Standard Softmax',
    '----------------',
    'Body',
    '### Numerical Stability',
  ];
  const document = {
    getText: () => lines.join('\n'),
    lineAt: line => ({ text: lines[line] }),
    lineCount: lines.length,
  };

  const symbols = provider.provideDocumentSymbols(document);

  assert.equal(symbols.length, 1);
  assert.equal(symbols[0].name, 'Online Softmax');
  assert.equal(symbols[0].detail, 'H1');
  assert.equal(symbols[0].selectionRange.start.line, 0);
  assert.equal(symbols[0].selectionRange.start.character, 0);
  assert.equal(symbols[0].selectionRange.end.character, 'Online Softmax'.length);
  assert.deepEqual(
    symbols[0].children.map(child => ({
      name: child.name,
      detail: child.detail,
      children: child.children.map(grandchild => grandchild.name),
    })),
    [
      { name: 'Standard Softmax', detail: 'H2', children: ['Numerical Stability'] },
    ],
  );
});

test('registerMarkdownOutlineProvider contributes a markdown document-symbol provider', () => {
  const registrations = [];
  const vscode = createVscodeMock({ registrations });
  const { registerMarkdownOutlineProvider } = loadTsModule('src/markdownSymbols.ts', { vscode });
  const context = { subscriptions: [] };

  registerMarkdownOutlineProvider(context);

  assert.equal(registrations.length, 1);
  assert.deepEqual(registrations[0].selector, { language: 'markdown', scheme: 'file' });
  assert.equal(typeof registrations[0].provider.provideDocumentSymbols, 'function');
  assert.equal(context.subscriptions.length, 1);
});

test('markdown outline tree mirrors native symbol icons, expanded hierarchy, and heading reveal', async () => {
  const uri = {
    scheme: 'file',
    fsPath: '/vault/notes/Concepts/Online Softmax.md',
    toString: () => 'file:///vault/notes/Concepts/Online%20Softmax.md',
  };
  const lines = [
    '# Online Softmax',
    '',
    '## Standard Softmax',
    '',
    '### Numerical Stability',
    '',
    '## Online Version',
    '',
  ];
  const revealCommands = [];
  const vscode = createVscodeMock({
    activeTabUri: uri,
    openDocument: {
      uri,
      getText: () => lines.join('\n'),
      offsetAt: position => position.line * 100 + position.character,
    },
    executeCommandCalls: revealCommands,
  });
  const { MarkdownOutlineTreeProvider } = loadTsModule('src/markdownSymbols.ts', { vscode });
  const provider = new MarkdownOutlineTreeProvider();

  const roots = await provider.getChildren();

  assert.equal(roots.length, 1);
  assert.equal(roots[0].label, 'Online Softmax');
  assert.equal(roots[0].description, undefined);
  assert.equal(roots[0].iconPath.id, 'symbol-string');
  assert.equal(roots[0].collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
  assert.equal(roots[0].children.length, 2);
  assert.deepEqual(roots[0].children.map(child => child.label), ['Standard Softmax', 'Online Version']);
  assert.deepEqual(roots[0].children.map(child => child.description), [undefined, undefined]);
  assert.deepEqual(
    roots[0].children.map(child => child.iconPath.id),
    ['symbol-string', 'symbol-string'],
  );
  assert.equal(
    roots[0].children[0].collapsibleState,
    vscode.TreeItemCollapsibleState.Expanded,
  );
  assert.equal(
    roots[0].children[1].collapsibleState,
    vscode.TreeItemCollapsibleState.None,
  );
  assert.deepEqual(
    roots[0].children[0].children.map(child => ({
      label: child.label,
      icon: child.iconPath.id,
      collapsibleState: child.collapsibleState,
    })),
    [{
      label: 'Numerical Stability',
      icon: 'symbol-string',
      collapsibleState: vscode.TreeItemCollapsibleState.None,
    }],
  );

  await vscode.commands.executeCommand(
    roots[0].children[1].command.command,
    ...roots[0].children[1].command.arguments,
  );

  assert.deepEqual(revealCommands, [
    [
      'llm-wiki.revealInMarkdownEditor',
      {
        uri,
        selection: { from: 603, to: 603 },
      },
    ],
  ]);
});

test('markdown outline item identities survive refreshes and disambiguate duplicate labels', async () => {
  const uri = {
    scheme: 'file',
    fsPath: '/vault/notes/Concepts/Duplicate Headings.md',
    toString: () => 'file:///vault/notes/Concepts/Duplicate%20Headings.md',
  };
  const vscode = createVscodeMock({
    activeTabUri: uri,
    openDocument: {
      uri,
      getText: () => [
        '# Duplicate Headings',
        '',
        '## Repeated',
        'First section',
        '',
        '## Repeated',
        'Second section',
      ].join('\n'),
      offsetAt: position => position.line * 100 + position.character,
    },
  });
  const { MarkdownOutlineTreeProvider } = loadTsModule('src/markdownSymbols.ts', { vscode });
  const provider = new MarkdownOutlineTreeProvider();

  const firstRoot = (await provider.getChildren())[0];
  const secondRoot = (await provider.getChildren())[0];
  const firstRepeated = firstRoot.children;
  const secondRepeated = secondRoot.children;

  assert.equal(typeof firstRoot.id, 'string');
  assert.equal(firstRoot.id, secondRoot.id);
  assert.deepEqual(
    firstRepeated.map(item => item.id),
    secondRepeated.map(item => item.id),
    'refreshing an unchanged outline must preserve item identities',
  );
  assert.notEqual(
    firstRepeated[0].id,
    firstRepeated[1].id,
    'same-label headings at different lines must remain distinct tree items',
  );
});

test('outline tree provider reads nested PDF bookmarks from the active custom PDF tab', async () => {
  const uri = {
    scheme: 'file',
    fsPath: '/vault/books/rendering.pdf',
    toString: () => 'file:///vault/books/rendering.pdf',
  };
  const revealCommands = [];
  const vscode = createVscodeMock({
    activeTabUri: uri,
    executeCommandCalls: revealCommands,
  });
  const { MarkdownOutlineTreeProvider } = loadTsModule('src/markdownSymbols.ts', { vscode });
  const pdfOutlineSource = {
    getPdfOutline: requestedUri => {
      assert.equal(requestedUri, uri);
      return [{
        title: 'Radiometry',
        destination: {
          pageIndex: 157,
          zoom: { mode: 3 },
          view: [462],
        },
        children: [{
          title: 'Light Transport',
          destination: {
            pageIndex: 164,
            zoom: { mode: 3 },
            view: [512],
          },
          children: [],
        }],
      }];
    },
    onDidChangePdfOutline: () => ({ dispose() {} }),
  };
  const provider = new MarkdownOutlineTreeProvider(pdfOutlineSource);

  const roots = await provider.getChildren();

  assert.equal(roots.length, 1);
  assert.equal(roots[0].label, 'Radiometry');
  assert.equal(roots[0].description, 'p. 158');
  assert.equal(roots[0].iconPath.id, 'bookmark');
  assert.equal(roots[0].children.length, 1);
  assert.equal(roots[0].children[0].label, 'Light Transport');
  assert.equal(roots[0].children[0].description, 'p. 165');

  await vscode.commands.executeCommand(
    roots[0].children[0].command.command,
    ...roots[0].children[0].command.arguments,
  );

  assert.deepEqual(revealCommands, [[
    'llm-wiki.revealInPdfOutline',
    {
      uri,
      destination: {
        pageIndex: 164,
        zoom: { mode: 3 },
        view: [512],
      },
      title: 'Light Transport',
    },
  ]]);
});

test('outline tree provider labels inferred PDF entries without changing their hierarchy', async () => {
  const uri = {
    scheme: 'file',
    fsPath: '/vault/books/inferred.pdf',
    toString: () => 'file:///vault/books/inferred.pdf',
  };
  const vscode = createVscodeMock({ activeTabUri: uri });
  const { MarkdownOutlineTreeProvider } = loadTsModule('src/markdownSymbols.ts', { vscode });
  const pdfOutlineSource = {
    getPdfOutline: () => [{
      title: '1 Introduction',
      destination: {
        pageIndex: 0,
        zoom: { mode: 1, params: { x: 72, y: 700, zoom: 0 } },
        view: [],
      },
      children: [{
        title: '1.1 Motivation',
        destination: {
          pageIndex: 0,
          zoom: { mode: 1, params: { x: 72, y: 580, zoom: 0 } },
          view: [],
        },
        children: [],
      }],
    }],
    isPdfOutlineInferred: requestedUri => {
      assert.equal(requestedUri, uri);
      return true;
    },
    onDidChangePdfOutline: () => ({ dispose() {} }),
  };
  const provider = new MarkdownOutlineTreeProvider(pdfOutlineSource);

  const roots = await provider.getChildren();

  assert.equal(roots.length, 2);
  assert.equal(roots[0].label, 'Inferred outline');
  assert.equal(roots[0].command, undefined);
  assert.equal(roots[1].label, '1 Introduction');
  assert.equal(roots[1].children[0].label, '1.1 Motivation');
});

test('outline tree provider falls back to the active PDF source when the custom tab input omits its URI', async () => {
  const uri = {
    scheme: 'file',
    fsPath: '/vault/books/rendering.pdf',
    toString: () => 'file:///vault/books/rendering.pdf',
  };
  const vscode = createVscodeMock();
  const { MarkdownOutlineTreeProvider } = loadTsModule('src/markdownSymbols.ts', { vscode });
  const provider = new MarkdownOutlineTreeProvider({
    getActivePdfUri: () => uri,
    getPdfOutline: requestedUri => {
      assert.equal(requestedUri, uri);
      return [{
        title: 'Active PDF bookmark',
        destination: {
          pageIndex: 24,
          zoom: { mode: 3 },
          view: [300],
        },
        children: [],
      }];
    },
    onDidChangePdfOutline: () => ({ dispose() {} }),
  });

  const roots = await provider.getChildren();

  assert.equal(roots.length, 1);
  assert.equal(roots[0].label, 'Active PDF bookmark');
  assert.equal(roots[0].description, 'p. 25');
});

test('outline tree provider distinguishes loading PDFs from PDFs without bookmarks', async () => {
  const uri = {
    scheme: 'file',
    fsPath: '/vault/books/no-outline.pdf',
    toString: () => 'file:///vault/books/no-outline.pdf',
  };
  const vscode = createVscodeMock({ activeTabUri: uri });
  const { MarkdownOutlineTreeProvider } = loadTsModule('src/markdownSymbols.ts', { vscode });
  let outline;
  const provider = new MarkdownOutlineTreeProvider({
    getPdfOutline: () => outline,
    onDidChangePdfOutline: () => ({ dispose() {} }),
  });

  assert.equal((await provider.getChildren())[0].label, '(loading PDF outline…)');
  outline = [];
  assert.equal((await provider.getChildren())[0].label, '(no PDF outline)');
});

test('outline tree provider creates collapsible Explorer views and refreshes with the active editor', () => {
  const tabChangeListeners = [];
  const treeProviderRegistrations = [];
  const treeViewCreations = [];
  const vscode = createVscodeMock({
    tabChangeListeners,
    treeProviderRegistrations,
    treeViewCreations,
  });
  const { registerMarkdownOutlineTreeProvider } = loadTsModule('src/markdownSymbols.ts', { vscode });
  const context = { subscriptions: [] };
  const provider = registerMarkdownOutlineTreeProvider(context);
  let refreshCount = 0;
  provider.onDidChangeTreeData(() => {
    refreshCount += 1;
  });

  for (const listener of tabChangeListeners) {
    listener({ changed: [], opened: [], closed: [] });
  }

  assert.equal(refreshCount, 1);
  assert.deepEqual(treeProviderRegistrations, []);
  assert.deepEqual(
    treeViewCreations,
    [
      {
        id: 'llm-wiki-markdown-outline',
        options: {
          treeDataProvider: provider,
          showCollapseAll: true,
        },
      },
      {
        id: 'llm-wiki-pdf-outline',
        options: {
          treeDataProvider: provider,
          showCollapseAll: true,
        },
      },
    ],
  );
});

function createVscodeMock({
  registrations = [],
  activeTabUri,
  openDocument,
  executeCommandCalls = [],
  tabChangeListeners = [],
  treeProviderRegistrations = [],
  treeViewCreations = [],
} = {}) {
  const textDocumentChangeListeners = [];
  const activeEditorChangeListeners = [];
  return {
    SymbolKind: {
      String: 15,
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
      Collapsed: 1,
      Expanded: 2,
    },
    EventEmitter: class EventEmitter {
      constructor() {
        this.listeners = [];
        this.event = listener => {
          this.listeners.push(listener);
          return { dispose() {} };
        };
      }
      fire(event) {
        for (const listener of this.listeners) listener(event);
      }
    },
    Position: class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
    Range: class Range {
      constructor(startLine, startCharacter, endLine, endCharacter) {
        this.start = { line: startLine, character: startCharacter };
        this.end = { line: endLine, character: endCharacter };
      }
    },
    DocumentSymbol: class DocumentSymbol {
      constructor(name, detail, kind, range, selectionRange) {
        this.name = name;
        this.detail = detail;
        this.kind = kind;
        this.range = range;
        this.selectionRange = selectionRange;
        this.children = [];
      }
    },
    workspace: {
      openTextDocument: async uri => {
        assert.equal(uri, activeTabUri);
        return openDocument;
      },
      onDidChangeTextDocument: listener => {
        textDocumentChangeListeners.push(listener);
        return { dispose() {} };
      },
    },
    window: {
      activeTextEditor: undefined,
      registerTreeDataProvider: (id, provider) => {
        treeProviderRegistrations.push({ id, provider });
        return { dispose() {} };
      },
      createTreeView: (id, options) => {
        treeViewCreations.push({ id, options });
        return { dispose() {} };
      },
      onDidChangeActiveTextEditor: listener => {
        activeEditorChangeListeners.push(listener);
        return { dispose() {} };
      },
      tabGroups: {
        onDidChangeTabs: listener => {
          tabChangeListeners.push(listener);
          return { dispose() {} };
        },
        activeTabGroup: {
          activeTab: activeTabUri ? { input: { uri: activeTabUri } } : undefined,
        },
      },
    },
    commands: {
      executeCommand: async (...args) => {
        executeCommandCalls.push(args);
      },
    },
    languages: {
      registerDocumentSymbolProvider: (selector, provider) => {
        const disposable = { dispose() {} };
        registrations.push({ selector, provider });
        return disposable;
      },
    },
  };
}
