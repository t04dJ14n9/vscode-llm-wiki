import * as vscode from 'vscode';
import { isAbsolute } from 'node:path';
import type { PdfTextFragment } from '@llm-wiki/core';
import {
  addSelectionToContext,
  syncSelectionExportAttachment,
  type SelectionContextExportResult,
} from './agentContext';
import { registerAnchorFileEditorProvider } from './anchorFileEditorProvider';
import { llmWikiAnchorTarget } from './anchorUris';
import {
  createAgentSurfaceCapabilitySource,
  handoffSelectionToAgent,
  handoffSelectionToCursor,
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
import { formatMarkdownAgentReference } from './agentClipboard';
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
const WORKSPACE_REQUIRED_MESSAGE =
  'Open a folder to use LLM Wiki notes and repository features.';
const AGENT_HANDOFF_ACTIVE_CONTEXT_KEY = 'llmWikiAgentHandoffActive';

interface AddSelectionToChatInput {
  selection?: SelectionContext;
  snapshotPng?: Uint8Array;
}

type SelectionHandoffTarget =
  | { kind: 'picker' }
  | { kind: 'cursor' };

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const learningNotes = workspaceRoot
    ? new LearningNoteStore(workspaceRoot)
    : undefined;

  registerLinkProvider(context);
  registerMarkdownOutlineProvider(context);

  const agentCapabilitySource = createAgentSurfaceCapabilitySource();
  context.subscriptions.push(agentCapabilitySource);
  markdownEditorProvider = new MarkdownEditorProvider(context, learningNotes, {
    agentCapabilities: () => agentCapabilitySource.read(),
    onDidChangeAgentCapabilities: agentCapabilitySource.onDidChange,
  });
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
    'llmWikiHostIsCursor',
    agentCapabilitySource.read().cursorAgent,
  );
  setAgentHandoffActive(false);
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
        const target = llmWikiAnchorTarget(uri);
        if (!target) {
          vscode.window.showWarningMessage('This LLM Wiki link is invalid.');
          return;
        }
        await dispatchUri(vaultRootForSource(activeSourceUri(), workspaceRoot), target);
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
      vscode.window.registerTreeDataProvider('llm-wiki-backlinks', backlinksProvider),
      vscode.window.registerTreeDataProvider('llm-wiki-forward-links', forwardLinksProvider),
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
  registerCustomEditorRouter(context);
  refreshAllViews();
  vscode.window.showInformationMessage(
    workspaceRoot
      ? `LLM Wiki ready — Markdown, PDF, and Git-backed notes at ${workspaceRoot}`
      : 'LLM Wiki viewers ready — open a folder to enable learning notes and repository features.',
  );
}

function registerCommands(
  context: vscode.ExtensionContext,
  workspaceRoot: string | undefined,
  learningNotes: LearningNoteStore | undefined,
): void {
  const addSelectionToChat = async (
    input: AddSelectionToChatInput | undefined,
  ): Promise<void> => {
    const root = requireWorkspaceRoot(workspaceRoot);
    if (!root) return;
    if (!input?.selection && isPdfUri(activeTabUri())) {
      await pdfEditorProvider?.addSelectionToCursorChat();
      setAgentHandoffActive(true);
      return;
    }
    if (input?.selection && !isSelectionContext(input.selection)) {
      vscode.window.showWarningMessage('The selected passage could not be added to chat.');
      return;
    }
    const sent = await exportSelectionAndHandoff(
      root,
      input?.selection,
      input?.snapshotPng,
      'The selection crop could not be saved; the active agent will use text context only.',
      { kind: 'cursor' },
    );
    if (sent) setAgentHandoffActive(true);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('llm-wiki.openAnchor', async (uri?: string) => {
      const target = uri ?? await vscode.window.showInputBox({
        prompt: 'Enter a note, PDF, code, web, or source link',
      });
      if (target) {
        await dispatchUri(
          vaultRootForSource(activeSourceUri(), workspaceRoot),
          target,
          { allowAbsoluteTargets: true },
        );
      }
    }),
    vscode.commands.registerCommand('llm-wiki.openLinkTarget', async (
      uri?: string,
      sourceUri?: vscode.Uri,
    ) => {
      if (uri) {
        await dispatchUri(
          vaultRootForSource(sourceUri ?? activeSourceUri(), workspaceRoot),
          uri,
          { allowAbsoluteTargets: true },
        );
      }
    }),
    vscode.commands.registerCommand('llm-wiki.openPdfTarget', async (args?: {
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
    vscode.commands.registerCommand('llm-wiki.openInMarkdownEditor', async () => {
      const uri = getActiveMarkdownUri();
      if (uri) {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          uri,
          MarkdownEditorProvider.viewType,
        );
      }
    }),
    vscode.commands.registerCommand('llm-wiki.openLearningDiscussion', async (args?: {
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
    vscode.commands.registerCommand(
      'llm-wiki.copySelectionForAgent',
      (selection?: SelectionContext) => (
        isPdfUri(activeTabUri())
          ? pdfEditorProvider?.copySelectionForAgent() ?? false
          : copyMarkdownSelectionForAgent(selection)
      ),
    ),
    vscode.commands.registerCommand(
      'llm-wiki.addSelectionToChat',
      (input?: AddSelectionToChatInput) => addSelectionToChat(input),
    ),
    vscode.commands.registerCommand(
      'llm-wiki.addSelectionToCursorChat',
      (input?: AddSelectionToChatInput) => addSelectionToChat(input),
    ),
    vscode.commands.registerCommand(
      'llm-wiki.addCursorBrowserSelectionToChat',
      async () => {
        const root = requireWorkspaceRoot(workspaceRoot);
        if (!root) return;
        const capture = await captureActiveCursorBrowserSelection();
        if (!capture) {
          vscode.window.showWarningMessage(
            'No active Cursor Browser text selection was available. In stock VS Code, use LLM Wiki: Open Experimental Web Reader.',
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
    vscode.commands.registerCommand('llm-wiki.generateDailyNote', async () => {
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
    vscode.commands.registerCommand('llm-wiki.showKnowledgeGraph', async () => {
      const root = requireWorkspaceRoot(workspaceRoot);
      if (!root) return;
      const graph = getConceptGraph(await loadFilesystemWiki(root));
      graphPanel?.show(graph);
    }),
    vscode.commands.registerCommand('llm-wiki.syncRepository', async () => {
      const root = requireWorkspaceRoot(workspaceRoot);
      if (root) await runRepositorySync(root);
    }),
    vscode.commands.registerCommand('llm-wiki.refreshLinks', async () => {
      if (!requireWorkspaceRoot(workspaceRoot)) return;
      await refreshFilesystemViews();
      vscode.window.showInformationMessage('Filesystem links and annotations refreshed.');
    }),
    vscode.commands.registerCommand('llm-wiki.toggleVimMode', async () => {
      const enabled = await markdownEditorProvider?.toggleVimMode();
      if (enabled !== undefined) {
        vscode.window.showInformationMessage(
          `LLM Wiki Vim mode ${enabled ? 'enabled' : 'disabled'}`,
        );
      }
    }),
    vscode.commands.registerCommand('llm-wiki.consumeVimHostShortcut', async () => {
      await markdownEditorProvider?.consumeVimHostShortcut();
    }),
    vscode.commands.registerCommand('llm-wiki.focusMarkdownEditor', async () => {
      try {
        return await markdownEditorProvider?.focusActiveEditor() ?? false;
      } finally {
        setAgentHandoffActive(false);
      }
    }),
    vscode.commands.registerCommand('llm-wiki.revealInMarkdownEditor', async (args?: {
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
    vscode.commands.registerCommand('llm-wiki.revealInPdfOutline', async (args?: {
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
    vscode.commands.registerCommand('llm-wiki.pdfPrevPage', () => {
      pdfEditorProvider?.getActiveWebview()?.postMessage({ type: 'navigate', direction: 'prev' });
    }),
    vscode.commands.registerCommand('llm-wiki.pdfNextPage', () => {
      pdfEditorProvider?.getActiveWebview()?.postMessage({ type: 'navigate', direction: 'next' });
    }),
    vscode.commands.registerCommand('llm-wiki.pdfZoomIn', () => {
      pdfEditorProvider?.getActiveWebview()?.postMessage({ type: 'zoom', delta: 0.15 });
    }),
    vscode.commands.registerCommand('llm-wiki.pdfZoomOut', () => {
      pdfEditorProvider?.getActiveWebview()?.postMessage({ type: 'zoom', delta: -0.15 });
    }),
    vscode.commands.registerCommand('llm-wiki.pdfFitWidth', () => {
      pdfEditorProvider?.getActiveWebview()?.postMessage({ type: 'fitWidth' });
    }),
    vscode.commands.registerCommand('llm-wiki.pdfToggleContinuousScroll', () => {
      pdfEditorProvider?.getActiveWebview()?.postMessage({ type: 'toggleContinuousScroll' });
    }),
    vscode.commands.registerCommand('llm-wiki.pdfToggleTwoPageView', () => {
      pdfEditorProvider?.getActiveWebview()?.postMessage({ type: 'toggleTwoPageView' });
    }),
    vscode.commands.registerCommand('llm-wiki.openPdfMarkdownColumns', async () => {
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

function setAgentHandoffActive(active: boolean): void {
  void vscode.commands.executeCommand(
    'setContext',
    AGENT_HANDOFF_ACTIVE_CONTEXT_KEY,
    active,
  );
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
  const workspaceRoot = selection && isSelectionContext(selection)
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
  const resolvedSelection = selection
    ?? await activeCustomSelection()
    ?? getNativeSelectionContext();
  if (!resolvedSelection && isMarkdownUri(activeTabUri())) {
    vscode.window.showWarningMessage('Select Markdown text before adding it to chat.');
    return false;
  }
  const markdownContext = await markdownRangeHandoffContext(resolvedSelection);
  // Keep a Markdown handoff as a source range for providers that expose a
  // selection-aware command. Their adapters can fall back to an immutable
  // export when an older provider only supports file attachments.
  if (markdownContext) {
    return handoffMarkdownRange(markdownContext, target);
  }
  if (isMarkdownSelection(resolvedSelection)) return false;

  const exported = await exportCurrentSelection(workspaceRoot, resolvedSelection);
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
  const context = {
    kind: 'selection-export' as const,
    uri: vscode.Uri.file(exported.markdownPath),
  };
  const attachments = cropPath ? [vscode.Uri.file(cropPath)] : [];
  const sent = target.kind === 'cursor'
    ? await handoffSelectionToCursor(context, attachments)
    : (await handoffSelectionToAgent(context, attachments)) !== undefined;
  return sent;
}

async function markdownRangeHandoffContext(
  selection: SelectionContext | undefined,
): Promise<{
  kind: 'markdown-range';
  uri: vscode.Uri;
  range: { startLine: number; endLine: number };
} | undefined> {
  selection = await prepareMarkdownSelectionForAction(selection, {
    emptySelectionMessage: 'Select Markdown text before adding it to chat.',
    unsavedSelectionMessage: 'Save this Markdown note before adding a source range to chat.',
    saveFailureMessage: 'Save the Markdown note before adding it to chat.',
  });
  if (!selection) return undefined;
  return {
    kind: 'markdown-range',
    uri: selection.uri,
    range: {
      startLine: selection.startLine,
      endLine: selection.endLine,
    },
  };
}

interface MarkdownSelectionActionMessages {
  emptySelectionMessage: string;
  unsavedSelectionMessage: string;
  saveFailureMessage: string;
}

async function prepareMarkdownSelectionForAction(
  selection: SelectionContext | undefined,
  messages: MarkdownSelectionActionMessages,
): Promise<SelectionContext | undefined> {
  if (!isMarkdownSelection(selection)) return undefined;
  if (!selection.text) {
    vscode.window.showWarningMessage(messages.emptySelectionMessage);
    return undefined;
  }
  if (selection.uri.scheme !== 'file') {
    vscode.window.showWarningMessage(messages.unsavedSelectionMessage);
    return undefined;
  }

  const selectedUri = selection.uri;
  let shouldRecapture = false;
  if (
    activeTabCustomViewType() === MarkdownEditorProvider.viewType
    && typeof markdownEditorProvider?.flushActiveEditsBeforeSave === 'function'
  ) {
    shouldRecapture = true;
    try {
      if (!await markdownEditorProvider.flushActiveEditsBeforeSave(selectedUri)) {
        vscode.window.showWarningMessage(messages.saveFailureMessage);
        return undefined;
      }
    } catch {
      vscode.window.showWarningMessage(messages.saveFailureMessage);
      return undefined;
    }
  }

  const document = vscode.workspace.textDocuments?.find(candidate =>
    candidate.uri.scheme === selectedUri.scheme
      && candidate.uri.fsPath === selectedUri.fsPath,
  );
  if (!document?.isDirty && !shouldRecapture) return selection;

  if (document?.isDirty) {
    shouldRecapture = true;
    try {
      if (!await document.save()) {
        vscode.window.showWarningMessage(messages.saveFailureMessage);
        return undefined;
      }
    } catch {
      vscode.window.showWarningMessage(messages.saveFailureMessage);
      return undefined;
    }
  }

  let recaptured: SelectionContext | undefined;
  try {
    recaptured = shouldRecapture
      ? await recaptureSavedMarkdownSelection(selection)
      : selection;
  } catch {
    vscode.window.showWarningMessage(messages.emptySelectionMessage);
    return undefined;
  }
  if (!recaptured?.text) {
    vscode.window.showWarningMessage(messages.emptySelectionMessage);
    return undefined;
  }
  return recaptured;
}

export async function copyMarkdownSelectionForAgent(
  suppliedSelection?: SelectionContext,
): Promise<boolean> {
  const resolvedSelection = suppliedSelection
    ?? await activeCustomSelection()
    ?? getNativeSelectionContext();
  if (!resolvedSelection && (isMarkdownUri(activeTabUri()) || isAssociatedUntitledMarkdownUri(activeTabUri()))) {
    vscode.window.showWarningMessage('Select Markdown text before copying for agent.');
    return false;
  }
  const selection = await prepareMarkdownSelectionForAction(resolvedSelection, {
    emptySelectionMessage: 'Select Markdown text before copying for agent.',
    unsavedSelectionMessage: 'Save this Markdown note before copying for agent.',
    saveFailureMessage: 'Save the Markdown note before copying for agent.',
  });
  if (!selection) return false;

  let reference: string;
  try {
    reference = formatMarkdownAgentReference(
      vscode.workspace.asRelativePath(selection.uri),
      selection.startLine,
      selection.endLine,
    );
  } catch {
    vscode.window.showWarningMessage(
      'Save the Markdown note inside the current workspace before copying for agent.',
    );
    return false;
  }
  await vscode.env.clipboard.writeText(reference);
  vscode.window.showInformationMessage('Selection copied for agent.');
  return true;
}

async function recaptureSavedMarkdownSelection(
  selection: SelectionContext,
): Promise<SelectionContext | undefined> {
  const native = vscode.window.activeTextEditor;
  const customEditorIsActive =
    activeTabCustomViewType() === MarkdownEditorProvider.viewType;
  if (
    !customEditorIsActive
    && native
    && native.document.uri.scheme === selection.uri.scheme
    && native.document.uri.fsPath === selection.uri.fsPath
    && isMarkdownDocument(native.document)
  ) return getNativeSelectionContext();

  const custom = await markdownEditorProvider?.captureActiveSelectionContext();
  return custom
    && custom.uri.scheme === selection.uri.scheme
    && custom.uri.fsPath === selection.uri.fsPath
    && isMarkdownSelection(custom)
    ? custom
    : undefined;
}

async function handoffMarkdownRange(
  context: {
    kind: 'markdown-range';
    uri: vscode.Uri;
    range: { startLine: number; endLine: number };
  },
  target: SelectionHandoffTarget,
): Promise<boolean> {
  return target.kind === 'cursor'
    ? handoffSelectionToCursor(context, [])
    : (await handoffSelectionToAgent(context, [])) !== undefined;
}

async function activeCustomSelection(): Promise<SelectionContext | undefined> {
  const activeUri = activeTabUri();
  if (isPdfUri(activeUri)) {
    return pdfEditorProvider?.getActiveSelectionContext();
  }
  if (isMarkdownUri(activeUri) || isAssociatedUntitledMarkdownUri(activeUri)) {
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
    endLine: Math.max(
      selection.start.line + 1,
      selection.end.line + 1
        - (!selection.isEmpty && selection.end.character === 0 ? 1 : 0),
    ),
    ...(isMarkdownDocument(editor.document)
      ? { metadata: { kind: 'markdown' } }
      : {}),
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

function isMarkdownSelection(
  selection: SelectionContext | undefined,
): selection is SelectionContext & { metadata: { kind: 'markdown' } } {
  return isSelectionContext(selection) && selection.metadata?.kind === 'markdown';
}

/**
 * In a multi-root workspace the link's own document decides which vault it
 * belongs to; only fall back to the first folder when nothing owns it.
 */
function vaultRootForSource(
  sourceUri: vscode.Uri | undefined,
  fallbackRoot: string | undefined,
): string | undefined {
  if (!sourceUri) return fallbackRoot;
  return vscode.workspace.getWorkspaceFolder?.(sourceUri)?.uri.fsPath ?? fallbackRoot;
}

function activeSourceUri(): vscode.Uri | undefined {
  return vscode.window.activeTextEditor?.document.uri ?? activeTabUri();
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

function isMarkdownDocument(document: vscode.TextDocument): boolean {
  return document.languageId === 'markdown' || isMarkdownUri(document.uri);
}

function isPdfUri(uri: vscode.Uri | undefined): uri is vscode.Uri {
  return Boolean(uri?.scheme === 'file' && uri.fsPath.toLowerCase().endsWith('.pdf'));
}

function isAssociatedUntitledMarkdownUri(uri: vscode.Uri | undefined): uri is vscode.Uri {
  return Boolean(
    uri?.scheme === 'untitled'
      && typeof uri.fsPath === 'string'
      && uri.fsPath.toLowerCase().endsWith('.md'),
  );
}

/**
 * Reopen persisted Markdown/PDF text editors in their custom providers while
 * leaving generic untitled buffers alone. VS Code's CLI creates a file-like
 * `untitled:` document for a missing path; that URI is the signal that the
 * Markdown provider should own it, not its transient `languageId`.
 */
function registerCustomEditorRouter(context: vscode.ExtensionContext): void {
  const opening = new Set<string>();
  const routed = new Set<string>();
  const reopen = async (uri: vscode.Uri | undefined): Promise<void> => {
    if (!uri) return;
    const viewType = isMarkdownUri(uri) || isAssociatedUntitledMarkdownUri(uri)
      ? MarkdownEditorProvider.viewType
      : isPdfUri(uri)
        ? PdfEditorProvider.viewType
        : undefined;
    if (!viewType) return;

    const key = `${viewType}:${uri.toString()}`;
    const isMarkdown = viewType === MarkdownEditorProvider.viewType;
    if (opening.has(key) || (isMarkdown && routed.has(key)) || hasCustomEditorTab(uri, viewType)) {
      return;
    }
    opening.add(key);
    try {
      await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
      if (isMarkdown) routed.add(key);
    } finally {
      opening.delete(key);
    }
  };

  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(editor => {
    void reopen(editor?.document.uri);
  });
  const openDocumentListener = vscode.workspace.onDidOpenTextDocument(document => {
    void reopen(document.uri);
  });
  // A transient guard prevents the open-document and active-editor events from
  // reopening the same untitled URI. Forget it once that custom tab closes so a
  // later CLI/open action can route the URI again.
  const tabCloseListener = vscode.window.tabGroups.onDidChangeTabs(event => {
    for (const tab of event?.closed ?? []) {
      const input = tab?.input as { uri?: vscode.Uri; viewType?: unknown } | undefined;
      if (!input?.uri || typeof input.viewType !== 'string') continue;
      routed.delete(`${input.viewType}:${input.uri.toString()}`);
    }
  });

  const reopenVisibleEditors = () => {
    const reopened = new Set<string>();
    const reopenOnce = (uri: vscode.Uri | undefined) => {
      if (!uri) return;
      const key = uri.fsPath || uri.toString();
      if (reopened.has(key)) return;
      reopened.add(key);
      void reopen(uri);
    };
    const active = vscode.window.activeTextEditor;
    reopenOnce(active?.document.uri);
    for (const editor of vscode.window.visibleTextEditors) {
      reopenOnce(editor.document.uri);
    }
    reopenOnce(activeTabUri());
  };
  const retries = STARTUP_CUSTOM_EDITOR_RETRY_DELAYS_MS.map(delay => {
    const timer = setTimeout(reopenVisibleEditors, delay);
    timer.unref?.();
    return timer;
  });

  context.subscriptions.push({
    dispose() {
      activeEditorListener.dispose();
      openDocumentListener.dispose();
      tabCloseListener.dispose();
      for (const retry of retries) clearTimeout(retry);
    },
  });
}

function hasCustomEditorTab(uri: vscode.Uri, viewType: string): boolean {
  return (vscode.window.tabGroups?.all ?? []).some(group => (group?.tabs ?? []).some(tab => {
    const input = tab?.input as { uri?: vscode.Uri; viewType?: unknown } | undefined;
    return input?.viewType === viewType && input.uri?.toString() === uri.toString();
  }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
