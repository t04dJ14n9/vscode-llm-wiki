import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadAgentHandoff(vscode) {
  const filename = join(packageRoot, 'src/agentHandoff.ts');
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
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
  Module._load = request => request === 'vscode'
    ? vscode
    : originalLoad(request);
  try {
    mod._compile(outputText, filename);
    return mod.exports;
  } finally {
    Module._load = originalLoad;
  }
}

function installedExtension(id, commands, options = {}) {
  return {
    id,
    packageJSON: {
      contributes: {
        commands: commands.map(command => ({ command })),
      },
    },
    isActive: options.isActive ?? false,
    activate: options.activate ?? (async () => undefined),
  };
}

function extensionRegistry(...extensions) {
  const installed = new Map(extensions.map(extension => [
    extension.id.toLowerCase(),
    extension,
  ]));
  return {
    getExtension: id => installed.get(id.toLowerCase()),
  };
}

class TestEventEmitter {
  constructor() {
    this.listeners = new Set();
    this.disposeCount = 0;
    this.event = listener => {
      this.listeners.add(listener);
      return {
        dispose: () => this.listeners.delete(listener),
      };
    };
  }

  fire(value) {
    for (const listener of [...this.listeners]) listener(value);
  }

  dispose() {
    this.disposeCount += 1;
    this.listeners.clear();
  }
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

function nextImmediate() {
  return new Promise(resolve => setImmediate(resolve));
}

test('cold installed providers are visible before activation', () => {
  const vscode = {
    env: { appName: 'Visual Studio Code' },
    extensions: extensionRegistry(
      installedExtension('OPENAI.CHATGPT', ['chatgpt.addFileToThread']),
      installedExtension('Anthropic.Claude-Code', ['claude-code.insertAtMentioned']),
      installedExtension('TENCENT-CLOUD.CODING-COPILOT', ['tencentcloud.codingcopilot.addToChat']),
    ),
  };
  const { getImmediateAgentSurfaceCapabilities } = loadAgentHandoff(vscode);

  assert.deepEqual(getImmediateAgentSurfaceCapabilities(), {
    cursorAgent: false,
    providers: [
      { id: 'codex', label: 'Codex' },
      { id: 'claude', label: 'Claude Code' },
      { id: 'codebuddy', label: 'CodeBuddy' },
    ],
  });
});

test('focus-only Claude does not produce a handoff capability', () => {
  const vscode = {
    env: { appName: 'Visual Studio Code' },
    extensions: extensionRegistry(
      installedExtension('anthropic.claude-code', ['claude-vscode.focus']),
    ),
  };
  const { getImmediateAgentSurfaceCapabilities } = loadAgentHandoff(vscode);

  assert.deepEqual(getImmediateAgentSurfaceCapabilities().providers, []);
});

test('cursor agent capability follows the host product name only', () => {
  const { getImmediateAgentSurfaceCapabilities } = loadAgentHandoff({
    env: { appName: 'Cursor' },
    extensions: extensionRegistry(),
  });

  assert.equal(getImmediateAgentSurfaceCapabilities().cursorAgent, true);
});

test('registry-only data command advertises an installed active provider', async () => {
  const vscode = {
    env: { appName: 'Visual Studio Code' },
    commands: {
      getCommands: async includeInternal => {
        assert.equal(includeInternal, true);
        return ['chatgpt.addFileToThread'];
      },
    },
    extensions: extensionRegistry(
      installedExtension('openai.chatgpt', [], { isActive: true }),
    ),
  };
  const { resolveAgentSurfaceCapabilities } = loadAgentHandoff(vscode);

  assert.deepEqual(await resolveAgentSurfaceCapabilities(), {
    cursorAgent: false,
    providers: [{ id: 'codex', label: 'Codex' }],
  });
});

test('registered provider command without the expected extension is ignored', async () => {
  const vscode = {
    env: { appName: 'Visual Studio Code' },
    commands: {
      getCommands: async () => [
        'chatgpt.addFileToThread',
        'claude-vscode.insertAtMention',
        'tencentcloud.codingcopilot.addToChat',
      ],
    },
    extensions: extensionRegistry(),
  };
  const { resolveAgentSurfaceCapabilities } = loadAgentHandoff(vscode);

  assert.deepEqual((await resolveAgentSurfaceCapabilities()).providers, []);
});

test('cold manifest capability survives command-registry failure', async () => {
  const vscode = {
    env: { appName: 'Visual Studio Code' },
    commands: {
      getCommands: async () => {
        throw new Error('registry unavailable');
      },
    },
    extensions: extensionRegistry(
      installedExtension('openai.chatgpt', ['chatgpt.addFileToThread']),
    ),
  };
  const { resolveAgentSurfaceCapabilities } = loadAgentHandoff(vscode);

  assert.deepEqual((await resolveAgentSurfaceCapabilities()).providers, [
    { id: 'codex', label: 'Codex' },
  ]);
});

test('manifest and registry capabilities are deduplicated in canonical order', async () => {
  const vscode = {
    env: { appName: 'Visual Studio Code' },
    commands: {
      getCommands: async () => [
        'chatgpt.addFileToThread',
        'claude-code.insertAtMentioned',
      ],
    },
    extensions: extensionRegistry(
      installedExtension('openai.chatgpt', ['chatgpt.addFileToThread']),
      installedExtension('anthropic.claude-code', []),
      installedExtension(
        'tencent-cloud.coding-copilot',
        ['tencentcloud.codingcopilot.addToChat'],
      ),
    ),
  };
  const { resolveAgentSurfaceCapabilities } = loadAgentHandoff(vscode);

  assert.deepEqual((await resolveAgentSurfaceCapabilities()).providers, [
    { id: 'codex', label: 'Codex' },
    { id: 'claude', label: 'Claude Code' },
    { id: 'codebuddy', label: 'CodeBuddy' },
  ]);
});

test('capability source exposes a cold snapshot before async refresh completes', async () => {
  const registryQuery = deferred();
  const extensionChanges = new TestEventEmitter();
  let registryQueryCount = 0;
  const vscode = {
    EventEmitter: TestEventEmitter,
    env: { appName: 'Visual Studio Code' },
    commands: {
      getCommands: includeInternal => {
        assert.equal(includeInternal, true);
        registryQueryCount += 1;
        return registryQuery.promise;
      },
    },
    extensions: {
      ...extensionRegistry(
        installedExtension(
          'openai.chatgpt',
          ['chatgpt.addFileToThread'],
          { activate: async () => assert.fail('discovery must not activate Codex') },
        ),
        installedExtension(
          'anthropic.claude-code',
          [],
          { activate: async () => assert.fail('discovery must not activate Claude') },
        ),
      ),
      onDidChange: extensionChanges.event,
    },
  };
  const { createAgentSurfaceCapabilitySource } = loadAgentHandoff(vscode);
  const source = createAgentSurfaceCapabilitySource();
  let changeCount = 0;
  const changed = new Promise(resolve => {
    source.onDidChange(() => {
      changeCount += 1;
      resolve();
    });
  });

  assert.deepEqual(source.read().providers, [
    { id: 'codex', label: 'Codex' },
  ]);
  source.read();
  assert.equal(registryQueryCount, 1);

  registryQuery.resolve(['claude-vscode.insertAtMention']);
  await changed;

  assert.equal(changeCount, 1);
  assert.deepEqual(source.read().providers, [
    { id: 'codex', label: 'Codex' },
    { id: 'claude', label: 'Claude Code' },
  ]);
  source.read();
  assert.equal(registryQueryCount, 2);
  source.dispose();
});

test('newer capability refresh wins when command queries resolve out of order', async () => {
  const queryA = deferred();
  const queryB = deferred();
  const queryResults = [queryA.promise, queryB.promise];
  const extensionChanges = new TestEventEmitter();
  const vscode = {
    EventEmitter: TestEventEmitter,
    env: { appName: 'Visual Studio Code' },
    commands: {
      getCommands: async () => queryResults.shift(),
    },
    extensions: {
      ...extensionRegistry(
        installedExtension('openai.chatgpt', []),
        installedExtension('anthropic.claude-code', []),
      ),
      onDidChange: extensionChanges.event,
    },
  };
  const { createAgentSurfaceCapabilitySource } = loadAgentHandoff(vscode);
  const source = createAgentSurfaceCapabilitySource();
  let changeCount = 0;
  source.onDidChange(() => {
    changeCount += 1;
  });

  const newerRefresh = source.refresh();
  queryB.resolve(['claude-vscode.insertAtMention']);
  await newerRefresh;
  assert.deepEqual(source.read().providers, [
    { id: 'claude', label: 'Claude Code' },
  ]);

  queryA.resolve(['chatgpt.addFileToThread']);
  await nextImmediate();

  assert.deepEqual(source.read().providers, [
    { id: 'claude', label: 'Claude Code' },
  ]);
  assert.equal(changeCount, 1);
  source.dispose();
});

test('extension change refreshes immediate and registry snapshots', async () => {
  const installed = new Map();
  const extensionChanges = new TestEventEmitter();
  const vscode = {
    EventEmitter: TestEventEmitter,
    env: { appName: 'Visual Studio Code' },
    commands: {
      getCommands: async () => ['claude-code.insertAtMentioned'],
    },
    extensions: {
      getExtension: id => installed.get(id.toLowerCase()),
      onDidChange: extensionChanges.event,
    },
  };
  const { createAgentSurfaceCapabilitySource } = loadAgentHandoff(vscode);
  const source = createAgentSurfaceCapabilitySource();
  await nextImmediate();
  const changed = new Promise(resolve => source.onDidChange(resolve));

  installed.set(
    'anthropic.claude-code',
    installedExtension('anthropic.claude-code', []),
  );
  extensionChanges.fire();
  await changed;

  assert.deepEqual(source.read().providers, [
    { id: 'claude', label: 'Claude Code' },
  ]);
  source.dispose();
});

test('capability source disposal stops subscriptions, events, and future refreshes', async () => {
  const extensionChanges = new TestEventEmitter();
  let extensionSubscriptionDisposeCount = 0;
  let registryQueryCount = 0;
  const vscode = {
    EventEmitter: TestEventEmitter,
    env: { appName: 'Visual Studio Code' },
    commands: {
      getCommands: async () => {
        registryQueryCount += 1;
        return [];
      },
    },
    extensions: {
      ...extensionRegistry(),
      onDidChange: listener => {
        const subscription = extensionChanges.event(listener);
        return {
          dispose() {
            extensionSubscriptionDisposeCount += 1;
            subscription.dispose();
          },
        };
      },
    },
  };
  const { createAgentSurfaceCapabilitySource } = loadAgentHandoff(vscode);
  const source = createAgentSurfaceCapabilitySource();
  let changeCount = 0;
  source.onDidChange(() => {
    changeCount += 1;
  });

  source.dispose();
  extensionChanges.fire();
  source.read();
  await source.refresh();

  assert.equal(extensionSubscriptionDisposeCount, 1);
  assert.equal(changeCount, 0);
  assert.equal(registryQueryCount, 1);
});

test('explicit cold Codex handoff activates, refreshes commands, then attaches', async () => {
  const order = [];
  const selection = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.md',
  };
  const crop = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.png',
  };
  const vscode = {
    commands: {
      getCommands: async () => {
        order.push('getCommands');
        return ['chatgpt.addFileToThread'];
      },
      executeCommand: async (command, ...args) => {
        order.push(`${command}:${args[0]?.fsPath.split('/').at(-1)}`);
      },
    },
    extensions: extensionRegistry(installedExtension(
      'openai.chatgpt',
      ['chatgpt.addFileToThread'],
      { activate: async () => order.push('activate:openai.chatgpt') },
    )),
    window: { showWarningMessage: () => undefined },
  };
  const { handoffSelectionToAgentId } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToAgentId('codex', selection, [crop]), true);
  assert.deepEqual(order, [
    'activate:openai.chatgpt',
    'getCommands',
    'chatgpt.addFileToThread:selection.md',
    'chatgpt.addFileToThread:selection.png',
  ]);
});

test('Codex reports total failure and skips the crop when selection.md attachment fails', async () => {
  const calls = [];
  const warnings = [];
  const selection = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.md',
  };
  const crop = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.png',
  };
  const command = 'chatgpt.addFileToThread';
  const vscode = {
    commands: {
      getCommands: async () => [command],
      executeCommand: async (...args) => {
        calls.push(args);
        throw new Error('selection rejected');
      },
    },
    extensions: extensionRegistry(installedExtension(
      'openai.chatgpt',
      [command],
      { isActive: true },
    )),
    window: {
      showWarningMessage: message => warnings.push(message),
    },
  };
  const { handoffSelectionToAgentId } = loadAgentHandoff(vscode);

  assert.equal(
    await handoffSelectionToAgentId('codex', selection, [crop]),
    false,
  );
  assert.deepEqual(calls, [[command, selection]]);
  assert.deepEqual(warnings, [
    'Codex could not attach the selection.',
  ]);
});

test('Codex reports partial success when only the optional crop attachment fails', async () => {
  const calls = [];
  const warnings = [];
  const selection = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.md',
  };
  const crop = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.png',
  };
  const command = 'chatgpt.addFileToThread';
  const vscode = {
    commands: {
      getCommands: async () => [command],
      executeCommand: async (...args) => {
        calls.push(args);
        if (args[1] === crop) throw new Error('crop rejected');
      },
    },
    extensions: extensionRegistry(installedExtension(
      'openai.chatgpt',
      [command],
      { isActive: true },
    )),
    window: {
      showWarningMessage: message => warnings.push(message),
    },
  };
  const { handoffSelectionToAgentId } = loadAgentHandoff(vscode);

  assert.equal(
    await handoffSelectionToAgentId('codex', selection, [crop]),
    true,
  );
  assert.deepEqual(calls, [
    [command, selection],
    [command, crop],
  ]);
  assert.deepEqual(warnings, [
    'Codex attached selection.md, but could not attach the optional image. Continue with text context or try again.',
  ]);
});

test('explicit activation failure does not fall back to another provider', async () => {
  const executedCommands = [];
  const warnings = [];
  const selection = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.md',
  };
  const vscode = {
    commands: {
      getCommands: () => assert.fail('commands must not be queried after activation fails'),
      executeCommand: async (...args) => executedCommands.push(args),
    },
    extensions: extensionRegistry(installedExtension(
      'openai.chatgpt',
      ['chatgpt.addFileToThread'],
      { activate: async () => { throw new Error('activation failed'); } },
    )),
    window: { showWarningMessage: message => warnings.push(message) },
  };
  const { handoffSelectionToAgentId } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToAgentId('codex', selection), false);
  assert.deepEqual(executedCommands, []);
  assert.match(warnings[0], /Codex could not be activated/);
});

test('hands the exported context file directly to Codex', async () => {
  const calls = [];
  const uri = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.md',
  };
  const vscode = {
    commands: {
      getCommands: async () => ['chatgpt.addFileToThread'],
      executeCommand: async (...args) => calls.push(args),
    },
    window: {
      showQuickPick: () => assert.fail('one provider should not prompt'),
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToAgent } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToAgent(uri), 'codex');
  assert.deepEqual(calls, [['chatgpt.addFileToThread', uri]]);
});

test('auto-routes to the selected Cursor composer before falling back to a provider picker', async () => {
  const calls = [];
  const uri = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.md',
  };
  const vscode = {
    commands: {
      getCommands: async () => [
        'chatgpt.addFileToThread',
        'composer.addfilestocomposer',
        'composer.getOrderedSelectedComposerIds',
        'workbench.action.chat.open',
      ],
      executeCommand: async (...args) => {
        calls.push(args);
        if (args[0] === 'composer.getOrderedSelectedComposerIds') {
          return ['active-composer'];
        }
      },
    },
    window: {
      showQuickPick: () => assert.fail('the selected Cursor composer is a credible target'),
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToAgent } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToAgent(uri), 'cursor');
  assert.deepEqual(calls, [
    ['composer.getOrderedSelectedComposerIds'],
    ['composer.addfilestocomposer', uri, { useExactResource: true }],
  ]);
});

test('stable active editor tab routes to Codex without private visibility probes', async () => {
  const calls = [];
  const uri = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.md',
  };
  const codexGroup = {
    activeTab: {
      input: {
        viewType: 'chatgpt.conversationEditor',
        uri: { scheme: 'openai-codex' },
      },
    },
  };
  const claudeGroup = {
    activeTab: {
      input: { viewType: 'claudeVSCodePanel' },
    },
  };
  const vscode = {
    commands: {
      getCommands: async () => [
        'chatgpt.addFileToThread',
        'claude-vscode.focus',
        'composer.addfilestocomposer',
        'composer.getOrderedSelectedComposerIds',
      ],
      executeCommand: async (...args) => {
        calls.push(args);
        if (args[0] === 'composer.getOrderedSelectedComposerIds') {
          assert.fail('stable editor-tab evidence must win before Cursor probes');
        }
      },
    },
    extensions: {
      getExtension: id => (
        id.toLowerCase() === 'openai.chatgpt'
        || id.toLowerCase() === 'anthropic.claude-code'
          ? { id }
          : undefined
      ),
    },
    window: {
      tabGroups: {
        activeTabGroup: codexGroup,
        all: [codexGroup, claudeGroup],
      },
      showQuickPick: () => assert.fail('the active chat editor is authoritative'),
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToAgent } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToAgent(uri), 'codex');
  assert.deepEqual(calls, [['chatgpt.addFileToThread', uri]]);
});

test('stable visible Claude editor routes there and restores the source tab', async () => {
  const calls = [];
  const closedTabs = [];
  const uri = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/exports/export-id/selection.md',
  };
  const sourceUri = {
    scheme: 'file',
    fsPath: '/vault/raw/pdf/source.pdf',
  };
  const sourceTab = {
    input: {
      uri: sourceUri,
      viewType: 'llm-wiki.pdfViewer',
    },
    isPreview: true,
  };
  const mainGroup = {
    viewColumn: 1,
    activeTab: sourceTab,
    tabs: [sourceTab],
  };
  const claudeTab = {
    input: { viewType: 'claudeVSCodePanel' },
    isPreview: false,
  };
  const claudeGroup = {
    viewColumn: 2,
    activeTab: claudeTab,
    tabs: [claudeTab],
  };
  const temporaryTab = {
    input: { uri },
    isPreview: true,
  };
  const temporaryGroup = {
    viewColumn: 3,
    activeTab: temporaryTab,
    tabs: [temporaryTab],
  };
  const groups = [mainGroup, claudeGroup];
  let activeGroup = mainGroup;
  const end = { line: 1, character: 4 };
  const document = { lineCount: 2, lineAt: () => ({ range: { end } }) };
  const editor = {};
  class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  }
  class Selection {
    constructor(start, finish) {
      this.start = start;
      this.end = finish;
    }
  }
  const vscode = {
    Position,
    Selection,
    ViewColumn: {
      Beside: 99,
    },
    commands: {
      getCommands: async () => [
        'chatgpt.addFileToThread',
        'claude-vscode.sidebar.open',
        'claude-vscode.insertAtMention',
        'claude-vscode.focus',
      ],
      executeCommand: async (...args) => {
        calls.push(args);
        if (args[0] === 'claude-vscode.insertAtMention') {
          activeGroup = claudeGroup;
        }
        if (args[0] === 'vscode.openWith') {
          activeGroup = mainGroup;
        }
      },
    },
    extensions: {
      getExtension: id => (
        ['openai.chatgpt', 'anthropic.claude-code']
          .includes(id.toLowerCase())
          ? { id }
          : undefined
      ),
    },
    workspace: {
      openTextDocument: async value => {
        assert.equal(value, uri);
        return document;
      },
    },
    window: {
      tabGroups: {
        get activeTabGroup() {
          return activeGroup;
        },
        get all() {
          return groups;
        },
        close: async (tab, preserveFocus) => {
          closedTabs.push([tab, preserveFocus]);
          const index = groups.indexOf(temporaryGroup);
          if (index >= 0) groups.splice(index, 1);
          return true;
        },
      },
      showTextDocument: async (value, options) => {
        assert.equal(value, document);
        assert.deepEqual(options, {
          preview: false,
          viewColumn: vscode.ViewColumn.Beside,
        });
        groups.push(temporaryGroup);
        activeGroup = temporaryGroup;
        return editor;
      },
      showQuickPick: () => assert.fail('one visible chat editor should auto-route'),
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToAgent } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToAgent(uri), 'claude');
  assert.equal(editor.selection.start.line, 0);
  assert.equal(editor.selection.end, end);
  assert.deepEqual(calls, [
    ['claude-vscode.insertAtMention'],
    [
      'vscode.openWith',
      sourceUri,
      'llm-wiki.pdfViewer',
      {
        viewColumn: 1,
        preserveFocus: false,
        preview: true,
      },
    ],
  ]);
  assert.deepEqual(closedTabs, [[temporaryTab, true]]);
  assert.equal(activeGroup, mainGroup);
});

test('multiple visible chat editors show a picker narrowed to those stable targets', async () => {
  const calls = [];
  const closedTabs = [];
  const pickedIds = [];
  const restoredDocuments = [];
  const uri = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/exports/export-id/selection.md',
  };
  const sourceUri = {
    scheme: 'file',
    fsPath: '/vault/notes/source.md',
  };
  const sourceTab = {
    input: { uri: sourceUri },
    isPreview: false,
  };
  const mainGroup = {
    viewColumn: 1,
    activeTab: sourceTab,
    tabs: [sourceTab],
  };
  const codexTab = {
    input: { viewType: 'chatgpt.conversationEditor' },
    isPreview: false,
  };
  const codexGroup = {
    viewColumn: 2,
    activeTab: codexTab,
    tabs: [codexTab],
  };
  const claudeTab = {
    input: { viewType: 'claudeVSCodePanel' },
    isPreview: false,
  };
  const claudeGroup = {
    viewColumn: 3,
    activeTab: claudeTab,
    tabs: [claudeTab],
  };
  const temporaryTab = {
    input: { uri },
    isPreview: true,
  };
  const temporaryGroup = {
    viewColumn: 4,
    activeTab: temporaryTab,
    tabs: [temporaryTab],
  };
  const groups = [mainGroup, codexGroup, claudeGroup];
  let activeGroup = mainGroup;
  const end = { line: 0, character: 2 };
  const document = { lineCount: 1, lineAt: () => ({ range: { end } }) };
  const editor = {};
  class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  }
  class Selection {
    constructor(start, finish) {
      this.start = start;
      this.end = finish;
    }
  }
  const vscode = {
    Position,
    Selection,
    ViewColumn: {
      Beside: 99,
    },
    commands: {
      getCommands: async () => [
        'chatgpt.addFileToThread',
        'claude-vscode.sidebar.open',
        'claude-vscode.insertAtMention',
        'claude-vscode.focus',
        'composer.addfilestocomposer',
        'composer.getOrderedSelectedComposerIds',
        'tencentcloud.codingcopilot.addToChat',
      ],
      executeCommand: async (...args) => {
        calls.push(args);
        if (args[0] === 'composer.getOrderedSelectedComposerIds') {
          assert.fail('stable editor targets should narrow before Cursor probes');
        }
        if (args[0] === 'claude-vscode.insertAtMention') {
          activeGroup = claudeGroup;
        }
      },
    },
    extensions: {
      getExtension: id => ({ id }),
    },
    workspace: {
      openTextDocument: async value => {
        assert.equal(value, uri);
        return document;
      },
    },
    window: {
      tabGroups: {
        get activeTabGroup() {
          return activeGroup;
        },
        get all() {
          return groups;
        },
        close: async (tab, preserveFocus) => {
          closedTabs.push([tab, preserveFocus]);
          const index = groups.indexOf(temporaryGroup);
          if (index >= 0) groups.splice(index, 1);
          return true;
        },
      },
      showTextDocument: async (value, options) => {
        if (value === document) {
          assert.deepEqual(options, {
            preview: false,
            viewColumn: vscode.ViewColumn.Beside,
          });
          groups.push(temporaryGroup);
          activeGroup = temporaryGroup;
          return editor;
        }
        restoredDocuments.push([value, options]);
        activeGroup = mainGroup;
        return {};
      },
      showQuickPick: async items => {
        pickedIds.push(...items.map(item => item.id));
        return items.find(item => item.id === 'claude');
      },
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToAgent } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToAgent(uri), 'claude');
  assert.deepEqual(pickedIds, ['codex', 'claude']);
  assert.equal(editor.selection.start.line, 0);
  assert.equal(editor.selection.end, end);
  assert.deepEqual(calls, [['claude-vscode.insertAtMention']]);
  assert.deepEqual(closedTabs, [[temporaryTab, true]]);
  assert.deepEqual(restoredDocuments, [[
    sourceUri,
    {
      viewColumn: 1,
      preserveFocus: false,
      preview: false,
    },
  ]]);
  assert.equal(activeGroup, mainGroup);
});

test('installed-extension capability check ignores a stale foreign command', async () => {
  const calls = [];
  const uri = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.md',
  };
  const vscode = {
    commands: {
      getCommands: async () => [
        'chatgpt.addFileToThread',
        'claude-vscode.focus',
      ],
      executeCommand: async (...args) => calls.push(args),
    },
    extensions: {
      getExtension: id => id === 'openai.chatgpt' ? { id } : undefined,
    },
    window: {
      showQuickPick: () => assert.fail('only an installed and callable provider remains'),
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToAgent } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToAgent(uri), 'codex');
  assert.deepEqual(calls, [['chatgpt.addFileToThread', uri]]);
});

test('Codex receives unique optional crop attachments without submitting', async () => {
  const calls = [];
  const selection = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.md',
  };
  const crop = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.png',
  };
  const vscode = {
    commands: {
      getCommands: async () => ['chatgpt.addFileToThread'],
      executeCommand: async (...args) => calls.push(args),
    },
    window: {
      showQuickPick: () => assert.fail('one provider should not prompt'),
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToAgent } = loadAgentHandoff(vscode);

  assert.equal(
    await handoffSelectionToAgent(selection, [crop, selection, crop]),
    'codex',
  );
  assert.deepEqual(calls, [
    ['chatgpt.addFileToThread', selection],
    ['chatgpt.addFileToThread', crop],
  ]);
  assert.equal(
    calls.some(([command]) => /submit|send/i.test(command)),
    false,
  );
});

test('attaches to the current Cursor composer when chat-open is unavailable', async () => {
  const calls = [];
  const uri = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.md',
  };
  const vscode = {
    commands: {
      getCommands: async () => ['composer.addfilestocomposer'],
      executeCommand: async (...args) => calls.push(args),
    },
    window: {
      showQuickPick: () => assert.fail('one provider should not prompt'),
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToAgent } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToAgent(uri), 'cursor');
  assert.deepEqual(calls, [
    ['composer.addfilestocomposer', uri, { useExactResource: true }],
  ]);
});

test('warns and does nothing when Cursor Chat is unavailable', async () => {
  const calls = [];
  const warnings = [];
  const vscode = {
    commands: {
      getCommands: async () => ['workbench.action.chat.open'],
      executeCommand: async (...args) => calls.push(args),
    },
    window: {
      showWarningMessage: message => warnings.push(message),
    },
  };
  const { handoffSelectionToCursor } = loadAgentHandoff(vscode);

  assert.equal(
    await handoffSelectionToCursor({
      scheme: 'file',
      fsPath: '/vault/.llm_wiki/agent/selection.md',
    }),
    false,
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(warnings, ['Cursor chat is not available.']);
});

test('does not silently attach when Cursor reports no composer and cannot open one', async () => {
  const calls = [];
  const warnings = [];
  const selection = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.md',
  };
  const vscode = {
    commands: {
      getCommands: async () => [
        'composer.addfilestocomposer',
        'composer.getOrderedSelectedComposerIds',
      ],
      executeCommand: async (...args) => {
        calls.push(args);
        return [];
      },
    },
    window: {
      showWarningMessage: message => warnings.push(message),
    },
  };
  const { handoffSelectionToCursor } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToCursor(selection), false);
  assert.deepEqual(calls, [['composer.getOrderedSelectedComposerIds']]);
  assert.deepEqual(warnings, [
    'Cursor could not find an open Agent composer. Open Cursor Chat and try again.',
  ]);
});

test('attaches after Cursor creates a composer even when its open command rejects', async () => {
  const calls = [];
  const selection = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.md',
  };
  const vscode = {
    commands: {
      getCommands: async () => [
        'composer.addfilestocomposer',
        'composer.getOrderedSelectedComposerIds',
        'workbench.action.chat.open',
      ],
      executeCommand: async (...args) => {
        calls.push(args);
        if (args[0] === 'composer.getOrderedSelectedComposerIds') {
          return [];
        }
        if (args[0] === 'workbench.action.chat.open') {
          throw new Error('chat open failed');
        }
      },
    },
    window: {
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToCursor } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToCursor(selection), true);
  assert.deepEqual(calls, [
    ['composer.getOrderedSelectedComposerIds'],
    [
      'workbench.action.chat.open',
      {
        query: 'Use the attached learning passage as context.',
        isPartialQuery: true,
      },
    ],
    ['composer.addfilestocomposer', selection, { useExactResource: true }],
  ]);
});

test('returns false when Cursor cannot attach selection.md', async () => {
  const calls = [];
  const warnings = [];
  const selection = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.md',
  };
  const crop = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.png',
  };
  const vscode = {
    commands: {
      getCommands: async () => ['composer.addfilestocomposer'],
      executeCommand: async (...args) => {
        calls.push(args);
        throw new Error('attachment failed');
      },
    },
    window: {
      showWarningMessage: message => warnings.push(message),
    },
  };
  const { handoffSelectionToCursor } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToCursor(selection, [crop]), false);
  assert.deepEqual(calls, [
    ['composer.addfilestocomposer', selection, { useExactResource: true }],
  ]);
  assert.deepEqual(warnings, [
    'Cursor could not attach selection.md. Open Cursor Chat and try again.',
  ]);
});

test('continues text-only when Cursor cannot attach the optional crop', async () => {
  const calls = [];
  const warnings = [];
  const selection = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.md',
  };
  const crop = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.png',
  };
  const vscode = {
    commands: {
      getCommands: async () => ['composer.addfilestocomposer'],
      executeCommand: async (...args) => {
        calls.push(args);
        if (args[1] === crop) throw new Error('crop failed');
      },
    },
    window: {
      showWarningMessage: message => warnings.push(message),
    },
  };
  const { handoffSelectionToCursor } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToCursor(selection, [crop]), true);
  assert.deepEqual(calls, [
    ['composer.addfilestocomposer', selection, { useExactResource: true }],
    ['composer.addfilestocomposer', crop, { useExactResource: true }],
  ]);
  assert.deepEqual(warnings, [
    'Cursor attached selection.md, but could not attach the optional image. Continue with text context or try again.',
  ]);
  assert.equal(
    calls.some(([command]) => /submit|send/i.test(command)),
    false,
  );
});

test('reuses the active Cursor composer for selection.md and crop without opening or submitting', async () => {
  const calls = [];
  const selection = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.md',
  };
  const crop = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/annotations/pdf/page-3.png',
  };
  const vscode = {
    commands: {
      getCommands: async () => [
        'composer.addfilestocomposer',
        'composer.getOrderedSelectedComposerIds',
        'workbench.action.chat.open',
        'composer.newAgent',
      ],
      executeCommand: async (...args) => {
        calls.push(args);
        if (args[0] === 'composer.getOrderedSelectedComposerIds') {
          return ['current-agent-panel'];
        }
      },
    },
    window: {
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToCursor } = loadAgentHandoff(vscode);

  assert.equal(
    await handoffSelectionToCursor(selection, [crop, selection, crop]),
    true,
  );
  assert.deepEqual(calls, [
    ['composer.getOrderedSelectedComposerIds'],
    ['composer.addfilestocomposer', selection, { useExactResource: true }],
    ['composer.addfilestocomposer', crop, { useExactResource: true }],
  ]);
  assert.equal(
    calls.some(([command]) => /chat\.open|new.?agent|submit|send/i.test(command)),
    false,
  );
});

test('opens Cursor once and attaches when no current composer exists', async () => {
  const calls = [];
  const selection = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.md',
  };
  const crop = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/annotations/pdf/page-3.png',
  };
  const vscode = {
    commands: {
      getCommands: async () => [
        'composer.addfilestocomposer',
        'composer.getOrderedSelectedComposerIds',
        'workbench.action.chat.open',
      ],
      executeCommand: async (...args) => {
        calls.push(args);
        if (args[0] === 'composer.getOrderedSelectedComposerIds') {
          return [];
        }
      },
    },
    window: {
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToCursor } = loadAgentHandoff(vscode);

  assert.equal(
    await handoffSelectionToCursor(selection, [crop, selection, crop]),
    true,
  );
  assert.deepEqual(calls, [
    ['composer.getOrderedSelectedComposerIds'],
    [
      'workbench.action.chat.open',
      {
        query: 'Use the attached learning passage as context.',
        isPartialQuery: true,
      },
    ],
    ['composer.addfilestocomposer', selection, { useExactResource: true }],
    ['composer.addfilestocomposer', crop, { useExactResource: true }],
  ]);
  assert.equal(
    calls.some(([command]) => /new.?agent|submit|send/i.test(command)),
    false,
  );
});

test('rejects non-local Cursor attachments before opening the composer', async () => {
  const calls = [];
  const vscode = {
    commands: {
      getCommands: async () => [
        'composer.addfilestocomposer',
        'workbench.action.chat.open',
      ],
      executeCommand: async (...args) => calls.push(args),
    },
    window: {
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToCursor } = loadAgentHandoff(vscode);

  await assert.rejects(
    handoffSelectionToCursor({
      scheme: 'https',
      fsPath: '',
    }),
    /must be local files/,
  );
  assert.deepEqual(calls, []);
});

test('hands the exported context file directly to CodeBuddy', async () => {
  const calls = [];
  const uri = { fsPath: '/vault/.llm_wiki/agent/selection.md' };
  const vscode = {
    commands: {
      getCommands: async () => ['tencentcloud.codingcopilot.addToChat'],
      executeCommand: async (...args) => calls.push(args),
    },
    window: {
      showQuickPick: () => assert.fail('one provider should not prompt'),
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToAgent } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToAgent(uri), 'codebuddy');
  assert.deepEqual(calls, [['tencentcloud.codingcopilot.addToChat', uri]]);
});

test('CodeBuddy receives one draft attachment batch including an optional crop', async () => {
  const calls = [];
  const selection = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.md',
  };
  const crop = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/selection.png',
  };
  const vscode = {
    commands: {
      getCommands: async () => ['tencentcloud.codingcopilot.addToChat'],
      executeCommand: async (...args) => calls.push(args),
    },
    window: {
      showQuickPick: () => assert.fail('one provider should not prompt'),
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToAgent } = loadAgentHandoff(vscode);

  assert.equal(
    await handoffSelectionToAgent(selection, [crop, selection, crop]),
    'codebuddy',
  );
  assert.deepEqual(calls, [[
    'tencentcloud.codingcopilot.addToChat',
    selection,
    [selection, crop],
  ]]);
  assert.equal(
    calls.some(([command]) => /submit|send/i.test(command)),
    false,
  );
});

test('does not treat focus-only Claude as a handoff target', async () => {
  const calls = [];
  const warnings = [];
  const uri = { fsPath: '/vault/.llm_wiki/agent/selection.md' };
  const vscode = {
    commands: {
      getCommands: async () => [
        'claude-vscode.sidebar.open',
        'claude-vscode.focus',
      ],
      executeCommand: async (...args) => calls.push(args),
    },
    window: {
      showQuickPick: () => assert.fail('focus is not a data command'),
      showWarningMessage: message => warnings.push(message),
    },
  };
  const { handoffSelectionToAgent } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToAgent(uri), undefined);
  assert.deepEqual(calls, []);
  assert.deepEqual(warnings, [
    'Selection exported, but no supported agent sidebar is available.',
  ]);
});

test('Claude prefers insert-at-mention so its current draft receives the exact reference', async () => {
  const calls = [];
  const closedTabs = [];
  const uri = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/exports/export-id/selection.md',
  };
  const sourceUri = {
    scheme: 'file',
    fsPath: '/vault/raw/pdf/source.pdf',
  };
  const sourceTab = {
    input: {
      uri: sourceUri,
      viewType: 'llm-wiki.pdfViewer',
    },
    isPreview: true,
  };
  const temporaryTab = {
    input: { uri },
    isPreview: true,
  };
  const sourceGroup = {
    viewColumn: 1,
    activeTab: sourceTab,
    tabs: [sourceTab],
  };
  const temporaryGroup = {
    viewColumn: 2,
    activeTab: temporaryTab,
    tabs: [temporaryTab],
  };
  const claudeGroup = {
    viewColumn: 3,
    activeTab: {
      input: { viewType: 'claudeVSCodePanel' },
      isPreview: false,
    },
    tabs: [],
  };
  const groups = [sourceGroup];
  let activeGroup = sourceGroup;
  const end = { line: 2, character: 7 };
  const document = { lineCount: 3, lineAt: () => ({ range: { end } }) };
  const editor = {};
  class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  }
  class Selection {
    constructor(start, finish) {
      this.start = start;
      this.end = finish;
    }
  }
  const vscode = {
    Position,
    Selection,
    ViewColumn: {
      Beside: 99,
    },
    commands: {
      getCommands: async () => [
        'claude-vscode.sidebar.open',
        'claude-vscode.insertAtMention',
        'claude-vscode.focus',
      ],
      executeCommand: async (...args) => {
        calls.push(args);
        if (args[0] === 'claude-vscode.insertAtMention') {
          activeGroup = claudeGroup;
        }
        if (args[0] === 'vscode.openWith') {
          activeGroup = sourceGroup;
        }
      },
    },
    workspace: {
      openTextDocument: async value => {
        assert.equal(value, uri);
        return document;
      },
    },
    window: {
      tabGroups: {
        get activeTabGroup() {
          return activeGroup;
        },
        get all() {
          return groups;
        },
        close: async (tab, preserveFocus) => {
          closedTabs.push([tab, preserveFocus]);
          const index = groups.indexOf(temporaryGroup);
          if (index >= 0) groups.splice(index, 1);
          return true;
        },
      },
      showTextDocument: async (value, options) => {
        assert.equal(value, document);
        assert.deepEqual(options, {
          preview: false,
          viewColumn: vscode.ViewColumn.Beside,
        });
        groups.push(temporaryGroup);
        activeGroup = temporaryGroup;
        return editor;
      },
      showQuickPick: () => assert.fail('one provider should not prompt'),
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToAgent } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToAgent(uri), 'claude');
  assert.equal(editor.selection.start.line, 0);
  assert.equal(editor.selection.end, end);
  assert.deepEqual(calls, [
    ['claude-vscode.insertAtMention'],
    [
      'vscode.openWith',
      sourceUri,
      'llm-wiki.pdfViewer',
      {
        viewColumn: 1,
        preserveFocus: false,
        preview: true,
      },
    ],
  ]);
  assert.deepEqual(closedTabs, [[temporaryTab, true]]);
  assert.equal(activeGroup, sourceGroup);
  assert.equal(
    calls.some(([command]) => /submit|send/i.test(command)),
    false,
  );
});

test('Claude preserves a pre-existing selection tab while restoring the source', async () => {
  const calls = [];
  const closedTabs = [];
  const uri = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/exports/export-id/selection.md',
  };
  const sourceUri = {
    scheme: 'file',
    fsPath: '/vault/raw/pdf/source.pdf',
  };
  const sourceTab = {
    input: {
      uri: sourceUri,
      viewType: 'llm-wiki.pdfViewer',
    },
    isPreview: true,
  };
  const existingSelectionTab = {
    input: { uri },
    isPreview: false,
  };
  const sourceGroup = {
    viewColumn: 1,
    activeTab: sourceTab,
    tabs: [sourceTab],
  };
  const selectionGroup = {
    viewColumn: 2,
    activeTab: existingSelectionTab,
    tabs: [existingSelectionTab],
  };
  const groups = [sourceGroup, selectionGroup];
  let activeGroup = sourceGroup;
  const document = {
    lineCount: 1,
    lineAt: () => ({
      range: {
        end: { line: 0, character: 4 },
      },
    }),
  };
  const editor = {};
  class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  }
  class Selection {
    constructor(start, finish) {
      this.start = start;
      this.end = finish;
    }
  }
  const vscode = {
    Position,
    Selection,
    ViewColumn: {
      Beside: 99,
    },
    commands: {
      getCommands: async () => [
        'claude-vscode.insertAtMention',
      ],
      executeCommand: async (...args) => {
        calls.push(args);
        if (args[0] === 'vscode.openWith') {
          activeGroup = sourceGroup;
        }
      },
    },
    workspace: {
      openTextDocument: async value => {
        assert.equal(value, uri);
        return document;
      },
    },
    window: {
      tabGroups: {
        get activeTabGroup() {
          return activeGroup;
        },
        get all() {
          return groups;
        },
        close: async (...args) => {
          closedTabs.push(args);
          return true;
        },
      },
      showTextDocument: async (value, options) => {
        assert.equal(value, document);
        assert.deepEqual(options, {
          preview: false,
          viewColumn: vscode.ViewColumn.Beside,
        });
        activeGroup = selectionGroup;
        return editor;
      },
      showQuickPick: () => assert.fail('one provider should not prompt'),
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToAgent } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToAgent(uri), 'claude');
  assert.deepEqual(calls, [
    ['claude-vscode.insertAtMention'],
    [
      'vscode.openWith',
      sourceUri,
      'llm-wiki.pdfViewer',
      {
        viewColumn: 1,
        preserveFocus: false,
        preview: true,
      },
    ],
  ]);
  assert.deepEqual(closedTabs, []);
  assert.equal(activeGroup, sourceGroup);
});

test('Claude does not claim delivery when insertion and cleanup both fail', async () => {
  const calls = [];
  const warnings = [];
  const uri = {
    scheme: 'file',
    fsPath: '/vault/.llm_wiki/agent/exports/export-id/selection.md',
  };
  const sourceUri = {
    scheme: 'file',
    fsPath: '/vault/raw/pdf/source.pdf',
  };
  const sourceTab = {
    input: {
      uri: sourceUri,
      viewType: 'llm-wiki.pdfViewer',
    },
    isPreview: true,
  };
  const temporaryTab = {
    input: { uri },
    isPreview: true,
  };
  const sourceGroup = {
    viewColumn: 1,
    activeTab: sourceTab,
    tabs: [sourceTab],
  };
  const temporaryGroup = {
    viewColumn: 2,
    activeTab: temporaryTab,
    tabs: [temporaryTab],
  };
  const groups = [sourceGroup];
  let activeGroup = sourceGroup;
  const end = { line: 0, character: 4 };
  const document = { lineCount: 1, lineAt: () => ({ range: { end } }) };
  const editor = {};
  class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  }
  class Selection {
    constructor(start, finish) {
      this.start = start;
      this.end = finish;
    }
  }
  const vscode = {
    Position,
    Selection,
    ViewColumn: {
      Beside: 99,
    },
    commands: {
      getCommands: async () => ['claude-vscode.insertAtMention'],
      executeCommand: async (...args) => {
        calls.push(args);
        if (args[0] === 'claude-vscode.insertAtMention') {
          throw new Error('insertion failed');
        }
        if (args[0] === 'vscode.openWith') {
          activeGroup = sourceGroup;
        }
      },
    },
    extensions: extensionRegistry(installedExtension(
      'anthropic.claude-code',
      ['claude-vscode.insertAtMention'],
      { isActive: true },
    )),
    workspace: {
      openTextDocument: async value => {
        assert.equal(value, uri);
        return document;
      },
    },
    window: {
      tabGroups: {
        get activeTabGroup() {
          return activeGroup;
        },
        get all() {
          return groups;
        },
        close: async () => false,
      },
      showTextDocument: async (value, options) => {
        assert.equal(value, document);
        assert.deepEqual(options, {
          preview: false,
          viewColumn: vscode.ViewColumn.Beside,
        });
        groups.push(temporaryGroup);
        activeGroup = temporaryGroup;
        return editor;
      },
      showWarningMessage: message => warnings.push(message),
    },
  };
  const { handoffSelectionToAgentId } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToAgentId('claude', uri), false);
  assert.deepEqual(calls, [
    ['claude-vscode.insertAtMention'],
    [
      'vscode.openWith',
      sourceUri,
      'llm-wiki.pdfViewer',
      {
        viewColumn: 1,
        preserveFocus: false,
        preview: true,
      },
    ],
  ]);
  assert.deepEqual(warnings, ['Claude Code could not attach the selection.']);
  assert.equal(activeGroup, sourceGroup);
});

test('keeps the exported files when no supported agent is installed', async () => {
  const warnings = [];
  const vscode = {
    commands: {
      getCommands: async () => [],
      executeCommand: () => assert.fail('no command should run'),
    },
    window: {
      showQuickPick: () => assert.fail('no provider should prompt'),
      showWarningMessage: message => warnings.push(message),
    },
  };
  const { handoffSelectionToAgent } = loadAgentHandoff(vscode);

  assert.equal(
    await handoffSelectionToAgent({ fsPath: '/vault/.llm_wiki/agent/selection.md' }),
    undefined,
  );
  assert.deepEqual(warnings, [
    'Selection exported, but no supported agent sidebar is available.',
  ]);
});
