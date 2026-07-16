import * as vscode from 'vscode';
import { detectVaultRoot, type PdfTextFragment } from '@human-learning/core';
import { dispatchUri } from './uriDispatcher';
import { PdfEditorProvider } from './pdfEditorProvider';
import { addSelectionToContext } from './agentContext';
import { CodexAppServerClient } from './codexAppServerClient';
import { PdfDiscussionController } from './pdfDiscussionController';

let pdfEditorProvider: PdfEditorProvider;
let codexClient: CodexAppServerClient | undefined;
let pdfDiscussionController: PdfDiscussionController | undefined;
let codexOutputChannel: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const vaultRoot = detectVaultRoot(workspaceRoot);
  const documentRoot = vaultRoot ?? workspaceRoot;
  const codexCommand = typeof vscode.workspace.getConfiguration === 'function'
    ? vscode.workspace.getConfiguration('humanLearning.pdf').get<string>('codexCommand', 'codex')
    : 'codex';
  const outputChannel = vscode.window.createOutputChannel('Human Learning PDF — Codex');
  codexOutputChannel = outputChannel;
  codexClient = new CodexAppServerClient({
    executable: codexCommand,
    extensionVersion: String(context.extension?.packageJSON?.version ?? '0.1.0'),
    logger: message => outputChannel.appendLine(message),
  });
  pdfDiscussionController = new PdfDiscussionController({ client: codexClient });
  context.subscriptions.push(codexClient, pdfDiscussionController);

  pdfEditorProvider = new PdfEditorProvider(context, {
    vaultRoot: vaultRoot ?? undefined,
    documentRoot,
    globalStoragePath: context.globalStorageUri?.fsPath ?? context.extensionUri?.fsPath ?? documentRoot,
    discussionController: pdfDiscussionController,
    annotationsEnabled: Boolean(vaultRoot),
  });
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
      if (uri) await dispatchUri(documentRoot, uri);
    }),
    vscode.commands.registerCommand('human-learning.openLinkTarget', async (uri?: string) => {
      if (!uri) return;
      await dispatchUri(documentRoot, uri);
    }),
    vscode.commands.registerCommand('human-learning.addSelectionToContext', async () => {
      if (!vaultRoot) {
        vscode.window.showErrorMessage('Human Learning PDF: No vault found. Run `hl init` to create one.');
        return;
      }
      await addSelectionToContext(vaultRoot, {
        getActiveSelectionContext: () => pdfEditorProvider.getActiveSelectionContext(),
      });
    }),
    vscode.commands.registerCommand('human-learning.pdfAskSelection', async () => {
      await pdfEditorProvider.openAskPdfForSelection();
    }),
    vscode.commands.registerCommand('human-learning.openPdfTarget', async (args?: { pdfPath?: string; page?: number; textFragment?: PdfTextFragment }) => {
      if (!args?.pdfPath) {
        vscode.window.showErrorMessage('Missing PDF path');
        return;
      }
      await pdfEditorProvider.openPdfAtTarget(args.pdfPath, args.page, args.textFragment);
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

  vscode.window.showInformationMessage(
    vaultRoot
      ? `Human Learning PDF ready - vault at ${vaultRoot}`
      : `Human Learning PDF ready - document root at ${documentRoot}; annotations require \`hl init\``,
  );
}

export function deactivate() {
  pdfDiscussionController?.dispose();
  codexClient?.dispose();
  codexOutputChannel?.dispose();
  pdfDiscussionController = undefined;
  codexClient = undefined;
  codexOutputChannel = undefined;
}
