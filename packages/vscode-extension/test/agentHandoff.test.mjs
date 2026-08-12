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

test('cold installed providers are visible before activation', () => {
  const vscode = {
    env: { appName: 'Visual Studio Code' },
    extensions: extensionRegistry(
      installedExtension('OPENAI.CHATGPT', ['chatgpt.addFileToThread']),
      installedExtension('Anthropic.Claude-Code', ['claude-code.insertAtMentioned']),
      installedExtension('TENCENT-CLOUD.CODING-COPILOT', ['tencentcloud.codingcopilot.addToChat']),
    ),
  };
  const { getAgentSurfaceCapabilities } = loadAgentHandoff(vscode);

  assert.deepEqual(getAgentSurfaceCapabilities(), {
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
  const { getAgentSurfaceCapabilities } = loadAgentHandoff(vscode);

  assert.deepEqual(getAgentSurfaceCapabilities().providers, []);
});

test('cursor agent capability follows the host product name only', () => {
  const { getAgentSurfaceCapabilities } = loadAgentHandoff({
    env: { appName: 'Cursor' },
    extensions: extensionRegistry(),
  });

  assert.equal(getAgentSurfaceCapabilities().cursorAgent, true);
});

test('explicit cold Codex handoff activates, refreshes commands, then attaches', async () => {
  const order = [];
  const selection = {
    scheme: 'file',
    fsPath: '/vault/.hl/agent/selection.md',
  };
  const crop = {
    scheme: 'file',
    fsPath: '/vault/.hl/agent/selection.png',
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
    fsPath: '/vault/.hl/agent/selection.md',
  };
  const crop = {
    scheme: 'file',
    fsPath: '/vault/.hl/agent/selection.png',
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
    fsPath: '/vault/.hl/agent/selection.md',
  };
  const crop = {
    scheme: 'file',
    fsPath: '/vault/.hl/agent/selection.png',
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
    fsPath: '/vault/.hl/agent/selection.md',
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
    fsPath: '/vault/.hl/agent/selection.md',
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
    fsPath: '/vault/.hl/agent/selection.md',
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
    fsPath: '/vault/.hl/agent/selection.md',
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

test('stable visible Claude editor routes there without reopening its sidebar', async () => {
  const calls = [];
  const uri = {
    scheme: 'file',
    fsPath: '/vault/.hl/agent/selection.md',
  };
  const mainGroup = {
    activeTab: {
      input: {
        uri: { scheme: 'file' },
      },
    },
  };
  const claudeGroup = {
    activeTab: {
      input: { viewType: 'claudeVSCodePanel' },
    },
  };
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
    commands: {
      getCommands: async () => [
        'chatgpt.addFileToThread',
        'claude-vscode.sidebar.open',
        'claude-vscode.insertAtMention',
        'claude-vscode.focus',
      ],
      executeCommand: async (...args) => calls.push(args),
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
      openTextDocument: async () => document,
    },
    window: {
      tabGroups: {
        activeTabGroup: mainGroup,
        all: [mainGroup, claudeGroup],
      },
      showTextDocument: async () => editor,
      showQuickPick: () => assert.fail('one visible chat editor should auto-route'),
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToAgent } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToAgent(uri), 'claude');
  assert.deepEqual(calls, [['claude-vscode.insertAtMention']]);
  assert.equal(editor.selection.end, end);
});

test('multiple visible chat editors show a picker narrowed to those stable targets', async () => {
  const calls = [];
  const pickedIds = [];
  const uri = {
    scheme: 'file',
    fsPath: '/vault/.hl/agent/selection.md',
  };
  const mainGroup = {
    activeTab: {
      input: { uri: { scheme: 'file' } },
    },
  };
  const codexGroup = {
    activeTab: {
      input: { viewType: 'chatgpt.conversationEditor' },
    },
  };
  const claudeGroup = {
    activeTab: {
      input: { viewType: 'claudeVSCodePanel' },
    },
  };
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
      },
    },
    extensions: {
      getExtension: id => ({ id }),
    },
    workspace: {
      openTextDocument: async () => document,
    },
    window: {
      tabGroups: {
        activeTabGroup: mainGroup,
        all: [mainGroup, codexGroup, claudeGroup],
      },
      showTextDocument: async () => editor,
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
  assert.deepEqual(calls, [['claude-vscode.insertAtMention']]);
});

test('installed-extension capability check ignores a stale foreign command', async () => {
  const calls = [];
  const uri = {
    scheme: 'file',
    fsPath: '/vault/.hl/agent/selection.md',
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
    fsPath: '/vault/.hl/agent/selection.md',
  };
  const crop = {
    scheme: 'file',
    fsPath: '/vault/.hl/agent/selection.png',
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
    fsPath: '/vault/.hl/agent/selection.md',
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
      fsPath: '/vault/.hl/agent/selection.md',
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
    fsPath: '/vault/.hl/agent/selection.md',
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
    fsPath: '/vault/.hl/agent/selection.md',
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
    fsPath: '/vault/.hl/agent/selection.md',
  };
  const crop = {
    scheme: 'file',
    fsPath: '/vault/.hl/agent/selection.png',
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
    fsPath: '/vault/.hl/agent/selection.md',
  };
  const crop = {
    scheme: 'file',
    fsPath: '/vault/.hl/agent/selection.png',
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
    fsPath: '/vault/.hl/agent/selection.md',
  };
  const crop = {
    scheme: 'file',
    fsPath: '/vault/.hl/annotations/pdf/page-3.png',
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
    fsPath: '/vault/.hl/agent/selection.md',
  };
  const crop = {
    scheme: 'file',
    fsPath: '/vault/.hl/annotations/pdf/page-3.png',
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
  const uri = { fsPath: '/vault/.hl/agent/selection.md' };
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
    fsPath: '/vault/.hl/agent/selection.md',
  };
  const crop = {
    scheme: 'file',
    fsPath: '/vault/.hl/agent/selection.png',
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
  const uri = { fsPath: '/vault/.hl/agent/selection.md' };
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
  const uri = {
    scheme: 'file',
    fsPath: '/vault/.hl/agent/selection.md',
  };
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
    commands: {
      getCommands: async () => [
        'claude-vscode.sidebar.open',
        'claude-vscode.insertAtMention',
        'claude-vscode.focus',
      ],
      executeCommand: async (...args) => calls.push(args),
    },
    workspace: {
      openTextDocument: async () => document,
    },
    window: {
      showTextDocument: async () => editor,
      showQuickPick: () => assert.fail('one provider should not prompt'),
      showWarningMessage: () => undefined,
    },
  };
  const { handoffSelectionToAgent } = loadAgentHandoff(vscode);

  assert.equal(await handoffSelectionToAgent(uri), 'claude');
  assert.equal(editor.selection.start.line, 0);
  assert.equal(editor.selection.end, end);
  assert.deepEqual(calls, [['claude-vscode.insertAtMention']]);
  assert.equal(
    calls.some(([command]) => /submit|send/i.test(command)),
    false,
  );
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
    await handoffSelectionToAgent({ fsPath: '/vault/.hl/agent/selection.md' }),
    undefined,
  );
  assert.deepEqual(warnings, [
    'Selection exported, but no supported agent sidebar is available.',
  ]);
});
