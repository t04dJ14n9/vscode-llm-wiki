import * as vscode from 'vscode';
import { closeDatabase, openDatabase, runMigrations, upsertWebTarget } from '@human-learning/core';
import type { MarkdownEditorProvider } from './markdownEditorProvider';

export class WebBrowserProvider {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly vaultRoot: string,
    private readonly _markdownEditorProvider: MarkdownEditorProvider,
  ) {}

  open(url: string): void {
    if (this.panel) {
      this.panel.reveal();
      this.panel.webview.postMessage({ type: 'navigate', url });
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'human-learning.webBrowser',
        'Web Browser',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      this.panel.webview.html = this.getHtml(url);
      this.panel.onDidDispose(() => { this.panel = undefined; }, null, this.context.subscriptions);
    }

    void this.saveTarget(url);
  }

  private async saveTarget(url: string): Promise<void> {
    try {
      const db = await openDatabase(this.vaultRoot);
      runMigrations(db);
      upsertWebTarget(db, { url });
      closeDatabase(db);
    } catch {
      // non-critical
    }
  }

  private getHtml(url: string): string {
    const escaped = url.replace(/"/g, '&quot;');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { display: flex; flex-direction: column; height: 100vh; font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-foreground); }
    #toolbar { display: flex; gap: 6px; padding: 6px 8px; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-panel-border); }
    #url-input { flex: 1; padding: 4px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; font-size: 13px; }
    #go-btn { padding: 4px 10px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; cursor: pointer; font-size: 13px; }
    #go-btn:hover { background: var(--vscode-button-hoverBackground); }
    #frame-container { flex: 1; position: relative; }
    #browser-frame { width: 100%; height: 100%; border: none; }
    #blocked-msg { display: none; position: absolute; inset: 0; align-items: center; justify-content: center; flex-direction: column; gap: 12px; text-align: center; padding: 24px; }
    #blocked-msg a { color: var(--vscode-textLink-foreground); }
  </style>
</head>
<body>
  <div id="toolbar">
    <input id="url-input" type="text" value="${escaped}" />
    <button id="go-btn">Go</button>
  </div>
  <div id="frame-container">
    <iframe id="browser-frame" src="${escaped}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
    <div id="blocked-msg">
      <p>This page cannot be displayed in the embedded browser.</p>
      <p><a id="open-link" href="#">Open in external browser</a></p>
    </div>
  </div>
  <script>
    const frame = document.getElementById('browser-frame');
    const input = document.getElementById('url-input');
    const goBtn = document.getElementById('go-btn');
    const blockedMsg = document.getElementById('blocked-msg');
    const openLink = document.getElementById('open-link');
    const vscode = acquireVsCodeApi();

    function navigate(url) {
      if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
      input.value = url;
      frame.src = url;
      openLink.href = url;
      blockedMsg.style.display = 'none';
      frame.style.display = 'block';
    }

    goBtn.addEventListener('click', () => navigate(input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') navigate(input.value); });
    openLink.addEventListener('click', e => {
      e.preventDefault();
      vscode.postMessage({ type: 'openExternal', url: input.value });
    });
    frame.addEventListener('error', () => {
      frame.style.display = 'none';
      blockedMsg.style.display = 'flex';
    });

    window.addEventListener('message', e => {
      if (e.data?.type === 'navigate') navigate(e.data.url);
    });
  </script>
</body>
</html>`;
  }
}
