import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { LearningNoteStore } from './learningNoteStore';
import type { SelectionContext } from './selectionContext';

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

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'human-learning.markdownEditor';
  private static readonly vimModeStorageKey = 'markdownVimMode';
  private static readonly vimModeContextKey = 'humanLearningMarkdownVimMode';
  private static readonly selectionContextKey = 'humanLearningMarkdownHasSelection';

  private readonly webviews = new Map<vscode.WebviewPanel, ActiveMarkdownWebview>();
  private readonly pendingReveals = new Map<string, RevealSelection>();
  private readonly pendingInsertions = new Map<string, PendingInsertion>();
  private readonly pendingSelectionRequests = new Map<string, PendingSelectionRequest>();
  private activePanel: vscode.WebviewPanel | undefined;
  private vimModeEnabled: boolean;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly learningNoteStore?: LearningNoteStore,
  ) {
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
    let autoSaveHandle: ReturnType<typeof setTimeout> | undefined;

    const clearAutoSave = () => {
      if (!autoSaveHandle) return;
      clearTimeout(autoSaveHandle);
      autoSaveHandle = undefined;
    };

    const scheduleAutoSave = () => {
      clearAutoSave();
      autoSaveHandle = setTimeout(() => {
        autoSaveHandle = undefined;
        if (!document.isClosed) {
          void document.save();
        }
      }, 150);
    };

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
        title: path.basename(document.uri.fsPath, path.extname(document.uri.fsPath)),
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
          await replaceDocument(document, nextText);
          scheduleAutoSave();
        }
      } finally {
        applyingWebviewEdit = false;
      }
      if (pendingWebviewText !== undefined) {
        await applyQueuedWebviewEdits();
      }
    };

    const restoreLatestWebviewText = () => {
      if (latestWebviewDocumentText === undefined || latestWebviewDocumentText === document.getText()) return;
      pendingWebviewText = latestWebviewDocumentText;
      void applyQueuedWebviewEdits().catch(error => {
        vscode.window.showErrorMessage(`Failed to update markdown note: ${String(error)}`);
      });
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
    webviewPanel.onDidDispose(() => clearAutoSave());
    webviewPanel.onDidDispose(() => {
      this.webviews.delete(webviewPanel);
      if (this.activePanel === webviewPanel) {
        this.activePanel = [...this.webviews.keys()].find(panel => panel.active);
        this.updateSelectionContext();
      }
    });

    webviewPanel.onDidChangeViewState(() => {
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
          void applyQueuedWebviewEdits().catch(error => {
            vscode.window.showErrorMessage(`Failed to update markdown note: ${String(error)}`);
          });
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
          clearAutoSave();
          await document.save();
          break;
        case 'close':
          clearAutoSave();
          webviewPanel.dispose();
          break;
        case 'saveAndClose':
          clearAutoSave();
          await document.save();
          webviewPanel.dispose();
          break;
        case 'openUri':
          if (typeof message.uri === 'string') {
            await vscode.commands.executeCommand(
              'human-learning.openLinkTarget',
              resolveMarkdownEditorLink(message.uri, documentRelativePath(document.uri)),
            );
          }
          break;
        case 'openLearningNote':
          if (
            typeof message.notePath !== 'string'
            || typeof message.discussionId !== 'string'
            || path.isAbsolute(message.notePath)
          ) return;
          await vscode.commands.executeCommand('human-learning.openLearningDiscussion', {
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
          await vscode.commands.executeCommand('human-learning.addSelectionToCursorChat');
          break;
        case 'renameTitle': {
          if (typeof message.title !== 'string') return;
          const renamedUri = await renameMarkdownDocumentTitle(document, message.title);
          if (!renamedUri) return;
          await vscode.commands.executeCommand('vscode.openWith', renamedUri, MarkdownEditorProvider.viewType);
          break;
        }
        case 'error': {
          const detail = typeof message.message === 'string' ? message.message : 'Unknown webview error';
          vscode.window.showErrorMessage(`Human Learning Markdown: ${detail}`);
          break;
        }
      }
    });

    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);
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

    return {
      uri: active.document.uri,
      text: selectedText,
      startLine: active.document.positionAt(lineRangeFrom).line + 1,
      endLine: active.document.positionAt(lineRangeTo).line + 1,
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
  <title>Human Learning Markdown</title>
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
  await vscode.workspace.applyEdit(edit);
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
  return vscode.workspace.getWorkspaceFolder(documentUri)?.uri;
}

function documentDirectoryUri(documentUri: vscode.Uri): vscode.Uri | undefined {
  if (!isFileUri(documentUri)) return undefined;
  return vscode.Uri.file(path.dirname(documentUri.fsPath));
}

function documentRelativePath(documentUri: vscode.Uri): string | undefined {
  const workspaceRoot = workspaceRootUri(documentUri);
  if (!workspaceRoot || !isFileUri(documentUri) || !isFileUri(workspaceRoot)) return undefined;
  const relativePath = path.relative(workspaceRoot.fsPath, documentUri.fsPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return undefined;
  return relativePath.split(path.sep).join('/');
}

/**
 * Generated notes use explicit ./ and ../ destinations relative to the note
 * that contains the link. Existing vault-root links remain unchanged.
 */
export function resolveMarkdownEditorLink(
  target: string,
  currentNotePath: string | undefined,
): string {
  if (!currentNotePath || (!target.startsWith('./') && !target.startsWith('../'))) {
    return target;
  }
  const fragmentIndex = target.indexOf('#');
  const linkPath = fragmentIndex < 0 ? target : target.slice(0, fragmentIndex);
  const fragment = fragmentIndex < 0 ? '' : target.slice(fragmentIndex);
  const resolvedPath = path.posix.normalize(
    path.posix.join(path.posix.dirname(currentNotePath), linkPath),
  );
  if (resolvedPath === '..' || resolvedPath.startsWith('../')) return target;
  return `${resolvedPath}${fragment}`;
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
  const rawPath = typeof uri.fsPath === 'string' && uri.fsPath.length > 0
    ? uri.fsPath
    : uri.path;
  const filename = rawPath.split(/[\\/]/).pop() ?? '';
  return filename.replace(/\.md$/i, '');
}

async function renameMarkdownDocumentTitle(document: vscode.TextDocument, title: string): Promise<vscode.Uri | undefined> {
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

function clampOffset(offset: number, documentLength: number): number {
  return Math.max(0, Math.min(documentLength, offset));
}
