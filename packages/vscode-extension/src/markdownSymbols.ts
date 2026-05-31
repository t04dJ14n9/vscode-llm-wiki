import * as vscode from 'vscode';
import { setextHeadingLevelForLines } from './markdownHeadingSyntax';

type HeadingEntry = {
  level: number;
  title: string;
  line: number;
  endLine: number;
  markerLength: number;
  textStart: number;
  textEnd: number;
};

type HeadingNode = HeadingEntry & {
  children: HeadingNode[];
};

class MarkdownOutlineItem extends vscode.TreeItem {
  constructor(
    readonly node: HeadingNode,
    readonly document: vscode.TextDocument,
  ) {
    super(
      node.title,
      node.children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    this.children = node.children.map(child => new MarkdownOutlineItem(child, document));
    this.iconPath = new vscode.ThemeIcon('blank');
    const offset = document.offsetAt(new vscode.Position(node.line, node.textStart));
    this.command = {
      command: 'human-learning.revealInMarkdownEditor',
      title: 'Reveal Heading',
      arguments: [{
        uri: document.uri,
        selection: { from: offset, to: offset },
      }],
    };
  }

  readonly children: MarkdownOutlineItem[];
}

export class MarkdownOutlineProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const headings = parseMarkdownHeadings(document.getText());
    return buildHeadingTree(headings).map(node => toDocumentSymbol(document, node));
  }
}

export class MarkdownOutlineTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element instanceof MarkdownOutlineItem) return element.children;

    const document = await getActiveMarkdownDocument();
    if (!document) return [new vscode.TreeItem('(no active markdown note)')];

    const roots = buildHeadingTree(parseMarkdownHeadings(document.getText()));
    if (roots.length === 0) return [new vscode.TreeItem('(no headings)')];

    return roots.map(root => new MarkdownOutlineItem(root, document));
  }
}

export function registerMarkdownOutlineProvider(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { language: 'markdown', scheme: 'file' },
      new MarkdownOutlineProvider(),
    ),
  );
}

export function registerMarkdownOutlineTreeProvider(context: vscode.ExtensionContext): MarkdownOutlineTreeProvider {
  const provider = new MarkdownOutlineTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('hl-outline', provider),
    vscode.window.onDidChangeActiveTextEditor(() => provider.refresh()),
    vscode.window.tabGroups.onDidChangeTabs(() => provider.refresh()),
    vscode.workspace.onDidChangeTextDocument(event => {
      const activeUri = getActiveMarkdownUri();
      if (activeUri?.toString() === event.document.uri.toString()) {
        provider.refresh();
      }
    }),
  );
  return provider;
}

function parseMarkdownHeadings(text: string): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  const lines = text.split(/\r?\n/);
  let fencedBy: string | null = null;
  let fenceLength = 0;

  for (const [index, line] of lines.entries()) {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1]![0]!;
      if (!fencedBy) {
        fencedBy = marker;
        fenceLength = fence[1]!.length;
      } else if (marker === fencedBy && fence[1]!.length >= fenceLength) {
        fencedBy = null;
        fenceLength = 0;
      }
      continue;
    }

    if (fencedBy) continue;

    const setextLevel = setextHeadingLevelForLines(line, lines[index + 1]);
    if (setextLevel != null) {
      const leading = line.match(/^ {0,3}/)?.[0].length ?? 0;
      const rawTitle = line.slice(leading);
      const title = rawTitle.trim();
      headings.push({
        level: setextLevel,
        title,
        line: index,
        endLine: index,
        markerLength: 0,
        textStart: leading,
        textEnd: leading + rawTitle.trimEnd().length,
      });
      continue;
    }

    const match = line.match(/^( {0,3})(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;

    const leading = match[1]!.length;
    const markerLength = match[2]!.length;
    const rawTitle = match[3]!;
    const title = rawTitle.replace(/\s+#+\s*$/, '').trim();
    if (!title) continue;

    headings.push({
      level: markerLength,
      title,
      line: index,
      endLine: index,
      markerLength,
      textStart: leading + markerLength + 1,
      textEnd: leading + markerLength + 1 + rawTitle.trimEnd().length,
    });
  }

  for (const [index, heading] of headings.entries()) {
    const nextPeer = headings.slice(index + 1).find(candidate => candidate.level <= heading.level);
    heading.endLine = nextPeer ? Math.max(heading.line, nextPeer.line - 1) : lines.length - 1;
  }

  return headings;
}

function buildHeadingTree(headings: HeadingEntry[]): HeadingNode[] {
  const roots: HeadingNode[] = [];
  const stack: HeadingNode[] = [];

  for (const heading of headings) {
    const node: HeadingNode = { ...heading, children: [] };
    while (stack.length > 0 && stack[stack.length - 1]!.level >= node.level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push(node);
  }

  return roots;
}

async function getActiveMarkdownDocument(): Promise<vscode.TextDocument | undefined> {
  const activeEditorDocument = vscode.window.activeTextEditor?.document;
  if (activeEditorDocument && isMarkdownUri(activeEditorDocument.uri)) {
    return activeEditorDocument;
  }

  const activeUri = getActiveMarkdownUri();
  if (!activeUri) return undefined;
  return vscode.workspace.openTextDocument(activeUri);
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

function toDocumentSymbol(document: vscode.TextDocument, node: HeadingNode): vscode.DocumentSymbol {
  const range = rangeForHeadingNode(document, node);
  const selectionRange = new vscode.Range(
    node.line,
    node.textStart,
    node.line,
    node.textEnd,
  );
  const symbol = new vscode.DocumentSymbol(
    node.title,
    `H${node.level}`,
    vscode.SymbolKind.String,
    range,
    selectionRange,
  );
  symbol.children.push(...node.children.map(child => toDocumentSymbol(document, child)));
  return symbol;
}

function rangeForHeadingNode(document: vscode.TextDocument, node: HeadingNode): vscode.Range {
  const endLine = findSectionEndLine(document, node);
  const endText = document.lineAt(endLine).text;
  return new vscode.Range(node.line, 0, endLine, endText.length);
}

function findSectionEndLine(document: vscode.TextDocument, node: HeadingNode): number {
  return Math.min(node.endLine, document.lineCount - 1);
}
