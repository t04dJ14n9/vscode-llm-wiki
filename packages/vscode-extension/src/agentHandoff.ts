import * as vscode from 'vscode';
import type { SourceLineRange } from './selectionContext';

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

export type AgentHandoffContext =
  | { kind: 'markdown-range'; uri: vscode.Uri; range: SourceLineRange }
  | { kind: 'selection-export'; uri: vscode.Uri };

type HandoffContextInput = AgentHandoffContext | vscode.Uri;

export interface CursorRawTextHandoff {
  uri: vscode.Uri;
  range: SourceLineRange;
  rawText: string;
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

interface RestorableEditorTab {
  uri: vscode.Uri;
  viewColumn: vscode.ViewColumn;
  preview: boolean;
  viewType?: string;
}

const CURSOR_COMMAND = 'composer.addfilestocomposer';
const CURSOR_SELECTION_COMMAND = 'composer.addsymbolstocomposer';
const CURSOR_COMPOSERS_COMMAND = 'composer.getOrderedSelectedComposerIds';
const CURSOR_OPEN_COMMAND = 'workbench.action.chat.open';
const CODEX_ADD_TO_THREAD_COMMAND = 'chatgpt.addToThread';
const CODEX_ADD_FILE_TO_THREAD_COMMAND = 'chatgpt.addFileToThread';
const CLAUDE_EDITOR_OPEN_COMMAND = 'claude-vscode.editor.open';
const CLAUDE_SIDEBAR_OPEN_COMMAND = 'claude-vscode.sidebar.open';
const MARKDOWN_EDITOR_VIEW_TYPE = 'llm-wiki.markdownEditor';
const CLAUDE_HANDOFF_COMMANDS = [
  'claude-vscode.insertAtMention',
  'claude-code.insertAtMentioned',
] as const;

const AGENTS: readonly AgentChoice[] = [
  {
    id: 'codex',
    label: 'Codex',
    description: 'OpenAI Codex sidebar',
    commands: [CODEX_ADD_TO_THREAD_COMMAND, CODEX_ADD_FILE_TO_THREAD_COMMAND],
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
  input: HandoffContextInput,
  attachmentUris: readonly vscode.Uri[] = [],
): Promise<boolean> {
  const commands = new Set(await vscode.commands.getCommands(true));
  return handoffSelectionToCursorWithCommands(
    normalizeHandoffContext(input),
    attachmentUris,
    commands,
  );
}

export async function handoffRawTextToCursor(
  input: CursorRawTextHandoff,
  attachmentUris: readonly vscode.Uri[] = [],
): Promise<boolean> {
  if (
    input.uri.scheme !== 'file'
    || !input.uri.fsPath
    || !input.rawText.trim()
    || !Number.isSafeInteger(input.range.startLine)
    || !Number.isSafeInteger(input.range.endLine)
    || input.range.startLine < 1
    || input.range.endLine < input.range.startLine
  ) {
    vscode.window.showWarningMessage('The selected PDF text could not be added to chat.');
    return false;
  }

  const commands = new Set(await vscode.commands.getCommands(true));
  if (!commands.has(CURSOR_SELECTION_COMMAND)) {
    vscode.window.showWarningMessage('Cursor chat cannot accept raw selection text.');
    return false;
  }

  const hasActiveComposer = await cursorHasActiveComposer(commands);
  if (hasActiveComposer === false) {
    if (!commands.has(CURSOR_OPEN_COMMAND)) {
      vscode.window.showWarningMessage(
        'Cursor could not find an open Agent composer. Open Cursor Chat and try again.',
      );
      return false;
    }
    try {
      await vscode.commands.executeCommand(CURSOR_OPEN_COMMAND, {
        query: 'Use the selected PDF passage as context.',
        isPartialQuery: true,
      });
    } catch {
      // Cursor can create the composer before its open command rejects.
    }
  }

  const lines = input.rawText.split('\n');
  const endLine = input.range.startLine + lines.length - 1;
  try {
    await vscode.commands.executeCommand(CURSOR_SELECTION_COMMAND, {
      codeSelections: [{
        uri: input.uri,
        range: {
          selectionStartLineNumber: input.range.startLine,
          selectionStartColumn: 1,
          positionLineNumber: endLine,
          positionColumn: (lines.at(-1)?.length ?? 0) + 1,
        },
        text: input.rawText,
        rawText: input.rawText,
      }],
    });
  } catch {
    vscode.window.showWarningMessage(
      'Cursor could not add the selected PDF text. Open Cursor Chat and try again.',
    );
    return false;
  }

  for (const uri of uniqueLocalUris(attachmentUris)) {
    try {
      await attachToCursor(uri);
    } catch {
      vscode.window.showWarningMessage(
        'Cursor added the selected PDF text, but could not attach the optional image.',
      );
    }
  }
  return true;
}

function computeAgentSurfaceCapabilities(
  registeredCommands: ReadonlySet<string>,
): AgentSurfaceCapabilities {
  return {
    cursorAgent: isCursorHost(),
    providers: EXTERNAL_AGENTS.flatMap(agent => {
      const extension = extensionForAgent(agent);
      if (!extension) return [];
      const contributedCommands = contributedCommandIds(extension);
      const availableCommands = new Set([
        ...contributedCommands,
        ...registeredCommands,
      ]);
      return availableAgentCommand(agent, availableCommands)
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
  input: HandoffContextInput,
  attachmentUris: readonly vscode.Uri[] = [],
): Promise<boolean> {
  const context = normalizeHandoffContext(input);
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
    await executeAgentHandoff(agent, command, context, attachmentUris);
    return true;
  } catch {
    vscode.window.showWarningMessage(`${agent.label} could not attach the selection.`);
    return false;
  }
}

async function handoffSelectionToCursorWithCommands(
  context: AgentHandoffContext,
  attachmentUris: readonly vscode.Uri[],
  commands: ReadonlySet<string>,
  knownActiveComposer?: boolean,
): Promise<boolean> {
  if (!commands.has(CURSOR_COMMAND)
    && !commands.has(CURSOR_SELECTION_COMMAND)) {
    vscode.window.showWarningMessage('Cursor chat is not available.');
    return false;
  }

  const attachments = uniqueLocalUris([
    attachmentUriForContext(context),
    ...attachmentUris,
  ]);
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
    if (context.kind === 'markdown-range' && commands.has(CURSOR_SELECTION_COMMAND)) {
      await attachSelectionToCursor(context);
    } else {
      await attachToCursor(attachments[0]!);
    }
  } catch {
    vscode.window.showWarningMessage(
      context.kind === 'markdown-range'
        ? 'Cursor could not attach the selected passage. Open Cursor Chat and try again.'
        : 'Cursor could not attach selection.md. Open Cursor Chat and try again.',
    );
    return false;
  }
  for (const uri of attachments.slice(1)) {
    try {
      // The Markdown source is already attached through Cursor's selection
      // command above. Optional files (for example an image crop) still use
      // the file attachment command.
      if (context.kind === 'markdown-range' && uri.fsPath === context.uri.fsPath) {
        continue;
      }
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
  input: HandoffContextInput,
  attachmentUris: readonly vscode.Uri[] = [],
): Promise<AgentId | undefined> {
  const context = normalizeHandoffContext(input);
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
      context,
      attachmentUris,
      commands,
      target.surface === 'cursor-composer' ? true : undefined,
    )) return undefined;
  } else {
    await executeAgentHandoff(agent, agent.command, context, attachmentUris);
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

function isCursorHost(): boolean {
  return String(vscode.env?.appName ?? '').toLowerCase().includes('cursor');
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
  context: AgentHandoffContext,
  attachmentUris: readonly vscode.Uri[],
): Promise<void> {
  const contextUri = attachmentUriForContext(context);
  if (agent.id === 'claude') {
    if (isCursorHost()) {
      // The sidebar insertion command needs a real source document and an
      // active range. Exported selection.md files intentionally keep the
      // immutable-file editor fallback used by older Claude integrations.
      const canDriveSidebar = context.kind === 'markdown-range'
        && typeof vscode.window.showTextDocument === 'function';
      if (canDriveSidebar
        && (command === CLAUDE_HANDOFF_COMMANDS[0]
          || command === CLAUDE_HANDOFF_COMMANDS[1])) {
        await executeWithNativeSelection(context, command);
      } else {
        // Older Claude builds exposed only the editor command. Keep this as
        // a compatibility fallback, but never prefer it when the sidebar
        // insertion command is available because it opens a second editor.
        const range = context.kind === 'markdown-range'
          ? context.range
          : { startLine: 1, endLine: (await vscode.workspace.openTextDocument(contextUri)).lineCount };
        const reference = formatClaudeSelectionReference(contextUri, range);
        await vscode.commands.executeCommand(
          CLAUDE_EDITOR_OPEN_COMMAND,
          undefined,
          reference,
          vscode.ViewColumn.Beside,
        );
      }
      return;
    }
    const sourceTab = activeRestorableEditorTab();
    const sourceUri = stripFragment(contextUri);
    const existingContextTabs = new Set(tabsForUri(sourceUri));
    const document = await vscode.workspace.openTextDocument(sourceUri);
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
      viewColumn: vscode.ViewColumn.Beside,
    });
    const temporaryTab = tabsForUri(sourceUri)
      .find(tab => !existingContextTabs.has(tab));
    const range = context.kind === 'markdown-range'
      ? context.range
      : { startLine: 1, endLine: document.lineCount };
    const end = document.lineAt(Math.max(0, range.endLine - 1)).range.end;
    editor.selection = new vscode.Selection(
      new vscode.Position(Math.max(0, range.startLine - 1), 0),
      end,
    );
    let mentionInserted = false;
    try {
      await vscode.commands.executeCommand(command);
      mentionInserted = true;
    } finally {
      const closed = await closeTemporaryClaudeContextTab(
        temporaryTab,
        sourceUri,
      );
      const restored = await restoreEditorTab(sourceTab);
      if (mentionInserted && (!closed || !restored)) {
        vscode.window.showWarningMessage(
          'Claude received selection.md, but LLM Wiki could not fully restore the source editor.',
        );
      }
    }
  } else if (agent.id === 'codex') {
    if (context.kind === 'markdown-range' && command === CODEX_ADD_TO_THREAD_COMMAND) {
      await executeWithNativeSelection(context, command);
      return;
    }
    const attachments = uniqueLocalUris([contextUri, ...attachmentUris]);
    const fileCommand = command === CODEX_ADD_TO_THREAD_COMMAND
      ? await registeredCommand(CODEX_ADD_FILE_TO_THREAD_COMMAND)
      : command;
    if (!fileCommand) {
      throw new Error('Codex file attachment command is unavailable.');
    }
    await vscode.commands.executeCommand(fileCommand, attachments[0]!);
    for (const uri of attachments.slice(1)) {
      try {
        await vscode.commands.executeCommand(fileCommand, uri);
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

function formatClaudeSelectionReference(
  contextUri: vscode.Uri,
  range: SourceLineRange,
): string {
  const relativePath = vscode.workspace
    .asRelativePath(contextUri)
    .replaceAll('\\', '/');
  return `@${relativePath}#${range.startLine}-${range.endLine} `;
}

function normalizeHandoffContext(input: HandoffContextInput): AgentHandoffContext {
  return 'kind' in input
    ? input
    : { kind: 'selection-export', uri: input };
}

function attachmentUriForContext(context: AgentHandoffContext): vscode.Uri {
  if (context.kind !== 'markdown-range') return context.uri;
  return context.uri.with({
    fragment: `L${context.range.startLine}-L${context.range.endLine}`,
  });
}

async function registeredCommand(command: string): Promise<string | undefined> {
  try {
    return (await vscode.commands.getCommands(true)).includes(command)
      ? command
      : undefined;
  } catch {
    return undefined;
  }
}

async function attachSelectionToCursor(
  context: Extract<AgentHandoffContext, { kind: 'markdown-range' }>,
): Promise<void> {
  const sourceUri = stripFragment(context.uri);
  const document = await vscode.workspace.openTextDocument(sourceUri);
  const startLine = Math.max(1, Math.min(context.range.startLine, document.lineCount));
  const endLine = Math.max(startLine, Math.min(context.range.endLine, document.lineCount));
  const start = Math.max(0, startLine - 1);
  const end = Math.max(0, endLine - 1);
  const rawText = document.getText(
    new vscode.Range(
      new vscode.Position(start, 0),
      document.lineAt(end).range.end,
    ),
  );
  const language = String(sourceUri.path ?? sourceUri.fsPath ?? '')
    .toLowerCase()
    .endsWith('.md') ? 'markdown' : '';
  await vscode.commands.executeCommand(CURSOR_SELECTION_COMMAND, {
    codeSelections: [{
      uri: sourceUri,
      range: {
        selectionStartLineNumber: startLine,
        selectionStartColumn: 1,
        positionLineNumber: endLine,
        positionColumn: document.lineAt(end).range.end.character + 1,
      },
      rawText,
      text: `\`\`\`${language}\n${rawText}\n\`\`\``,
    }],
  });
}

async function executeWithNativeSelection(
  context: AgentHandoffContext,
  command: string,
): Promise<void> {
  const contextUri = stripFragment(attachmentUriForContext(context));
  if (
    isCursorHost()
    && (command === CLAUDE_HANDOFF_COMMANDS[0] || command === CLAUDE_HANDOFF_COMMANDS[1])
  ) {
    // Claude's insertion command opens a new editor when no visible chat
    // surface can receive its mention. Reveal the existing sidebar first so
    // the temporary native source editor below never triggers that fallback.
    const sidebarCommand = await registeredCommand(CLAUDE_SIDEBAR_OPEN_COMMAND);
    if (sidebarCommand) {
      await vscode.commands.executeCommand(sidebarCommand);
    }
  }
  const sourceTab = activeRestorableEditorTab();
  const existingEditorColumns = new Set(
    vscode.window.tabGroups?.all.map(group => group.viewColumn) ?? [],
  );
  const existingContextTabs = new Set(tabsForUri(contextUri));
  const document = await vscode.workspace.openTextDocument(contextUri);
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
    viewColumn: vscode.ViewColumn.Beside,
  });
  const temporaryTab = tabsForUri(contextUri)
    .find(tab => !existingContextTabs.has(tab));
  const range = context.kind === 'markdown-range'
    ? context.range
    : { startLine: 1, endLine: document.lineCount };
  const startLine = Math.max(0, Math.min(range.startLine - 1, document.lineCount - 1));
  const endLine = Math.max(startLine, Math.min(range.endLine - 1, document.lineCount - 1));
  const end = document.lineAt(endLine).range.end;
  editor.selection = new vscode.Selection(
    new vscode.Position(startLine, 0),
    end,
  );
  try {
    await vscode.commands.executeCommand(command);
  } finally {
    const cursorMarkdownRange = isCursorHost() && context.kind === 'markdown-range';
    const closedTemporaryTab = cursorMarkdownRange
      ? true
      : await closeTemporaryClaudeContextTab(temporaryTab, contextUri);
    const needsNativeContextFallback = cursorMarkdownRange
      || !temporaryTab
      || !closedTemporaryTab;
    // Cursor can create the native text tab asynchronously, so the tab
    // snapshot taken immediately after showTextDocument may not contain it.
    // In that case the active editor is still the short-lived context tab;
    // close it by URI before restoring the custom Markdown editor.
    let closedActiveContextTab = temporaryTab && closedTemporaryTab
      ? true
      : await closeActiveNativeContextTab(contextUri);
    let nativeContextFallbackHandled = false;
    if (needsNativeContextFallback) {
      // Some Cursor hosts do not expose tabGroups through the extension API,
      // and some expose it before the newly opened tab is observable. Focus
      // the exact editor returned above, then close that active native tab.
      nativeContextFallbackHandled = await focusAndCloseNativeContextEditor(
        contextUri,
        sourceTab?.viewColumn,
        existingEditorColumns,
      );
      closedActiveContextTab = nativeContextFallbackHandled
        && closedActiveContextTab;
    }
    if (needsNativeContextFallback && !nativeContextFallbackHandled) {
      // The provider can move focus into its webview before the tabGroups
      // surface observes the native editor. Closing the active editor here is
      // safe because the original custom tab is restored immediately below.
      try {
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      } catch {
        // The provider may already have closed or replaced the temporary tab.
      }
    }
    if (!closedActiveContextTab) {
      try {
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      } catch {
        // The provider may already have closed or replaced the temporary tab.
      }
    }
    await restoreEditorTab(sourceTab);
  }
}

function stripFragment(uri: vscode.Uri): vscode.Uri {
  return uri.fragment ? uri.with({ fragment: '' }) : uri;
}

async function closeTemporaryClaudeContextTab(
  tab: vscode.Tab | undefined,
  contextUri: vscode.Uri,
): Promise<boolean> {
  if (!tab || !tabMatchesUri(tab, contextUri)) return true;
  try {
    return await vscode.window.tabGroups.close(tab, true);
  } catch {
    return false;
  }
}

async function closeActiveNativeContextTab(
  contextUri: vscode.Uri,
): Promise<boolean> {
  const tabGroups = vscode.window.tabGroups;
  const activeTab = tabGroups?.activeTabGroup?.activeTab;
  if (!activeTab || !tabMatchesUri(activeTab, contextUri)) return true;
  const input = activeTab.input as {
    uri?: vscode.Uri;
    viewType?: unknown;
  } | undefined;
  // A custom Markdown tab also carries the source URI. Only close a plain
  // text input so an active custom editor is never removed during cleanup.
  if (!input?.uri || typeof input.viewType === 'string') return true;
  try {
    return await tabGroups.close(activeTab, true);
  } catch {
    return false;
  }
}

async function focusAndCloseNativeContextEditor(
  contextUri: vscode.Uri,
  sourceViewColumn: vscode.ViewColumn | undefined,
  existingEditorColumns: ReadonlySet<vscode.ViewColumn>,
): Promise<boolean> {
  try {
    const tabGroups = vscode.window.tabGroups;
    const temporaryGroups = tabGroups?.all.filter(group =>
      !existingEditorColumns.has(group.viewColumn)
    ) ?? [];
    if (tabGroups && temporaryGroups.length) {
      let closed = true;
      for (const group of temporaryGroups) {
        try {
          const tab = group.activeTab;
          closed = tab
            ? await tabGroups.close(tab, true) && closed
            : closed;
        } catch {
          closed = false;
        }
      }
      if (closed) return true;
    }
    // Cursor may reopen a Markdown source through our custom editor provider
    // instead of a plain TabInputText. Every matching tab is therefore a
    // short-lived context surface for this handoff; close it regardless of
    // its input view type. The original tab is restored immediately after
    // this cleanup, so duplicate split tabs cannot survive the handoff.
    const activeGroup = tabGroups?.activeTabGroup;
    if (
      activeGroup
      && activeGroup.activeTab
      && tabGroups
      && (sourceViewColumn === undefined || activeGroup.viewColumn !== sourceViewColumn)
    ) {
      try {
        if (await tabGroups.close(activeGroup.activeTab, true)) return true;
      } catch {
        // Fall through to the URI-based pass below.
      }
    }
    const contextTabs = tabGroups?.all.flatMap(group =>
      group.tabs.filter(tab => tabMatchesUri(tab, contextUri))
    ) ?? [];
    if (contextTabs.length && tabGroups) {
      let closed = true;
      for (const tab of contextTabs) {
        try {
          closed = await tabGroups.close(tab, true) && closed;
        } catch {
          closed = false;
        }
      }
      if (closed) return true;
    }
    // The TextEditor returned by showTextDocument can become invalid when
    // Claude moves focus into its webview. Reopen the same document by URI so
    // the cleanup does not pass a stale TextEditor back through the API.
    const document = await vscode.workspace.openTextDocument(contextUri);
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: false,
      preview: false,
    });
    // Focusing the editor first is important: Claude moves focus into its
    // webview while inserting the mention, so closeActiveEditor would
    // otherwise target the chat surface instead of this temporary tab.
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    return true;
  } catch {
    return false;
  }
}

function activeRestorableEditorTab(): RestorableEditorTab | undefined {
  const tabGroups = vscode.window.tabGroups;
  if (!tabGroups) return undefined;
  const group = tabGroups.activeTabGroup;
  if (!group) return undefined;
  const tab = group.activeTab;
  const input = tab?.input as {
    uri?: vscode.Uri;
    viewType?: unknown;
  } | undefined;
  if (!tab || !input?.uri) return undefined;
  return {
    uri: input.uri,
    viewColumn: group.viewColumn,
    preview: tab.isPreview,
    ...(typeof input.viewType === 'string' ? { viewType: input.viewType } : {}),
  };
}

function tabsForUri(uri: vscode.Uri): vscode.Tab[] {
  const tabGroups = vscode.window.tabGroups;
  if (!tabGroups) return [];
  return tabGroups.all.flatMap(group =>
    (group.tabs ?? []).filter(tab => tabMatchesUri(tab, uri))
  );
}

function tabMatchesUri(tab: vscode.Tab, uri: vscode.Uri): boolean {
  const input = tab.input as { uri?: vscode.Uri } | undefined;
  return input?.uri?.scheme === uri.scheme && input.uri.fsPath === uri.fsPath;
}

async function restoreEditorTab(tab: RestorableEditorTab | undefined): Promise<boolean> {
  if (!tab) return true;
  const markdownViewType = isCursorHost()
    && tab.uri.fsPath.toLowerCase().endsWith('.md')
    ? MARKDOWN_EDITOR_VIEW_TYPE
    : undefined;
  const viewType = tab.viewType ?? markdownViewType;
  const options: vscode.TextDocumentShowOptions = {
    viewColumn: tab.viewColumn,
    preserveFocus: false,
    preview: tab.preview,
  };
  try {
    if (viewType) {
      await vscode.commands.executeCommand(
        'vscode.openWith',
        tab.uri,
        viewType,
        options,
      );
    } else {
      await vscode.window.showTextDocument(tab.uri, options);
    }
    return true;
  } catch {
    return false;
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
