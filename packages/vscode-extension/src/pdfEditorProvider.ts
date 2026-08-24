import * as vscode from 'vscode';
import * as path from 'path';
import { createHash } from 'node:crypto';
import {
  pdfHref,
  type PdfTextFragment,
  type PdfViewRect,
} from '@llm-wiki/core';
import type {
  AgentHandoffCapability,
  AgentSurfaceCapabilities,
  ExternalAgentId,
} from './agentHandoff';
import type { SelectionContext } from './selectionContext';
import {
  isQueryPagePath,
  resolvePdfAnchor,
  type QueryAnnotationIndex,
} from './queryAnnotationIndex';
import {
  createPdfAgentClipboardContext,
  pdfAgentClipboardSelectionKey,
  type PdfAgentClipboardContext,
  type PdfAgentClipboardSelection,
} from './agentClipboard';

interface PdfSelectionAnchor {
  id?: string;
  area?: boolean;
  page: number;
  textItemIndex?: number;
  charOffset?: number;
  endTextItemIndex?: number;
  endCharOffset?: number;
  length?: number;
  rects?: number[][];
  prefix?: string;
  suffix?: string;
  snippet: string;
}

type PdfSelectionAction = 'addToCursorChat';

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

interface ActivePdfWebview {
  panel: vscode.WebviewPanel;
  pdfUri: vscode.Uri;
  pdfSha256?: string;
  pdfBytes?: Uint8Array;
  ready: boolean;
  pendingAnchor?: PdfAnchorNavigation;
  agentClipboardContext?: PdfAgentClipboardContext;
  selection?: PdfSelectionAnchor;
  outline?: PdfOutlineEntry[];
  outlineInferred?: boolean;
  outlineLoading?: boolean;
  postMessage(message: unknown): void;
}

interface PdfAnchorNavigation {
  page?: number;
  textFragment?: PdfTextFragment;
}

export type PdfToolbarDock = 'top' | 'left';

export interface PdfToolbarPreference {
  dock: PdfToolbarDock;
  hidden: boolean;
}

export interface PdfEditorProviderOptions {
  vaultRoot?: string;
  documentRoot?: string;
  agentCapabilities?: () => AgentSurfaceCapabilities;
  onDidChangeAgentCapabilities?: vscode.Event<void>;
  queryAnnotationIndex?: Pick<QueryAnnotationIndex, 'listAnnotationsForSource'>;
  queryDiagnostics?: vscode.DiagnosticCollection;
}

export const ADD_SELECTION_TO_CURSOR_CHAT_COMMAND =
  'llm-wiki.addSelectionToCursorChat';

const PDF_TOOLBAR_PREFERENCE_KEY = 'llmWiki.pdf.toolbarPreference.v1';
const DEFAULT_PDF_TOOLBAR_PREFERENCE: PdfToolbarPreference = {
  dock: 'top',
  hidden: false,
};

export interface OpenCodexThreadResult {
  threadId: string;
  opened: boolean;
  error?: string;
}

export async function openCodexThread(threadId: string): Promise<OpenCodexThreadResult> {
  try {
    const opened = await vscode.env.openExternal(
      vscode.Uri.parse(`codex://threads/${encodeURIComponent(threadId)}`),
    );
    return opened
      ? { threadId, opened: true }
      : {
          threadId,
          opened: false,
          error: 'VS Code could not open the promoted Codex task.',
        };
  } catch (cause) {
    return {
      threadId,
      opened: false,
      error: `VS Code could not open the promoted Codex task: ${String(cause)}`,
    };
  }
}

export class PdfEditorProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = 'llm-wiki.pdfViewer';

  private readonly webviews = new Map<string, ActivePdfWebview>();
  private readonly documentRoot: string;
  private readonly agentCapabilities: () => AgentSurfaceCapabilities;
  private readonly queryAnnotationIndex?: Pick<QueryAnnotationIndex, 'listAnnotationsForSource'>;
  private readonly queryDiagnostics?: vscode.DiagnosticCollection;
  private readonly pdfOutlineListeners = new Set<(uri: vscode.Uri) => unknown>();
  private pdfToolbarPreference: PdfToolbarPreference;
  readonly onDidChangePdfOutline: vscode.Event<vscode.Uri> = (listener, thisArgs, disposables) => {
    const wrapped = thisArgs
      ? (uri: vscode.Uri) => listener.call(thisArgs, uri)
      : listener;
    this.pdfOutlineListeners.add(wrapped);
    const disposable = {
      dispose: () => this.pdfOutlineListeners.delete(wrapped),
    };
    disposables?.push(disposable);
    return disposable;
  };
  private activeKey: string | undefined;

  constructor(context: vscode.ExtensionContext, options: PdfEditorProviderOptions);
  constructor(
    context: vscode.ExtensionContext,
    vaultRoot: string,
  );
  constructor(
    private readonly context: vscode.ExtensionContext,
    optionsOrVaultRoot: PdfEditorProviderOptions | string,
  ) {
    const options: PdfEditorProviderOptions = typeof optionsOrVaultRoot === 'string'
      ? {
          vaultRoot: optionsOrVaultRoot,
          documentRoot: optionsOrVaultRoot,
        }
      : optionsOrVaultRoot;
    this.documentRoot = options.documentRoot ?? options.vaultRoot ?? process.cwd();
    this.agentCapabilities = options.agentCapabilities ?? (() => ({
      cursorAgent: false,
      providers: [],
    }));
    this.queryAnnotationIndex = options.queryAnnotationIndex;
    this.queryDiagnostics = options.queryDiagnostics;
    this.pdfToolbarPreference = normalizePdfToolbarPreference(
      context.globalState?.get(PDF_TOOLBAR_PREFERENCE_KEY),
    );
    if (options.onDidChangeAgentCapabilities) {
      context.subscriptions.push(
        options.onDidChangeAgentCapabilities(
          () => this.broadcastAgentHandoffCapabilities(),
        ),
      );
    }
  }

  getActiveWebview(): ActivePdfWebview | undefined {
    return this.activeKey ? this.webviews.get(this.activeKey) : undefined;
  }

  getActivePdfUri(): vscode.Uri | undefined {
    const active = this.getActiveWebview();
    if (active) return active.pdfUri;

    let visible: ActivePdfWebview | undefined;
    for (const candidate of this.webviews.values()) {
      if (!candidate.panel.visible) continue;
      if (visible) return undefined;
      visible = candidate;
    }
    return visible?.pdfUri;
  }

  getPdfOutline(uri: vscode.Uri): readonly PdfOutlineEntry[] | undefined {
    const active = this.webviews.get(uri.toString());
    return active?.outlineLoading ? undefined : active?.outline;
  }

  isPdfOutlineInferred(uri: vscode.Uri): boolean {
    const active = this.webviews.get(uri.toString());
    return active?.outlineLoading !== true
      && active?.outlineInferred === true
      && Boolean(active.outline?.length);
  }

  getPdfToolbarPreference(): PdfToolbarPreference {
    return { ...this.pdfToolbarPreference };
  }

  async setPdfToolbarPreference(value: unknown): Promise<PdfToolbarPreference> {
    if (!validPdfToolbarPreference(value)) return this.getPdfToolbarPreference();
    const next = normalizePdfToolbarPreference(value, this.pdfToolbarPreference);
    if (
      next.dock === this.pdfToolbarPreference.dock
      && next.hidden === this.pdfToolbarPreference.hidden
    ) return this.getPdfToolbarPreference();
    this.pdfToolbarPreference = next;
    this.broadcastPdfToolbarPreference();
    try {
      await this.context.globalState?.update(PDF_TOOLBAR_PREFERENCE_KEY, next);
    } catch {
      // The live preference remains usable even when persistence is unavailable.
    }
    return this.getPdfToolbarPreference();
  }

  async togglePdfToolbar(): Promise<PdfToolbarPreference> {
    return this.setPdfToolbarPreference({
      dock: this.pdfToolbarPreference.dock,
      hidden: !this.pdfToolbarPreference.hidden,
    });
  }

  async revealPdfOutlineDestination(
    uri: vscode.Uri,
    rawDestination: unknown,
    rawTitle?: unknown,
  ): Promise<boolean> {
    const destination = normalizePdfOutlineDestination(rawDestination);
    if (!destination) return false;
    const title = normalizePdfOutlineTitle(rawTitle);

    const key = uri.toString();
    let active = this.webviews.get(key);
    if (!active) {
      await vscode.commands.executeCommand('vscode.openWith', uri, PdfEditorProvider.viewType);
      active = await this.waitForWebview(key);
    }
    if (!active) return false;

    active.panel.reveal(undefined, true);
    this.activeKey = key;
    active.postMessage({
      type: 'goToPdfDestination',
      destination,
      ...(title ? { title } : {}),
    });
    return true;
  }

  async addSelectionToCursorChat(): Promise<void> {
    const active = this.getActiveWebview();
    if (!active) return;
    active.postMessage({ type: 'addSelectionToCursorChat' });
  }

  async copySelectionForAgent(): Promise<boolean> {
    const active = this.getActiveWebview();
    if (!active) return false;
    active.postMessage({ type: 'copySelectionForAgent' });
    return true;
  }

  async refreshQueryAnnotations(): Promise<void> {
    await Promise.all([...this.webviews.values()].map(active => this.postQueryAnnotations(active)));
  }

  async getActiveSelectionContext(): Promise<SelectionContext | undefined> {
    const active = this.getActiveWebview();
    return active
      ? this.toSelectionContext(
          active.pdfUri,
          active.selection,
          active.agentClipboardContext?.plainText,
        )
      : undefined;
  }

  private toSelectionContext(
    pdfUri: vscode.Uri,
    rawSelection: unknown,
    agentText?: string,
  ): SelectionContext | undefined {
    const selection = normalizePdfSelectionAnchor(rawSelection);
    if (!selection) return undefined;
    const relPath = vscode.workspace.asRelativePath(pdfUri);
    const viewRect = selection.area ? pdfViewRectForSelection(selection) : undefined;
    const textFragment = pdfTextFragmentForSelection(selection);

    return {
      uri: pdfUri,
      text: selection.snippet,
      startLine: selection.page,
      endLine: selection.page,
      sourceLabel: relPath,
      rangeLabel: `page ${selection.page}${selection.area ? ' region' : ''}`,
      anchorUri: pdfHref(relPath, {
        page: selection.page,
        ...(viewRect ? { viewRect } : { textFragment }),
      }),
      metadata: {
        kind: 'pdf',
        page: selection.page,
        ...(selection.area
          ? { selectionKind: 'area', viewRect }
          : { textFragment }),
        ...(agentText ? { agentText } : {}),
      },
    };
  }

  async openPdfAtTarget(pdfPath: string, page?: number, textFragment?: PdfTextFragment): Promise<void> {
    const resolvedPath = resolvePdfTargetPath(this.documentRoot, pdfPath);
    if (!resolvedPath) {
      vscode.window.showErrorMessage(`Cannot open PDF outside the document root: ${pdfPath}`);
      return;
    }
    const pdfUri = vscode.Uri.file(resolvedPath);
    const key = pdfUri.toString();

    await vscode.commands.executeCommand('vscode.openWith', pdfUri, PdfEditorProvider.viewType);
    const info = await this.waitForWebview(key);
    if (!info) return;

    const payload: Record<string, unknown> = {
      ...(page ? { page } : {}),
      ...(textFragment ? { textFragment } : {}),
    };

    if (Object.keys(payload).length > 0) this.postAnchorWhenReady(info, payload);
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
    const webview = webviewPanel.webview;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };

    const active: ActivePdfWebview = {
      panel: webviewPanel,
      pdfUri,
      ready: false,
      postMessage: (message: unknown) => {
        void webview.postMessage(message);
      },
    };
    this.webviews.set(key, active);
    if (webviewPanel.active) {
      this.activeKey = key;
      await vscode.commands.executeCommand('setContext', 'llmWikiPdfOpen', true);
      await vscode.commands.executeCommand('setContext', 'llmWikiPdfHasSelection', false);
      await vscode.commands.executeCommand(
        'setContext',
        'llmWikiPdfHasAgentClipboardSelection',
        false,
      );
    }

    webview.onDidReceiveMessage(async (message: any) => {
      switch (message?.type) {
        case 'ready': {
          active.ready = true;
          this.postAgentHandoffCapabilities(webview);
          this.postPdfToolbarPreference(active);
          await this.loadPdf(active);
          this.flushPendingAnchor(active);
          break;
        }
        case 'pdfToolbarPreferenceChanged':
          await this.setPdfToolbarPreference(message.preference);
          break;
        case 'selectionAction': {
          await this.handleSelectionAction(
            pdfUri,
            message.action,
            message.anchor,
          );
          break;
        }
        case 'copyText': {
          const text = normalizePdfMessageText(message.text);
          if (text) await vscode.env.clipboard.writeText(text);
          break;
        }
        case 'agentClipboardResult': {
          const context = active.agentClipboardContext;
          if (
            !context
            || typeof message.selectionKey !== 'string'
            || message.selectionKey !== context.selectionKey
          ) break;
          if (
            message.status !== 'text-fallback'
            || typeof message.plainText !== 'string'
            || message.plainText !== context.plainText
          ) break;
          await this.copyPdfAgentClipboardTextFallback(context);
          break;
        }
        case 'lookupSelection':
          await this.lookupSelection(message.text);
          break;
        case 'copyPageLink': {
          const page = normalizePdfPage(message.page);
          if (!page) break;
          const relPath = vscode.workspace.asRelativePath(pdfUri);
          await vscode.env.clipboard.writeText(formatPdfPageLink(relPath, page));
          vscode.window.showInformationMessage('LLM Wiki PDF page link copied');
          break;
        }
        case 'selectionChanged':
          await this.updateActiveSelection(key, message.anchor, message.clipboardSelection);
          break;
        case 'openQuery': {
          const navigation = message.navigation;
          if (!navigation || typeof navigation !== 'object') break;
          const target = navigation as Record<string, unknown>;
          if (
            target.kind !== 'query'
            || typeof target.queryPath !== 'string'
            || path.isAbsolute(target.queryPath)
            || target.queryPath.includes('\\')
            || target.queryPath.split('/').includes('..')
            || !target.queryPath.toLowerCase().endsWith('.md')
            || !isQueryPagePath(target.queryPath)
          ) break;
          await vscode.commands.executeCommand(
            'llm-wiki.openLinkTarget',
            target.queryPath,
            pdfUri,
          );
          break;
        }
        case 'pdfOutline':
          active.outlineLoading = message.loading === true;
          active.outline = active.outlineLoading
            ? undefined
            : normalizePdfOutlineEntries(message.items);
          active.outlineInferred = !active.outlineLoading
            && message.inferred === true
            && Boolean(active.outline?.length);
          this.firePdfOutlineChanged(pdfUri);
          break;
        case 'pageChanged':
          break;
        case 'error':
          vscode.window.showErrorMessage(`LLM Wiki PDF: ${message.message}`);
          break;
      }
    });

    webviewPanel.onDidChangeViewState(async () => {
      if (!webviewPanel.active) {
        if (this.activeKey === key) {
          this.activeKey = undefined;
          await vscode.commands.executeCommand('setContext', 'llmWikiPdfOpen', false);
          await vscode.commands.executeCommand('setContext', 'llmWikiPdfHasSelection', false);
          await vscode.commands.executeCommand(
            'setContext',
            'llmWikiPdfHasAgentClipboardSelection',
            false,
          );
        }
        return;
      }
      this.activeKey = key;
      await vscode.commands.executeCommand('setContext', 'llmWikiPdfOpen', true);
      await vscode.commands.executeCommand('setContext', 'llmWikiPdfHasSelection', Boolean(active.selection));
      await vscode.commands.executeCommand(
        'setContext',
        'llmWikiPdfHasAgentClipboardSelection',
        Boolean(active.agentClipboardContext),
      );
      this.firePdfOutlineChanged(pdfUri);
    });

    webviewPanel.onDidDispose(async () => {
      this.webviews.delete(key);
      this.firePdfOutlineChanged(pdfUri);
      if (this.activeKey === key) {
        this.activeKey = undefined;
        await vscode.commands.executeCommand('setContext', 'llmWikiPdfOpen', false);
        await vscode.commands.executeCommand('setContext', 'llmWikiPdfHasSelection', false);
        await vscode.commands.executeCommand(
          'setContext',
          'llmWikiPdfHasAgentClipboardSelection',
          false,
        );
      }
    });

    webview.html = this.getHtml(webview);
  }

  private firePdfOutlineChanged(uri: vscode.Uri): void {
    for (const listener of this.pdfOutlineListeners) {
      try {
        listener(uri);
      } catch (error) {
        console.error('LLM Wiki PDF outline listener failed', error);
      }
    }
  }

  private async loadPdf(active: ActivePdfWebview): Promise<void> {
    try {
      const bytes = await vscode.workspace.fs.readFile(active.pdfUri);
      active.pdfBytes = bytes;
      active.pdfSha256 = createHash('sha256').update(bytes).digest('hex');
      active.postMessage({
        type: 'loadPdf',
        data: Buffer.from(bytes).toString('base64'),
      });
      await this.postQueryAnnotations(active);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to load PDF: ${String(error)}`);
    }
  }

  private async postQueryAnnotations(active: ActivePdfWebview): Promise<void> {
    if (!this.queryAnnotationIndex || !active.pdfBytes) {
      active.postMessage({ type: 'setQueryAnnotations', annotations: [] });
      return;
    }
    try {
      const sourcePath = vscode.workspace.asRelativePath(active.pdfUri, false);
      const annotations = await this.queryAnnotationIndex.listAnnotationsForSource(sourcePath);
      const diagnostics: vscode.Diagnostic[] = [];
      const resolved = annotations.flatMap(annotation => {
        if (annotation.anchor.kind !== 'pdf') return [];
        const resolution = resolvePdfAnchor(annotation.anchor, active.pdfBytes!);
        if (!resolution.geometry) {
          if (resolution.diagnostic) {
            const diagnostic = new vscode.Diagnostic(
              new vscode.Range(0, 0, 0, 1),
              resolution.diagnostic.message,
              vscode.DiagnosticSeverity.Warning,
            );
            diagnostic.source = 'llm-wiki-query';
            diagnostic.code = resolution.diagnostic.code;
            diagnostics.push(diagnostic);
          }
          return [];
        }
        return [{
          annotationId: `${annotation.queryPath}#${annotation.anchor.sourceId}`,
          queryPath: annotation.queryPath,
          title: annotation.title,
          status: annotation.status,
          condensedSummary: annotation.condensedSummary,
          ...(annotation.project ? { project: annotation.project } : {}),
          updatedTime: annotation.updatedTime,
          navigationTarget: annotation.navigationTarget,
          page: resolution.geometry.page,
          rects: resolution.geometry.rects,
        }];
      });
      this.queryDiagnostics?.set(active.pdfUri, diagnostics);
      active.postMessage({ type: 'setQueryAnnotations', annotations: resolved });
    } catch {
      this.queryDiagnostics?.delete(active.pdfUri);
      active.postMessage({ type: 'setQueryAnnotations', annotations: [] });
    }
  }

  private postAgentHandoffCapabilities(webview: vscode.Webview): void {
    void webview.postMessage(this.agentHandoffCapabilitiesMessage());
  }

  private broadcastAgentHandoffCapabilities(): void {
    const message = this.agentHandoffCapabilitiesMessage();
    for (const active of this.webviews.values()) {
      active.postMessage(message);
    }
  }

  private postPdfToolbarPreference(active: ActivePdfWebview): void {
    active.postMessage({
      type: 'pdfToolbarPreference',
      preference: this.getPdfToolbarPreference(),
    });
  }

  private broadcastPdfToolbarPreference(): void {
    for (const active of this.webviews.values()) {
      this.postPdfToolbarPreference(active);
    }
  }

  private agentHandoffCapabilitiesMessage(): {
    type: 'agentHandoffCapabilities';
    cursorAgent: boolean;
    providers: AgentHandoffCapability[];
  } {
    const capabilities = this.agentCapabilities();
    const seen = new Set<ExternalAgentId>();
    const providers = Array.isArray(capabilities?.providers)
      ? capabilities.providers.flatMap(provider => {
          if (
            !isExternalAgentId(provider?.id)
            || typeof provider.label !== 'string'
            || !provider.label.trim()
            || seen.has(provider.id)
          ) return [];
          seen.add(provider.id);
          return [{ id: provider.id, label: provider.label.trim() }];
        })
      : [];
    return {
      type: 'agentHandoffCapabilities',
      cursorAgent: capabilities?.cursorAgent === true,
      providers,
    };
  }

  private async lookupSelection(rawText: unknown): Promise<void> {
    const text = normalizeLookupText(rawText);
    if (!text) return;
    const uri = vscode.Uri.parse(`dict://${encodeURIComponent(text)}`);
    const opened = await vscode.env.openExternal(uri);
    if (opened) {
      vscode.window.showInformationMessage(`Looking up "${text}" in Dictionary`);
      return;
    }
    await vscode.env.clipboard.writeText(text);
    vscode.window.showWarningMessage('Dictionary lookup was not available. Selected text copied to clipboard.');
  }

  private async handleSelectionAction(
    pdfUri: vscode.Uri,
    action: unknown,
    anchor: PdfSelectionAnchor,
  ): Promise<void> {
    if (!isPdfSelectionAction(action)) return;
    if (action === 'addToCursorChat') {
      const active = this.webviews.get(pdfUri.toString());
      const selection = this.toSelectionContext(
        pdfUri,
        anchor,
        active?.agentClipboardContext?.plainText,
      );
      if (!selection) throw new Error('Cannot add an empty PDF selection to chat');
      await vscode.commands.executeCommand(
        ADD_SELECTION_TO_CURSOR_CHAT_COMMAND,
        { selection },
      );
    }
  }

  private async updateActiveSelection(
    key: string,
    anchor: unknown,
    clipboardSelection: unknown,
  ): Promise<void> {
    const active = this.webviews.get(key);
    if (!active) return;
    active.selection = normalizePdfSelectionAnchor(anchor);
    const normalizedClipboardSelection = normalizePdfAgentClipboardSelection(clipboardSelection);
    let context: PdfAgentClipboardContext | undefined;
    if (normalizedClipboardSelection && active.pdfSha256) {
      const relativePath = vscode.workspace.asRelativePath(active.pdfUri);
      context = createPdfAgentClipboardContext({
        selectionKey: normalizedClipboardSelection.selectionKey,
        relativePath,
        sourceSha256: active.pdfSha256,
        selection: normalizedClipboardSelection.selection,
      });
    }
    active.agentClipboardContext = context;
    active.postMessage({
      type: 'agentClipboardContext',
      ...(context ? { context } : {}),
    });
    if (this.activeKey === key) {
      await vscode.commands.executeCommand('setContext', 'llmWikiPdfHasSelection', Boolean(active.selection));
      await vscode.commands.executeCommand(
        'setContext',
        'llmWikiPdfHasAgentClipboardSelection',
        Boolean(active.agentClipboardContext),
      );
    }
  }

  private async copyPdfAgentClipboardTextFallback(
    context: PdfAgentClipboardContext,
  ): Promise<void> {
    try {
      await vscode.env.clipboard.writeText(context.plainText);
      vscode.window.showInformationMessage('Selection copied for agent.');
    } catch {
      vscode.window.showErrorMessage('The selection could not be copied.');
    }
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

  private postAnchorWhenReady(
    active: ActivePdfWebview,
    anchor: PdfAnchorNavigation,
  ): void {
    if (!active.ready) {
      active.pendingAnchor = anchor;
      return;
    }
    active.postMessage({ type: 'goToAnchor', anchor });
  }

  private flushPendingAnchor(active: ActivePdfWebview): void {
    const anchor = active.pendingAnchor;
    if (!anchor) return;
    active.pendingAnchor = undefined;
    active.postMessage({ type: 'goToAnchor', anchor });
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'pdf-viewer.js'));
    const wasmUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'pdfium.wasm'));
    const nonce = String(Date.now());

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; img-src ${webview.cspSource} blob: data:; script-src 'nonce-${nonce}' ${webview.cspSource} 'wasm-unsafe-eval'; style-src ${webview.cspSource} 'unsafe-inline'; worker-src blob: ${webview.cspSource}; connect-src ${webview.cspSource} blob: data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LLM Wiki PDF</title>
  <style>
    html, body { height: 100%; margin: 0; padding: 0; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); overflow: hidden; }
    #pdf-reader-layout { position: relative; box-sizing: border-box; display: grid; width: 100%; height: 100%; min-width: 0; min-height: 0; }
    #pdf-reader-layout[data-toolbar-dock="top"] { grid-template: auto minmax(0, 1fr) / minmax(0, 1fr); }
    #pdf-reader-layout[data-toolbar-dock="left"] { grid-template: minmax(0, 1fr) / auto minmax(0, 1fr); }
    #toolbar { z-index: 2; box-sizing: border-box; height: 38px; display: flex; gap: 4px; align-items: center; padding: 0 6px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); font: 12px var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
    #toolbar[hidden] { display: none; }
    #toolbar button { box-sizing: border-box; min-width: 26px; height: 26px; padding: 0 6px; border: 1px solid var(--vscode-button-border, transparent); background: transparent; color: var(--vscode-button-secondaryForeground); border-radius: 3px; cursor: pointer; }
    #toolbar button:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,.31)); }
    #toolbar button[aria-pressed="true"] { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    #pdf-toolbar-grip { touch-action: none; cursor: grab; font-size: 15px; line-height: 1; }
    #pdf-toolbar-grip:active { cursor: grabbing; }
    .toolbar-group { display: inline-flex; align-items: center; gap: 2px; }
    .toolbar-spacer { flex: 1 1 auto; }
    .toolbar-separator { width: 1px; height: 20px; margin: 0 3px; background: var(--vscode-panel-border); }
    .toolbar-number { display: inline-flex; align-items: center; height: 26px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; background: var(--vscode-input-background, var(--vscode-editor-background)); }
    .toolbar-number input { box-sizing: border-box; width: 44px; height: 24px; border: 0; outline: 0; padding: 0 3px; background: transparent; color: var(--vscode-input-foreground, var(--vscode-editor-foreground)); font: inherit; text-align: right; -moz-appearance: textfield; }
    .toolbar-number input::-webkit-inner-spin-button, .toolbar-number input::-webkit-outer-spin-button { appearance: none; margin: 0; }
    .toolbar-number span { padding-right: 5px; color: var(--vscode-descriptionForeground); white-space: nowrap; }
    #page-input { width: 36px; }
    #page-total { min-width: 30px; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
    .toolbar-menu { position: fixed; top: 42px; z-index: 60; min-width: 210px; padding: 5px; border: 1px solid var(--vscode-panel-border); border-radius: 5px; background: var(--vscode-editorWidget-background); box-shadow: 0 6px 20px rgba(0,0,0,.4); font: 12px var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
    #display-menu { left: 112px; }
    .toolbar-menu.hidden { display: none; }
    .toolbar-menu .menu-section { padding: 4px 8px 2px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .toolbar-menu button { display: flex; width: 100%; min-height: 26px; align-items: center; border: 0; border-radius: 3px; padding: 3px 8px 3px 24px; background: transparent; color: var(--vscode-editor-foreground); font: inherit; text-align: left; cursor: pointer; }
    .toolbar-menu button:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,.31)); }
    .toolbar-menu button[aria-checked="true"]::before {
      content: '';
      position: absolute;
      width: 8px;
      height: 4px;
      margin: -2px 0 0 -17px;
      border-bottom: 1.5px solid currentColor;
      border-left: 1.5px solid currentColor;
      transform: rotate(-45deg);
    }
    .pdf-search { position: fixed; top: 42px; right: 8px; z-index: 40; box-sizing: border-box; display: grid; grid-template-columns: minmax(128px, 1fr) 24px 24px minmax(44px, max-content) 24px; align-items: center; gap: 2px; width: min(420px, calc(100% - 16px)); min-height: 34px; padding: 4px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, #454545)); border-radius: 3px; background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background, #252526)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground, var(--vscode-editor-foreground, inherit))); box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0,0,0,.36)); font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); font-size: 12px; }
    .pdf-search { top: 44px; grid-template-columns: minmax(128px, 1fr) 24px 24px 24px 24px minmax(44px, max-content) 24px; }
    .pdf-search.hidden { display: none; }
    .pdf-search input { box-sizing: border-box; width: 100%; height: 26px; min-width: 0; margin: 0; padding: 2px 6px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; outline: 0; background: var(--vscode-input-background, var(--vscode-editor-background)); color: var(--vscode-input-foreground, var(--vscode-editor-foreground)); font: inherit; }
    .pdf-search input:focus { border-color: var(--vscode-focusBorder, var(--vscode-inputOption-activeBorder, #007fd4)); }
    .pdf-search button { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; min-width: 24px; margin: 0; padding: 0; border: 1px solid transparent; border-radius: 3px; appearance: none; -webkit-appearance: none; background: transparent; background-image: none; box-shadow: none; color: var(--vscode-icon-foreground, var(--vscode-foreground, var(--vscode-editor-foreground, inherit))); font: inherit; line-height: 1; white-space: nowrap; cursor: pointer; }
    .pdf-search button:hover { background-color: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,.31)); }
    .pdf-search button:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: -1px; }
    .pdf-search .count { min-width: 44px; padding: 0 4px; color: var(--vscode-descriptionForeground, var(--vscode-editor-foreground)); text-align: center; white-space: nowrap; }
    .pdf-search-settings-menu { position: absolute; top: 34px; right: 48px; z-index: 45; display: flex; min-width: 168px; flex-direction: column; gap: 2px; padding: 5px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 4px; background: var(--vscode-editorWidget-background); box-shadow: 0 4px 14px rgba(0,0,0,.4); }
    .pdf-search-settings-menu.hidden { display: none; }
    .pdf-search-settings-menu label { display: flex; min-height: 24px; align-items: center; gap: 8px; padding: 2px 7px; border-radius: 3px; white-space: nowrap; cursor: pointer; }
    .pdf-search-settings-menu label:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,.31)); }
    .pdf-search .pdf-search-settings-menu input { width: 14px; min-width: 14px; height: 14px; margin: 0; padding: 0; border: 0; appearance: auto; accent-color: var(--vscode-focusBorder); }
    #viewer-shell { position: relative; display: flex; height: calc(100% - 38px); min-height: 0; }
    #pdf-reader-layout > #viewer-shell { width: 100%; height: 100%; min-width: 0; min-height: 0; }
    #pdf-reader-layout[data-toolbar-dock="top"] > #toolbar { grid-area: 1 / 1; width: 100%; }
    #pdf-reader-layout[data-toolbar-dock="top"] > #viewer-shell { grid-area: 2 / 1; }
    #pdf-reader-layout[data-toolbar-dock="left"] > #toolbar {
      grid-area: 1 / 1;
      width: 48px;
      height: 100%;
      min-height: 0;
      flex-direction: column;
      align-items: stretch;
      overflow-x: hidden;
      overflow-y: auto;
      padding: 6px 3px;
      border-right: 1px solid var(--vscode-panel-border);
      border-bottom: 0;
    }
    #pdf-reader-layout[data-toolbar-dock="left"] > #viewer-shell { grid-area: 1 / 2; }
    #pdf-reader-layout[data-toolbar-dock="left"] .toolbar-group { flex-direction: column; align-items: stretch; }
    #pdf-reader-layout[data-toolbar-dock="left"] .toolbar-separator { width: auto; height: 1px; margin: 3px 0; }
    #pdf-reader-layout[data-toolbar-dock="left"] .toolbar-number { box-sizing: border-box; width: 100%; height: auto; flex-direction: column; align-items: stretch; padding: 1px 0 2px; }
    #pdf-reader-layout[data-toolbar-dock="left"] .toolbar-number input { width: 100%; text-align: center; }
    #pdf-reader-layout[data-toolbar-dock="left"] .toolbar-number span { padding: 0 2px; text-align: center; }
    #pdf-reader-layout[data-toolbar-dock="left"] #toolbar button { width: 100%; }
    .pdf-toolbar-drop-target { position: absolute; z-index: 90; display: none; pointer-events: none; box-sizing: border-box; border: 2px solid transparent; background: transparent; }
    #pdf-reader-layout[data-toolbar-dragging="true"] > .pdf-toolbar-drop-target { display: block; }
    .pdf-toolbar-drop-target[data-dock="top"] { top: 0; right: 0; left: 0; height: 72px; }
    .pdf-toolbar-drop-target[data-dock="left"] { top: 0; bottom: 0; left: 0; width: 72px; }
    .pdf-toolbar-drop-target[data-active="true"] { border-color: var(--vscode-focusBorder, #007fd4); background: color-mix(in srgb, var(--vscode-focusBorder, #007fd4) 18%, transparent); }
    #pdf-sidebar { box-sizing: border-box; flex: 0 0 240px; width: 240px; border-right: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); color: var(--vscode-editor-foreground); }
    #pdf-sidebar[hidden] { display: none; }
    .pdf-sidebar-header { box-sizing: border-box; display: flex; height: 38px; align-items: stretch; justify-content: space-between; gap: 4px; padding: 0 6px 0 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    .pdf-sidebar-tabs { display: flex; min-width: 0; align-items: stretch; gap: 2px; }
    .pdf-sidebar-tab { position: relative; min-width: 0; border: 0; padding: 0 8px; background: transparent; color: var(--vscode-descriptionForeground); font: 12px var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); cursor: pointer; }
    .pdf-sidebar-tab:hover { color: var(--vscode-editor-foreground); background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,.22)); }
    .pdf-sidebar-tab[aria-selected="true"] { color: var(--vscode-editor-foreground); }
    .pdf-sidebar-tab[aria-selected="true"]::after { content: ""; position: absolute; right: 5px; bottom: 0; left: 5px; height: 2px; background: var(--vscode-focusBorder); }
    .pdf-sidebar-tab:focus-visible, #close-sidebar:focus-visible, .pdf-outline-row:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    #close-sidebar { align-self: center; width: 24px; height: 24px; border: 0; border-radius: 3px; background: transparent; color: inherit; cursor: pointer; }
    #close-sidebar:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,.22)); }
    #thumbnail-list, #outline-list { box-sizing: border-box; height: calc(100% - 38px); overflow: auto; }
    #thumbnail-list[hidden], #outline-list[hidden] { display: none; }
    #thumbnail-list { padding: 10px 8px; }
    #outline-list { padding: 6px 4px 14px; font: 12px var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
    .pdf-outline-empty { margin: 10px 8px; color: var(--vscode-descriptionForeground); }
    .pdf-outline-kind { margin: 8px; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 600; }
    .pdf-outline-tree { margin: 0; padding: 0; list-style: none; }
    .pdf-outline-tree .pdf-outline-tree { padding-left: 12px; }
    .pdf-outline-row { box-sizing: border-box; display: flex; width: 100%; min-height: 26px; align-items: center; gap: 8px; border: 0; border-radius: 3px; padding: 4px 7px; background: transparent; color: var(--vscode-editor-foreground); font: inherit; text-align: left; cursor: pointer; }
    .pdf-outline-row:hover { background: var(--vscode-list-hoverBackground, rgba(90,93,94,.22)); }
    .pdf-outline-group { color: var(--vscode-descriptionForeground); cursor: default; }
    .pdf-outline-group:hover { background: transparent; }
    .pdf-outline-label { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pdf-outline-page { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
    .pdf-thumbnail { display: flex; width: 100%; flex-direction: column; align-items: center; gap: 5px; margin: 0 0 10px; border: 1px solid transparent; border-radius: 4px; padding: 6px; background: transparent; color: var(--vscode-editor-foreground); cursor: pointer; }
    .pdf-thumbnail:hover { background: var(--vscode-list-hoverBackground, rgba(90,93,94,.22)); }
    .pdf-thumbnail[aria-current="page"] { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground, rgba(0,127,212,.16)); }
    .pdf-thumbnail canvas { display: block; width: 116px; max-height: 156px; background: white; box-shadow: 0 1px 5px rgba(0,0,0,.4); }
    body.vscode-dark.pdf-adapt-theme .pdf-canvas,
    body.vscode-dark.pdf-adapt-theme .pdf-thumbnail canvas,
    body.vscode-high-contrast.pdf-adapt-theme .pdf-canvas,
    body.vscode-high-contrast.pdf-adapt-theme .pdf-thumbnail canvas {
      filter: invert(.9) hue-rotate(180deg);
    }
    .pdf-thumbnail span { font: 11px var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
    #viewer-container { flex: 1 1 auto; min-width: 0; height: 100%; overflow: auto; outline: none; background: #303030; }
    body.pdf-adapt-theme #viewer-container { background: #303030; }
    #pdf-history-back {
      position: absolute;
      z-index: 35;
      left: 14px;
      bottom: 14px;
      box-sizing: border-box;
      display: inline-flex;
      width: 32px;
      height: 32px;
      align-items: center;
      justify-content: center;
      margin: 0;
      padding: 0;
      border: 1px solid var(--vscode-contrastBorder, var(--vscode-widget-border, var(--vscode-panel-border, #454545)));
      border-radius: 5px;
      appearance: none;
      -webkit-appearance: none;
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ffffff);
      box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0,0,0,.38));
      cursor: pointer;
      transition: left 120ms ease, background-color 80ms ease, border-color 80ms ease;
    }
    #pdf-history-back[hidden] { display: none; }
    #pdf-sidebar:not([hidden]) ~ #pdf-history-back { left: 254px; }
    #pdf-history-back:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
    #pdf-history-back:active {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
      box-shadow: inset 0 1px 2px rgba(0,0,0,.35);
    }
    #pdf-history-back:focus-visible { outline: 2px solid var(--vscode-focusBorder, #007fd4); outline-offset: 2px; }
    #pdf-history-back svg { display: block; pointer-events: none; }
    body[data-reduce-animation="on"] #pdf-history-back { transition: none; }
    @media (prefers-reduced-motion: reduce) {
      body[data-reduce-animation="system"] #pdf-history-back { transition: none; }
    }
    @media (forced-colors: active) {
      #pdf-history-back {
        border-color: ButtonText;
        background: ButtonFace;
        color: ButtonText;
        box-shadow: none;
        forced-color-adjust: none;
      }
      #pdf-history-back:hover,
      #pdf-history-back:active {
        border-color: Highlight;
        background: Highlight;
        color: HighlightText;
      }
    }
    #page-container { display: flex; flex-direction: column; align-items: safe center; gap: 12px; padding: 12px; }
    #page-container.scroll-horizontal { width: max-content; min-width: 100%; min-height: 100%; flex-direction: row; align-items: flex-start; }
    #page-container.scroll-wrapped { min-height: 100%; flex-flow: row wrap; align-items: flex-start; justify-content: center; }
    #page-container.two-page { display: grid; grid-template-columns: repeat(2, max-content); align-items: start; justify-content: safe center; }
    #page-container.two-page.paginated { gap: 0; }
    #page-container.paginated { min-height: calc(100% - 76px); padding: 38px 12px; justify-content: safe center; align-content: safe center; }
    .page-wrapper { position: relative; background: white; box-shadow: 0 1px 8px rgba(0,0,0,.24); cursor: crosshair; }
    .page-wrapper.pdf-text-selection-intent { cursor: text; }
    .page-wrapper.page-turn-staging { position: absolute; opacity: 0; pointer-events: none; will-change: opacity; }
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
    .pdf-link-overlay {
      position: absolute;
      z-index: 4;
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 1px;
      appearance: none;
      -webkit-appearance: none;
      background: transparent;
      color: transparent;
      overflow: visible;
      pointer-events: none;
    }
    .text-layer .pdf-link-hit-fragment {
      position: absolute;
      box-sizing: border-box;
      border-radius: 1px;
      background: transparent;
      cursor: pointer;
      pointer-events: auto;
      touch-action: manipulation;
    }
    .text-layer .pdf-link-hit-fragment:hover { background: rgba(77, 171, 247, .10); }
    .pdf-link-overlay:focus-visible { outline: none; }
    .pdf-link-overlay:focus-visible .pdf-link-hit-fragment {
      outline: 1px solid var(--vscode-focusBorder, #4dabf7);
      outline-offset: 1px;
      background: rgba(77, 171, 247, .08);
    }
    .pdf-link-preview {
      position: fixed;
      z-index: 100;
      box-sizing: border-box;
      width: min(380px, calc(100vw - 16px));
      max-height: min(260px, calc(100vh - 16px));
      overflow: hidden;
      padding: 10px 12px;
      border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-widget-border, var(--vscode-panel-border)));
      border-radius: 6px;
      color: var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground));
      background: var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
      box-shadow: 0 4px 14px var(--vscode-widget-shadow, rgba(0,0,0,.32));
      font: 13px/1.42 var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      overflow-wrap: anywhere;
      pointer-events: none;
    }
    .pdf-link-preview-title { font-weight: 600; }
    .pdf-link-preview-page { margin-top: 3px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .pdf-link-preview-excerpt {
      display: -webkit-box;
      margin-top: 7px;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 8;
    }
    .text-layer .pdf-text-selection-separator {
      left: 100%;
      top: 0;
      width: max-content;
      height: 1px;
      overflow: visible;
      font-size: 1px;
      line-height: 1px;
      pointer-events: none;
    }
    .text-layer span::selection { background: transparent; }
    .highlight-layer { right: 0; bottom: 0; pointer-events: none; }
    .pdf-selection-rect {
      position: absolute;
      z-index: 14;
      box-sizing: border-box;
      border-radius: 0;
      background: rgba(0, 122, 255, .22);
      outline: none;
      pointer-events: none;
    }
    .pdf-area-selection {
      position: absolute;
      z-index: 14;
      box-sizing: border-box;
      border: 1px solid var(--vscode-focusBorder);
      background: rgba(0, 127, 212, .16);
      pointer-events: none;
    }
    .rectangle-selection-overlay { position: absolute; z-index: 15; box-sizing: border-box; border: 1px dashed var(--vscode-focusBorder); background: rgba(0, 127, 212, .16); pointer-events: none; }
    .anchor-highlight { position: absolute; background: rgba(0, 150, 255, .35); border-radius: 2px; pointer-events: none; }
    .pdf-query-highlight { position: absolute; box-sizing: border-box; border-bottom: 2px solid var(--vscode-editorInfo-foreground, #4daafc); background: color-mix(in srgb, var(--vscode-editorInfo-foreground, #4daafc) 18%, transparent); border-radius: 2px; pointer-events: none; }
    .pdf-query-marker { position: absolute; z-index: 8; padding: 1px 6px; border: 1px solid var(--vscode-widget-border); border-radius: 9px; color: var(--vscode-textLink-foreground); background: var(--vscode-editorWidget-background); font: 11px var(--vscode-font-family); white-space: nowrap; cursor: pointer; pointer-events: auto; }
    .pdf-query-popover { position: fixed; z-index: 1200; box-sizing: border-box; width: min(380px, calc(100vw - 16px)); max-height: min(280px, calc(100vh - 16px)); padding: 10px 12px; overflow: auto; border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-widget-border)); border-radius: 6px; color: var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground)); background: var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background)); box-shadow: 0 4px 14px var(--vscode-widget-shadow, rgba(0,0,0,.3)); font: 13px/1.45 var(--vscode-font-family); }
    .pdf-query-popover[hidden] { display: none; }
    .pdf-query-popover-item + .pdf-query-popover-item { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--vscode-widget-border); }
    .pdf-query-popover-meta { margin-top: 2px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .pdf-query-popover-summary { margin: 6px 0; }
    .pdf-query-popover button { padding: 3px 8px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    .pdf-destination-focus {
      position: absolute;
      z-index: 13;
      box-sizing: border-box;
      border: 1px solid rgba(77, 171, 247, .38);
      border-radius: 4px;
      background: rgba(77, 171, 247, .12);
      box-shadow: 0 0 0 2px rgba(77, 171, 247, .05);
      pointer-events: none;
    }
    .pdf-destination-focus.animate { animation: pdf-destination-focus-fade 2400ms ease-out forwards; }
    @keyframes pdf-destination-focus-fade {
      0%, 72% { opacity: 1; }
      100% { opacity: 0; }
    }
    .pdf-search-match { position: absolute; border-radius: 2px; background: rgba(255, 214, 10, .40); outline: 1px solid rgba(255, 214, 10, .55); pointer-events: none; }
    .pdf-search-match.selected { background: rgba(177, 151, 252, .48); outline-color: rgba(177, 151, 252, .9); }
    .selection-toolbar { position: absolute; transform: translateX(-50%); z-index: 20; display: flex; box-sizing: border-box; width: max-content; max-width: calc(100vw - 24px); flex-wrap: nowrap; align-items: center; justify-content: flex-start; gap: 1px; overflow-x: auto; overflow-y: hidden; padding: 3px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editorWidget-background); box-shadow: 0 4px 14px var(--vscode-widget-shadow, rgba(0,0,0,.32)); scrollbar-width: none; font: 12px var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
    .selection-toolbar::-webkit-scrollbar { display: none; }
    .selection-toolbar button { flex: 0 0 auto; min-height: 26px; border: 0; border-radius: 5px; padding: 0 8px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font: inherit; white-space: nowrap; cursor: pointer; }
    .selection-toolbar button:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
    .selection-toolbar button:focus-visible { outline: 2px solid var(--vscode-focusBorder, #007fd4); outline-offset: 1px; }
    .selection-toolbar .secondary { background: transparent; color: var(--vscode-editorWidget-foreground, var(--vscode-foreground, var(--vscode-editor-foreground))); }
    .selection-toolbar .secondary:hover { background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.16)); }
    .selection-toolbar .selection-toolbar-separator { flex: 0 0 auto; width: 1px; height: 15px; margin: 0 1px; background: var(--vscode-panel-border); }
    .selection-toolbar .cursor-chat-action { display: inline-flex; align-items: center; gap: 5px; }
    .selection-toolbar .cursor-chat-action .add-to-chat-shortcut { display: inline-flex; align-items: center; height: 16px; padding: 0 3px; border: 0; border-radius: 3px; background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.16)); color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground, inherit)); font: 10px var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
    .error { padding: 24px; color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
  <div id="toolbar" role="toolbar" aria-label="PDF toolbar">
    <button id="toggle-sidebar" type="button" aria-label="Toggle sidebar" aria-controls="pdf-sidebar" aria-expanded="false">▤</button>
    <button id="search-open" type="button" aria-label="Search" title="Search">⌕</button>
    <span class="toolbar-separator"></span>
    <div class="toolbar-group" aria-label="Zoom controls">
      <button id="zoom-out" type="button" aria-label="Zoom out">−</button>
      <label class="toolbar-number"><input id="zoom-input" type="number" min="10" max="350" step="5" value="100" aria-label="Zoom"><span>%</span></label>
      <button id="zoom-in" type="button" aria-label="Zoom in">+</button>
      <button id="display-menu-button" type="button" aria-label="Display options" aria-controls="display-menu" aria-haspopup="menu" aria-expanded="false">⌄</button>
    </div>
    <span class="toolbar-separator"></span>
    <div class="toolbar-group" aria-label="Page controls">
      <button id="prev" type="button" aria-label="Previous page">‹</button>
      <label class="toolbar-number"><input id="page-input" type="number" min="1" step="1" value="1" aria-label="Page"><span id="page-total">of 0</span></label>
      <button id="next" type="button" aria-label="Next page">›</button>
    </div>
    <span class="toolbar-spacer"></span>
    <span id="page-info" class="sr-only" aria-live="polite"></span>
  </div>
  <div id="display-menu" class="toolbar-menu hidden" role="menu" aria-label="Display options">
    <div class="menu-section">View</div>
    <button type="button" role="menuitemradio" aria-checked="false" data-display-action="presentation-single">Single Page</button>
    <button type="button" role="menuitemradio" aria-checked="true" data-display-action="presentation-single-continuous">Single Page Continuous</button>
    <button type="button" role="menuitemradio" aria-checked="false" data-display-action="presentation-two">Two Pages</button>
    <button type="button" role="menuitemradio" aria-checked="false" data-display-action="presentation-two-continuous">Two Pages Continuous</button>
    <div class="menu-section">Fit</div>
    <button type="button" role="menuitemradio" aria-checked="false" data-display-action="fit-width">Fit width</button>
    <button type="button" role="menuitemradio" aria-checked="false" data-display-action="fit-height">Fit height</button>
    <button type="button" role="menuitemradio" aria-checked="false" data-display-action="fit-page">Fit page</button>
    <div class="menu-section">Appearance</div>
    <button type="button" role="menuitemcheckbox" aria-checked="false" data-display-action="adapt-theme">Adapt to theme</button>
    <div class="menu-section">Reduce Animation</div>
    <button type="button" role="menuitemradio" aria-checked="false" data-display-action="reduce-animation-on">On</button>
    <button type="button" role="menuitemradio" aria-checked="false" data-display-action="reduce-animation-off">Off</button>
    <button type="button" role="menuitemradio" aria-checked="true" data-display-action="reduce-animation-system">System</button>
    <button type="button" role="menuitem" data-display-action="defaults">Defaults</button>
  </div>
  <div id="pdf-search" class="pdf-search hidden" role="search" aria-label="Find in PDF">
    <input id="pdf-search-input" type="search" placeholder="Find" aria-label="Find in PDF" autocomplete="off">
    <button id="pdf-search-case" type="button" title="Match case" aria-label="Match case" aria-pressed="false">Aa</button>
    <button id="pdf-search-settings" type="button" title="Search settings" aria-label="Search settings" aria-controls="pdf-search-settings-menu" aria-haspopup="menu" aria-expanded="false">⋮</button>
    <button id="pdf-search-prev" type="button" title="Previous match" aria-label="Previous match">↑</button>
    <button id="pdf-search-next" type="button" title="Next match" aria-label="Next match">↓</button>
    <span id="pdf-search-count" class="count" aria-live="polite"></span>
    <button id="pdf-search-close" type="button" title="Close search" aria-label="Close search">×</button>
    <div id="pdf-search-settings-menu" class="pdf-search-settings-menu hidden" role="menu" aria-label="Search settings">
      <label><input type="checkbox" data-search-setting="highlight-all">Highlight all</label>
      <label><input type="checkbox" data-search-setting="match-diacritics">Match diacritics</label>
      <label><input type="checkbox" data-search-setting="whole-words">Whole words</label>
    </div>
  </div>
  <div id="viewer-shell">
    <aside id="pdf-sidebar" aria-label="PDF navigation" hidden>
      <div class="pdf-sidebar-header">
        <div class="pdf-sidebar-tabs" role="tablist" aria-label="PDF navigation">
          <button id="sidebar-thumbnails-tab" class="pdf-sidebar-tab" type="button" role="tab" aria-controls="thumbnail-list" aria-selected="true">Pages</button>
          <button id="sidebar-outline-tab" class="pdf-sidebar-tab" type="button" role="tab" aria-controls="outline-list" aria-selected="false" tabindex="-1">Outline</button>
        </div>
        <button id="close-sidebar" type="button" aria-label="Close sidebar">×</button>
      </div>
      <div id="thumbnail-list" role="tabpanel" aria-labelledby="sidebar-thumbnails-tab"></div>
      <div id="outline-list" role="tabpanel" aria-labelledby="sidebar-outline-tab" hidden></div>
    </aside>
    <div id="viewer-container"><div id="page-container"></div></div>
    <button id="pdf-history-back" type="button" title="Go back to previous PDF location" aria-label="Go back to previous PDF location" hidden>
      <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16">
        <path d="M8.5 3 3.5 8l5 5M4 8h8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>
  <script nonce="${nonce}">
    window.__pdfiumWasmUrl = "${wasmUri.toString()}";
  </script>
  <script nonce="${nonce}" src="${scriptUri.toString()}?v=${nonce}"></script>
</body>
</html>`;
  }
}

function normalizePdfToolbarPreference(
  value: unknown,
  fallback: PdfToolbarPreference = DEFAULT_PDF_TOOLBAR_PREFERENCE,
): PdfToolbarPreference {
  const base = validPdfToolbarPreference(fallback)
    ? fallback
    : DEFAULT_PDF_TOOLBAR_PREFERENCE;
  if (!validPdfToolbarPreference(value)) return { ...base };
  return {
    dock: value.dock,
    hidden: value.hidden,
  };
}

function validPdfToolbarPreference(value: unknown): value is PdfToolbarPreference {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PdfToolbarPreference>;
  return (record.dock === 'top' || record.dock === 'left')
    && typeof record.hidden === 'boolean';
}

function normalizePdfSelectionAnchor(anchor: unknown): PdfSelectionAnchor | undefined {
  if (!anchor || typeof anchor !== 'object') return undefined;
  const raw = anchor as Record<string, unknown>;
  // Cross-page selections are valid for Preview-style reading and copying,
  // but the portable annotation/link schema is deliberately single-page.
  if (raw.multiPage === true) return undefined;
  const snippet = typeof raw.snippet === 'string' ? raw.snippet.replace(/\s+/g, ' ').trim() : '';
  const page = numberValue(raw.page);
  if (!snippet || !page) return undefined;

  return {
    id: typeof raw.id === 'string' ? raw.id : undefined,
    area: raw.area === true ? true : undefined,
    page,
    textItemIndex: numberValue(raw.textItemIndex),
    charOffset: numberValue(raw.charOffset),
    endTextItemIndex: numberValue(raw.endTextItemIndex),
    endCharOffset: numberValue(raw.endCharOffset),
    length: numberValue(raw.length),
    rects: normalizePdfRects(raw.rects),
    prefix: normalizePdfMessageText(raw.prefix),
    suffix: normalizePdfMessageText(raw.suffix),
    snippet,
  };
}

function pdfViewRectForSelection(selection: PdfSelectionAnchor): PdfViewRect | undefined {
  const rects = normalizePdfRects(selection.rects);
  if (!rects?.length) return undefined;
  const left = Math.min(...rects.map(rect => rect[0]!));
  const top = Math.min(...rects.map(rect => rect[1]!));
  const right = Math.max(...rects.map(rect => rect[2]!));
  const bottom = Math.max(...rects.map(rect => rect[3]!));
  if (right <= left || bottom <= top) return undefined;
  return { left, top, width: right - left, height: bottom - top };
}

function normalizePdfAgentClipboardSelection(
  input: unknown,
): { selection: PdfAgentClipboardSelection; selectionKey: string } | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  const candidate = {
    kind: raw.kind,
    startPage: raw.startPage,
    endPage: raw.endPage,
    pages: raw.pages,
    ...(raw.kind === 'text'
      ? { selectedText: normalizePdfMessageText(raw.selectedText) }
      : {}),
  } as unknown as PdfAgentClipboardSelection;
  const selectionKey = pdfAgentClipboardSelectionKey(candidate);
  if (!selectionKey) return undefined;
  return {
    selection: JSON.parse(selectionKey) as PdfAgentClipboardSelection,
    selectionKey,
  };
}

function pdfTextFragmentForSelection(selection: PdfSelectionAnchor): PdfTextFragment {
  return {
    textStart: selection.snippet,
    ...(selection.prefix ? { prefix: selection.prefix } : {}),
    ...(selection.suffix ? { suffix: selection.suffix } : {}),
  };
}

function normalizePdfRects(value: unknown): number[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rects = value.flatMap(rect => {
    if (!Array.isArray(rect) || rect.length !== 4) return [];
    const normalized = rect.map(numberValue);
    return normalized.every(coordinate => coordinate !== undefined)
      ? [normalized]
      : [];
  });
  return rects.length > 0 ? rects : undefined;
}

export function normalizePdfOutlineDestination(value: unknown): PdfOutlineDestination | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const pageIndex = raw.pageIndex;
  const rawZoom = raw.zoom;
  const rawView = raw.view;
  if (
    typeof pageIndex !== 'number'
    || !Number.isSafeInteger(pageIndex)
    || pageIndex < 0
    || !rawZoom
    || typeof rawZoom !== 'object'
    || !Array.isArray(rawView)
    || rawView.length > 8
  ) {
    return undefined;
  }

  const zoomRecord = rawZoom as Record<string, unknown>;
  const mode = zoomRecord.mode;
  if (typeof mode !== 'number' || !Number.isSafeInteger(mode) || mode < 0 || mode > 8) {
    return undefined;
  }
  const view = rawView.map(numberValue);
  if (view.some(coordinate => coordinate === undefined)) return undefined;

  if (mode === 1) {
    const rawParams = zoomRecord.params;
    if (!rawParams || typeof rawParams !== 'object') return undefined;
    const paramsRecord = rawParams as Record<string, unknown>;
    const x = numberValue(paramsRecord.x);
    const y = numberValue(paramsRecord.y);
    const zoom = numberValue(paramsRecord.zoom);
    if (x === undefined || y === undefined || zoom === undefined) return undefined;
    return {
      pageIndex,
      zoom: { mode, params: { x, y, zoom } },
      view: view as number[],
    };
  }

  return {
    pageIndex,
    zoom: { mode },
    view: view as number[],
  };
}

export function normalizePdfOutlineEntries(value: unknown): PdfOutlineEntry[] {
  if (!Array.isArray(value)) return [];
  const maxDepth = 32;
  const maxEntries = 10_000;
  let count = 0;

  const visit = (rawItems: unknown[], depth: number): PdfOutlineEntry[] => {
    if (depth >= maxDepth || count >= maxEntries) return [];
    const items: PdfOutlineEntry[] = [];
    for (const rawItem of rawItems) {
      if (count >= maxEntries) break;
      count += 1;
      if (!rawItem || typeof rawItem !== 'object') continue;
      const record = rawItem as Record<string, unknown>;
      const title = normalizePdfOutlineTitle(record.title);
      if (!title) continue;
      const destination = normalizePdfOutlineDestination(record.destination);
      const children = Array.isArray(record.children)
        ? visit(record.children, depth + 1)
        : [];
      items.push({
        title,
        ...(destination ? { destination } : {}),
        children,
      });
    }
    return items;
  };

  return visit(value, 0);
}

function normalizePdfOutlineTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const title = value
    .slice(0, 2_000)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  return title || undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizePdfMessageText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function normalizeLookupText(value: unknown): string | undefined {
  return normalizePdfMessageText(value)?.slice(0, 200);
}

function normalizePdfPage(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function isPdfSelectionAction(value: unknown): value is PdfSelectionAction {
  return value === 'addToCursorChat';
}

function isExternalAgentId(value: unknown): value is ExternalAgentId {
  return value === 'codex' || value === 'claude' || value === 'codebuddy';
}

function resolvePdfTargetPath(documentRoot: string, pdfPath: string): string | undefined {
  if (path.isAbsolute(pdfPath)) return pdfPath;
  const root = path.resolve(documentRoot);
  const candidate = path.resolve(root, pdfPath);
  const fromRoot = path.relative(root, candidate);
  if (
    fromRoot === '..'
    || fromRoot.startsWith(`..${path.sep}`)
    || path.isAbsolute(fromRoot)
  ) return undefined;
  return candidate;
}

export function formatPdfPageLink(relPath: string, page: number): string {
  const normalizedPage = normalizePdfPage(page);
  if (!normalizedPage) throw new Error('PDF page links require a positive integer page number');
  const normalizedPath = relPath.replace(/\\/g, '/');
  const fileName = path.posix.basename(normalizedPath) || 'PDF';
  const basename = fileName.replace(/\.pdf$/i, '') || fileName;
  return `[[${normalizedPath}#page=${normalizedPage}|${basename}, p.${normalizedPage}]]`;
}

export function formatPdfRectangleEmbed(relPath: string, page: number, rect: readonly number[]): string {
  const normalizedRect = normalizePdfRects([rect])?.[0];
  if (!normalizedRect) throw new Error('PDF rectangle geometry must contain four finite coordinates');
  const normalizedPath = relPath.replace(/\\/g, '/');
  const fileName = path.posix.basename(normalizedPath) || 'PDF';
  const basename = fileName.replace(/\.pdf$/i, '') || fileName;
  return `![[${normalizedPath}#page=${page}&rect=${normalizedRect.join(',')}|${basename}, p.${page}]]`;
}
