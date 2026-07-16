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

test('dispatchUri opens markdown note links with the Human Learning markdown editor', async () => {
  const executeCommandCalls = [];
  const openTextDocumentCalls = [];
  const showTextDocumentCalls = [];
  const document = {
    uri: { fsPath: '/vault/notes/Concepts/Online Softmax.md' },
    getText: () => '# Online Softmax\n',
    positionAt: () => ({ line: 0, character: 0 }),
  };
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls,
    showTextDocumentCalls,
    document,
  });
  const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
    vscode,
    '@human-learning/core': {
      classifyReferenceTarget: () => ({
        kind: 'note',
        path: 'notes/Concepts/Online Softmax.md',
      }),
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      runMigrations: () => undefined,
      resolveWebTarget: () => undefined,
    },
    fs: { existsSync: () => true },
  });

  await dispatchUri('/vault', 'notes/Concepts/Online Softmax.md');

  assert.deepEqual(executeCommandCalls, [
    [
      'vscode.openWith',
      { fsPath: '/vault/notes/Concepts/Online Softmax.md' },
      'human-learning.markdownEditor',
    ],
  ]);
  assert.deepEqual(openTextDocumentCalls, []);
  assert.deepEqual(showTextDocumentCalls, []);
});

test('dispatchUri creates missing markdown note links before opening them', async () => {
  const executeCommandCalls = [];
  const createdDirectories = [];
  const writtenFiles = [];
  const document = {
    uri: { fsPath: '/vault/notes/Concepts/Linked Concept.md' },
    getText: () => '',
    positionAt: () => ({ line: 0, character: 0 }),
  };
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls: [],
    showTextDocumentCalls: [],
    document,
  });
  const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
    vscode,
    '@human-learning/core': {
      classifyReferenceTarget: () => ({
        kind: 'note',
        path: 'notes/Concepts/Linked Concept.md',
      }),
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      runMigrations: () => undefined,
      resolveWebTarget: () => undefined,
    },
    fs: {
      existsSync: () => false,
      mkdirSync: (...args) => createdDirectories.push(args),
      writeFileSync: (...args) => writtenFiles.push(args),
    },
  });

  await dispatchUri('/vault', 'notes/Concepts/Linked Concept.md');

  assert.deepEqual(createdDirectories, [
    ['/vault/notes/Concepts', { recursive: true }],
  ]);
  assert.deepEqual(writtenFiles, [
    ['/vault/notes/Concepts/Linked Concept.md', '', { flag: 'wx' }],
  ]);
  assert.deepEqual(executeCommandCalls, [
    [
      'vscode.openWith',
      { fsPath: '/vault/notes/Concepts/Linked Concept.md' },
      'human-learning.markdownEditor',
    ],
  ]);
});

test('dispatchUri reveals note headings inside the Human Learning markdown editor after opening', async () => {
  const executeCommandCalls = [];
  const document = {
    uri: { fsPath: '/vault/notes/Concepts/Online Softmax.md' },
    getText: () => '# Intro\n\n## Online Softmax\nBody\n',
    positionAt: offset => ({ line: offset, character: 0 }),
  };
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls: [],
    showTextDocumentCalls: [],
    document,
  });
  const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
    vscode,
    '@human-learning/core': {
      classifyReferenceTarget: () => ({
        kind: 'note',
        path: 'notes/Concepts/Online Softmax.md',
        heading: 'Online Softmax',
      }),
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      runMigrations: () => undefined,
      resolveWebTarget: () => undefined,
    },
    fs: { existsSync: () => true },
  });

  await dispatchUri('/vault', 'notes/Concepts/Online Softmax.md#Online Softmax');

  assert.deepEqual(executeCommandCalls, [
    [
      'vscode.openWith',
      { fsPath: '/vault/notes/Concepts/Online Softmax.md' },
      'human-learning.markdownEditor',
    ],
    [
      'human-learning.revealInMarkdownEditor',
      {
        uri: { fsPath: '/vault/notes/Concepts/Online Softmax.md' },
        selection: { from: 9, to: 9 },
      },
    ],
  ]);
});

test('dispatchUri reveals Obsidian block references inside markdown notes', async () => {
  const executeCommandCalls = [];
  const document = {
    uri: { fsPath: '/vault/notes/Concepts/Online Softmax.md' },
    getText: () => '# Intro\n\nImportant fact ^fact123\nMore text\n',
    positionAt: offset => ({ line: offset, character: 0 }),
  };
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls: [],
    showTextDocumentCalls: [],
    document,
  });
  const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
    vscode,
    '@human-learning/core': {
      classifyReferenceTarget: () => ({
        kind: 'note',
        path: 'notes/Concepts/Online Softmax.md',
        heading: '^fact123',
      }),
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      runMigrations: () => undefined,
      resolveWebTarget: () => undefined,
    },
    fs: { existsSync: () => true },
  });

  await dispatchUri('/vault', 'notes/Concepts/Online Softmax.md#^fact123');

  assert.deepEqual(executeCommandCalls, [
    [
      'vscode.openWith',
      { fsPath: '/vault/notes/Concepts/Online Softmax.md' },
      'human-learning.markdownEditor',
    ],
    [
      'human-learning.revealInMarkdownEditor',
      {
        uri: { fsPath: '/vault/notes/Concepts/Online Softmax.md' },
        selection: { from: 9, to: 9 },
      },
    ],
  ]);
});

test('all URI dispatchers transport portable PDF text fragments without database lookup', async () => {
  const textFragment = {
    textStart: 'selected text',
    textEnd: 'range end',
    prefix: 'before',
    suffix: 'after',
  };
  const uri = 'raw/pdf/paper.pdf#page=7:~:text=before-,selected%20text,range%20end,-after';

  for (const relativePath of [
    'src/uriDispatcher.ts',
    '../vscode-pdf-extension/src/uriDispatcher.ts',
    '../vscode-markdown-extension/src/uriDispatcher.ts',
  ]) {
    const executeCommandCalls = [];
    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      document: {
        uri: { fsPath: '/vault/raw/pdf/paper.pdf' },
        getText: () => '',
        positionAt: () => ({ line: 0, character: 0 }),
      },
    });
    const { dispatchUri } = loadTsModule(relativePath, {
      vscode,
      '@human-learning/core': {
        classifyReferenceTarget: () => ({
          kind: 'pdf',
          uri,
          path: 'raw/pdf/paper.pdf',
          page: 7,
          textFragment,
        }),
        openDatabase: () => { throw new Error('portable PDF dispatch must not open the database'); },
        closeDatabase: () => undefined,
        runMigrations: () => undefined,
        resolveWebTarget: () => undefined,
      },
      fs: { existsSync: () => true },
    });

    await dispatchUri('/vault', uri);

    assert.deepEqual(executeCommandCalls, [[
      'human-learning.openPdfTarget',
      {
        pdfPath: 'raw/pdf/paper.pdf',
        page: 7,
        textFragment,
      },
    ]], relativePath);
  }
});

test('URI dispatchers no longer resolve direct internal PDF anchor IDs', async () => {
  for (const relativePath of [
    'src/uriDispatcher.ts',
    '../vscode-pdf-extension/src/uriDispatcher.ts',
    '../vscode-markdown-extension/src/uriDispatcher.ts',
  ]) {
    const executeCommandCalls = [];
    const errorMessages = [];
    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      errorMessages,
      document: {
        uri: { fsPath: '/vault/raw/pdf/paper.pdf' },
        getText: () => '',
        positionAt: () => ({ line: 0, character: 0 }),
      },
    });
    const { dispatchUri } = loadTsModule(relativePath, {
      vscode,
      '@human-learning/core': {
        classifyReferenceTarget: uri => ({ kind: 'unknown', uri }),
        openDatabase: () => { throw new Error('direct anchor IDs must not open the database'); },
        closeDatabase: () => undefined,
        runMigrations: () => undefined,
        resolveWebTarget: () => undefined,
      },
      fs: { existsSync: () => false },
    });

    await dispatchUri('/vault', 'anc_pdf_123');

    assert.deepEqual(executeCommandCalls, [], relativePath);
    assert.deepEqual(errorMessages, ['Cannot open link target: anc_pdf_123'], relativePath);
  }
});

test('dispatchUri can route web targets into the Human Learning web browser instead of Chrome', async () => {
  const executeCommandCalls = [];
  const openExternalCalls = [];
  const openedWebTargets = [];
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls: [],
    showTextDocumentCalls: [],
    openExternalCalls,
    document: {
      uri: { fsPath: '/vault/raw/web/vue-props.html' },
      getText: () => '',
      positionAt: () => ({ line: 0, character: 0 }),
    },
  });
  const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
    vscode,
    '@human-learning/core': {
      classifyReferenceTarget: () => ({
        kind: 'web',
        url: 'https://vuejs.org/guide/components/props.html',
      }),
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      runMigrations: () => undefined,
      resolveWebTarget: () => undefined,
    },
    fs: { existsSync: () => true },
  });

  await dispatchUri('/vault', 'https://vuejs.org/guide/components/props.html', {
    openWebTarget: async url => {
      openedWebTargets.push(url);
    },
  });

  assert.deepEqual(openedWebTargets, ['https://vuejs.org/guide/components/props.html']);
  assert.deepEqual(openExternalCalls, []);
  assert.deepEqual(executeCommandCalls, []);
});

test('markdown-only dispatchUri opens PDFs with the default VS Code editor when PDF plugin command is missing', async () => {
  const executeCommandCalls = [];
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls: [],
    showTextDocumentCalls: [],
    document: {
      uri: { fsPath: '/vault/raw/pdf/paper.pdf' },
      getText: () => '',
      positionAt: () => ({ line: 0, character: 0 }),
    },
    executeCommand: async (...args) => {
      executeCommandCalls.push(args);
      if (args[0] === 'human-learning.openPdfTarget') {
        throw new Error("command 'human-learning.openPdfTarget' not found");
      }
    },
  });
  const textFragment = {
    textStart: 'selected text',
    prefix: 'before',
    suffix: 'after',
  };
  const { dispatchUri } = loadTsModule('../vscode-markdown-extension/src/uriDispatcher.ts', {
    vscode,
    '@human-learning/core': {
      classifyReferenceTarget: () => ({
        kind: 'pdf',
        path: 'raw/pdf/paper.pdf',
        page: 7,
        textFragment,
      }),
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      runMigrations: () => undefined,
      resolveWebTarget: () => undefined,
    },
    fs: { existsSync: () => true },
  });

  await dispatchUri('/vault', 'raw/pdf/paper.pdf#page=7:~:text=before-,selected%20text,-after');

  assert.deepEqual(executeCommandCalls, [
    [
      'human-learning.openPdfTarget',
      {
        pdfPath: 'raw/pdf/paper.pdf',
        page: 7,
        textFragment,
      },
    ],
    [
      'vscode.open',
      { fsPath: '/vault/raw/pdf/paper.pdf' },
    ],
  ]);
});

test('standalone markdown dispatch resolves a relative PDF text fragment and falls back to the default editor', async () => {
  const executeCommandCalls = [];
  const textFragment = {
    textStart: 'selected text',
    prefix: 'before',
    suffix: 'after',
  };
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls: [],
    showTextDocumentCalls: [],
    document: {
      uri: { fsPath: '/workspace/notes/Source.md' },
      getText: () => '',
      positionAt: () => ({ line: 0, character: 0 }),
    },
    executeCommand: async (...args) => {
      executeCommandCalls.push(args);
      if (args[0] === 'human-learning.openPdfTarget') {
        throw new Error("command 'human-learning.openPdfTarget' not found");
      }
    },
  });
  const workspaceUri = { scheme: 'file', fsPath: '/workspace' };
  vscode.workspace.workspaceFolders = [{ uri: workspaceUri }];
  vscode.workspace.getWorkspaceFolder = () => ({ uri: workspaceUri });
  vscode.window.activeTextEditor = {
    document: {
      uri: { scheme: 'file', fsPath: '/workspace/notes/Source.md' },
    },
  };
  vscode.window.tabGroups = { activeTabGroup: { activeTab: undefined } };
  const { dispatchStandaloneUri } = loadTsModule('../vscode-markdown-extension/src/uriDispatcher.ts', {
    vscode,
    '@human-learning/core': {
      classifyReferenceTarget: () => ({
        kind: 'pdf',
        path: '../raw/pdf/paper.pdf',
        page: 7,
        textFragment,
      }),
      openDatabase: () => { throw new Error('standalone PDF dispatch must not open a database'); },
      closeDatabase: () => undefined,
      runMigrations: () => undefined,
      resolveWebTarget: () => undefined,
    },
    fs: { existsSync: () => true },
  });

  await dispatchStandaloneUri('../raw/pdf/paper.pdf#page=7:~:text=before-,selected%20text,-after');

  assert.deepEqual(executeCommandCalls, [
    [
      'human-learning.openPdfTarget',
      {
        pdfPath: '/workspace/raw/pdf/paper.pdf',
        page: 7,
        textFragment,
      },
    ],
    [
      'vscode.open',
      { fsPath: '/workspace/raw/pdf/paper.pdf' },
    ],
  ]);
});

test('standalone markdown dispatch resolves beside an active note outside an unrelated workspace', async () => {
  const executeCommandCalls = [];
  const textFragment = {
    textStart: 'selected text',
    prefix: 'before',
    suffix: 'after',
  };
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls: [],
    showTextDocumentCalls: [],
    document: {
      uri: { fsPath: '/external/notes/Source.md' },
      getText: () => '',
      positionAt: () => ({ line: 0, character: 0 }),
    },
  });
  vscode.workspace.workspaceFolders = [{ uri: { scheme: 'file', fsPath: '/workspace' } }];
  vscode.workspace.getWorkspaceFolder = () => undefined;
  vscode.window.activeTextEditor = {
    document: {
      uri: { scheme: 'file', fsPath: '/external/notes/Source.md' },
    },
  };
  vscode.window.tabGroups = { activeTabGroup: { activeTab: undefined } };
  const { dispatchStandaloneUri } = loadTsModule('../vscode-markdown-extension/src/uriDispatcher.ts', {
    vscode,
    '@human-learning/core': {
      classifyReferenceTarget: () => ({
        kind: 'pdf',
        path: 'paper.pdf',
        page: 7,
        textFragment,
      }),
      openDatabase: () => { throw new Error('standalone PDF dispatch must not open a database'); },
      closeDatabase: () => undefined,
      runMigrations: () => undefined,
      resolveWebTarget: () => undefined,
    },
    fs: { existsSync: () => true },
  });

  await dispatchStandaloneUri('paper.pdf#page=7:~:text=before-,selected%20text,-after');

  assert.deepEqual(executeCommandCalls, [[
    'human-learning.openPdfTarget',
    {
      pdfPath: '/external/notes/paper.pdf',
      page: 7,
      textFragment,
    },
  ]]);
});

test('standalone markdown dispatch preserves a copied absolute portable PDF target', async () => {
  const executeCommandCalls = [];
  const pdfPath = '/Users/reader/Outside Workspace/paper.pdf';
  const textFragment = { textStart: 'standalone selection' };
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls: [],
    showTextDocumentCalls: [],
    document: {
      uri: { fsPath: '/workspace/notes/Source.md' },
      getText: () => '',
      positionAt: () => ({ line: 0, character: 0 }),
    },
    executeCommand: async (...args) => {
      executeCommandCalls.push(args);
      if (args[0] === 'human-learning.openPdfTarget') {
        throw new Error("command 'human-learning.openPdfTarget' not found");
      }
    },
  });
  const workspaceUri = { scheme: 'file', fsPath: '/workspace' };
  vscode.workspace.workspaceFolders = [{ uri: workspaceUri }];
  vscode.workspace.getWorkspaceFolder = () => ({ uri: workspaceUri });
  vscode.window.activeTextEditor = {
    document: {
      uri: { scheme: 'file', fsPath: '/workspace/notes/Source.md' },
    },
  };
  vscode.window.tabGroups = { activeTabGroup: { activeTab: undefined } };
  const { dispatchStandaloneUri } = loadTsModule('../vscode-markdown-extension/src/uriDispatcher.ts', {
    vscode,
    '@human-learning/core': {
      classifyReferenceTarget: () => ({
        kind: 'pdf',
        path: pdfPath,
        page: 7,
        textFragment,
      }),
      openDatabase: () => { throw new Error('standalone PDF dispatch must not open a database'); },
      closeDatabase: () => undefined,
      runMigrations: () => undefined,
      resolveWebTarget: () => undefined,
    },
    fs: { existsSync: () => true },
  });

  await dispatchStandaloneUri(`<${pdfPath}#page=7:~:text=standalone%20selection>`);

  assert.deepEqual(executeCommandCalls, [
    [
      'human-learning.openPdfTarget',
      { pdfPath, page: 7, textFragment },
    ],
    [
      'vscode.open',
      { fsPath: pdfPath },
    ],
  ]);
});

test('all URI dispatchers preserve absolute PDF paths in default-editor fallback', async () => {
  const textFragment = { textStart: 'selected text' };
  const pdfPath = '/external/papers/paper.pdf';

  for (const relativePath of [
    'src/uriDispatcher.ts',
    '../vscode-pdf-extension/src/uriDispatcher.ts',
    '../vscode-markdown-extension/src/uriDispatcher.ts',
  ]) {
    const executeCommandCalls = [];
    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      document: {
        uri: { fsPath: pdfPath },
        getText: () => '',
        positionAt: () => ({ line: 0, character: 0 }),
      },
      executeCommand: async (...args) => {
        executeCommandCalls.push(args);
        if (args[0] === 'human-learning.openPdfTarget') {
          throw new Error("command 'human-learning.openPdfTarget' not found");
        }
      },
    });
    const { dispatchUri } = loadTsModule(relativePath, {
      vscode,
      '@human-learning/core': {
        classifyReferenceTarget: () => ({
          kind: 'pdf',
          path: pdfPath,
          page: 7,
          textFragment,
        }),
        openDatabase: () => { throw new Error('absolute PDF fallback must not open a database'); },
        closeDatabase: () => undefined,
        runMigrations: () => undefined,
        resolveWebTarget: () => undefined,
      },
      fs: { existsSync: () => true },
    });

    await dispatchUri('/vault', `${pdfPath}#page=7:~:text=selected%20text`);

    assert.deepEqual(executeCommandCalls, [
      [
        'human-learning.openPdfTarget',
        { pdfPath, page: 7, textFragment },
      ],
      [
        'vscode.open',
        { fsPath: pdfPath },
      ],
    ], relativePath);
  }
});

function createVscodeMock({
  executeCommandCalls,
  openTextDocumentCalls,
  showTextDocumentCalls,
  document,
  executeCommand,
  openExternalCalls = [],
  errorMessages = [],
}) {
  return {
    Uri: {
      file: fsPath => ({ fsPath }),
      parse: value => ({ toString: () => value }),
    },
    workspace: {
      openTextDocument: async (...args) => {
        openTextDocumentCalls.push(args);
        return document;
      },
    },
    window: {
      showTextDocument: async (...args) => {
        showTextDocumentCalls.push(args);
        return {
          revealRange() {},
          selection: null,
        };
      },
      showErrorMessage: message => { errorMessages.push(message); },
    },
    env: {
      openExternal: async (...args) => {
        openExternalCalls.push(args);
        return true;
      },
    },
    commands: {
      executeCommand: executeCommand ?? (async (...args) => {
        await new Promise(resolve => setTimeout(resolve, 0));
        executeCommandCalls.push(args);
        return undefined;
      }),
    },
    Range: class Range {
      constructor() {}
    },
    Selection: class Selection {
      constructor() {}
    },
    TextEditorRevealType: {
      AtTop: 0,
    },
  };
}
