import * as vscode from 'vscode';
import { detectVaultRoot } from '@human-learning/core';
import { dispatchUri } from './uriDispatcher';
import { PdfEditorProvider } from './pdfEditorProvider';

let pdfEditorProvider: PdfEditorProvider;

export function activate(context: vscode.ExtensionContext) {
  const vaultRoot = detectVaultRoot(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());

  if (!vaultRoot) {
    vscode.window.showInformationMessage('Human Learning PDF: No vault found. Run `hl init` to create one.');
    return;
  }

  pdfEditorProvider = new PdfEditorProvider(context, vaultRoot);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(PdfEditorProvider.viewType, pdfEditorProvider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('human-learning.openAnchor', async (uri?: string) => {
      if (!uri) {
        uri = await vscode.window.showInputBox({ prompt: 'Enter a PDF, note, code, web, or anchor link to open' });
      }
      if (uri) await dispatchUri(vaultRoot, uri);
    }),
    vscode.commands.registerCommand('human-learning.openLinkTarget', async (uri?: string) => {
      if (!uri) return;
      await dispatchUri(vaultRoot, uri);
    }),
    vscode.commands.registerCommand('human-learning.openPdfAtAnchor', async (args?: { pdfPath?: string; anchorId?: string; chunkId?: string; page?: number }) => {
      if (!args?.pdfPath) {
        vscode.window.showErrorMessage('Missing PDF path');
        return;
      }
      await pdfEditorProvider.openPdfAtAnchor(args.pdfPath, args.anchorId, args.page, args.chunkId);
    }),
    vscode.commands.registerCommand('human-learning.pdfPrevPage', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'navigate', direction: 'prev' });
    }),
    vscode.commands.registerCommand('human-learning.pdfNextPage', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'navigate', direction: 'next' });
    }),
    vscode.commands.registerCommand('human-learning.pdfZoomIn', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'zoom', delta: 0.15 });
    }),
    vscode.commands.registerCommand('human-learning.pdfZoomOut', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'zoom', delta: -0.15 });
    }),
    vscode.commands.registerCommand('human-learning.pdfFitWidth', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'fitWidth' });
    }),
    vscode.commands.registerCommand('human-learning.pdfToggleContinuousScroll', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'toggleContinuousScroll' });
    }),
    vscode.commands.registerCommand('human-learning.pdfToggleTwoPageView', () => {
      pdfEditorProvider.getActiveWebview()?.postMessage({ type: 'toggleTwoPageView' });
    }),
  );

  vscode.window.showInformationMessage(`Human Learning PDF ready - vault at ${vaultRoot}`);
}

export function deactivate() {}
