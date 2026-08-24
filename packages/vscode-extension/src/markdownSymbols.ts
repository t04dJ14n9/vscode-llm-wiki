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

export interface PdfOutlineDestination {
  pageIndex: number;
  zoom: {
    mode: number;
    params?: {
      x: number;
      y: number;
      zoom: number;
    };
  };
  view: number[];
}

export interface PdfOutlineEntry {
  title: string;
  destination?: PdfOutlineDestination;
  children: PdfOutlineEntry[];
}

export interface PdfOutlineSource {
  readonly onDidChangePdfOutline: vscode.Event<vscode.Uri>;
  getActivePdfUri(): vscode.Uri | undefined;
  getPdfOutline(uri: vscode.Uri): readonly PdfOutlineEntry[] | undefined;
  isPdfOutlineInferred?(uri: vscode.Uri): boolean;
}

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
    this.id = markdownOutlineItemId(document.uri, node);
    this.iconPath = new vscode.ThemeIcon('symbol-string');
    this.accessibilityInformation = {
      label: `${node.title}, heading level ${node.level}`,
    };
    const offset = document.offsetAt(new vscode.Position(node.line, node.textStart));
    this.command = {
      command: 'llm-wiki.revealInMarkdownEditor',
      title: 'Reveal Heading',
      arguments: [{
        uri: document.uri,
        selection: { from: offset, to: offset },
      }],
    };
  }

  readonly children: MarkdownOutlineItem[];
}

class PdfOutlineItem extends vscode.TreeItem {
  readonly children: PdfOutlineItem[];

  constructor(
    readonly node: PdfOutlineEntry,
    readonly uri: vscode.Uri,
    path: string,
  ) {
    super(
      node.title,
      node.children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    this.id = `pdf-outline:${uri.toString()}:${path}`;
    this.children = node.children.map(
      (child, index) => new PdfOutlineItem(child, uri, `${path}.${index}`),
    );
    this.iconPath = new vscode.ThemeIcon('bookmark');
    if (node.destination) {
      this.description = `p. ${node.destination.pageIndex + 1}`;
      this.command = {
        command: 'llm-wiki.revealInPdfOutline',
        title: 'Reveal PDF Section',
        arguments: [{
          uri,
          destination: node.destination,
          title: node.title,
        }],
      };
    }
  }
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

  constructor(private readonly pdfOutlineSource?: PdfOutlineSource) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element instanceof MarkdownOutlineItem) return element.children;
    if (element instanceof PdfOutlineItem) return element.children;

    const activeUri = getActiveOutlineUri() ?? this.pdfOutlineSource?.getActivePdfUri();
    if (activeUri && isPdfUri(activeUri)) {
      if (!this.pdfOutlineSource) {
        return [new vscode.TreeItem('(PDF outline unavailable)')];
      }
      const outline = this.pdfOutlineSource.getPdfOutline(activeUri);
      if (outline === undefined) {
        return [new vscode.TreeItem('(loading PDF outline…)')];
      }
      if (outline.length === 0) {
        return [new vscode.TreeItem('(no PDF outline)')];
      }
      const items = outline.map(
        (item, index) => new PdfOutlineItem(item, activeUri, String(index)),
      );
      return this.pdfOutlineSource.isPdfOutlineInferred?.(activeUri) === true
        ? [new vscode.TreeItem('Inferred outline'), ...items]
        : items;
    }

    const document = activeUri && isMarkdownUri(activeUri)
      ? await vscode.workspace.openTextDocument(activeUri)
      : undefined;
    if (!document) return [new vscode.TreeItem('(no active PDF or markdown document)')];

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

export function registerMarkdownOutlineTreeProvider(
  context: vscode.ExtensionContext,
  pdfOutlineSource?: PdfOutlineSource,
): MarkdownOutlineTreeProvider {
  const provider = new MarkdownOutlineTreeProvider(pdfOutlineSource);
  const subscriptions: vscode.Disposable[] = [
    ...['llm-wiki-markdown-outline', 'llm-wiki-pdf-outline'].map(viewId =>
      vscode.window.createTreeView(viewId, {
        treeDataProvider: provider,
        showCollapseAll: true,
      })
    ),
    vscode.window.onDidChangeActiveTextEditor(() => provider.refresh()),
    vscode.window.tabGroups.onDidChangeTabs(() => provider.refresh()),
    vscode.workspace.onDidChangeTextDocument(event => {
      const activeUri = getActiveMarkdownUri();
      if (activeUri?.toString() === event.document.uri.toString()) {
        provider.refresh();
      }
    }),
  ];
  if (pdfOutlineSource) {
    subscriptions.push(pdfOutlineSource.onDidChangePdfOutline(() => provider.refresh()));
  }
  context.subscriptions.push(...subscriptions);
  return provider;
}

function markdownOutlineItemId(uri: vscode.Uri, node: HeadingNode): string {
  return `markdown-outline:${uri.toString()}:${node.line}:${node.level}`;
}

function parseMarkdownHeadings(text: string): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  const lines = text.split(/\r?\n/);
  const frontmatterEndLine = markdownFrontmatterEndLine(lines);
  let fencedBy: string | null = null;
  let fenceLength = 0;

  for (const [index, line] of lines.entries()) {
    if (frontmatterEndLine != null && index <= frontmatterEndLine) continue;

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

function markdownFrontmatterEndLine(lines: readonly string[]): number | undefined {
  if (lines[0]?.trim() !== '---') return undefined;

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === '---') return index;
  }

  return undefined;
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

function getActiveMarkdownUri(): vscode.Uri | undefined {
  const activeUri = getActiveOutlineUri();
  return activeUri && isMarkdownUri(activeUri) ? activeUri : undefined;
}

function getActiveOutlineUri(): vscode.Uri | undefined {
  const tabInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input as { uri?: vscode.Uri } | undefined;
  if (tabInput?.uri && (isMarkdownUri(tabInput.uri) || isPdfUri(tabInput.uri))) {
    return tabInput.uri;
  }

  const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
  if (activeEditorUri && (isMarkdownUri(activeEditorUri) || isPdfUri(activeEditorUri))) {
    return activeEditorUri;
  }
  return undefined;
}

function isMarkdownUri(uri: vscode.Uri): boolean {
  return uri.scheme === 'file' && uri.fsPath.toLowerCase().endsWith('.md');
}

function isPdfUri(uri: vscode.Uri): boolean {
  return uri.scheme === 'file' && uri.fsPath.toLowerCase().endsWith('.pdf');
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
