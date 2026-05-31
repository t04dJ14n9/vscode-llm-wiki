import * as vscode from 'vscode';
import {
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
} from '@human-learning/core';
import { registerLinkProvider } from './linkProvider';
import { BacklinksProvider } from './backlinksProvider';
import { AgentContextProvider, addSelectionToContext } from './agentContext';
import { dispatchUri } from './uriDispatcher';
import { PdfEditorProvider } from './pdfEditorProvider';
import { MarkdownEditorProvider } from './markdownEditorProvider';
import { notePathToUri } from './wikiLinks';
import { MarkdownOutlineTreeProvider, registerMarkdownOutlineProvider, registerMarkdownOutlineTreeProvider } from './markdownSymbols';

let backlinksProvider: BacklinksProvider;
let forwardLinksProvider: BacklinksProvider;
let agentContextProvider: AgentContextProvider;
let problemsProvider: BacklinksProvider;
let pdfEditorProvider: PdfEditorProvider;
let markdownEditorProvider: MarkdownEditorProvider;
let markdownOutlineProvider: MarkdownOutlineTreeProvider;

export function activate(context: vscode.ExtensionContext) {
  const vaultRoot = detectVaultRoot(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());

  if (!vaultRoot) {
    vscode.window.showInformationMessage('Human Learning: No vault found. Run `hl init` to create one.');
    return;
  }

  console.log(`[Human Learning] Vault detected at ${vaultRoot}`);

  // Register link provider for hl:// links
  registerLinkProvider(context);
  registerMarkdownOutlineProvider(context);
  markdownOutlineProvider = registerMarkdownOutlineTreeProvider(context);

  markdownEditorProvider = new MarkdownEditorProvider(context);
  pdfEditorProvider = new PdfEditorProvider(context, vaultRoot, markdownEditorProvider);
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
  agentContextProvider = new AgentContextProvider(vaultRoot);
  problemsProvider = new BacklinksProvider(vaultRoot, 'problems');

  vscode.window.registerTreeDataProvider('hl-backlinks', backlinksProvider);
  vscode.window.registerTreeDataProvider('hl-forward-links', forwardLinksProvider);
  vscode.window.registerTreeDataProvider('hl-agent-context', agentContextProvider);
  vscode.window.registerTreeDataProvider('hl-problems', problemsProvider);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(refreshAllViews),
    vscode.window.tabGroups.onDidChangeTabs(refreshAllViews),
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('human-learning.addSelectionToContext', async () => {
      const exported = await addSelectionToContext(vaultRoot, {
        getActiveSelectionContext: () => markdownEditorProvider.getActiveSelectionContext(),
      });
      if (exported) {
        agentContextProvider?.refresh();
      }
    }),

    vscode.commands.registerCommand('human-learning.openAnchor', async (uri?: string) => {
      if (!uri) {
        uri = await vscode.window.showInputBox({ prompt: 'Enter hl:// URI to open' });
      }
      if (uri) await dispatchUri(vaultRoot, uri);
    }),

    vscode.commands.registerCommand('human-learning.openLinkTarget', async (uri?: string) => {
      if (!uri) return;
      if (uri.startsWith('hl://')) {
        await dispatchUri(vaultRoot, uri);
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(uri));
    }),

    vscode.commands.registerCommand('human-learning.openPdfAtAnchor', async (args?: { pdfPath?: string; anchorId?: string; page?: number }) => {
      if (!args?.pdfPath) {
        vscode.window.showErrorMessage('Missing PDF path');
        return;
      }
      await pdfEditorProvider.openPdfAtAnchor(args.pdfPath, args.anchorId, args.page);
    }),

    vscode.commands.registerCommand('human-learning.openInMarkdownEditor', async () => {
      const uri = getActiveMarkdownUri();
      if (!uri) return;
      await vscode.commands.executeCommand('vscode.openWith', uri, MarkdownEditorProvider.viewType);
    }),

    vscode.commands.registerCommand('human-learning.toggleVimMode', async () => {
      const enabled = await markdownEditorProvider.toggleVimMode();
      vscode.window.showInformationMessage(`Human Learning Vim mode ${enabled ? 'enabled' : 'disabled'}`);
    }),

    vscode.commands.registerCommand('human-learning.revealInMarkdownEditor', async (args?: {
      uri?: vscode.Uri;
      selection?: { from?: number; to?: number };
    }) => {
      if (!args?.uri) return;
      const from = args.selection?.from;
      const to = args.selection?.to;
      if (typeof from !== 'number' || typeof to !== 'number') return;
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

let refreshTimeout: NodeJS.Timeout | null = null;
function debounceRefresh() {
  if (refreshTimeout) clearTimeout(refreshTimeout);
  refreshTimeout = setTimeout(refreshAllViews, 500);
}

function refreshAllViews() {
  backlinksProvider?.refresh();
  forwardLinksProvider?.refresh();
  agentContextProvider?.refresh();
  problemsProvider?.refresh();
  markdownOutlineProvider?.refresh();
}

export function deactivate() {}

function getActiveMarkdownUri(): vscode.Uri | undefined {
  const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
  if (activeEditorUri && isMarkdownUri(activeEditorUri)) return activeEditorUri;

  const tabInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input as { uri?: vscode.Uri } | undefined;
  if (tabInput?.uri && isMarkdownUri(tabInput.uri)) return tabInput.uri;
  return undefined;
}

function isMarkdownUri(uri: vscode.Uri): boolean {
  return uri.scheme === 'file' && uri.fsPath.toLowerCase().endsWith('.md');
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
