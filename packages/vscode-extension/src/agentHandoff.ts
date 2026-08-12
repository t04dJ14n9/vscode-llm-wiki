import * as vscode from 'vscode';

export type ExternalAgentId = 'codex' | 'claude' | 'codebuddy';

type AgentId = ExternalAgentId | 'cursor';

export interface AgentHandoffCapability {
  id: ExternalAgentId;
  label: string;
}

export interface AgentSurfaceCapabilities {
  cursorAgent: boolean;
  providers: AgentHandoffCapability[];
}

export interface AgentSurfaceCapabilitySource extends vscode.Disposable {
  readonly onDidChange: vscode.Event<void>;
  read(): AgentSurfaceCapabilities;
  refresh(): Promise<void>;
}

interface AgentChoice extends vscode.QuickPickItem {
  id: AgentId;
  commands: readonly string[];
  extensionIds?: readonly string[];
}

interface AvailableAgentChoice extends AgentChoice {
  command: string;
}

type AgentSurface = 'editor' | 'cursor-composer' | 'unknown';

interface AgentTarget {
  agent: AvailableAgentChoice;
  surface: AgentSurface;
}

const CURSOR_COMMAND = 'composer.addfilestocomposer';
const CURSOR_COMPOSERS_COMMAND = 'composer.getOrderedSelectedComposerIds';
const CURSOR_OPEN_COMMAND = 'workbench.action.chat.open';
const CLAUDE_HANDOFF_COMMANDS = [
  'claude-vscode.insertAtMention',
  'claude-code.insertAtMentioned',
] as const;

const AGENTS: readonly AgentChoice[] = [
  {
    id: 'codex',
    label: 'Codex',
    description: 'OpenAI Codex sidebar',
    commands: ['chatgpt.addFileToThread'],
    extensionIds: ['openai.chatgpt'],
  },
  {
    id: 'claude',
    label: 'Claude Code',
    description: 'Anthropic Claude sidebar',
    commands: CLAUDE_HANDOFF_COMMANDS,
    extensionIds: ['anthropic.claude-code', 'Anthropic.claude-code'],
  },
  {
    id: 'cursor',
    label: 'Cursor Agent',
    description: 'Cursor Agent chat',
    commands: [CURSOR_COMMAND],
  },
  {
    id: 'codebuddy',
    label: 'CodeBuddy',
    description: 'Tencent CodeBuddy chat',
    commands: ['tencentcloud.codingcopilot.addToChat'],
    extensionIds: [
      'tencent-cloud.coding-copilot',
      'Tencent-Cloud.coding-copilot',
    ],
  },
];

const EXTERNAL_AGENTS = AGENTS.filter(
  (agent): agent is AgentChoice & { id: ExternalAgentId } => agent.id !== 'cursor',
);

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

function computeAgentSurfaceCapabilities(
  registeredCommands: ReadonlySet<string>,
): AgentSurfaceCapabilities {
  const appName = String(vscode.env?.appName ?? '').toLowerCase();
  return {
    cursorAgent: appName.includes('cursor'),
    providers: EXTERNAL_AGENTS.flatMap(agent => {
      const extension = extensionForAgent(agent);
      if (!extension) return [];
      const contributedCommands = contributedCommandIds(extension);
      return agent.commands.some(command =>
        contributedCommands.has(command) || registeredCommands.has(command)
      )
        ? [{ id: agent.id, label: agent.label }]
        : [];
    }),
  };
}

export function getImmediateAgentSurfaceCapabilities(): AgentSurfaceCapabilities {
  return computeAgentSurfaceCapabilities(new Set());
}

export async function resolveAgentSurfaceCapabilities(): Promise<AgentSurfaceCapabilities> {
  let commands: readonly string[] = [];
  try {
    commands = await vscode.commands.getCommands(true);
  } catch {
    // Manifest capabilities remain valid when the command registry is unavailable.
  }
  return computeAgentSurfaceCapabilities(new Set(commands));
}

export function createAgentSurfaceCapabilitySource(): AgentSurfaceCapabilitySource {
  const changeEmitter = new vscode.EventEmitter<void>();
  let snapshot = getImmediateAgentSurfaceCapabilities();
  let revision = 0;
  let pendingRefreshes = 0;
  let disposed = false;

  const publish = (next: AgentSurfaceCapabilities): void => {
    if (sameAgentSurfaceCapabilities(snapshot, next)) return;
    snapshot = next;
    changeEmitter.fire();
  };

  const refresh = async (): Promise<void> => {
    if (disposed) return;
    const refreshRevision = ++revision;
    pendingRefreshes += 1;
    try {
      const next = await resolveAgentSurfaceCapabilities();
      if (!disposed && refreshRevision === revision) publish(next);
    } finally {
      pendingRefreshes -= 1;
    }
  };

  const scheduleRefresh = (): void => {
    if (disposed || pendingRefreshes > 0) return;
    void refresh();
  };

  const extensionSubscription = vscode.extensions.onDidChange(() => {
    if (disposed) return;
    revision += 1;
    publish(getImmediateAgentSurfaceCapabilities());
    void refresh();
  });

  scheduleRefresh();

  return {
    onDidChange: changeEmitter.event,
    read() {
      scheduleRefresh();
      return snapshot;
    },
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      revision += 1;
      extensionSubscription.dispose();
      changeEmitter.dispose();
    },
  };
}

function sameAgentSurfaceCapabilities(
  left: AgentSurfaceCapabilities,
  right: AgentSurfaceCapabilities,
): boolean {
  return left.cursorAgent === right.cursorAgent
    && left.providers.length === right.providers.length
    && left.providers.every((provider, index) => {
      const other = right.providers[index];
      return provider.id === other?.id && provider.label === other.label;
    });
}

export async function handoffSelectionToAgentId(
  agentId: ExternalAgentId,
  contextUri: vscode.Uri,
  attachmentUris: readonly vscode.Uri[] = [],
): Promise<boolean> {
  const agent = EXTERNAL_AGENTS.find(candidate => candidate.id === agentId);
  if (!agent) return false;

  const extension = extensionForAgent(agent);
  if (!extension) {
    vscode.window.showWarningMessage(`${agent.label} is not available.`);
    return false;
  }
  if (!extension.isActive) {
    try {
      await extension.activate();
    } catch {
      vscode.window.showWarningMessage(`${agent.label} could not be activated.`);
      return false;
    }
  }

  let command: string | undefined;
  try {
    const commands = new Set(await vscode.commands.getCommands(true));
    command = availableAgentCommand(agent, commands);
  } catch {
    vscode.window.showWarningMessage(`${agent.label} handoff is not available.`);
    return false;
  }
  if (!command) {
    vscode.window.showWarningMessage(`${agent.label} handoff is not available.`);
    return false;
  }
  try {
    await executeAgentHandoff(agent, command, contextUri, attachmentUris);
    return true;
  } catch {
    vscode.window.showWarningMessage(`${agent.label} could not attach the selection.`);
    return false;
  }
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
    .filter((agent): agent is AvailableAgentChoice => agent !== undefined);
  if (!available.length) {
    vscode.window.showWarningMessage(
      'Selection exported, but no supported agent sidebar is available.',
    );
    return undefined;
  }
  const target = await selectAgentTarget(available, commands);
  if (!target) return undefined;
  const { agent } = target;

  if (agent.id === 'cursor') {
    if (!await handoffSelectionToCursorWithCommands(
      contextUri,
      attachmentUris,
      commands,
      target.surface === 'cursor-composer' ? true : undefined,
    )) return undefined;
  } else {
    await executeAgentHandoff(agent, agent.command, contextUri, attachmentUris);
  }
  return agent.id;
}

async function selectAgentTarget(
  available: readonly AvailableAgentChoice[],
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
  availableById: ReadonlyMap<AgentId, AvailableAgentChoice>,
): { active?: AvailableAgentChoice; visible: AvailableAgentChoice[] } {
  const tabGroups = vscode.window.tabGroups;
  if (!tabGroups) return { visible: [] };

  const activeId = agentIdForEditorTab(tabGroups.activeTabGroup?.activeTab);
  const active = activeId ? availableById.get(activeId) : undefined;
  const visible: AvailableAgentChoice[] = [];
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
): AvailableAgentChoice | undefined {
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
  return { ...agent, command };
}

function availableAgentCommand(
  agent: AgentChoice,
  commands: ReadonlySet<string>,
): string | undefined {
  return agent.commands.find(command => commands.has(command));
}

function extensionForAgent(
  agent: AgentChoice,
): vscode.Extension<unknown> | undefined {
  const extensions = vscode.extensions as typeof vscode.extensions | undefined;
  if (!agent.extensionIds?.length || typeof extensions?.getExtension !== 'function') {
    return undefined;
  }
  return agent.extensionIds
    .map(id => extensions.getExtension<unknown>(id))
    .find((extension): extension is vscode.Extension<unknown> => extension !== undefined);
}

function contributedCommandIds(extension: vscode.Extension<unknown>): Set<string> {
  const manifest: unknown = extension.packageJSON;
  const commands = manifestCommandContributions(manifest);
  if (!Array.isArray(commands)) return new Set();
  return new Set(commands.flatMap(item =>
    isCommandContribution(item) ? [item.command] : []
  ));
}

function manifestCommandContributions(manifest: unknown): unknown {
  if (typeof manifest !== 'object' || manifest === null || !('contributes' in manifest)) {
    return undefined;
  }
  const contributes = manifest.contributes;
  if (
    typeof contributes !== 'object'
    || contributes === null
    || !('commands' in contributes)
  ) {
    return undefined;
  }
  return contributes.commands;
}

function isCommandContribution(item: unknown): item is { command: string } {
  return typeof item === 'object'
    && item !== null
    && 'command' in item
    && typeof item.command === 'string';
}

async function executeAgentHandoff(
  agent: AgentChoice,
  command: string,
  contextUri: vscode.Uri,
  attachmentUris: readonly vscode.Uri[],
): Promise<void> {
  if (agent.id === 'claude') {
    const document = await vscode.workspace.openTextDocument(contextUri);
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    const end = document.lineAt(Math.max(0, document.lineCount - 1)).range.end;
    editor.selection = new vscode.Selection(new vscode.Position(0, 0), end);
    await vscode.commands.executeCommand(command);
  } else if (agent.id === 'codex') {
    const attachments = uniqueLocalUris([contextUri, ...attachmentUris]);
    await vscode.commands.executeCommand(command, attachments[0]!);
    for (const uri of attachments.slice(1)) {
      try {
        await vscode.commands.executeCommand(command, uri);
      } catch {
        vscode.window.showWarningMessage(
          'Codex attached selection.md, but could not attach the optional image. Continue with text context or try again.',
        );
      }
    }
  } else if (agent.id === 'codebuddy' && attachmentUris.length) {
    const attachments = uniqueLocalUris([contextUri, ...attachmentUris]);
    await vscode.commands.executeCommand(command, contextUri, attachments);
  } else {
    await vscode.commands.executeCommand(command, contextUri);
  }
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
