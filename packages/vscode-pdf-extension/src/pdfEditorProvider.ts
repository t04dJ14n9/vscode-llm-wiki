import * as vscode from 'vscode';
import * as path from 'path';
import { statSync } from 'fs';
import {
  closeDatabase,
  createPdfAnchorFromSelection,
  openDatabase,
  pdfHref,
  runMigrations,
  type PdfDiscussionAnchorV1,
  type PdfDiscussionAnnotationV1,
  type PdfDiscussionStore,
  type PdfTextFragment,
} from '@human-learning/core';
import {
  createPdfDiscussionStoreForDocument,
  PDF_DISCUSSION_MAX_PNG_BYTES,
  PDF_DISCUSSION_MAX_QUESTION_BYTES,
  type PdfDiscussionController,
  type PdfDiscussionControllerEvent,
} from './pdfDiscussionController';
import type {
  PdfDiscussionAnnotationSnapshot,
  PdfDiscussionHostToWebviewMessage,
  PdfDiscussionWebviewToHostMessage,
} from './pdfDiscussionProtocol';
import type { SelectionContext } from './selectionContext';

interface PdfSelectionAnchor {
  id?: string;
  page: number;
  textItemIndex?: number;
  charOffset?: number;
  endTextItemIndex?: number;
  endCharOffset?: number;
  length?: number;
  rects?: number[][];
  highlightColor?: PdfHighlightColor;
  prefix?: string;
  suffix?: string;
  snippet: string;
}

type PdfHighlightColor = 'yellow' | 'red' | 'green' | 'purple';

const PDF_HIGHLIGHT_COLORS = new Set<PdfHighlightColor>([
  'yellow',
  'red',
  'green',
  'purple',
]);

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
  selection?: PdfSelectionAnchor;
  postMessage(message: unknown): void;
}

interface MarkdownInsertTarget {
  insertMarkdown(markdown: string): Promise<boolean>;
}

interface CachedPdfDiscussionStore {
  store: PdfDiscussionStore;
  fingerprint?: PdfFileFingerprint;
}

interface PdfFileFingerprint {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  birthtimeNs: bigint;
}

export interface PdfEditorProviderOptions {
  vaultRoot?: string;
  documentRoot?: string;
  globalStoragePath?: string;
  discussionController?: PdfDiscussionController;
  markdownInsertTarget?: MarkdownInsertTarget;
  annotationsEnabled?: boolean;
}

const PDF_DISCUSSION_CONSENT_KEY = 'humanLearning.pdf.askPdfConsent';

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
  static readonly viewType = 'human-learning.pdfViewer';

  private readonly webviews = new Map<string, ActivePdfWebview>();
  private readonly discussionStores = new Map<string, CachedPdfDiscussionStore>();
  private readonly vaultRoot?: string;
  private readonly documentRoot: string;
  private readonly globalStoragePath?: string;
  private readonly discussionController?: PdfDiscussionController;
  private readonly markdownInsertTarget?: MarkdownInsertTarget;
  private readonly annotationsEnabled: boolean;
  private activeKey: string | undefined;

  constructor(context: vscode.ExtensionContext, options: PdfEditorProviderOptions);
  constructor(
    context: vscode.ExtensionContext,
    documentRoot: string,
    markdownInsertTarget?: MarkdownInsertTarget,
    annotationsEnabled?: boolean,
  );
  constructor(
    private readonly context: vscode.ExtensionContext,
    optionsOrDocumentRoot: PdfEditorProviderOptions | string,
    markdownInsertTarget?: MarkdownInsertTarget,
    annotationsEnabled = true,
  ) {
    const options: PdfEditorProviderOptions = typeof optionsOrDocumentRoot === 'string'
      ? {
          vaultRoot: annotationsEnabled ? optionsOrDocumentRoot : undefined,
          documentRoot: optionsOrDocumentRoot,
          globalStoragePath: context.globalStorageUri?.fsPath,
          markdownInsertTarget,
          annotationsEnabled,
        }
      : optionsOrDocumentRoot;
    this.vaultRoot = options.vaultRoot;
    this.documentRoot = options.documentRoot ?? options.vaultRoot ?? process.cwd();
    this.globalStoragePath = options.globalStoragePath;
    this.discussionController = options.discussionController;
    this.markdownInsertTarget = options.markdownInsertTarget;
    this.annotationsEnabled = options.annotationsEnabled ?? Boolean(options.vaultRoot);
    if (this.discussionController) {
      context.subscriptions.push(
        this.discussionController.onEvent(event => this.forwardDiscussionEvent(event)),
      );
    }
  }

  getActiveWebview(): ActivePdfWebview | undefined {
    return this.activeKey ? this.webviews.get(this.activeKey) : undefined;
  }

  async openAskPdfForSelection(): Promise<void> {
    this.getActiveWebview()?.postMessage({ type: 'pdfDiscussionOpenForSelection' });
  }

  async getActiveSelectionContext(): Promise<SelectionContext | undefined> {
    const active = this.getActiveWebview();
    const selection = active?.selection;
    if (!active || !selection?.snippet.trim()) return undefined;

    const relPath = vscode.workspace.asRelativePath(active.pdfUri);
    const textFragment = pdfTextFragmentForSelection(selection);

    return {
      uri: active.pdfUri,
      text: selection.snippet,
      startLine: selection.page,
      endLine: selection.page,
      sourceLabel: relPath,
      rangeLabel: `page ${selection.page}`,
      anchorUri: pdfHref(relPath, { page: selection.page, textFragment }),
      metadata: {
        kind: 'pdf',
        page: selection.page,
        textFragment,
      },
    };
  }

  async openPdfAtTarget(pdfPath: string, page?: number, textFragment?: PdfTextFragment): Promise<void> {
    const decodedPath = decodePath(pdfPath);
    const pdfUri = vscode.Uri.file(path.isAbsolute(decodedPath) ? decodedPath : path.join(this.documentRoot, decodedPath));
    const key = pdfUri.toString();

    await vscode.commands.executeCommand('vscode.openWith', pdfUri, PdfEditorProvider.viewType);
    const info = await this.waitForWebview(key);
    if (!info) return;

    const payload: Record<string, unknown> = {
      ...(page ? { page } : {}),
      ...(textFragment ? { textFragment } : {}),
    };

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
      postMessage: (message: unknown) => {
        void webviewPanel.webview.postMessage(message);
      },
    };
    this.webviews.set(key, active);
    this.activeKey = key;
    await vscode.commands.executeCommand('setContext', 'humanLearningPdfOpen', true);
    await vscode.commands.executeCommand('setContext', 'humanLearningPdfHasSelection', false);

    webviewPanel.webview.onDidReceiveMessage(async (message: any) => {
      if (isPdfDiscussionMessage(message)) {
        await this.handlePdfDiscussionMessage(webviewPanel.webview, pdfUri, message);
        return;
      }
      switch (message?.type) {
        case 'ready':
          await this.loadPdf(webviewPanel.webview, pdfUri);
          break;
        case 'selectionAction':
          await this.handleSelectionAction(pdfUri, message.action, message.anchor);
          break;
        case 'copyText': {
          const text = normalizePdfMessageText(message.text);
          if (text) await vscode.env.clipboard.writeText(text);
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
          vscode.window.showInformationMessage('Human Learning PDF page link copied');
          break;
        }
        case 'selectionChanged':
          await this.updateActiveSelection(key, message.anchor);
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
        await vscode.commands.executeCommand('setContext', 'humanLearningPdfHasSelection', Boolean(active.selection));
        if (this.annotationsEnabled) await this.sendHighlights(webviewPanel.webview, pdfUri);
        await this.sendPdfDiscussionState(webviewPanel.webview, pdfUri);
      }
    });

    webviewPanel.onDidDispose(async () => {
      this.webviews.delete(key);
      if (this.activeKey === key) {
        this.activeKey = undefined;
        await vscode.commands.executeCommand('setContext', 'humanLearningPdfOpen', false);
        await vscode.commands.executeCommand('setContext', 'humanLearningPdfHasSelection', false);
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
      if (this.annotationsEnabled) await this.sendHighlights(webview, pdfUri);
      await this.sendPdfDiscussionState(webview, pdfUri);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to load PDF: ${String(error)}`);
    }
  }

  private getDiscussionStore(pdfUri: vscode.Uri): PdfDiscussionStore | undefined {
    if (
      !this.discussionController
      || !this.globalStoragePath
      || pdfUri.scheme !== 'file'
    ) {
      return undefined;
    }
    const key = pdfUri.toString();
    const before = pdfFileFingerprint(pdfUri.fsPath);
    const cached = this.discussionStores.get(key);
    if (cached && samePdfFileFingerprint(cached.fingerprint, before)) {
      return cached.store;
    }

    const store = createPdfDiscussionStoreForDocument({
      pdfPath: pdfUri.fsPath,
      sourceUri: pdfUri.toString(),
      vaultRoot: this.vaultRoot,
      documentRoot: this.documentRoot,
      globalStoragePath: this.globalStoragePath,
    }).store;
    const after = pdfFileFingerprint(pdfUri.fsPath);
    if (samePdfFileFingerprint(before, after)) {
      this.discussionStores.set(key, { store, fingerprint: after });
    } else {
      this.discussionStores.delete(key);
    }
    return store;
  }

  private async handlePdfDiscussionMessage(
    webview: vscode.Webview,
    pdfUri: vscode.Uri,
    message: PdfDiscussionWebviewToHostMessage,
  ): Promise<void> {
    const controller = this.discussionController;
    try {
      const store = this.getDiscussionStore(pdfUri);
      if (!controller || !store) {
        await this.postDiscussionMessage(webview, {
          type: 'pdfDiscussionError',
          message: 'Ask PDF storage is not available for this document.',
          requestId: message.requestId,
        });
        return;
      }
      switch (message.type) {
        case 'pdfDiscussionPrepare': {
          const prepared = controller.prepare(store, {
            anchor: this.toDiscussionAnchor(pdfUri, message.selection),
          });
          await this.postDiscussionMessage(webview, {
            type: 'pdfDiscussionPrepared',
            ...prepared,
            ...(prepared.annotation
              ? { annotation: toPdfDiscussionAnnotationSnapshot(prepared.annotation) }
              : {}),
            requestId: message.requestId,
          });
          return;
        }
        case 'pdfDiscussionList':
          await this.sendPdfDiscussionState(webview, pdfUri, undefined, message.requestId);
          return;
        case 'pdfDiscussionOpen':
          await this.sendPdfDiscussionState(webview, pdfUri, message.annotationId, message.requestId);
          return;
        case 'pdfDiscussionLoadSnapshot': {
          const annotation = controller.list(store).find(
            candidate => candidate.id === message.annotationId,
          );
          if (!annotation) {
            throw new Error('PDF discussion annotation was not found.');
          }
          if (!annotation.snapshot) {
            await this.postDiscussionMessage(webview, {
              type: 'pdfDiscussionSnapshotImage',
              annotationId: annotation.id,
              requestId: message.requestId,
            });
            return;
          }
          let snapshotPng: Buffer | undefined;
          try {
            snapshotPng = store.readVerifiedSnapshot(annotation.snapshot);
          } catch {
            snapshotPng = undefined;
          }
          await this.postDiscussionMessage(webview, {
            type: 'pdfDiscussionSnapshotImage',
            annotationId: annotation.id,
            ...(snapshotPng ? { snapshotPngBase64: snapshotPng.toString('base64') } : {}),
            requestId: message.requestId,
          });
          return;
        }
        case 'pdfDiscussionConsent':
          if (typeof message.accepted !== 'boolean') {
            throw new Error('Ask PDF consent must be accepted or declined.');
          }
          await this.context.globalState.update(PDF_DISCUSSION_CONSENT_KEY, message.accepted);
          await this.sendPdfDiscussionState(webview, pdfUri, undefined, message.requestId);
          return;
        case 'pdfDiscussionListModels': {
          this.assertPdfDiscussionConsent();
          try {
            const models = await controller.listModels();
            await this.postDiscussionMessage(webview, {
              type: 'pdfDiscussionModels',
              models,
              requestId: message.requestId,
            });
          } catch (cause) {
            await this.postDiscussionMessage(webview, {
              type: 'pdfDiscussionModels',
              models: [],
              error: cause instanceof Error ? cause.message : 'Codex models are unavailable.',
              requestId: message.requestId,
            });
          }
          return;
        }
        case 'pdfDiscussionSubmit': {
          this.assertPdfDiscussionConsent();
          const snapshotPng = decodePdfDiscussionSnapshot(message.snapshotPngBase64);
          const model = normalizePdfDiscussionModel(message.model);
          await controller.submit(store, {
            ...(message.annotationId ? { annotationId: message.annotationId } : {}),
            ...(message.selection
              ? { anchor: this.toDiscussionAnchor(pdfUri, message.selection) }
              : {}),
            question: message.question,
            ...(model ? { model } : {}),
            ...(snapshotPng ? { snapshotPng } : {}),
          });
          await this.sendPdfDiscussionState(webview, pdfUri, message.annotationId, message.requestId);
          return;
        }
        case 'pdfDiscussionRetry':
          this.assertPdfDiscussionConsent();
          await controller.retry(store, { annotationId: message.annotationId });
          await this.sendPdfDiscussionState(webview, pdfUri, message.annotationId, message.requestId);
          return;
        case 'pdfDiscussionCancel':
          await controller.cancel(store, { annotationId: message.annotationId });
          await this.sendPdfDiscussionState(webview, pdfUri, message.annotationId, message.requestId);
          return;
        case 'pdfDiscussionPromote': {
          this.assertPdfDiscussionConsent();
          const threadId = await controller.promote(store, { annotationId: message.annotationId });
          await this.sendPdfDiscussionState(webview, pdfUri, message.annotationId);
          const result = await openCodexThread(threadId);
          await this.postDiscussionMessage(webview, {
            type: 'pdfDiscussionPromotionState',
            annotationId: message.annotationId,
            ...result,
            requestId: message.requestId,
          });
          return;
        }
        case 'pdfDiscussionOpenPromotedTask': {
          const annotation = controller.list(store).find(
            candidate => candidate.id === message.annotationId,
          );
          if (!annotation?.promotion) {
            throw new Error('This PDF discussion has not been promoted to a Codex task.');
          }
          const result = await openCodexThread(annotation.promotion.threadId);
          await this.postDiscussionMessage(webview, {
            type: 'pdfDiscussionPromotionState',
            annotationId: annotation.id,
            ...result,
            requestId: message.requestId,
          });
          return;
        }
        case 'pdfDiscussionCopyPortableLink': {
          let portableUrl: string | undefined;
          if (message.annotationId) {
            portableUrl = controller.list(store).find(
              candidate => candidate.id === message.annotationId,
            )?.anchor.portableUrl;
          } else if (message.selection) {
            portableUrl = this.toDiscussionAnchor(pdfUri, message.selection).portableUrl;
          }
          if (!portableUrl) {
            throw new Error('A PDF selection is required to copy its portable link.');
          }
          await vscode.env.clipboard.writeText(portableUrl);
          await this.postDiscussionMessage(webview, {
            type: 'pdfDiscussionPortableLinkCopied',
            ...(message.annotationId ? { annotationId: message.annotationId } : {}),
            requestId: message.requestId,
          });
          return;
        }
        case 'pdfDiscussionOpenLink': {
          const target = vscode.Uri.parse(message.href);
          if (target.scheme.toLowerCase() !== 'http' && target.scheme.toLowerCase() !== 'https') {
            throw new Error('Ask PDF links must use http or https.');
          }
          const opened = await vscode.env.openExternal(target);
          if (!opened) throw new Error('VS Code could not open this link.');
        }
      }
    } catch (cause) {
      await this.postDiscussionMessage(webview, {
        type: 'pdfDiscussionError',
        message: cause instanceof Error ? cause.message : String(cause),
        requestId: message.requestId,
        ...('annotationId' in message ? { annotationId: message.annotationId } : {}),
      });
    }
  }

  private toDiscussionAnchor(
    pdfUri: vscode.Uri,
    input: unknown,
  ): PdfDiscussionAnchorV1 {
    const selection = normalizePdfSelectionAnchor(input);
    const rects = normalizePdfRects(selection?.rects);
    if (!selection || !rects?.length) {
      throw new Error('Ask PDF requires a text selection with rectangle geometry.');
    }
    const relPath = vscode.workspace.asRelativePath(pdfUri);
    return {
      uri: pdfUri.toString(),
      page: selection.page,
      quote: selection.snippet,
      ...(selection.prefix ? { prefix: selection.prefix } : {}),
      ...(selection.suffix ? { suffix: selection.suffix } : {}),
      rects: rects.map(rect => (
        [rect[0], rect[1], rect[2], rect[3]] as [number, number, number, number]
      )),
      ...(selection.textItemIndex !== undefined
        ? { textItemIndex: selection.textItemIndex }
        : {}),
      ...(selection.charOffset !== undefined ? { charOffset: selection.charOffset } : {}),
      ...(selection.endTextItemIndex !== undefined
        ? { endTextItemIndex: selection.endTextItemIndex }
        : {}),
      ...(selection.endCharOffset !== undefined
        ? { endCharOffset: selection.endCharOffset }
        : {}),
      portableUrl: pdfHref(relPath, {
        page: selection.page,
        textFragment: pdfTextFragmentForSelection(selection),
      }),
    };
  }

  private async sendPdfDiscussionState(
    webview: vscode.Webview,
    pdfUri: vscode.Uri,
    activeAnnotationId?: string,
    requestId?: string,
  ): Promise<void> {
    const controller = this.discussionController;
    const store = this.getDiscussionStore(pdfUri);
    if (!controller || !store) return;
    const annotations = controller.list(store).map(toPdfDiscussionAnnotationSnapshot);
    await this.postDiscussionMessage(webview, {
      type: 'pdfDiscussionSnapshot',
      annotations,
      consentGranted: this.discussionConsentGranted(),
      ...(activeAnnotationId ? { activeAnnotationId } : {}),
      ...(requestId ? { requestId } : {}),
    });
    await this.postDiscussionMessage(webview, {
      type: 'pdfDiscussionHighlights',
      highlights: annotations.map(annotation => ({
        annotationId: annotation.id,
        page: annotation.anchor.page,
        rects: annotation.anchor.rects,
        status: annotation.lastTurn.status,
        ...(annotation.summaryMarkdown
          ? { summaryMarkdown: annotation.summaryMarkdown }
          : {}),
      })),
    });
  }

  private discussionConsentGranted(): boolean {
    return this.context.globalState.get<unknown>(PDF_DISCUSSION_CONSENT_KEY, false) === true;
  }

  private assertPdfDiscussionConsent(): void {
    if (!this.discussionConsentGranted()) {
      throw new Error('Accept the Ask PDF first-use notice before sending data to Codex.');
    }
  }

  private async postDiscussionMessage(
    webview: vscode.Webview,
    message: PdfDiscussionHostToWebviewMessage,
  ): Promise<void> {
    await webview.postMessage(message);
  }

  private forwardDiscussionEvent(event: PdfDiscussionControllerEvent): void {
    for (const active of this.webviews.values()) {
      if (path.resolve(active.pdfUri.fsPath) !== path.resolve(event.pdfPath)) continue;
      if (event.type === 'delta') {
        void active.panel.webview.postMessage({
          type: 'pdfDiscussionDelta',
          annotationId: event.annotationId,
          delta: event.delta,
        } satisfies PdfDiscussionHostToWebviewMessage);
      } else {
        const annotationId = event.type === 'changed'
          ? event.annotation.id
          : event.annotationId;
        void active.panel.webview.postMessage({
          type: 'pdfDiscussionTurnState',
          annotationId,
          status: event.type === 'changed'
            ? event.annotation.lastTurn.status
            : 'failed',
          ...(event.type === 'error' ? { error: event.error } : {}),
        } satisfies PdfDiscussionHostToWebviewMessage);
        void this.sendPdfDiscussionState(active.panel.webview, active.pdfUri);
      }
    }
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
    action: 'copyLink' | 'insertLink' | 'copyQuoteAndLink' | 'insertQuoteAndLink' | 'highlight' | 'copyRectEmbed',
    anchor: PdfSelectionAnchor,
  ): Promise<void> {
    const relPath = vscode.workspace.asRelativePath(pdfUri);
    if (action === 'copyRectEmbed') {
      const rect = normalizePdfRects(anchor.rects)?.[0];
      if (!rect) throw new Error('Cannot copy a PDF rectangle embed without rectangle geometry');
      await vscode.env.clipboard.writeText(formatPdfRectangleEmbed(relPath, anchor.page, rect));
      vscode.window.showInformationMessage('Human Learning PDF rectangular embed link copied');
      return;
    }

    const selection = normalizePdfSelectionAnchor(anchor);
    if (!selection) throw new Error('Cannot create a PDF selection link without selected text and a page');

    if (action === 'highlight') {
      if (!this.annotationsEnabled) {
        vscode.window.showWarningMessage(
          'Human Learning PDF highlights require an initialized Human Learning vault. Run `hl init` first.',
        );
        return;
      }
      await this.persistSelectionAnchor(pdfUri, selection);
      vscode.window.showInformationMessage('Human Learning PDF highlight created');
      await this.refreshOpenPdfHighlights(pdfUri);
      return;
    }

    const textFragment = pdfTextFragmentForSelection(selection);
    const portableUri = pdfHref(relPath, { page: selection.page, textFragment });
    const label = formatPdfLinkLabel(relPath, selection.page);
    const markdown = `[${escapeMarkdownLabel(label)}](${formatMarkdownDestination(portableUri)})`;
    const quotedMarkdown = formatQuoteAndLink(selection.snippet, markdown);

    if (action === 'copyLink') {
      await vscode.env.clipboard.writeText(markdown);
      vscode.window.showInformationMessage('Human Learning PDF link copied');
      return;
    }
    if (action === 'copyQuoteAndLink') {
      await vscode.env.clipboard.writeText(quotedMarkdown);
      vscode.window.showInformationMessage('Human Learning PDF quote copied');
      return;
    }

    const textToInsert = action === 'insertQuoteAndLink' ? quotedMarkdown : markdown;
    if (await this.markdownInsertTarget?.insertMarkdown(textToInsert)) {
      vscode.window.showInformationMessage('Human Learning PDF link inserted');
      return;
    }

    const editor = vscode.window.visibleTextEditors.find(e => e.document.languageId === 'markdown');
    if (!editor) {
      await vscode.env.clipboard.writeText(textToInsert);
      vscode.window.showWarningMessage('No markdown editor is visible. Link copied to clipboard.');
      return;
    }

    await editor.edit(edit => {
      for (const selection of editor.selections) {
        edit.replace(selection, textToInsert);
      }
    });
    vscode.window.showInformationMessage('Human Learning PDF link inserted');
  }

  private async updateActiveSelection(key: string, anchor: unknown): Promise<void> {
    const active = this.webviews.get(key);
    if (!active) return;
    active.selection = normalizePdfSelectionAnchor(anchor);
    if (this.activeKey === key) {
      await vscode.commands.executeCommand('setContext', 'humanLearningPdfHasSelection', Boolean(active.selection));
    }
  }

  private async persistSelectionAnchor(
    pdfUri: vscode.Uri,
    anchor: PdfSelectionAnchor,
  ): Promise<{ id: string; uri: string }> {
    const selection = normalizePdfSelectionAnchor(anchor);
    if (!selection) throw new Error('Cannot persist a PDF highlight without selected text and a page');
    const relPath = vscode.workspace.asRelativePath(pdfUri);
    const db = await openDatabase(this.vaultRoot!);
    try {
      runMigrations(db);
      const rects = normalizePdfRects(selection.rects);
      const highlightColor = normalizePdfHighlightColor(selection.highlightColor);
      return createPdfAnchorFromSelection(db, this.vaultRoot!, relPath, {
        quote: selection.snippet,
        page: selection.page,
        ...(selection.prefix ? { prefix: selection.prefix } : {}),
        ...(selection.suffix ? { suffix: selection.suffix } : {}),
        ...(selection.textItemIndex !== undefined ? { textItemIndex: selection.textItemIndex } : {}),
        ...(selection.charOffset !== undefined ? { charOffset: selection.charOffset } : {}),
        ...(selection.endTextItemIndex !== undefined ? { endTextItemIndex: selection.endTextItemIndex } : {}),
        ...(selection.endCharOffset !== undefined ? { endCharOffset: selection.endCharOffset } : {}),
        ...(rects ? { rects } : {}),
        ...(highlightColor ? { highlightColor } : {}),
        createdBy: 'user',
      });
    } finally {
      closeDatabase(db);
    }
  }

  private async refreshOpenPdfHighlights(pdfUri: vscode.Uri): Promise<void> {
    if (!this.annotationsEnabled) return;
    const active = this.webviews.get(pdfUri.toString());
    if (active) await this.sendHighlights(active.panel.webview, pdfUri);
  }

  private async sendHighlights(webview: vscode.Webview, pdfUri: vscode.Uri): Promise<void> {
    if (!this.annotationsEnabled) return;
    const relPath = vscode.workspace.asRelativePath(pdfUri);
    const db = await openDatabase(this.vaultRoot!);
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
    if (!this.annotationsEnabled || !anchor?.id) {
      webview.postMessage({ type: 'referencesForAnchor', anchor, items: [] });
      return;
    }

    const db = await openDatabase(this.vaultRoot!);
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
      const uri = vscode.Uri.file(path.join(this.documentRoot, relPath));
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
    const uri = vscode.Uri.file(path.join(this.documentRoot, relPath));
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; img-src ${webview.cspSource} blob: data:; script-src 'nonce-${nonce}' ${webview.cspSource} 'wasm-unsafe-eval'; style-src ${webview.cspSource} 'unsafe-inline'; worker-src blob: ${webview.cspSource}; connect-src ${webview.cspSource} blob: data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Human Learning PDF</title>
  <style>
    html, body { height: 100%; margin: 0; padding: 0; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); overflow: hidden; }
    #toolbar { box-sizing: border-box; height: 38px; display: flex; gap: 4px; align-items: center; padding: 0 6px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); font: 12px var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
    #toolbar button { box-sizing: border-box; min-width: 26px; height: 26px; padding: 0 6px; border: 1px solid var(--vscode-button-border, transparent); background: transparent; color: var(--vscode-button-secondaryForeground); border-radius: 3px; cursor: pointer; }
    #toolbar button:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,.31)); }
    #toolbar button[aria-pressed="true"] { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .toolbar-group { display: inline-flex; align-items: center; gap: 2px; }
    .toolbar-spacer { flex: 1 1 auto; }
    .toolbar-separator { width: 1px; height: 20px; margin: 0 3px; background: var(--vscode-panel-border); }
    .toolbar-number { display: inline-flex; align-items: center; height: 26px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; background: var(--vscode-input-background, var(--vscode-editor-background)); }
    .toolbar-number input { box-sizing: border-box; width: 44px; height: 24px; border: 0; outline: 0; padding: 0 3px; background: transparent; color: var(--vscode-input-foreground, var(--vscode-editor-foreground)); font: inherit; text-align: right; -moz-appearance: textfield; }
    .toolbar-number input::-webkit-inner-spin-button, .toolbar-number input::-webkit-outer-spin-button { appearance: none; margin: 0; }
    .toolbar-number span { padding-right: 5px; color: var(--vscode-descriptionForeground); white-space: nowrap; }
    #page-input { width: 36px; }
    #page-total { min-width: 30px; }
    .toolbar-color-dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #ffd54f; box-shadow: 0 0 0 1px rgba(255,255,255,.35); }
    .toolbar-palette { display: inline-flex; align-items: center; gap: 1px; }
    #toolbar .toolbar-palette .palette-color { min-width: 22px; width: 22px; padding: 0; }
    #toolbar .toolbar-palette .palette-color[aria-pressed="true"] { background: rgba(127,127,127,.24); box-shadow: inset 0 -2px 0 var(--vscode-focusBorder); }
    .palette-color[data-palette-highlight-color="red"] .toolbar-color-dot { background: #ff6b6b; }
    .palette-color[data-palette-highlight-color="green"] .toolbar-color-dot { background: #69db7c; }
    .palette-color[data-palette-highlight-color="purple"] .toolbar-color-dot { background: #b197fc; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
    .toolbar-menu { position: fixed; top: 42px; z-index: 60; min-width: 210px; padding: 5px; border: 1px solid var(--vscode-panel-border); border-radius: 5px; background: var(--vscode-editorWidget-background); box-shadow: 0 6px 20px rgba(0,0,0,.4); font: 12px var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
    #display-menu { left: 112px; }
    #highlight-color-menu { right: 106px; }
    #copy-link-format-menu { right: 54px; }
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
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, #454545));
      border-radius: 5px;
      appearance: none;
      -webkit-appearance: none;
      background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background, #252526));
      color: var(--vscode-icon-foreground, var(--vscode-foreground, var(--vscode-editor-foreground, #cccccc)));
      box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0,0,0,.38));
      cursor: pointer;
      transition: left 120ms ease, background-color 80ms ease, border-color 80ms ease;
    }
    #pdf-history-back[hidden] { display: none; }
    #pdf-sidebar:not([hidden]) ~ #pdf-history-back { left: 254px; }
    #pdf-history-back:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,.31)); }
    #pdf-history-back:active { background: var(--vscode-toolbar-activeBackground, rgba(90,93,94,.48)); }
    #pdf-history-back:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: 2px; }
    #pdf-history-back svg { display: block; pointer-events: none; }
    body[data-reduce-animation="on"] #pdf-history-back { transition: none; }
    @media (prefers-reduced-motion: reduce) {
      body[data-reduce-animation="system"] #pdf-history-back { transition: none; }
    }
    #page-container { display: flex; flex-direction: column; align-items: safe center; gap: 12px; padding: 12px; }
    #page-container.scroll-horizontal { width: max-content; min-width: 100%; min-height: 100%; flex-direction: row; align-items: flex-start; }
    #page-container.scroll-wrapped { min-height: 100%; flex-flow: row wrap; align-items: flex-start; justify-content: center; }
    #page-container.two-page { display: grid; grid-template-columns: repeat(2, max-content); align-items: start; justify-content: safe center; }
    #page-container.two-page.paginated { gap: 0; }
    #page-container.paginated { min-height: calc(100% - 76px); padding: 38px 12px; justify-content: safe center; align-content: safe center; }
    .page-wrapper { position: relative; background: white; box-shadow: 0 1px 8px rgba(0,0,0,.24); }
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
    #page-container.rectangle-mode .page-wrapper { cursor: crosshair; }
    #page-container.rectangle-mode .text-layer { pointer-events: none; user-select: none; }
    .rectangle-selection-overlay { position: absolute; z-index: 15; box-sizing: border-box; border: 1px dashed var(--vscode-focusBorder); background: rgba(0, 127, 212, .16); pointer-events: none; }
    .annotation-highlight { position: absolute; pointer-events: auto; cursor: pointer; border-radius: 2px; transition: filter .12s, background-color .12s; }
    body[data-reduce-animation="on"] .annotation-highlight { transition: none; }
    @media (prefers-reduced-motion: reduce) {
      body[data-reduce-animation="system"] .annotation-highlight { transition: none; }
    }
    .annotation-highlight.referenced { background: rgba(58, 190, 110, .42); }
    .annotation-highlight.annotated { background: rgba(255, 218, 80, .38); }
    .annotation-highlight.hover-active { filter: brightness(1.25) saturate(1.2); }
    .anchor-highlight { position: absolute; background: rgba(0, 150, 255, .35); border-radius: 2px; pointer-events: none; }
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
    <div class="toolbar-palette" role="group" aria-label="Highlight palette">
      <button class="palette-color" type="button" aria-label="Yellow highlight" aria-pressed="true" data-palette-highlight-color="yellow"><span class="toolbar-color-dot"></span></button>
      <button class="palette-color" type="button" aria-label="Red highlight" aria-pressed="false" data-palette-highlight-color="red"><span class="toolbar-color-dot"></span></button>
      <button class="palette-color" type="button" aria-label="Green highlight" aria-pressed="false" data-palette-highlight-color="green"><span class="toolbar-color-dot"></span></button>
      <button class="palette-color" type="button" aria-label="Purple highlight" aria-pressed="false" data-palette-highlight-color="purple"><span class="toolbar-color-dot"></span></button>
      <button id="highlight-color" type="button" aria-label="Highlight color" aria-controls="highlight-color-menu" aria-haspopup="menu" aria-expanded="false" data-highlight-color="yellow">⌄</button>
    </div>
    <button id="copy-link-format" type="button" aria-label="Copy link format" aria-controls="copy-link-format-menu" aria-haspopup="menu" aria-expanded="false" data-copy-link-format="link">🔗⌄</button>
    <button id="rectangle-selection" type="button" aria-label="Copy embed link to rectangular selection" title="Copy embed link to rectangular selection" aria-pressed="false">▱</button>
    <button id="direct-highlight" type="button" aria-label="Direct highlight" aria-pressed="false">✎</button>
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
  <div id="highlight-color-menu" class="toolbar-menu hidden" role="menu" aria-label="Highlight colors">
    <button type="button" role="menuitemradio" aria-checked="true" data-highlight-color="yellow">Yellow</button>
    <button type="button" role="menuitemradio" aria-checked="false" data-highlight-color="red">Red</button>
    <button type="button" role="menuitemradio" aria-checked="false" data-highlight-color="green">Green</button>
    <button type="button" role="menuitemradio" aria-checked="false" data-highlight-color="purple">Purple</button>
  </div>
  <div id="copy-link-format-menu" class="toolbar-menu hidden" role="menu" aria-label="Copy link format">
    <button type="button" role="menuitemradio" aria-checked="true" data-copy-link-format="link">Link only</button>
    <button type="button" role="menuitemradio" aria-checked="false" data-copy-link-format="quote">Quote and link</button>
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
  <script nonce="${nonce}">window.__pdfiumWasmUrl = "${wasmUri.toString()}";</script>
  <script nonce="${nonce}" src="${scriptUri.toString()}?v=${nonce}"></script>
</body>
</html>`;
  }
}

function pdfFileFingerprint(pdfPath: string): PdfFileFingerprint | undefined {
  try {
    const stat = statSync(pdfPath, { bigint: true });
    return {
      dev: stat.dev,
      ino: stat.ino,
      size: stat.size,
      mtimeNs: stat.mtimeNs,
      ctimeNs: stat.ctimeNs,
      birthtimeNs: stat.birthtimeNs,
    };
  } catch {
    return undefined;
  }
}

function samePdfFileFingerprint(
  left: PdfFileFingerprint | undefined,
  right: PdfFileFingerprint | undefined,
): boolean {
  return Boolean(
    left
    && right
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
    && left.birthtimeNs === right.birthtimeNs,
  );
}

export function locatorToWebviewAnchor(locatorJson: string, quote: string): Record<string, unknown> {
  try {
    const locator = JSON.parse(locatorJson);
    const rects = normalizePdfRects(locator.rects);
    const highlightColor = normalizePdfHighlightColor(locator.highlightColor);
    return {
      page: locator.page ?? 1,
      textItemIndex: locator.textItemIndex,
      charOffset: locator.charOffset,
      endTextItemIndex: locator.endTextItemIndex,
      endCharOffset: locator.endCharOffset,
      ...(rects ? { rects } : {}),
      ...(highlightColor ? { highlightColor } : {}),
      ...(normalizePdfMessageText(locator.prefix) ? { prefix: normalizePdfMessageText(locator.prefix) } : {}),
      ...(normalizePdfMessageText(locator.suffix) ? { suffix: normalizePdfMessageText(locator.suffix) } : {}),
      snippet: quote,
    };
  } catch {
    return { page: 1, snippet: quote };
  }
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
    page,
    textItemIndex: numberValue(raw.textItemIndex),
    charOffset: numberValue(raw.charOffset),
    endTextItemIndex: numberValue(raw.endTextItemIndex),
    endCharOffset: numberValue(raw.endCharOffset),
    length: numberValue(raw.length),
    rects: normalizePdfRects(raw.rects),
    highlightColor: normalizePdfHighlightColor(raw.highlightColor),
    prefix: normalizePdfMessageText(raw.prefix),
    suffix: normalizePdfMessageText(raw.suffix),
    snippet,
  };
}

function toPdfDiscussionAnnotationSnapshot(
  annotation: PdfDiscussionAnnotationV1,
): PdfDiscussionAnnotationSnapshot {
  return {
    id: annotation.id,
    kind: annotation.kind,
    selectionKey: annotation.selectionKey,
    anchor: {
      page: annotation.anchor.page,
      quote: annotation.anchor.quote,
      ...(annotation.anchor.prefix !== undefined ? { prefix: annotation.anchor.prefix } : {}),
      ...(annotation.anchor.suffix !== undefined ? { suffix: annotation.anchor.suffix } : {}),
      rects: annotation.anchor.rects.map(rect => (
        [rect[0], rect[1], rect[2], rect[3]] as [number, number, number, number]
      )),
      ...(annotation.anchor.textItemIndex !== undefined
        ? { textItemIndex: annotation.anchor.textItemIndex }
        : {}),
      ...(annotation.anchor.charOffset !== undefined
        ? { charOffset: annotation.anchor.charOffset }
        : {}),
      ...(annotation.anchor.endTextItemIndex !== undefined
        ? { endTextItemIndex: annotation.anchor.endTextItemIndex }
        : {}),
      ...(annotation.anchor.endCharOffset !== undefined
        ? { endCharOffset: annotation.anchor.endCharOffset }
        : {}),
    },
    ...(annotation.snapshot
      ? {
          snapshot: {
            sha256: annotation.snapshot.sha256,
            width: annotation.snapshot.width,
            height: annotation.snapshot.height,
            mimeType: annotation.snapshot.mimeType,
          },
        }
      : {}),
    messages: annotation.messages.map(message => ({
      id: message.id,
      role: message.role,
      markdown: message.markdown,
      createdAt: message.createdAt,
      ...(message.codexTurnId !== undefined ? { codexTurnId: message.codexTurnId } : {}),
      ...(message.codexModel !== undefined ? { codexModel: message.codexModel } : {}),
    })),
    ...(annotation.summaryMarkdown !== undefined
      ? { summaryMarkdown: annotation.summaryMarkdown }
      : {}),
    lastTurn: {
      status: annotation.lastTurn.status,
      ...(annotation.lastTurn.questionMessageId !== undefined
        ? { questionMessageId: annotation.lastTurn.questionMessageId }
        : {}),
      ...(annotation.lastTurn.model !== undefined ? { model: annotation.lastTurn.model } : {}),
      ...(annotation.lastTurn.error !== undefined ? { error: annotation.lastTurn.error } : {}),
    },
    ...(annotation.promotion
      ? {
          promotion: {
            threadId: annotation.promotion.threadId,
            promotedAt: annotation.promotion.promotedAt,
          },
        }
      : {}),
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt,
  };
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodePdfDiscussionSnapshot(value: unknown): Buffer | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw invalidPdfDiscussionSnapshotEncoding();
  const maxEncodedLength = Math.ceil(PDF_DISCUSSION_MAX_PNG_BYTES / 3) * 4;
  if (value.length > maxEncodedLength) throw oversizedPdfDiscussionSnapshot();
  if (!isCanonicalBase64(value)) throw invalidPdfDiscussionSnapshotEncoding();
  const paddingLength = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const decodedLength = (value.length / 4) * 3 - paddingLength;
  if (decodedLength > PDF_DISCUSSION_MAX_PNG_BYTES) throw oversizedPdfDiscussionSnapshot();
  return Buffer.from(value, 'base64');
}

function isCanonicalBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  const paddingLength = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const unpaddedLength = value.length - paddingLength;
  for (let index = 0; index < unpaddedLength; index++) {
    if (BASE64_ALPHABET.indexOf(value[index]!) < 0) return false;
  }
  for (let index = unpaddedLength; index < value.length; index++) {
    if (value[index] !== '=') return false;
  }
  if (paddingLength === 2) {
    return (BASE64_ALPHABET.indexOf(value[value.length - 3]!) & 0x0f) === 0;
  }
  if (paddingLength === 1) {
    return (BASE64_ALPHABET.indexOf(value[value.length - 2]!) & 0x03) === 0;
  }
  return true;
}

function invalidPdfDiscussionSnapshotEncoding(): Error {
  return new Error('Ask PDF snapshots must use canonical base64-encoded PNG bytes.');
}

function oversizedPdfDiscussionSnapshot(): Error {
  return new Error('PDF discussion snapshots cannot exceed 5 MiB.');
}

function isPdfDiscussionMessage(
  message: unknown,
): message is PdfDiscussionWebviewToHostMessage {
  if (!message || typeof message !== 'object') return false;
  const type = (message as { type?: unknown }).type;
  return typeof type === 'string' && new Set<string>([
    'pdfDiscussionPrepare',
    'pdfDiscussionList',
    'pdfDiscussionOpen',
    'pdfDiscussionLoadSnapshot',
    'pdfDiscussionListModels',
    'pdfDiscussionSubmit',
    'pdfDiscussionRetry',
    'pdfDiscussionCancel',
    'pdfDiscussionPromote',
    'pdfDiscussionOpenPromotedTask',
    'pdfDiscussionCopyPortableLink',
    'pdfDiscussionOpenLink',
    'pdfDiscussionConsent',
  ]).has(type);
}

function pdfTextFragmentForSelection(selection: PdfSelectionAnchor): PdfTextFragment {
  return {
    textStart: selection.snippet,
    ...(selection.prefix ? { prefix: selection.prefix } : {}),
    ...(selection.suffix ? { suffix: selection.suffix } : {}),
  };
}

function normalizePdfHighlightColor(value: unknown): PdfHighlightColor | undefined {
  return typeof value === 'string' && PDF_HIGHLIGHT_COLORS.has(value as PdfHighlightColor)
    ? value as PdfHighlightColor
    : undefined;
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

function normalizePdfDiscussionModel(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error('Ask PDF requires a valid Codex model identifier.');
  }
  const model = value.trim();
  if (!model || Buffer.byteLength(model, 'utf8') > PDF_DISCUSSION_MAX_QUESTION_BYTES) {
    throw new Error('Ask PDF requires a valid Codex model identifier.');
  }
  return model;
}

function normalizeLookupText(value: unknown): string | undefined {
  return normalizePdfMessageText(value)?.slice(0, 200);
}

function normalizePdfPage(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function decodePath(input: string): string {
  return input.split('/').map(segment => decodeURIComponent(segment)).join('/');
}

function formatPdfLinkLabel(relPath: string, page: number): string {
  const fileName = path.basename(relPath) || 'PDF';
  return `${fileName} p.${page}`;
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

function escapeMarkdownLabel(input: string): string {
  return input.replace(/]/g, '\\]');
}

function formatMarkdownDestination(uri: string): string {
  return /\s/.test(uri) ? `<${uri}>` : uri;
}

function formatQuoteAndLink(quote: string, markdownLink: string): string {
  const normalized = quote.replace(/\s+/g, ' ').trim();
  if (!normalized) return markdownLink;
  return `> ${normalized}\n>\n> ${markdownLink}`;
}
