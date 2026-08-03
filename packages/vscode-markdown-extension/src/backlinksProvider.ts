import * as vscode from 'vscode';
import { openDatabase, closeDatabase, getBacklinks, getForwardLinks, checkLinks, runMigrations } from '@human-learning/core';
import { notePathToUri, parseWikiLinkTarget } from './wikiLinks';

type ViewMode = 'backlinks' | 'forward' | 'problems';

export class BacklinksProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private mode: ViewMode;

  constructor(private vaultRoot: string | undefined, mode: ViewMode) {
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

    if (!this.vaultRoot) {
      return this.getStandaloneChildren(relPath);
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
            arguments: [b.from_note_path],
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
    } catch (error) {
      try { closeDatabase(db); } catch {}
      return [new vscode.TreeItem(`(error: ${errorMessage(error)})`)];
    }
  }

  private async getStandaloneChildren(relPath: string | undefined): Promise<vscode.TreeItem[]> {
    if (this.mode === 'problems') {
      return [new vscode.TreeItem('(Human Learning vault required)')];
    }
    if (!relPath) {
      return [new vscode.TreeItem('(no active editor)')];
    }

    try {
      if (this.mode === 'forward') {
        const forward = await scanForwardLinks(relPath);
        if (forward.length === 0) {
          return [new vscode.TreeItem('(no forward links)')];
        }
        return forward.map(link => forwardLinkTreeItem(link));
      }

      const backlinks = await scanBacklinks(relPath);
      if (backlinks.length === 0) {
        return [new vscode.TreeItem('(no backlinks)')];
      }
      return backlinks.map(link => backlinkTreeItem(link));
    } catch (error) {
      return [new vscode.TreeItem(`(error: ${errorMessage(error)})`)];
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

interface StandaloneLink {
  sourcePath: string;
  source_offset: number;
  from_line: number;
  to_uri: string;
  label?: string | null;
}

async function scanForwardLinks(relPath: string): Promise<StandaloneLink[]> {
  const activeUri = getActiveMarkdownUri();
  if (!activeUri) return [];
  const notePaths = await workspaceMarkdownNotePaths();
  const document = await vscode.workspace.openTextDocument(activeUri);
  return parseLinksFromText(document.getText(), relPath, notePaths);
}

async function scanBacklinks(activeRelPath: string): Promise<StandaloneLink[]> {
  const uris = await workspaceMarkdownUris();
  const notePaths = uris.map(uri => vscode.workspace.asRelativePath(uri)).sort((a, b) => a.localeCompare(b));
  const backlinks: StandaloneLink[] = [];

  for (const uri of uris) {
    const sourcePath = vscode.workspace.asRelativePath(uri);
    const document = await vscode.workspace.openTextDocument(uri);
    const links = parseLinksFromText(document.getText(), sourcePath, notePaths);
    backlinks.push(...links.filter(link => pointsToMarkdownPath(link.to_uri, activeRelPath)));
  }

  return backlinks.sort((a, b) =>
    a.sourcePath.localeCompare(b.sourcePath) ||
    a.from_line - b.from_line ||
    a.source_offset - b.source_offset ||
    a.to_uri.localeCompare(b.to_uri)
  );
}

async function workspaceMarkdownNotePaths(): Promise<string[]> {
  const uris = await workspaceMarkdownUris();
  return uris.map(uri => vscode.workspace.asRelativePath(uri)).sort((a, b) => a.localeCompare(b));
}

async function workspaceMarkdownUris(): Promise<vscode.Uri[]> {
  return vscode.workspace.findFiles('**/*.md', '**/{.git,node_modules}/**', 10_000);
}

function parseLinksFromText(text: string, currentNotePath: string, notePaths: string[]): StandaloneLink[] {
  const links: StandaloneLink[] = [];
  const markdownLinkRegex = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = markdownLinkRegex.exec(text)) !== null) {
    const destination = normalizeMarkdownDestination(match[2]!);
    if (!destination) continue;
    const toUri = resolveMarkdownDestination(destination, currentNotePath, notePaths);
    if (!toUri) continue;
    links.push({
      sourcePath: currentNotePath,
      source_offset: match.index,
      from_line: lineNumberAt(text, match.index),
      to_uri: toUri,
      label: match[1]?.trim() || formatForwardLinkLabel({ to_uri: toUri, from_line: 0 }),
    });
  }

  const wikiRegex = /\[\[([^\]]+)\]\]/g;
  while ((match = wikiRegex.exec(text)) !== null) {
    if (match.index > 0 && text[match.index - 1] === '!') continue;
    const target = parseWikiLinkTarget(match[1]!, currentNotePath, notePaths);
    if (!target) continue;
    links.push({
      sourcePath: currentNotePath,
      source_offset: match.index,
      from_line: lineNumberAt(text, match.index),
      to_uri: target.uri,
      label: target.label,
    });
  }

  return links.sort((a, b) => a.source_offset - b.source_offset);
}

function normalizeMarkdownDestination(raw: string): string | undefined {
  const destination = raw.trim();
  if (!destination) return undefined;
  if (destination.startsWith('<')) {
    const end = destination.indexOf('>');
    return end > 1 ? destination.slice(1, end) : undefined;
  }
  const match = destination.match(/^(\S+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?$/);
  return match?.[1];
}

function resolveMarkdownDestination(destination: string, currentNotePath: string, notePaths: string[]): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(destination)) return destination;

  const [rawPath, rawFragment] = splitOnce(destination, '#');
  const fragment = rawFragment ? `#${rawFragment}` : '';
  const decodedPath = safeDecodeURIComponent(rawPath);
  if (!decodedPath) return `${currentNotePath}${fragment}`;

  const candidate = normalizeWorkspacePath(
    decodedPath.startsWith('/')
      ? decodedPath.slice(1)
      : joinWorkspacePath(dirnameWorkspacePath(currentNotePath), decodedPath),
  );
  const resolvedPath = resolveExistingMarkdownPath(candidate, notePaths);
  return resolvedPath ? `${resolvedPath}${fragment}` : `${candidate}${fragment}`;
}

function resolveExistingMarkdownPath(candidate: string, notePaths: string[]): string | undefined {
  const normalizedCandidate = normalizeComparablePath(candidate);
  const withMarkdownExtension = normalizedCandidate.endsWith('.md')
    ? normalizedCandidate
    : `${normalizedCandidate}.md`;
  return notePaths.find(notePath => normalizeComparablePath(notePath) === normalizedCandidate)
    ?? notePaths.find(notePath => normalizeComparablePath(notePath) === withMarkdownExtension);
}

function pointsToMarkdownPath(uri: string, targetPath: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) return false;
  const [path] = splitOnce(uri, '#');
  return normalizeComparablePath(path) === normalizeComparablePath(targetPath);
}

function forwardLinkTreeItem(link: StandaloneLink): vscode.TreeItem {
  const item = new vscode.TreeItem(formatForwardLinkLabel(link));
  item.description = `line ${link.from_line}`;
  item.tooltip = link.to_uri;
  item.command = {
    command: 'human-learning.openAnchor',
    title: 'Open',
    arguments: [link.to_uri],
  };
  item.iconPath = new vscode.ThemeIcon('arrow-right');
  return item;
}

function backlinkTreeItem(link: StandaloneLink): vscode.TreeItem {
  const item = new vscode.TreeItem(`${link.sourcePath}:${link.from_line}`);
  item.description = link.label || 'reference';
  item.tooltip = link.to_uri;
  item.command = {
    command: 'human-learning.openAnchor',
    title: 'Open',
    arguments: [link.sourcePath],
  };
  item.iconPath = new vscode.ThemeIcon('arrow-left');
  return item;
}

function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function dirnameWorkspacePath(notePath: string): string {
  const index = notePath.lastIndexOf('/');
  return index < 0 ? '' : notePath.slice(0, index);
}

function joinWorkspacePath(basePath: string, targetPath: string): string {
  return basePath ? `${basePath}/${targetPath}` : targetPath;
}

function normalizeWorkspacePath(path: string): string {
  const output: string[] = [];
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      output.pop();
      continue;
    }
    output.push(segment);
  }
  return output.join('/');
}

function normalizeComparablePath(path: string): string {
  return normalizeWorkspacePath(safeDecodeURIComponent(path)).toLowerCase();
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function splitOnce(input: string, separator: string): [string, string | undefined] {
  const index = input.indexOf(separator);
  if (index < 0) return [input, undefined];
  return [input.slice(0, index), input.slice(index + 1)];
}

function isMarkdownUri(uri: vscode.Uri): boolean {
  return uri.scheme === 'file' && uri.fsPath.toLowerCase().endsWith('.md');
}
