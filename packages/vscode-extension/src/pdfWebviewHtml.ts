import * as vscode from 'vscode';

export function pdfWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
    extensionUri,
    'dist',
    'embedpdf-spike.js',
  ));
  const wasmUri = webview.asWebviewUri(vscode.Uri.joinPath(
    extensionUri,
    'dist',
    'pdfium.wasm',
  ));
  const nonce = String(Date.now());

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; img-src ${webview.cspSource} blob: data:; script-src 'nonce-${nonce}' ${webview.cspSource} 'wasm-unsafe-eval'; style-src ${webview.cspSource} 'unsafe-inline'; connect-src ${webview.cspSource} blob: data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LLM Wiki PDF</title>
  <style>
    html, body, #embedpdf-spike-root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font: 13px var(--vscode-font-family, system-ui, sans-serif); }
  </style>
</head>
<body>
  <div id="embedpdf-spike-root"></div>
  <script nonce="${nonce}">window.__pdfiumWasmUrl = ${JSON.stringify(wasmUri.toString())};</script>
  <script nonce="${nonce}" src="${scriptUri.toString()}?v=${nonce}"></script>
</body>
</html>`;
}
