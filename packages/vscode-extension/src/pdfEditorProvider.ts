import * as vscode from 'vscode';
import * as path from 'path';
import { createHash } from 'node:crypto';
import {
  pdfHref,
  pdfWebviewToHostMessage,
  type PdfTextFragment,
  type PdfViewRect,
} from '@llm-wiki/core';
import type {
  AgentSurfaceCapabilities,
} from './agentHandoff';
import {
  agentHandoffCapabilitiesMessage,
  lookupSelectionInDictionary,
  queryNavigationPath,
} from './editorHost';
import type { SelectionContext } from './selectionContext';
import { resolvePdfAnchor, type QueryAnnotationIndex } from './queryAnnotationIndex';
import {
  createPdfAgentClipboardContext,
  pdfAgentClipboardSelectionKey,
  type PdfAgentClipboardContext,
  type PdfAgentClipboardSelection,
} from './agentClipboard';
import { pdfWebviewHtml } from './pdfWebviewHtml';

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
  generation: number;
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

export class PdfEditorProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = 'llm-wiki.pdfViewer';

  private readonly webviews = new Map<string, ActivePdfWebview>();
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

  constructor(
    private readonly context: vscode.ExtensionContext,
    options: PdfEditorProviderOptions = {},
  ) {
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
    if (!active?.agentClipboardContext) return false;
    return this.copyPdfAgentClipboardText(active.agentClipboardContext);
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
    if (!path.isAbsolute(pdfPath)) {
      vscode.window.showErrorMessage(`Cannot open unresolved PDF path: ${pdfPath}`);
      return;
    }
    const pdfUri = vscode.Uri.file(pdfPath);
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
      generation: 0,
      postMessage: (message: unknown) => {
        void webview.postMessage(message);
      },
    };
    this.webviews.set(key, active);
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => {
      if (this.webviews.get(key) !== active) return;
      active.generation += 1;
      active.ready = false;
      active.pdfBytes = undefined;
      active.pdfSha256 = undefined;
      active.selection = undefined;
      active.agentClipboardContext = undefined;
      active.outline = undefined;
      active.outlineInferred = false;
      active.outlineLoading = true;
      this.queryDiagnostics?.delete(pdfUri);
      this.firePdfOutlineChanged(pdfUri);
      if (this.activeKey === key) {
        void vscode.commands.executeCommand('setContext', 'llmWikiPdfHasSelection', false);
        void vscode.commands.executeCommand('setContext', 'llmWikiPdfHasAgentClipboardSelection', false);
      }
      webview.html = pdfWebviewHtml(webview, this.context.extensionUri);
    };
    const scheduleReload = () => {
      if (reloadTimer !== undefined) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadTimer = undefined;
        reload();
      }, 100);
    };
    const createWatcher = vscode.workspace.createFileSystemWatcher;
    const watcher = pdfUri.scheme === 'file'
      && typeof createWatcher === 'function'
      && typeof vscode.RelativePattern === 'function'
      ? createWatcher.call(
          vscode.workspace,
          new vscode.RelativePattern(
            vscode.Uri.file(path.dirname(pdfUri.fsPath)),
            path.basename(pdfUri.fsPath),
          ),
        )
      : undefined;
    watcher?.onDidChange(scheduleReload);
    watcher?.onDidCreate(scheduleReload);
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

    webview.onDidReceiveMessage(async (rawMessage: unknown) => {
      const message = pdfWebviewToHostMessage(rawMessage);
      if (!message) return;
      switch (message.type) {
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
        case 'copySelectionForAgent': {
          await this.copySelectionForAgent();
          break;
        }
        case 'lookupSelection':
          await lookupSelectionInDictionary(message.text);
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
          const queryPath = queryNavigationPath(message.navigation);
          if (!queryPath) break;
          await vscode.commands.executeCommand(
            'llm-wiki.openLinkTarget',
            queryPath,
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
          vscode.window.showErrorMessage(`LLM Wiki PDF: ${String(message.message)}`);
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
      active.generation += 1;
      if (reloadTimer !== undefined) clearTimeout(reloadTimer);
      watcher?.dispose();
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

    webview.html = pdfWebviewHtml(webview, this.context.extensionUri);
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
    const generation = active.generation;
    try {
      const bytes = await vscode.workspace.fs.readFile(active.pdfUri);
      if (
        active.generation !== generation
        || this.webviews.get(active.pdfUri.toString()) !== active
      ) return;
      active.pdfBytes = bytes;
      active.pdfSha256 = createHash('sha256').update(bytes).digest('hex');
      active.postMessage({
        type: 'loadPdf',
        data: pdfTransferBuffer(bytes),
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
    void webview.postMessage(agentHandoffCapabilitiesMessage(this.agentCapabilities()));
  }

  private broadcastAgentHandoffCapabilities(): void {
    const message = agentHandoffCapabilitiesMessage(this.agentCapabilities());
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

  private async handleSelectionAction(
    pdfUri: vscode.Uri,
    action: unknown,
    anchor: unknown,
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

  private async copyPdfAgentClipboardText(
    context: PdfAgentClipboardContext,
  ): Promise<boolean> {
    try {
      await vscode.env.clipboard.writeText(context.plainText);
      vscode.window.showInformationMessage('Selection copied for agent.');
      return true;
    } catch {
      vscode.window.showErrorMessage('The selection could not be copied.');
      return false;
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

function pdfTransferBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer
    && bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength
  ) return bytes.buffer;
  return Uint8Array.from(bytes).buffer;
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

function normalizePdfPage(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function isPdfSelectionAction(value: unknown): value is PdfSelectionAction {
  return value === 'addToCursorChat';
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
