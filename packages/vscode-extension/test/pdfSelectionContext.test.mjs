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
    if (request === '@llm-wiki/core' && Object.prototype.hasOwnProperty.call(mocks, request)) {
      return {
        ...mocks[request],
        pdfWebviewToHostMessage: value => (
          value && typeof value === 'object' && typeof value.type === 'string'
            ? value
            : undefined
        ),
      };
    }
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    if (request === './pdfPngConstraints') return { MAX_PNG_BYTES: 5 * 1024 * 1024 };
    if (request === './agentClipboard') return agentClipboard;
    if (request === './queryAnnotationIndex') {
      return mocks['./queryAnnotationIndex'] ?? {
        isQueryPagePath: path => typeof path === 'string' && path.includes('queries/'),
        resolvePdfAnchor: (anchor) => ({ geometry: { page: anchor.page, rects: anchor.rects } }),
      };
    }
    if (request === './editorHost') return loadTsModule('src/editorHost.ts', mocks);
    if (request === './pdfWebviewHtml') return loadTsModule('src/pdfWebviewHtml.ts', mocks);
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
  './pdfPngConstraints': { MAX_PNG_BYTES: 5 * 1024 * 1024 },
});

const agentClipboard = loadTsModule('src/agentClipboard.ts', {
  './anchorUris': {
    llmWikiOpenAnchorUri: target =>
      `cursor://llm-wiki/open-anchor?target=${encodeURIComponent(target)}`,
  },
});

test('PDF provider correlates multi-page clipboard context to exact selection geometry', async () => {
  const posted = [];
  const clipboardWrites = [];
  const contextCommands = [];
  let receiveMessage;
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
    },
    commands: {
      executeCommand: async (...args) => { contextCommands.push(args); },
    },
    env: {
      clipboard: {
        writeText: async text => { clipboardWrites.push(text); },
      },
    },
    Uri: {
      joinPath: (...parts) => ({ parts, toString: () => 'vscode-resource' }),
    },
  };
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@llm-wiki/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' }, subscriptions: [] },
  );
  const pdfUri = {
    scheme: 'file',
    fsPath: '/vault/raw/pdf/paper.pdf',
    toString: () => 'file:///vault/raw/pdf/paper.pdf',
  };
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
  await provider.resolveCustomEditor(
    { uri: pdfUri },
    {
      active: true,
      webview,
      onDidChangeViewState: () => ({ dispose() {} }),
      onDidDispose: () => ({ dispose() {} }),
    },
    {},
  );
  provider.webviews.get(pdfUri.toString()).pdfSha256 =
    '29d1283686193dc1461a7deac4f53d9bc5402a28b95d854f69e94986756fd0a9';
  const firstSelection = {
    kind: 'text',
    startPage: 2,
    endPage: 4,
    pages: [
      { page: 2, rects: [[10, 20, 110, 36]] },
      { page: 3, rects: [[12, 18, 140, 34]] },
      { page: 4, rects: [[8, 16, 96, 32]] },
    ],
    selectedText: 'complete normalized text across all pages',
  };

  await receiveMessage({
    type: 'selectionChanged',
    anchor: {
      page: 2,
      multiPage: true,
      snippet: 'partial text without the delayed middle page',
      rects: firstSelection.pages[0].rects,
    },
  });

  assert.deepEqual(posted, [{ type: 'agentClipboardContext' }]);
  assert.equal(provider.webviews.get(pdfUri.toString()).agentClipboardContext, undefined);

  await receiveMessage({
    type: 'selectionChanged',
    anchor: {
      page: 2,
      multiPage: true,
      snippet: firstSelection.selectedText,
      rects: firstSelection.pages[0].rects,
    },
    clipboardSelection: firstSelection,
  });

  const firstKey = agentClipboard.pdfAgentClipboardSelectionKey(firstSelection);
  const firstContextMessage = posted.at(-1);
  assert.equal(firstContextMessage.type, 'agentClipboardContext');
  assert.ok(firstContextMessage.context);
  assert.equal(firstContextMessage.context.selectionKey, firstKey);
  assert.equal(firstContextMessage.context.sourceLabel, 'raw/pdf/paper.pdf (pages 2–4)');
  assert.equal(
    firstContextMessage.context.selectedText,
    'complete normalized text across all pages',
  );
  assert.match(
    firstContextMessage.context.sourceHref,
    /^raw\/pdf\/paper\.pdf#page=2&viewrect=/,
  );
  assert.match(
    firstContextMessage.context.plainText,
    /PDF source SHA-256: `29d1283686193dc1461a7deac4f53d9bc5402a28b95d854f69e94986756fd0a9`/,
  );
  assert.deepEqual(contextCommands.slice(-2), [
    ['setContext', 'llmWikiPdfHasSelection', false],
    ['setContext', 'llmWikiPdfHasAgentClipboardSelection', true],
  ]);

  const nextSelection = {
    ...firstSelection,
    pages: [
      firstSelection.pages[0],
      firstSelection.pages[1],
      { page: 4, rects: [[30, 40, 130, 56]] },
    ],
  };
  await receiveMessage({
    type: 'selectionChanged',
    anchor: {
      page: 2,
      multiPage: true,
      snippet: nextSelection.selectedText,
      rects: nextSelection.pages[0].rects,
    },
    clipboardSelection: nextSelection,
  });

  const nextKey = agentClipboard.pdfAgentClipboardSelectionKey(nextSelection);
  const updatedClipboardMessages = posted.filter(message => message.type === 'agentClipboardContext');
  assert.equal(updatedClipboardMessages.length, 3);
  assert.equal(updatedClipboardMessages[2].context.selectionKey, nextKey);
  assert.equal(provider.webviews.get(pdfUri.toString()).agentClipboardContext.selectionKey, nextKey);
  assert.notEqual(provider.webviews.get(pdfUri.toString()).agentClipboardContext.selectionKey, firstKey);
  assert.deepEqual(clipboardWrites, []);
});

test('PDF copy intent uses only the current host-precomputed clipboard text', async () => {
  const posted = [];
  const clipboardWrites = [];
  const informationMessages = [];
  const warningMessages = [];
  let receiveMessage;
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
    },
    commands: {
      executeCommand: async () => undefined,
    },
    env: {
      clipboard: {
        writeText: async text => { clipboardWrites.push(text); },
      },
    },
    window: {
      showInformationMessage: message => { informationMessages.push(message); },
      showWarningMessage: message => { warningMessages.push(message); },
    },
    Uri: {
      joinPath: (...parts) => ({ parts, toString: () => 'vscode-resource' }),
    },
  };
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@llm-wiki/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' }, subscriptions: [] },
  );
  const pdfUri = {
    scheme: 'file',
    fsPath: '/vault/raw/pdf/paper.pdf',
    toString: () => 'file:///vault/raw/pdf/paper.pdf',
  };
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
  await provider.resolveCustomEditor(
    { uri: pdfUri },
    {
      active: true,
      webview,
      onDidChangeViewState: () => ({ dispose() {} }),
      onDidDispose: () => ({ dispose() {} }),
    },
    {},
  );
  provider.webviews.get(pdfUri.toString()).pdfSha256 = 'd'.repeat(64);

  const firstSelection = {
    kind: 'text',
    startPage: 2,
    endPage: 2,
    pages: [{ page: 2, rects: [[10, 20, 110, 36]] }],
    selectedText: 'first selected passage',
  };
  await receiveMessage({
    type: 'selectionChanged',
    anchor: {
      page: 2,
      snippet: firstSelection.selectedText,
      rects: firstSelection.pages[0].rects,
    },
    clipboardSelection: firstSelection,
  });
  const currentSelection = {
    kind: 'text',
    startPage: 2,
    endPage: 2,
    pages: [{ page: 2, rects: [[30, 40, 130, 56]] }],
    selectedText: 'current selected passage',
  };
  await receiveMessage({
    type: 'selectionChanged',
    anchor: {
      page: 2,
      snippet: currentSelection.selectedText,
      rects: currentSelection.pages[0].rects,
    },
    clipboardSelection: currentSelection,
  });
  const currentContext = posted.at(-1).context;

  await receiveMessage({
    type: 'copySelectionForAgent',
    plainText: 'attacker-controlled text is ignored',
    html: '<img src=x onerror=alert(1)>',
    pngBytes: [1, 2, 3],
  });

  assert.deepEqual(clipboardWrites, [currentContext.plainText]);
  assert.deepEqual(warningMessages, []);
  assert.deepEqual(informationMessages, ['Selection copied for agent.']);
});

test('PDF clipboard copies only portable text and never persists a selection screenshot', async () => {
  const posted = [];
  const clipboardWrites = [];
  const informationMessages = [];
  const warningMessages = [];
  const persistCalls = [];
  let receiveMessage;
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
    },
    commands: {
      executeCommand: async () => undefined,
    },
    env: {
      clipboard: {
        writeText: async text => { clipboardWrites.push(text); },
      },
    },
    window: {
      showInformationMessage: message => { informationMessages.push(message); },
      showWarningMessage: message => { warningMessages.push(message); },
    },
    Uri: {
      joinPath: (...parts) => ({ parts, toString: () => 'vscode-resource' }),
    },
  };
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@llm-wiki/core': { pdfHref: portablePdfHref },
    './cursorCrop': {
      decodeCursorCropPngBase64: value =>
        value === 'canonical-png' ? Uint8Array.from([1, 2, 3]) : undefined,
    },
    './pdfAgentClipboardImage': {
      persistPdfAgentClipboardImage: input => {
        persistCalls.push(input);
        throw new Error(`must not persist ${input.selectionKey}`);
      },
    },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' }, subscriptions: [] },
  );
  const pdfUri = {
    scheme: 'file',
    fsPath: '/vault/raw/pdf/paper.pdf',
    toString: () => 'file:///vault/raw/pdf/paper.pdf',
  };
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
  await provider.resolveCustomEditor(
    { uri: pdfUri },
    {
      active: true,
      webview,
      onDidChangeViewState: () => ({ dispose() {} }),
      onDidDispose: () => ({ dispose() {} }),
    },
    {},
  );
  provider.webviews.get(pdfUri.toString()).pdfSha256 = 'e'.repeat(64);
  const selection = {
    kind: 'text',
    startPage: 2,
    endPage: 2,
    pages: [{ page: 2, rects: [[30, 40, 130, 56]] }],
    selectedText: 'current selected passage',
  };
  await receiveMessage({
    type: 'selectionChanged',
    anchor: {
      page: 2,
      snippet: selection.selectedText,
      rects: selection.pages[0].rects,
    },
    clipboardSelection: selection,
  });
  const context = posted.at(-1).context;

  assert.equal(await provider.copySelectionForAgent(), true);

  assert.equal(persistCalls.length, 0);
  assert.deepEqual(clipboardWrites, [context.plainText]);
  assert.deepEqual(informationMessages, [
    'Selection copied for agent.',
  ]);
  assert.deepEqual(warningMessages, []);
});

test('PDF copy command reports failure when no clipboard selection exists', async () => {
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode: {
      Uri: { joinPath: (...parts) => ({ parts }) },
    },
    '@llm-wiki/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider({ extensionUri: { fsPath: '/extension' } });
  provider.activeKey = 'file:///vault/raw/pdf/paper.pdf';
  provider.webviews.set(provider.activeKey, {
    panel: {},
    pdfUri: { fsPath: '/vault/raw/pdf/paper.pdf' },
    ready: true,
    postMessage: () => assert.fail('copy command must not bounce through the webview'),
  });

  assert.equal(await provider.copySelectionForAgent(), false);
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
    '@llm-wiki/core': {
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
  const provider = new PdfEditorProvider({ extensionUri: { fsPath: '/extension' } });
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

test('PDF area selection context uses a portable page view rectangle without text fragments', async () => {
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
    '@llm-wiki/core': {
      pdfHref: (sourcePath, options) => {
        pdfHrefCalls.push({ sourcePath, options });
        return portablePdfHref(sourcePath, options);
      },
    },
  });
  const pdfUri = {
    fsPath: '/vault/raw/papers/attention.pdf',
    toString: () => 'file:///vault/raw/papers/attention.pdf',
  };
  const provider = new PdfEditorProvider({ extensionUri: { fsPath: '/extension' } });
  provider.webviews.set(pdfUri.toString(), {
    panel: {},
    pdfUri,
    postMessage: () => undefined,
  });
  provider.activeKey = pdfUri.toString();
  await provider.updateActiveSelection(pdfUri.toString(), {
    area: true,
    page: 2,
    rects: [[90, 45, 522, 185]],
    snippet: 'Selected PDF region.',
  });

  const context = await provider.getActiveSelectionContext();

  assert.deepEqual(context, {
    uri: pdfUri,
    text: 'Selected PDF region.',
    startLine: 2,
    endLine: 2,
    sourceLabel: 'raw/papers/attention.pdf',
    rangeLabel: 'page 2 region',
    anchorUri: 'raw/papers/attention.pdf#page=2&viewrect=90%2C45%2C432%2C140',
    metadata: {
      kind: 'pdf',
      page: 2,
      selectionKind: 'area',
      viewRect: { left: 90, top: 45, width: 432, height: 140 },
    },
  });
  assert.deepEqual(pdfHrefCalls, [{
    sourcePath: 'raw/papers/attention.pdf',
    options: {
      page: 2,
      viewRect: { left: 90, top: 45, width: 432, height: 140 },
    },
  }]);
});

test('PDF Cursor handoff routes exact portable selection without a screenshot attachment', async () => {
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
    '@llm-wiki/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' } },
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
  assert.equal(ADD_SELECTION_TO_CURSOR_CHAT_COMMAND, 'llm-wiki.addSelectionToCursorChat');
  assert.equal(commands.length, 2);
  assert.equal(commands[0][0], ADD_SELECTION_TO_CURSOR_CHAT_COMMAND);
  assert.deepEqual(commands[0][1].selection, selection);
  assert.equal('snapshotPng' in commands[0][1], false);
  assert.deepEqual(commands[1], [
    ADD_SELECTION_TO_CURSOR_CHAT_COMMAND,
    { selection },
  ]);
});

test('PDF Cursor handoff never reuses agent text from the previous selection', async () => {
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
    '@llm-wiki/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' } },
  );
  const pdfUri = {
    fsPath: '/vault/raw/pdf/paper.pdf',
    toString: () => 'file:///vault/raw/pdf/paper.pdf',
  };
  const previousSelection = {
    kind: 'text',
    startPage: 2,
    endPage: 2,
    pages: [{ page: 2, rects: [[10, 20, 110, 36]] }],
    selectedText: 'previous backward-pass equations',
  };
  const previousKey = agentClipboard.pdfAgentClipboardSelectionKey(previousSelection);
  provider.webviews.set(pdfUri.toString(), {
    pdfSha256: 'f'.repeat(64),
    agentClipboardContext: agentClipboard.createPdfAgentClipboardContext({
      selectionKey: previousKey,
      relativePath: 'raw/pdf/paper.pdf',
      sourceSha256: 'f'.repeat(64),
      selection: previousSelection,
    }),
  });

  await provider.handleSelectionAction(pdfUri, 'addToCursorChat', {
    page: 5,
    rects: [[82, 84, 470, 486]],
    snippet: 'Algorithm 1 FlashAttention-3 forward pass',
  });

  assert.equal(commands.length, 1);
  assert.equal(commands[0][0], ADD_SELECTION_TO_CURSOR_CHAT_COMMAND);
  const agentText = commands[0][1].selection.metadata.agentText;
  assert.match(agentText, /Algorithm 1 FlashAttention-3 forward pass/);
  assert.doesNotMatch(agentText, /previous backward-pass equations/);
  assert.match(agentText, /PDF source SHA-256: `f{64}`/);
});

test('provider-specific PDF selection routing is absent', async () => {
  const commandCalls = [];
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
    },
    commands: {
      executeCommand: async (...args) => { commandCalls.push(args); },
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
    '@llm-wiki/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' } },
  );
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );

  assert.equal(ADD_SELECTION_TO_AGENT_COMMAND, undefined);
  assert.equal(typeof provider.addSelectionToAgent, 'undefined');
  await provider.handleSelectionAction(
    { fsPath: '/vault/raw/pdf/paper.pdf' },
    'sendToAgent',
    { page: 3, snippet: 'Selected PDF passage' },
    png.toString('base64'),
    'codex',
  );

  assert.deepEqual(commandCalls, []);
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
    '@llm-wiki/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' }, subscriptions: [] },
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
    ['setContext', 'llmWikiPdfOpen', false],
    ['setContext', 'llmWikiPdfHasSelection', false],
    ['setContext', 'llmWikiPdfHasAgentClipboardSelection', false],
  ]);

  commands.length = 0;
  panel.active = true;
  await onDidChangeViewState();

  assert.equal(provider.getActiveWebview()?.pdfUri, pdfUri);
  assert.deepEqual(commands, [
    ['setContext', 'llmWikiPdfOpen', true],
    ['setContext', 'llmWikiPdfHasSelection', true],
    ['setContext', 'llmWikiPdfHasAgentClipboardSelection', false],
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
    '@llm-wiki/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' }, subscriptions: [] },
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

test('standalone PDF copy-link action is removed', async () => {
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
    '@llm-wiki/core': {
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
  assert.deepEqual(clipboard, []);
  assert.deepEqual(pdfHrefCalls, []);
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
    '@llm-wiki/core': {
      pdfHref: portablePdfHref,
    },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' } },
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
      '@llm-wiki/core': {
        openDatabase: () => { throw new Error('portable navigation must not open the database'); },
        pdfHref: portablePdfHref,
      },
    });
    const provider = new PdfEditorProvider({ extensionUri: { fsPath: '/extension' } });
    provider.webviews.set('file:///vault/raw/pdf/paper.pdf', {
      panel: {},
      pdfUri: { fsPath: '/vault/raw/pdf/paper.pdf' },
      ready: true,
      postMessage: message => { posted.push(message); },
    });

    await provider.openPdfAtTarget('/vault/raw/pdf/paper.pdf', 7, textFragment);

    assert.equal(commandCalls.length, 1);
    assert.equal(commandCalls[0][0], 'vscode.openWith');
    assert.equal(commandCalls[0][1].fsPath, '/vault/raw/pdf/paper.pdf');
    assert.equal(commandCalls[0][2], 'llm-wiki.pdfViewer');
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
    '@llm-wiki/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider({ extensionUri: { fsPath: '/extension' } });
  provider.webviews.set('file:///vault/%2e%2e/secret.pdf', {
    panel: {},
    pdfUri: { fsPath: '/vault/%2e%2e/secret.pdf' },
    ready: true,
    postMessage: () => undefined,
  });

  await provider.openPdfAtTarget('/vault/%2e%2e/secret.pdf');
  await provider.openPdfAtTarget('../secret.pdf');

  assert.equal(commandCalls.length, 1);
  assert.equal(commandCalls[0][0], 'vscode.openWith');
  assert.equal(commandCalls[0][1].fsPath, '/vault/%2e%2e/secret.pdf');
  assert.equal(commandCalls[0][2], 'llm-wiki.pdfViewer');
  assert.deepEqual(errors, [
    'Cannot open unresolved PDF path: ../secret.pdf',
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
        readFile: async () => Uint8Array.from([9, 1, 2, 3, 9]).subarray(1, 4),
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
    '@llm-wiki/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' }, subscriptions: [] },
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
  await provider.openPdfAtTarget('/vault/raw/pdf/paper.pdf', 7, textFragment);
  assert.equal(
    posted.some(message => message.type === 'goToAnchor'),
    false,
    'navigation must wait for the webview message listener',
  );

  await receiveMessage({ type: 'ready' });

  assert.deepEqual(
    posted.map(message => message.type),
    ['agentHandoffCapabilities', 'pdfToolbarPreference', 'loadPdf', 'setQueryAnnotations', 'goToAnchor'],
  );
  assert.ok(posted[2].data instanceof ArrayBuffer);
  assert.deepEqual([...new Uint8Array(posted[2].data)], [1, 2, 3]);
  assert.deepEqual(posted[4], {
    type: 'goToAnchor',
    anchor: { page: 7, textFragment },
  });
  assert.deepEqual(commandCalls.at(-1), [
    'vscode.openWith',
    pdfUri,
    'llm-wiki.pdfViewer',
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
    '@llm-wiki/core': { pdfHref: portablePdfHref },
  });
  const context = { extensionUri: { fsPath: '/extension' }, subscriptions: [] };
  const provider = new PdfEditorProvider(context, {
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

  assert.deepEqual(firstPosted.slice(0, 3).map(message => message.type), [
    'agentHandoffCapabilities',
    'pdfToolbarPreference',
    'loadPdf',
  ]);
  assert.deepEqual(firstPosted[0], {
    type: 'agentHandoffCapabilities',
    cursorAgent: true,
    providers: [{ id: 'codex', label: 'Codex' }],
  });
  assert.deepEqual(firstPosted[1], {
    type: 'pdfToolbarPreference',
    preference: { dock: 'top', hidden: false },
  });
  assert.equal(
    provider.webviews.get(pdfUri.toString()).pdfSha256,
    '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
  );

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
    '@llm-wiki/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' }, subscriptions: [] },
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

test('PDF provider reloads an open document after its file changes', async () => {
  const posted = [];
  let receiveMessage;
  let changeListener;
  let watcherDisposed = false;
  let bytes = Uint8Array.from([1, 2, 3]);
  const pdfUri = {
    scheme: 'file',
    fsPath: '/vault/raw/pdf/paper.pdf',
    toString: () => 'file:///vault/raw/pdf/paper.pdf',
  };
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
      fs: { readFile: async () => bytes },
      createFileSystemWatcher: () => ({
        onDidChange: listener => { changeListener = listener; },
        onDidCreate: () => undefined,
        dispose: () => { watcherDisposed = true; },
      }),
    },
    window: { showErrorMessage: message => assert.fail(message) },
    commands: { executeCommand: async () => undefined },
    Uri: {
      file: fsPath => ({ scheme: 'file', fsPath, toString: () => `file://${fsPath}` }),
      joinPath: (...parts) => ({ parts, toString: () => 'vscode-resource' }),
    },
    RelativePattern: class RelativePattern {
      constructor(base, pattern) {
        this.base = base;
        this.pattern = pattern;
      }
    },
  };
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@llm-wiki/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' }, subscriptions: [] },
  );
  let disposePanel;
  const webview = {
    options: {},
    html: '',
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
  await provider.resolveCustomEditor(
    { uri: pdfUri },
    {
      active: true,
      webview,
      onDidChangeViewState: () => ({ dispose() {} }),
      onDidDispose: listener => {
        disposePanel = listener;
        return { dispose() {} };
      },
    },
    {},
  );

  await receiveMessage({ type: 'ready' });
  const firstLoad = posted.find(message => message.type === 'loadPdf');
  assert.deepEqual([...new Uint8Array(firstLoad.data)], [1, 2, 3]);

  bytes = Uint8Array.from([4, 5, 6]);
  changeListener();
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(provider.webviews.get(pdfUri.toString()).ready, false);

  await receiveMessage({ type: 'ready' });
  const loads = posted.filter(message => message.type === 'loadPdf');
  assert.equal(loads.length, 2);
  assert.deepEqual([...new Uint8Array(loads[1].data)], [4, 5, 6]);

  await disposePanel();
  assert.equal(watcherDisposed, true);
});

test('PDF provider drops a file read that finishes after the panel is disposed', async () => {
  const posted = [];
  let receiveMessage;
  let disposePanel;
  let resolveRead;
  const read = new Promise(resolve => { resolveRead = resolve; });
  const pdfUri = {
    scheme: 'file',
    fsPath: '/vault/raw/pdf/paper.pdf',
    toString: () => 'file:///vault/raw/pdf/paper.pdf',
  };
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace('/vault/', ''),
      fs: { readFile: async () => read },
    },
    window: { showErrorMessage: message => assert.fail(message) },
    commands: { executeCommand: async () => undefined },
    Uri: { joinPath: (...parts) => ({ parts, toString: () => 'vscode-resource' }) },
  };
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@llm-wiki/core': { pdfHref: portablePdfHref },
  });
  const provider = new PdfEditorProvider(
    { extensionUri: { fsPath: '/extension' }, subscriptions: [] },
  );
  await provider.resolveCustomEditor(
    { uri: pdfUri },
    {
      active: true,
      webview: {
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
      },
      onDidChangeViewState: () => ({ dispose() {} }),
      onDidDispose: listener => {
        disposePanel = listener;
        return { dispose() {} };
      },
    },
    {},
  );

  const loading = receiveMessage({ type: 'ready' });
  await new Promise(resolve => setImmediate(resolve));
  await disposePanel();
  resolveRead(Uint8Array.from([1, 2, 3]));
  await loading;

  assert.equal(posted.some(message => message.type === 'loadPdf'), false);
});

test('PDF rectangle embed formatter remains available but its selection action is removed', async () => {
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
    '@llm-wiki/core': {
      openDatabase: () => { throw new Error('rectangle copy must not open the anchor database'); },
    },
  });

  const relPath = 'Topics/AI/LLM/cs336/Resources/lectures/lecture_03.pdf';
  assert.equal(
    formatPdfRectangleEmbed(relPath, 1, [155, 149, 323, 267]),
    '![[Topics/AI/LLM/cs336/Resources/lectures/lecture_03.pdf#page=1&rect=155,149,323,267|lecture_03, p.1]]',
  );

  const provider = new PdfEditorProvider({ extensionUri: { fsPath: '/extension' } });
  await provider.handleSelectionAction(
    { fsPath: `/vault/${relPath}` },
    'copyRectEmbed',
    { page: 1, rects: [[155, 149, 323, 267]], snippet: '' },
  );

  assert.deepEqual(clipboard, []);
  assert.deepEqual(messages, []);
});

test('PDF page links use the exact PDF++ wikilink shape', () => {
  const vscode = {
    workspace: { asRelativePath: uri => uri.fsPath },
    Uri: { joinPath: (...parts) => ({ parts }) },
  };
  const { formatPdfPageLink } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@llm-wiki/core': {},
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
    '@llm-wiki/core': {},
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
  const provider = new PdfEditorProvider({ extensionUri: { fsPath: '/extension' } });
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
  const active = provider.webviews.get(uri.toString());
  active.outlineInferred = true;
  assert.equal(provider.isPdfOutlineInferred(uri), true);
  active.outlineLoading = true;
  assert.equal(provider.getPdfOutline(uri), undefined);
  assert.equal(provider.isPdfOutlineInferred(uri), false);
});

test('PDF toolbar preference persists globally, broadcasts, and restores its last dock', async () => {
  const updates = [];
  const posted = [];
  const context = {
    extensionUri: { fsPath: '/extension' },
    subscriptions: [],
    globalState: {
      get: key => {
        assert.equal(key, 'llmWiki.pdf.toolbarPreference.v1');
        return { dock: 'left', hidden: true };
      },
      update: async (key, value) => {
        updates.push([key, value]);
      },
    },
  };
  const vscode = {
    Uri: {
      joinPath: (...parts) => ({ parts }),
    },
  };
  const { PdfEditorProvider } = loadTsModule('src/pdfEditorProvider.ts', {
    vscode,
    '@llm-wiki/core': {},
  });
  const provider = new PdfEditorProvider(context);
  assert.deepEqual(provider.getPdfToolbarPreference(), {
    dock: 'left',
    hidden: true,
  });
  for (const name of ['first', 'second']) {
    provider.webviews.set(name, {
      panel: {},
      pdfUri: { toString: () => name },
      postMessage: message => posted.push([name, message]),
    });
  }

  assert.deepEqual(await provider.setPdfToolbarPreference({
    dock: 'top',
    hidden: false,
    ignored: true,
  }), {
    dock: 'top',
    hidden: false,
  });
  assert.deepEqual(updates, [[
    'llmWiki.pdf.toolbarPreference.v1',
    { dock: 'top', hidden: false },
  ]]);
  assert.deepEqual(posted, [
    ['first', {
      type: 'pdfToolbarPreference',
      preference: { dock: 'top', hidden: false },
    }],
    ['second', {
      type: 'pdfToolbarPreference',
      preference: { dock: 'top', hidden: false },
    }],
  ]);

  assert.deepEqual(await provider.togglePdfToolbar(), {
    dock: 'top',
    hidden: true,
  });
  assert.deepEqual(provider.getPdfToolbarPreference(), {
    dock: 'top',
    hidden: true,
  });
});

function portablePdfHref(sourcePath, { page, textFragment, viewRect } = {}) {
  const pageDirective = page ? `page=${page}` : '';
  const viewRectDirective = viewRect
    ? `viewrect=${encodeURIComponent(`${viewRect.left},${viewRect.top},${viewRect.width},${viewRect.height}`)}`
    : '';
  const directives = [pageDirective, viewRectDirective].filter(Boolean).join('&');
  if (!textFragment?.textStart) {
    return `${sourcePath}${directives ? `#${directives}` : ''}`;
  }
  const prefix = textFragment.prefix ? `${encodeURIComponent(textFragment.prefix)}-,` : '';
  const end = textFragment.textEnd ? `,${encodeURIComponent(textFragment.textEnd)}` : '';
  const suffix = textFragment.suffix ? `,-${encodeURIComponent(textFragment.suffix)}` : '';
  return `${sourcePath}#${directives}:~:text=${prefix}${encodeURIComponent(textFragment.textStart)}${end}${suffix}`;
}
