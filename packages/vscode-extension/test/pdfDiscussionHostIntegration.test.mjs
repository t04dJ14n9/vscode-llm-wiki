import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { mkdtempSync, readFileSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const standaloneRoot = join(repoRoot, 'packages', 'vscode-pdf-extension');

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
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    mod._compile(outputText, filename);
    return mod.exports;
  } finally {
    Module._load = originalLoad;
  }
}

function uri(fsPath) {
  return {
    fsPath,
    path: fsPath,
    scheme: 'file',
    toString: () => `file://${fsPath}`,
  };
}

function createVscodeMock({ openExternalResult = false } = {}) {
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
      asRelativePath: value => value.fsPath.replace(/^\/vault\/?/, ''),
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
    annotationsEnabled: false,
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
    annotationsEnabled: false,
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

async function createSnapshotSubmitHarness(root) {
  const { vscode } = createVscodeMock();
  const fakeStore = { pdfPath: '/vault/docs/real.pdf' };
  const annotation = discussionAnnotation();
  const submissions = [];
  const controller = {
    onEvent: () => ({ dispose() {} }),
    list(store) {
      assert.equal(store, fakeStore);
      return [annotation];
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
    },
  });
  const provider = new PdfEditorProvider(context, {
    vaultRoot: '/vault',
    documentRoot: '/vault',
    globalStoragePath: '/host/global',
    discussionController: controller,
    annotationsEnabled: false,
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
    annotationsEnabled: false,
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

test('combined and standalone providers enforce host path authority and typed discussion messaging', async () => {
  await exerciseProvider(packageRoot);
  await exerciseProvider(standaloneRoot);
});

test('both providers invalidate cached discussion stores for same-size, same-mtime PDF replacements', () => {
  for (const root of [packageRoot, standaloneRoot]) {
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
      annotationsEnabled: false,
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

test('both providers list path-free snapshot metadata and lazy-load crop bytes from the active store', async () => {
  const snapshotBytes = Buffer.from('persisted-png-bytes');
  for (const root of [packageRoot, standaloneRoot]) {
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

test('both providers remove persisted asset paths from prepared annotation snapshots', async () => {
  for (const root of [packageRoot, standaloneRoot]) {
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

test('both providers keep lifecycle ownership and promotion attempts host-internal', async () => {
  for (const root of [packageRoot, standaloneRoot]) {
    const { harness } = await createPersistedSnapshotTransportHarness(
      root,
      Buffer.from('persisted-png-bytes'),
      {
        lastTurn: {
          status: 'running',
          questionMessageId: 'message-1',
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
    });
    assert.equal('promotionAttempt' in snapshot, false);
    assert.doesNotMatch(JSON.stringify(snapshot), /internal-controller-owner|internal-thread-id/);
  }
});

test('both providers validate incoming crop base64 before decoding and accept exactly 5 MiB', async () => {
  const maxSnapshotBytes = 5 * 1024 * 1024;
  const atLimitBase64 = Buffer.alloc(maxSnapshotBytes, 0xa5).toString('base64');
  const overLimitBase64 = Buffer.alloc(maxSnapshotBytes + 1, 0xa5).toString('base64');
  for (const root of [packageRoot, standaloneRoot]) {
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

test('both providers require first-use consent before every action that starts Codex', async () => {
  for (const root of [packageRoot, standaloneRoot]) {
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

test('both providers reject malformed consent values instead of treating them as granted', async () => {
  for (const root of [packageRoot, standaloneRoot]) {
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

test('both providers turn discussion-store construction failures into typed responses', async () => {
  for (const root of [packageRoot, standaloneRoot]) {
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

test('both providers fall back to text-only when an annotation has no persisted crop', async () => {
  for (const root of [packageRoot, standaloneRoot]) {
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

test('both providers fall back to text-only for missing or invalid persisted crop bytes', async () => {
  const maxSnapshotBytes = 5 * 1024 * 1024;
  for (const root of [packageRoot, standaloneRoot]) {
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

test('both manifests contribute Ask PDF command/config without a default keybinding', () => {
  for (const root of [packageRoot, standaloneRoot]) {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const command = manifest.contributes.commands.find(
      item => item.command === 'human-learning.pdfAskSelection',
    );
    assert.ok(command, `${manifest.name} is missing pdfAskSelection`);
    assert.equal(command.title, 'Human Learning: Ask PDF About Selection');
    assert.equal(
      manifest.contributes.configuration.properties['humanLearning.pdf.codexCommand'].default,
      'codex',
    );
    assert.equal(
      (manifest.contributes.keybindings ?? []).some(
        binding => binding.command === 'human-learning.pdfAskSelection',
      ),
      false,
    );
  }
});

test('both extension hosts create one shared client/controller, register the command, and own disposal', () => {
  for (const root of [packageRoot, standaloneRoot]) {
    const source = readFileSync(join(root, 'src', 'extension.ts'), 'utf8');
    assert.equal((source.match(/new CodexAppServerClient\s*\(/g) ?? []).length, 1);
    assert.equal((source.match(/new PdfDiscussionController\s*\(/g) ?? []).length, 1);
    assert.match(source, /human-learning\.pdfAskSelection/);
    assert.match(source, /humanLearning\.pdf/);
    assert.match(source, /codexCommand/);
    assert.match(source, /subscriptions\.push\([^)]*codexClient|subscriptions\.push\(codexClient/s);
    assert.match(source, /deactivate\(\)[\s\S]*dispose\(\)/);
  }
});
