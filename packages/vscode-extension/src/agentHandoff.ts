import * as vscode from 'vscode';

type AgentId = 'codex' | 'claude' | 'cursor' | 'codebuddy';

interface AgentChoice extends vscode.QuickPickItem {
  id: AgentId;
  command: string;
  fallbackCommands?: readonly string[];
  extensionIds?: readonly string[];
}

type AgentSurface = 'editor' | 'cursor-composer' | 'unknown';

interface AgentTarget {
  agent: AgentChoice;
  surface: AgentSurface;
}

const CURSOR_COMMAND = 'composer.addfilestocomposer';
const CURSOR_COMPOSERS_COMMAND = 'composer.getOrderedSelectedComposerIds';
const CURSOR_OPEN_COMMAND = 'workbench.action.chat.open';
const CLAUDE_INSERT_COMMAND = 'claude-vscode.insertAtMention';

const AGENTS: readonly AgentChoice[] = [
  {
    id: 'codex',
    label: 'Codex',
    description: 'OpenAI Codex sidebar',
    command: 'chatgpt.addFileToThread',
    extensionIds: ['openai.chatgpt'],
  },
  {
    id: 'claude',
    label: 'Claude Code',
    description: 'Anthropic Claude sidebar',
    command: CLAUDE_INSERT_COMMAND,
    fallbackCommands: ['claude-vscode.focus'],
    extensionIds: ['anthropic.claude-code', 'Anthropic.claude-code'],
  },
  {
    id: 'cursor',
    label: 'Cursor Agent',
    description: 'Cursor Agent chat',
    command: CURSOR_COMMAND,
  },
  {
    id: 'codebuddy',
    label: 'CodeBuddy',
    description: 'Tencent CodeBuddy chat',
    command: 'tencentcloud.codingcopilot.addToChat',
    extensionIds: [
      'tencent-cloud.coding-copilot',
      'Tencent-Cloud.coding-copilot',
    ],
  },
];

const EDITOR_CHAT_VIEW_TYPES: Readonly<Record<string, AgentId>> = {
  'chatgpt.conversationEditor': 'codex',
  claudeVSCodePanel: 'claude',
};

export async function handoffSelectionToCursor(
  contextUri: vscode.Uri,
  attachmentUris: readonly vscode.Uri[] = [],
): Promise<boolean> {
  const commands = new Set(await vscode.commands.getCommands(true));
  return handoffSelectionToCursorWithCommands(
    contextUri,
    attachmentUris,
    commands,
  );
}

async function handoffSelectionToCursorWithCommands(
  contextUri: vscode.Uri,
  attachmentUris: readonly vscode.Uri[],
  commands: ReadonlySet<string>,
  knownActiveComposer?: boolean,
): Promise<boolean> {
  if (!commands.has(CURSOR_COMMAND)) {
    vscode.window.showWarningMessage('Cursor chat is not available.');
    return false;
  }

  const attachments = uniqueLocalUris([contextUri, ...attachmentUris]);
  const hasActiveComposer = knownActiveComposer
    ?? await cursorHasActiveComposer(commands);
  if (hasActiveComposer === false) {
    if (!commands.has(CURSOR_OPEN_COMMAND)) {
      vscode.window.showWarningMessage(
        'Cursor could not find an open Agent composer. Open Cursor Chat and try again.',
      );
      return false;
    }
    try {
      await vscode.commands.executeCommand(CURSOR_OPEN_COMMAND, {
        query: 'Use the attached learning passage as context.',
        isPartialQuery: true,
      });
    } catch {
      // Cursor can create the composer before its open command rejects.
    }
  }

  try {
    await attachToCursor(attachments[0]!);
  } catch {
    vscode.window.showWarningMessage(
      'Cursor could not attach selection.md. Open Cursor Chat and try again.',
    );
    return false;
  }
  for (const uri of attachments.slice(1)) {
    try {
      await attachToCursor(uri);
    } catch {
      vscode.window.showWarningMessage(
        'Cursor attached selection.md, but could not attach the optional image. Continue with text context or try again.',
      );
    }
  }
  return true;
}

export async function handoffSelectionToAgent(
  contextUri: vscode.Uri,
  attachmentUris: readonly vscode.Uri[] = [],
): Promise<AgentId | undefined> {
  const commands = new Set(await vscode.commands.getCommands(true));
  const available = AGENTS
    .map(agent => availableAgent(agent, commands))
    .filter((agent): agent is AgentChoice => agent !== undefined);
  if (!available.length) {
    vscode.window.showWarningMessage(
      'Selection exported, but no supported agent sidebar is available.',
    );
    return undefined;
  }
  const target = await selectAgentTarget(available, commands);
  if (!target) return undefined;
  const { agent } = target;

  if (agent.id === 'claude') {
    const document = await vscode.workspace.openTextDocument(contextUri);
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    const end = document.lineAt(Math.max(0, document.lineCount - 1)).range.end;
    editor.selection = new vscode.Selection(new vscode.Position(0, 0), end);
    // Claude's contributed insert-at-mention command reads the active native
    // selection and appends an @file#line reference to its current draft.
    if (
      target.surface !== 'editor'
      && agent.command !== CLAUDE_INSERT_COMMAND
      && commands.has('claude-vscode.sidebar.open')
    ) {
      await vscode.commands.executeCommand('claude-vscode.sidebar.open');
    }
    await vscode.commands.executeCommand(agent.command);
  } else if (agent.id === 'cursor') {
    if (!await handoffSelectionToCursorWithCommands(
      contextUri,
      attachmentUris,
      commands,
      target.surface === 'cursor-composer' ? true : undefined,
    )) return undefined;
  } else if (agent.id === 'codex') {
    for (const uri of uniqueLocalUris([contextUri, ...attachmentUris])) {
      await vscode.commands.executeCommand(agent.command, uri);
    }
  } else if (agent.id === 'codebuddy' && attachmentUris.length) {
    const attachments = uniqueLocalUris([contextUri, ...attachmentUris]);
    await vscode.commands.executeCommand(
      agent.command,
      contextUri,
      attachments,
    );
  } else {
    await vscode.commands.executeCommand(agent.command, contextUri);
  }
  return agent.id;
}

async function selectAgentTarget(
  available: readonly AgentChoice[],
  commands: ReadonlySet<string>,
): Promise<AgentTarget | undefined> {
  const availableById = new Map(available.map(agent => [agent.id, agent]));
  const editorTargets = visibleEditorChatTargets(availableById);

  if (editorTargets.active) {
    return {
      agent: editorTargets.active,
      surface: 'editor',
    };
  }
  if (editorTargets.visible.length === 1) {
    return {
      agent: editorTargets.visible[0]!,
      surface: 'editor',
    };
  }
  if (editorTargets.visible.length > 1) {
    const agent = await vscode.window.showQuickPick(editorTargets.visible, {
      placeHolder: 'Choose a visible agent chat for the selected passage…',
    });
    return agent ? { agent, surface: 'editor' } : undefined;
  }

  const cursor = availableById.get('cursor');
  if (cursor && await cursorHasActiveComposer(commands) === true) {
    return {
      agent: cursor,
      surface: 'cursor-composer',
    };
  }

  const agent = available.length === 1
    ? available[0]
    : await vscode.window.showQuickPick(available, {
        placeHolder: 'Send the selected passage to…',
      });
  return agent ? { agent, surface: 'unknown' } : undefined;
}

function visibleEditorChatTargets(
  availableById: ReadonlyMap<AgentId, AgentChoice>,
): { active?: AgentChoice; visible: AgentChoice[] } {
  const tabGroups = vscode.window.tabGroups;
  if (!tabGroups) return { visible: [] };

  const activeId = agentIdForEditorTab(tabGroups.activeTabGroup?.activeTab);
  const active = activeId ? availableById.get(activeId) : undefined;
  const visible: AgentChoice[] = [];
  const seen = new Set<AgentId>();
  for (const group of tabGroups.all ?? []) {
    const id = agentIdForEditorTab(group.activeTab);
    const agent = id ? availableById.get(id) : undefined;
    if (!agent || seen.has(agent.id)) continue;
    seen.add(agent.id);
    visible.push(agent);
  }
  return {
    ...(active ? { active } : {}),
    visible,
  };
}

function agentIdForEditorTab(
  tab: vscode.Tab | undefined,
): AgentId | undefined {
  const input = tab?.input as {
    uri?: { scheme?: unknown };
    viewType?: unknown;
  } | undefined;
  if (!input) return undefined;
  if (typeof input.viewType === 'string') {
    const id = EDITOR_CHAT_VIEW_TYPES[input.viewType];
    if (id) return id;
  }
  return input.uri?.scheme === 'openai-codex' ? 'codex' : undefined;
}

function availableAgent(
  agent: AgentChoice,
  commands: ReadonlySet<string>,
): AgentChoice | undefined {
  const command = availableAgentCommand(agent, commands);
  if (!command) return undefined;

  const extensions = (
    vscode.extensions as typeof vscode.extensions | undefined
  );
  if (
    agent.extensionIds?.length
    && typeof extensions?.getExtension === 'function'
    && !agent.extensionIds.some(id => extensions.getExtension(id) !== undefined)
  ) {
    return undefined;
  }
  return command === agent.command ? agent : { ...agent, command };
}

function availableAgentCommand(
  agent: AgentChoice,
  commands: ReadonlySet<string>,
): string | undefined {
  return [agent.command, ...(agent.fallbackCommands ?? [])]
    .find(command => commands.has(command));
}

function uniqueLocalUris(uris: readonly vscode.Uri[]): vscode.Uri[] {
  const seen = new Set<string>();
  return uris.filter(uri => {
    if (uri.scheme !== 'file' || !uri.fsPath) {
      throw new Error('Agent chat attachments must be local files.');
    }
    if (seen.has(uri.fsPath)) return false;
    seen.add(uri.fsPath);
    return true;
  });
}

async function attachToCursor(uri: vscode.Uri): Promise<void> {
  await vscode.commands.executeCommand(
    CURSOR_COMMAND,
    uri,
    { useExactResource: true },
  );
}

async function cursorHasActiveComposer(
  commands: ReadonlySet<string>,
): Promise<boolean | undefined> {
  if (!commands.has(CURSOR_COMPOSERS_COMMAND)) return undefined;
  try {
    const ids = await vscode.commands.executeCommand<unknown>(CURSOR_COMPOSERS_COMMAND);
    return Array.isArray(ids)
      ? ids.some(id => typeof id === 'string' && id.length > 0)
      : undefined;
  } catch {
    return undefined;
  }
}
