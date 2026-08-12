import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs';
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import * as vscode from 'vscode';
import {
  ANCHOR_FILE_MAX_BYTES,
  parseAnchorFilePayload,
} from './anchorFileCodec';
import type {
  ANCHOR_FILE_VERSION,
  AnchorFilePayload,
} from './anchorFileCodec';
import { dispatchUri } from './uriDispatcher';

export const ANCHOR_FILE_VIEW_TYPE = 'llm-wiki.anchorFile';
export {
  ANCHOR_FILE_MAX_BYTES,
  ANCHOR_FILE_MAX_TARGET_CHARS,
  ANCHOR_FILE_VERSION,
  parseAnchorFilePayload,
} from './anchorFileCodec';

export interface AnchorFileEditorProviderOptions {
  readonly resolveVaultRoot?: (uri: vscode.Uri) => string | undefined;
  readonly dispatchTarget?: (
    vaultRoot: string,
    target: string,
  ) => Promise<void> | void;
  readonly closeAfterDispatch?: boolean;
}

export class AnchorFileDocument implements vscode.CustomDocument {
  constructor(
    readonly uri: vscode.Uri,
    readonly vaultRoot: string,
    readonly version: typeof ANCHOR_FILE_VERSION,
    readonly target: string,
  ) {}

  dispose(): void {}
}

export class AnchorFileEditorProvider
implements vscode.CustomReadonlyEditorProvider<AnchorFileDocument> {
  static readonly viewType = ANCHOR_FILE_VIEW_TYPE;

  private readonly dispatchTarget: (
    vaultRoot: string,
    target: string,
  ) => Promise<void>;
  private readonly closeAfterDispatch: boolean;
  private readonly resolveVaultRoot: (uri: vscode.Uri) => string | undefined;

  constructor(options: AnchorFileEditorProviderOptions = {}) {
    this.resolveVaultRoot = options.resolveVaultRoot
      ?? (uri => vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath);
    this.dispatchTarget = async (vaultRoot, target) => {
      if (options.dispatchTarget) {
        await options.dispatchTarget(vaultRoot, target);
      } else {
        await dispatchUri(vaultRoot, target);
      }
    };
    this.closeAfterDispatch = options.closeAfterDispatch !== false;
  }

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    token: vscode.CancellationToken,
  ): Promise<AnchorFileDocument> {
    throwIfCancelled(token);
    const vaultRoot = this.resolveVaultRoot(uri);
    if (!vaultRoot) {
      throw new Error('Anchor bridge file is not inside an open workspace folder.');
    }
    const payload = readAnchorFilePayload(uri, vaultRoot);
    throwIfCancelled(token);
    return new AnchorFileDocument(
      uri,
      resolve(vaultRoot),
      payload.version,
      payload.target,
    );
  }

  async resolveCustomEditor(
    document: AnchorFileDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: false,
      localResourceRoots: [],
    };
    webviewPanel.webview.html = renderAnchorFileStatus(
      'Opening linked passage…',
      'LLM Wiki is handing this anchor to its destination.',
    );
    throwIfCancelled(token);

    try {
      await this.dispatchTarget(document.vaultRoot, document.target);
      webviewPanel.webview.html = renderAnchorFileStatus(
        'Linked passage opened',
        'This temporary anchor file is safe to close.',
      );
      if (this.closeAfterDispatch) {
        await closeAnchorFileTab(document.uri);
      }
    } catch (error) {
      const message = errorMessage(error);
      webviewPanel.webview.html = renderAnchorFileStatus(
        'Could not open linked passage',
        message,
      );
      vscode.window.showErrorMessage(
        `LLM Wiki could not open this anchor: ${message}`,
      );
    }
  }
}

export function registerAnchorFileEditorProvider(
  context: vscode.ExtensionContext,
  options: AnchorFileEditorProviderOptions = {},
): AnchorFileEditorProvider {
  const provider = new AnchorFileEditorProvider(options);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      AnchorFileEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: false },
        supportsMultipleEditorsPerDocument: false,
      },
    ),
  );
  return provider;
}

export function readAnchorFilePayload(
  uri: vscode.Uri,
  vaultRoot: string,
): AnchorFilePayload {
  let descriptor: number | undefined;
  try {
    const expectedHash = assertAnchorFileLocation(uri, vaultRoot);
    const entry = lstatSync(uri.fsPath);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error('Anchor bridge must be a regular local file.');
    }
    if (entry.size > ANCHOR_FILE_MAX_BYTES) {
      throw new Error('Anchor bridge file is too large.');
    }

    const noFollow = typeof constants.O_NOFOLLOW === 'number'
      ? constants.O_NOFOLLOW
      : 0;
    descriptor = openSync(uri.fsPath, constants.O_RDONLY | noFollow);
    const opened = fstatSync(descriptor);
    if (!opened.isFile()) {
      throw new Error('Anchor bridge must be a regular local file.');
    }
    if (opened.size > ANCHOR_FILE_MAX_BYTES) {
      throw new Error('Anchor bridge file is too large.');
    }

    const buffer = Buffer.allocUnsafe(ANCHOR_FILE_MAX_BYTES + 1);
    let byteLength = 0;
    while (byteLength < buffer.byteLength) {
      const read = readSync(
        descriptor,
        buffer,
        byteLength,
        buffer.byteLength - byteLength,
        null,
      );
      if (read === 0) break;
      byteLength += read;
    }
    if (byteLength > ANCHOR_FILE_MAX_BYTES) {
      throw new Error('Anchor bridge file is too large.');
    }
    const bytes = buffer.subarray(0, byteLength);
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== expectedHash) {
      throw new Error('Anchor bridge file does not match its SHA-256 filename.');
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return parseAnchorFilePayload(text, vaultRoot);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Anchor bridge')) {
      throw error;
    }
    throw new Error(`Cannot read anchor bridge file: ${errorMessage(error)}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function assertAnchorFileLocation(uri: vscode.Uri, vaultRoot: string): string {
  if (vscode.workspace.isTrusted !== true) {
    throw new Error('Anchor bridge files require a trusted workspace.');
  }
  if (
    uri.scheme !== 'file'
    || Boolean(uri.authority)
    || Boolean(uri.query)
    || Boolean(uri.fragment)
    || !uri.fsPath
  ) {
    throw new Error('Anchor bridge must be a local file URI.');
  }

  const root = resolve(vaultRoot);
  const candidate = resolve(uri.fsPath);
  const fromRoot = relative(root, candidate);
  if (
    !fromRoot
    || fromRoot === '..'
    || fromRoot.startsWith(`..${sep}`)
    || isAbsolute(fromRoot)
  ) {
    throw new Error('Anchor bridge file is outside the workspace.');
  }
  const segments = fromRoot.split(sep);
  if (
    segments.length !== 5
    || segments[0] !== '.llm_wiki'
    || segments[1] !== 'agent'
    || segments[2] !== 'exports'
    || !segments[3]
  ) {
    throw new Error(
      'Anchor bridge file must be directly inside one export directory.',
    );
  }
  const filename = segments[4] ?? '';
  const match = /^source-([0-9a-f]{64})\.llm_wiki_anchor$/.exec(filename);
  if (!match?.[1]) {
    throw new Error('Anchor bridge file must use its lowercase SHA-256 filename.');
  }

  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const entry = lstatSync(current);
    if (entry.isSymbolicLink()) {
      throw new Error('Anchor bridge path must not contain symbolic links.');
    }
    const final = index === segments.length - 1;
    if ((!final && !entry.isDirectory()) || (final && !entry.isFile())) {
      throw new Error('Anchor bridge path has an invalid file type.');
    }
  }
  return match[1];
}

async function closeAnchorFileTab(uri: vscode.Uri): Promise<boolean> {
  const uriKey = uri.toString();
  for (const group of vscode.window.tabGroups.all) {
    const tab = group.tabs.find(candidate => {
      const input = candidate.input;
      return input instanceof vscode.TabInputCustom
        && input.viewType === ANCHOR_FILE_VIEW_TYPE
        && input.uri.toString() === uriKey;
    });
    if (tab) {
      try {
        return await vscode.window.tabGroups.close(tab, true);
      } catch {
        return false;
      }
    }
  }
  return false;
}

function renderAnchorFileStatus(title: string, detail: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(detail)}</p>
  </main>
</body>
</html>`;
}

function throwIfCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) throw new vscode.CancellationError();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
