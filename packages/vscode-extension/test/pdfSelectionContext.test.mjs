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
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    mod._compile(outputText, filename);
    return mod.exports;
  } finally {
    Module._load = originalLoad;
  }
}

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
    './navigationHistory': {},
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

test('PDF copy and insert link actions use portable URLs without persistence or highlight refreshes', async () => {
  const clipboard = [];
  const inserted = [];
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
    './navigationHistory': {},
  });

  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' } },
    '/vault',
    { insertMarkdown: async markdown => { inserted.push(markdown); return true; } },
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
  await provider.handleSelectionAction(
    { fsPath: '/vault/raw/pdf/paper.pdf' },
    'insertQuoteAndLink',
    selection,
  );

  const link = '[paper.pdf p.3](raw/pdf/paper.pdf#page=3:~:text=before%20context-,Selected%20text,-after%20context)';
  assert.deepEqual(clipboard, [link]);
  assert.deepEqual(inserted, [`> Selected text\n>\n> ${link}`]);
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

test('direct PDF highlight persists normalized prefix and suffix annotation context', async () => {
  const persistedSelections = [];
  let closeCalls = 0;
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
    },
    window: {
      showInformationMessage: () => undefined,
    },
    Uri: {
      joinPath: (...parts) => ({ parts }),
    },
  };
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': {
      openDatabase: async () => ({ id: 'db' }),
      closeDatabase: () => { closeCalls += 1; },
      runMigrations: () => undefined,
      createPdfAnchorFromSelection: (_db, vaultRoot, sourcePath, selection) => {
        persistedSelections.push({ vaultRoot, sourcePath, selection });
        return { id: 'anc_pdf_context', uri: 'portable-uri' };
      },
      pdfHref: portablePdfHref,
    },
    './navigationHistory': {},
  });

  const provider = new PdfEditorProvider({ extensionUri: { fsPath: '/extension' } }, '/vault');
  await provider.handleSelectionAction(
    { fsPath: '/vault/raw/pdf/paper.pdf', toString: () => 'file:///vault/raw/pdf/paper.pdf' },
    'highlight',
    {
      page: 4,
      prefix: ' before   context ',
      suffix: ' after\ncontext ',
      snippet: ' Selected   text ',
      highlightColor: 'purple',
    },
  );

  assert.equal(closeCalls, 1);
  assert.deepEqual(persistedSelections, [{
    vaultRoot: '/vault',
    sourcePath: 'raw/pdf/paper.pdf',
    selection: {
      quote: 'Selected text',
      page: 4,
      prefix: 'before context',
      suffix: 'after context',
      highlightColor: 'purple',
      createdBy: 'user',
    },
  }]);
});

test('both PDF providers transport page-scoped text fragments without database resolution', async () => {
  const textFragment = {
    textStart: 'Selected text',
    textEnd: 'range end',
    prefix: 'before',
    suffix: 'after',
  };

  for (const relativePath of [
    'src/pdfEditorProvider.ts',
    '../vscode-pdf-extension/src/pdfEditorProvider.ts',
  ]) {
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
      './navigationHistory': {},
    });
    const provider = new PdfEditorProvider({ extensionUri: { fsPath: '/extension' } }, '/vault');
    provider.webviews.set('file:///vault/raw/pdf/paper.pdf', {
      panel: {},
      pdfUri: { fsPath: '/vault/raw/pdf/paper.pdf' },
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

test('standalone PDF provider skips annotation reads and rejects highlights without an initialized vault', async () => {
  const posted = [];
  const clipboard = [];
  const warnings = [];
  const errors = [];
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/workspace/', ''),
      fs: {
        readFile: async () => new Uint8Array([1, 2, 3]),
      },
    },
    commands: {
      executeCommand: async () => undefined,
    },
    env: {
      clipboard: {
        writeText: async text => { clipboard.push(text); },
      },
    },
    window: {
      showWarningMessage: message => { warnings.push(message); },
      showInformationMessage: () => undefined,
      showErrorMessage: message => { errors.push(message); },
    },
    Uri: {
      joinPath: (...parts) => ({ parts }),
    },
  };
  const { PdfEditorProvider } = loadTsModule('../vscode-pdf-extension/src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': {
      openDatabase: () => { throw new Error('database must remain unopened without a vault'); },
      createPdfAnchorFromSelection: () => { throw new Error('highlight must not create an implicit vault'); },
      pdfHref: portablePdfHref,
    },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' } },
    '/workspace',
    undefined,
    false,
  );
  const pdfUri = { fsPath: '/workspace/paper.pdf', toString: () => 'file:///workspace/paper.pdf' };
  const webview = { postMessage: message => { posted.push(message); } };
  provider.webviews.set(pdfUri.toString(), {
    panel: { webview },
    pdfUri,
    postMessage: message => { posted.push(message); },
    selection: {
      page: 1,
      snippet: 'Selected text',
      prefix: 'before',
      suffix: 'after',
    },
  });
  provider.activeKey = pdfUri.toString();

  await provider.loadPdf(webview, pdfUri);
  const context = await provider.getActiveSelectionContext();
  await provider.handleSelectionAction(pdfUri, 'copyLink', {
    page: 1,
    snippet: 'Selected text',
    prefix: 'before',
    suffix: 'after',
  });
  await provider.refreshOpenPdfHighlights(pdfUri);
  await provider.sendReferencesForAnchor(webview, {
    id: 'anc_pdf_internal',
    page: 1,
    snippet: 'Selected text',
  });
  await provider.handleSelectionAction(pdfUri, 'highlight', {
    page: 1,
    snippet: 'Selected text',
  });

  assert.equal(posted[0]?.type, 'loadPdf');
  assert.deepEqual(posted.at(-1), {
    type: 'referencesForAnchor',
    anchor: {
      id: 'anc_pdf_internal',
      page: 1,
      snippet: 'Selected text',
    },
    items: [],
  });
  assert.equal(
    context?.anchorUri,
    'paper.pdf#page=1:~:text=before-,Selected%20text,-after',
  );
  assert.deepEqual(clipboard, [
    '[paper.pdf p.1](paper.pdf#page=1:~:text=before-,Selected%20text,-after)',
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [
    'Human Learning PDF highlights require an initialized Human Learning vault. Run `hl init` first.',
  ]);
});

test('combined PDF provider loads global Ask PDF state outside a vault without opening the anchor database', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'hl-combined-pdf-no-vault-'));
  const pdfPath = join(tempRoot, 'paper.pdf');
  writeFileSync(pdfPath, Buffer.from('%PDF-no-vault', 'utf8'));

  const posted = [];
  const warnings = [];
  const errors = [];
  const discussionRoutes = [];
  let databaseOpenCount = 0;
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
      closeDatabase: () => undefined,
      createPdfAnchorFromSelection: () => {
        throw new Error('highlight must not create an implicit vault');
      },
      openDatabase: () => {
        databaseOpenCount += 1;
        throw new Error('database must remain unopened without a vault');
      },
      pdfHref: portablePdfHref,
      runMigrations: () => undefined,
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
    annotationsEnabled: false,
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
  await provider.refreshOpenPdfHighlights(pdfUri);
  await provider.sendReferencesForAnchor(webview, {
    id: 'anc_pdf_internal',
    page: 1,
    snippet: 'Selected text',
  });
  await provider.handleSelectionAction(pdfUri, 'highlight', {
    page: 1,
    snippet: 'Selected text',
  });

  assert.equal(databaseOpenCount, 0);
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
  assert.deepEqual(posted.at(-1), {
    type: 'referencesForAnchor',
    anchor: {
      id: 'anc_pdf_internal',
      page: 1,
      snippet: 'Selected text',
    },
    items: [],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [
    'Human Learning PDF highlights require an initialized Human Learning vault. Run `hl init` first.',
  ]);
});

test('standalone PDF extension activates from the workspace root and rejects selection export when no vault exists', async () => {
  const providerConstructorCalls = [];
  const customEditorRegistrations = [];
  const commandRegistrations = [];
  const errors = [];
  let addSelectionCalls = 0;
  const vscode = {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    },
    window: {
      createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
      registerCustomEditorProvider: (...args) => {
        customEditorRegistrations.push(args);
        return { dispose() {} };
      },
      showInformationMessage: () => undefined,
      showErrorMessage: message => { errors.push(message); },
    },
    commands: {
      registerCommand: (...args) => {
        commandRegistrations.push(args);
        return { dispose() {} };
      },
    },
  };
  class PdfEditorProvider {
    static viewType = 'human-learning.pdfViewer';
    constructor(...args) {
      providerConstructorCalls.push(args);
    }
  }
  const { activate } = loadTsModule('../vscode-pdf-extension/src/extension.ts', {
    vscode,
    '@human-learning/core': {
      detectVaultRoot: () => undefined,
    },
    './uriDispatcher': { dispatchUri: async () => undefined },
    './pdfEditorProvider': { PdfEditorProvider },
    './agentContext': {
      addSelectionToContext: async () => {
        addSelectionCalls += 1;
        return false;
      },
    },
  });
  const context = { subscriptions: [], extensionUri: { fsPath: '/extension' } };

  activate(context);

  assert.equal(providerConstructorCalls.length, 1);
  assert.equal(providerConstructorCalls[0][0], context);
  assert.deepEqual(providerConstructorCalls[0][1], {
    vaultRoot: undefined,
    documentRoot: '/workspace',
    globalStoragePath: '/extension',
    discussionController: providerConstructorCalls[0][1].discussionController,
    annotationsEnabled: false,
  });
  assert.equal(customEditorRegistrations.length, 1);
  assert.ok(commandRegistrations.some(([name]) => name === 'human-learning.openPdfTarget'));
  assert.ok(!commandRegistrations.some(([name]) => name === 'human-learning.openPdfAtAnchor'));

  const addSelectionCommand = commandRegistrations.find(
    ([name]) => name === 'human-learning.addSelectionToContext',
  )?.[1];
  await addSelectionCommand();

  assert.equal(addSelectionCalls, 0);
  assert.deepEqual(errors, [
    'Human Learning PDF: No vault found. Run `hl init` to create one.',
  ]);
});

test('standalone PDF activation owns a dedicated Codex output channel and passes its logger', () => {
  const outputChannels = [];
  const clientOptions = [];
  let clientDisposeCount = 0;
  const vscode = {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    },
    window: {
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
      showInformationMessage: () => undefined,
      showErrorMessage: () => undefined,
    },
    commands: {
      registerCommand: () => ({ dispose() {} }),
    },
  };
  const { activate, deactivate } = loadTsModule('../vscode-pdf-extension/src/extension.ts', {
    vscode,
    '@human-learning/core': {
      detectVaultRoot: () => '/vault',
    },
    './uriDispatcher': { dispatchUri: async () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'human-learning.pdfViewer';
      },
    },
    './agentContext': { addSelectionToContext: async () => false },
    './codexAppServerClient': {
      CodexAppServerClient: class {
        constructor(options) {
          clientOptions.push(options);
        }
        dispose() {
          clientDisposeCount += 1;
        }
      },
    },
  });

  activate({ subscriptions: [], extension: { packageJSON: { version: '8.7.6-test' } } });

  assert.equal(outputChannels.length, 1);
  assert.equal(outputChannels[0].name, 'Human Learning PDF — Codex');
  assert.equal(clientOptions.length, 1);
  assert.equal(clientOptions[0].extensionVersion, '8.7.6-test');
  assert.equal(typeof clientOptions[0].logger, 'function');
  clientOptions[0].logger('safe standalone diagnostic');
  assert.deepEqual(outputChannels[0].lines, ['safe standalone diagnostic']);

  deactivate();
  assert.equal(clientDisposeCount, 1);
  assert.equal(outputChannels[0].disposeCount, 1);
});

test('PDF editor provider restores persisted highlight colors and rectangle geometry', () => {
  const vscode = {
    workspace: { asRelativePath: uri => uri.fsPath },
    Uri: { joinPath: (...parts) => ({ parts }) },
  };
  const { locatorToWebviewAnchor } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': {},
    './navigationHistory': {},
  });

  const restored = locatorToWebviewAnchor(JSON.stringify({
    page: 4,
    rects: [[12, 34, 156, 278]],
    textItemIndex: 7,
    charOffset: 2,
    endTextItemIndex: 8,
    endCharOffset: 11,
    highlightColor: 'purple',
  }), 'Selected text');

  assert.equal(restored.page, 4);
  assert.deepEqual(restored.rects, [[12, 34, 156, 278]]);
  assert.equal(restored.highlightColor, 'purple');
  assert.equal(restored.snippet, 'Selected text');
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
    './navigationHistory': {},
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
    './navigationHistory': {},
  });

  assert.equal(
    formatPdfPageLink('path/to/file.pdf', 3),
    '[[path/to/file.pdf#page=3|file, p.3]]',
  );
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
