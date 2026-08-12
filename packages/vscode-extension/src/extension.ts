import * as vscode from 'vscode';
import { isAbsolute } from 'node:path';
import type { PdfTextFragment } from '@human-learning/core';
import {
  addSelectionToContext,
  syncSelectionExportAttachment,
  type SelectionContextExportResult,
} from './agentContext';
import { registerAnchorFileEditorProvider } from './anchorFileEditorProvider';
import { humanLearningAnchorTarget } from './anchorUris';
import {
  createAgentSurfaceCapabilitySource,
  handoffSelectionToAgent,
  handoffSelectionToAgentId,
  handoffSelectionToCursor,
  type ExternalAgentId,
} from './agentHandoff';
import { BacklinksProvider } from './backlinksProvider';
import {
  captureActiveCursorBrowserSelection,
  cursorBrowserCaptureToSelectionContext,
} from './cursorBrowserSelection';
import { generateDailyNote } from './dailyNotes';
import {
  registerExperimentalOwnedBrowser,
} from './experimentalOwnedBrowser';
import { getConceptGraph, loadFilesystemWiki } from './filesystemWiki';
import { KnowledgeGraphPanel } from './knowledgeGraphPanel';
import { LearningNoteStore } from './learningNoteStore';
import { registerLinkProvider } from './linkProvider';
import { MarkdownEditorProvider } from './markdownEditorProvider';
import { validateCursorCropPng } from './cursorCrop';
import {
  type MarkdownOutlineTreeProvider,
  registerMarkdownOutlineProvider,
  registerMarkdownOutlineTreeProvider,
} from './markdownSymbols';
import { PdfEditorProvider } from './pdfEditorProvider';
import { syncRepository } from './repositorySync';
import type { SelectionContext } from './selectionContext';
import { dispatchUri } from './uriDispatcher';

let backlinksProvider: BacklinksProvider | undefined;
let forwardLinksProvider: BacklinksProvider | undefined;
let pdfEditorProvider: PdfEditorProvider | undefined;
let markdownEditorProvider: MarkdownEditorProvider | undefined;
let markdownOutlineProvider: MarkdownOutlineTreeProvider | undefined;
let graphPanel: KnowledgeGraphPanel | undefined;
let refreshTimer: NodeJS.Timeout | undefined;

const STARTUP_CUSTOM_EDITOR_RETRY_DELAYS_MS = [0, 250, 1_000] as const;
const STARTUP_CUSTOM_EDITOR_MONITOR_MS = 1_500;
const WORKSPACE_REQUIRED_MESSAGE =
  'Open a folder to use Human Learning notes and repository features.';

interface AddSelectionToChatInput {
  selection?: SelectionContext;
  snapshotPng?: Uint8Array;
}

interface AddSelectionToAgentInput extends AddSelectionToChatInput {
  agentId: ExternalAgentId;
}

export const ADD_SELECTION_TO_AGENT_COMMAND =
  'human-learning.addSelectionToAgent';

type SelectionHandoffTarget =
  | { kind: 'picker' }
  | { kind: 'cursor' }
  | { kind: 'agent'; agentId: ExternalAgentId };

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const learningNotes = workspaceRoot
    ? new LearningNoteStore(workspaceRoot)
    : undefined;

  registerLinkProvider(context);
  registerMarkdownOutlineProvider(context);

  const agentCapabilitySource = createAgentSurfaceCapabilitySource();
  context.subscriptions.push(agentCapabilitySource);
  markdownEditorProvider = new MarkdownEditorProvider(context, learningNotes);
  pdfEditorProvider = new PdfEditorProvider(context, {
    ...(workspaceRoot ? { vaultRoot: workspaceRoot, documentRoot: workspaceRoot } : {}),
    globalStoragePath: context.globalStorageUri?.fsPath
      ?? context.extensionUri?.fsPath
      ?? workspaceRoot,
    learningNoteStore: learningNotes,
    agentCapabilities: () => agentCapabilitySource.read(),
    onDidChangeAgentCapabilities: agentCapabilitySource.onDidChange,
    // TODO(ask-pdf): Re-enable after the provider-neutral “More detail” workflow and backend policy are specified.
  });
  void vscode.commands.executeCommand(
    'setContext',
    'humanLearningHostIsCursor',
    agentCapabilitySource.read().cursorAgent,
  );
  markdownOutlineProvider = registerMarkdownOutlineTreeProvider(context, pdfEditorProvider);
  graphPanel = new KnowledgeGraphPanel();

  const productDisposables: vscode.Disposable[] = [
    vscode.window.registerCustomEditorProvider(PdfEditorProvider.viewType, pdfEditorProvider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.window.registerCustomEditorProvider(
      MarkdownEditorProvider.viewType,
      markdownEditorProvider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    ),
    vscode.window.registerUriHandler({
      async handleUri(uri): Promise<void> {
        const target = humanLearningAnchorTarget(uri);
        if (!target) {
          vscode.window.showWarningMessage('This Human Learning link is invalid.');
          return;
        }
        await dispatchUri(workspaceRoot, target);
      },
    }),
    graphPanel,
  ];
  context.subscriptions.push(...productDisposables);
  registerAnchorFileEditorProvider(context);

  if (workspaceRoot) {
    backlinksProvider = new BacklinksProvider(workspaceRoot, 'backlinks');
    forwardLinksProvider = new BacklinksProvider(workspaceRoot, 'forward');
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider('hl-backlinks', backlinksProvider),
      vscode.window.registerTreeDataProvider('hl-forward-links', forwardLinksProvider),
    );
  }
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => refreshAllViews()),
    vscode.window.tabGroups.onDidChangeTabs(() => refreshAllViews()),
  );

  registerExperimentalOwnedBrowser({
    context,
    onSendSelection: async payload => {
      const root = requireWorkspaceRoot(workspaceRoot);
      if (!root) throw new Error(WORKSPACE_REQUIRED_MESSAGE);
      const sent = await exportSelectionAndHandoff(
        root,
        payload.selection,
        payload.attachment?.bytes,
        'The experimental browser crop could not be saved; the active agent will use text context only.',
        { kind: 'picker' },
      );
      if (!sent) throw new Error('The browser selection could not be exported.');
    },
  });
  registerCommands(context, workspaceRoot, learningNotes);
  if (workspaceRoot) registerMarkdownWatcher(context);
  monitorStartupCustomEditors(context);
  refreshAllViews();
  vscode.window.showInformationMessage(
    workspaceRoot
      ? `Human Learning ready — Markdown, PDF, and Git-backed notes at ${workspaceRoot}`
      : 'Human Learning viewers ready — open a folder to enable learning notes and repository features.',
  );
}

function registerCommands(
  context: vscode.ExtensionContext,
  workspaceRoot: string | undefined,
  learningNotes: LearningNoteStore | undefined,
): void {
  const addSelectionToChat = async (
    input: AddSelectionToChatInput | undefined,
    target: SelectionHandoffTarget,
  ): Promise<void> => {
    const root = requireWorkspaceRoot(workspaceRoot);
    if (!root) return;
    if (!input?.selection && isPdfUri(activeTabUri())) {
      if (target.kind === 'agent') {
        await pdfEditorProvider?.addSelectionToAgent(target.agentId);
      } else {
        await pdfEditorProvider?.addSelectionToCursorChat();
      }
      return;
    }
    if (input?.selection && !isSelectionContext(input.selection)) {
      vscode.window.showWarningMessage('The selected passage could not be added to chat.');
      return;
    }
    await exportSelectionAndHandoff(
      root,
      input?.selection,
      input?.snapshotPng,
      'The selection crop could not be saved; the active agent will use text context only.',
      target,
    );
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('human-learning.openAnchor', async (uri?: string) => {
      const target = uri ?? await vscode.window.showInputBox({
        prompt: 'Enter a note, PDF, code, web, or source link',
      });
      if (target) await dispatchUri(workspaceRoot, target);
    }),
    vscode.commands.registerCommand('human-learning.openLinkTarget', async (uri?: string) => {
      if (uri) await dispatchUri(workspaceRoot, uri);
    }),
    vscode.commands.registerCommand('human-learning.openPdfTarget', async (args?: {
      pdfPath?: string;
      page?: number;
      textFragment?: PdfTextFragment;
    }) => {
      if (!args?.pdfPath) {
        vscode.window.showErrorMessage('Missing PDF path');
        return;
      }
      if (!workspaceRoot && !isAbsolute(args.pdfPath)) {
        requireWorkspaceRoot(workspaceRoot);
        return;
      }
      await pdfEditorProvider?.openPdfAtTarget(args.pdfPath, args.page, args.textFragment);
    }),
    vscode.commands.registerCommand('human-learning.openInMarkdownEditor', async () => {
      const uri = getActiveMarkdownUri();
      if (uri) {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          uri,
          MarkdownEditorProvider.viewType,
        );
      }
    }),
    vscode.commands.registerCommand('human-learning.openLearningDiscussion', async (args?: {
      discussionId?: string;
      notePath?: string;
    }) => {
      if (!requireWorkspaceRoot(workspaceRoot)) return;
      if (
        typeof args?.discussionId !== 'string'
        || typeof args.notePath !== 'string'
        || !args.discussionId.trim()
        || !args.notePath.trim()
      ) {
        vscode.window.showWarningMessage('This learning annotation is incomplete.');
        return;
      }
      const discussion = await learningNotes?.loadDiscussion(
        args.discussionId,
        args.notePath,
      );
      if (!discussion) {
        vscode.window.showWarningMessage('The saved learning note could not be loaded.');
        return;
      }
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(discussion.note.absolutePath),
        MarkdownEditorProvider.viewType,
      );
    }),
    vscode.commands.registerCommand('human-learning.addSelectionToContext', async () => {
      const root = requireWorkspaceRoot(workspaceRoot);
      if (!root) return;
      const exported = await exportCurrentSelection(root);
      if (exported) {
        await handoffSelectionToAgent(vscode.Uri.file(exported.markdownPath));
      }
    }),
    vscode.commands.registerCommand(
      'human-learning.addSelectionToChat',
      (input?: AddSelectionToChatInput) => addSelectionToChat(input, { kind: 'cursor' }),
    ),
    vscode.commands.registerCommand(
      'human-learning.addSelectionToCursorChat',
      (input?: AddSelectionToChatInput) => addSelectionToChat(input, { kind: 'cursor' }),
    ),
    vscode.commands.registerCommand(
      ADD_SELECTION_TO_AGENT_COMMAND,
      (input?: AddSelectionToAgentInput) => {
        if (!isExternalAgentId(input?.agentId)) return;
        return addSelectionToChat(input, { kind: 'agent', agentId: input.agentId });
      },
    ),
    vscode.commands.registerCommand(
      'human-learning.addCursorBrowserSelectionToChat',
      async () => {
        const root = requireWorkspaceRoot(workspaceRoot);
        if (!root) return;
        const capture = await captureActiveCursorBrowserSelection();
        if (!capture) {
          vscode.window.showWarningMessage(
            'No active Cursor Browser text selection was available. In stock VS Code, use Human Learning: Open Experimental Web Reader.',
          );
          return;
        }
        await exportSelectionAndHandoff(
          root,
          cursorBrowserCaptureToSelectionContext(capture),
          capture.snapshotPng,
          'The Cursor Browser crop could not be saved; the active agent will use text context only.',
          { kind: 'picker' },
        );
      },
    ),
    vscode.commands.registerCommand('human-learning.generateDailyNote', async () => {
      const root = requireWorkspaceRoot(workspaceRoot);
      if (!root) return;
      const daily = await generateDailyNote({ workspaceRoot: root });
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(daily.absolutePath),
        MarkdownEditorProvider.viewType,
      );
      vscode.window.showInformationMessage(
        `Daily note ready: ${daily.dueReviews.length} reviews, ${daily.carriedTodos.length} carried tasks`,
      );
    }),
    vscode.commands.registerCommand('human-learning.showKnowledgeGraph', async () => {
      const root = requireWorkspaceRoot(workspaceRoot);
      if (!root) return;
      const graph = getConceptGraph(await loadFilesystemWiki(root));
      graphPanel?.show(graph);
    }),
    vscode.commands.registerCommand('human-learning.syncRepository', async () => {
      const root = requireWorkspaceRoot(workspaceRoot);
      if (root) await runRepositorySync(root);
    }),
    vscode.commands.registerCommand('human-learning.refreshLinks', async () => {
      if (!requireWorkspaceRoot(workspaceRoot)) return;
      await refreshFilesystemViews();
      vscode.window.showInformationMessage('Filesystem links and annotations refreshed.');
    }),
    vscode.commands.registerCommand('human-learning.toggleVimMode', async () => {
      const enabled = await markdownEditorProvider?.toggleVimMode();
      if (enabled !== undefined) {
        vscode.window.showInformationMessage(
          `Human Learning Vim mode ${enabled ? 'enabled' : 'disabled'}`,
        );
      }
    }),
    vscode.commands.registerCommand('human-learning.consumeVimHostShortcut', async () => {
      await markdownEditorProvider?.consumeVimHostShortcut();
    }),
    vscode.commands.registerCommand('human-learning.revealInMarkdownEditor', async (args?: {
      uri?: vscode.Uri;
      selection?: { from?: number; to?: number };
    }) => {
      if (
        !args?.uri
        || typeof args.selection?.from !== 'number'
        || typeof args.selection.to !== 'number'
      ) return;
      await markdownEditorProvider?.revealInEditor(args.uri, {
        from: args.selection.from,
        to: args.selection.to,
      });
    }),
    vscode.commands.registerCommand('human-learning.revealInPdfOutline', async (args?: {
      uri?: vscode.Uri;
      destination?: unknown;
      title?: string;
    }) => {
      if (args?.uri) {
        await pdfEditorProvider?.revealPdfOutlineDestination(
          args.uri,
          args.destination,
          args.title,
        );
      }
    }),
    vscode.commands.registerCommand('human-learning.pdfPrevPage', () => {
      pdfEditorProvider?.getActiveWebview()?.postMessage({ type: 'navigate', direction: 'prev' });
    }),
    vscode.commands.registerCommand('human-learning.pdfNextPage', () => {
      pdfEditorProvider?.getActiveWebview()?.postMessage({ type: 'navigate', direction: 'next' });
    }),
    vscode.commands.registerCommand('human-learning.pdfZoomIn', () => {
      pdfEditorProvider?.getActiveWebview()?.postMessage({ type: 'zoom', delta: 0.15 });
    }),
    vscode.commands.registerCommand('human-learning.pdfZoomOut', () => {
      pdfEditorProvider?.getActiveWebview()?.postMessage({ type: 'zoom', delta: -0.15 });
    }),
    vscode.commands.registerCommand('human-learning.pdfFitWidth', () => {
      pdfEditorProvider?.getActiveWebview()?.postMessage({ type: 'fitWidth' });
    }),
    vscode.commands.registerCommand('human-learning.pdfToggleContinuousScroll', () => {
      pdfEditorProvider?.getActiveWebview()?.postMessage({ type: 'toggleContinuousScroll' });
    }),
    vscode.commands.registerCommand('human-learning.pdfToggleTwoPageView', () => {
      pdfEditorProvider?.getActiveWebview()?.postMessage({ type: 'toggleTwoPageView' });
    }),
    vscode.commands.registerCommand('human-learning.openPdfMarkdownColumns', async () => {
      const pdfUri = getActivePdfUri();
      const markdownUri = getActiveMarkdownUri();
      if (!pdfUri || !markdownUri) {
        vscode.window.showWarningMessage('Open both a PDF and a Markdown note first.');
        return;
      }
      await vscode.commands.executeCommand(
        'vscode.openWith',
        pdfUri,
        PdfEditorProvider.viewType,
        vscode.ViewColumn.One,
      );
      await vscode.commands.executeCommand(
        'vscode.openWith',
        markdownUri,
        MarkdownEditorProvider.viewType,
        vscode.ViewColumn.Beside,
      );
    }),
  );
}

function requireWorkspaceRoot(
  workspaceRoot: string | undefined,
): string | undefined {
  if (workspaceRoot) return workspaceRoot;
  vscode.window.showWarningMessage(WORKSPACE_REQUIRED_MESSAGE);
  return undefined;
}

async function runRepositorySync(workspaceRoot: string): Promise<void> {
  try {
    let result = await syncRepository(workspaceRoot);
    if (result.status === 'merge-required') {
      const action = await vscode.window.showWarningMessage(
        `Local and ${result.after.upstream ?? 'remote'} both changed.`,
        { modal: true, detail: 'Merge the fetched remote branch into your local branch?' },
        'Merge remote changes',
      );
      if (action !== 'Merge remote changes') return;
      result = await syncRepository(workspaceRoot, { allowMerge: true });
    }
    const messages: Record<typeof result.status, string> = {
      'no-repository': 'This workspace is not a Git repository.',
      'no-upstream': 'No upstream branch is configured.',
      dirty: 'Commit or stash local changes before syncing.',
      'up-to-date': 'Wiki is already up to date.',
      ahead: 'Local wiki is ahead of remote; nothing was pulled.',
      'fast-forwarded': 'Wiki updated to the latest remote content.',
      'merge-required': 'Remote merge was not confirmed.',
      merged: 'Remote and local wiki changes were merged.',
    };
    const message = messages[result.status];
    if (result.status === 'dirty' || result.status === 'no-upstream' || result.status === 'no-repository') {
      vscode.window.showWarningMessage(message);
    } else {
      vscode.window.showInformationMessage(message);
    }
    if (result.changed) await refreshFilesystemViews();
  } catch (error) {
    vscode.window.showErrorMessage(`Repository sync failed: ${errorMessage(error)}`);
  }
}

function registerMarkdownWatcher(context: vscode.ExtensionContext): void {
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
  const schedule = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void refreshFilesystemViews();
    }, 250);
    refreshTimer.unref?.();
  };
  watcher.onDidChange(schedule);
  watcher.onDidCreate(schedule);
  watcher.onDidDelete(schedule);
  context.subscriptions.push(watcher);
}

async function refreshFilesystemViews(): Promise<void> {
  refreshAllViews();
  if (typeof markdownEditorProvider?.refreshLearningAnnotations === 'function') {
    await markdownEditorProvider.refreshLearningAnnotations();
  }
}

function refreshAllViews(): void {
  if (typeof backlinksProvider?.refresh === 'function') backlinksProvider.refresh();
  if (typeof forwardLinksProvider?.refresh === 'function') forwardLinksProvider.refresh();
  if (typeof markdownOutlineProvider?.refresh === 'function') markdownOutlineProvider.refresh();
}

export function deactivate(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = undefined;
  graphPanel?.dispose();
  graphPanel = undefined;
}

function getActiveMarkdownUri(): vscode.Uri | undefined {
  const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
  if (isMarkdownUri(activeEditorUri)) return activeEditorUri;
  const tabUri = activeTabUri();
  if (isMarkdownUri(tabUri)) return tabUri;
  return vscode.window.visibleTextEditors.find(
    editor => isMarkdownUri(editor.document.uri),
  )?.document.uri;
}

function getActivePdfUri(): vscode.Uri | undefined {
  return pdfEditorProvider?.getActiveWebview()?.pdfUri
    ?? (isPdfUri(activeTabUri()) ? activeTabUri() : undefined);
}

async function exportCurrentSelection(
  fallbackWorkspaceRoot: string,
  suppliedSelection?: SelectionContext,
): Promise<SelectionContextExportResult | undefined> {
  const selection = suppliedSelection
    ?? await activeCustomSelection()
    ?? getNativeSelectionContext();
  const workspaceRoot = selection
    ? vscode.workspace.getWorkspaceFolder?.(selection.uri)?.uri.fsPath
      ?? fallbackWorkspaceRoot
    : fallbackWorkspaceRoot;
  const exported = await addSelectionToContext(workspaceRoot, {
    getActiveSelectionContext: () => selection,
  });
  return exported || undefined;
}

async function exportSelectionAndHandoff(
  workspaceRoot: string,
  selection: SelectionContext | undefined,
  snapshotPng: Uint8Array | undefined,
  cropFailureMessage: string,
  target: SelectionHandoffTarget,
): Promise<boolean> {
  const exported = await exportCurrentSelection(workspaceRoot, selection);
  if (!exported) return false;
  let cropPath: string | undefined;
  try {
    cropPath = await syncSelectionExportAttachment(
      exported,
      'selection.png',
      validateCursorCropPng(snapshotPng),
    );
  } catch {
    vscode.window.showWarningMessage(cropFailureMessage);
  }
  const markdownUri = vscode.Uri.file(exported.markdownPath);
  const attachments = cropPath ? [vscode.Uri.file(cropPath)] : [];
  const sent = target.kind === 'cursor'
    ? await handoffSelectionToCursor(markdownUri, attachments)
    : target.kind === 'agent'
      ? await handoffSelectionToAgentId(target.agentId, markdownUri, attachments)
      : (await handoffSelectionToAgent(markdownUri, attachments)) !== undefined;
  return sent;
}

async function activeCustomSelection(): Promise<SelectionContext | undefined> {
  const activeUri = activeTabUri();
  if (isPdfUri(activeUri)) {
    return pdfEditorProvider?.getActiveSelectionContext();
  }
  if (isMarkdownUri(activeUri)) {
    return activeTabCustomViewType() === MarkdownEditorProvider.viewType
      ? markdownEditorProvider?.captureActiveSelectionContext()
      : undefined;
  }
  return await pdfEditorProvider?.getActiveSelectionContext()
    ?? await markdownEditorProvider?.captureActiveSelectionContext();
}

function getNativeSelectionContext(): SelectionContext | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const { selection } = editor;
  return {
    uri: editor.document.uri,
    text: selection.isEmpty ? '' : editor.document.getText(selection),
    startLine: selection.start.line + 1,
    endLine: selection.end.line + 1,
  };
}

function isSelectionContext(value: unknown): value is SelectionContext {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SelectionContext>;
  return Boolean(
    candidate.uri
    && typeof candidate.uri.scheme === 'string'
    && typeof candidate.uri.fsPath === 'string'
    && typeof candidate.text === 'string'
    && Number.isSafeInteger(candidate.startLine)
    && Number.isSafeInteger(candidate.endLine)
    && (candidate.startLine ?? 0) > 0
    && (candidate.endLine ?? 0) >= (candidate.startLine ?? 0),
  );
}

function isExternalAgentId(value: unknown): value is ExternalAgentId {
  return value === 'codex' || value === 'claude' || value === 'codebuddy';
}

function activeTabUri(): vscode.Uri | undefined {
  return (
    vscode.window.tabGroups.activeTabGroup.activeTab?.input as { uri?: vscode.Uri } | undefined
  )?.uri;
}

function activeTabCustomViewType(): string | undefined {
  const viewType = (
    vscode.window.tabGroups.activeTabGroup.activeTab?.input as { viewType?: unknown } | undefined
  )?.viewType;
  return typeof viewType === 'string' ? viewType : undefined;
}

function isMarkdownUri(uri: vscode.Uri | undefined): uri is vscode.Uri {
  return Boolean(uri?.scheme === 'file' && uri.fsPath.toLowerCase().endsWith('.md'));
}

function isPdfUri(uri: vscode.Uri | undefined): uri is vscode.Uri {
  return Boolean(uri?.scheme === 'file' && uri.fsPath.toLowerCase().endsWith('.pdf'));
}

function monitorStartupCustomEditors(context: vscode.ExtensionContext): void {
  const reopen = async (uri: vscode.Uri | undefined, languageId?: string): Promise<void> => {
    if (!uri || uri.scheme !== 'file') return;
    if (languageId === 'markdown' || isMarkdownUri(uri)) {
      await vscode.commands.executeCommand('vscode.openWith', uri, MarkdownEditorProvider.viewType);
    } else if (isPdfUri(uri)) {
      await vscode.commands.executeCommand('vscode.openWith', uri, PdfEditorProvider.viewType);
    }
  };
  const listener = vscode.window.onDidChangeActiveTextEditor(editor => {
    void reopen(editor?.document.uri, editor?.document.languageId);
  });
  const reopenVisibleEditors = () => {
    const reopened = new Set<string>();
    const reopenOnce = (uri: vscode.Uri | undefined, languageId?: string) => {
      if (!uri) return;
      const key = uri.fsPath || uri.toString();
      if (reopened.has(key)) return;
      reopened.add(key);
      void reopen(uri, languageId);
    };
    const active = vscode.window.activeTextEditor;
    reopenOnce(active?.document.uri, active?.document.languageId);
    for (const editor of vscode.window.visibleTextEditors) {
      reopenOnce(editor.document.uri, editor.document.languageId);
    }
    reopenOnce(activeTabUri());
  };
  const retries = STARTUP_CUSTOM_EDITOR_RETRY_DELAYS_MS.map(delay => {
    const timer = setTimeout(reopenVisibleEditors, delay);
    timer.unref?.();
    return timer;
  });
  const stopMonitoring = setTimeout(() => {
    listener.dispose();
  }, STARTUP_CUSTOM_EDITOR_MONITOR_MS);
  stopMonitoring.unref?.();
  context.subscriptions.push({
    dispose() {
      listener.dispose();
      for (const retry of retries) clearTimeout(retry);
      clearTimeout(stopMonitoring);
    },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
