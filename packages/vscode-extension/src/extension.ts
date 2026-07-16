import * as vscode from 'vscode';
import * as path from 'path';
import {
  classifyReferenceTarget,
  closeDatabase,
  detectVaultRoot,
  getBacklinks,
  getForwardLinks,
  ingestFile,
  openDatabase,
  rebuildAllLinks,
  rebuildLinksForNote,
  registerSource,
  runMigrations,
  type PdfTextFragment,
} from '@human-learning/core';
import { registerLinkProvider } from './linkProvider';
import { BacklinksProvider } from './backlinksProvider';
import { dispatchUri } from './uriDispatcher';
import { PdfEditorProvider } from './pdfEditorProvider';
import { MarkdownEditorProvider } from './markdownEditorProvider';
import { addSelectionToContext } from './agentContext';
import { notePathToUri } from './wikiLinks';
import { MarkdownOutlineTreeProvider, registerMarkdownOutlineProvider, registerMarkdownOutlineTreeProvider } from './markdownSymbols';
import { WebBrowserProvider } from './webBrowserProvider';
import { CodexAppServerClient } from './codexAppServerClient';
import { PdfDiscussionController } from './pdfDiscussionController';
import {
  NavigationHistoryProvider,
  type NavigationEntryInput,
  type NavigationTarget,
  type RevealSelection,
} from './navigationHistory';

let backlinksProvider: BacklinksProvider;
let forwardLinksProvider: BacklinksProvider;
let pdfEditorProvider: PdfEditorProvider;
let markdownEditorProvider: MarkdownEditorProvider;
let markdownOutlineProvider: MarkdownOutlineTreeProvider;
let webBrowserProvider: WebBrowserProvider;
let navigationHistoryProvider: NavigationHistoryProvider;
let codexClient: CodexAppServerClient | undefined;
let pdfDiscussionController: PdfDiscussionController | undefined;
let codexOutputChannel: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const vaultRoot = detectVaultRoot(workspaceRoot);

  if (!vaultRoot) {
    activatePdfWithoutVault(context, workspaceRoot);
    return;
  }

  console.log(`[Human Learning] Vault detected at ${vaultRoot}`);

  initializePdfCodexRuntime(context);

  // Register link provider for native markdown/Obsidian links
  registerLinkProvider(context);
  registerMarkdownOutlineProvider(context);
  markdownOutlineProvider = registerMarkdownOutlineTreeProvider(context);

  navigationHistoryProvider = new NavigationHistoryProvider();
  markdownEditorProvider = new MarkdownEditorProvider(context);
  pdfEditorProvider = new PdfEditorProvider(context, {
    vaultRoot,
    documentRoot: vaultRoot,
    globalStoragePath: context.globalStorageUri?.fsPath ?? context.extensionUri?.fsPath ?? vaultRoot,
    discussionController: pdfDiscussionController,
    markdownInsertTarget: markdownEditorProvider,
    navigationRecorder: navigationHistoryProvider,
    annotationsEnabled: true,
  });
  webBrowserProvider = new WebBrowserProvider(context, vaultRoot, markdownEditorProvider, navigationHistoryProvider);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(PdfEditorProvider.viewType, pdfEditorProvider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.window.registerCustomEditorProvider(MarkdownEditorProvider.viewType, markdownEditorProvider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
  );
  monitorStartupCustomEditors(context);

  // Register TreeViews
  backlinksProvider = new BacklinksProvider(vaultRoot, 'backlinks');
  forwardLinksProvider = new BacklinksProvider(vaultRoot, 'forward');

  vscode.window.registerTreeDataProvider('hl-backlinks', backlinksProvider);
  vscode.window.registerTreeDataProvider('hl-forward-links', forwardLinksProvider);
  vscode.window.registerTreeDataProvider('hl-jump-stack', navigationHistoryProvider);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(refreshAllViews),
    vscode.window.tabGroups.onDidChangeTabs(refreshAllViews),
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('human-learning.openAnchor', async (uri?: string) => {
      if (!uri) {
        uri = await vscode.window.showInputBox({ prompt: 'Enter a note, PDF, code, web, or anchor link to open' });
      }
      if (uri) await openLinkTarget(vaultRoot, uri);
    }),

    vscode.commands.registerCommand('human-learning.openLinkTarget', async (uri?: string) => {
      if (!uri) return;
      await openLinkTarget(vaultRoot, uri);
    }),

    vscode.commands.registerCommand('human-learning.openPdfTarget', async (args?: { pdfPath?: string; page?: number; textFragment?: PdfTextFragment }) => {
      if (!args?.pdfPath) {
        vscode.window.showErrorMessage('Missing PDF path');
        return;
      }
      recordPdfJump({
        pdfPath: args.pdfPath,
        page: args.page,
        textFragment: args.textFragment,
      });
      await pdfEditorProvider.openPdfAtTarget(args.pdfPath, args.page, args.textFragment);
    }),

    vscode.commands.registerCommand('human-learning.openInMarkdownEditor', async () => {
      const uri = getActiveMarkdownUri();
      if (!uri) return;
      await vscode.commands.executeCommand('vscode.openWith', uri, MarkdownEditorProvider.viewType);
    }),

    vscode.commands.registerCommand('human-learning.addSelectionToContext', async () => {
      const exported = await addSelectionToContext(vaultRoot, {
        getActiveSelectionContext: async () =>
          await pdfEditorProvider.getActiveSelectionContext()
          ?? markdownEditorProvider.getActiveSelectionContext(),
      });
      if (exported) refreshAllViews();
    }),

    vscode.commands.registerCommand('human-learning.pdfAskSelection', async () => {
      await pdfEditorProvider.openAskPdfForSelection();
    }),

    vscode.commands.registerCommand('human-learning.openWebBrowser', async (uri?: string) => {
      const url = uri || await vscode.window.showInputBox({
        prompt: 'Enter a web URL to browse and persist',
        value: 'https://example.com',
      });
      if (!url) return;
      webBrowserProvider.open(url);
    }),

    vscode.commands.registerCommand('human-learning.jumpBack', async () => {
      const opened = await navigationHistoryProvider.back(openNavigationTarget);
      if (!opened) {
        vscode.window.showInformationMessage('Human Learning jump stack is empty.');
      }
    }),

    vscode.commands.registerCommand('human-learning.retractToJump', async (entryId?: string) => {
      if (!entryId) return;
      const opened = await navigationHistoryProvider.retractTo(entryId, openNavigationTarget);
      if (!opened) {
        vscode.window.showWarningMessage('Human Learning jump was no longer available.');
      }
    }),

    vscode.commands.registerCommand('human-learning.clearJumpStack', async () => {
      navigationHistoryProvider.clear();
    }),

    vscode.commands.registerCommand('human-learning.toggleVimMode', async () => {
      const enabled = await markdownEditorProvider.toggleVimMode();
      vscode.window.showInformationMessage(`Human Learning Vim mode ${enabled ? 'enabled' : 'disabled'}`);
    }),

    vscode.commands.registerCommand('human-learning.consumeVimHostShortcut', async () => {
      await markdownEditorProvider.consumeVimHostShortcut();
    }),

    vscode.commands.registerCommand('human-learning.revealInMarkdownEditor', async (args?: {
      uri?: vscode.Uri;
      selection?: { from?: number; to?: number };
    }) => {
      if (!args?.uri) return;
      const from = args.selection?.from;
      const to = args.selection?.to;
      if (typeof from !== 'number' || typeof to !== 'number') return;
      recordMarkdownJump(args.uri, { from, to });
      await markdownEditorProvider.revealInEditor(args.uri, { from, to });
    }),

    vscode.commands.registerCommand('human-learning.pdfPrevPage', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'navigate', direction: 'prev' });
    }),

    vscode.commands.registerCommand('human-learning.pdfNextPage', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'navigate', direction: 'next' });
    }),

    vscode.commands.registerCommand('human-learning.pdfZoomIn', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'zoom', delta: 0.15 });
    }),

    vscode.commands.registerCommand('human-learning.pdfZoomOut', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'zoom', delta: -0.15 });
    }),

    vscode.commands.registerCommand('human-learning.pdfFitWidth', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'fitWidth' });
    }),

    vscode.commands.registerCommand('human-learning.pdfToggleContinuousScroll', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'toggleContinuousScroll' });
    }),

    vscode.commands.registerCommand('human-learning.pdfToggleTwoPageView', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'toggleTwoPageView' });
    }),

    vscode.commands.registerCommand('human-learning.openPdfMarkdownColumns', async () => {
      const pdfUri = getActivePdfUri();
      if (!pdfUri) {
        vscode.window.showWarningMessage('Open a PDF first to use PDF/markdown columns.');
        return;
      }

      const markdownUri = getActiveMarkdownUri();
      if (!markdownUri) {
        vscode.window.showWarningMessage('Open a markdown note before using PDF/markdown columns.');
        return;
      }

      await vscode.commands.executeCommand('vscode.openWith', pdfUri, PdfEditorProvider.viewType, vscode.ViewColumn.One);
      await vscode.commands.executeCommand('vscode.openWith', markdownUri, MarkdownEditorProvider.viewType, vscode.ViewColumn.Beside);
    }),

    vscode.commands.registerCommand('human-learning.ingestCurrentFile', async () => {
      const uri = getActiveMarkdownUri();
      if (!uri) return;

      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const relPath = vscode.workspace.asRelativePath(uri);
      const source = registerSource(db, vaultRoot, relPath);
      await ingestFile(db, vaultRoot, relPath, source.id);
      closeDatabase(db);
      vscode.window.showInformationMessage(`Ingested: ${relPath}`);
    }),

    vscode.commands.registerCommand('human-learning.refreshLinks', async () => {
      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      rebuildAllLinks(db, vaultRoot);
      closeDatabase(db);
      refreshAllViews();
      vscode.window.showInformationMessage('Links refreshed');
    }),

    vscode.commands.registerCommand('human-learning.showBacklinks', async () => {
      const uri = getActiveMarkdownUri();
      if (!uri) return;
      const relPath = vscode.workspace.asRelativePath(uri);
      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const backlinks = getBacklinks(db, notePathToUri(relPath));
      closeDatabase(db);

      if (backlinks.length === 0) {
        vscode.window.showInformationMessage(`No backlinks to ${relPath}`);
      } else {
        const items = backlinks.map(b => ({
          label: `${b.from_note_path}:${b.from_line}`,
          description: b.label || '',
        }));
        vscode.window.showQuickPick(items, { title: `Backlinks to ${relPath}` });
      }
    }),
  );

  // Watch for markdown file changes
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
  watcher.onDidChange(async (uri) => {
    const relPath = vscode.workspace.asRelativePath(uri);
    const db = await openDatabase(vaultRoot);
    runMigrations(db);
    try {
      rebuildLinksForNote(db, vaultRoot, relPath);
    } catch (e) {
      // May not be in sources yet
    }
    closeDatabase(db);
    debounceRefresh();
  });
  watcher.onDidCreate(async (uri) => {
    const relPath = vscode.workspace.asRelativePath(uri);
    const db = await openDatabase(vaultRoot);
    runMigrations(db);

    const source = registerSource(db, vaultRoot, relPath);
    await ingestFile(db, vaultRoot, relPath, source.id);
    closeDatabase(db);
  });
  context.subscriptions.push(watcher);

  // Initial refresh
  refreshAllViews();

  vscode.window.showInformationMessage(`Human Learning ready — vault at ${vaultRoot}`);
}

function initializePdfCodexRuntime(context: vscode.ExtensionContext): void {
  const codexCommand = typeof vscode.workspace.getConfiguration === 'function'
    ? vscode.workspace.getConfiguration('humanLearning.pdf').get<string>('codexCommand', 'codex')
    : 'codex';
  const outputChannel = vscode.window.createOutputChannel('Human Learning PDF — Codex');
  codexOutputChannel = outputChannel;
  codexClient = new CodexAppServerClient({
    executable: codexCommand,
    extensionVersion: String(context.extension?.packageJSON?.version ?? '0.1.0'),
    logger: message => outputChannel.appendLine(message),
  });
  pdfDiscussionController = new PdfDiscussionController({ client: codexClient });
  context.subscriptions.push(codexClient, pdfDiscussionController);
}

function activatePdfWithoutVault(context: vscode.ExtensionContext, documentRoot: string): void {
  initializePdfCodexRuntime(context);
  pdfEditorProvider = new PdfEditorProvider(context, {
    documentRoot,
    globalStoragePath: context.globalStorageUri?.fsPath ?? context.extensionUri?.fsPath ?? documentRoot,
    discussionController: pdfDiscussionController,
    annotationsEnabled: false,
  });
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(PdfEditorProvider.viewType, pdfEditorProvider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('human-learning.openAnchor', async (uri?: string) => {
      if (!uri) {
        uri = await vscode.window.showInputBox({ prompt: 'Enter a PDF, note, code, web, or anchor link to open' });
      }
      if (uri) await dispatchUri(documentRoot, uri);
    }),
    vscode.commands.registerCommand('human-learning.openLinkTarget', async (uri?: string) => {
      if (!uri) return;
      await dispatchUri(documentRoot, uri);
    }),
    vscode.commands.registerCommand('human-learning.openPdfTarget', async (args?: { pdfPath?: string; page?: number; textFragment?: PdfTextFragment }) => {
      if (!args?.pdfPath) {
        vscode.window.showErrorMessage('Missing PDF path');
        return;
      }
      await pdfEditorProvider.openPdfAtTarget(args.pdfPath, args.page, args.textFragment);
    }),
    vscode.commands.registerCommand('human-learning.addSelectionToContext', async () => {
      vscode.window.showErrorMessage('Human Learning: No vault found. Run `hl init` to export selection context.');
    }),
    vscode.commands.registerCommand('human-learning.pdfAskSelection', async () => {
      await pdfEditorProvider.openAskPdfForSelection();
    }),
    vscode.commands.registerCommand('human-learning.pdfPrevPage', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'navigate', direction: 'prev' });
    }),
    vscode.commands.registerCommand('human-learning.pdfNextPage', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'navigate', direction: 'next' });
    }),
    vscode.commands.registerCommand('human-learning.pdfZoomIn', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'zoom', delta: 0.15 });
    }),
    vscode.commands.registerCommand('human-learning.pdfZoomOut', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'zoom', delta: -0.15 });
    }),
    vscode.commands.registerCommand('human-learning.pdfFitWidth', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'fitWidth' });
    }),
    vscode.commands.registerCommand('human-learning.pdfToggleContinuousScroll', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'toggleContinuousScroll' });
    }),
    vscode.commands.registerCommand('human-learning.pdfToggleTwoPageView', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'toggleTwoPageView' });
    }),
  );
  vscode.window.showInformationMessage(
    `Human Learning PDF ready — document root at ${documentRoot}; run \`hl init\` to enable vault features`,
  );
}

let refreshTimeout: NodeJS.Timeout | null = null;
function debounceRefresh() {
  if (refreshTimeout) clearTimeout(refreshTimeout);
  refreshTimeout = setTimeout(refreshAllViews, 500);
}

function refreshAllViews() {
  backlinksProvider?.refresh();
  forwardLinksProvider?.refresh();
  markdownOutlineProvider?.refresh();
}

export function deactivate() {
  pdfDiscussionController?.dispose();
  codexClient?.dispose();
  codexOutputChannel?.dispose();
  pdfDiscussionController = undefined;
  codexClient = undefined;
  codexOutputChannel = undefined;
}

async function openLinkTarget(vaultRoot: string, uri: string): Promise<void> {
  recordDispatchTarget(vaultRoot, uri);
  await dispatchUri(vaultRoot, uri, {
    openWebTarget: async url => {
      webBrowserProvider.open(url);
    },
  });
}

async function openNavigationTarget(target: NavigationTarget): Promise<void> {
  switch (target.kind) {
    case 'markdown': {
      const uri = vscode.Uri.parse(target.uri);
      await vscode.commands.executeCommand('vscode.openWith', uri, MarkdownEditorProvider.viewType);
      if (target.selection) {
        await vscode.commands.executeCommand('human-learning.revealInMarkdownEditor', {
          uri,
          selection: target.selection,
        });
      }
      return;
    }
    case 'pdf':
      await pdfEditorProvider.openPdfAtTarget(target.pdfPath, target.page, target.textFragment);
      return;
    case 'web':
      webBrowserProvider.open(target.url);
      return;
    case 'file':
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(target.uri));
      return;
    case 'uri':
      await dispatchUri(detectVaultRoot(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()) ?? process.cwd(), target.uri, {
        openWebTarget: async url => {
          webBrowserProvider.open(url);
        },
      });
      return;
  }
}

function recordDispatchTarget(vaultRoot: string, uri: string): void {
  if (typeof classifyReferenceTarget !== 'function') return;

  const target = classifyReferenceTarget(uri);
  switch (target.kind) {
    case 'note':
      if (!target.path || target.heading || target.lines) return;
      recordMarkdownJump(vscode.Uri.file(path.join(vaultRoot, target.path)));
      return;
    case 'code':
      if (!target.path) return;
      recordNavigation({
        kind: 'code',
        label: path.basename(target.path),
        description: target.path,
        target: {
          kind: 'file',
          uri: vscode.Uri.file(path.join(vaultRoot, target.path)).toString(),
        },
      });
      return;
    case 'image':
    case 'text':
    case 'unknown':
      if (!target.path) return;
      recordNavigation({
        kind: 'file',
        label: path.basename(target.path),
        description: target.path,
        target: {
          kind: 'file',
          uri: vscode.Uri.file(path.join(vaultRoot, target.path)).toString(),
        },
      });
      return;
    case 'pdf':
    case 'web':
      return;
  }
}

function recordMarkdownJump(uri: vscode.Uri, selection?: RevealSelection): void {
  const relPath = vscode.workspace.asRelativePath(uri);
  const line = lineDescriptionForSelection(uri, selection);
  recordNavigation({
    kind: selection ? 'outline' : 'markdown',
    label: markdownLabelForUri(uri),
    description: line ? `${relPath}:${line}` : relPath,
    target: {
      kind: 'markdown',
      uri: uri.toString(),
      ...(selection ? { selection } : {}),
    },
  });
}

function recordPdfJump(args: { pdfPath: string; page?: number; textFragment?: PdfTextFragment }): void {
  recordNavigation({
    kind: 'pdf',
    label: `${path.basename(args.pdfPath)}${args.page ? ` p.${args.page}` : ''}`,
    description: args.pdfPath,
    target: {
      kind: 'pdf',
      pdfPath: args.pdfPath,
      ...(args.page ? { page: args.page } : {}),
      ...(args.textFragment ? { textFragment: args.textFragment } : {}),
    },
  });
}

function recordNavigation(entry: NavigationEntryInput): void {
  navigationHistoryProvider?.record(entry);
}

function markdownLabelForUri(uri: vscode.Uri): string {
  const basename = path.basename(uri.fsPath || uri.path || uri.toString());
  return decodeURIComponent(basename.replace(/\.md$/i, '')) || basename || 'Markdown Note';
}

function lineDescriptionForSelection(uri: vscode.Uri, selection: RevealSelection | undefined): number | undefined {
  if (!selection) return undefined;
  const document = vscode.workspace.textDocuments?.find(doc => sameUri(doc.uri, uri));
  if (!document) return undefined;
  return document.positionAt(selection.from).line + 1;
}

function sameUri(a: vscode.Uri, b: vscode.Uri): boolean {
  if (a.toString() === b.toString()) return true;
  return Boolean(a.fsPath && b.fsPath && a.fsPath === b.fsPath);
}

function getActiveMarkdownUri(): vscode.Uri | undefined {
  const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
  if (activeEditorUri && isMarkdownUri(activeEditorUri)) return activeEditorUri;

  const tabInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input as { uri?: vscode.Uri } | undefined;
  if (tabInput?.uri && isMarkdownUri(tabInput.uri)) return tabInput.uri;

  const visibleEditor = vscode.window.visibleTextEditors.find(editor => isMarkdownUri(editor.document.uri));
  if (visibleEditor) return visibleEditor.document.uri;

  for (const tabUri of openTabUris()) {
    if (isMarkdownUri(tabUri)) return tabUri;
  }

  const openDocument = (vscode.workspace.textDocuments ?? []).find(document => isMarkdownUri(document.uri));
  if (openDocument) return openDocument.uri;

  return undefined;
}

function isMarkdownUri(uri: vscode.Uri): boolean {
  return uri.scheme === 'file' && uri.fsPath.toLowerCase().endsWith('.md');
}

function getActivePdfUri(): vscode.Uri | undefined {
  const activePdf = pdfEditorProvider.getActiveWebview()?.pdfUri;
  if (activePdf) return activePdf;

  const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
  if (activeEditorUri && isPdfUri(activeEditorUri)) return activeEditorUri;

  const tabInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input as { uri?: vscode.Uri } | undefined;
  if (tabInput?.uri && isPdfUri(tabInput.uri)) return tabInput.uri;

  return undefined;
}

function isPdfUri(uri: vscode.Uri): boolean {
  return uri.scheme === 'file' && uri.fsPath.toLowerCase().endsWith('.pdf');
}

function openTabUris(): vscode.Uri[] {
  const uris: vscode.Uri[] = [];
  for (const group of vscode.window.tabGroups.all ?? []) {
    for (const tab of group.tabs) {
      const uri = (tab.input as { uri?: vscode.Uri } | undefined)?.uri;
      if (uri) uris.push(uri);
    }
  }
  return uris;
}

function monitorStartupCustomEditors(context: vscode.ExtensionContext): void {
  const retryIntervalMs = 1000;
  const retryWindowMs = 20000;

  const getStartupDocuments = (): Array<{ uri: vscode.Uri; languageId?: string }> => {
    const documents = new Map<string, { uri: vscode.Uri; languageId?: string }>();
    const active = vscode.window.activeTextEditor;
    if (active) {
      documents.set(active.document.uri.toString(), {
        uri: active.document.uri,
        languageId: active.document.languageId,
      });
    }
    for (const editor of vscode.window.visibleTextEditors) {
      documents.set(editor.document.uri.toString(), {
        uri: editor.document.uri,
        languageId: editor.document.languageId,
      });
    }
    const activeTabUri = (vscode.window.tabGroups.activeTabGroup.activeTab?.input as { uri?: vscode.Uri } | undefined)?.uri;
    if (activeTabUri) {
      documents.set(activeTabUri.toString(), { uri: activeTabUri });
    }
    return [...documents.values()];
  };

  const maybeReopen = async (document: { uri: vscode.Uri; languageId?: string } | undefined): Promise<void> => {
    if (!document) return;
    if (document.uri.scheme !== 'file') return;

    if (document.languageId === 'markdown') {
      await vscode.commands.executeCommand(
        'vscode.openWith',
        document.uri,
        MarkdownEditorProvider.viewType,
      );
      return;
    }

    if (document.uri.fsPath.toLowerCase().endsWith('.pdf')) {
      await vscode.commands.executeCommand(
        'vscode.openWith',
        document.uri,
        PdfEditorProvider.viewType,
      );
    }
  };

  const listener = vscode.window.onDidChangeActiveTextEditor(editor => {
    void maybeReopen(editor ? {
      uri: editor.document.uri,
      languageId: editor.document.languageId,
    } : undefined);
  });
  const retry = setInterval(() => {
    for (const document of getStartupDocuments()) {
      void maybeReopen(document);
    }
  }, retryIntervalMs);
  const timeout = setTimeout(() => {
    listener.dispose();
    clearInterval(retry);
  }, retryWindowMs);
  timeout.unref?.();
  retry.unref?.();

  context.subscriptions.push(listener, {
    dispose() {
      clearTimeout(timeout);
      clearInterval(retry);
    },
  });

  setTimeout(() => {
    for (const document of getStartupDocuments()) {
      void maybeReopen(document);
    }
  }, 0);
}
