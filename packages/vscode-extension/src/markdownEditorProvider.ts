import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { LearningNoteStore } from './learningNoteStore';
import type { SelectionContext } from './selectionContext';
import type {
  AgentHandoffCapability,
  AgentSurfaceCapabilities,
  ExternalAgentId,
} from './agentHandoff';

interface ActiveMarkdownWebview {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  selection?: RevealSelection;
  postMessage: (message: unknown) => Thenable<boolean>;
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
  private activePanel: vscode.WebviewPanel | undefined;
  private vimModeEnabled: boolean;
  private readonly agentCapabilities: () => AgentSurfaceCapabilities;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly learningNoteStore?: LearningNoteStore,
    options: MarkdownEditorProviderOptions = {},
  ) {
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
    await Promise.all([...this.webviews.values()].map(async active => {
      await this.postLearningAnnotations(active.document, active.postMessage);
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
    return this.getActiveSelectionContext();
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
        this.context.globalStorageUri,
      ),
    };
    const key = document.uri.toString();
    const activeWebview: ActiveMarkdownWebview = {
      panel: webviewPanel,
      document,
      postMessage: (message: unknown) => webviewPanel.webview.postMessage(message),
    };
    this.webviews.set(webviewPanel, activeWebview);
    if (webviewPanel.active) {
      this.activePanel = webviewPanel;
    }

    let applyingWebviewEdit = false;
    let pendingWebviewText: string | undefined;
    let latestWebviewDocumentText: string | undefined;
    const recentWebviewDocumentTexts = new Set<string>();
    const recentWebviewDocumentTextOrder: string[] = [];
    let suppressedWebviewDocumentChanges = 0;
    let queuedWebviewEditPromise: Promise<void> | undefined;
    let closingEditorTab = false;
    let panelViewColumn = webviewPanel.viewColumn;
    let unappliedWebviewText: string | undefined;

    const pushSettings = () => {
      webviewPanel.webview.postMessage({
        type: 'updateSettings',
        settings: this.getEditorPresentationSettings(),
      });
    };

    const pushText = async () => {
      await webviewPanel.webview.postMessage({
        type: 'setText',
        text: document.getText(),
        title: noteTitleFromUri(document.uri),
        currentNotePath: documentRelativePath(document.uri),
        notePaths: await markdownNotePaths(document.uri),
        resourceBaseUri: webviewResourceUriString(webviewPanel.webview, documentDirectoryUri(document.uri)),
        resourceRootUri: webviewResourceUriString(webviewPanel.webview, workspaceRootUri(document.uri)),
      });
      await this.postLearningAnnotations(
        document,
        message => webviewPanel.webview.postMessage(message),
      );
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

    const rememberWebviewDocumentText = (text: string) => {
      latestWebviewDocumentText = text;
      if (recentWebviewDocumentTexts.has(text)) return;
      recentWebviewDocumentTexts.add(text);
      recentWebviewDocumentTextOrder.push(text);
      if (recentWebviewDocumentTextOrder.length > 20) {
        const staleText = recentWebviewDocumentTextOrder.shift();
        if (staleText !== undefined) recentWebviewDocumentTexts.delete(staleText);
      }
    };

    const applyQueuedWebviewEdits = async () => {
      if (applyingWebviewEdit) return;
      applyingWebviewEdit = true;
      try {
        while (pendingWebviewText !== undefined) {
          const nextText = pendingWebviewText;
          pendingWebviewText = undefined;
          rememberWebviewDocumentText(nextText);
          if (nextText === document.getText()) continue;
          suppressedWebviewDocumentChanges += 1;
          try {
            await replaceDocument(document, nextText);
          } catch (error) {
            // A rejected WorkspaceEdit emits no document change event. Keep the
            // text around so an explicit save/close can retry rather than
            // silently persisting the previous buffer.
            suppressedWebviewDocumentChanges -= 1;
            unappliedWebviewText = nextText;
            throw error;
          }
          unappliedWebviewText = undefined;
        }
      } finally {
        applyingWebviewEdit = false;
      }
    };

    const reportWebviewEditFailure = (error: unknown) => {
      vscode.window.showErrorMessage(`Failed to update markdown note: ${String(error)}`);
    };

    const queueWebviewEdits = (): Promise<void> => {
      if (!queuedWebviewEditPromise) {
        queuedWebviewEditPromise = applyQueuedWebviewEdits().finally(() => {
          queuedWebviewEditPromise = undefined;
          if (pendingWebviewText !== undefined) {
            void queueWebviewEdits().catch(reportWebviewEditFailure);
          }
        });
      }
      return queuedWebviewEditPromise;
    };

    const flushQueuedWebviewEdits = async (): Promise<void> => {
      while (queuedWebviewEditPromise || pendingWebviewText !== undefined) {
        await (queuedWebviewEditPromise ?? queueWebviewEdits());
      }
    };

    // Saving or closing with an unapplied edit would lose user input. Retry a
    // failed replacement once, then abort the operation and surface the error.
    const flushBeforeSave = async (): Promise<boolean> => {
      const attemptFlush = async (): Promise<boolean> => {
        try {
          await flushQueuedWebviewEdits();
        } catch {
          return false;
        }
        return unappliedWebviewText === undefined;
      };

      if (await attemptFlush()) return true;
      if (unappliedWebviewText !== undefined) {
        pendingWebviewText = unappliedWebviewText;
        if (await attemptFlush()) return true;
      }
      vscode.window.showErrorMessage(
        'Markdown note not saved because the latest edit could not be applied.',
      );
      return false;
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

    const restoreLatestWebviewText = () => {
      if (latestWebviewDocumentText === undefined || latestWebviewDocumentText === document.getText()) return;
      pendingWebviewText = latestWebviewDocumentText;
      void queueWebviewEdits().catch(reportWebviewEditFailure);
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() !== document.uri.toString()) return;
      const currentText = document.getText();
      if (suppressedWebviewDocumentChanges > 0) {
        suppressedWebviewDocumentChanges -= 1;
        if (recentWebviewDocumentTexts.has(currentText) && currentText !== latestWebviewDocumentText) {
          restoreLatestWebviewText();
        }
        return;
      }
      if (recentWebviewDocumentTexts.has(currentText)) {
        if (currentText !== latestWebviewDocumentText) {
          restoreLatestWebviewText();
        }
        return;
      }
      void pushText();
    });

    const configSub = vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('editor')) {
        pushSettings();
      }
    });

    webviewPanel.onDidDispose(() => changeSub.dispose());
    webviewPanel.onDidDispose(() => configSub.dispose());
    webviewPanel.onDidDispose(() => {
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
      const message = asMessageRecord(rawMessage);
      switch (message?.type) {
        case 'active':
          this.activePanel = webviewPanel;
          this.updateSelectionContext();
          break;
        case 'ready':
          webviewPanel.reveal(undefined, false);
          this.postAgentHandoffCapabilities(webviewPanel.webview);
          pushSettings();
          pushVimMode();
          void pushText();
          pushPendingReveal();
          requestFocus();
          break;
        case 'edit':
          if (typeof message.text !== 'string') return;
          rememberWebviewDocumentText(message.text);
          pendingWebviewText = message.text;
          void queueWebviewEdits().catch(reportWebviewEditFailure);
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
        case 'copyText':
          if (typeof message.text === 'string') {
            await vscode.env.clipboard.writeText(message.text);
          }
          break;
        case 'lookupSelection':
          await this.lookupSelection(message.text);
          break;
        case 'addSelectionToCursorChat':
          this.activePanel = webviewPanel;
          this.updateSelectionContext();
          await vscode.commands.executeCommand('llm-wiki.addSelectionToCursorChat');
          break;
        case 'sendToAgent': {
          if (!isExternalAgentId(message.agentId)) return;
          this.activePanel = webviewPanel;
          this.updateSelectionContext();
          await vscode.commands.executeCommand('llm-wiki.addSelectionToAgent', {
            agentId: message.agentId,
            selection: this.getActiveSelectionContext(),
          });
          break;
        }
        case 'renameTitle': {
          if (document.isUntitled) return;
          if (typeof message.title !== 'string') return;
          const renamedUri = await renameMarkdownDocumentTitle(document, message.title);
          if (!renamedUri) return;
          await vscode.commands.executeCommand('vscode.openWith', renamedUri, MarkdownEditorProvider.viewType);
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
    setTimeout(() => void pushText(), 250);
    setTimeout(pushPendingReveal, 260);
  }

  getActiveSelectionContext(): SelectionContext | undefined {
    const active = this.getActiveWebview();
    if (!active) return undefined;

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
    void webview.postMessage(this.agentHandoffCapabilitiesMessage());
  }

  private broadcastAgentHandoffCapabilities(): void {
    const message = this.agentHandoffCapabilitiesMessage();
    for (const active of this.webviews.values()) {
      void active.postMessage(message);
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

  private async postLearningAnnotations(
    document: vscode.TextDocument,
    postMessage: (message: unknown) => Thenable<boolean>,
  ): Promise<void> {
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
      versionedMarkdownEditorScriptUri(this.context.extensionUri, this.context.globalStorageUri),
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
    const fontSize = Math.max(16, normalizePixelValue(config.get<number>('fontSize'), 16));
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
}

async function replaceDocument(document: vscode.TextDocument, text: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const lastLine = document.lineAt(document.lineCount - 1);
  edit.replace(
    document.uri,
    new vscode.Range(0, 0, document.lineCount - 1, lastLine.text.length),
    text,
  );
  if (!await vscode.workspace.applyEdit(edit)) {
    throw new Error('The editor rejected the markdown update.');
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

function normalizeLookupText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text.slice(0, 200) : undefined;
}

function versionedMarkdownEditorScriptUri(extensionUri: vscode.Uri, globalStorageUri?: vscode.Uri): vscode.Uri {
  const source = vscode.Uri.joinPath(extensionUri, 'dist', 'markdown-editor.js');
  const version = markdownEditorBundleVersion(source);
  const fileName = `markdown-editor-${version}.js`;

  if (globalStorageUri?.fsPath && source.fsPath) {
    try {
      const cacheDir = path.join(globalStorageUri.fsPath, 'webview-cache');
      if (copyVersionedMarkdownEditorBundle(source.fsPath, cacheDir, fileName)) {
        return vscode.Uri.joinPath(globalStorageUri, 'webview-cache', fileName);
      }
    } catch {
      // Fall through to the extension-local cache. Some VS Code storage URIs are not local files.
    }
  }

  if (source.fsPath) {
    try {
      const distUri = vscode.Uri.joinPath(extensionUri, 'dist');
      const cacheDir = path.join(distUri.fsPath, 'webview-cache');
      if (copyVersionedMarkdownEditorBundle(source.fsPath, cacheDir, fileName)) {
        return vscode.Uri.joinPath(distUri, 'webview-cache', fileName);
      }
    } catch {
      // Fall through to the query-string fallback below.
    }
  }

  return source.with({ query: `v=${version}` });
}

function markdownEditorBundleVersion(source: vscode.Uri): string {
  try {
    const stat = fs.statSync(source.fsPath);
    return `${Math.trunc(stat.mtimeMs)}-${stat.size}`;
  } catch {
    return encodeURIComponent(String(Date.now()));
  }
}

function pruneStaleMarkdownEditorBundles(cacheDir: string, currentFileName: string): void {
  for (const fileName of fs.readdirSync(cacheDir)) {
    if (fileName === currentFileName) continue;
    if (!/^markdown-editor-\d+-\d+\.js$/.test(fileName)) continue;
    try {
      fs.unlinkSync(path.join(cacheDir, fileName));
    } catch {
      // Ignore stale-cache cleanup failures; the fresh bundle has already been copied.
    }
  }
}

function copyVersionedMarkdownEditorBundle(sourcePath: string, cacheDir: string, fileName: string): boolean {
  fs.mkdirSync(cacheDir, { recursive: true });
  const target = path.join(cacheDir, fileName);
  if (!fs.existsSync(target)) {
    fs.copyFileSync(sourcePath, target);
    pruneStaleMarkdownEditorBundles(cacheDir, fileName);
  }
  return true;
}

function markdownEditorLocalResourceRoots(documentUri: vscode.Uri, extensionUri: vscode.Uri, globalStorageUri?: vscode.Uri): vscode.Uri[] {
  const roots = [vscode.Uri.joinPath(extensionUri, 'dist')];
  if (globalStorageUri) {
    roots.push(globalStorageUri);
  }
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

async function markdownNotePaths(documentUri: vscode.Uri): Promise<string[]> {
  const workspaceRoot = workspaceRootUri(documentUri);
  const currentPath = documentRelativePath(documentUri);
  if (!workspaceRoot) return currentPath ? [currentPath] : [];

  const noteUris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceRoot, '**/*.md'),
    new vscode.RelativePattern(workspaceRoot, '**/{.git,node_modules}/**'),
    10_000,
  );
  const paths = noteUris
    .map(documentRelativePath)
    .filter((notePath): notePath is string => Boolean(notePath));
  if (currentPath && !paths.includes(currentPath)) {
    paths.push(currentPath);
  }
  return paths.sort((a, b) => a.localeCompare(b));
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
  await vscode.workspace.fs.rename(document.uri, targetUri, { overwrite: false });
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

function asMessageRecord(message: unknown): Record<string, unknown> | undefined {
  return message && typeof message === 'object'
    ? message as Record<string, unknown>
    : undefined;
}

function isExternalAgentId(value: unknown): value is ExternalAgentId {
  return value === 'codex' || value === 'claude' || value === 'codebuddy';
}

function clampOffset(offset: number, documentLength: number): number {
  return Math.max(0, Math.min(documentLength, offset));
}
