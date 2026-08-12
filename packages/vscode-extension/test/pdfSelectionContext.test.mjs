import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
        createPdfDiscussionStoreForDocument: () => {
          throw new Error('PDF discussion storage is not configured in this legacy provider test');
        },
      };
    }
    if (request === './cursorCrop') return cursorCrop;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    mod._compile(outputText, filename);
    return mod.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const cursorCrop = loadTsModule('src/cursorCrop.ts', {
  './pdfDiscussionController': {
    PDF_DISCUSSION_MAX_PNG_BYTES: 5 * 1024 * 1024,
  },
});

test('PDF editor provider exposes portable database-free agent context with normalized selection context', async () => {
  const pdfHrefCalls = [];
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
    },
    commands: {
      executeCommand: async () => undefined,
    },
    Uri: {
      joinPath: (...parts) => ({ parts }),
    },
  };
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': {
      pdfHref: (sourcePath, options) => {
        pdfHrefCalls.push({ sourcePath, options });
        return portablePdfHref(sourcePath, options);
      },
      openDatabase: () => { throw new Error('agent context must not open the anchor database'); },
      createPdfAnchorFromSelection: () => { throw new Error('agent context must not persist an anchor'); },
    },
  });

  const pdfUri = {
    fsPath: '/vault/raw/papers/attention.pdf',
    toString: () => 'file:///vault/raw/papers/attention.pdf',
  };
  const provider = new PdfEditorProvider({ extensionUri: { fsPath: '/extension' } }, '/vault');
  provider.webviews.set(pdfUri.toString(), {
    panel: {},
    pdfUri,
    postMessage: () => undefined,
  });
  provider.activeKey = pdfUri.toString();
  await provider.updateActiveSelection(pdfUri.toString(), {
    page: 2,
    textItemIndex: 4,
    charOffset: 3,
    endTextItemIndex: 5,
    endCharOffset: 21,
    length: 0,
    highlightColor: 'purple',
    prefix: '  before   context ',
    suffix: ' after\ncontext  ',
    snippet: ' FlashAttention   uses tiling ',
  });

  const context = await provider.getActiveSelectionContext();

  const textFragment = {
    textStart: 'FlashAttention uses tiling',
    prefix: 'before context',
    suffix: 'after context',
  };

  assert.deepEqual(context, {
    uri: pdfUri,
    text: 'FlashAttention uses tiling',
    startLine: 2,
    endLine: 2,
    sourceLabel: 'raw/papers/attention.pdf',
    rangeLabel: 'page 2',
    anchorUri: 'raw/papers/attention.pdf#page=2:~:text=before%20context-,FlashAttention%20uses%20tiling,-after%20context',
    metadata: {
      kind: 'pdf',
      page: 2,
      textFragment,
    },
  });
  assert.deepEqual(pdfHrefCalls, [{
    sourcePath: 'raw/papers/attention.pdf',
    options: {
      page: 2,
      textFragment,
    },
  }]);
});

test('PDF Cursor handoff routes exact selection and an optional validated crop through one command', async () => {
  const commands = [];
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
    },
    commands: {
      executeCommand: async (...args) => { commands.push(args); },
    },
    Uri: {
      joinPath: (...parts) => ({ parts }),
    },
  };
  const {
    ADD_SELECTION_TO_CURSOR_CHAT_COMMAND,
    PdfEditorProvider,
  } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' } },
    '/vault',
  );
  const pdfUri = { fsPath: '/vault/raw/pdf/paper.pdf' };
  const anchor = {
    page: 3,
    textItemIndex: 4,
    charOffset: 2,
    endTextItemIndex: 5,
    endCharOffset: 8,
    rects: [[12, 24, 180, 40]],
    prefix: 'before context',
    suffix: 'after context',
    snippet: 'Selected PDF passage',
  };
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );

  await provider.handleSelectionAction(
    pdfUri,
    'addToCursorChat',
    anchor,
    png.toString('base64'),
  );
  await provider.handleSelectionAction(
    pdfUri,
    'addToCursorChat',
    anchor,
    'not canonical base64',
  );

  const selection = {
    uri: pdfUri,
    text: 'Selected PDF passage',
    startLine: 3,
    endLine: 3,
    sourceLabel: 'raw/pdf/paper.pdf',
    rangeLabel: 'page 3',
    anchorUri: 'raw/pdf/paper.pdf#page=3:~:text=before%20context-,Selected%20PDF%20passage,-after%20context',
    metadata: {
      kind: 'pdf',
      page: 3,
      textFragment: {
        textStart: 'Selected PDF passage',
        prefix: 'before context',
        suffix: 'after context',
      },
    },
  };
  assert.equal(ADD_SELECTION_TO_CURSOR_CHAT_COMMAND, 'human-learning.addSelectionToCursorChat');
  assert.equal(commands.length, 2);
  assert.equal(commands[0][0], ADD_SELECTION_TO_CURSOR_CHAT_COMMAND);
  assert.deepEqual(commands[0][1].selection, selection);
  assert.deepEqual(Buffer.from(commands[0][1].snapshotPng), png);
  assert.deepEqual(commands[1], [
    ADD_SELECTION_TO_CURSOR_CHAT_COMMAND,
    { selection },
  ]);
});

test('PDF explicit agent handoff routes normalized selection and validated crop only for known agents', async () => {
  const commands = [];
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
    },
    commands: {
      executeCommand: async (...args) => { commands.push(args); },
    },
    Uri: {
      joinPath: (...parts) => ({ parts }),
    },
  };
  const {
    ADD_SELECTION_TO_AGENT_COMMAND,
    PdfEditorProvider,
  } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' } },
    '/vault',
  );
  const pdfUri = { fsPath: '/vault/raw/pdf/paper.pdf' };
  const anchor = {
    page: 3,
    prefix: 'before context',
    suffix: 'after context',
    snippet: ' Selected   PDF passage ',
  };
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );

  await provider.handleSelectionAction(
    pdfUri,
    'sendToAgent',
    anchor,
    png.toString('base64'),
    'codex',
  );
  await provider.handleSelectionAction(
    pdfUri,
    'sendToAgent',
    anchor,
    png.toString('base64'),
    'unknown',
  );

  assert.equal(ADD_SELECTION_TO_AGENT_COMMAND, 'human-learning.addSelectionToAgent');
  assert.equal(commands.length, 1);
  assert.equal(commands[0][0], ADD_SELECTION_TO_AGENT_COMMAND);
  assert.equal(commands[0][1].agentId, 'codex');
  assert.equal(commands[0][1].selection.text, 'Selected PDF passage');
  assert.deepEqual(Buffer.from(commands[0][1].snapshotPng), png);
});

test('combined PDF context keys clear on deactivation and restore with its selection', async () => {
  const commands = [];
  let onDidChangeViewState;
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
    },
    commands: {
      executeCommand: async (...args) => { commands.push(args); },
    },
    Uri: {
      joinPath: () => ({ toString: () => 'vscode-resource' }),
    },
  };
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' }, subscriptions: [] },
    '/vault',
  );
  const pdfUri = {
    fsPath: '/vault/raw/pdf/paper.pdf',
    toString: () => 'file:///vault/raw/pdf/paper.pdf',
  };
  const webview = {
    cspSource: 'vscode-webview:',
    asWebviewUri: uri => uri,
    onDidReceiveMessage: () => ({ dispose() {} }),
    postMessage: async () => true,
  };
  const panel = {
    active: true,
    webview,
    onDidChangeViewState(listener) {
      onDidChangeViewState = listener;
      return { dispose() {} };
    },
    onDidDispose: () => ({ dispose() {} }),
  };
  await provider.resolveCustomEditor({ uri: pdfUri }, panel, {});
  await provider.updateActiveSelection(pdfUri.toString(), {
    page: 4,
    snippet: 'Selected text',
  });

  commands.length = 0;
  panel.active = false;
  await onDidChangeViewState();

  assert.equal(provider.getActiveWebview(), undefined);
  assert.deepEqual(commands, [
    ['setContext', 'humanLearningPdfOpen', false],
    ['setContext', 'humanLearningPdfHasSelection', false],
  ]);

  commands.length = 0;
  panel.active = true;
  await onDidChangeViewState();

  assert.equal(provider.getActiveWebview()?.pdfUri, pdfUri);
  assert.deepEqual(commands, [
    ['setContext', 'humanLearningPdfOpen', true],
    ['setContext', 'humanLearningPdfHasSelection', true],
  ]);
});

test('PDF provider falls back to one visible PDF without guessing between visible panels', () => {
  const vscode = {
    commands: {
      executeCommand: async () => undefined,
    },
    Uri: {
      joinPath: (...parts) => ({ parts }),
    },
  };
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' }, subscriptions: [] },
    '/vault',
  );
  const firstUri = {
    fsPath: '/vault/raw/pdf/first.pdf',
    toString: () => 'file:///vault/raw/pdf/first.pdf',
  };
  const secondUri = {
    fsPath: '/vault/raw/pdf/second.pdf',
    toString: () => 'file:///vault/raw/pdf/second.pdf',
  };
  provider.webviews.set(firstUri.toString(), {
    panel: { visible: true },
    pdfUri: firstUri,
    postMessage: () => undefined,
  });

  assert.equal(provider.getActivePdfUri(), firstUri);

  provider.webviews.set(secondUri.toString(), {
    panel: { visible: true },
    pdfUri: secondUri,
    postMessage: () => undefined,
  });
  assert.equal(provider.getActivePdfUri(), undefined);

  provider.activeKey = secondUri.toString();
  assert.equal(provider.getActivePdfUri(), secondUri);
});

test('PDF copy link action uses a portable URL without persistence or highlight refreshes', async () => {
  const clipboard = [];
  const pdfHrefCalls = [];
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
    },
    env: {
      clipboard: {
        writeText: async text => { clipboard.push(text); },
      },
    },
    window: {
      visibleTextEditors: [],
      showInformationMessage: () => undefined,
      showWarningMessage: () => undefined,
    },
    Uri: {
      joinPath: (...parts) => ({ parts }),
    },
  };
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': {
      pdfHref: (sourcePath, options) => {
        pdfHrefCalls.push({ sourcePath, options });
        return portablePdfHref(sourcePath, options);
      },
      openDatabase: () => { throw new Error('link actions must not open the anchor database'); },
      createPdfAnchorFromSelection: () => { throw new Error('link actions must not persist an anchor'); },
    },
  });

  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' } },
    '/vault',
  );
  provider.refreshOpenPdfHighlights = async () => {
    throw new Error('non-highlight actions must not refresh persisted highlights');
  };
  const selection = {
    page: 3,
    prefix: ' before   context ',
    suffix: ' after context ',
    snippet: ' Selected   text ',
  };

  await provider.handleSelectionAction(
    { fsPath: '/vault/raw/pdf/paper.pdf' },
    'copyLink',
    selection,
  );
  const link = '[paper.pdf p.3](raw/pdf/paper.pdf#page=3:~:text=before%20context-,Selected%20text,-after%20context)';
  assert.deepEqual(clipboard, [link]);
  assert.deepEqual(pdfHrefCalls, [
    {
      sourcePath: 'raw/pdf/paper.pdf',
      options: {
        page: 3,
        textFragment: {
          textStart: 'Selected text',
          prefix: 'before context',
          suffix: 'after context',
        },
      },
    },
  ]);
});

test('removed selection actions are rejected without clipboard or command side effects', async () => {
  const clipboardWrites = [];
  const commandCalls = [];
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
    },
    env: {
      clipboard: {
        writeText: async text => { clipboardWrites.push(text); },
      },
    },
    commands: {
      executeCommand: async (...args) => { commandCalls.push(args); },
    },
    window: {
      visibleTextEditors: [],
      showInformationMessage: () => undefined,
      showWarningMessage: () => undefined,
    },
    Uri: {
      joinPath: (...parts) => ({ parts }),
    },
  };
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': {
      pdfHref: portablePdfHref,
    },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' } },
    { documentRoot: '/vault' },
  );
  const pdfUri = { fsPath: '/vault/raw/pdf/paper.pdf' };
  const selection = {
    page: 3,
    snippet: 'Selected text',
  };

  for (const action of ['insertLink', 'copyQuoteAndLink', 'insertQuoteAndLink']) {
    await provider.handleSelectionAction(pdfUri, action, selection);
  }

  assert.deepEqual(clipboardWrites, []);
  assert.deepEqual(commandCalls, []);
});

test('PDF provider transports page-scoped text fragments without database resolution', async () => {
  const textFragment = {
    textStart: 'Selected text',
    textEnd: 'range end',
    prefix: 'before',
    suffix: 'after',
  };

  for (const relativePath of ['src/pdfEditorProvider.ts']) {
    const commandCalls = [];
    const posted = [];
    const vscode = {
      workspace: {
        asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
      },
      commands: {
        executeCommand: async (...args) => { commandCalls.push(args); },
      },
      Uri: {
        file: fsPath => ({ fsPath, toString: () => `file://${fsPath}` }),
        joinPath: (...parts) => ({ parts }),
      },
    };
    const { PdfEditorProvider } = loadTsModule(relativePath, {
      vscode,
      '@human-learning/core': {
        openDatabase: () => { throw new Error('portable navigation must not open the database'); },
        pdfHref: portablePdfHref,
      },
    });
    const provider = new PdfEditorProvider({ extensionUri: { fsPath: '/extension' } }, '/vault');
    provider.webviews.set('file:///vault/raw/pdf/paper.pdf', {
      panel: {},
      pdfUri: { fsPath: '/vault/raw/pdf/paper.pdf' },
      ready: true,
      postMessage: message => { posted.push(message); },
    });

    await provider.openPdfAtTarget('raw/pdf/paper.pdf', 7, textFragment);

    assert.equal(commandCalls.length, 1);
    assert.equal(commandCalls[0][0], 'vscode.openWith');
    assert.equal(commandCalls[0][1].fsPath, '/vault/raw/pdf/paper.pdf');
    assert.equal(commandCalls[0][2], 'human-learning.pdfViewer');
    assert.deepEqual(posted, [{
      type: 'goToAnchor',
      anchor: { page: 7, textFragment },
    }]);
  }
});

test('PDF provider preserves encoded path text and rejects literal traversal', async () => {
  const commandCalls = [];
  const errors = [];
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
    },
    window: {
      showErrorMessage: message => {
        errors.push(message);
      },
    },
    commands: {
      executeCommand: async (...args) => {
        commandCalls.push(args);
      },
    },
    Uri: {
      file: fsPath => ({ fsPath, toString: () => `file://${fsPath}` }),
      joinPath: (...parts) => ({ parts }),
    },
  };
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider({ extensionUri: { fsPath: '/extension' } }, '/vault');
  provider.webviews.set('file:///vault/%2e%2e/secret.pdf', {
    panel: {},
    pdfUri: { fsPath: '/vault/%2e%2e/secret.pdf' },
    ready: true,
    postMessage: () => undefined,
  });

  await provider.openPdfAtTarget('%2e%2e/secret.pdf');
  await provider.openPdfAtTarget('../secret.pdf');

  assert.equal(commandCalls.length, 1);
  assert.equal(commandCalls[0][0], 'vscode.openWith');
  assert.equal(commandCalls[0][1].fsPath, '/vault/%2e%2e/secret.pdf');
  assert.equal(commandCalls[0][2], 'human-learning.pdfViewer');
  assert.deepEqual(errors, [
    'Cannot open PDF outside the document root: ../secret.pdf',
  ]);
});

test('PDF provider queues anchor navigation until a newly opened webview is ready', async () => {
  const posted = [];
  const commandCalls = [];
  let receiveMessage;
  const pdfUri = {
    scheme: 'file',
    fsPath: '/vault/raw/pdf/paper.pdf',
    toString: () => 'file:///vault/raw/pdf/paper.pdf',
  };
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
      fs: {
        readFile: async () => Uint8Array.from([1, 2, 3]),
      },
    },
    window: {
      showErrorMessage: message => assert.fail(message),
    },
    commands: {
      executeCommand: async (...args) => {
        commandCalls.push(args);
      },
    },
    Uri: {
      file: () => pdfUri,
      joinPath: (...parts) => ({ parts, toString: () => 'vscode-resource' }),
    },
  };
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' }, subscriptions: [] },
    '/vault',
  );
  const webview = {
    options: {},
    cspSource: 'vscode-webview:',
    asWebviewUri: uri => uri,
    onDidReceiveMessage: listener => {
      receiveMessage = listener;
      return { dispose() {} };
    },
    postMessage: async message => {
      posted.push(message);
      return true;
    },
  };
  const panel = {
    active: true,
    webview,
    onDidChangeViewState: () => ({ dispose() {} }),
    onDidDispose: () => ({ dispose() {} }),
  };
  await provider.resolveCustomEditor({ uri: pdfUri }, panel, {});

  const textFragment = { textStart: 'Selected text' };
  await provider.openPdfAtTarget('raw/pdf/paper.pdf', 7, textFragment);
  assert.equal(
    posted.some(message => message.type === 'goToAnchor'),
    false,
    'navigation must wait for the webview message listener',
  );

  await receiveMessage({ type: 'ready' });

  assert.deepEqual(
    posted.map(message => message.type),
    ['agentHandoffCapabilities', 'loadPdf', 'goToAnchor'],
  );
  assert.deepEqual(posted[2], {
    type: 'goToAnchor',
    anchor: { page: 7, textFragment },
  });
  assert.deepEqual(commandCalls.at(-1), [
    'vscode.openWith',
    pdfUri,
    'human-learning.pdfViewer',
  ]);
});

test('agent handoff capabilities precede PDF loading and refresh across live webviews', async () => {
  const firstPosted = [];
  const secondPosted = [];
  let receiveMessage;
  let fireCapabilityChange;
  const pdfUri = {
    scheme: 'file',
    fsPath: '/vault/raw/pdf/paper.pdf',
    toString: () => 'file:///vault/raw/pdf/paper.pdf',
  };
  const capabilities = {
    cursorAgent: true,
    providers: [{ id: 'codex', label: 'Codex' }],
  };
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
      fs: {
        readFile: async () => Uint8Array.from([1, 2, 3]),
      },
    },
    window: {
      showErrorMessage: message => assert.fail(message),
    },
    commands: {
      executeCommand: async () => undefined,
    },
    Uri: {
      joinPath: (...parts) => ({ parts, toString: () => 'vscode-resource' }),
    },
  };
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': { pdfHref: portablePdfHref },
  });
  const context = { extensionUri: { fsPath: '/extension' }, subscriptions: [] };
  const provider = new PdfEditorProvider(context, {
    documentRoot: '/vault',
    agentCapabilities: () => capabilities,
    onDidChangeAgentCapabilities: listener => {
      fireCapabilityChange = listener;
      return { dispose() {} };
    },
  });
  const webview = {
    options: {},
    cspSource: 'vscode-webview:',
    asWebviewUri: uri => uri,
    onDidReceiveMessage: listener => {
      receiveMessage = listener;
      return { dispose() {} };
    },
    postMessage: async message => {
      firstPosted.push(message);
      return true;
    },
  };
  const panel = {
    active: true,
    webview,
    onDidChangeViewState: () => ({ dispose() {} }),
    onDidDispose: () => ({ dispose() {} }),
  };
  await provider.resolveCustomEditor({ uri: pdfUri }, panel, {});
  provider.webviews.set('file:///vault/raw/pdf/second.pdf', {
    panel: { webview: { postMessage: async message => secondPosted.push(message) } },
    pdfUri: { fsPath: '/vault/raw/pdf/second.pdf' },
    ready: false,
    postMessage: message => secondPosted.push(message),
  });

  await receiveMessage({ type: 'ready' });

  assert.deepEqual(firstPosted.slice(0, 2).map(message => message.type), [
    'agentHandoffCapabilities',
    'loadPdf',
  ]);
  assert.deepEqual(firstPosted[0], {
    type: 'agentHandoffCapabilities',
    cursorAgent: true,
    providers: [{ id: 'codex', label: 'Codex' }],
  });

  firstPosted.length = 0;
  fireCapabilityChange();
  assert.deepEqual(firstPosted, [{
    type: 'agentHandoffCapabilities',
    cursorAgent: true,
    providers: [{ id: 'codex', label: 'Codex' }],
  }]);
  assert.deepEqual(secondPosted, [{
    type: 'agentHandoffCapabilities',
    cursorAgent: true,
    providers: [{ id: 'codex', label: 'Codex' }],
  }]);
  assert.equal(context.subscriptions.length, 1);
});

test('PDF provider does not schedule delayed loads that can outlive disposed webviews', async () => {
  let disposePanel;
  const pdfUri = {
    scheme: 'file',
    fsPath: '/vault/raw/pdf/paper.pdf',
    toString: () => 'file:///vault/raw/pdf/paper.pdf',
  };
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
      fs: {
        readFile: async () => assert.fail('disposed delayed load must not read the PDF'),
      },
    },
    window: {
      showErrorMessage: message => assert.fail(message),
    },
    commands: {
      executeCommand: async () => undefined,
    },
    Uri: {
      joinPath: (...parts) => ({ parts, toString: () => 'vscode-resource' }),
    },
  };
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' }, subscriptions: [] },
    '/vault',
  );
  const panel = {
    active: true,
    webview: {
      options: {},
      cspSource: 'vscode-webview:',
      asWebviewUri: uri => uri,
      onDidReceiveMessage: () => ({ dispose() {} }),
      postMessage: async () => true,
    },
    onDidChangeViewState: () => ({ dispose() {} }),
    onDidDispose: listener => {
      disposePanel = listener;
      return { dispose() {} };
    },
  };
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => assert.fail('PDF loading must wait for the webview ready handshake');
  try {
    await provider.resolveCustomEditor({ uri: pdfUri }, panel, {});
    await disposePanel();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('combined PDF provider loads global Ask PDF state outside a vault', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'hl-combined-pdf-no-vault-'));
  const pdfPath = join(tempRoot, 'paper.pdf');
  writeFileSync(pdfPath, Buffer.from('%PDF-no-vault', 'utf8'));

  const posted = [];
  const warnings = [];
  const errors = [];
  const discussionRoutes = [];
  const fakeStore = { pdfPath };
  const annotation = {
    id: 'ann-global-1',
    kind: 'agent_discussion',
    selectionKey: 'selection-global-1',
    anchor: {
      uri: `file://${pdfPath}`,
      page: 1,
      quote: 'Selected text',
      rects: [[1, 2, 3, 4]],
      portableUrl: 'paper.pdf#page=1:~:text=Selected%20text',
    },
    messages: [],
    lastTurn: { status: 'idle' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const discussionController = {
    onEvent: () => ({ dispose() {} }),
    list(store) {
      assert.equal(store, fakeStore);
      return [annotation];
    },
  };
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace(`${tempRoot}/`, ''),
      fs: {
        readFile: async () => new Uint8Array([1, 2, 3]),
      },
    },
    commands: {
      executeCommand: async () => undefined,
    },
    env: {
      clipboard: { writeText: async () => undefined },
    },
    window: {
      visibleTextEditors: [],
      showWarningMessage: message => { warnings.push(message); },
      showInformationMessage: () => undefined,
      showErrorMessage: message => { errors.push(message); },
    },
    Uri: {
      joinPath: (...parts) => ({ parts }),
    },
  };
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': {
      pdfHref: portablePdfHref,
    },
    './pdfDiscussionController': {
      createPdfDiscussionStoreForDocument(options) {
        discussionRoutes.push(options);
        return { store: fakeStore, layout: 'global' };
      },
    },
  });
  const context = {
    extensionUri: { fsPath: '/extension' },
    subscriptions: [],
    globalState: {
      get: () => false,
      update: async () => undefined,
    },
  };
  const provider = new PdfEditorProvider(context, {
    documentRoot: tempRoot,
    globalStoragePath: join(tempRoot, 'global-storage'),
    discussionController,
  });
  const pdfUri = {
    scheme: 'file',
    fsPath: pdfPath,
    toString: () => `file://${pdfPath}`,
  };
  const webview = {
    postMessage: async message => {
      posted.push(message);
      return true;
    },
  };
  provider.webviews.set(pdfUri.toString(), {
    panel: { webview },
    pdfUri,
    postMessage: message => webview.postMessage(message),
  });
  provider.activeKey = pdfUri.toString();

  await provider.loadPdf(webview, pdfUri);

  assert.equal(discussionRoutes.length, 1);
  assert.equal(discussionRoutes[0].vaultRoot, undefined);
  assert.equal(discussionRoutes[0].globalStoragePath, join(tempRoot, 'global-storage'));
  assert.ok(posted.some(message => message.type === 'loadPdf'));
  assert.ok(posted.some(message => (
    message.type === 'pdfDiscussionSnapshot'
    && message.annotations[0]?.id === 'ann-global-1'
  )));
  assert.ok(posted.some(message => (
    message.type === 'pdfDiscussionHighlights'
    && message.highlights[0]?.annotationId === 'ann-global-1'
  )));
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('PDF rectangle selection copies the exact PDF++ embed-link shape without persisting a text anchor', async () => {
  const clipboard = [];
  const messages = [];
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
    },
    env: {
      clipboard: {
        writeText: async text => { clipboard.push(text); },
      },
    },
    window: {
      showInformationMessage: message => { messages.push(message); },
    },
    Uri: {
      joinPath: (...parts) => ({ parts }),
    },
  };
  const { PdfEditorProvider, formatPdfRectangleEmbed } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': {
      openDatabase: () => { throw new Error('rectangle copy must not open the anchor database'); },
    },
  });

  const relPath = 'Topics/AI/LLM/cs336/Resources/lectures/lecture_03.pdf';
  assert.equal(
    formatPdfRectangleEmbed(relPath, 1, [155, 149, 323, 267]),
    '![[Topics/AI/LLM/cs336/Resources/lectures/lecture_03.pdf#page=1&rect=155,149,323,267|lecture_03, p.1]]',
  );

  const provider = new PdfEditorProvider({ extensionUri: { fsPath: '/extension' } }, '/vault');
  await provider.handleSelectionAction(
    { fsPath: `/vault/${relPath}` },
    'copyRectEmbed',
    { page: 1, rects: [[155, 149, 323, 267]], snippet: '' },
  );

  assert.deepEqual(clipboard, [
    '![[Topics/AI/LLM/cs336/Resources/lectures/lecture_03.pdf#page=1&rect=155,149,323,267|lecture_03, p.1]]',
  ]);
  assert.deepEqual(messages, ['Human Learning PDF rectangular embed link copied']);
});

test('PDF page links use the exact PDF++ wikilink shape', () => {
  const vscode = {
    workspace: { asRelativePath: uri => uri.fsPath },
    Uri: { joinPath: (...parts) => ({ parts }) },
  };
  const { formatPdfPageLink } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': {},
  });

  assert.equal(
    formatPdfPageLink('path/to/file.pdf', 3),
    '[[path/to/file.pdf#page=3|file, p.3]]',
  );
});

test('PDF outline payloads are bounded, normalized, and reveal the exact destination', async () => {
  const posted = [];
  const revealCalls = [];
  const vscode = {
    commands: {
      executeCommand: async () => undefined,
    },
    Uri: {
      joinPath: (...parts) => ({ parts }),
    },
  };
  const {
    PdfEditorProvider,
    normalizePdfOutlineEntries,
  } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': {},
  });
  const entries = normalizePdfOutlineEntries([{
    title: '  Section   12.2  ',
    destination: {
      pageIndex: 157,
      zoom: { mode: 3 },
      view: [462],
    },
    children: [{
      title: '12.2.4.1 Light Transport',
      destination: {
        pageIndex: 164,
        zoom: {
          mode: 1,
          params: { x: 72, y: 512, zoom: 0 },
        },
        view: [72, 512, 0],
      },
      children: [],
    }],
  }, {
    title: 'Invalid destination remains a visible group',
    destination: {
      pageIndex: -1,
      zoom: { mode: 99 },
      view: [],
    },
    children: [],
  }]);

  assert.equal(entries[0].title, 'Section 12.2');
  assert.equal(entries[0].destination.pageIndex, 157);
  assert.equal(entries[0].children[0].destination.zoom.params.y, 512);
  assert.equal(entries[1].destination, undefined);

  const uri = {
    fsPath: '/vault/rendering.pdf',
    toString: () => 'file:///vault/rendering.pdf',
  };
  const provider = new PdfEditorProvider({ extensionUri: { fsPath: '/extension' } }, '/vault');
  provider.webviews.set(uri.toString(), {
    panel: {
      reveal: (...args) => revealCalls.push(args),
    },
    pdfUri: uri,
    outline: entries,
    postMessage: message => posted.push(message),
  });

  assert.equal(
    await provider.revealPdfOutlineDestination(
      uri,
      entries[0].children[0].destination,
      entries[0].children[0].title,
    ),
    true,
  );
  assert.deepEqual(revealCalls, [[undefined, true]]);
  assert.deepEqual(posted, [{
    type: 'goToPdfDestination',
    destination: {
      pageIndex: 164,
      zoom: {
        mode: 1,
        params: { x: 72, y: 512, zoom: 0 },
      },
      view: [72, 512, 0],
    },
    title: '12.2.4.1 Light Transport',
  }]);
  assert.equal(
    await provider.revealPdfOutlineDestination(uri, {
      pageIndex: Number.NaN,
      zoom: { mode: 3 },
      view: [],
    }),
    false,
  );
  assert.equal(provider.getPdfOutline(uri), entries);
});

function portablePdfHref(sourcePath, { page, textFragment } = {}) {
  const pageDirective = page ? `page=${page}` : '';
  if (!textFragment?.textStart) {
    return `${sourcePath}${pageDirective ? `#${pageDirective}` : ''}`;
  }
  const prefix = textFragment.prefix ? `${encodeURIComponent(textFragment.prefix)}-,` : '';
  const end = textFragment.textEnd ? `,${encodeURIComponent(textFragment.textEnd)}` : '';
  const suffix = textFragment.suffix ? `,-${encodeURIComponent(textFragment.suffix)}` : '';
  return `${sourcePath}#${pageDirective}:~:text=${prefix}${encodeURIComponent(textFragment.textStart)}${end}${suffix}`;
}
