import * as vscode from 'vscode';
import { openDatabase, closeDatabase, getBacklinks, getForwardLinks, checkLinks, runMigrations } from '@human-learning/core';
import { notePathToUri } from './wikiLinks';

type ViewMode = 'backlinks' | 'forward' | 'problems';

export class BacklinksProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private mode: ViewMode;

  constructor(private vaultRoot: string, mode: ViewMode) {
    this.mode = mode;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) return [];

    const relPath = getActiveMarkdownRelativePath();
    if (this.mode !== 'problems' && !relPath) {
      return [new vscode.TreeItem('(no active editor)')];
    }

    const db = await openDatabase(this.vaultRoot);
    runMigrations(db);

    try {
      if (this.mode === 'backlinks') {
        const backlinks = getBacklinks(db, notePathToUri(relPath!));
        closeDatabase(db);

        if (backlinks.length === 0) {
          return [new vscode.TreeItem('(no backlinks)')];
        }

        return backlinks.map(b => {
          const item = new vscode.TreeItem(`${b.from_note_path}:${b.from_line}`);
          item.description = b.label || 'reference';
          item.tooltip = b.to_uri;
          item.command = {
            command: 'human-learning.openAnchor',
            title: 'Open',
            arguments: [`hl://note/${b.from_note_path}`],
          };
          item.iconPath = new vscode.ThemeIcon('arrow-left');
          return item;
        });
      } else if (this.mode === 'forward') {
        const forward = getForwardLinks(db, relPath!);
        closeDatabase(db);

        if (forward.length === 0) {
          return [new vscode.TreeItem('(no forward links)')];
        }

        return forward.map(f => {
          const item = new vscode.TreeItem(formatForwardLinkLabel(f));
          item.description = `line ${f.from_line}`;
          item.tooltip = f.to_uri;
          item.command = {
            command: 'human-learning.openAnchor',
            title: 'Open',
            arguments: [f.to_uri],
          };
          item.iconPath = new vscode.ThemeIcon('arrow-right');
          return item;
        });
      } else {
        const issues = checkLinks(db);
        closeDatabase(db);

        if (issues.length === 0) {
          return [new vscode.TreeItem('(no problems)')];
        }

        return issues.map(i => {
          const item = new vscode.TreeItem(i.message);
          item.iconPath = new vscode.ThemeIcon(
            i.status === 'broken' ? 'error' : 'warning'
          );
          return item;
        });
      }
    } catch (e) {
      try { closeDatabase(db); } catch {}
      return [new vscode.TreeItem(`(error: ${e})`)];
    }
  }
}

type ForwardLinkLike = {
  to_uri: string;
  label?: string | null;
  from_line: number;
};

export function formatForwardLinkLabel(link: ForwardLinkLike): string {
  const label = link.label?.trim();
  if (label) return label;
  return noteTitleFromUri(link.to_uri) ?? link.to_uri;
}

function noteTitleFromUri(uri: string): string | undefined {
  const notePath = uri.match(/^hl:\/\/note\/([^#]+)/)?.[1];
  if (!notePath) return undefined;

  try {
    const decodedPath = decodeURIComponent(notePath);
    const filename = decodedPath.split('/').filter(Boolean).pop();
    return filename?.replace(/\.md$/i, '');
  } catch {
    return undefined;
  }
}

function getActiveMarkdownRelativePath(): string | undefined {
  const uri = getActiveMarkdownUri();
  if (!uri) return undefined;
  return vscode.workspace.asRelativePath(uri);
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
