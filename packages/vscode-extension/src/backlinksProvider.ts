import * as vscode from 'vscode';
import { relative } from 'node:path';
import {
  getBacklinks,
  getForwardLinks,
  loadFilesystemWiki,
  type WikiLink,
} from './filesystemWiki';

type ViewMode = 'backlinks' | 'forward';

export class BacklinksProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly workspaceRoot: string,
    private readonly mode: ViewMode,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) return [];

    const relPath = getActiveMarkdownRelativePath(this.workspaceRoot);
    if (!relPath) {
      return [new vscode.TreeItem('(no active editor)')];
    }

    try {
      const wiki = await loadFilesystemWiki(this.workspaceRoot);
      if (this.mode === 'backlinks') {
        const backlinks = getBacklinks(wiki, relPath);

        if (backlinks.length === 0) {
          return [new vscode.TreeItem('(no backlinks)')];
        }

        return backlinks.map(link => backlinkTreeItem(link));
      }

      const forward = getForwardLinks(wiki, relPath);
      if (forward.length === 0) {
        return [new vscode.TreeItem('(no forward links)')];
      }

      return forward.map(link => forwardLinkTreeItem(link));
    } catch (error) {
      return [new vscode.TreeItem(`(error: ${errorMessage(error)})`)];
    }
  }
}

type ForwardLinkLike = {
  to_uri?: string;
  href?: string;
  label?: string | null;
  from_line?: number;
  line?: number;
};

export function formatForwardLinkLabel(link: ForwardLinkLike): string {
  const label = link.label?.trim();
  if (label) return label;
  const href = link.href ?? link.to_uri ?? '';
  return noteTitleFromUri(href) ?? href;
}

function noteTitleFromUri(uri: string): string | undefined {
  const notePath = uri.split('#')[0];
  if (!notePath?.toLowerCase().endsWith('.md')) return undefined;

  try {
    const filename = decodeURIComponent(notePath).split('/').filter(Boolean).pop();
    return filename?.replace(/\.md$/i, '');
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

function getActiveMarkdownRelativePath(workspaceRoot: string): string | undefined {
  const uri = getActiveMarkdownUri();
  if (!uri) return undefined;
  const relPath = relative(workspaceRoot, uri.fsPath).replace(/\\/g, '/');
  if (!relPath || relPath === '..' || relPath.startsWith('../')) return undefined;
  return relPath;
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

function forwardLinkTreeItem(link: WikiLink): vscode.TreeItem {
  const item = new vscode.TreeItem(formatForwardLinkLabel(link));
  item.description = `line ${link.line}`;
  item.tooltip = link.href;
  item.command = {
    command: 'llm-wiki.openAnchor',
    title: 'Open',
    arguments: [link.href],
  };
  item.iconPath = new vscode.ThemeIcon('arrow-right');
  return item;
}

function backlinkTreeItem(link: WikiLink): vscode.TreeItem {
  const item = new vscode.TreeItem(`${link.sourcePath}:${link.line}`);
  item.description = link.label || 'reference';
  item.tooltip = link.href;
  item.command = {
    command: 'llm-wiki.openAnchor',
    title: 'Open',
    arguments: [link.sourcePath],
  };
  item.iconPath = new vscode.ThemeIcon('arrow-left');
  return item;
}
