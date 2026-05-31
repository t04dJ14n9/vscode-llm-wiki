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

test('dispatchUri waits for resolved anchor URIs to finish dispatching', async () => {
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
  const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
    vscode,
    '@human-learning/core': {
      classifyReferenceTarget: uri => uri === 'raw/pdf/paper.pdf#page=7&anchor=anc_pdf_123'
        ? {
          kind: 'pdf',
          uri,
          path: 'raw/pdf/paper.pdf',
          anchorId: 'anc_pdf_123',
          page: 7,
        }
        : {
          kind: 'pdf',
          uri,
          path: 'raw/pdf/paper.pdf',
          anchorId: 'anc_pdf_123',
          page: 7,
        },
      openDatabase: async () => ({
        prepare: () => ({
          get: () => ({ uri: 'raw/pdf/paper.pdf#page=7&anchor=anc_pdf_123' }),
        }),
      }),
      closeDatabase: () => undefined,
      runMigrations: () => undefined,
      resolveWebTarget: () => undefined,
    },
    fs: { existsSync: () => true },
  });

  await dispatchUri('/vault', 'anc_pdf_123');

  assert.deepEqual(executeCommandCalls, [
    [
      'human-learning.openPdfAtAnchor',
      {
        pdfPath: 'raw/pdf/paper.pdf',
        anchorId: 'anc_pdf_123',
        page: 7,
      },
    ],
  ]);
});

function createVscodeMock({
  executeCommandCalls,
  openTextDocumentCalls,
  showTextDocumentCalls,
  document,
}) {
  return {
    Uri: {
      file: fsPath => ({ fsPath }),
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
      showErrorMessage: () => undefined,
    },
    commands: {
      executeCommand: async (...args) => {
        await new Promise(resolve => setTimeout(resolve, 0));
        executeCommandCalls.push(args);
        return undefined;
      },
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
