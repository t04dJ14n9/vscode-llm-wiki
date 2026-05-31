import * as vscode from 'vscode';
import {
  closeDatabase,
  detectVaultRoot,
  getBacklinks,
  ingestFile,
  openDatabase,
  rebuildAllLinks,
  rebuildLinksForNote,
  registerSource,
  runMigrations,
} from '@human-learning/core';
import { addSelectionToContext, AgentContextProvider } from './agentContext';
import { BacklinksProvider } from './backlinksProvider';
import { dispatchUri } from './uriDispatcher';
import { registerLinkProvider } from './linkProvider';
import { MarkdownEditorProvider } from './markdownEditorProvider';
import { MarkdownOutlineTreeProvider, registerMarkdownOutlineProvider, registerMarkdownOutlineTreeProvider } from './markdownSymbols';
import { notePathToUri } from './wikiLinks';

let backlinksProvider: BacklinksProvider;
let forwardLinksProvider: BacklinksProvider;
let agentContextProvider: AgentContextProvider;
let problemsProvider: BacklinksProvider;
let markdownOutlineProvider: MarkdownOutlineTreeProvider;
let markdownEditorProvider: MarkdownEditorProvider;

export function activate(context: vscode.ExtensionContext) {
  const vaultRoot = detectVaultRoot(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());

  if (!vaultRoot) {
    vscode.window.showInformationMessage('Human Learning Markdown: No vault found. Run `hl init` to create one.');
    return;
  }

  registerLinkProvider(context);
  registerMarkdownOutlineProvider(context);
  markdownOutlineProvider = registerMarkdownOutlineTreeProvider(context);

  markdownEditorProvider = new MarkdownEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(MarkdownEditorProvider.viewType, markdownEditorProvider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
  );

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

  context.subscriptions.push(
    vscode.commands.registerCommand('human-learning.addSelectionToContext', async () => {
      const exported = await addSelectionToContext(vaultRoot, {
        getActiveSelectionContext: () => markdownEditorProvider.getActiveSelectionContext(),
      });
      if (exported) agentContextProvider?.refresh();
    }),
    vscode.commands.registerCommand('human-learning.openAnchor', async (uri?: string) => {
      if (!uri) {
        uri = await vscode.window.showInputBox({ prompt: 'Enter a note, PDF, code, web, or anchor link to open' });
      }
      if (uri) await dispatchUri(vaultRoot, uri);
    }),
    vscode.commands.registerCommand('human-learning.openLinkTarget', async (uri?: string) => {
      if (!uri) return;
      await dispatchUri(vaultRoot, uri);
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

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
  watcher.onDidChange(async (uri) => {
    const relPath = vscode.workspace.asRelativePath(uri);
    const db = await openDatabase(vaultRoot);
    runMigrations(db);
    try {
      rebuildLinksForNote(db, vaultRoot, relPath);
    } catch {
      // The file may not be a registered source yet.
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

  refreshAllViews();
  vscode.window.showInformationMessage(`Human Learning Markdown ready - vault at ${vaultRoot}`);
}

export function deactivate() {}

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
