import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
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
      if (request === 'fs') {
        return {
          ...originalLoad.call(this, request, parent, isMain),
          ...mocks[request],
        };
      }
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

test('dispatchUri refuses to create a note through a workspace symlink', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hl-uri-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'hl-uri-outside-'));
  const executeCommandCalls = [];
  const errorMessages = [];
  try {
    mkdirSync(join(root, 'notes'), { recursive: true });
    symlinkSync(outside, join(root, 'notes', 'out'), 'dir');
    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      document: {
        getText: () => '',
        positionAt: () => ({ line: 0, character: 0 }),
      },
      errorMessages,
    });
    const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
      vscode,
      '@human-learning/core': {
        classifyReferenceTarget: () => ({
          kind: 'note',
          path: 'notes/out/Escape.md',
        }),
      },
    });

    await dispatchUri(root, 'notes/out/Escape.md');

    assert.deepEqual(executeCommandCalls, []);
    assert.equal(existsSync(join(outside, 'Escape.md')), false);
    assert.deepEqual(errorMessages, [
      'Cannot open link outside the workspace: notes/out/Escape.md',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
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

test('dispatchUri rejects note targets that would create files outside the workspace', async () => {
  const executeCommandCalls = [];
  const openTextDocumentCalls = [];
  const writtenFiles = [];
  const createdDirectories = [];
  const errorMessages = [];
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls,
    showTextDocumentCalls: [],
    errorMessages,
    document: undefined,
  });
  const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
    vscode,
    '@human-learning/core': {
      classifyReferenceTarget: () => ({
        kind: 'note',
        path: '../outside.md',
      }),
    },
    fs: {
      existsSync: () => false,
      mkdirSync: (...args) => createdDirectories.push(args),
      writeFileSync: (...args) => writtenFiles.push(args),
    },
  });

  await dispatchUri('/vault', '../outside.md');

  assert.deepEqual(executeCommandCalls, []);
  assert.deepEqual(openTextDocumentCalls, []);
  assert.deepEqual(createdDirectories, []);
  assert.deepEqual(writtenFiles, []);
  assert.deepEqual(errorMessages, [
    'Cannot open link outside the workspace: ../outside.md',
  ]);
});

test('dispatchUri rejects relative code, asset, and PDF targets outside the workspace', async () => {
  for (const kind of ['code', 'image', 'text', 'unknown', 'pdf']) {
    const executeCommandCalls = [];
    const openTextDocumentCalls = [];
    const showTextDocumentCalls = [];
    const errorMessages = [];
    const path = `../../outside.${kind === 'pdf' ? 'pdf' : kind === 'code' ? 'ts' : 'txt'}`;
    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls,
      showTextDocumentCalls,
      errorMessages,
      document: undefined,
    });
    const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
      vscode,
      '@human-learning/core': {
        classifyReferenceTarget: () => ({ kind, path }),
      },
      fs: { existsSync: () => true },
    });

    await dispatchUri('/vault', path);

    assert.deepEqual(executeCommandCalls, [], kind);
    assert.deepEqual(openTextDocumentCalls, [], kind);
    assert.deepEqual(showTextDocumentCalls, [], kind);
    assert.deepEqual(errorMessages, [
      `Cannot open link outside the workspace: ${path}`,
    ], kind);
  }
});

test('dispatchUri without a workspace allows only web and absolute PDF viewing', async () => {
  const executeCommandCalls = [];
  const openExternalCalls = [];
  const errorMessages = [];
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls: [],
    showTextDocumentCalls: [],
    openExternalCalls,
    errorMessages,
    document: undefined,
  });
  const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
    vscode,
    '@human-learning/core': {
      classifyReferenceTarget: uri => {
        if (uri.startsWith('https://')) return { kind: 'web', url: uri };
        if (uri.startsWith('/')) {
          return { kind: 'pdf', path: '/outside/read-only.pdf', page: 4 };
        }
        return { kind: 'note', path: uri };
      },
    },
    fs: { existsSync: () => true },
  });

  await dispatchUri(undefined, '/outside/read-only.pdf#page=4');
  await dispatchUri(undefined, 'https://example.com/reference');
  await dispatchUri(undefined, 'notes/relative.md');

  assert.deepEqual(executeCommandCalls, [[
    'human-learning.openPdfTarget',
    { pdfPath: '/outside/read-only.pdf', page: 4 },
  ]]);
  assert.equal(openExternalCalls.length, 1);
  assert.equal(
    openExternalCalls[0][0].toString(),
    'https://example.com/reference',
  );
  assert.deepEqual(errorMessages, [
    'Open a workspace folder before opening this relative link: notes/relative.md',
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

test('dispatchUri reveals Markdown line fragments as complete line ranges', async () => {
  const executeCommandCalls = [];
  const text = 'one\nsecond\nthird\nfourth\nfifth\nsixth';
  const lineStarts = [0, 4, 11, 17, 24, 30];
  const document = {
    uri: { fsPath: '/vault/notes/Concepts/Memory.md' },
    lineCount: lineStarts.length,
    getText: () => text,
    offsetAt: position => lineStarts[position.line] ?? text.length,
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
        path: 'notes/Concepts/Memory.md',
        lines: { start: 4, end: 5 },
      }),
    },
    fs: { existsSync: () => true },
  });

  await dispatchUri('/vault', 'notes/Concepts/Memory.md#L4-L5');

  assert.deepEqual(executeCommandCalls.at(-1), [
    'human-learning.revealInMarkdownEditor',
    {
      uri: { fsPath: '/vault/notes/Concepts/Memory.md' },
      selection: { from: 17, to: 30 },
    },
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

test('dispatchUri transports portable PDF text fragments without database lookup', async () => {
  const textFragment = {
    textStart: 'selected text',
    textEnd: 'range end',
    prefix: 'before',
    suffix: 'after',
  };
  const uri = 'raw/pdf/paper.pdf#page=7:~:text=before-,selected%20text,range%20end,-after';

  for (const relativePath of ['src/uriDispatcher.ts']) {
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

test('dispatchUri no longer resolves direct internal PDF anchor IDs', async () => {
  for (const relativePath of ['src/uriDispatcher.ts']) {
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

test('dispatchUri preserves absolute PDF paths in default-editor fallback', async () => {
  const textFragment = { textStart: 'selected text' };
  const pdfPath = '/external/papers/paper.pdf';

  for (const relativePath of ['src/uriDispatcher.ts']) {
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
    Position: class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
  };
}
