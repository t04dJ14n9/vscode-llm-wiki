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

test('insert helper replaces selections and returns cursor positions', () => {
  const { applyInsertText } = loadTsModule('webview-src/insertText.ts');

  assert.deepEqual(
    applyInsertText('alpha beta gamma', [{ from: 6, to: 10 }], '[PDF](hl://pdf/raw/paper.pdf)'),
    {
      text: 'alpha [PDF](hl://pdf/raw/paper.pdf) gamma',
      cursorPositions: [35],
    },
  );

  assert.deepEqual(
    applyInsertText('abcd', [{ from: 1, to: 2 }, { from: 3, to: 4 }], 'X'),
    {
      text: 'aXcX',
      cursorPositions: [2, 4],
    },
  );
});

test('markdown editor provider can insert text into the active custom editor webview', async () => {
  const messages = [];
  const vscode = createVscodeMock();
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({ extensionUri: { scheme: 'file', path: '/extension' } });
  const panel = createPanelMock(messages);
  panel.visible = false;

  await provider.resolveCustomTextEditor(createDocumentMock(), panel, {});
  const inserted = await provider.insertMarkdown('[PDF](hl://pdf/raw/pdf/paper.pdf?anchor=anc_pdf_123)');

  assert.equal(inserted, true);
  assert.deepEqual(messages.at(-1), {
    type: 'insertText',
    text: '[PDF](hl://pdf/raw/pdf/paper.pdf?anchor=anc_pdf_123)',
  });
});

test('markdown editor provider posts normalized editor metrics without forcing the code editor font', async () => {
  const messages = [];
  const vscode = createVscodeMock({
    editorConfig: {
      fontFamily: 'Fira Code',
      fontSize: 17,
      fontWeight: '500',
      lineHeight: 29,
      letterSpacing: 1.25,
    },
  });
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({ extensionUri: { scheme: 'file', path: '/extension' } });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(createDocumentMock(), panel, {});

  assert.deepEqual(messages.find(message => message.type === 'updateSettings'), {
    type: 'updateSettings',
    settings: {
      fontSize: '17px',
      fontWeight: '500',
      lineHeight: '29px',
      letterSpacing: '1.25px',
    },
  });
});

test('markdown editor provider sends the note title with document text', async () => {
  const messages = [];
  const vscode = createVscodeMock();
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({ extensionUri: { scheme: 'file', path: '/extension' } });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(
    createDocumentMock({
      uri: {
        fsPath: '/vault/notes/Concepts/Math and Code.md',
        toString: () => 'file:///vault/notes/Concepts/Math%20and%20Code.md',
      },
      text: '# Math and Code\n',
    }),
    panel,
    {},
  );
  await new Promise(resolve => setTimeout(resolve, 280));

  const setTextMessage = messages.find(message => message.type === 'setText');
  assert.equal(setTextMessage.text, '# Math and Code\n');
  assert.equal(setTextMessage.title, 'Math and Code');
});

test('markdown editor provider sends webview resource roots for note images', async () => {
  const messages = [];
  const asWebviewUriCalls = [];
  const findFilesCalls = [];
  const vscode = createVscodeMock({
    workspaceFolder: { uri: createUri('/vault') },
    findFiles: [
      createUri('/vault/notes/Concepts/Math and Code.md'),
      createUri('/vault/notes/Papers/FlashAttention Paper.md'),
    ],
    findFilesCalls,
  });
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({ extensionUri: createUri('/extension') });
  const panel = createPanelMock(messages, {
    asWebviewUri: uri => {
      asWebviewUriCalls.push(uri);
      return { toString: () => `webview://${uri.fsPath}` };
    },
  });

  await provider.resolveCustomTextEditor(
    createDocumentMock({
      uri: createUri('/vault/notes/Concepts/Math and Code.md'),
      text: '# Math and Code\n',
    }),
    panel,
    {},
  );
  await new Promise(resolve => setTimeout(resolve, 280));

  const setTextMessage = messages.find(message => message.type === 'setText');
  assert.equal(setTextMessage.currentNotePath, 'notes/Concepts/Math and Code.md');
  assert.deepEqual(setTextMessage.notePaths, [
    'notes/Concepts/Math and Code.md',
    'notes/Papers/FlashAttention Paper.md',
  ]);
  assert.equal(setTextMessage.resourceBaseUri, 'webview:///vault/notes/Concepts/');
  assert.equal(setTextMessage.resourceRootUri, 'webview:///vault/');
  assert.equal(findFilesCalls[0]?.pattern, 'notes/**/*.md');
  assert.deepEqual(
    panel.webview.options.localResourceRoots.map(uri => uri.fsPath),
    ['/extension/dist', '/vault'],
  );
  assert.deepEqual(
    asWebviewUriCalls.map(uri => uri.fsPath),
    ['/extension/dist/markdown-editor.js', '/vault/notes/Concepts', '/vault'],
  );
});

test('markdown editor webview CSP allows rendered note images', async () => {
  const messages = [];
  const vscode = createVscodeMock();
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({ extensionUri: { scheme: 'file', path: '/extension' } });
  const panel = createPanelMock(messages, { cspSource: 'vscode-resource:' });

  await provider.resolveCustomTextEditor(createDocumentMock(), panel, {});

  const csp = panel.webview.html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
  assert.match(csp, /img-src[^;]*vscode-resource:/);
  assert.match(csp, /img-src[^;]*data:/);
  assert.match(csp, /img-src[^;]*https:/);
});

test('markdown editor webview script URI is cache-busted for rebuilt editor bundles', async () => {
  const messages = [];
  const vscode = createVscodeMock();
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({ extensionUri: { scheme: 'file', path: '/extension' } });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(createDocumentMock(), panel, {});

  const scriptSrc = panel.webview.html.match(/<script nonce="[^"]+" src="([^"]+)"><\/script>/)?.[1] ?? '';
  assert.match(scriptSrc, /^webview:\/\/\/extension\/dist\/markdown-editor\.js\?v=\d+$/);
});

test('markdown editor provider renames the note when the webview title changes', async () => {
  const messages = [];
  const renameCalls = [];
  const executeCommandCalls = [];
  const oldUri = {
    fsPath: '/vault/notes/Concepts/Math and Code.md',
    path: '/vault/notes/Concepts/Math and Code.md',
    toString: () => 'file:///vault/notes/Concepts/Math%20and%20Code.md',
  };
  const vscode = createVscodeMock({ executeCommandCalls, renameCalls });
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({ extensionUri: { scheme: 'file', path: '/extension' } });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(
    createDocumentMock({
      uri: oldUri,
      text: '# Math and Code\n',
    }),
    panel,
    {},
  );

  await panel.fireMessage({ type: 'renameTitle', title: 'Renamed Math Note' });

  assert.equal(renameCalls.length, 1);
  assert.equal(renameCalls[0][0], oldUri);
  assert.equal(renameCalls[0][1].fsPath, '/vault/notes/Concepts/Renamed Math Note.md');
  assert.deepEqual(renameCalls[0][2], { overwrite: false });
  assert.deepEqual(executeCommandCalls.at(-1), [
    'vscode.openWith',
    renameCalls[0][1],
    'human-learning.markdownEditor',
  ]);
});

test('markdown editor provider reveals the webview without preserving focus when ready', async () => {
  const messages = [];
  const revealCalls = [];
  const vscode = createVscodeMock();
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({ extensionUri: { scheme: 'file', path: '/extension' } });
  const panel = createPanelMock(messages, { revealCalls });

  await provider.resolveCustomTextEditor(createDocumentMock(), panel, {});
  await panel.fireMessage({ type: 'ready' });

  assert.deepEqual(revealCalls.at(-1), [undefined, false]);
});

test('markdown editor provider asks the webview to focus after ready', async () => {
  const messages = [];
  const vscode = createVscodeMock();
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({ extensionUri: { scheme: 'file', path: '/extension' } });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(createDocumentMock(), panel, {});
  await panel.fireMessage({ type: 'ready' });
  await new Promise(resolve => setTimeout(resolve, 100));

  assert.ok(
    messages.some(message => message.type === 'focus'),
    'expected a focus request to be posted after the webview becomes ready',
  );
});

test('markdown editor provider asks VS Code to focus the active editor group before webview focus', async () => {
  const messages = [];
  const executeCommandCalls = [];
  const vscode = createVscodeMock({ executeCommandCalls });
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({ extensionUri: { scheme: 'file', path: '/extension' } });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(createDocumentMock(), panel, {});
  await panel.fireMessage({ type: 'ready' });
  await new Promise(resolve => setTimeout(resolve, 100));

  assert.ok(
    executeCommandCalls.some(args => args[0] === 'workbench.action.focusActiveEditorGroup'),
    'expected the provider to ask VS Code to focus the active editor group',
  );
  assert.ok(
    messages.some(message => message.type === 'focus'),
    'expected the provider to still post a webview focus message',
  );
});

test('markdown editor provider autosaves webview edits like Obsidian live editing', async () => {
  const messages = [];
  const saveCalls = [];
  const vscode = createVscodeMock();
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({ extensionUri: { scheme: 'file', path: '/extension' } });
  const document = createDocumentMock({
    text: '# Note\n',
    save: async () => {
      saveCalls.push(Date.now());
      return true;
    },
  });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(document, panel, {});
  await panel.fireMessage({ type: 'edit', text: '# Updated\n' });
  await new Promise(resolve => setTimeout(resolve, 220));

  assert.equal(saveCalls.length, 1);
});

test('markdown editor provider persists Vim mode and notifies markdown webviews when toggled', async () => {
  const messages = [];
  const workspaceState = createStorageMock();
  const vscode = createVscodeMock();
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({
    extensionUri: { scheme: 'file', path: '/extension' },
    workspaceState,
  });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(createDocumentMock(), panel, {});

  assert.deepEqual(messages.find(message => message.type === 'setVimMode'), {
    type: 'setVimMode',
    enabled: false,
  });

  const enabled = await provider.toggleVimMode();

  assert.equal(enabled, true);
  assert.equal(workspaceState.values.markdownVimMode, true);
  assert.deepEqual(messages.at(-1), {
    type: 'setVimMode',
    enabled: true,
  });
});

test('new markdown webviews inherit the toggled Vim mode state', async () => {
  const firstMessages = [];
  const secondMessages = [];
  const workspaceState = createStorageMock();
  const vscode = createVscodeMock();
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({
    extensionUri: { scheme: 'file', path: '/extension' },
    workspaceState,
  });

  await provider.resolveCustomTextEditor(
    createDocumentMock({ uri: 'file:///vault/notes/Concepts/FlashAttention.md', text: '# FlashAttention\n' }),
    createPanelMock(firstMessages),
    {},
  );
  await provider.toggleVimMode();
  await provider.resolveCustomTextEditor(
    createDocumentMock({ uri: 'file:///vault/notes/Concepts/Online Softmax.md', text: '# Online Softmax\n' }),
    createPanelMock(secondMessages),
    {},
  );

  assert.deepEqual(secondMessages.find(message => message.type === 'setVimMode'), {
    type: 'setVimMode',
    enabled: true,
  });
});

test('markdown editor provider queues and posts reveal selections for the active markdown webview', async () => {
  const messages = [];
  const vscode = createVscodeMock();
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({
    extensionUri: { scheme: 'file', path: '/extension' },
    workspaceState: createStorageMock(),
  });
  const panel = createPanelMock(messages);
  const document = createDocumentMock();

  await provider.resolveCustomTextEditor(document, panel, {});
  await provider.revealInEditor(document.uri, { from: 9, to: 9 });

  assert.deepEqual(messages.at(-1), {
    type: 'revealPosition',
    anchor: 9,
    head: 9,
  });
});

test('markdown editor provider exposes the active custom markdown selection as raw source context', async () => {
  const messages = [];
  const vscode = createVscodeMock();
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({
    extensionUri: { scheme: 'file', path: '/extension' },
    workspaceState: createStorageMock(),
  });
  const document = createDocumentMock({
    text: '# Note\nAlpha **beta** gamma\nOmega\n',
  });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(document, panel, {});
  await panel.fireMessage({
    type: 'selectionChanged',
    selection: { from: 13, to: 21 },
  });

  assert.deepEqual(provider.getActiveSelectionContext(), {
    uri: document.uri,
    text: '**beta**',
    startLine: 2,
    endLine: 2,
  });
});

test('markdown editor provider anchors an empty custom markdown selection to the whole document range', async () => {
  const messages = [];
  const vscode = createVscodeMock();
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({
    extensionUri: { scheme: 'file', path: '/extension' },
    workspaceState: createStorageMock(),
  });
  const text = '# Note\nAlpha **beta** gamma\nOmega';
  const document = createDocumentMock({ text });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(document, panel, {});
  await panel.fireMessage({
    type: 'selectionChanged',
    selection: { from: 13, to: 13 },
  });

  assert.deepEqual(provider.getActiveSelectionContext(), {
    uri: document.uri,
    text,
    startLine: 1,
    endLine: 3,
  });
});

test('markdown editor provider routes openUri messages through the host link target command', async () => {
  const messages = [];
  const executeCommandCalls = [];
  const vscode = createVscodeMock({ executeCommandCalls });
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({
    extensionUri: { scheme: 'file', path: '/extension' },
    workspaceState: createStorageMock(),
  });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(createDocumentMock(), panel, {});
  await panel.fireMessage({ type: 'openUri', uri: 'https://example.com/docs' });

  assert.deepEqual(executeCommandCalls.at(-1), [
    'human-learning.openLinkTarget',
    'https://example.com/docs',
  ]);
});

test('markdown editor provider writes webview copyText messages to the host clipboard', async () => {
  const messages = [];
  const clipboardWrites = [];
  const vscode = createVscodeMock();
  vscode.env = {
    clipboard: {
      writeText: async text => clipboardWrites.push(text),
    },
  };
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({
    extensionUri: { scheme: 'file', path: '/extension' },
    workspaceState: createStorageMock(),
  });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(createDocumentMock(), panel, {});
  await panel.fireMessage({
    type: 'copyText',
    text: ['const x = 1;', 'console.log(x);'].join('\n'),
  });

  assert.deepEqual(clipboardWrites, [
    ['const x = 1;', 'console.log(x);'].join('\n'),
  ]);
});

test('pdf insert action targets the active custom markdown editor before native editors', async () => {
  const insertedMarkdown = [];
  const clipboardWrites = [];
  const informationMessages = [];
  const vscode = createVscodeMock();
  vscode.env = {
    clipboard: {
      writeText: async text => clipboardWrites.push(text),
    },
  };
  vscode.workspace.asRelativePath = () => 'raw/pdf/flash-attention.pdf';
  vscode.window.visibleTextEditors = [];
  vscode.window.showInformationMessage = message => informationMessages.push(message);

  const core = {
    closeDatabase: () => undefined,
    createPdfAnchorFromSelection: () => ({
      uri: 'hl://pdf/raw/pdf/flash-attention.pdf?anchor=anc_test',
    }),
    openDatabase: async () => ({}),
    resolveAnchor: () => undefined,
    runMigrations: () => undefined,
  };
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': core,
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { scheme: 'file', path: '/extension' } },
    '/vault',
    {
      insertMarkdown: async markdown => {
        insertedMarkdown.push(markdown);
        return true;
      },
    },
  );

  await provider.handleSelectionAction(
    { toString: () => 'file:///vault/raw/pdf/flash-attention.pdf' },
    'insertLink',
    {
      page: 1,
      textItemIndex: 0,
      charOffset: 0,
      length: 23,
      snippet: 'FlashAttention uses tiling',
    },
  );

  assert.deepEqual(insertedMarkdown, [
    '[FlashAttention uses tiling](hl://pdf/raw/pdf/flash-attention.pdf?anchor=anc_test)',
  ]);
  assert.deepEqual(clipboardWrites, []);
  assert.deepEqual(informationMessages, ['Human Learning PDF link inserted']);
});

test('pdf reference jumps reopen markdown notes in the custom editor and reveal the target line', async () => {
  const executeCommandCalls = [];
  const openTextDocumentCalls = [];
  const vscode = createVscodeMock({ executeCommandCalls, openTextDocumentCalls });
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': {
      closeDatabase: () => undefined,
      createPdfAnchorFromSelection: () => undefined,
      openDatabase: async () => ({}),
      resolveAnchor: () => undefined,
      runMigrations: () => undefined,
    },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { scheme: 'file', path: '/extension' } },
    '/vault',
  );

  await provider.openMarkdownAt('notes/Concepts/FlashAttention.md', 12);

  assert.equal(openTextDocumentCalls.length, 1);
  assert.equal(openTextDocumentCalls[0][0].fsPath, '/vault/notes/Concepts/FlashAttention.md');
  assert.equal(executeCommandCalls.length, 2);
  assert.equal(executeCommandCalls[0][0], 'vscode.openWith');
  assert.equal(executeCommandCalls[0][1].fsPath, '/vault/notes/Concepts/FlashAttention.md');
  assert.equal(executeCommandCalls[0][2], 'human-learning.markdownEditor');
  assert.equal(executeCommandCalls[1][0], 'human-learning.revealInMarkdownEditor');
  assert.equal(executeCommandCalls[1][1].uri.fsPath, '/vault/notes/Concepts/FlashAttention.md');
  assert.deepEqual(executeCommandCalls[1][1].selection, { from: 11, to: 11 });
});

function createVscodeMock(options = {}) {
  const editorConfig = {
    fontFamily: options.editorConfig?.fontFamily ?? 'Menlo',
    fontSize: options.editorConfig?.fontSize ?? 14,
    fontWeight: options.editorConfig?.fontWeight ?? 'normal',
    lineHeight: options.editorConfig?.lineHeight ?? 0,
    letterSpacing: options.editorConfig?.letterSpacing ?? 0,
  };
  class WorkspaceEdit {
    replace() {}
  }
  return {
    Uri: {
      file: fsPath => createUri(fsPath),
      joinPath: (base, ...segments) => createUri([base.fsPath ?? base.path ?? '', ...segments].join('/').replace(/\/+/g, '/')),
    },
    workspace: {
      fs: {
        rename: async (...args) => {
          options.renameCalls?.push(args);
        },
      },
      onDidChangeTextDocument: () => ({ dispose() {} }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
      getConfiguration: section => ({
        get: (key, fallback) => {
          if (section === 'editor' && Object.prototype.hasOwnProperty.call(editorConfig, key)) {
            return editorConfig[key];
          }
          return fallback;
        },
      }),
      applyEdit: async () => true,
      openTextDocument: async (...args) => {
        options.openTextDocumentCalls?.push(args);
        return options.document ?? createOpenDocumentMock(args[0]);
      },
      findFiles: async (...args) => {
        options.findFilesCalls?.push(args[0]);
        return options.findFiles ?? [];
      },
      getWorkspaceFolder: () => options.workspaceFolder,
    },
    commands: {
      executeCommand: async (...args) => {
        options.executeCommandCalls?.push(args);
        return undefined;
      },
    },
    window: {
      showErrorMessage: () => undefined,
      showTextDocument: async () => ({
        selection: null,
        revealRange() {},
      }),
    },
    WorkspaceEdit,
    Position: class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
    Range: class Range {
      constructor() {}
    },
    RelativePattern: class RelativePattern {
      constructor(baseUri, pattern) {
        this.baseUri = baseUri;
        this.pattern = pattern;
      }
    },
  };
}

function createUri(fsPath, query = '') {
  return {
    scheme: 'file',
    fsPath,
    path: fsPath,
    query,
    with(changes = {}) {
      return createUri(fsPath, changes.query ?? query);
    },
    toString: () => `file://${fsPath}${query ? `?${query}` : ''}`,
  };
}

function createDocumentMock(options = {}) {
  const uri = options.uri ?? 'file:///vault/notes/Concepts/Note.md';
  const text = options.text ?? '# Note\n';
  const uriObject = typeof uri === 'string'
    ? {
        scheme: 'file',
        fsPath: uri.replace(/^file:\/\//, ''),
        path: uri.replace(/^file:\/\//, ''),
        toString: () => uri,
      }
    : uri;
  return {
    uri: uriObject,
    isClosed: false,
    getText: () => text,
    lineCount: text.split('\n').length,
    lineAt: () => ({ text: text.replace(/\n$/, '') }),
    positionAt: offset => {
      const before = text.slice(0, offset).split('\n');
      return {
        line: before.length - 1,
        character: before.at(-1).length,
      };
    },
    save: options.save ?? (async () => true),
  };
}

function createPanelMock(messages, options = {}) {
  let receiveMessageHandler = () => undefined;
  return {
    active: true,
    visible: true,
    reveal: (...args) => {
      options.revealCalls?.push(args);
    },
    webview: {
      options: {},
      html: '',
      cspSource: options.cspSource ?? 'vscode-resource:',
      asWebviewUri: options.asWebviewUri ?? (uri => ({
        ...uri,
        toString: () => `webview://${uri.fsPath ?? uri.path ?? ''}${uri.query ? `?${uri.query}` : ''}`,
      })),
      postMessage: async message => {
        messages.push(message);
        return true;
      },
      onDidReceiveMessage: callback => {
        receiveMessageHandler = callback;
        return { dispose() {} };
      },
    },
    onDidDispose: () => ({ dispose() {} }),
    onDidChangeViewState: () => ({ dispose() {} }),
    fireMessage: message => receiveMessageHandler(message),
  };
}

function createStorageMock(initial = {}) {
  return {
    values: { ...initial },
    get(key, fallback) {
      return Object.prototype.hasOwnProperty.call(this.values, key) ? this.values[key] : fallback;
    },
    async update(key, value) {
      this.values[key] = value;
    },
  };
}

function createOpenDocumentMock(uri = { fsPath: '/vault/notes/Concepts/FlashAttention.md' }) {
  return {
    uri,
    lineCount: 40,
    offsetAt(position) {
      return position.line;
    },
  };
}
