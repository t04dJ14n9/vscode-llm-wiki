import * as vscode from 'vscode';
import * as path from 'path';
import {
  closeDatabase,
  createPdfAnchorFromSelection,
  openDatabase,
  resolveAnchor,
  runMigrations,
} from '@human-learning/core';

interface PdfSelectionAnchor {
  id?: string;
  page: number;
  textItemIndex: number;
  charOffset: number;
  endTextItemIndex?: number;
  endCharOffset?: number;
  length: number;
  snippet: string;
}

interface PdfHighlightSpec {
  anchor: PdfSelectionAnchor;
  kind: 'referenced' | 'annotated';
}

interface PdfReferenceListItem {
  source: string;
  sourceLine: number;
  snippet?: string;
  contextLine?: string;
}

interface ActivePdfWebview {
  panel: vscode.WebviewPanel;
  pdfUri: vscode.Uri;
  postMessage(message: unknown): void;
}

interface MarkdownInsertTarget {
  insertMarkdown(markdown: string): Promise<boolean>;
}

export class PdfEditorProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = 'human-learning.pdfViewer';

  private readonly webviews = new Map<string, ActivePdfWebview>();
  private activeKey: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly vaultRoot: string,
    private readonly markdownInsertTarget?: MarkdownInsertTarget,
  ) {}

  getActiveWebview(): ActivePdfWebview | undefined {
    return this.activeKey ? this.webviews.get(this.activeKey) : undefined;
  }

  async openPdfAtAnchor(pdfPath: string, anchorId?: string, page?: number, chunkId?: string): Promise<void> {
    const pdfUri = vscode.Uri.file(path.join(this.vaultRoot, decodePath(pdfPath)));
    const key = pdfUri.toString();

    await vscode.commands.executeCommand('vscode.openWith', pdfUri, PdfEditorProvider.viewType);
    const info = await this.waitForWebview(key);
    if (!info) return;

    let payload: Record<string, unknown> = {};
    if (anchorId) {
      const db = await openDatabase(this.vaultRoot);
      try {
        runMigrations(db);
        const anchor = resolveAnchor(db, anchorId);
        if (anchor) {
          payload = locatorToWebviewAnchor(anchor.locator_json, anchor.text_quote ?? '');
        }
      } finally {
        closeDatabase(db);
      }
    } else if (chunkId) {
      const db = await openDatabase(this.vaultRoot);
      try {
        runMigrations(db);
        const row = db.prepare(
          'SELECT metadata_json, text FROM chunks WHERE id = ? AND active = 1',
        ).get(chunkId) as { metadata_json?: string; text?: string } | undefined;
        if (row) {
          payload = chunkToWebviewAnchor(row.metadata_json, row.text ?? '');
        }
      } finally {
        closeDatabase(db);
      }
    } else if (page) {
      payload = { page };
    }

    if (Object.keys(payload).length > 0) {
      info.postMessage({ type: 'goToAnchor', anchor: payload });
    }
  }

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const pdfUri = document.uri;
    const key = pdfUri.toString();

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };

    const active: ActivePdfWebview = {
      panel: webviewPanel,
      pdfUri,
      postMessage: (message: unknown) => webviewPanel.webview.postMessage(message),
    };
    this.webviews.set(key, active);
    this.activeKey = key;
    await vscode.commands.executeCommand('setContext', 'humanLearningPdfOpen', true);

    webviewPanel.webview.onDidReceiveMessage(async (message: any) => {
      switch (message?.type) {
        case 'ready':
          await this.loadPdf(webviewPanel.webview, pdfUri);
          break;
        case 'selectionAction':
          await this.handleSelectionAction(pdfUri, message.action, message.anchor);
          break;
        case 'requestReferencesForAnchor':
          await this.sendReferencesForAnchor(webviewPanel.webview, message.anchor);
          break;
        case 'openMarkdownAtLocation':
          if (typeof message.path === 'string') {
            await this.openMarkdownAt(message.path, Number(message.line ?? 1));
          }
          break;
        case 'pageChanged':
          break;
        case 'error':
          vscode.window.showErrorMessage(`Human Learning PDF: ${message.message}`);
          break;
      }
    });

    webviewPanel.onDidChangeViewState(async () => {
      if (webviewPanel.active) {
        this.activeKey = key;
        await vscode.commands.executeCommand('setContext', 'humanLearningPdfOpen', true);
        await this.sendHighlights(webviewPanel.webview, pdfUri);
      }
    });

    webviewPanel.onDidDispose(async () => {
      this.webviews.delete(key);
      if (this.activeKey === key) {
        this.activeKey = undefined;
        await vscode.commands.executeCommand('setContext', 'humanLearningPdfOpen', false);
      }
    });

    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);
    setTimeout(() => void this.loadPdf(webviewPanel.webview, pdfUri), 750);
    setTimeout(() => void this.loadPdf(webviewPanel.webview, pdfUri), 2000);
  }

  private async loadPdf(webview: vscode.Webview, pdfUri: vscode.Uri): Promise<void> {
    try {
      const bytes = await vscode.workspace.fs.readFile(pdfUri);
      webview.postMessage({
        type: 'loadPdf',
        data: Buffer.from(bytes).toString('base64'),
      });
      await this.sendHighlights(webview, pdfUri);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to load PDF: ${String(error)}`);
    }
  }

  private async handleSelectionAction(
    pdfUri: vscode.Uri,
    action: 'copyLink' | 'insertLink' | 'copyQuoteAndLink' | 'insertQuoteAndLink' | 'highlight',
    anchor: PdfSelectionAnchor,
  ): Promise<void> {
    const relPath = vscode.workspace.asRelativePath(pdfUri);
    const db = await openDatabase(this.vaultRoot);
    runMigrations(db);
    const persisted = createPdfAnchorFromSelection(db, this.vaultRoot, relPath, {
      quote: anchor.snippet,
      page: anchor.page,
      textItemIndex: anchor.textItemIndex,
      charOffset: anchor.charOffset,
      endTextItemIndex: anchor.endTextItemIndex,
      endCharOffset: anchor.endCharOffset,
      createdBy: 'user',
    });
    closeDatabase(db);

    const label = formatPdfLinkLabel(relPath, anchor.page);
    const markdown = `[${escapeMarkdownLabel(label)}](${persisted.uri})`;
    const quotedMarkdown = formatQuoteAndLink(anchor.snippet, markdown);

    if (action === 'copyLink') {
      await vscode.env.clipboard.writeText(markdown);
      vscode.window.showInformationMessage('Human Learning PDF link copied');
      await this.refreshOpenPdfHighlights(pdfUri);
      return;
    }
    if (action === 'copyQuoteAndLink') {
      await vscode.env.clipboard.writeText(quotedMarkdown);
      vscode.window.showInformationMessage('Human Learning PDF quote copied');
      await this.refreshOpenPdfHighlights(pdfUri);
      return;
    }
    if (action === 'highlight') {
      vscode.window.showInformationMessage('Human Learning PDF highlight created');
      await this.refreshOpenPdfHighlights(pdfUri);
      return;
    }

    const textToInsert = action === 'insertQuoteAndLink' ? quotedMarkdown : markdown;
    if (await this.markdownInsertTarget?.insertMarkdown(textToInsert)) {
      vscode.window.showInformationMessage('Human Learning PDF link inserted');
      await this.refreshOpenPdfHighlights(pdfUri);
      return;
    }

    const editor = vscode.window.visibleTextEditors.find(e => e.document.languageId === 'markdown');
    if (!editor) {
      await vscode.env.clipboard.writeText(textToInsert);
      vscode.window.showWarningMessage('No markdown editor is visible. Link copied to clipboard.');
      await this.refreshOpenPdfHighlights(pdfUri);
      return;
    }

    await editor.edit(edit => {
      for (const selection of editor.selections) {
        edit.replace(selection, textToInsert);
      }
    });
    vscode.window.showInformationMessage('Human Learning PDF link inserted');
    await this.refreshOpenPdfHighlights(pdfUri);
  }

  private async refreshOpenPdfHighlights(pdfUri: vscode.Uri): Promise<void> {
    const active = this.webviews.get(pdfUri.toString());
    if (active) await this.sendHighlights(active.panel.webview, pdfUri);
  }

  private async sendHighlights(webview: vscode.Webview, pdfUri: vscode.Uri): Promise<void> {
    const relPath = vscode.workspace.asRelativePath(pdfUri);
    const db = await openDatabase(this.vaultRoot);
    try {
      runMigrations(db);
      const rows = db.prepare(`
        SELECT
          a.id,
          a.locator_json,
          a.text_quote,
          a.created_by,
          COUNT(l.id) AS reference_count
        FROM anchors a
        JOIN sources s ON s.id = a.source_id
        LEFT JOIN links l
          ON (l.to_anchor_id = a.id OR l.to_uri = a.uri)
          AND l.status = 'resolved'
        WHERE s.path = ?
          AND a.kind = 'pdf_rect'
          AND a.status = 'resolved'
        GROUP BY a.id, a.locator_json, a.text_quote, a.created_by
        ORDER BY a.created_at
      `).all(relPath) as Array<{
        id: string;
        locator_json: string;
        text_quote: string | null;
        created_by: string;
        reference_count: number;
      }>;

      const referenced: PdfHighlightSpec[] = [];
      const annotated: PdfHighlightSpec[] = [];
      for (const row of rows) {
        const anchor = {
          id: row.id,
          ...locatorToWebviewAnchor(row.locator_json, row.text_quote ?? ''),
        } as PdfSelectionAnchor;
        if (row.reference_count > 0) {
          referenced.push({ anchor, kind: 'referenced' });
        } else if (row.created_by === 'user') {
          annotated.push({ anchor, kind: 'annotated' });
        }
      }

      webview.postMessage({ type: 'setHighlights', referenced, annotated });
    } finally {
      closeDatabase(db);
    }
  }

  private async sendReferencesForAnchor(webview: vscode.Webview, anchor: PdfSelectionAnchor): Promise<void> {
    if (!anchor?.id) {
      webview.postMessage({ type: 'referencesForAnchor', anchor, items: [] });
      return;
    }

    const db = await openDatabase(this.vaultRoot);
    try {
      runMigrations(db);
      const rows = db.prepare(`
        SELECT from_note_path, from_line, label
        FROM links
        WHERE status = 'resolved'
          AND (to_anchor_id = ? OR to_uri IN (SELECT uri FROM anchors WHERE id = ?))
        ORDER BY from_note_path, from_line
      `).all(anchor.id, anchor.id) as Array<{
        from_note_path: string;
        from_line: number;
        label: string | null;
      }>;
      const items: PdfReferenceListItem[] = [];
      for (const row of rows) {
        items.push({
          source: row.from_note_path,
          sourceLine: row.from_line,
          snippet: row.label ?? anchor.snippet,
          contextLine: await this.readMarkdownLine(row.from_note_path, row.from_line),
        });
      }
      webview.postMessage({ type: 'referencesForAnchor', anchor, items });
    } finally {
      closeDatabase(db);
    }
  }

  private async readMarkdownLine(relPath: string, oneBasedLine: number): Promise<string | undefined> {
    try {
      const uri = vscode.Uri.file(path.join(this.vaultRoot, relPath));
      const open = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === uri.fsPath);
      const document = open ?? await vscode.workspace.openTextDocument(uri);
      const index = Math.max(0, oneBasedLine - 1);
      if (index >= document.lineCount) return undefined;
      const text = document.lineAt(index).text.trim();
      return text.length > 240 ? `${text.slice(0, 237)}...` : text;
    } catch {
      return undefined;
    }
  }

  private async openMarkdownAt(relPath: string, oneBasedLine: number): Promise<void> {
    const uri = vscode.Uri.file(path.join(this.vaultRoot, relPath));
    const document = await vscode.workspace.openTextDocument(uri);
    const line = Math.max(0, Math.min(document.lineCount - 1, oneBasedLine - 1));
    const anchor = document.offsetAt(new vscode.Position(line, 0));

    await vscode.commands.executeCommand(
      'vscode.openWith',
      uri,
      'human-learning.markdownEditor',
    );
    await vscode.commands.executeCommand('human-learning.revealInMarkdownEditor', {
      uri,
      selection: { from: anchor, to: anchor },
    });
  }

  private async waitForWebview(key: string): Promise<ActivePdfWebview | undefined> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const webview = this.webviews.get(key);
      if (webview) return webview;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    vscode.window.showErrorMessage('Timed out opening PDF webview');
    return undefined;
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'pdf-viewer.js'));
    const wasmUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'pdfium.wasm'));
    const nonce = String(Date.now());

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob: data:; script-src 'nonce-${nonce}' ${webview.cspSource} 'wasm-unsafe-eval'; style-src ${webview.cspSource} 'unsafe-inline'; worker-src blob: ${webview.cspSource}; connect-src ${webview.cspSource} blob: data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Human Learning PDF</title>
  <style>
    html, body { height: 100%; margin: 0; padding: 0; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); overflow: hidden; }
    #toolbar { height: 34px; display: flex; gap: 6px; align-items: center; padding: 0 8px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
    #toolbar button { height: 24px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border-radius: 4px; cursor: pointer; }
    #toolbar button[aria-pressed="true"] { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .pdf-search { position: fixed; top: 42px; right: 8px; z-index: 40; box-sizing: border-box; display: grid; grid-template-columns: minmax(128px, 1fr) 24px 24px minmax(44px, max-content) 24px; align-items: center; gap: 2px; width: min(420px, calc(100% - 16px)); min-height: 34px; padding: 4px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, #454545)); border-radius: 3px; background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background, #252526)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground, var(--vscode-editor-foreground, inherit))); box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0,0,0,.36)); font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); font-size: 12px; }
    .pdf-search.hidden { display: none; }
    .pdf-search input { box-sizing: border-box; width: 100%; height: 26px; min-width: 0; margin: 0; padding: 2px 6px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; outline: 0; background: var(--vscode-input-background, var(--vscode-editor-background)); color: var(--vscode-input-foreground, var(--vscode-editor-foreground)); font: inherit; }
    .pdf-search input:focus { border-color: var(--vscode-focusBorder, var(--vscode-inputOption-activeBorder, #007fd4)); }
    .pdf-search button { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; min-width: 24px; margin: 0; padding: 0; border: 1px solid transparent; border-radius: 3px; appearance: none; -webkit-appearance: none; background: transparent; background-image: none; box-shadow: none; color: var(--vscode-icon-foreground, var(--vscode-foreground, var(--vscode-editor-foreground, inherit))); font: inherit; line-height: 1; white-space: nowrap; cursor: pointer; }
    .pdf-search button:hover { background-color: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,.31)); }
    .pdf-search button:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: -1px; }
    .pdf-search .count { min-width: 44px; padding: 0 4px; color: var(--vscode-descriptionForeground, var(--vscode-editor-foreground)); text-align: center; white-space: nowrap; }
    #viewer-container { height: calc(100% - 35px); overflow: auto; }
    #page-container { display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 18px; }
    #page-container.two-page { display: grid; grid-template-columns: repeat(2, max-content); align-items: start; justify-content: center; }
    #page-container.paginated { min-height: calc(100% - 36px); justify-content: center; align-content: center; }
    .page-wrapper { position: relative; background: white; box-shadow: 0 2px 12px rgba(0,0,0,.35); }
    .pdf-canvas, .text-layer, .highlight-layer { position: absolute; left: 0; top: 0; }
    .text-layer {
      right: 0;
      bottom: 0;
      user-select: text;
      color: transparent;
      forced-color-adjust: none;
    }
    .text-layer span {
      position: absolute;
      color: transparent;
      -webkit-text-fill-color: transparent;
      white-space: pre;
      cursor: text;
      forced-color-adjust: none;
    }
    .highlight-layer { right: 0; bottom: 0; pointer-events: none; }
    .annotation-highlight { position: absolute; pointer-events: auto; cursor: pointer; border-radius: 2px; transition: filter .12s, background-color .12s; }
    .annotation-highlight.referenced { background: rgba(58, 190, 110, .42); }
    .annotation-highlight.annotated { background: rgba(255, 218, 80, .38); }
    .annotation-highlight.hover-active { filter: brightness(1.25) saturate(1.2); }
    .anchor-highlight { position: absolute; background: rgba(0, 150, 255, .35); border-radius: 2px; pointer-events: none; }
    .pdf-search-match { position: absolute; border-radius: 2px; background: rgba(255, 214, 10, .40); outline: 1px solid rgba(255, 214, 10, .55); pointer-events: none; }
    .pdf-search-match.selected { background: rgba(255, 140, 0, .45); outline-color: rgba(255, 140, 0, .85); }
    .selection-toolbar { position: absolute; transform: translateX(-50%); z-index: 20; display: flex; gap: 4px; padding: 4px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editorWidget-background); box-shadow: 0 4px 16px rgba(0,0,0,.3); }
    .selection-toolbar button { border: 0; border-radius: 4px; padding: 4px 8px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
    .selection-toolbar .secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .selection-toolbar .menu { position: absolute; top: calc(100% + 6px); right: 0; min-width: 180px; display: none; flex-direction: column; gap: 3px; padding: 4px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editorWidget-background); }
    .selection-toolbar .menu.open { display: flex; }
    .ref-popover { position: absolute; z-index: 30; min-width: 260px; max-width: 440px; max-height: 320px; overflow: auto; padding: 6px 0; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editorWidget-background); color: var(--vscode-editor-foreground); box-shadow: 0 8px 24px rgba(0,0,0,.35); font-size: 12px; }
    .ref-popover .header { padding: 4px 12px 6px; border-bottom: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
    .ref-popover .item { padding: 7px 12px; cursor: pointer; }
    .ref-popover .item:hover { background: var(--vscode-list-hoverBackground, rgba(127,127,127,.18)); }
    .ref-popover .context { line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .ref-popover .meta { margin-top: 3px; color: var(--vscode-descriptionForeground); }
    .ref-popover .empty { padding: 10px 12px; color: var(--vscode-descriptionForeground); font-style: italic; }
    .error { padding: 24px; color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
  <div id="toolbar">
    <button id="prev">Prev</button>
    <button id="next">Next</button>
    <button id="zoom-out">-</button>
    <button id="zoom-in">+</button>
    <button id="fit">Fit</button>
    <button id="search-open" title="Find in PDF">Search</button>
    <button id="toggle-continuous" aria-pressed="true" title="Switch to page-turning mode">Continuous</button>
    <button id="toggle-spread" aria-pressed="false" title="Switch to two-page view">One Page</button>
    <span id="page-info"></span>
  </div>
  <div id="pdf-search" class="pdf-search hidden" role="search" aria-label="Find in PDF">
    <input id="pdf-search-input" type="search" placeholder="Find" aria-label="Find in PDF" autocomplete="off">
    <button id="pdf-search-prev" type="button" title="Previous match" aria-label="Previous match">↑</button>
    <button id="pdf-search-next" type="button" title="Next match" aria-label="Next match">↓</button>
    <span id="pdf-search-count" class="count" aria-live="polite"></span>
    <button id="pdf-search-close" type="button" title="Close search" aria-label="Close search">×</button>
  </div>
  <div id="viewer-container"><div id="page-container"></div></div>
  <script nonce="${nonce}">window.__pdfiumWasmUrl = "${wasmUri}";</script>
  <script nonce="${nonce}" src="${scriptUri}?v=${nonce}"></script>
</body>
</html>`;
  }
}

function locatorToWebviewAnchor(locatorJson: string, quote: string): Record<string, unknown> {
  try {
    const locator = JSON.parse(locatorJson);
    return {
      page: locator.page ?? 1,
      textItemIndex: locator.textItemIndex,
      charOffset: locator.charOffset,
      endTextItemIndex: locator.endTextItemIndex,
      endCharOffset: locator.endCharOffset,
      snippet: quote,
    };
  } catch {
    return { page: 1, snippet: quote };
  }
}

function chunkToWebviewAnchor(metadataJson: string | undefined, text: string): Record<string, unknown> {
  const metadata = parseJsonObject(metadataJson);
  const page = numberValue(metadata.page_start) ?? numberValue(metadata.page) ?? 1;
  return {
    page,
    textItemIndex: numberValue(metadata.text_item_start),
    charOffset: numberValue(metadata.char_offset_start),
    endTextItemIndex: numberValue(metadata.text_item_end),
    endCharOffset: numberValue(metadata.char_offset_end),
    snippet: text.replace(/\s+/g, ' ').trim().slice(0, 240),
  };
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function decodePath(input: string): string {
  return input.split('/').map(segment => decodeURIComponent(segment)).join('/');
}

function formatPdfLinkLabel(relPath: string, page: number): string {
  const fileName = path.basename(relPath) || 'PDF';
  return `${fileName} p.${page}`;
}

function escapeMarkdownLabel(input: string): string {
  return input.replace(/]/g, '\\]');
}

function formatQuoteAndLink(quote: string, markdownLink: string): string {
  const normalized = quote.replace(/\s+/g, ' ').trim();
  if (!normalized) return markdownLink;
  return `> ${normalized}\n>\n> ${markdownLink}`;
}
