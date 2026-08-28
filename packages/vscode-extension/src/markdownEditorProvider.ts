import * as vscode from 'vscode';
import * as path from 'path';
import type { LearningNoteStore } from './learningNoteStore';
import type { SelectionContext } from './selectionContext';
import type {
  AgentSurfaceCapabilities,
} from './agentHandoff';
import {
  agentHandoffCapabilitiesMessage,
  lookupSelectionInDictionary,
  messageRecord,
  queryNavigationPath,
} from './editorHost';
import { resolveLinkPreviewTarget } from './linkPreviewResolver';
import { resolveMarkdownAnchor, type QueryAnnotationIndex } from './queryAnnotationIndex';
import { MarkdownDocumentBridge } from './markdownDocumentBridge';

interface ActiveMarkdownWebview {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  selection?: RevealSelection;
  postMessage: (message: unknown) => Thenable<boolean>;
  flushBeforeSave: () => Promise<boolean>;
}

interface EditorPresentationSettings {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  letterSpacing?: string;
}

interface RevealSelection {
  from: number;
  to: number;
}

interface PendingInsertion {
  resolve: (applied: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingSelectionRequest {
  resolve: () => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface MarkdownEditorProviderOptions {
  agentCapabilities?: () => AgentSurfaceCapabilities;
  onDidChangeAgentCapabilities?: vscode.Event<void>;
  queryAnnotationIndex?: Pick<QueryAnnotationIndex, 'listAnnotationsForSource'>;
  queryDiagnostics?: vscode.DiagnosticCollection;
}

function inclusiveLineRange(
  document: Pick<vscode.TextDocument, 'positionAt'>,
  from: number,
  to: number,
): { startLine: number; endLine: number } {
  const start = document.positionAt(from);
  const end = document.positionAt(to);
  return {
    startLine: start.line + 1,
    endLine: Math.max(
      start.line + 1,
      end.line + 1 - (to > from && end.character === 0 ? 1 : 0),
    ),
  };
}

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'llm-wiki.markdownEditor';
  private static readonly vimModeStorageKey = 'markdownVimMode';
  private static readonly vimModeContextKey = 'llmWikiMarkdownVimMode';
  private static readonly selectionContextKey = 'llmWikiMarkdownHasSelection';

  private readonly webviews = new Map<vscode.WebviewPanel, ActiveMarkdownWebview>();
  private readonly pendingReveals = new Map<string, RevealSelection>();
  private readonly pendingInsertions = new Map<string, PendingInsertion>();
  private readonly pendingSelectionRequests = new Map<string, PendingSelectionRequest>();
  private readonly markdownNotePathCache = new Map<string, {
    expiresAt: number;
    paths: Promise<string[]>;
  }>();
  private activePanel: vscode.WebviewPanel | undefined;
  private vimModeEnabled: boolean;
  private readonly agentCapabilities: () => AgentSurfaceCapabilities;
  private readonly queryAnnotationIndex?: Pick<QueryAnnotationIndex, 'listAnnotationsForSource'>;
  private readonly queryDiagnostics?: vscode.DiagnosticCollection;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly learningNoteStore?: LearningNoteStore,
    options: MarkdownEditorProviderOptions = {},
  ) {
    this.queryAnnotationIndex = options.queryAnnotationIndex;
    this.queryDiagnostics = options.queryDiagnostics;
    this.agentCapabilities = options.agentCapabilities ?? (() => ({
      cursorAgent: false,
      providers: [],
    }));
    if (options.onDidChangeAgentCapabilities) {
      this.context.subscriptions.push(
        options.onDidChangeAgentCapabilities(() => this.broadcastAgentHandoffCapabilities()),
      );
    }
    this.vimModeEnabled = Boolean(
      this.context.workspaceState?.get<boolean>(MarkdownEditorProvider.vimModeStorageKey, false),
    );
    this.updateVimModeContext();
    void vscode.commands.executeCommand('setContext', MarkdownEditorProvider.selectionContextKey, false);
  }

  async refreshLearningAnnotations(): Promise<void> {
    await this.refreshQueryAnnotations();
  }

  async refreshQueryAnnotations(): Promise<void> {
    await Promise.all([...this.webviews.values()].map(async active => {
      await this.postQueryAnnotations(active.document, active.postMessage);
    }));
  }

  async insertMarkdown(markdown: string): Promise<boolean> {
    const active = this.getActiveWebview();
    if (!active) return false;
    active.panel.reveal(undefined, true);
    const requestId = `insert-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const applied = new Promise<boolean>(resolve => {
      const timeout = setTimeout(() => {
        this.pendingInsertions.delete(requestId);
        resolve(false);
      }, 2500);
      this.pendingInsertions.set(requestId, { resolve, timeout });
    });
    const posted = await active.postMessage({ type: 'insertText', text: markdown, requestId });
    if (!posted) {
      this.resolvePendingInsertion(requestId, false);
      return false;
    }
    return applied;
  }

  async toggleVimMode(): Promise<boolean> {
    this.vimModeEnabled = !this.vimModeEnabled;
    await this.context.workspaceState?.update(
      MarkdownEditorProvider.vimModeStorageKey,
      this.vimModeEnabled,
    );
    this.updateVimModeContext();
    for (const webview of this.webviews.values()) {
      void webview.postMessage({ type: 'setVimMode', enabled: this.vimModeEnabled });
    }
    return this.vimModeEnabled;
  }

  async consumeVimHostShortcut(): Promise<boolean> {
    if (!this.vimModeEnabled) return false;
    return this.focusActiveEditor();
  }

  async focusActiveEditor(): Promise<boolean> {
    const active = this.getActiveWebview();
    if (!active) return false;

    active.panel.reveal(undefined, false);
    for (const delay of [0, 50, 150]) {
      setTimeout(() => {
        void vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        void active.postMessage({ type: 'restoreFocus' });
      }, delay);
    }
    return true;
  }

  async captureActiveSelectionContext(
    options: { allowEmpty?: boolean } = {},
  ): Promise<SelectionContext | undefined> {
    const active = this.getActiveWebview();
    if (!active) return undefined;

    const requestId = `selection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const response = new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        this.pendingSelectionRequests.delete(requestId);
        resolve();
      }, 500);
      this.pendingSelectionRequests.set(requestId, { resolve, timeout });
    });
    const posted = await active.postMessage({ type: 'requestSelection', requestId });
    if (!posted) {
      this.resolvePendingSelectionRequest(requestId);
    }
    await response;
    if (!options.allowEmpty && (!active.selection || active.selection.from === active.selection.to)) {
      return undefined;
    }
    return this.selectionContext(active);
  }

  async flushActiveEditsBeforeSave(uri?: vscode.Uri): Promise<boolean> {
    const active = uri
      ? [...this.webviews.values()].find(candidate =>
        candidate.document.uri.scheme === uri.scheme
          && candidate.document.uri.fsPath === uri.fsPath,
      )
      : this.getActiveWebview();
    return active?.flushBeforeSave() ?? true;
  }

  async revealInEditor(uri: vscode.Uri, selection: RevealSelection): Promise<void> {
    const key = uri.toString();
    this.pendingReveals.set(key, selection);
    const active = this.getActiveWebview();
    const webview = active?.document.uri.toString() === key
      ? active
      : [...this.webviews.values()].find(candidate => candidate.document.uri.toString() === key);
    if (!webview) return;
    await webview.postMessage({
      type: 'revealPosition',
      anchor: selection.from,
      head: selection.to,
    });
    this.pendingReveals.delete(key);
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: markdownEditorLocalResourceRoots(
        document.uri,
        this.context.extensionUri,
      ),
    };
    const key = document.uri.toString();
    let flushBeforeSave: () => Promise<boolean> = async () => true;
    const activeWebview: ActiveMarkdownWebview = {
      panel: webviewPanel,
      document,
      postMessage: (message: unknown) => webviewPanel.webview.postMessage(message),
      flushBeforeSave: () => flushBeforeSave(),
    };
    this.webviews.set(webviewPanel, activeWebview);
    if (webviewPanel.active) {
      this.activePanel = webviewPanel;
    }

    let closingEditorTab = false;
    let panelViewColumn = webviewPanel.viewColumn;
    let initialTextPush: Promise<void> | undefined;
    let initialTextTimeout: ReturnType<typeof setTimeout> | undefined;
    let notePathsPush: Promise<void> | undefined;
    const documentBridge = new MarkdownDocumentBridge(document, error => {
      vscode.window.showErrorMessage(`Failed to update markdown note: ${String(error)}`);
    });
    flushBeforeSave = () => documentBridge.flushBeforeSave();

    const pushSettings = () => {
      webviewPanel.webview.postMessage({
        type: 'updateSettings',
        settings: this.getEditorPresentationSettings(),
      });
    };

    const ensureNotePaths = (): Promise<void> => {
      notePathsPush ??= this.markdownNotePaths(document.uri).then(async notePaths => {
        await webviewPanel.webview.postMessage({ type: 'setNotePaths', notePaths });
      }).catch(() => {
        // Note discovery and hydration are optional; document text is already visible.
      });
      return notePathsPush;
    };

    const pushText = async () => {
      const text = document.getText();
      documentBridge.rememberHostText(text);
      const posted = await webviewPanel.webview.postMessage({
        type: 'setText',
        text,
        title: noteTitleFromUri(document.uri),
        currentNotePath: documentRelativePath(document.uri),
        resourceBaseUri: webviewResourceUriString(webviewPanel.webview, documentDirectoryUri(document.uri)),
        resourceRootUri: webviewResourceUriString(webviewPanel.webview, workspaceRootUri(document.uri)),
      });
      if (posted) void ensureNotePaths();
      await this.postQueryAnnotations(
        document,
        message => webviewPanel.webview.postMessage(message),
      );
    };

    const ensureInitialText = (): Promise<void> => {
      initialTextPush ??= pushText().catch(error => {
        initialTextPush = undefined;
        throw error;
      });
      return initialTextPush;
    };

    const pushVimMode = () => {
      webviewPanel.webview.postMessage({
        type: 'setVimMode',
        enabled: this.vimModeEnabled,
      });
    };

    const pushPendingReveal = () => {
      const selection = this.pendingReveals.get(key);
      if (!selection) return;
      void webviewPanel.webview.postMessage({
        type: 'revealPosition',
        anchor: selection.from,
        head: selection.to,
      });
      this.pendingReveals.delete(key);
    };

    const requestFocus = () => {
      for (const delay of [0, 150, 350]) {
        setTimeout(() => {
          void vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
          void webviewPanel.webview.postMessage({ type: 'focus' });
        }, delay);
      }
    };

    // Close this document's own tab so a concurrent host-level close cannot
    // accidentally close whichever editor became active in the meantime. A
    // tab close remains native VS Code behavior, including dirty/untitled and
    // Save As prompts; disposing the webview panel would skip those prompts.
    const closeEditorTab = async (): Promise<void> => {
      const tab = markdownEditorTabForDocument(document.uri, panelViewColumn);
      if (!tab) return;
      try {
        await vscode.window.tabGroups.close(tab);
      } catch {
        // The host may have closed the tab first. Closing is idempotent here.
      }
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() !== document.uri.toString()) return;
      if (documentBridge.hostDocumentChanged()) void pushText();
    });

    const configSub = vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('editor')) {
        pushSettings();
      }
    });

    webviewPanel.onDidDispose(() => changeSub.dispose());
    webviewPanel.onDidDispose(() => configSub.dispose());
    webviewPanel.onDidDispose(() => {
      if (initialTextTimeout !== undefined) clearTimeout(initialTextTimeout);
      this.webviews.delete(webviewPanel);
      if (this.activePanel === webviewPanel) {
        this.activePanel = [...this.webviews.keys()].find(panel => panel.active);
        this.updateSelectionContext();
      }
    });

    webviewPanel.onDidChangeViewState(() => {
      panelViewColumn = webviewPanel.viewColumn;
      if (webviewPanel.active) {
        this.activePanel = webviewPanel;
        this.updateSelectionContext();
        requestFocus();
      } else if (this.activePanel === webviewPanel) {
        this.activePanel = [...this.webviews.keys()].find(panel => panel.active);
        this.updateSelectionContext();
      }
    });

    webviewPanel.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
      const message = messageRecord(rawMessage);
      switch (message?.type) {
        case 'active':
          this.activePanel = webviewPanel;
          this.updateSelectionContext();
          break;
        case 'ready':
          if (initialTextTimeout !== undefined) {
            clearTimeout(initialTextTimeout);
            initialTextTimeout = undefined;
          }
          webviewPanel.reveal(undefined, false);
          this.postAgentHandoffCapabilities(webviewPanel.webview);
          pushSettings();
          pushVimMode();
          void ensureInitialText();
          pushPendingReveal();
          requestFocus();
          break;
        case 'edit':
          {
            const nextText = webviewEditText(message, documentBridge.webviewText);
            if (nextText === undefined) {
              void webviewPanel.webview.postMessage({ type: 'requestText' });
              return;
            }
            documentBridge.queueWebviewText(nextText);
          }
          break;
        case 'selectionChanged': {
          const selection = normalizeSelectionMessage(message.selection);
          if (selection) {
            activeWebview.selection = selection;
            if (this.activePanel === webviewPanel) this.updateSelectionContext();
          }
          break;
        }
        case 'selectionResponse': {
          if (typeof message.requestId !== 'string') return;
          const selection = normalizeSelectionMessage(message.selection);
          if (selection) {
            activeWebview.selection = selection;
          }
          this.resolvePendingSelectionRequest(message.requestId);
          break;
        }
        case 'insertTextApplied': {
          if (typeof message.requestId === 'string') {
            this.resolvePendingInsertion(message.requestId, Boolean(message.applied));
          }
          break;
        }
        case 'save':
          if (!await flushBeforeSave()) break;
          await document.save();
          break;
        case 'close':
        case 'closeActiveEditor': {
          if (closingEditorTab) break;
          closingEditorTab = true;
          try {
            if (!await flushBeforeSave()) break;
            await closeEditorTab();
          } finally {
            closingEditorTab = false;
          }
          break;
        }
        case 'saveAndClose':
          if (!await flushBeforeSave()) break;
          if (await document.save()) {
            webviewPanel.dispose();
          }
          break;
        case 'openUri':
          if (typeof message.uri === 'string') {
            const target = message.relativeToDocument === true
              ? resolveMarkdownEditorLink(
                message.uri,
                documentRelativePath(document.uri),
              )
              : message.uri;
            await vscode.commands.executeCommand(
              'llm-wiki.openLinkTarget',
              target,
              document.uri,
            );
          }
          break;
        case 'resolveLinkPreview':
          if (
            typeof message.requestId === 'string'
            && typeof message.uri === 'string'
          ) {
            const fileUri = pathCalculationUri(document.uri);
            let preview = null;
            try {
              preview = await resolveLinkPreviewTarget({
                workspaceRoot: workspaceRootUri(document.uri)?.fsPath,
                documentPath: fileUri?.fsPath,
                target: message.uri,
                relativeToDocument: message.relativeToDocument === true,
              });
            } catch {
              // A preview is optional and must never interfere with navigation.
            }
            await webviewPanel.webview.postMessage({
              type: 'linkPreview',
              requestId: message.requestId,
              preview,
            });
          }
          break;
        case 'openLearningNote':
          if (
            typeof message.notePath !== 'string'
            || typeof message.discussionId !== 'string'
            || path.isAbsolute(message.notePath)
          ) return;
          await vscode.commands.executeCommand('llm-wiki.openLearningDiscussion', {
            notePath: message.notePath,
            discussionId: message.discussionId,
          });
          break;
        case 'openQuery': {
          const navigation = message.navigation;
          if (!navigation || typeof navigation !== 'object') return;
          const target = navigation as Record<string, unknown>;
          if (target.kind === 'legacy') {
            if (
              typeof target.notePath !== 'string'
              || typeof target.discussionId !== 'string'
              || path.isAbsolute(target.notePath)
            ) return;
            await vscode.commands.executeCommand('llm-wiki.openLearningDiscussion', {
              notePath: target.notePath,
              discussionId: target.discussionId,
            });
            break;
          }
          const queryPath = queryNavigationPath(target);
          if (!queryPath) return;
          await vscode.commands.executeCommand(
            'llm-wiki.openLinkTarget',
            queryPath,
            document.uri,
          );
          break;
        }
        case 'copyText':
          if (typeof message.text === 'string') {
            await vscode.env.clipboard.writeText(message.text);
          }
          break;
        case 'lookupSelection':
          await lookupSelectionInDictionary(message.text);
          break;
        case 'addSelectionToCursorChat':
          this.activePanel = webviewPanel;
          this.updateSelectionContext();
          await vscode.commands.executeCommand('llm-wiki.addSelectionToCursorChat');
          break;
        case 'copySelectionForAgent':
          this.activePanel = webviewPanel;
          {
            const selection = normalizeSelectionMessage(message.selection);
            if (selection) activeWebview.selection = selection;
          }
          this.updateSelectionContext();
          {
            const selection = normalizeSelectionMessage(message.selection);
            const suppliedSelection = selection && selection.from !== selection.to
              ? this.getActiveSelectionContext()
              : undefined;
            await vscode.commands.executeCommand<boolean>(
              'llm-wiki.copySelectionForAgent',
              suppliedSelection,
            );
          }
          break;
        case 'renameTitle': {
          if (document.isUntitled) return;
          if (typeof message.title !== 'string') return;
          if (!await flushBeforeSave()) break;
          await renameMarkdownDocumentTitle(document, message.title);
          break;
        }
        case 'error': {
          const detail = typeof message.message === 'string' ? message.message : 'Unknown webview error';
          vscode.window.showErrorMessage(`LLM Wiki Markdown: ${detail}`);
          break;
        }
      }
    });

    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);
    this.postAgentHandoffCapabilities(webviewPanel.webview);
    pushSettings();
    pushVimMode();
    initialTextTimeout = setTimeout(() => {
      initialTextTimeout = undefined;
      void ensureInitialText();
    }, 250);
    setTimeout(pushPendingReveal, 260);
  }

  getActiveSelectionContext(): SelectionContext | undefined {
    const active = this.getActiveWebview();
    if (!active) return undefined;
    return this.selectionContext(active);
  }

  private selectionContext(active: ActiveMarkdownWebview): SelectionContext {
    const text = active.document.getText();
    const selection = active.selection ?? { from: 0, to: 0 };
    const from = clampOffset(Math.min(selection.from, selection.to), text.length);
    const to = clampOffset(Math.max(selection.from, selection.to), text.length);
    const exportsWholeDocument = from === to;
    const selectedText = exportsWholeDocument ? text : text.slice(from, to);
    const lineRangeFrom = exportsWholeDocument ? 0 : from;
    const lineRangeTo = exportsWholeDocument ? text.length : to;

    const lineRange = inclusiveLineRange(
      active.document,
      lineRangeFrom,
      lineRangeTo,
    );
    return {
      uri: active.document.uri,
      text: selectedText,
      ...lineRange,
      metadata: {
        kind: 'markdown',
        from: lineRangeFrom,
        to: lineRangeTo,
      },
    };
  }

  async postCopySelectionForAgentResult(ok: boolean): Promise<void> {
    await this.getActiveWebview()?.postMessage({
      type: 'copySelectionForAgentResult',
      ok,
    });
  }

  private updateVimModeContext(): void {
    void vscode.commands.executeCommand(
      'setContext',
      MarkdownEditorProvider.vimModeContextKey,
      this.vimModeEnabled,
    );
  }

  private updateSelectionContext(): void {
    const active = this.activePanel && this.webviews.get(this.activePanel);
    const selection = active?.selection;
    void vscode.commands.executeCommand(
      'setContext',
      MarkdownEditorProvider.selectionContextKey,
      Boolean(active?.panel.active && selection && selection.from !== selection.to),
    );
  }

  private postAgentHandoffCapabilities(webview: vscode.Webview): void {
    void webview.postMessage(agentHandoffCapabilitiesMessage(this.agentCapabilities()));
  }

  private broadcastAgentHandoffCapabilities(): void {
    const message = agentHandoffCapabilitiesMessage(this.agentCapabilities());
    for (const active of this.webviews.values()) {
      void active.postMessage(message);
    }
  }

  private getActiveWebview(): ActiveMarkdownWebview | undefined {
    const remembered = this.activePanel ? this.webviews.get(this.activePanel) : undefined;
    const visible = [...this.webviews.values()].find(candidate => candidate.panel.active);
    const tabUri = (
      vscode.window.tabGroups?.activeTabGroup?.activeTab?.input as { uri?: vscode.Uri } | undefined
    )?.uri?.toString();
    const active = (remembered?.panel.active ? remembered : undefined)
      ?? visible
      ?? (tabUri
        ? [...this.webviews.values()].find(candidate => candidate.document.uri.toString() === tabUri)
        : undefined)
      ?? remembered;
    if (active) this.activePanel = active.panel;
    return active;
  }

  private async postQueryAnnotations(
    document: vscode.TextDocument,
    postMessage: (message: unknown) => Thenable<boolean>,
  ): Promise<void> {
    if (this.queryAnnotationIndex) {
      try {
        const sourcePath = vscode.workspace.asRelativePath(document.uri, false);
        const annotations = await this.queryAnnotationIndex.listAnnotationsForSource(sourcePath);
        const diagnostics: vscode.Diagnostic[] = [];
        const resolved = annotations.flatMap(annotation => {
          if (annotation.anchor.kind !== 'markdown') return [];
          const resolution = resolveMarkdownAnchor(annotation.anchor, document.getText());
          if (!resolution.range) {
            if (resolution.diagnostic) {
              const line = Math.max(0, (annotation.anchor.startLine ?? 1) - 1);
              const diagnostic = new vscode.Diagnostic(
                new vscode.Range(line, 0, line, 1),
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
            ...(annotation.compatibility ? { compatibility: annotation.compatibility } : {}),
            ...(annotation.anchor.quote ? { quote: annotation.anchor.quote } : {}),
            from: resolution.range.from,
            to: resolution.range.to,
          }];
        });
        this.queryDiagnostics?.set(document.uri, diagnostics);
        await postMessage({ type: 'setQueryAnnotations', annotations: resolved });
      } catch {
        this.queryDiagnostics?.delete(document.uri);
        await postMessage({ type: 'setQueryAnnotations', annotations: [] });
      }
      return;
    }
    if (!this.learningNoteStore) {
      await postMessage({ type: 'setLearningAnnotations', annotations: [] });
      return;
    }
    try {
      const sourcePath = vscode.workspace.asRelativePath(document.uri, false);
      const annotations = await this.learningNoteStore.listAnnotationsForSource(sourcePath);
      await postMessage({ type: 'setLearningAnnotations', annotations });
    } catch {
      await postMessage({ type: 'setLearningAnnotations', annotations: [] });
    }
  }

  private async markdownNotePaths(documentUri: vscode.Uri): Promise<string[]> {
    const workspaceRoot = workspaceRootUri(documentUri);
    const currentPath = documentRelativePath(documentUri);
    if (!workspaceRoot) return currentPath ? [currentPath] : [];

    const cacheKey = workspaceRoot.toString();
    const now = Date.now();
    let cached = this.markdownNotePathCache.get(cacheKey);
    if (!cached || cached.expiresAt <= now) {
      const created: {
        expiresAt: number;
        paths: Promise<string[]>;
      } = {
        expiresAt: now + 30_000,
        paths: Promise.resolve([]),
      };
      created.paths = discoverMarkdownNotePaths(workspaceRoot).catch(() => {
        if (this.markdownNotePathCache.get(cacheKey) === created) {
          this.markdownNotePathCache.delete(cacheKey);
        }
        return [];
      });
      cached = created;
      this.markdownNotePathCache.set(cacheKey, created);
    }

    const paths = await cached.paths;
    if (!currentPath || paths.includes(currentPath)) return paths;
    return [...paths, currentPath].sort((left, right) => left.localeCompare(right));
  }

  private resolvePendingInsertion(requestId: string, applied: boolean): void {
    const pending = this.pendingInsertions.get(requestId);
    if (!pending) return;
    this.pendingInsertions.delete(requestId);
    clearTimeout(pending.timeout);
    pending.resolve(applied);
  }

  private resolvePendingSelectionRequest(requestId: string): void {
    const pending = this.pendingSelectionRequests.get(requestId);
    if (!pending) return;
    this.pendingSelectionRequests.delete(requestId);
    clearTimeout(pending.timeout);
    pending.resolve();
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = String(Date.now());
    const scriptUri = webview.asWebviewUri(
      versionedMarkdownEditorScriptUri(this.context.extensionUri),
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data: https: http:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LLM Wiki Markdown</title>
  <style>
    html, body, #editor { height: 100%; margin: 0; padding: 0; overflow: hidden; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
  </style>
</head>
<body>
  <div id="editor"></div>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }

  private getEditorPresentationSettings(): EditorPresentationSettings {
    const config = vscode.workspace.getConfiguration('editor');
    const fontFamily = normalizeNonEmptyString(config.get<string>('fontFamily'));
    const fontSize = normalizePixelValue(config.get<number>('fontSize'), 16);
    const fontWeight = normalizeFontWeight(config.get<string | number>('fontWeight'));
    const configuredLineHeight = normalizeNumber(config.get<number>('lineHeight'), 0);
    const minimumLineHeight = automaticEditorLineHeight(fontSize);
    const lineHeight = configuredLineHeight > 0
      ? Math.max(configuredLineHeight, minimumLineHeight)
      : minimumLineHeight;
    const letterSpacing = normalizeNumber(config.get<number>('letterSpacing'), 0);

    return {
      ...(fontFamily ? { fontFamily } : {}),
      fontSize: `${fontSize}px`,
      ...(fontWeight ? { fontWeight } : {}),
      lineHeight: `${lineHeight}px`,
      letterSpacing: `${letterSpacing}px`,
    };
  }

}

function markdownEditorTabForDocument(
  uri: vscode.Uri,
  viewColumn: vscode.ViewColumn | undefined,
): vscode.Tab | undefined {
  const candidates = markdownEditorTabsForUri(uri);
  return candidates.find(candidate => candidate.viewColumn === viewColumn)?.tab
    ?? candidates[0]?.tab;
}

function markdownEditorTabsForUri(
  uri: vscode.Uri,
): { tab: vscode.Tab; viewColumn: vscode.ViewColumn }[] {
  return (vscode.window.tabGroups?.all ?? []).flatMap(group =>
    (group.tabs ?? [])
      .filter(tab => tabMatchesMarkdownEditor(tab, uri))
      .map(tab => ({ tab, viewColumn: group.viewColumn })),
  );
}

function tabMatchesMarkdownEditor(tab: vscode.Tab, uri: vscode.Uri): boolean {
  const input = tab.input as { uri?: vscode.Uri; viewType?: unknown } | undefined;
  if (input?.viewType !== MarkdownEditorProvider.viewType) return false;
  // Untitled Markdown URIs carry a file-like fsPath. Include the scheme so an
  // unsaved note never closes a saved note with the same path.
  return input.uri?.scheme === uri.scheme && input.uri.fsPath === uri.fsPath;
}

function normalizeNonEmptyString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePixelValue(value: number | undefined, fallback: number): number {
  const normalized = normalizeNumber(value, fallback);
  return normalized > 0 ? normalized : fallback;
}

function automaticEditorLineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.5);
}

function normalizeNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const markdownEditorBundleVersion = Date.now().toString(36);

function versionedMarkdownEditorScriptUri(extensionUri: vscode.Uri): vscode.Uri {
  const source = vscode.Uri.joinPath(extensionUri, 'dist', 'markdown-editor.js');
  return source.with({ query: `v=${markdownEditorBundleVersion}` });
}

function markdownEditorLocalResourceRoots(documentUri: vscode.Uri, extensionUri: vscode.Uri): vscode.Uri[] {
  const roots = [vscode.Uri.joinPath(extensionUri, 'dist')];
  const workspaceRoot = workspaceRootUri(documentUri);
  const documentDirectory = documentDirectoryUri(documentUri);
  if (workspaceRoot) {
    roots.push(workspaceRoot);
  } else if (documentDirectory) {
    roots.push(documentDirectory);
  }
  return roots;
}

function workspaceRootUri(documentUri: vscode.Uri): vscode.Uri | undefined {
  const fileUri = pathCalculationUri(documentUri);
  return fileUri ? vscode.workspace.getWorkspaceFolder(fileUri)?.uri : undefined;
}

function documentDirectoryUri(documentUri: vscode.Uri): vscode.Uri | undefined {
  const fileUri = pathCalculationUri(documentUri);
  if (!fileUri) return undefined;
  return vscode.Uri.file(path.dirname(fileUri.fsPath));
}

function documentRelativePath(documentUri: vscode.Uri): string | undefined {
  const fileUri = pathCalculationUri(documentUri);
  const workspaceRoot = workspaceRootUri(documentUri);
  if (!workspaceRoot || !fileUri || !isFileUri(workspaceRoot)) return undefined;
  const relativePath = path.relative(workspaceRoot.fsPath, fileUri.fsPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return undefined;
  return relativePath.split(path.sep).join('/');
}

/**
 * Standard Markdown destinations are relative to the note that contains the
 * link. URI schemes, document fragments, and absolute paths remain unchanged.
 */
export function resolveMarkdownEditorLink(
  target: string,
  currentNotePath: string | undefined,
): string {
  if (
    !currentNotePath
    || target.startsWith('#')
    || target.startsWith('/')
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)
  ) {
    return target;
  }
  const suffixIndex = target.search(/[?#]/);
  const linkPath = suffixIndex < 0 ? target : target.slice(0, suffixIndex);
  const suffix = suffixIndex < 0 ? '' : target.slice(suffixIndex);
  if (!linkPath) return target;
  const resolvedPath = path.posix.normalize(
    path.posix.join(path.posix.dirname(currentNotePath), linkPath),
  );
  if (resolvedPath === '..' || resolvedPath.startsWith('../')) return target;
  return `${resolvedPath}${suffix}`;
}

async function discoverMarkdownNotePaths(workspaceRoot: vscode.Uri): Promise<string[]> {
  const noteUris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceRoot, '**/*.md'),
    new vscode.RelativePattern(workspaceRoot, '**/{.git,node_modules}/**'),
    10_000,
  );
  return noteUris
    .map(documentRelativePath)
    .filter((notePath): notePath is string => Boolean(notePath))
    .sort((a, b) => a.localeCompare(b));
}

function webviewResourceUriString(webview: vscode.Webview, uri: vscode.Uri | undefined): string | undefined {
  if (!uri) return undefined;
  return ensureTrailingSlash(webview.asWebviewUri(uri).toString());
}

function ensureTrailingSlash(uri: string): string {
  return uri.endsWith('/') ? uri : `${uri}/`;
}

function isFileUri(uri: vscode.Uri): boolean {
  return uri.scheme === 'file' || (!uri.scheme && typeof uri.fsPath === 'string' && uri.fsPath.length > 0);
}

function pathCalculationUri(uri: vscode.Uri): vscode.Uri | undefined {
  if (isFileUri(uri)) return uri;
  if (uri.scheme === 'untitled' && typeof uri.fsPath === 'string' && uri.fsPath.length > 0) {
    return vscode.Uri.file(uri.fsPath);
  }
  return undefined;
}

function normalizeFontWeight(value: number | string | undefined): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string') {
    return normalizeNonEmptyString(value);
  }
  return undefined;
}

function noteTitleFromUri(uri: vscode.Uri): string {
  const fileUri = pathCalculationUri(uri);
  const rawPath = fileUri?.fsPath ?? uri.path;
  const filename = rawPath.split(/[\\/]/).pop() ?? '';
  return filename.replace(/\.md$/i, '');
}

async function renameMarkdownDocumentTitle(document: vscode.TextDocument, title: string): Promise<vscode.Uri | undefined> {
  if (document.isUntitled) return undefined;
  const nextTitle = normalizeNoteTitle(title);
  if (!nextTitle || nextTitle === noteTitleFromUri(document.uri)) return undefined;
  const targetUri = vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), `${nextTitle}.md`));
  const edit = new vscode.WorkspaceEdit();
  edit.renameFile(document.uri, targetUri, { overwrite: false });
  if (!await vscode.workspace.applyEdit(edit)) {
    throw new Error('The editor rejected the markdown note rename.');
  }
  return targetUri;
}

function normalizeNoteTitle(title: string): string | undefined {
  const normalized = title
    .replace(/[\\/:\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeSelectionMessage(selection: unknown): RevealSelection | undefined {
  if (!selection || typeof selection !== 'object') return undefined;
  const maybeSelection = selection as { from?: unknown; to?: unknown };
  if (typeof maybeSelection.from !== 'number' || typeof maybeSelection.to !== 'number') {
    return undefined;
  }
  if (!Number.isFinite(maybeSelection.from) || !Number.isFinite(maybeSelection.to)) {
    return undefined;
  }
  return {
    from: Math.trunc(maybeSelection.from),
    to: Math.trunc(maybeSelection.to),
  };
}

function webviewEditText(
  message: Record<string, unknown>,
  currentText: string | undefined,
): string | undefined {
  if (typeof message.text === 'string') return message.text;
  if (
    currentText === undefined
    || message.baseLength !== currentText.length
    || !Array.isArray(message.changes)
  ) return undefined;

  let cursor = 0;
  let result = '';
  for (const candidate of message.changes) {
    if (!candidate || typeof candidate !== 'object') return undefined;
    const change = candidate as Record<string, unknown>;
    if (
      typeof change.from !== 'number'
      || typeof change.to !== 'number'
      || typeof change.text !== 'string'
      || !Number.isSafeInteger(change.from)
      || !Number.isSafeInteger(change.to)
      || change.from < cursor
      || change.to < change.from
      || change.to > currentText.length
    ) return undefined;
    result += currentText.slice(cursor, change.from) + change.text;
    cursor = change.to;
  }
  return result + currentText.slice(cursor);
}

function clampOffset(offset: number, documentLength: number): number {
  return Math.max(0, Math.min(documentLength, offset));
}
