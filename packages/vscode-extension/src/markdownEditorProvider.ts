import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { SelectionContext } from './selectionContext';

interface ActiveMarkdownWebview {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  selection?: RevealSelection;
  postMessage(message: unknown): Thenable<boolean>;
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

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'human-learning.markdownEditor';
  private static readonly vimModeStorageKey = 'markdownVimMode';

  private readonly webviews = new Map<string, ActiveMarkdownWebview>();
  private readonly pendingReveals = new Map<string, RevealSelection>();
  private activeKey: string | undefined;
  private vimModeEnabled: boolean;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.vimModeEnabled = Boolean(
      this.context.workspaceState?.get<boolean>(MarkdownEditorProvider.vimModeStorageKey, false),
    );
  }

  async insertMarkdown(markdown: string): Promise<boolean> {
    const active = this.activeKey ? this.webviews.get(this.activeKey) : undefined;
    if (!active) return false;
    return active.postMessage({ type: 'insertText', text: markdown });
  }

  async toggleVimMode(): Promise<boolean> {
    this.vimModeEnabled = !this.vimModeEnabled;
    await this.context.workspaceState?.update(
      MarkdownEditorProvider.vimModeStorageKey,
      this.vimModeEnabled,
    );
    for (const webview of this.webviews.values()) {
      void webview.postMessage({ type: 'setVimMode', enabled: this.vimModeEnabled });
    }
    return this.vimModeEnabled;
  }

  async revealInEditor(uri: vscode.Uri, selection: RevealSelection): Promise<void> {
    const key = uri.toString();
    this.pendingReveals.set(key, selection);
    const webview = this.webviews.get(key);
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
    this.webviews.set(key, {
      panel: webviewPanel,
      document,
      postMessage: (message: unknown) => webviewPanel.webview.postMessage(message),
    });
    if (webviewPanel.active) {
      this.activeKey = key;
    }

    let applyingWebviewEdit = false;
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
      webviewPanel.webview.postMessage({
        type: 'setText',
        text: document.getText(),
        title: noteTitleFromUri(document.uri),
        currentNotePath: documentRelativePath(document.uri),
        notePaths: await markdownNotePaths(document.uri),
        resourceBaseUri: webviewResourceUriString(webviewPanel.webview, documentDirectoryUri(document.uri)),
        resourceRootUri: webviewResourceUriString(webviewPanel.webview, workspaceRootUri(document.uri)),
      });
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

    const changeSub = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() !== document.uri.toString()) return;
      if (applyingWebviewEdit) {
        applyingWebviewEdit = false;
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
      this.webviews.delete(key);
      if (this.activeKey === key) {
        this.activeKey = undefined;
      }
    });

    webviewPanel.onDidChangeViewState(() => {
      if (webviewPanel.active) {
        this.activeKey = key;
        requestFocus();
      }
    });

    webviewPanel.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
      const message = asMessageRecord(rawMessage);
      switch (message?.type) {
        case 'ready':
          webviewPanel.reveal(undefined, false);
          pushSettings();
          pushVimMode();
          void pushText();
          pushPendingReveal();
          requestFocus();
          break;
        case 'edit':
          if (typeof message.text !== 'string' || message.text === document.getText()) return;
          applyingWebviewEdit = true;
          await replaceDocument(document, message.text);
          scheduleAutoSave();
          break;
        case 'selectionChanged': {
          const selection = normalizeSelectionMessage(message.selection);
          if (selection) {
            const active = this.webviews.get(key);
            if (active) active.selection = selection;
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
            await vscode.commands.executeCommand('human-learning.openLinkTarget', message.uri);
          }
          break;
        case 'copyText':
          if (typeof message.text === 'string') {
            await vscode.env.clipboard.writeText(message.text);
          }
          break;
        case 'renameTitle': {
          if (typeof message.title !== 'string') return;
          const renamedUri = await renameMarkdownDocumentTitle(document, message.title);
          if (!renamedUri) return;
          await vscode.commands.executeCommand('vscode.openWith', renamedUri, MarkdownEditorProvider.viewType);
          break;
        }
        case 'error':
          vscode.window.showErrorMessage(`Human Learning Markdown: ${message.message}`);
          break;
      }
    });

    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);
    pushSettings();
    pushVimMode();
    setTimeout(() => void pushText(), 250);
    setTimeout(pushPendingReveal, 260);
  }

  getActiveSelectionContext(): SelectionContext | undefined {
    const active = this.activeKey ? this.webviews.get(this.activeKey) : undefined;
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
    };
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
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getEditorPresentationSettings(): EditorPresentationSettings {
    const config = vscode.workspace.getConfiguration('editor');
    const fontSize = normalizePixelValue(config.get<number>('fontSize'), 14);
    const fontWeight = normalizeFontWeight(config.get<string | number>('fontWeight'));
    const configuredLineHeight = normalizeNumber(config.get<number>('lineHeight'), 0);
    const lineHeight = configuredLineHeight > 0
      ? configuredLineHeight
      : Math.round(fontSize * 1.55);
    const letterSpacing = normalizeNumber(config.get<number>('letterSpacing'), 0);

    return {
      fontSize: `${fontSize}px`,
      ...(fontWeight ? { fontWeight } : {}),
      lineHeight: `${lineHeight}px`,
      letterSpacing: `${letterSpacing}px`,
    };
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

function normalizeNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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

async function markdownNotePaths(documentUri: vscode.Uri): Promise<string[]> {
  const workspaceRoot = workspaceRootUri(documentUri);
  const currentPath = documentRelativePath(documentUri);
  if (!workspaceRoot) return currentPath ? [currentPath] : [];

  const noteUris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceRoot, 'notes/**/*.md'),
    undefined,
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
