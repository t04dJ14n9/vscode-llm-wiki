import * as vscode from 'vscode';
import {
  classifyReferenceTarget,
  type PdfTextFragment,
} from '@llm-wiki/core';
import { existsSync, lstatSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { isAbsolute, join, relative, resolve, sep } from 'path';
import { llmWikiAnchorTargetFromString } from './anchorUris';

export interface DispatchUriOptions {
  openWebTarget?(url: string): Promise<void> | void;
}

export async function dispatchUri(
  vaultRoot: string | undefined,
  uri: string,
  options: DispatchUriOptions = {},
): Promise<void> {
  const resolvedUri = llmWikiAnchorTargetFromString(uri) ?? uri;
  const navigableUri = resolveOkfLinkTarget(vaultRoot, resolvedUri);
  const anchorFileUri = localAnchorFileUri(navigableUri);
  if (anchorFileUri) {
    await vscode.commands.executeCommand(
      'vscode.openWith',
      anchorFileUri,
      'llm-wiki.anchorFile',
    );
    return;
  }
  const target = classifyReferenceTarget(navigableUri);
  if (
    !vaultRoot
    && target.kind !== 'web'
    && !(target.kind === 'pdf' && Boolean(target.path && isAbsolute(target.path)))
  ) {
    vscode.window.showErrorMessage(
      `Open a workspace folder before opening this relative link: ${navigableUri}`,
    );
    return;
  }
  const workspaceRoot = vaultRoot ?? '';

  switch (target.kind) {
    case 'note': {
      if (!target.path) break;
      const filePath = workspaceFilePath(workspaceRoot, target.path);
      if (!filePath) {
        showOutsideWorkspaceError(target.path);
        return;
      }
      ensureMarkdownNoteExists(workspaceRoot, filePath);
      const fileUri = vscode.Uri.file(filePath);
      await vscode.commands.executeCommand(
        'vscode.openWith',
        fileUri,
        'llm-wiki.markdownEditor',
      );
      const selection = await resolveNoteSelection(fileUri, target.heading, target.lines);
      if (selection) {
        await vscode.commands.executeCommand('llm-wiki.revealInMarkdownEditor', {
          uri: fileUri,
          selection,
        });
      }
      return;
    }

    case 'code': {
      if (!target.path) break;
      const direct = workspaceFilePath(workspaceRoot, target.path);
      if (!direct) {
        showOutsideWorkspaceError(target.path);
        return;
      }
      const fallback = workspaceFilePath(
        workspaceRoot,
        join('raw', 'code', target.path.split('/').pop() || target.path),
      );
      const filePath = existsSync(direct) ? direct : fallback;
      if (!filePath) {
        showOutsideWorkspaceError(target.path);
        return;
      }
      try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(doc);
        if (target.lines) {
          const range = new vscode.Range(
            target.lines.start - 1, 0,
            target.lines.end - 1, 0,
          );
          editor.selection = new vscode.Selection(range.start, range.end);
          editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
        }
      } catch {
        vscode.window.showErrorMessage(`Code file not found: ${target.path}`);
      }
      return;
    }

    case 'pdf': {
      if (!target.path) break;
      if (!isAbsolute(target.path) && !workspacePdfFilePath(workspaceRoot, target.path)) {
        showOutsideWorkspaceError(target.path);
        return;
      }
      const args: { pdfPath: string; page?: number; textFragment?: PdfTextFragment } = {
        pdfPath: target.path,
      };
      if (target.page) args.page = target.page;
      if (target.textFragment) args.textFragment = target.textFragment;
      try {
        await vscode.commands.executeCommand('llm-wiki.openPdfTarget', args);
      } catch (error) {
        if (!isMissingPdfEditorCommand(error)) throw error;
        await openPdfWithDefaultEditor(workspaceRoot, target.path);
      }
      return;
    }

    case 'web': {
      await openWebTarget(workspaceRoot, target.url ?? resolvedUri, target.webTargetId, options);
      return;
    }

    case 'image':
    case 'text':
    case 'unknown': {
      if (target.path) {
        const filePath = workspaceFilePath(workspaceRoot, target.path);
        if (!filePath) {
          showOutsideWorkspaceError(target.path);
          return;
        }
        if (existsSync(filePath)) {
          await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
          return;
        }
      }
      if (/^https?:\/\//i.test(navigableUri)) {
        await openWebTarget(workspaceRoot, navigableUri, undefined, options);
        return;
      }
      vscode.window.showErrorMessage(`Cannot open link target: ${navigableUri}`);
      return;
    }
  }

  vscode.window.showErrorMessage(`Cannot open link target: ${navigableUri}`);
}

/**
 * OKF concept IDs omit `.md`, bundle-relative links begin with `/`, and
 * hierarchical indexes may link to a directory. Resolve those portable forms
 * to concrete bundle files before classifying the target.
 */
export function resolveOkfLinkTarget(
  vaultRoot: string | undefined,
  uri: string,
): string {
  if (
    !vaultRoot
    || !uri
    || uri.startsWith('#')
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri)
  ) {
    return uri;
  }

  const suffixIndex = uri.search(/[?#]/);
  const rawPath = suffixIndex < 0 ? uri : uri.slice(0, suffixIndex);
  const suffix = suffixIndex < 0 ? '' : uri.slice(suffixIndex);
  if (!rawPath) return uri;

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    decodedPath = rawPath;
  }
  const bundlePath = decodedPath.replace(/^\/+/, '');
  if (!bundlePath) return uri;

  if (
    decodedPath.toLowerCase().endsWith('.pdf')
    && isAbsolute(decodedPath)
    && isWorkspaceContainedPath(vaultRoot, decodedPath)
  ) {
    return uri;
  }

  const direct = workspaceFilePath(vaultRoot, bundlePath);
  if (direct && existsSync(direct)) {
    if (isDirectory(direct)) {
      const indexPath = workspaceFilePath(
        vaultRoot,
        `${bundlePath.replace(/[\\/]+$/, '')}/index.md`,
      );
      if (indexPath && existsSync(indexPath)) {
        return `${workspaceRelativePath(vaultRoot, indexPath)}${suffix}`;
      }
    }
    return `${workspaceRelativePath(vaultRoot, direct)}${suffix}`;
  }

  if (!/\.[^/\\]+$/.test(bundlePath)) {
    const concept = workspaceFilePath(vaultRoot, `${bundlePath}.md`);
    if (concept && existsSync(concept)) {
      return `${workspaceRelativePath(vaultRoot, concept)}${suffix}`;
    }
  }

  // In OKF, a leading slash is bundle-relative rather than filesystem-root
  // absolute. Preserve existing absolute PDFs so standalone PDF viewing keeps
  // working when no bundle file matches.
  if (
    rawPath.startsWith('/')
    && !(decodedPath.toLowerCase().endsWith('.pdf') && existsSync(decodedPath))
  ) {
    return `${bundlePath}${suffix}`;
  }
  return uri;
}

function workspaceRelativePath(workspaceRoot: string, filePath: string): string {
  return relative(resolve(workspaceRoot), filePath).split(sep).join('/');
}

function isWorkspaceContainedPath(workspaceRoot: string, filePath: string): boolean {
  const fromRoot = relative(resolve(workspaceRoot), resolve(filePath));
  return fromRoot === ''
    || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot));
}

function isDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function localAnchorFileUri(value: string): vscode.Uri | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== 'file:'
    || Boolean(url.host)
    || Boolean(url.search)
    || Boolean(url.hash)
    || !url.pathname.endsWith('.llm_wiki_anchor')
  ) {
    return undefined;
  }
  try {
    return vscode.Uri.parse(value, true);
  } catch {
    return undefined;
  }
}

async function openWebTarget(
  _vaultRoot: string,
  url: string,
  _webTargetId: string | undefined,
  options: DispatchUriOptions,
): Promise<void> {
  if (options.openWebTarget) {
    await options.openWebTarget(url);
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

async function openPdfWithDefaultEditor(vaultRoot: string, pdfPath: string): Promise<void> {
  const filePath = isAbsolute(pdfPath) ? pdfPath : join(vaultRoot, pdfPath);
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
}

interface WorkspaceFilePathOptions {
  allowFinalFileSymlink?: boolean;
}

function workspaceFilePath(
  workspaceRoot: string,
  candidatePath: string,
  options: WorkspaceFilePathOptions = {},
): string | undefined {
  if (!candidatePath || isAbsolute(candidatePath)) return undefined;
  const root = resolve(workspaceRoot);
  const candidate = resolve(root, candidatePath);
  const fromRoot = relative(root, candidate);
  if (
    fromRoot === '..'
    || fromRoot.startsWith(`..${sep}`)
    || isAbsolute(fromRoot)
  ) {
    return undefined;
  }
  if (hasSymlinkedAncestor(root, candidate, options.allowFinalFileSymlink === true)) {
    return undefined;
  }
  return candidate;
}

function workspacePdfFilePath(
  workspaceRoot: string,
  candidatePath: string,
): string | undefined {
  return workspaceFilePath(workspaceRoot, candidatePath, {
    allowFinalFileSymlink: vscode.workspace.isTrusted === true,
  });
}

function hasSymlinkedAncestor(
  root: string,
  candidate: string,
  allowFinalFileSymlink: boolean,
): boolean {
  const fromRoot = relative(root, candidate);
  let current = root;
  const segments = fromRoot.split(sep).filter(Boolean);
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    if (!existsSync(current)) break;
    try {
      if (!lstatSync(current).isSymbolicLink()) continue;
      const isFinalSegment = index === segments.length - 1;
      if (
        allowFinalFileSymlink
        && isFinalSegment
        && symlinkResolvesToFile(current)
      ) continue;
      return true;
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) break;
      throw error;
    }
  }
  return false;
}

function symlinkResolvesToFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function showOutsideWorkspaceError(candidatePath: string): void {
  vscode.window.showErrorMessage(
    `Cannot open link outside the workspace: ${candidatePath}`,
  );
}

function isMissingPdfEditorCommand(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('llm-wiki.openPdfTarget')
    && /not found|not registered|does not exist|unknown command/i.test(message);
}

function ensureMarkdownNoteExists(workspaceRoot: string, filePath: string): void {
  if (!filePath.toLowerCase().endsWith('.md') || existsSync(filePath)) return;
  const directory = dirnamePath(filePath);
  if (directory) mkdirSync(directory, { recursive: true });
  const relativePath = relative(resolve(workspaceRoot), filePath);
  if (workspaceFilePath(workspaceRoot, relativePath) !== filePath) {
    throw new Error('Refusing to create a Markdown note through a symbolic link.');
  }
  try {
    writeFileSync(filePath, '', { flag: 'wx' });
  } catch (error) {
    if (!isFileExistsError(error)) throw error;
  }
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'EEXIST';
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error
    && 'code' in error
    && error.code === code;
}

async function resolveNoteSelection(
  fileUri: vscode.Uri,
  heading: string | undefined,
  lines: { start: number; end: number } | undefined,
): Promise<{ from: number; to: number } | undefined> {
  if (!heading && !lines) return undefined;
  const doc = await vscode.workspace.openTextDocument(fileUri);

  if (heading) {
    const text = doc.getText();
    if (heading.startsWith('^')) {
      const blockOffset = findBlockReferenceOffset(text, heading.slice(1));
      if (blockOffset !== undefined) {
        return { from: blockOffset, to: blockOffset };
      }
    }
    const headingRegex = new RegExp(`^#{1,6}\\s+${escapeRegex(heading)}`, 'im');
    const match = headingRegex.exec(text);
    if (match) {
      return { from: match.index, to: match.index };
    }
  }

  if (lines) {
    const startLine = Math.max(1, lines.start);
    const endLine = Math.max(startLine, lines.end);
    const from = doc.offsetAt(new vscode.Position(startLine - 1, 0));
    const to = endLine < doc.lineCount
      ? doc.offsetAt(new vscode.Position(endLine, 0))
      : doc.getText().length;
    return { from, to };
  }

  return undefined;
}

function findBlockReferenceOffset(text: string, blockId: string): number | undefined {
  if (!blockId) return undefined;
  const blockRegex = new RegExp(`(?:^|\\s)\\^${escapeRegex(blockId)}(?=$|\\s)`, 'm');
  const match = blockRegex.exec(text);
  if (!match) return undefined;
  return lineStartAt(text, match.index);
}

function lineStartAt(text: string, offset: number): number {
  const previousNewline = text.lastIndexOf('\n', offset);
  return previousNewline < 0 ? 0 : previousNewline + 1;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dirnamePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index < 0 ? '' : normalized.slice(0, index);
}
