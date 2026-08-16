import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('workspace lint ignores generated SDD evidence', async () => {
  const workspaceRoot = resolve(packageRoot, '..', '..');
  const eslint = new ESLint({ cwd: workspaceRoot });

  assert.equal(
    await eslint.isPathIgnored(
      resolve(workspaceRoot, '.superpowers/sdd/generated/evidence.mjs'),
    ),
    true,
  );
  assert.equal(
    await eslint.isPathIgnored(join(packageRoot, 'src', 'extension.ts')),
    false,
  );
});

test('lint permits only the intentional Ask PDF deferral marker', async () => {
  const sourcePath = join(packageRoot, 'src', 'extension.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const eslint = new ESLint();

  const [allowed] = await eslint.lintText(source, { filePath: sourcePath });
  assert.equal(allowed.errorCount, 0);
  assert.equal(allowed.warningCount, 0);

  const [unrelatedTodo] = await eslint.lintText(
    `${source}\n// eslint-disable-next-line no-warning-comments\n// TODO(unrelated): must fail\n`,
    { filePath: sourcePath },
  );
  assert.ok(unrelatedTodo.messages.some(
    message => message.ruleId === 'workspace-deferral/only-intentional-todo',
  ));

  const [inlineDisable] = await eslint.lintText(
    `${source}\n// eslint-disable-next-line no-warning-comments\nvoid 0;\n`,
    { filePath: sourcePath },
  );
  assert.ok(inlineDisable.messages.some(
    message => message.message.includes('has no effect because you have \'noInlineConfig\''),
  ));
});

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
    if (request === './agentHandoff') {
      return {
        createAgentSurfaceCapabilitySource: () => ({
          onDidChange: () => ({ dispose() {} }),
          read: () => ({ cursorAgent: false, providers: [] }),
          refresh: async () => undefined,
          dispose() {},
        }),
        handoffSelectionToAgent: async () => undefined,
        handoffSelectionToAgentId: async () => false,
        handoffSelectionToCursor: async () => false,
        ...(mocks[request] ?? {}),
      };
    }
    if (request === './agentClipboard') {
      return mocks[request] ?? {
        formatMarkdownAgentReference: (relativePath, startLine, endLine) =>
          `@${relativePath}#${startLine === endLine ? startLine : `${startLine}-${endLine}`}`,
      };
    }
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
        PDF_DISCUSSION_MAX_PNG_BYTES: 5 * 1024 * 1024,
        PDF_DISCUSSION_WORKSPACE_TRUST_MESSAGE:
          'Trust this workspace before using Ask PDF with Codex.',
        PdfDiscussionController: class {
          dispose() {}
        },
      };
    }
    if (request === './cursorCrop') {
      return {
        validateCursorCropPng: value => value instanceof Uint8Array
          ? value
          : undefined,
      };
    }
    if (request === './cursorBrowserSelection') {
      return {
        captureActiveCursorBrowserSelection: async () => undefined,
        cursorBrowserCaptureToSelectionContext: capture => capture,
      };
    }
    if (request === './anchorUris') {
      return {
        llmWikiAnchorTarget: uri => {
          if (
            uri.scheme !== 'cursor'
            || uri.authority !== 'llm-wiki.llm-wiki-vscode'
            || uri.path !== '/open-anchor'
          ) return undefined;
          const encoded = new URLSearchParams(uri.query).get('target') ?? '';
          return encoded.startsWith('v1.')
            ? Buffer.from(encoded.slice(3), 'base64url').toString('utf8')
            : undefined;
        },
      };
    }
    if (request === './anchorFileEditorProvider') {
      return {
        registerAnchorFileEditorProvider: () => undefined,
      };
    }
    if (request === './experimentalOwnedBrowser') {
      return {
        registerExperimentalOwnedBrowser: () => ({ dispose() {} }),
      };
    }
    if (request === './learningNoteStore') {
      return {
        LearningNoteStore: class {},
      };
    }
    if (request === './dailyNotes') {
      return {
        generateDailyNote: async () => ({
          absolutePath: '/vault/wiki/daily/2026-01-01.md',
          relativePath: 'wiki/daily/2026-01-01.md',
          dueReviews: [],
          carriedTodos: [],
        }),
      };
    }
    if (request === './filesystemWiki') {
      return {
        loadFilesystemWiki: async () => ({ documents: [], links: [] }),
        getConceptGraph: () => ({ nodes: [], edges: [] }),
      };
    }
    if (request === './knowledgeGraphPanel') {
      return {
        KnowledgeGraphPanel: class {
          show() {}
          dispose() {}
        },
      };
    }
    if (request === './repositorySync') {
      return {
        syncRepository: async () => ({
          status: 'up-to-date',
          before: {},
          after: {},
          changed: false,
          requiresConfirmation: false,
        }),
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

test('activation reopens an already-open markdown vault note in the custom editor', async () => {
  const executeCommandCalls = [];
  const activeDocumentUri = { fsPath: '/vault/notes/Concepts/FlashAttention.md', scheme: 'file' };
  let outlineRegisterCount = 0;
  const vscode = createVscodeMock({ executeCommandCalls, activeDocumentUri });

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@llm-wiki/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'llm-wiki.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'llm-wiki.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => {
        outlineRegisterCount += 1;
      },
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `llm-wiki://note/${value}` },
  });

  const context = {
    subscriptions: [],
  };

  activate(context);
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(
    executeCommandCalls.find(([command]) => command === 'vscode.openWith'),
    [
      'vscode.openWith',
      activeDocumentUri,
      'llm-wiki.markdownEditor',
    ],
  );
  assert.equal(outlineRegisterCount, 1);
});

test('activation persistently routes an associated untitled Markdown document without changing its URI', async () => {
  const executeCommandCalls = [];
  const vscode = createVscodeMock({ executeCommandCalls, activeDocumentUri: undefined });
  const { activate } = loadTsModule('src/extension.ts', createActivationMocks({ vscode }));
  const associatedUntitledUri = {
    scheme: 'untitled',
    fsPath: '/vault/notes/Draft.md',
    path: '/vault/notes/Draft.md',
    toString: () => 'untitled:/vault/notes/Draft.md',
  };

  activate({ subscriptions: [] });
  vscode.__fireOpenDocument({ uri: associatedUntitledUri, languageId: 'markdown' });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(
    executeCommandCalls.filter(([command]) => command === 'vscode.openWith'),
    [['vscode.openWith', associatedUntitledUri, 'llm-wiki.markdownEditor']],
  );
});

test('activation leaves generic untitled Markdown buffers with the native editor', async () => {
  const executeCommandCalls = [];
  const vscode = createVscodeMock({ executeCommandCalls, activeDocumentUri: undefined });
  const { activate } = loadTsModule('src/extension.ts', createActivationMocks({ vscode }));

  activate({ subscriptions: [] });
  vscode.__fireOpenDocument({
    uri: {
      scheme: 'untitled',
      fsPath: 'Untitled-1',
      path: 'Untitled-1',
      toString: () => 'untitled:Untitled-1',
    },
    languageId: 'markdown',
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(executeCommandCalls.filter(([command]) => command === 'vscode.openWith'), []);
});

test('activation routes product URI anchor links through the LLM Wiki dispatcher', async () => {
  const dispatchCalls = [];
  const warningMessages = [];
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    warningMessages,
  });
  const mocks = createActivationMocks({ vscode });
  mocks['./uriDispatcher'] = {
    dispatchUri: async (...args) => {
      dispatchCalls.push(args);
    },
  };
  const { activate } = loadTsModule('src/extension.ts', mocks);

  activate({ subscriptions: [] });

  assert.equal(vscode.__registeredUriHandlers.length, 1);
  const target =
    'raw/pdf/ddia.pdf#page=25:~:text=The%20Internet%20was%20done%20so%20well';
  const encodedTarget = `v1.${Buffer.from(target, 'utf8').toString('base64url')}`;
  await vscode.__registeredUriHandlers[0].handleUri({
    scheme: 'cursor',
    authority: 'llm-wiki.llm-wiki-vscode',
    path: '/open-anchor',
    query: `target=${encodedTarget}`,
  });
  await vscode.__registeredUriHandlers[0].handleUri({
    scheme: 'cursor',
    authority: 'llm-wiki.llm-wiki-vscode',
    path: '/unexpected',
    query: `target=${encodedTarget}`,
  });

  assert.deepEqual(dispatchCalls, [['/vault', target]]);
  assert.deepEqual(warningMessages, ['This LLM Wiki link is invalid.']);
});

test('activation registers one multi-root-aware immutable anchor-file bridge', () => {
  const registrations = [];
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
  });
  const mocks = createActivationMocks({ vscode });
  mocks['./anchorFileEditorProvider'] = {
    registerAnchorFileEditorProvider: (context, options) => {
      registrations.push({ context, options });
    },
  };
  const { activate } = loadTsModule('src/extension.ts', mocks);
  const context = { subscriptions: [] };

  activate(context);

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].context, context);
  assert.equal(registrations[0].options, undefined);
});

test('Copy for Agent routes a PDF title action to the active webview without export or provider handoff', async () => {
  let copyRequests = 0;
  const pdfUri = { fsPath: '/vault/raw/papers/attention.pdf', scheme: 'file' };
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    activeTabUri: pdfUri,
    activeTabViewType: 'llm-wiki.pdfViewer',
  });
  const mocks = createActivationMocks({ vscode });
  mocks['./agentContext'] = {
    addSelectionToContext: async () => assert.fail('Copy for Agent must not export a selection'),
  };
  mocks['./agentHandoff'] = {
    handoffSelectionToAgent: async () => assert.fail('Copy for Agent must not open a provider'),
    handoffSelectionToCursor: async () => assert.fail('Copy for Agent must not open Cursor Chat'),
  };
  mocks['./pdfEditorProvider'] = {
    PdfEditorProvider: class {
      static viewType = 'llm-wiki.pdfViewer';
      getActiveWebview() { return undefined; }
      async copySelectionForAgent() {
        copyRequests += 1;
        return true;
      }
    },
  };

  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({ subscriptions: [] });

  assert.equal(vscode.__registeredCommands['llm-wiki.addSelectionToContext'], undefined);
  assert.equal(await vscode.__registeredCommands['llm-wiki.copySelectionForAgent'](), true);
  assert.equal(copyRequests, 1);
});

test('legacy provider-specific Markdown selection command is absent', () => {
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
  });
  const { activate } = loadTsModule('src/extension.ts', createActivationMocks({ vscode }));

  activate({ subscriptions: [] });

  assert.equal(vscode.__registeredCommands['llm-wiki.addSelectionToContext'], undefined);
  assert.equal(vscode.__registeredCommands['llm-wiki.addSelectionToAgent'], undefined);
});

test('Copy for Agent copies a multi-line Markdown reference without export or handoff', async () => {
  const clipboardWrites = [];
  const exportCalls = [];
  const handoffCalls = [];
  const informationMessages = [];
  const uri = { scheme: 'file', fsPath: '/vault/notes/source.md' };
  const selection = {
    uri,
    text: 'selected',
    startLine: 12,
    endLine: 14,
    metadata: { kind: 'markdown' },
  };
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    activeTabUri: uri,
    activeTabViewType: 'llm-wiki.markdownEditor',
    informationMessages,
  });
  vscode.env.clipboard = {
    writeText: async text => clipboardWrites.push(text),
  };
  const mocks = createActivationMocks({ vscode });
  mocks['./agentContext'] = {
    addSelectionToContext: async (...args) => {
      exportCalls.push(args);
      return undefined;
    },
  };
  mocks['./agentHandoff'] = {
    handoffSelectionToAgent: async (...args) => {
      handoffCalls.push(args);
      return 'codex';
    },
  };
  mocks['./markdownEditorProvider'] = {
    MarkdownEditorProvider: class {
      static viewType = 'llm-wiki.markdownEditor';
      async captureActiveSelectionContext() { return selection; }
    },
  };
  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({ subscriptions: [] });

  const copied = await vscode.__registeredCommands['llm-wiki.copySelectionForAgent']();

  assert.equal(copied, true);
  assert.deepEqual(clipboardWrites, ['@notes/source.md#12-14']);
  assert.equal(exportCalls.length, 0);
  assert.equal(handoffCalls.length, 0);
  assert.equal(informationMessages.at(-1), 'Selection copied for agent.');
});

test('Copy for Agent formats a single-line Markdown selection without a range suffix', async () => {
  const clipboardWrites = [];
  const uri = { scheme: 'file', fsPath: '/vault/notes/source.md' };
  const selection = {
    uri,
    text: 'selected',
    startLine: 12,
    endLine: 12,
    metadata: { kind: 'markdown' },
  };
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    activeTabUri: uri,
    activeTabViewType: 'llm-wiki.markdownEditor',
  });
  vscode.env.clipboard = {
    writeText: async text => clipboardWrites.push(text),
  };
  const mocks = createActivationMocks({ vscode });
  mocks['./markdownEditorProvider'] = {
    MarkdownEditorProvider: class {
      static viewType = 'llm-wiki.markdownEditor';
      async captureActiveSelectionContext() { return selection; }
    },
  };
  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({ subscriptions: [] });

  assert.equal(await vscode.__registeredCommands['llm-wiki.copySelectionForAgent'](), true);
  assert.deepEqual(clipboardWrites, ['@notes/source.md#12']);
});

test('dirty Markdown copy saves and recaptures the source range before writing the reference', async () => {
  const clipboardWrites = [];
  const saveCalls = [];
  const uri = { scheme: 'file', fsPath: '/vault/notes/source.md' };
  let dirty = true;
  let saved = false;
  const beforeSave = {
    uri,
    text: 'selected before save',
    startLine: 3,
    endLine: 3,
    metadata: { kind: 'markdown' },
  };
  const afterSave = {
    ...beforeSave,
    text: 'selected after save',
    startLine: 12,
    endLine: 14,
  };
  const document = {
    uri,
    get isDirty() { return dirty; },
    save: async () => {
      saveCalls.push('save');
      dirty = false;
      saved = true;
      return true;
    },
  };
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    activeTabUri: uri,
    activeTabViewType: 'llm-wiki.markdownEditor',
  });
  vscode.workspace.textDocuments = [document];
  vscode.env.clipboard = {
    writeText: async text => clipboardWrites.push(text),
  };
  const mocks = createActivationMocks({ vscode });
  mocks['./markdownEditorProvider'] = {
    MarkdownEditorProvider: class {
      static viewType = 'llm-wiki.markdownEditor';
      async captureActiveSelectionContext() { return saved ? afterSave : beforeSave; }
    },
  };
  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({ subscriptions: [] });

  assert.equal(await vscode.__registeredCommands['llm-wiki.copySelectionForAgent'](), true);
  assert.deepEqual(saveCalls, ['save']);
  assert.deepEqual(clipboardWrites, ['@notes/source.md#12-14']);
});

test('Markdown copy aborts with the select warning when post-save recapture rejects', async () => {
  const clipboardWrites = ['existing clipboard'];
  const warnings = [];
  const uri = { scheme: 'file', fsPath: '/vault/notes/source.md' };
  let dirty = true;
  let captureCount = 0;
  const selection = {
    uri,
    text: 'selected',
    startLine: 2,
    endLine: 2,
    metadata: { kind: 'markdown' },
  };
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    activeTabUri: uri,
    activeTabViewType: 'llm-wiki.markdownEditor',
    warningMessages: warnings,
  });
  vscode.workspace.textDocuments = [{
    uri,
    get isDirty() { return dirty; },
    save: async () => {
      dirty = false;
      return true;
    },
  }];
  vscode.env.clipboard = {
    writeText: async text => clipboardWrites.push(text),
  };
  const mocks = createActivationMocks({ vscode });
  mocks['./markdownEditorProvider'] = {
    MarkdownEditorProvider: class {
      static viewType = 'llm-wiki.markdownEditor';
      async captureActiveSelectionContext() {
        captureCount += 1;
        if (captureCount === 1) return selection;
        throw new Error('webview selection request failed');
      }
    },
  };
  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({ subscriptions: [] });

  assert.equal(await vscode.__registeredCommands['llm-wiki.copySelectionForAgent'](), false);
  assert.equal(captureCount, 2);
  assert.deepEqual(clipboardWrites, ['existing clipboard']);
  assert.deepEqual(warnings, ['Select Markdown text before copying for agent.']);
});

test('dirty custom Markdown copy flushes queued webview edits before saving and recapturing', async () => {
  const clipboardWrites = [];
  const events = [];
  const uri = { scheme: 'file', fsPath: '/vault/notes/source.md' };
  let dirty = true;
  let flushed = false;
  const beforeFlush = {
    uri,
    text: 'selected before edit',
    startLine: 2,
    endLine: 2,
    metadata: { kind: 'markdown' },
  };
  const afterFlush = {
    ...beforeFlush,
    text: 'selected after edit',
    startLine: 12,
    endLine: 14,
  };
  const document = {
    uri,
    get isDirty() { return dirty; },
    save: async () => {
      events.push('save');
      dirty = false;
      return true;
    },
  };
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    activeTabUri: uri,
    activeTabViewType: 'llm-wiki.markdownEditor',
  });
  vscode.workspace.textDocuments = [document];
  vscode.env.clipboard = {
    writeText: async text => clipboardWrites.push(text),
  };
  const mocks = createActivationMocks({ vscode });
  mocks['./markdownEditorProvider'] = {
    MarkdownEditorProvider: class {
      static viewType = 'llm-wiki.markdownEditor';
      async flushActiveEditsBeforeSave(selectionUri) {
        events.push(['flush', selectionUri]);
        flushed = true;
        return true;
      }
      async captureActiveSelectionContext() { return flushed ? afterFlush : beforeFlush; }
    },
  };
  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({ subscriptions: [] });

  assert.equal(await vscode.__registeredCommands['llm-wiki.copySelectionForAgent'](), true);
  assert.deepEqual(events, [['flush', uri], 'save']);
  assert.deepEqual(clipboardWrites, ['@notes/source.md#12-14']);
});

test('Markdown copy rejects an out-of-workspace reference without changing the clipboard', async () => {
  const clipboardWrites = ['existing clipboard'];
  const warnings = [];
  const uri = { scheme: 'file', fsPath: '/outside/source.md' };
  const selection = {
    uri,
    text: 'selected',
    startLine: 2,
    endLine: 2,
    metadata: { kind: 'markdown' },
  };
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    activeTabUri: uri,
    activeTabViewType: 'llm-wiki.markdownEditor',
    warningMessages: warnings,
  });
  vscode.workspace.asRelativePath = () => '/outside/source.md';
  vscode.env.clipboard = {
    writeText: async text => clipboardWrites.push(text),
  };
  const mocks = createActivationMocks({ vscode });
  mocks['./agentClipboard'] = {
    formatMarkdownAgentReference: relativePath => {
      if (relativePath.startsWith('/')) {
        throw new TypeError('Markdown agent reference path must be workspace-relative.');
      }
      return '@notes/source.md#2';
    },
  };
  mocks['./markdownEditorProvider'] = {
    MarkdownEditorProvider: class {
      static viewType = 'llm-wiki.markdownEditor';
      async captureActiveSelectionContext() { return selection; }
    },
  };
  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({ subscriptions: [] });

  assert.equal(await vscode.__registeredCommands['llm-wiki.copySelectionForAgent'](), false);
  assert.deepEqual(clipboardWrites, ['existing clipboard']);
  assert.deepEqual(warnings, [
    'Save the Markdown note inside the current workspace before copying for agent.',
  ]);
});

test('untitled Markdown copy leaves the clipboard unchanged and asks the user to save first', async () => {
  const clipboardWrites = ['existing clipboard'];
  const warnings = [];
  const uri = { scheme: 'untitled', fsPath: '/vault/notes/source.md' };
  const selection = {
    uri,
    text: 'draft',
    startLine: 2,
    endLine: 2,
    metadata: { kind: 'markdown' },
  };
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    activeTabUri: uri,
    activeTabViewType: 'llm-wiki.markdownEditor',
    warningMessages: warnings,
  });
  vscode.env.clipboard = {
    writeText: async text => clipboardWrites.push(text),
  };
  const mocks = createActivationMocks({ vscode });
  mocks['./markdownEditorProvider'] = {
    MarkdownEditorProvider: class {
      static viewType = 'llm-wiki.markdownEditor';
      async captureActiveSelectionContext() { return selection; }
    },
  };
  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({ subscriptions: [] });

  assert.equal(await vscode.__registeredCommands['llm-wiki.copySelectionForAgent'](), false);
  assert.deepEqual(clipboardWrites, ['existing clipboard']);
  assert.deepEqual(warnings, ['Save this Markdown note before copying for agent.']);
});

test('failed dirty Markdown copy leaves the clipboard unchanged and shows the save warning', async () => {
  const clipboardWrites = ['existing clipboard'];
  const warnings = [];
  const uri = { scheme: 'file', fsPath: '/vault/notes/source.md' };
  const selection = {
    uri,
    text: 'selected',
    startLine: 2,
    endLine: 2,
    metadata: { kind: 'markdown' },
  };
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    activeTabUri: uri,
    activeTabViewType: 'llm-wiki.markdownEditor',
    warningMessages: warnings,
  });
  vscode.workspace.textDocuments = [{
    uri,
    isDirty: true,
    save: async () => false,
  }];
  vscode.env.clipboard = {
    writeText: async text => clipboardWrites.push(text),
  };
  const mocks = createActivationMocks({ vscode });
  mocks['./markdownEditorProvider'] = {
    MarkdownEditorProvider: class {
      static viewType = 'llm-wiki.markdownEditor';
      async captureActiveSelectionContext() { return selection; }
    },
  };
  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({ subscriptions: [] });

  assert.equal(await vscode.__registeredCommands['llm-wiki.copySelectionForAgent'](), false);
  assert.deepEqual(clipboardWrites, ['existing clipboard']);
  assert.deepEqual(warnings, ['Save the Markdown note before copying for agent.']);
});

test('empty Markdown copy leaves the clipboard unchanged and shows the select warning', async () => {
  const clipboardWrites = ['existing clipboard'];
  const warnings = [];
  const uri = { scheme: 'file', fsPath: '/vault/notes/source.md' };
  const selection = {
    uri,
    text: '',
    startLine: 2,
    endLine: 2,
    metadata: { kind: 'markdown' },
  };
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    activeTabUri: uri,
    activeTabViewType: 'llm-wiki.markdownEditor',
    warningMessages: warnings,
  });
  vscode.env.clipboard = {
    writeText: async text => clipboardWrites.push(text),
  };
  const mocks = createActivationMocks({ vscode });
  mocks['./markdownEditorProvider'] = {
    MarkdownEditorProvider: class {
      static viewType = 'llm-wiki.markdownEditor';
      async captureActiveSelectionContext() { return selection; }
    },
  };
  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({ subscriptions: [] });

  assert.equal(await vscode.__registeredCommands['llm-wiki.copySelectionForAgent'](), false);
  assert.deepEqual(clipboardWrites, ['existing clipboard']);
  assert.deepEqual(warnings, ['Select Markdown text before copying for agent.']);
});

test('Add to Chat stays Cursor-only while provider-specific selection commands are absent', async () => {
  const exports = [];
  const cursorCalls = [];
  const attachmentSyncs = [];
  const markdownSelection = {
    uri: { fsPath: '/vault/notes/attention.md', scheme: 'file' },
    text: 'Markdown passage',
    startLine: 4,
    endLine: 4,
    metadata: { kind: 'markdown' },
  };
  const pdfSelection = {
    uri: { fsPath: '/vault/raw/papers/attention.pdf', scheme: 'file' },
    text: 'FlashAttention uses tiling',
    startLine: 2,
    endLine: 2,
    sourceLabel: 'raw/papers/attention.pdf',
    rangeLabel: 'page 2',
  };
  const snapshotPng = Uint8Array.from([10, 20, 30]);
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    activeTabUri: markdownSelection.uri,
    activeTabViewType: 'llm-wiki.markdownEditor',
  });
  const mocks = createActivationMocks({ vscode });
  mocks['./agentContext'] = {
    addSelectionToContext: async (vaultRoot, options) => {
      exports.push({
        vaultRoot,
        selection: await options.getActiveSelectionContext(),
      });
      const directoryPath = `/vault/.llm_wiki/agent/exports/export-${exports.length}`;
      return {
        directoryPath,
        markdownPath: `${directoryPath}/selection.md`,
        jsonPath: `${directoryPath}/selection.json`,
      };
    },
    syncSelectionExportAttachment: async (exported, fileName, bytes) => {
      attachmentSyncs.push({ exported, fileName, bytes });
      return bytes ? `${exported.directoryPath}/${fileName}` : undefined;
    },
  };
  mocks['./cursorCrop'] = {
    validateCursorCropPng: value => value === snapshotPng
      ? snapshotPng
      : undefined,
  };
  mocks['./agentHandoff'] = {
    handoffSelectionToCursor: async (context, attachments) => {
      cursorCalls.push({
        markdownPath: context.uri.fsPath,
        attachments: attachments.map(uri => uri.fsPath),
      });
      return true;
    },
  };
  mocks['./pdfEditorProvider'] = {
    PdfEditorProvider: class {
      static viewType = 'llm-wiki.pdfViewer';
      constructor() {}
      getActiveWebview() {
        return undefined;
      }
    },
  };
  mocks['./markdownEditorProvider'] = {
    MarkdownEditorProvider: class {
      static viewType = 'llm-wiki.markdownEditor';
      async captureActiveSelectionContext() {
        return markdownSelection;
      }
    },
  };

  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({ subscriptions: [] });

  assert.equal(vscode.__registeredCommands['llm-wiki.addSelectionToContext'], undefined);
  assert.equal(vscode.__registeredCommands['llm-wiki.addSelectionToAgent'], undefined);
  await vscode.__registeredCommands['llm-wiki.addSelectionToChat']();
  await vscode.__registeredCommands['llm-wiki.addSelectionToChat']({
    selection: pdfSelection,
    snapshotPng,
  });
  await vscode.__registeredCommands['llm-wiki.addSelectionToCursorChat']({
    selection: pdfSelection,
    snapshotPng,
  });

  assert.deepEqual(exports, [
    { vaultRoot: '/vault', selection: pdfSelection },
    { vaultRoot: '/vault', selection: pdfSelection },
  ]);
  assert.deepEqual(cursorCalls, [
    {
      markdownPath: '/vault/notes/attention.md',
      attachments: [],
    },
    {
      markdownPath: '/vault/.llm_wiki/agent/exports/export-1/selection.md',
      attachments: ['/vault/.llm_wiki/agent/exports/export-1/selection.png'],
    },
    {
      markdownPath: '/vault/.llm_wiki/agent/exports/export-2/selection.md',
      attachments: ['/vault/.llm_wiki/agent/exports/export-2/selection.png'],
    },
  ]);
  assert.deepEqual(
    attachmentSyncs.map(({ exported, fileName, bytes }) => ({
      directoryPath: exported.directoryPath,
      fileName,
      bytes,
    })),
    [
      {
        directoryPath: '/vault/.llm_wiki/agent/exports/export-1',
        fileName: 'selection.png',
        bytes: snapshotPng,
      },
      {
        directoryPath: '/vault/.llm_wiki/agent/exports/export-2',
        fileName: 'selection.png',
        bytes: snapshotPng,
      },
    ],
  );
});

test('activation provides the Cursor capability to PDF hosts and sets the product context', () => {
  for (const cursorAgent of [false, true]) {
    const executeCommandCalls = [];
    const providerOptions = [];
    const providerActivations = [];
    const vscode = createVscodeMock({
      executeCommandCalls,
      activeDocumentUri: undefined,
    });
    vscode.extensions = {
      getExtension: id => ({
        id,
        isActive: false,
        activate: async () => providerActivations.push(id),
      }),
      onDidChange: () => ({ dispose() {} }),
    };
    const snapshot = { cursorAgent, providers: [{ id: 'codex', label: 'Codex' }] };
    let sourceReadCount = 0;
    let sourceCreateCount = 0;
    const onDidChange = () => ({ dispose() {} });
    const source = {
      onDidChange,
      read() {
        sourceReadCount += 1;
        return snapshot;
      },
      refresh: async () => undefined,
      dispose() {},
    };
    const mocks = createActivationMocks({ vscode });
    mocks['./agentHandoff'] = {
      createAgentSurfaceCapabilitySource: () => {
        sourceCreateCount += 1;
        return source;
      },
      handoffSelectionToAgent: async () => undefined,
      handoffSelectionToCursor: async () => false,
    };
    mocks['./pdfEditorProvider'] = {
      PdfEditorProvider: class {
        static viewType = 'llm-wiki.pdfViewer';
        constructor(_context, options) {
          providerOptions.push(options);
        }
        getActiveWebview() {
          return undefined;
        }
      },
    };

    const { activate } = loadTsModule('src/extension.ts', mocks);
    const context = { subscriptions: [] };
    activate(context);

    assert.equal(sourceCreateCount, 1);
    assert.ok(context.subscriptions.includes(source));
    assert.deepEqual(providerOptions[0].agentCapabilities(), snapshot);
    assert.equal(providerOptions[0].onDidChangeAgentCapabilities, onDidChange);
    assert.equal(sourceReadCount, 2);
    assert.deepEqual(providerActivations, []);
    assert.deepEqual(
      executeCommandCalls.find(
        ([command, key]) => command === 'setContext' && key === 'llmWikiHostIsCursor',
      ),
      ['setContext', 'llmWikiHostIsCursor', cursorAgent],
    );
  }
});

test('PDF Cmd-L asks the active webview for the same crop-aware agent handoff', async () => {
  let requested = 0;
  const pdfUri = { fsPath: '/vault/raw/papers/attention.pdf', scheme: 'file' };
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    activeTabUri: pdfUri,
    activeTabViewType: 'llm-wiki.pdfViewer',
  });
  const mocks = createActivationMocks({ vscode });
  mocks['./agentContext'] = {
    addSelectionToContext: async () => assert.fail('Host must let the PDF webview capture its crop'),
  };
  mocks['./pdfEditorProvider'] = {
    PdfEditorProvider: class {
      static viewType = 'llm-wiki.pdfViewer';
      async addSelectionToCursorChat() {
        requested += 1;
      }
      getActiveWebview() {
        return undefined;
      }
    },
  };

  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({ subscriptions: [] });
  await vscode.__registeredCommands['llm-wiki.addSelectionToChat']();

  assert.equal(requested, 1);
});

test('Cursor handoff marks agent focus and Escape restores the Markdown editor', async () => {
  const executeCommandCalls = [];
  const markdownSelection = {
    uri: { fsPath: '/vault/notes/attention.md', scheme: 'file' },
    text: 'Selected Markdown passage',
    startLine: 4,
    endLine: 5,
    metadata: { kind: 'markdown' },
  };
  let focusCalls = 0;
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri: undefined,
    activeTabUri: markdownSelection.uri,
    activeTabViewType: 'llm-wiki.markdownEditor',
  });
  const mocks = createActivationMocks({ vscode });
  mocks['./agentHandoff'] = {
    handoffSelectionToCursor: async () => true,
  };
  mocks['./markdownEditorProvider'] = {
    MarkdownEditorProvider: class {
      static viewType = 'llm-wiki.markdownEditor';
      constructor() {}
      async captureActiveSelectionContext() {
        return markdownSelection;
      }
      async focusActiveEditor() {
        focusCalls += 1;
        return true;
      }
    },
  };

  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({ subscriptions: [] });

  await vscode.__registeredCommands['llm-wiki.addSelectionToChat']();
  assert.ok(executeCommandCalls.some(
    ([command, key, value]) => command === 'setContext'
      && key === 'llmWikiAgentHandoffActive'
      && value === true,
  ));

  await vscode.__registeredCommands['llm-wiki.focusMarkdownEditor']();
  assert.equal(focusCalls, 1);
  assert.ok(executeCommandCalls.some(
    ([command, key, value]) => command === 'setContext'
      && key === 'llmWikiAgentHandoffActive'
      && value === false,
  ));
});

test('Add to Chat falls back to immutable text when crop persistence fails', async () => {
  const cursorHandoffs = [];
  const warningMessages = [];
  const selection = {
    uri: { fsPath: '/vault/raw/papers/attention.pdf', scheme: 'file' },
    text: 'FlashAttention uses tiling',
    startLine: 2,
    endLine: 2,
  };
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    warningMessages,
  });
  const mocks = createActivationMocks({ vscode });
  mocks['./agentContext'] = {
    addSelectionToContext: async () => ({
      directoryPath: '/vault/.llm_wiki/agent/exports/export-1',
      markdownPath: '/vault/.llm_wiki/agent/exports/export-1/selection.md',
      jsonPath: '/vault/.llm_wiki/agent/exports/export-1/selection.json',
    }),
    syncSelectionExportAttachment: async () => {
      throw new Error('read-only filesystem');
    },
  };
  mocks['./cursorCrop'] = {
    validateCursorCropPng: value => value,
  };
  mocks['./agentHandoff'] = {
    handoffSelectionToCursor: async (context, attachments) => {
      cursorHandoffs.push({
        contextPath: context.uri.fsPath,
        attachmentPaths: attachments.map(uri => uri.fsPath),
      });
      return true;
    },
  };

  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({ subscriptions: [] });
  await vscode.__registeredCommands['llm-wiki.addSelectionToChat']({
    selection,
    snapshotPng: Uint8Array.from([10, 20, 30]),
  });

  assert.deepEqual(cursorHandoffs, [{
    contextPath: '/vault/.llm_wiki/agent/exports/export-1/selection.md',
    attachmentPaths: [],
  }]);
  assert.ok(warningMessages.includes(
    'The selection crop could not be saved; the active agent will use text context only.',
  ));
});

test('Cursor Browser selection is exported with its crop and routed to the active agent', async () => {
  const exports = [];
  const attachments = [];
  const handoffs = [];
  const snapshotPng = Uint8Array.from([137, 80, 78, 71]);
  const selection = {
    uri: { scheme: 'https', fsPath: '', toString: () => 'https://example.com/guide' },
    text: 'UNTRUSTED WEB CONTENT\n\nSelected passage:\n│ Browser passage',
    startLine: 1,
    endLine: 1,
    sourceLabel: 'https://example.com/guide',
    rangeLabel: 'web selection on example.com',
  };
  const capture = { snapshotPng, selectedText: 'Browser passage' };
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
  });
  const mocks = createActivationMocks({ vscode });
  mocks['./cursorBrowserSelection'] = {
    captureActiveCursorBrowserSelection: async () => capture,
    cursorBrowserCaptureToSelectionContext: value => {
      assert.equal(value, capture);
      return selection;
    },
  };
  mocks['./agentContext'] = {
    addSelectionToContext: async (vaultRoot, options) => {
      exports.push({ vaultRoot, selection: await options.getActiveSelectionContext() });
      return {
        directoryPath: '/vault/.llm_wiki/agent/exports/browser',
        markdownPath: '/vault/.llm_wiki/agent/exports/browser/selection.md',
        jsonPath: '/vault/.llm_wiki/agent/exports/browser/selection.json',
      };
    },
    syncSelectionExportAttachment: async (exported, fileName, bytes) => {
      attachments.push({ exported, fileName, bytes });
      return `${exported.directoryPath}/${fileName}`;
    },
  };
  mocks['./cursorCrop'] = {
    validateCursorCropPng: value => value,
  };
  mocks['./agentHandoff'] = {
    handoffSelectionToAgent: async (context, attachmentUris) => {
      handoffs.push({
        contextPath: context.uri.fsPath,
        attachmentPaths: attachmentUris.map(uri => uri.fsPath),
      });
      return 'codex';
    },
  };

  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({ subscriptions: [] });
  await vscode.__registeredCommands[
    'llm-wiki.addCursorBrowserSelectionToChat'
  ]();

  assert.deepEqual(exports, [{ vaultRoot: '/vault', selection }]);
  assert.equal(attachments[0].fileName, 'selection.png');
  assert.equal(attachments[0].bytes, snapshotPng);
  assert.deepEqual(handoffs, [{
    contextPath: '/vault/.llm_wiki/agent/exports/browser/selection.md',
    attachmentPaths: ['/vault/.llm_wiki/agent/exports/browser/selection.png'],
  }]);
});

test('experimental owned reader routes its validated text and synthetic crop through the same handoff', async () => {
  let browserOptions;
  const exports = [];
  const handoffs = [];
  const snapshotPng = Uint8Array.from([137, 80, 78, 71]);
  const selection = {
    uri: { scheme: 'https', fsPath: '', toString: () => 'https://example.com/article' },
    text: 'UNTRUSTED WEB CONTENT\n\nSelected passage:\n│ Reader passage',
    startLine: 1,
    endLine: 1,
    sourceLabel: 'https://example.com/article',
    rangeLabel: 'web selection on example.com',
  };
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
  });
  const mocks = createActivationMocks({ vscode });
  mocks['./experimentalOwnedBrowser'] = {
    registerExperimentalOwnedBrowser: options => {
      browserOptions = options;
      return { dispose() {} };
    },
  };
  mocks['./agentContext'] = {
    addSelectionToContext: async (vaultRoot, options) => {
      exports.push({ vaultRoot, selection: await options.getActiveSelectionContext() });
      return {
        directoryPath: '/vault/.llm_wiki/agent/exports/reader',
        markdownPath: '/vault/.llm_wiki/agent/exports/reader/selection.md',
        jsonPath: '/vault/.llm_wiki/agent/exports/reader/selection.json',
      };
    },
    syncSelectionExportAttachment: async (exported, fileName, bytes) =>
      bytes ? `${exported.directoryPath}/${fileName}` : undefined,
  };
  mocks['./cursorCrop'] = {
    validateCursorCropPng: value => value,
  };
  mocks['./agentHandoff'] = {
    handoffSelectionToAgent: async (context, attachmentUris) => {
      handoffs.push({
        contextPath: context.uri.fsPath,
        attachmentPaths: attachmentUris.map(uri => uri.fsPath),
      });
      return 'codebuddy';
    },
  };

  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({ subscriptions: [] });
  await browserOptions.onSendSelection({
    selection,
    attachment: { bytes: snapshotPng, mediaType: 'image/png' },
    screenshotStatus: 'captured',
  });

  assert.deepEqual(exports, [{ vaultRoot: '/vault', selection }]);
  assert.deepEqual(handoffs, [{
    contextPath: '/vault/.llm_wiki/agent/exports/reader/selection.md',
    attachmentPaths: ['/vault/.llm_wiki/agent/exports/reader/selection.png'],
  }]);
});

test('activation reopens an already-open PDF vault file in the custom viewer', async () => {
  const executeCommandCalls = [];
  const activeDocumentUri = { fsPath: '/vault/raw/pdf/ddia.pdf', scheme: 'file' };
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri,
    activeDocumentLanguageId: 'plaintext',
  });

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@llm-wiki/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      addSelectionToContext: async () => undefined,
      syncSelectionExportAttachment: async () => undefined,
    },
    './cursorCrop': {
      validateCursorCropPng: value => value instanceof Uint8Array
        ? value
        : undefined,
    },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'llm-wiki.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'llm-wiki.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `llm-wiki://note/${value}` },
  });

  const context = {
    subscriptions: [],
  };

  activate(context);
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(
    executeCommandCalls.find(([command, uri]) =>
      command === 'vscode.openWith' && uri?.fsPath === activeDocumentUri.fsPath
    ),
    [
      'vscode.openWith',
      activeDocumentUri,
      'llm-wiki.pdfViewer',
    ],
  );
});

test('activation reopens a startup PDF when it becomes the active text editor after activation', async () => {
  const executeCommandCalls = [];
  const activeDocumentUri = { fsPath: '/vault/raw/pdf/ddia.pdf', scheme: 'file' };
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri: undefined,
  });

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@llm-wiki/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'llm-wiki.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'llm-wiki.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `llm-wiki://note/${value}` },
  });

  const context = {
    subscriptions: [],
  };

  activate(context);
  vscode.__fireActiveEditorChange({
    document: {
      uri: activeDocumentUri,
      languageId: 'plaintext',
    },
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(
    executeCommandCalls.find(([command, uri]) =>
      command === 'vscode.openWith' && uri?.fsPath === activeDocumentUri.fsPath
    ),
    [
      'vscode.openWith',
      activeDocumentUri,
      'llm-wiki.pdfViewer',
    ],
  );
});

test('activation retries reopening a startup PDF while VS Code keeps it in the text editor', async () => {
  const executeCommandCalls = [];
  const activeDocumentUri = { fsPath: '/vault/raw/pdf/ddia.pdf', scheme: 'file' };
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri,
    activeDocumentLanguageId: 'plaintext',
  });

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@llm-wiki/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'llm-wiki.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'llm-wiki.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `llm-wiki://note/${value}` },
  });

  const context = {
    subscriptions: [],
  };

  activate(context);
  await new Promise(resolve => setTimeout(resolve, 1300));

  const pdfReopenCalls = executeCommandCalls.filter(([command, uri, viewType]) =>
    command === 'vscode.openWith'
    && uri?.fsPath === activeDocumentUri.fsPath
    && viewType === 'llm-wiki.pdfViewer'
  );

  assert.ok(
    pdfReopenCalls.length >= 2,
    `expected at least two reopen attempts for the startup PDF, received ${pdfReopenCalls.length}`,
  );
});

test('custom-editor recovery uses short startup retries plus persistent document routing instead of polling', () => {
  const source = readFileSync(join(packageRoot, 'src', 'extension.ts'), 'utf8');

  assert.match(
    source,
    /STARTUP_CUSTOM_EDITOR_RETRY_DELAYS_MS\s*=\s*\[0,\s*250,\s*1_000\]/,
  );
  assert.match(source, /onDidOpenTextDocument/);
  assert.doesNotMatch(source, /STARTUP_CUSTOM_EDITOR_MONITOR_MS/);
  assert.doesNotMatch(source, /stopMonitoring/);
  assert.doesNotMatch(source, /\bsetInterval\s*\(/);
  assert.doesNotMatch(source, /\b20_000\b/);
});

test('activation reopens a startup PDF that is visible even when no active text editor is focused', async () => {
  const executeCommandCalls = [];
  const visiblePdfEditor = {
    document: {
      uri: { fsPath: '/vault/raw/pdf/ddia.pdf', scheme: 'file' },
      languageId: 'plaintext',
    },
  };
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri: undefined,
    visibleTextEditors: [visiblePdfEditor],
  });

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@llm-wiki/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'llm-wiki.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'llm-wiki.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `llm-wiki://note/${value}` },
  });

  const context = {
    subscriptions: [],
  };

  activate(context);
  await new Promise(resolve => setTimeout(resolve, 50));

  assert.deepEqual(
    executeCommandCalls.find(([command, uri, viewType]) =>
      command === 'vscode.openWith'
      && uri?.fsPath === '/vault/raw/pdf/ddia.pdf'
      && viewType === 'llm-wiki.pdfViewer'
    ),
    [
      'vscode.openWith',
      { fsPath: '/vault/raw/pdf/ddia.pdf', scheme: 'file' },
      'llm-wiki.pdfViewer',
    ],
  );
});

test('activation reopens a startup PDF tab even when VS Code has not created a text editor for it yet', async () => {
  const executeCommandCalls = [];
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri: undefined,
    visibleTextEditors: [],
    activeTabUri: { fsPath: '/vault/raw/pdf/ddia.pdf', scheme: 'file' },
  });

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@llm-wiki/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'llm-wiki.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'llm-wiki.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `llm-wiki://note/${value}` },
  });

  const context = {
    subscriptions: [],
  };

  activate(context);
  await new Promise(resolve => setTimeout(resolve, 50));

  assert.deepEqual(
    executeCommandCalls.find(([command, uri, viewType]) =>
      command === 'vscode.openWith'
      && uri?.fsPath === '/vault/raw/pdf/ddia.pdf'
      && viewType === 'llm-wiki.pdfViewer'
    ),
    [
      'vscode.openWith',
      { fsPath: '/vault/raw/pdf/ddia.pdf', scheme: 'file' },
      'llm-wiki.pdfViewer',
    ],
  );
});

test('activation registers a Vim mode toggle command for the markdown custom editor', async () => {
  const executeCommandCalls = [];
  let toggleCount = 0;
  const informationMessages = [];
  const activeDocumentUri = { fsPath: '/vault/notes/Concepts/FlashAttention.md', scheme: 'file' };
  const vscode = createVscodeMock({ executeCommandCalls, activeDocumentUri, informationMessages });

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@llm-wiki/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'llm-wiki.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'llm-wiki.markdownEditor';
        constructor() {}
        async toggleVimMode() {
          toggleCount += 1;
          return true;
        }
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `llm-wiki://note/${value}` },
  });

  const context = {
    subscriptions: [],
  };

  activate(context);
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.ok(vscode.__registeredCommands['llm-wiki.toggleVimMode']);
  await vscode.__registeredCommands['llm-wiki.toggleVimMode']();

  assert.equal(toggleCount, 1);
  assert.deepEqual(informationMessages.at(-1), 'LLM Wiki Vim mode enabled');
});

test('activation registers PDF view mode toggle commands', async () => {
  const pdfMessages = [];
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
  });
  const mocks = createActivationMocks({ vscode });
  mocks['./pdfEditorProvider'] = {
    PdfEditorProvider: class {
      static viewType = 'llm-wiki.pdfViewer';
      constructor() {}
      getActiveWebview() {
        return {
          postMessage: message => {
            pdfMessages.push(message);
            return true;
          },
        };
      }
    },
  };

  const { activate } = loadTsModule('src/extension.ts', mocks);

  activate({ subscriptions: [] });
  await vscode.__registeredCommands['llm-wiki.pdfToggleContinuousScroll']();
  await vscode.__registeredCommands['llm-wiki.pdfToggleTwoPageView']();

  assert.deepEqual(pdfMessages, [
    { type: 'toggleContinuousScroll' },
    { type: 'toggleTwoPageView' },
  ]);
});

test('activation registers the PDF toolbar recovery command', async () => {
  let toggleCalls = 0;
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
  });
  const mocks = createActivationMocks({ vscode });
  mocks['./pdfEditorProvider'] = {
    PdfEditorProvider: class {
      static viewType = 'llm-wiki.pdfViewer';
      async togglePdfToolbar() {
        toggleCalls += 1;
      }
      getActiveWebview() {
        return undefined;
      }
    },
  };

  const { activate } = loadTsModule('src/extension.ts', mocks);

  activate({ subscriptions: [] });
  assert.ok(vscode.__registeredCommands['llm-wiki.togglePdfToolbar']);
  await vscode.__registeredCommands['llm-wiki.togglePdfToolbar']();
  assert.equal(toggleCalls, 1);
});

test('openPdfMarkdownColumns command opens the active PDF beside an available markdown note', async () => {
  const executeCommandCalls = [];
  const pdfUri = { fsPath: '/vault/raw/pdf/ddia.pdf', scheme: 'file' };
  const markdownUri = { fsPath: '/vault/notes/Concepts/FlashAttention.md', scheme: 'file' };
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri: undefined,
    visibleTextEditors: [{
      document: {
        uri: markdownUri,
        languageId: 'markdown',
      },
    }],
  });
  const mocks = createActivationMocks({ vscode });
  mocks['./pdfEditorProvider'] = {
    PdfEditorProvider: class {
      static viewType = 'llm-wiki.pdfViewer';
      constructor() {}
      getActiveWebview() {
        return { pdfUri };
      }
    },
  };

  const { activate } = loadTsModule('src/extension.ts', mocks);

  activate({ subscriptions: [] });
  await vscode.__registeredCommands['llm-wiki.openPdfMarkdownColumns']();

  assert.deepEqual(executeCommandCalls.filter(([command]) => command === 'vscode.openWith'), [
    [
      'vscode.openWith',
      pdfUri,
      'llm-wiki.pdfViewer',
      vscode.ViewColumn.One,
    ],
    [
      'vscode.openWith',
      markdownUri,
      'llm-wiki.markdownEditor',
      vscode.ViewColumn.Beside,
    ],
  ]);
});

test('activation routes markdown link targets through the LLM Wiki dispatcher', async () => {
  const executeCommandCalls = [];
  const openExternalCalls = [];
  const dispatched = [];
  const vscode = createVscodeMock({
    executeCommandCalls,
    openExternalCalls,
  });

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@llm-wiki/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: (...args) => dispatched.push(args) },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'llm-wiki.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'llm-wiki.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `llm-wiki://note/${value}` },
  });

  activate({ subscriptions: [] });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.ok(vscode.__registeredCommands['llm-wiki.openLinkTarget']);
  await vscode.__registeredCommands['llm-wiki.openLinkTarget']('https://example.com/docs');

  assert.equal(openExternalCalls.length, 0);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0][0], '/vault');
  assert.equal(dispatched[0][1], 'https://example.com/docs');
  assert.deepEqual(dispatched[0][2], { allowAbsoluteTargets: true });
});

test('activation resolves link targets against the folder that owns the source document', async () => {
  const dispatched = [];
  const secondSourceUri = { fsPath: '/second/notes/Deep.md', scheme: 'file' };
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    activeTabUri: undefined,
  });
  vscode.workspace.workspaceFolders = [
    { uri: { fsPath: '/first' } },
    { uri: { fsPath: '/second' } },
  ];
  vscode.workspace.getWorkspaceFolder = uri => uri?.fsPath?.startsWith('/second/')
    ? { uri: { fsPath: '/second' } }
    : undefined;

  const { activate } = loadTsModule('src/extension.ts', {
    ...createActivationMocks({ vscode }),
    './uriDispatcher': { dispatchUri: (...args) => dispatched.push(args) },
  });
  activate({ subscriptions: [] });
  await new Promise(resolve => setTimeout(resolve, 0));

  await vscode.__registeredCommands['llm-wiki.openLinkTarget'](
    '/playbook/guide.md',
    secondSourceUri,
  );
  await vscode.__registeredCommands['llm-wiki.openLinkTarget'](
    '/playbook/guide.md',
    { fsPath: '/elsewhere/notes/Other.md', scheme: 'file' },
  );

  assert.deepEqual(dispatched.map(([root]) => root), ['/second', '/first']);
});

test('activation refreshes LLM Wiki side panes when the active custom editor tab changes', async () => {
  const executeCommandCalls = [];
  const providerInstances = [];
  const activeDocumentUri = { fsPath: '/vault/notes/Concepts/FlashAttention.md', scheme: 'file' };
  const vscode = createVscodeMock({ executeCommandCalls, activeDocumentUri });

  class TestTreeProvider {
    constructor(_vaultRoot, mode) {
      this.mode = mode;
      this.refreshCount = 0;
      providerInstances.push(this);
    }
    refresh() {
      this.refreshCount += 1;
    }
  }

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@llm-wiki/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      runMigrations: () => undefined,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': { BacklinksProvider: TestTreeProvider },
    './agentContext': {
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'llm-wiki.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'llm-wiki.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `llm-wiki://note/${value}` },
  });

  activate({ subscriptions: [] });
  await new Promise(resolve => setTimeout(resolve, 0));
  const refreshCountsAfterActivation = providerInstances.map(provider => provider.refreshCount);

  vscode.__fireTabChange({ changed: [], opened: [], closed: [] });

  assert.deepEqual(
    providerInstances.map(provider => provider.refreshCount),
    refreshCountsAfterActivation.map(count => count + 1),
  );
});

test('openInMarkdownEditor command opens the active custom markdown tab URI', async () => {
  const executeCommandCalls = [];
  const activeTabUri = { fsPath: '/vault/notes/Concepts/Online Softmax.md', scheme: 'file' };
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri: undefined,
    activeTabUri,
  });

  const { activate } = loadTsModule('src/extension.ts', createActivationMocks({ vscode }));

  activate({ subscriptions: [] });
  await vscode.__registeredCommands['llm-wiki.openInMarkdownEditor']();

  assert.deepEqual(
    executeCommandCalls.find(([command]) => command === 'vscode.openWith'),
    [
      'vscode.openWith',
      activeTabUri,
      'llm-wiki.markdownEditor',
    ],
  );
});

test('openLearningDiscussion opens the durable Markdown note without a chat panel', async () => {
  const executeCommandCalls = [];
  const resumeCalls = [];
  const vscode = createVscodeMock({
    executeCommandCalls,
    activeDocumentUri: undefined,
  });
  const mocks = createActivationMocks({ vscode });
  mocks['./learningNoteStore'] = {
    LearningNoteStore: class {
      async loadDiscussion(discussionId, notePath) {
        resumeCalls.push({ discussionId, notePath });
        return {
          note: {
            absolutePath: '/vault/wiki/learning/durable.md',
            relativePath: 'wiki/learning/durable.md',
            markdown: '# Durable',
          },
        };
      }
    },
  };
  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({ subscriptions: [] });

  await vscode.__registeredCommands['llm-wiki.openLearningDiscussion']({
    discussionId: 'discussion-durable',
    notePath: 'wiki/learning/durable.md',
  });

  assert.deepEqual(resumeCalls, [{
    discussionId: 'discussion-durable',
    notePath: 'wiki/learning/durable.md',
  }]);
  const openCall = executeCommandCalls.find(([command]) => command === 'vscode.openWith');
  assert.equal(openCall[1].fsPath, '/vault/wiki/learning/durable.md');
  assert.equal(openCall[2], 'llm-wiki.markdownEditor');
});

test('combined activation treats any folder as a filesystem wiki without opening SQLite', async () => {
  const customEditorRegistrations = [];
  const providerOptions = [];
  let outlineRegistrationCount = 0;
  let databaseOpenCount = 0;
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
  });
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: '/documents' } }];
  vscode.window.registerCustomEditorProvider = (viewType, provider, options) => {
    customEditorRegistrations.push({ viewType, provider, options });
    return { dispose() {} };
  };

  const { activate } = loadTsModule('src/extension.ts', {
    vscode,
    '@llm-wiki/core': {
      openDatabase: async () => {
        databaseOpenCount += 1;
        throw new Error('SQLite must not open in the simplified extension');
      },
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': { addSelectionToContext: async () => undefined },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'llm-wiki.pdfViewer';
        constructor(_context, options) {
          providerOptions.push(options);
        }
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'llm-wiki.markdownEditor';
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => {
        outlineRegistrationCount += 1;
        return { refresh() {} };
      },
    },
    './codexAppServerClient': {
      CodexAppServerClient: class {
        dispose() {}
      },
    },
    './pdfDiscussionController': {
      PdfDiscussionController: class {
        dispose() {}
      },
    },
    './wikiLinks': { notePathToUri: value => value },
  });

  activate({
    subscriptions: [],
    extension: { packageJSON: { version: '0.1.0-test' } },
    extensionUri: { fsPath: '/extension' },
    globalStorageUri: { fsPath: '/global-storage' },
  });

  assert.equal(customEditorRegistrations.length, 2);
  assert.equal(customEditorRegistrations[0].viewType, 'llm-wiki.pdfViewer');
  assert.equal(providerOptions.length, 1);
  assert.equal(providerOptions[0].vaultRoot, '/documents');
  assert.equal(providerOptions[0].documentRoot, '/documents');
  assert.equal(providerOptions[0].globalStoragePath, '/global-storage');
  assert.equal(outlineRegistrationCount, 1);
  assert.equal(databaseOpenCount, 0);
});

test('no-folder activation keeps custom viewers read-only and gates repository learning features', async () => {
  const customEditorRegistrations = [];
  const providerOptions = [];
  const markdownStores = [];
  const openedPdfTargets = [];
  const warningMessages = [];
  const informationMessages = [];
  const treeProviderIds = [];
  let codexClientCount = 0;
  let learningNoteStoreCount = 0;
  let backlinksCount = 0;
  let watcherCount = 0;
  let dailyNoteCount = 0;
  let syncCount = 0;
  let exportedSelectionCount = 0;
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    warningMessages,
    informationMessages,
    treeProviderIds,
  });
  vscode.workspace.workspaceFolders = undefined;
  vscode.workspace.createFileSystemWatcher = () => {
    watcherCount += 1;
    return {
      onDidChange() {},
      onDidCreate() {},
      onDidDelete() {},
      dispose() {},
    };
  };
  vscode.window.registerCustomEditorProvider = (viewType, provider, options) => {
    customEditorRegistrations.push({ viewType, provider, options });
    return { dispose() {} };
  };

  const mocks = createActivationMocks({ vscode });
  mocks['./codexAppServerClient'] = {
    CodexAppServerClient: class {
      constructor() {
        codexClientCount += 1;
      }
      dispose() {}
    },
  };
  mocks['./learningNoteStore'] = {
    LearningNoteStore: class {
      constructor() {
        learningNoteStoreCount += 1;
      }
    },
  };
  mocks['./backlinksProvider'] = {
    BacklinksProvider: class {
      constructor() {
        backlinksCount += 1;
      }
      refresh() {}
    },
  };
  mocks['./markdownEditorProvider'] = {
    MarkdownEditorProvider: class {
      static viewType = 'llm-wiki.markdownEditor';
      constructor(_context, learningNoteStore) {
        markdownStores.push(learningNoteStore);
      }
    },
  };
  mocks['./pdfEditorProvider'] = {
    PdfEditorProvider: class {
      static viewType = 'llm-wiki.pdfViewer';
      constructor(_context, options) {
        providerOptions.push(options);
      }
      async openPdfAtTarget(...args) {
        openedPdfTargets.push(args);
      }
      getActiveWebview() {
        return undefined;
      }
    },
  };
  mocks['./dailyNotes'] = {
    generateDailyNote: async () => {
      dailyNoteCount += 1;
      throw new Error('no-folder activation must not generate daily notes');
    },
  };
  mocks['./repositorySync'] = {
    syncRepository: async () => {
      syncCount += 1;
      throw new Error('no-folder activation must not run Git');
    },
  };
  mocks['./agentContext'] = {
    addSelectionToContext: async () => {
      exportedSelectionCount += 1;
    },
  };

  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({
    subscriptions: [],
    extensionUri: { fsPath: '/extension' },
    globalStorageUri: { fsPath: '/global-storage' },
  });

  assert.equal(customEditorRegistrations.length, 2);
  assert.deepEqual(markdownStores, [undefined]);
  assert.equal(providerOptions.length, 1);
  assert.equal(providerOptions[0].vaultRoot, undefined);
  assert.equal(providerOptions[0].documentRoot, undefined);
  assert.equal(providerOptions[0].learningNoteStore, undefined);
  assert.equal(providerOptions[0].discussionController, undefined);
  assert.equal(providerOptions[0].globalStoragePath, '/global-storage');
  assert.equal(codexClientCount, 0);
  assert.equal(learningNoteStoreCount, 0);
  assert.equal(backlinksCount, 0);
  assert.equal(treeProviderIds.length, 0);
  assert.equal(watcherCount, 0);
  assert.ok(informationMessages.includes(
    'LLM Wiki viewers ready — open a folder to enable learning notes and repository features.',
  ));

  await vscode.__registeredCommands['llm-wiki.generateDailyNote']();
  await vscode.__registeredCommands['llm-wiki.syncRepository']();
  assert.equal(vscode.__registeredCommands['llm-wiki.addSelectionToContext'], undefined);
  assert.equal(dailyNoteCount, 0);
  assert.equal(syncCount, 0);
  assert.equal(exportedSelectionCount, 0);
  assert.equal(warningMessages.length, 2);
  assert.ok(warningMessages.every(message =>
    message === 'Open a folder to use LLM Wiki notes and repository features.'
  ));

  await vscode.__registeredCommands['llm-wiki.openPdfTarget']({
    pdfPath: '/outside/read-only.pdf',
    page: 3,
  });
  assert.deepEqual(openedPdfTargets, [['/outside/read-only.pdf', 3, undefined]]);

  await vscode.__registeredCommands['llm-wiki.openPdfTarget']({
    pdfPath: 'relative.pdf',
  });
  assert.deepEqual(openedPdfTargets, [['/outside/read-only.pdf', 3, undefined]]);
  assert.equal(warningMessages.length, 3);
});

test('production activation leaves Ask PDF and Codex uncomposed', () => {
  const outputChannels = [];
  const configurationSections = [];
  const providerOptions = [];
  let codexClientCount = 0;
  let discussionControllerCount = 0;
  const vscode = createVscodeMock({
    executeCommandCalls: [],
    activeDocumentUri: undefined,
    outputChannels,
  });
  vscode.workspace.getConfiguration = section => {
    configurationSections.push(section);
    return { get: (_key, fallback) => fallback };
  };
  const mocks = createActivationMocks({ vscode });
  mocks['./codexAppServerClient'] = {
    CodexAppServerClient: class {
      constructor() { codexClientCount += 1; }
      dispose() {}
    },
  };
  mocks['./pdfDiscussionController'] = {
    PdfDiscussionController: class {
      constructor() { discussionControllerCount += 1; }
      dispose() {}
    },
  };
  mocks['./pdfEditorProvider'] = {
    PdfEditorProvider: class {
      static viewType = 'llm-wiki.pdfViewer';
      constructor(_context, options) { providerOptions.push(options); }
      getActiveWebview() { return undefined; }
    },
  };

  const { activate } = loadTsModule('src/extension.ts', mocks);
  activate({
    subscriptions: [],
    extensionUri: { fsPath: '/extension' },
    globalStorageUri: { fsPath: '/global-storage' },
  });

  assert.equal(codexClientCount, 0);
  assert.equal(discussionControllerCount, 0);
  assert.equal(outputChannels.length, 0);
  assert.equal(configurationSections.includes('llmWiki.agent'), false);
  assert.equal(vscode.__registeredCommands['llm-wiki.pdfAskSelection'], undefined);
  assert.equal(providerOptions[0].discussionController, undefined);
});

function createActivationMocks({ vscode, core = {} }) {
  return {
    vscode,
    '@llm-wiki/core': {
      detectVaultRoot: () => '/vault',
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      checkLinks: () => [],
      rebuildLinksForNote: () => undefined,
      rebuildAllLinks: () => undefined,
      registerSource: () => ({ id: 1 }),
      ingestFile: async () => undefined,
      recordActivity: () => undefined,
      runMigrations: () => undefined,
      ...core,
    },
    './linkProvider': { registerLinkProvider: () => undefined },
    './backlinksProvider': {
      BacklinksProvider: class {
        refresh() {}
      },
    },
    './agentContext': {
      addSelectionToContext: async () => undefined,
    },
    './uriDispatcher': { dispatchUri: () => undefined },
    './pdfEditorProvider': {
      PdfEditorProvider: class {
        static viewType = 'llm-wiki.pdfViewer';
        constructor() {}
        getActiveWebview() {
          return undefined;
        }
      },
    },
    './markdownEditorProvider': {
      MarkdownEditorProvider: class {
        static viewType = 'llm-wiki.markdownEditor';
        constructor() {}
      },
    },
    './markdownSymbols': {
      registerMarkdownOutlineProvider: () => undefined,
      registerMarkdownOutlineTreeProvider: () => ({ refresh() {} }),
    },
    './wikiLinks': { notePathToUri: value => `llm-wiki://note/${value.split('/').map(encodeURIComponent).join('/')}` },
  };
}

function createVscodeMock({
  executeCommandCalls,
  activeDocumentUri,
  activeDocumentLanguageId = 'markdown',
  visibleTextEditors,
  activeTabUri,
  activeTabViewType,
  informationMessages = [],
  openExternalCalls = [],
  treeProviderIds = [],
  outputChannels = [],
  warningMessages = [],
  workspaceTrusted = true,
}) {
  const watcher = {
    onDidChange: () => undefined,
    onDidCreate: () => undefined,
    onDidDelete: () => undefined,
    dispose: () => undefined,
  };
  const registeredCommands = {};
  const registeredUriHandlers = [];
  const activeEditorChangeHandlers = [];
  const openDocumentHandlers = [];
  const tabChangeHandlers = [];

  return {
    __registeredCommands: registeredCommands,
    __registeredUriHandlers: registeredUriHandlers,
    __fireActiveEditorChange: editor => {
      for (const handler of activeEditorChangeHandlers) handler(editor);
    },
    __fireOpenDocument: document => {
      for (const handler of openDocumentHandlers) handler(document);
    },
    __fireTabChange: event => {
      for (const handler of tabChangeHandlers) handler(event);
    },
    workspace: {
      isTrusted: workspaceTrusted,
      workspaceFolders: [{ uri: { fsPath: '/vault' } }],
      asRelativePath: uri => uri?.fsPath?.replace('/vault/', '') ?? 'notes/Concepts/FlashAttention.md',
      createFileSystemWatcher: () => watcher,
      onDidOpenTextDocument: callback => {
        openDocumentHandlers.push(callback);
        return { dispose() {} };
      },
      getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    },
    window: {
      activeTextEditor: activeDocumentUri ? {
        document: {
          uri: activeDocumentUri,
          languageId: activeDocumentLanguageId,
        },
      } : undefined,
      visibleTextEditors: visibleTextEditors ?? [],
      tabGroups: {
        all: [],
        onDidChangeTabs: callback => {
          tabChangeHandlers.push(callback);
          return { dispose() {} };
        },
        activeTabGroup: {
          activeTab: activeTabUri ? {
            input: {
              uri: activeTabUri,
              viewType: activeTabViewType,
            },
          } : undefined,
        },
      },
      onDidChangeActiveTextEditor: callback => {
        activeEditorChangeHandlers.push(callback);
        return { dispose() {} };
      },
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
      registerUriHandler: handler => {
        registeredUriHandlers.push(handler);
        return { dispose() {} };
      },
      registerTreeDataProvider: id => {
        treeProviderIds.push(id);
        return { dispose() {} };
      },
      showInformationMessage: message => {
        informationMessages.push(message);
        return undefined;
      },
      showWarningMessage: message => {
        warningMessages.push(message);
        return undefined;
      },
    },
    commands: {
      executeCommand: async (...args) => {
        executeCommandCalls.push(args);
        return undefined;
      },
      registerCommand: (command, callback) => {
        registeredCommands[command] = callback;
        return { dispose() {} };
      },
    },
    extensions: {
      onDidChange: () => ({ dispose() {} }),
    },
    env: {
      uriScheme: 'cursor',
      openExternal: async (...args) => {
        openExternalCalls.push(args);
        return true;
      },
    },
    ViewColumn: {
      One: 1,
      Beside: -2,
    },
    Uri: {
      parse: value => ({ toString: () => value }),
      file: fsPath => ({
        scheme: 'file',
        fsPath,
        path: fsPath,
        toString: () => `file://${fsPath}`,
      }),
      joinPath: (base, ...parts) => ({
        scheme: 'file',
        fsPath: [base.fsPath, ...parts].join('/'),
      }),
    },
  };
}
