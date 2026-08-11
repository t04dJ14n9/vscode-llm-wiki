import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { mkdtempSync, readFileSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadTsModule(root, relativePath, mocks = {}) {
  const filename = join(root, relativePath);
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
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    if (request === './cursorCrop' && root === packageRoot) return cursorCrop;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    mod._compile(outputText, filename);
    return mod.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const cursorCrop = loadTsModule(packageRoot, 'src/cursorCrop.ts', {
  './pdfDiscussionController': {
    PDF_DISCUSSION_MAX_PNG_BYTES: 5 * 1024 * 1024,
  },
});

function uri(fsPath) {
  return {
    fsPath,
    path: fsPath,
    scheme: 'file',
    toString: () => `file://${fsPath}`,
  };
}

function createVscodeMock({ openExternalResult = false, workspaceRoot = '/vault' } = {}) {
  const external = [];
  const commands = [];
  const clipboard = [];
  const vscode = {
    Uri: {
      file: value => uri(value),
      parse: value => ({
        scheme: value.split(':')[0],
        fsPath: value.startsWith('file://') ? value.slice(7) : '',
        toString: () => value,
      }),
      joinPath: (base, ...parts) => uri(join(base.fsPath, ...parts)),
    },
    workspace: {
      asRelativePath: value => relative(workspaceRoot, value.fsPath).replaceAll('\\', '/'),
      fs: { readFile: async () => Buffer.from('%PDF') },
      textDocuments: [],
      openTextDocument: async () => ({
        lineCount: 1,
        lineAt: () => ({ text: '' }),
        offsetAt: () => 0,
      }),
    },
    commands: {
      executeCommand: async (...args) => {
        commands.push(args);
      },
    },
    env: {
      clipboard: { writeText: async value => { clipboard.push(value); } },
      openExternal: async target => {
        external.push(target.toString());
        return openExternalResult;
      },
    },
    window: {
      showInformationMessage: () => undefined,
      showWarningMessage: () => undefined,
      showErrorMessage: () => undefined,
      visibleTextEditors: [],
    },
    Position: class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
  };
  return { vscode, external, commands, clipboard };
}

function createPanel() {
  const posted = [];
  let receive;
  const panel = {
    active: true,
    webview: {
      options: {},
      html: '',
      postMessage: async message => {
        posted.push(message);
        return true;
      },
      onDidReceiveMessage: listener => {
        receive = listener;
        return { dispose() {} };
      },
      asWebviewUri: value => value,
      cspSource: 'test-webview',
    },
    onDidChangeViewState: () => ({ dispose() {} }),
    onDidDispose: () => ({ dispose() {} }),
  };
  return {
    panel,
    posted,
    receive: async message => {
      assert.ok(receive, 'provider did not register a message listener');
      await receive(message);
    },
  };
}

function discussionAnnotation(overrides = {}) {
  return {
    id: 'ann-1',
    kind: 'agent_discussion',
    selectionKey: 'selection-key',
    anchorId: 'internal-anchor-1',
    hostOnlyPath: '/vault/.hl/pdf-discussions/annotations.json',
    anchor: {
      uri: 'file:///vault/docs/real.pdf',
      page: 2,
      quote: 'selected',
      prefix: 'before',
      suffix: 'after',
      rects: [[1, 2, 3, 4]],
      textItemIndex: 7,
      charOffset: 3,
      endTextItemIndex: 8,
      endCharOffset: 4,
      portableUrl: 'docs/real.pdf#page=2',
    },
    messages: [],
    lastTurn: { status: 'idle' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('PDF discussion messages are ignored without a controller', async () => {
  const { vscode, commands, clipboard } = createVscodeMock();
  let storeConstructions = 0;
  let writes = 0;
  vscode.workspace.fs.writeFile = async () => { writes++; };
  const context = {
    extensionUri: uri('/extension'),
    subscriptions: [],
    globalState: {
      get: () => false,
      update: async () => undefined,
    },
  };
  const { PdfEditorProvider } = loadTsModule(packageRoot, 'src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': {
      pdfHref: (path, options) => `${path}#page=${options.page}`,
    },
    './pdfDiscussionController': {
      createPdfDiscussionStoreForDocument() {
        storeConstructions++;
        return { store: {} };
      },
    },
  });
  const provider = new PdfEditorProvider(context, {
    documentRoot: '/vault',
    globalStoragePath: '/host/global',
  });
  const harness = createPanel();
  await provider.resolveCustomEditor(
    { uri: uri('/vault/docs/real.pdf'), dispose() {} },
    harness.panel,
    {},
  );
  commands.length = 0;

  await harness.receive({ type: 'pdfDiscussionList', requestId: 'list-disabled' });
  await harness.receive({
    type: 'pdfDiscussionSubmit',
    requestId: 'submit-disabled',
    selection: {
      page: 2,
      snippet: 'selected',
      rects: [[1, 2, 3, 4]],
    },
    question: 'Why?',
  });

  assert.equal(storeConstructions, 0);
  assert.equal(writes, 0);
  assert.deepEqual(commands, []);
  assert.deepEqual(clipboard, []);
  assert.deepEqual(
    harness.posted.filter(message => String(message?.type).startsWith('pdfDiscussion')),
    [],
  );
});

async function exerciseProvider(root) {
  const { vscode, external, clipboard } = createVscodeMock({ openExternalResult: false });
  const routeCalls = [];
  const fakeStore = { pdfPath: '/vault/docs/real.pdf' };
  const annotation = discussionAnnotation({
    promotion: { threadId: 'durable-thread-7', promotedAt: '2026-01-01T00:00:01.000Z' },
  });
  let eventListener;
  const controller = {
    onEvent(listener) {
      eventListener = listener;
      return { dispose() {} };
    },
    list(store) {
      assert.equal(store, fakeStore);
      return [annotation];
    },
    prepare: (_store, input) => ({ selectionKey: 'selection-key', annotation, input }),
    submit: async () => annotation,
    retry: async () => annotation,
    cancel: async () => ({ ...annotation, lastTurn: { status: 'cancelled' } }),
    promote: async () => 'durable-thread-7',
  };
  const context = {
    extensionUri: uri(join(root, 'extension')),
    subscriptions: [],
    globalState: {
      value: false,
      get() { return this.value; },
      async update(_key, value) { this.value = value; },
    },
  };
  const core = {
    closeDatabase: () => undefined,
    createPdfAnchorFromSelection: () => ({ id: 'anchor', uri: 'pdf:anchor' }),
    openDatabase: async () => ({ prepare: () => ({ all: () => [] }) }),
    pdfHref: (path, options) => `${path}#page=${options.page}`,
    runMigrations: () => undefined,
  };
  const discussionModule = {
    createPdfDiscussionStoreForDocument(options) {
      routeCalls.push(options);
      return { store: fakeStore, layout: 'vault' };
    },
  };
  const { PdfEditorProvider } = loadTsModule(root, 'src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': core,
    './pdfDiscussionController': discussionModule,
  });
  const provider = new PdfEditorProvider(context, {
    vaultRoot: '/vault',
    documentRoot: '/vault',
    globalStoragePath: '/host/global',
    discussionController: controller,
  });
  const harness = createPanel();
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => ({ unref() {} });
  try {
    await provider.resolveCustomEditor(
      { uri: uri('/vault/docs/real.pdf'), dispose() {} },
      harness.panel,
      {},
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.match(harness.panel.webview.html, /base-uri 'none';/);
  assert.match(harness.panel.webview.html, /form-action 'none';/);

  await harness.receive({
    type: 'pdfDiscussionPrepare',
    requestId: 'prepare-1',
    selection: {
      page: 2,
      snippet: 'selected',
      rects: [[1, 2, 3, 4]],
    },
    pdfUri: 'file:///attacker.pdf',
    storagePath: '/attacker/storage',
  });
  assert.equal(routeCalls[0].pdfPath, '/vault/docs/real.pdf');
  assert.equal(routeCalls[0].globalStoragePath, '/host/global');
  assert.equal(routeCalls[0].vaultRoot, '/vault');
  assert.equal('storagePath' in routeCalls[0], false);
  assert.ok(harness.posted.some(message => (
    message.type === 'pdfDiscussionPrepared'
    && message.requestId === 'prepare-1'
  )));

  await harness.receive({
    type: 'pdfDiscussionCopyPortableLink',
    requestId: 'copy-link-1',
    selection: {
      page: 2,
      snippet: 'selected',
      rects: [[1, 2, 3, 4]],
    },
  });
  assert.equal(clipboard.at(-1), 'docs/real.pdf#page=2');
  assert.deepEqual(harness.posted.at(-1), {
    type: 'pdfDiscussionPortableLinkCopied',
    requestId: 'copy-link-1',
  });

  await harness.receive({ type: 'pdfDiscussionList', requestId: 'list-1' });
  assert.ok(harness.posted.some(message => message.type === 'pdfDiscussionSnapshot'));
  assert.ok(harness.posted.some(message => message.type === 'pdfDiscussionHighlights'));

  await harness.receive({ type: 'pdfDiscussionConsent', accepted: true });
  assert.equal(context.globalState.value, true);
  await provider.openAskPdfForSelection();
  assert.deepEqual(harness.posted.at(-1), { type: 'pdfDiscussionOpenForSelection' });

  eventListener({
    type: 'delta',
    pdfPath: '/vault/docs/real.pdf',
    annotationId: 'ann-1',
    delta: 'streamed',
  });
  assert.deepEqual(harness.posted.at(-1), {
    type: 'pdfDiscussionDelta',
    annotationId: 'ann-1',
    delta: 'streamed',
  });

  for (const event of [
    { type: 'changed', pdfPath: '/vault/docs/real.pdf', annotation },
    {
      type: 'error',
      pdfPath: '/vault/docs/real.pdf',
      annotationId: 'ann-1',
      error: 'background failure',
    },
  ]) {
    const firstPostedIndex = harness.posted.length;
    eventListener(event);
    await new Promise(resolvePromise => setImmediate(resolvePromise));
    const refresh = harness.posted.slice(firstPostedIndex).find(message => (
      message.type === 'pdfDiscussionSnapshot'
    ));
    assert.ok(refresh, `${event.type} event did not refresh the discussion snapshot`);
    assert.equal(
      'activeAnnotationId' in refresh,
      false,
      `${event.type} event must not switch the active discussion`,
    );
  }

  await harness.receive({
    type: 'pdfDiscussionOpenPromotedTask',
    requestId: 'open-1',
    annotationId: 'ann-1',
  });
  assert.equal(external.at(-1), 'codex://threads/durable-thread-7');
  assert.deepEqual(harness.posted.at(-1), {
    type: 'pdfDiscussionPromotionState',
    annotationId: 'ann-1',
    threadId: 'durable-thread-7',
    opened: false,
    error: 'VS Code could not open the promoted Codex task.',
    requestId: 'open-1',
  });

  const externalCount = external.length;
  await harness.receive({
    type: 'pdfDiscussionOpenLink',
    requestId: 'unsafe-link-1',
    href: 'command:workbench.action.openSettings',
  });
  assert.equal(external.length, externalCount, 'unsafe URI schemes must not reach openExternal');
  assert.deepEqual(harness.posted.at(-1), {
    type: 'pdfDiscussionError',
    message: 'Ask PDF links must use http or https.',
    requestId: 'unsafe-link-1',
  });
}

async function createPersistedSnapshotTransportHarness(
  root,
  snapshotBytes,
  annotationOverrides = {},
) {
  const { vscode } = createVscodeMock();
  const snapshotVerifications = [];
  const fakeStore = {
    pdfPath: '/vault/docs/real.pdf',
    readVerifiedSnapshot(metadata) {
      snapshotVerifications.push(metadata);
      if (snapshotBytes instanceof Error) throw snapshotBytes;
      return snapshotBytes;
    },
  };
  const annotation = discussionAnnotation({
    snapshot: {
      file: 'assets/ann-1/selection.png',
      sha256: 'a'.repeat(64),
      width: 12,
      height: 8,
      mimeType: 'image/png',
    },
    ...annotationOverrides,
  });
  const controller = {
    onEvent: () => ({ dispose() {} }),
    list(store) {
      assert.equal(store, fakeStore);
      return [annotation];
    },
    prepare: () => ({ selectionKey: annotation.selectionKey, annotation }),
  };
  const context = {
    extensionUri: uri(join(root, 'extension')),
    subscriptions: [],
    globalState: {
      get: () => true,
      update: async () => undefined,
    },
  };
  const { PdfEditorProvider } = loadTsModule(root, 'src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': {
      closeDatabase: () => undefined,
      createPdfAnchorFromSelection: () => ({ id: 'anchor', uri: 'pdf:anchor' }),
      openDatabase: async () => ({ prepare: () => ({ all: () => [] }) }),
      pdfHref: (path, options) => `${path}#page=${options.page}`,
      runMigrations: () => undefined,
    },
    './pdfDiscussionController': {
      createPdfDiscussionStoreForDocument: () => ({ store: fakeStore, layout: 'vault' }),
      PDF_DISCUSSION_MAX_PNG_BYTES: 5 * 1024 * 1024,
    },
  });
  const provider = new PdfEditorProvider(context, {
    vaultRoot: '/vault',
    documentRoot: '/vault',
    globalStoragePath: '/host/global',
    discussionController: controller,
  });
  const harness = createPanel();
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => ({ unref() {} });
  try {
    await provider.resolveCustomEditor(
      { uri: uri('/vault/docs/real.pdf'), dispose() {} },
      harness.panel,
      {},
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  return { harness, snapshotVerifications };
}

async function createSnapshotSubmitHarness(root, { modelError } = {}) {
  const { vscode } = createVscodeMock();
  const fakeStore = { pdfPath: '/vault/docs/real.pdf' };
  const annotation = discussionAnnotation();
  const submissions = [];
  const models = [{
    id: 'model-default',
    model: 'gpt-5.4',
    displayName: 'GPT-5.4',
    description: 'Default model',
    isDefault: true,
  }];
  const controller = {
    onEvent: () => ({ dispose() {} }),
    list(store) {
      assert.equal(store, fakeStore);
      return [annotation];
    },
    async listModels() {
      if (modelError) throw modelError;
      return models;
    },
    async submit(store, input) {
      assert.equal(store, fakeStore);
      submissions.push(input);
      return annotation;
    },
  };
  const context = {
    extensionUri: uri(join(root, 'extension')),
    subscriptions: [],
    globalState: {
      get: () => true,
      update: async () => undefined,
    },
  };
  const { PdfEditorProvider } = loadTsModule(root, 'src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': {
      closeDatabase: () => undefined,
      createPdfAnchorFromSelection: () => ({ id: 'anchor', uri: 'pdf:anchor' }),
      openDatabase: async () => ({ prepare: () => ({ all: () => [] }) }),
      pdfHref: (path, options) => `${path}#page=${options.page}`,
      runMigrations: () => undefined,
    },
    './pdfDiscussionController': {
      createPdfDiscussionStoreForDocument: () => ({ store: fakeStore, layout: 'vault' }),
      PDF_DISCUSSION_MAX_PNG_BYTES: 5 * 1024 * 1024,
      PDF_DISCUSSION_MAX_QUESTION_BYTES: 8 * 1024,
    },
  });
  const provider = new PdfEditorProvider(context, {
    vaultRoot: '/vault',
    documentRoot: '/vault',
    globalStoragePath: '/host/global',
    discussionController: controller,
  });
  const harness = createPanel();
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => ({ unref() {} });
  try {
    await provider.resolveCustomEditor(
      { uri: uri('/vault/docs/real.pdf'), dispose() {} },
      harness.panel,
      {},
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  return { harness, submissions };
}

async function createCodexActionBoundaryHarness(
  root,
  { consentGranted = false, createStoreError } = {},
) {
  const { vscode } = createVscodeMock();
  const fakeStore = { pdfPath: '/vault/docs/real.pdf' };
  const annotation = discussionAnnotation();
  const controllerCalls = [];
  const controller = {
    onEvent: () => ({ dispose() {} }),
    list: () => [annotation],
    async submit() {
      controllerCalls.push('submit');
      return annotation;
    },
    async retry() {
      controllerCalls.push('retry');
      return annotation;
    },
    async promote() {
      controllerCalls.push('promote');
      return 'durable-thread-7';
    },
  };
  let storedConsent = consentGranted;
  const context = {
    extensionUri: uri(join(root, 'extension')),
    subscriptions: [],
    globalState: {
      get: () => storedConsent,
      update: async (_key, value) => {
        storedConsent = value;
      },
    },
  };
  const { PdfEditorProvider } = loadTsModule(root, 'src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': {
      closeDatabase: () => undefined,
      createPdfAnchorFromSelection: () => ({ id: 'anchor', uri: 'pdf:anchor' }),
      openDatabase: async () => ({ prepare: () => ({ all: () => [] }) }),
      pdfHref: (path, options) => `${path}#page=${options.page}`,
      runMigrations: () => undefined,
    },
    './pdfDiscussionController': {
      createPdfDiscussionStoreForDocument: () => {
        if (createStoreError) throw createStoreError;
        return { store: fakeStore, layout: 'vault' };
      },
      PDF_DISCUSSION_MAX_PNG_BYTES: 5 * 1024 * 1024,
    },
  });
  const provider = new PdfEditorProvider(context, {
    vaultRoot: '/vault',
    documentRoot: '/vault',
    globalStoragePath: '/host/global',
    discussionController: controller,
  });
  const harness = createPanel();
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => ({ unref() {} });
  try {
    await provider.resolveCustomEditor(
      { uri: uri('/vault/docs/real.pdf'), dispose() {} },
      harness.panel,
      {},
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  return { harness, controllerCalls };
}

function assertMinimalWebviewAnnotation(annotation) {
  assert.deepEqual(annotation.anchor, {
    page: 2,
    quote: 'selected',
    prefix: 'before',
    suffix: 'after',
    rects: [[1, 2, 3, 4]],
    textItemIndex: 7,
    charOffset: 3,
    endTextItemIndex: 8,
    endCharOffset: 4,
  });
  assert.equal('anchorId' in annotation, false);
  assert.equal('hostOnlyPath' in annotation, false);
  assert.equal('uri' in annotation.anchor, false);
  assert.equal('portableUrl' in annotation.anchor, false);
  assert.doesNotMatch(JSON.stringify(annotation), /file:\/\/|\/vault\/|assets\/ann-1/);
}

test('combined provider enforces host path authority and typed discussion messaging', async () => {
  await exerciseProvider(packageRoot);
});

test('combined provider persists an answered PDF discussion and opens its durable learning note', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'hl-pdf-learning-note-'));
  const pdfPath = join(workspaceRoot, 'paper.pdf');
  writeFileSync(pdfPath, Buffer.from('%PDF-learning-note', 'utf8'));

  const { vscode, commands } = createVscodeMock({ workspaceRoot });
  const portableWrites = [];
  const fakeStore = {
    pdfPath,
    writePortableAnnotation(annotation, notePath) {
      portableWrites.push({ annotation, notePath });
    },
  };
  const baseAnnotation = discussionAnnotation();
  const annotation = discussionAnnotation({
    anchor: {
      ...baseAnnotation.anchor,
      uri: uri(pdfPath).toString(),
      portableUrl: 'paper.pdf#page=2',
    },
    messages: [
      {
        id: 'question-1',
        role: 'user',
        markdown: 'Why is this passage important?',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
      {
        id: 'answer-1',
        role: 'assistant',
        markdown: 'It establishes the durable source of truth.',
        createdAt: '2026-01-01T00:00:02.000Z',
      },
    ],
    summaryMarkdown: 'The passage establishes the durable source of truth.',
    updatedAt: '2026-01-01T00:00:02.000Z',
  });
  const controller = {
    onEvent: () => ({ dispose() {} }),
    list(store) {
      assert.equal(store, fakeStore);
      return [annotation];
    },
    async submit(store, input) {
      assert.equal(store, fakeStore);
      assert.equal(input.question, 'Why is this passage important?');
      return annotation;
    },
  };
  const context = {
    extensionUri: uri(join(packageRoot, 'extension')),
    subscriptions: [],
    globalState: {
      get: () => true,
      update: async () => undefined,
    },
  };
  const { LearningNoteStore } = loadTsModule(packageRoot, 'src/learningNoteStore.ts');
  const durableStore = new LearningNoteStore(workspaceRoot);
  const upserts = [];
  const learningNoteStore = {
    async upsertDiscussion(input) {
      upserts.push(input);
      return await durableStore.upsertDiscussion(input);
    },
    findDiscussion: discussionId => durableStore.findDiscussion(discussionId),
  };
  const { PdfEditorProvider } = loadTsModule(packageRoot, 'src/pdfEditorProvider.ts', {
    vscode,
    '@human-learning/core': {
      pdfHref: (path, options) => `${path}#page=${options.page}`,
    },
    './pdfDiscussionController': {
      createPdfDiscussionStoreForDocument: () => ({ store: fakeStore, layout: 'vault' }),
      PDF_DISCUSSION_MAX_PNG_BYTES: 5 * 1024 * 1024,
      PDF_DISCUSSION_MAX_QUESTION_BYTES: 8 * 1024,
    },
  });
  const provider = new PdfEditorProvider(context, {
    vaultRoot: workspaceRoot,
    documentRoot: workspaceRoot,
    globalStoragePath: join(workspaceRoot, '.host'),
    discussionController: controller,
    learningNoteStore,
  });
  const harness = createPanel();
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => ({ unref() {} });
  try {
    await provider.resolveCustomEditor(
      { uri: uri(pdfPath), dispose() {} },
      harness.panel,
      {},
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  await harness.receive({
    type: 'pdfDiscussionSubmit',
    requestId: 'answered-submit',
    annotationId: annotation.id,
    question: 'Why is this passage important?',
  });

  assert.equal(upserts.length, 1);
  assert.deepEqual(upserts[0], {
    discussionId: annotation.id,
    source: {
      kind: 'pdf',
      path: 'paper.pdf',
      link: 'paper.pdf#page=2',
      location: 'page 2',
      quote: 'selected',
      prefix: 'before',
      suffix: 'after',
    },
    messages: [
      {
        role: 'user',
        markdown: 'Why is this passage important?',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
      {
        role: 'assistant',
        markdown: 'It establishes the durable source of truth.',
        createdAt: '2026-01-01T00:00:02.000Z',
      },
    ],
    summaryMarkdown: 'The passage establishes the durable source of truth.',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:02.000Z',
  });
  const note = await durableStore.findDiscussion(annotation.id);
  assert.ok(note, 'the answered discussion was not written to LearningNoteStore');
  assert.match(note.markdown, /Why is this passage important\?/);
  assert.match(note.markdown, /It establishes the durable source of truth\./);
  assert.deepEqual(portableWrites, [{ annotation, notePath: note.relativePath }]);

  await harness.receive({
    type: 'pdfDiscussionOpenLearningNote',
    requestId: 'open-learning-note',
    annotationId: annotation.id,
  });
  const openCommand = commands.findLast(([command]) => command === 'vscode.openWith');
  assert.ok(openCommand, 'the durable learning note was not opened');
  assert.equal(openCommand[1].fsPath, note.absolutePath);
  assert.equal(openCommand[2], 'human-learning.markdownEditor');
  assert.equal(
    harness.posted.some(message => (
      message.type === 'pdfDiscussionError'
      && message.requestId === 'open-learning-note'
    )),
    false,
  );
});

test('combined provider invalidates cached discussion stores for same-size, same-mtime PDF replacements', () => {
  for (const root of [packageRoot]) {
    const tempRoot = mkdtempSync(join(tmpdir(), 'hl-pdf-provider-store-cache-'));
    const pdfPath = join(tempRoot, 'paper.pdf');
    const initialTime = new Date('2026-01-02T03:04:05.000Z');
    const changedTime = new Date('2026-01-02T03:04:06.000Z');
    writeFileSync(pdfPath, Buffer.from('%PDF-one', 'utf8'));
    utimesSync(pdfPath, initialTime, initialTime);

    const { vscode } = createVscodeMock();
    const routeCalls = [];
    const stores = [];
    const { PdfEditorProvider } = loadTsModule(root, 'src/pdfEditorProvider.ts', {
      vscode,
      '@human-learning/core': {
        closeDatabase: () => undefined,
        createPdfAnchorFromSelection: () => ({ id: 'anchor', uri: 'pdf:anchor' }),
        openDatabase: async () => ({ prepare: () => ({ all: () => [] }) }),
        pdfHref: (path, options) => `${path}#page=${options.page}`,
        runMigrations: () => undefined,
      },
      './pdfDiscussionController': {
        createPdfDiscussionStoreForDocument(options) {
          routeCalls.push(options);
          const store = { pdfPath, sequence: stores.length + 1 };
          stores.push(store);
          return { store, layout: 'global' };
        },
      },
    });
    const provider = new PdfEditorProvider({
      extensionUri: uri(join(root, 'extension')),
      subscriptions: [],
      globalState: { get: () => true, update: async () => undefined },
    }, {
      documentRoot: tempRoot,
      globalStoragePath: join(tempRoot, 'global'),
      discussionController: { onEvent: () => ({ dispose() {} }) },
    });
    const pdfUri = uri(pdfPath);

    const first = provider.getDiscussionStore(pdfUri);
    assert.equal(provider.getDiscussionStore(pdfUri), first);

    const replacementPath = join(tempRoot, 'replacement.pdf');
    writeFileSync(replacementPath, Buffer.from('%PDF-two', 'utf8'));
    utimesSync(replacementPath, initialTime, initialTime);
    renameSync(replacementPath, pdfPath);
    const sameMetadataReplacement = provider.getDiscussionStore(pdfUri);
    assert.notEqual(sameMetadataReplacement, first);

    writeFileSync(pdfPath, Buffer.from('%PDF-new', 'utf8'));
    utimesSync(pdfPath, changedTime, changedTime);
    const changedMtime = provider.getDiscussionStore(pdfUri);
    assert.notEqual(changedMtime, sameMetadataReplacement);

    writeFileSync(pdfPath, Buffer.from('%PDF-longer', 'utf8'));
    utimesSync(pdfPath, changedTime, changedTime);
    const changedSize = provider.getDiscussionStore(pdfUri);
    assert.notEqual(changedSize, changedMtime);
    assert.equal(routeCalls.length, 4);
  }
});

test('combined provider lists path-free snapshot metadata and lazy-loads crop bytes from the active store', async () => {
  const snapshotBytes = Buffer.from('persisted-png-bytes');
  for (const root of [packageRoot]) {
    const { harness, snapshotVerifications } = await createPersistedSnapshotTransportHarness(
      root,
      snapshotBytes,
    );
    await harness.receive({ type: 'pdfDiscussionList', requestId: 'snapshot-list' });
    const listMessage = harness.posted.find(candidate => (
      candidate.type === 'pdfDiscussionSnapshot'
      && candidate.requestId === 'snapshot-list'
    ));
    assert.ok(listMessage, 'provider did not post the requested discussion snapshot');
    assert.deepEqual(snapshotVerifications, [], 'listing annotations must not read crop bytes');
    assert.deepEqual(listMessage.annotations[0].snapshot, {
      sha256: 'a'.repeat(64),
      width: 12,
      height: 8,
      mimeType: 'image/png',
    });
    assert.equal('file' in listMessage.annotations[0].snapshot, false);
    assert.equal('snapshotPngBase64' in listMessage.annotations[0], false);
    assertMinimalWebviewAnnotation(listMessage.annotations[0]);

    await harness.receive({
      type: 'pdfDiscussionLoadSnapshot',
      requestId: 'snapshot-image-1',
      annotationId: 'ann-1',
    });
    assert.deepEqual(snapshotVerifications, [{
      file: 'assets/ann-1/selection.png',
      sha256: 'a'.repeat(64),
      width: 12,
      height: 8,
      mimeType: 'image/png',
    }]);
    assert.deepEqual(harness.posted.at(-1), {
      type: 'pdfDiscussionSnapshotImage',
      annotationId: 'ann-1',
      snapshotPngBase64: snapshotBytes.toString('base64'),
      requestId: 'snapshot-image-1',
    });
  }
});

test('combined provider removes persisted asset paths from prepared annotation snapshots', async () => {
  for (const root of [packageRoot]) {
    const { harness, snapshotVerifications } = await createPersistedSnapshotTransportHarness(
      root,
      Buffer.from('persisted-png-bytes'),
    );
    await harness.receive({
      type: 'pdfDiscussionPrepare',
      requestId: 'prepared-snapshot-1',
      selection: {
        page: 2,
        snippet: 'selected',
        rects: [[1, 2, 3, 4]],
      },
    });
    const prepared = harness.posted.at(-1);
    assert.equal(prepared.type, 'pdfDiscussionPrepared');
    assert.deepEqual(snapshotVerifications, [], 'preparing an annotation must not read crop bytes');
    assert.deepEqual(prepared.annotation.snapshot, {
      sha256: 'a'.repeat(64),
      width: 12,
      height: 8,
      mimeType: 'image/png',
    });
    assert.equal('file' in prepared.annotation.snapshot, false);
    assertMinimalWebviewAnnotation(prepared.annotation);
  }
});

test('combined provider keeps lifecycle ownership and promotion attempts host-internal', async () => {
  for (const root of [packageRoot]) {
    const { harness } = await createPersistedSnapshotTransportHarness(
      root,
      Buffer.from('persisted-png-bytes'),
      {
        messages: [{
          id: 'message-1',
          role: 'assistant',
          markdown: 'Model-authored answer.',
          createdAt: '2026-07-15T00:00:00.000Z',
          codexTurnId: 'turn-1',
          codexModel: 'gpt-5.4',
        }],
        lastTurn: {
          status: 'running',
          questionMessageId: 'message-1',
          model: 'gpt-5.4',
          ownerId: 'internal-controller-owner',
          ownerPid: process.pid,
          startedAt: '2026-07-15T00:00:00.000Z',
        },
        promotionAttempt: {
          id: 'promotion-attempt-1',
          status: 'seeding',
          ownerId: 'internal-controller-owner',
          ownerPid: process.pid,
          startedAt: '2026-07-15T00:00:00.000Z',
          threadId: 'internal-thread-id',
        },
      },
    );
    await harness.receive({ type: 'pdfDiscussionList', requestId: 'internal-state-list' });
    const snapshot = harness.posted.find(message => (
      message.type === 'pdfDiscussionSnapshot'
      && message.requestId === 'internal-state-list'
    )).annotations[0];
    assert.deepEqual(snapshot.lastTurn, {
      status: 'running',
      questionMessageId: 'message-1',
      model: 'gpt-5.4',
    });
    assert.equal(snapshot.messages[0].codexModel, 'gpt-5.4');
    assert.equal('promotionAttempt' in snapshot, false);
    assert.doesNotMatch(JSON.stringify(snapshot), /internal-controller-owner|internal-thread-id/);
  }
});

test('combined provider forwards snapshot bytes and crop metadata to new discussion submissions', async () => {
  const snapshotBytes = Buffer.from('selection-crop-png');
  const snapshotCropRect = [12, 24, 180, 240];
  for (const root of [packageRoot]) {
    const { harness, submissions } = await createSnapshotSubmitHarness(root);
    await harness.receive({
      type: 'pdfDiscussionSubmit',
      requestId: 'submit-crop-metadata',
      selection: {
        page: 2,
        snippet: 'selected',
        rects: [[1, 2, 3, 4]],
      },
      question: 'Explain this crop.',
      snapshotPngBase64: snapshotBytes.toString('base64'),
      snapshotCropRect,
      snapshotPadding: 24,
    });

    assert.equal(submissions.length, 1);
    assert.deepEqual(Buffer.from(submissions[0].snapshotPng), snapshotBytes);
    assert.deepEqual(submissions[0].snapshotCropRect, snapshotCropRect);
    assert.equal(submissions[0].snapshotPadding, 24);
  }
});

test('combined provider validates incoming crop base64 before decoding and accepts exactly 5 MiB', async () => {
  const maxSnapshotBytes = 5 * 1024 * 1024;
  const atLimitBase64 = Buffer.alloc(maxSnapshotBytes, 0xa5).toString('base64');
  const overLimitBase64 = Buffer.alloc(maxSnapshotBytes + 1, 0xa5).toString('base64');
  for (const root of [packageRoot]) {
    const { harness, submissions } = await createSnapshotSubmitHarness(root);
    await harness.receive({
      type: 'pdfDiscussionSubmit',
      requestId: 'submit-at-limit',
      annotationId: 'ann-1',
      question: 'At the limit?',
      snapshotPngBase64: atLimitBase64,
    });
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].snapshotPng.byteLength, maxSnapshotBytes);

    for (const invalid of [
      {
        requestId: 'submit-non-string',
        snapshotPngBase64: { attackerControlled: true },
        message: 'Ask PDF snapshots must use canonical base64-encoded PNG bytes.',
      },
      {
        requestId: 'submit-malformed',
        snapshotPngBase64: 'YWJj=',
        message: 'Ask PDF snapshots must use canonical base64-encoded PNG bytes.',
      },
      {
        requestId: 'submit-non-canonical-pad-bits',
        snapshotPngBase64: 'AB==',
        message: 'Ask PDF snapshots must use canonical base64-encoded PNG bytes.',
      },
      {
        requestId: 'submit-over-limit',
        snapshotPngBase64: overLimitBase64,
        message: 'PDF discussion snapshots cannot exceed 5 MiB.',
      },
    ]) {
      await harness.receive({
        type: 'pdfDiscussionSubmit',
        requestId: invalid.requestId,
        annotationId: 'ann-1',
        question: 'Reject this crop',
        snapshotPngBase64: invalid.snapshotPngBase64,
      });
      assert.equal(submissions.length, 1, `${invalid.requestId} reached the controller`);
      assert.deepEqual(harness.posted.at(-1), {
        type: 'pdfDiscussionError',
        message: invalid.message,
        annotationId: 'ann-1',
        requestId: invalid.requestId,
      });
      assert.doesNotMatch(JSON.stringify(harness.posted.at(-1)), /\/vault|assets\//);
    }
  }
});

test('combined provider lists Codex models and forwards the selected model to submissions', async () => {
  for (const root of [packageRoot]) {
    const { harness, submissions } = await createSnapshotSubmitHarness(root);
    await harness.receive({ type: 'pdfDiscussionListModels', requestId: 'models-1' });
    assert.deepEqual(harness.posted.at(-1), {
      type: 'pdfDiscussionModels',
      models: [{
        id: 'model-default',
        model: 'gpt-5.4',
        displayName: 'GPT-5.4',
        description: 'Default model',
        isDefault: true,
      }],
      requestId: 'models-1',
    });

    await harness.receive({
      type: 'pdfDiscussionSubmit',
      requestId: 'submit-model-1',
      annotationId: 'ann-1',
      question: 'Explain this.',
      model: '  gpt-5.4  ',
    });
    assert.equal(submissions.at(-1).model, 'gpt-5.4');

    for (const [requestId, model] of [
      ['submit-empty-model', '   '],
      ['submit-non-string-model', { model: 'gpt-5.4' }],
      ['submit-oversized-model', 'x'.repeat(8 * 1024 + 1)],
    ]) {
      const submissionCount = submissions.length;
      await harness.receive({
        type: 'pdfDiscussionSubmit',
        requestId,
        annotationId: 'ann-1',
        question: 'Reject this model.',
        model,
      });
      assert.equal(submissions.length, submissionCount);
      assert.deepEqual(harness.posted.at(-1), {
        type: 'pdfDiscussionError',
        message: 'Ask PDF requires a valid Codex model identifier.',
        annotationId: 'ann-1',
        requestId,
      });
    }
  }
});

test('combined provider returns a non-blocking empty catalog when Codex model discovery fails', async () => {
  for (const root of [packageRoot]) {
    const { harness } = await createSnapshotSubmitHarness(root, {
      modelError: new Error('Codex model catalog is unavailable.'),
    });
    await harness.receive({ type: 'pdfDiscussionListModels', requestId: 'models-failed' });
    assert.deepEqual(harness.posted.at(-1), {
      type: 'pdfDiscussionModels',
      models: [],
      error: 'Codex model catalog is unavailable.',
      requestId: 'models-failed',
    });
  }
});

test('combined provider requires first-use consent before every action that starts Codex', async () => {
  for (const root of [packageRoot]) {
    const { harness, controllerCalls } = await createCodexActionBoundaryHarness(root);
    for (const message of [
      {
        type: 'pdfDiscussionSubmit',
        requestId: 'submit-without-consent',
        annotationId: 'ann-1',
        question: 'Do not submit this.',
      },
      {
        type: 'pdfDiscussionRetry',
        requestId: 'retry-without-consent',
        annotationId: 'ann-1',
      },
      {
        type: 'pdfDiscussionPromote',
        requestId: 'promote-without-consent',
        annotationId: 'ann-1',
      },
    ]) {
      await harness.receive(message);
      assert.deepEqual(
        controllerCalls,
        [],
        `${message.type} must not reach the controller before consent`,
      );
      assert.deepEqual(harness.posted.at(-1), {
        type: 'pdfDiscussionError',
        message: 'Accept the Ask PDF first-use notice before sending data to Codex.',
        annotationId: 'ann-1',
        requestId: message.requestId,
      });
    }
  }
});

test('combined provider rejects malformed consent values instead of treating them as granted', async () => {
  for (const root of [packageRoot]) {
    for (const accepted of ['yes', 1, { accepted: true }]) {
      const { harness, controllerCalls } = await createCodexActionBoundaryHarness(root);
      await harness.receive({
        type: 'pdfDiscussionConsent',
        requestId: `malformed-consent-${typeof accepted}`,
        accepted,
      });
      assert.deepEqual(controllerCalls, []);
      assert.deepEqual(harness.posted.at(-1), {
        type: 'pdfDiscussionError',
        message: 'Ask PDF consent must be accepted or declined.',
        requestId: `malformed-consent-${typeof accepted}`,
      });

      await harness.receive({
        type: 'pdfDiscussionSubmit',
        requestId: `submit-after-malformed-consent-${typeof accepted}`,
        annotationId: 'ann-1',
        question: 'This must remain blocked.',
      });
      assert.deepEqual(controllerCalls, []);
      assert.match(harness.posted.at(-1).message, /first-use notice/);
    }
  }
});

test('combined provider turns discussion-store construction failures into typed responses', async () => {
  for (const root of [packageRoot]) {
    const { harness, controllerCalls } = await createCodexActionBoundaryHarness(root, {
      consentGranted: true,
      createStoreError: new Error('Ask PDF could not validate its annotation sidecar.'),
    });
    await harness.receive({ type: 'pdfDiscussionList', requestId: 'store-failure' });
    assert.deepEqual(controllerCalls, []);
    assert.deepEqual(harness.posted.at(-1), {
      type: 'pdfDiscussionError',
      message: 'Ask PDF could not validate its annotation sidecar.',
      requestId: 'store-failure',
    });
  }
});

test('combined provider falls back to text-only when an annotation has no persisted crop', async () => {
  for (const root of [packageRoot]) {
    const { harness, snapshotVerifications } = await createPersistedSnapshotTransportHarness(
      root,
      undefined,
      { snapshot: undefined },
    );
    await harness.receive({
      type: 'pdfDiscussionLoadSnapshot',
      requestId: 'snapshot-missing-1',
      annotationId: 'ann-1',
    });
    assert.deepEqual(snapshotVerifications, []);
    assert.deepEqual(harness.posted.at(-1), {
      type: 'pdfDiscussionSnapshotImage',
      annotationId: 'ann-1',
      requestId: 'snapshot-missing-1',
    });
  }
});

test('combined provider falls back to text-only for missing or invalid persisted crop bytes', async () => {
  const maxSnapshotBytes = 5 * 1024 * 1024;
  for (const root of [packageRoot]) {
    const atLimit = await createPersistedSnapshotTransportHarness(
      root,
      Buffer.alloc(maxSnapshotBytes),
    );
    await atLimit.harness.receive({
      type: 'pdfDiscussionLoadSnapshot',
      requestId: 'snapshot-at-limit',
      annotationId: 'ann-1',
    });
    assert.equal(
      Buffer.from(atLimit.harness.posted.at(-1).snapshotPngBase64, 'base64').byteLength,
      maxSnapshotBytes,
    );

    const missing = await createPersistedSnapshotTransportHarness(
      root,
      undefined,
    );
    await missing.harness.receive({
      type: 'pdfDiscussionLoadSnapshot',
      requestId: 'snapshot-file-missing',
      annotationId: 'ann-1',
    });
    assert.deepEqual(missing.harness.posted.at(-1), {
      type: 'pdfDiscussionSnapshotImage',
      annotationId: 'ann-1',
      requestId: 'snapshot-file-missing',
    });

    const invalid = await createPersistedSnapshotTransportHarness(
      root,
      new Error('Snapshot hash does not match /vault/secret/selection.png'),
    );
    await invalid.harness.receive({
      type: 'pdfDiscussionLoadSnapshot',
      requestId: 'snapshot-invalid',
      annotationId: 'ann-1',
    });
    assert.deepEqual(invalid.harness.posted.at(-1), {
      type: 'pdfDiscussionSnapshotImage',
      annotationId: 'ann-1',
      requestId: 'snapshot-invalid',
    });
    assert.equal(
      invalid.harness.posted.some(message => message.type === 'pdfDiscussionError'),
      false,
    );
  }
});

test('combined manifest leaves Ask PDF unexposed', () => {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(
    manifest.contributes.commands.some(item => item.command === 'human-learning.pdfAskSelection'),
    false,
  );
  assert.equal(
    manifest.contributes.configuration?.properties?.['humanLearning.agent.codexCommand'],
    undefined,
  );
  assert.doesNotMatch(JSON.stringify(manifest.capabilities), /Ask PDF/);
});
