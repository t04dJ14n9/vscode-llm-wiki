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
    if (request === './pdfDiscussionController') {
      return {
        PDF_DISCUSSION_MAX_PNG_BYTES: 5 * 1024 * 1024,
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

test('insert helper replaces selections and returns cursor positions', () => {
  const { applyInsertText } = loadTsModule('webview-src/insertText.ts');

  assert.deepEqual(
    applyInsertText('alpha beta gamma', [{ from: 6, to: 10 }], '[PDF](raw/paper.pdf#page=1)'),
    {
      text: 'alpha [PDF](raw/paper.pdf#page=1) gamma',
      cursorPositions: [33],
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
  const insertPromise = provider.insertMarkdown('[PDF](raw/pdf/paper.pdf#page=7)');
  const insertMessage = messages.at(-1);
  assert.equal(insertMessage.type, 'insertText');
  assert.equal(insertMessage.text, '[PDF](raw/pdf/paper.pdf#page=7)');
  assert.equal(typeof insertMessage.requestId, 'string');
  await panel.fireMessage({ type: 'insertTextApplied', requestId: insertMessage.requestId, applied: true });
  const inserted = await insertPromise;

  assert.equal(inserted, true);
  assert.deepEqual(insertMessage, {
    type: 'insertText',
    text: '[PDF](raw/pdf/paper.pdf#page=7)',
    requestId: insertMessage.requestId,
  });
});

test('markdown editor provider posts normalized editor typography settings', async () => {
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
      fontFamily: 'Fira Code',
      fontSize: '17px',
      fontWeight: '500',
      lineHeight: '29px',
      letterSpacing: '1.25px',
    },
  });
});

test('markdown editor provider keeps automatic VS Code metrics at Obsidian\'s readable minimum', async () => {
  const messages = [];
  const vscode = createVscodeMock({
    editorConfig: {
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      fontWeight: 'normal',
      lineHeight: 0,
      letterSpacing: 0,
    },
  });
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({ extensionUri: { scheme: 'file', path: '/extension' } });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(createDocumentMock(), panel, {});

  assert.deepEqual(messages.find(message => message.type === 'updateSettings'), {
    type: 'updateSettings',
    settings: {
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: '16px',
      fontWeight: 'normal',
      lineHeight: '24px',
      letterSpacing: '0px',
    },
  });
});

test('markdown editor provider sends the filename title like Obsidian', async () => {
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
      createUri('/vault/Projects/Standalone.md'),
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
    'Projects/Standalone.md',
  ]);
  assert.equal(setTextMessage.resourceBaseUri, 'webview:///vault/notes/Concepts/');
  assert.equal(setTextMessage.resourceRootUri, 'webview:///vault/');
  assert.equal(findFilesCalls[0]?.pattern, '**/*.md');
  assert.equal(findFilesCalls[0]?.excludePattern, '**/{.git,node_modules}/**');
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
    'llm-wiki.markdownEditor',
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

test('markdown editor provider retargets insertions after webview activity', async () => {
  const firstMessages = [];
  const secondMessages = [];
  const vscode = createVscodeMock();
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({ extensionUri: { scheme: 'file', path: '/extension' } });
  const firstDocument = createDocumentMock({ uri: 'file:///vault/notes/First.md' });
  const secondDocument = createDocumentMock({ uri: 'file:///vault/notes/Second.md' });
  const firstPanel = createPanelMock(firstMessages);
  const secondPanel = createPanelMock(secondMessages);

  await provider.resolveCustomTextEditor(secondDocument, secondPanel, {});
  await provider.resolveCustomTextEditor(firstDocument, firstPanel, {});
  await secondPanel.fireMessage({ type: 'active' });
  const insertPromise = provider.insertMarkdown('cursor-safe');
  const insertMessage = secondMessages.at(-1);
  await secondPanel.fireMessage({ type: 'insertTextApplied', requestId: insertMessage.requestId, applied: true });
  const inserted = await insertPromise;

  assert.equal(inserted, true);
  assert.deepEqual(insertMessage, {
    type: 'insertText',
    text: 'cursor-safe',
    requestId: insertMessage.requestId,
  });
  assert.notDeepEqual(firstMessages.at(-1), {
    type: 'insertText',
    text: 'cursor-safe',
  });
});

test('markdown editor provider returns false when the active webview does not acknowledge insertion', async () => {
  const messages = [];
  const vscode = createVscodeMock();
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({ extensionUri: { scheme: 'file', path: '/extension' } });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(createDocumentMock(), panel, {});
  const inserted = await provider.insertMarkdown('unacknowledged');
  const insertMessage = messages.find(message => message.type === 'insertText' && message.text === 'unacknowledged');

  assert.equal(inserted, false);
  assert.ok(insertMessage);
  assert.equal(typeof insertMessage.requestId, 'string');
});

test('markdown editor provider uses selection-preserving focus for Vim host shortcuts', async () => {
  const messages = [];
  const executeCommandCalls = [];
  const vscode = createVscodeMock({ executeCommandCalls });
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({
    extensionUri: { scheme: 'file', path: '/extension' },
    workspaceState: createStorageMock({ markdownVimMode: true }),
  });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(createDocumentMock(), panel, {});
  const consumed = await provider.consumeVimHostShortcut();
  await new Promise(resolve => setTimeout(resolve, 200));

  assert.equal(consumed, true);
  assert.ok(
    executeCommandCalls.some(args => args[0] === 'workbench.action.focusActiveEditorGroup'),
    'expected the provider to ask VS Code to focus the active editor group',
  );
  assert.ok(
    messages.some(message => message.type === 'restoreFocus'),
    'expected a selection-preserving restoreFocus message for Vim host shortcuts',
  );
  assert.equal(
    messages.some(message => message.type === 'focus'),
    false,
    'Vim host shortcuts should not re-run initial autofocus',
  );
});

test('markdown editor provider leaves regular edits to VS Code autosave or explicit save', async () => {
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

  assert.equal(saveCalls.length, 0);

  await panel.fireMessage({ type: 'save' });
  assert.equal(saveCalls.length, 1);
});

test('markdown editor provider keeps associated untitled edits until explicit save', async () => {
  const messages = [];
  const saveCalls = [];
  let document;
  const vscode = createVscodeMock({
    applyEdit: async edit => {
      document.setText(edit.replacements.at(-1).text);
      return true;
    },
  });
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({ extensionUri: { scheme: 'file', path: '/extension' } });
  document = createDocumentMock({
    uri: {
      scheme: 'untitled',
      fsPath: '/vault/notes/Draft.md',
      path: '/vault/notes/Draft.md',
      toString: () => 'untitled:/vault/notes/Draft.md',
    },
    isUntitled: true,
    save: async () => {
      saveCalls.push(document.getText());
      return true;
    },
  });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(document, panel, {});
  await panel.fireMessage({ type: 'edit', text: '# Draft\n' });
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.deepEqual(saveCalls, []);

  await panel.fireMessage({ type: 'save' });
  assert.deepEqual(saveCalls, ['# Draft\n']);
});

test('markdown editor provider flushes queued webview edits through the host save path', async () => {
  const messages = [];
  const pendingEdits = [];
  let document;
  const vscode = createVscodeMock({
    applyEdit: edit => {
      const replacement = edit.replacements.at(-1);
      let resolveEdit;
      const applied = new Promise(resolve => {
        resolveEdit = resolve;
      });
      pendingEdits.push({
        text: replacement.text,
        complete: () => {
          document.setText(replacement.text);
          resolveEdit(true);
        },
      });
      return applied;
    },
  });
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({ extensionUri: { scheme: 'file', path: '/extension' } });
  document = createDocumentMock({ text: '# Note\n' });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(document, panel, {});
  await panel.fireMessage({ type: 'edit', text: '# Queued update\n' });
  await new Promise(resolve => setImmediate(resolve));
  const flush = provider.flushActiveEditsBeforeSave(document.uri);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pendingEdits.length, 1);
  pendingEdits[0].complete();

  assert.equal(await flush, true);
  assert.equal(document.getText(), '# Queued update\n');
});

test('markdown editor provider does not replay stale text while webview edits are pending', async () => {
  const messages = [];
  const pendingEdits = [];
  const documentChangeListeners = [];
  const document = createDocumentMock({ text: '# Note\n\nBody a' });
  const vscode = createVscodeMock({
    applyEdit: edit => {
      const replacement = edit.replacements.at(-1);
      let resolveEdit;
      const editApplied = new Promise(resolve => {
        resolveEdit = resolve;
      });
      pendingEdits.push({
        text: replacement.text,
        complete: () => {
          document.setText(replacement.text);
          for (const listener of documentChangeListeners) {
            listener({ document });
          }
          for (const listener of documentChangeListeners) {
            listener({ document });
          }
          resolveEdit(true);
        },
      });
      return editApplied;
    },
    onDidChangeTextDocument: listener => {
      documentChangeListeners.push(listener);
      return { dispose() {} };
    },
  });
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({ extensionUri: { scheme: 'file', path: '/extension' } });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(document, panel, {});
  messages.length = 0;

  const edits = [
    panel.fireMessage({ type: 'edit', text: '# Note\n\nBody ab' }),
    panel.fireMessage({ type: 'edit', text: '# Note\n\nBody' }),
  ];

  while (pendingEdits.length > 0) {
    const pendingEdit = pendingEdits.shift();
    pendingEdit.complete();
    await new Promise(resolve => setImmediate(resolve));
  }
  await Promise.all(edits);
  while (pendingEdits.length > 0) {
    const pendingEdit = pendingEdits.shift();
    pendingEdit.complete();
    await new Promise(resolve => setImmediate(resolve));
  }
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(
    messages.filter(message => message.type === 'setText').map(message => message.text),
    [],
    'webview-originated edits should not be echoed back as host setText messages',
  );
  assert.equal(document.getText(), '# Note\n\nBody');
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
  const executeCommandCalls = [];
  const vscode = createVscodeMock({ executeCommandCalls });
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
    metadata: {
      kind: 'markdown',
      from: 13,
      to: 21,
    },
  });
  assert.deepEqual(executeCommandCalls.at(-1), [
    'setContext',
    'llmWikiMarkdownHasSelection',
    true,
  ]);

  await panel.fireMessage({
    type: 'selectionChanged',
    selection: { from: 21, to: 21 },
  });
  assert.deepEqual(executeCommandCalls.at(-1), [
    'setContext',
    'llmWikiMarkdownHasSelection',
    false,
  ]);
});

test('markdown editor provider reports an inclusive source range when selection ends at next-line column zero', async () => {
  const messages = [];
  const vscode = createVscodeMock();
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({
    extensionUri: { scheme: 'file', path: '/extension' },
    workspaceState: createStorageMock(),
  });
  const document = createDocumentMock({ text: 'first line\nsecond line\nthird line\n' });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(document, panel, {});
  await panel.fireMessage({
    type: 'selectionChanged',
    selection: { from: 0, to: 'first line\nsecond line\n'.length },
  });

  assert.deepEqual(provider.getActiveSelectionContext(), {
    uri: document.uri,
    text: 'first line\nsecond line\n',
    startLine: 1,
    endLine: 2,
    metadata: {
      kind: 'markdown',
      from: 0,
      to: 'first line\nsecond line\n'.length,
    },
  });
});

test('markdown editor provider keeps selections separate for duplicate editor groups', async () => {
  const firstMessages = [];
  const secondMessages = [];
  const vscode = createVscodeMock();
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({
    extensionUri: { scheme: 'file', path: '/extension' },
    workspaceState: createStorageMock(),
  });
  const document = createDocumentMock({
    text: '# Note\nAlpha **beta** gamma\nOmega\n',
  });
  const firstPanel = createPanelMock(firstMessages);
  const secondPanel = createPanelMock(secondMessages);

  await provider.resolveCustomTextEditor(document, firstPanel, {});
  await firstPanel.fireMessage({
    type: 'selectionChanged',
    selection: { from: 7, to: 12 },
  });
  await provider.resolveCustomTextEditor(document, secondPanel, {});
  await secondPanel.fireMessage({
    type: 'selectionChanged',
    selection: { from: 13, to: 21 },
  });

  await firstPanel.fireMessage({ type: 'active' });
  assert.equal(provider.getActiveSelectionContext()?.text, 'Alpha');

  await secondPanel.fireMessage({ type: 'active' });
  assert.equal(provider.getActiveSelectionContext()?.text, '**beta**');
});

test('markdown editor provider requests the live webview selection before host commands use it', async () => {
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
  const capture = provider.captureActiveSelectionContext();
  const request = messages.at(-1);
  assert.equal(request.type, 'requestSelection');
  assert.equal(typeof request.requestId, 'string');

  await panel.fireMessage({
    type: 'selectionResponse',
    requestId: request.requestId,
    selection: { from: 13, to: 21 },
  });

  assert.equal((await capture)?.text, '**beta**');
});

test('markdown host commands resolve the selected custom-editor tab without recent webview focus', async () => {
  const messages = [];
  const document = createDocumentMock({
    uri: 'file:///vault/notes/Concepts/Online Softmax.md',
    text: '# Note\nExact passage\n',
  });
  const vscode = createVscodeMock({
    activeTabUri: document.uri,
  });
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({
    extensionUri: { scheme: 'file', path: '/extension' },
    workspaceState: createStorageMock(),
  });
  const panel = createPanelMock(messages, { active: false });

  await provider.resolveCustomTextEditor(document, panel, {});
  const capture = provider.captureActiveSelectionContext();
  const request = messages.at(-1);
  await panel.fireMessage({
    type: 'selectionResponse',
    requestId: request.requestId,
    selection: { from: 7, to: 20 },
  });

  assert.equal((await capture)?.text, 'Exact passage');
});

test('markdown editor provider does not turn an empty selection into the whole note', async () => {
  const messages = [];
  const vscode = createVscodeMock();
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({
    extensionUri: { scheme: 'file', path: '/extension' },
    workspaceState: createStorageMock(),
  });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(createDocumentMock({ text: '# Note\nWhole document\n' }), panel, {});
  const capture = provider.captureActiveSelectionContext();
  const request = messages.at(-1);
  await panel.fireMessage({
    type: 'selectionResponse',
    requestId: request.requestId,
    selection: { from: 8, to: 8 },
  });

  assert.equal(await capture, undefined);
});

test('markdown editor provider routes Cursor selection intent through the shared host command', async () => {
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
  await panel.fireMessage({ type: 'addSelectionToCursorChat' });

  assert.deepEqual(executeCommandCalls.at(-1), [
    'llm-wiki.addSelectionToCursorChat',
  ]);
});

test('markdown editor provider routes Copy for Agent intent through the shared host command', async () => {
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
  await panel.fireMessage({ type: 'copySelectionForAgent' });

  assert.deepEqual(executeCommandCalls.at(-1), [
    'llm-wiki.copySelectionForAgent',
  ]);
});

test('markdown editor provider leaves provider-specific selection routing absent', async () => {
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
  await panel.fireMessage({ type: 'sendToAgent', agentId: 'codex' });

  assert.equal(
    executeCommandCalls.some(([command]) => command === 'llm-wiki.addSelectionToAgent'),
    false,
  );
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
    metadata: {
      kind: 'markdown',
      from: 0,
      to: text.length,
    },
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

  const document = createDocumentMock();
  await provider.resolveCustomTextEditor(document, panel, {});
  await panel.fireMessage({ type: 'openUri', uri: 'https://example.com/docs' });

  assert.deepEqual(executeCommandCalls.at(-1), [
    'llm-wiki.openLinkTarget',
    'https://example.com/docs',
    document.uri,
  ]);
});

test('markdown editor provider resolves ordinary relative links from nested index notes', async () => {
  const messages = [];
  const executeCommandCalls = [];
  const vscode = createVscodeMock({
    executeCommandCalls,
    workspaceFolder: { uri: createUri('/vault') },
  });
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({
    extensionUri: { scheme: 'file', path: '/extension' },
    workspaceState: createStorageMock(),
  });
  const panel = createPanelMock(messages);

  const document = createDocumentMock({ uri: 'file:///vault/summaries/index.md' });
  await provider.resolveCustomTextEditor(document, panel, {});
  await panel.fireMessage({
    type: 'openUri',
    uri: 'nanochat-end-to-end-training-pipeline.md',
    relativeToDocument: true,
  });

  assert.deepEqual(executeCommandCalls.at(-1), [
    'llm-wiki.openLinkTarget',
    'summaries/nanochat-end-to-end-training-pipeline.md',
    document.uri,
  ]);
});

test('markdown editor provider keeps resolved wikilinks vault-relative', async () => {
  const messages = [];
  const executeCommandCalls = [];
  const vscode = createVscodeMock({
    executeCommandCalls,
    workspaceFolder: { uri: createUri('/vault') },
  });
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({
    extensionUri: { scheme: 'file', path: '/extension' },
    workspaceState: createStorageMock(),
  });
  const panel = createPanelMock(messages);

  const document = createDocumentMock({ uri: 'file:///vault/daily/2026-08-13.md' });
  await provider.resolveCustomTextEditor(document, panel, {});
  await panel.fireMessage({
    type: 'openUri',
    uri: 'concepts/byte-pair-encoding.md',
    relativeToDocument: false,
  });

  assert.deepEqual(executeCommandCalls.at(-1), [
    'llm-wiki.openLinkTarget',
    'concepts/byte-pair-encoding.md',
    document.uri,
  ]);
});

test('markdown annotation clicks route note identity to the durable-note command', async () => {
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
  await panel.fireMessage({
    type: 'openLearningNote',
    discussionId: 'discussion-durable',
    notePath: 'wiki/learning/durable.md',
  });

  assert.deepEqual(executeCommandCalls.at(-1), [
    'llm-wiki.openLearningDiscussion',
    {
      discussionId: 'discussion-durable',
      notePath: 'wiki/learning/durable.md',
    },
  ]);
});

test('markdown editor provider resolves generated daily and learning-note links from their note', async () => {
  const messages = [];
  const executeCommandCalls = [];
  const vscode = createVscodeMock({
    executeCommandCalls,
    workspaceFolder: { uri: createUri('/vault') },
  });
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({
    extensionUri: { scheme: 'file', path: '/extension' },
    workspaceState: createStorageMock(),
  });

  const dailyPanel = createPanelMock(messages);
  const dailyDocument = createDocumentMock({ uri: 'file:///vault/wiki/daily/2026-08-10.md' });
  await provider.resolveCustomTextEditor(dailyDocument, dailyPanel, {});
  await dailyPanel.fireMessage({
    type: 'openUri',
    uri: '../learning/Memory%20Systems.md',
    relativeToDocument: true,
  });

  const learningPanel = createPanelMock(messages);
  const learningDocument = createDocumentMock({ uri: 'file:///vault/wiki/learning/Memory Systems.md' });
  await provider.resolveCustomTextEditor(learningDocument, learningPanel, {});
  await learningPanel.fireMessage({
    type: 'openUri',
    uri: '../../notes/Concepts/Memory.md#L4-L5',
    relativeToDocument: true,
  });
  await learningPanel.fireMessage({
    type: 'openUri',
    uri: '../../notes/Concepts/Root Link.md#Overview',
    relativeToDocument: true,
  });

  assert.deepEqual(executeCommandCalls.slice(-3), [
    ['llm-wiki.openLinkTarget', 'wiki/learning/Memory%20Systems.md', dailyDocument.uri],
    ['llm-wiki.openLinkTarget', 'notes/Concepts/Memory.md#L4-L5', learningDocument.uri],
    ['llm-wiki.openLinkTarget', 'notes/Concepts/Root Link.md#Overview', learningDocument.uri],
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

test('markdown editor provider opens macOS Dictionary for webview lookup requests', async () => {
  const messages = [];
  const openExternalCalls = [];
  const informationMessages = [];
  const vscode = createVscodeMock({ openExternalCalls, informationMessages });
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({
    extensionUri: { scheme: 'file', path: '/extension' },
    workspaceState: createStorageMock(),
  });
  const panel = createPanelMock(messages);

  await provider.resolveCustomTextEditor(createDocumentMock(), panel, {});
  await panel.fireMessage({
    type: 'lookupSelection',
    text: 'bounded context',
  });

  assert.equal(openExternalCalls.length, 1);
  assert.equal(openExternalCalls[0][0].toString(), 'dict://bounded%20context');
  assert.deepEqual(informationMessages, ['Looking up "bounded context" in Dictionary']);
});

test('markdown editor provider closes the custom editor on webview close messages', async () => {
  const messages = [];
  const disposeCalls = [];
  const document = createDocumentMock();
  const noteTab = { input: { uri: document.uri, viewType: 'llm-wiki.markdownEditor' } };
  const closedTabs = [];
  const vscode = createVscodeMock({
    tabGroups: {
      all: [{ viewColumn: 1, tabs: [noteTab] }],
      close: async tab => {
        closedTabs.push(tab);
        return true;
      },
    },
  });
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({
    extensionUri: { scheme: 'file', path: '/extension' },
    workspaceState: createStorageMock(),
  });
  const panel = createPanelMock(messages, { disposeCalls, viewColumn: 1 });

  await provider.resolveCustomTextEditor(document, panel, {});
  await panel.fireMessage({ type: 'close' });

  assert.deepEqual(closedTabs, [noteTab]);
  assert.equal(disposeCalls.length, 0);
});

test('markdown editor provider handles Ctrl/Cmd+W through the native close of its own tab', async () => {
  const messages = [];
  const disposeCalls = [];
  const document = createDocumentMock({ isUntitled: true });
  const noteTab = { input: { uri: document.uri, viewType: 'llm-wiki.markdownEditor' } };
  const closedTabs = [];
  const vscode = createVscodeMock({
    tabGroups: {
      all: [{ viewColumn: 1, tabs: [noteTab] }],
      close: async tab => {
        closedTabs.push(tab);
        return true;
      },
    },
  });
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({ extensionUri: { scheme: 'file', path: '/extension' } });
  const panel = createPanelMock(messages, { disposeCalls, viewColumn: 1 });

  await provider.resolveCustomTextEditor(document, panel, {});
  await panel.fireMessage({ type: 'closeActiveEditor' });

  assert.deepEqual(closedTabs, [noteTab]);
  assert.deepEqual(disposeCalls, []);
});

test('markdown editor provider saves before closing on webview saveAndClose messages', async () => {
  const messages = [];
  const saveCalls = [];
  const disposeCalls = [];
  const vscode = createVscodeMock();
  const { MarkdownEditorProvider } = loadTsModule('src/markdownEditorProvider.ts', { vscode });
  const provider = new MarkdownEditorProvider({
    extensionUri: { scheme: 'file', path: '/extension' },
    workspaceState: createStorageMock(),
  });
  const panel = createPanelMock(messages, { disposeCalls });
  const document = createDocumentMock({
    save: async () => {
      saveCalls.push('save');
      return true;
    },
  });

  await provider.resolveCustomTextEditor(document, panel, {});
  await panel.fireMessage({ type: 'saveAndClose' });

  assert.deepEqual(saveCalls, ['save']);
  assert.equal(disposeCalls.length, 1);
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
    constructor() {
      this.replacements = [];
    }
    replace(uri, range, text) {
      this.replacements.push({ uri, range, text });
    }
  }
  return {
    Uri: {
      parse: value => ({ toString: () => value }),
      file: fsPath => createUri(fsPath),
      joinPath: (base, ...segments) => createUri([base.fsPath ?? base.path ?? '', ...segments].join('/').replace(/\/+/g, '/')),
    },
    workspace: {
      fs: {
        rename: async (...args) => {
          options.renameCalls?.push(args);
        },
      },
      onDidChangeTextDocument: callback => {
        if (options.onDidChangeTextDocument) {
          return options.onDidChangeTextDocument(callback);
        }
        return { dispose() {} };
      },
      onDidChangeConfiguration: () => ({ dispose() {} }),
      getConfiguration: section => ({
        get: (key, fallback) => {
          if (section === 'editor' && Object.prototype.hasOwnProperty.call(editorConfig, key)) {
            return editorConfig[key];
          }
          return fallback;
        },
      }),
      applyEdit: options.applyEdit ?? (async () => true),
      openTextDocument: async (...args) => {
        options.openTextDocumentCalls?.push(args);
        return options.document ?? createOpenDocumentMock(args[0]);
      },
      findFiles: async (...args) => {
        options.findFilesCalls?.push({
          pattern: args[0]?.pattern,
          excludePattern: args[1]?.pattern,
        });
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
    env: {
      openExternal: async (...args) => {
        options.openExternalCalls?.push(args);
        return true;
      },
      clipboard: {
        writeText: async text => options.clipboardWrites?.push(text),
      },
    },
    window: {
      showErrorMessage: () => undefined,
      showInformationMessage: message => {
        options.informationMessages?.push(message);
        return undefined;
      },
      showTextDocument: async () => ({
        selection: null,
        revealRange() {},
      }),
      tabGroups: options.tabGroups ?? (options.activeTabUri
        ? {
            activeTabGroup: {
              activeTab: { input: { uri: options.activeTabUri } },
            },
          }
        : undefined),
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
  let text = options.text ?? '# Note\n';
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
    isUntitled: options.isUntitled ?? false,
    isClosed: false,
    getText: () => text,
    setText: nextText => {
      text = nextText;
    },
    get lineCount() {
      return text.split('\n').length;
    },
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
    active: options.active ?? true,
    visible: true,
    viewColumn: options.viewColumn,
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
    dispose: () => {
      options.disposeCalls?.push(undefined);
    },
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
