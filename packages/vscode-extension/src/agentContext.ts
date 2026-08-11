import * as vscode from 'vscode';
import {
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { SelectionContext } from './selectionContext';
import {
  getBacklinks,
  getForwardLinks,
  loadFilesystemWiki,
} from './filesystemWiki';
import { notePathToUri } from './wikiLinks';

export interface AddSelectionToContextOptions {
  getActiveSelectionContext?: () => SelectionContext | undefined | Promise<SelectionContext | undefined>;
}

export interface SelectionContextExportResult {
  directoryPath: string;
  markdownPath: string;
  jsonPath: string;
}

const AGENT_CONTEXT_WIKI_LIMITS = {
  maxFiles: 2_000,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxEntries: 20_000,
} as const;

let latestAliasUpdate: Promise<void> = Promise.resolve();

export async function addSelectionToContext(
  vaultRoot: string,
  options: AddSelectionToContextOptions = {},
): Promise<SelectionContextExportResult | false> {
  const providedSelection = options.getActiveSelectionContext
    ? await options.getActiveSelectionContext()
    : undefined;
  const activeSelection = providedSelection ?? getNativeSelectionContext();
  if (!activeSelection) {
    vscode.window.showErrorMessage('No active editor');
    return false;
  }

  const { uri, text, startLine, endLine, metadata } = activeSelection;
  const relPath = activeSelection.sourceLabel ?? vscode.workspace.asRelativePath(uri);
  const rangeLabel = activeSelection.rangeLabel ?? `lines ${startLine}–${endLine}`;

  if (!text.trim()) {
    vscode.window.showErrorMessage('No text selected');
    return false;
  }

  const anchorUri = activeSelection.anchorUri ?? `${notePathToUri(relPath)}#L${startLine}-L${endLine}`;
  const fence = markdownFenceFor(text);
  const mdContent = `# Current Selection

**Source**: ${relPath} (${rangeLabel})
**Anchor**: ${anchorUri}
**Visual evidence**: sibling \`selection.png\` when present

${fence}
${text}
${fence}
`;
  const { backlinks, forwardLinks } = await selectionLinkContext(vaultRoot, relPath);

  const jsonContent = {
    source: relPath,
    anchor_uri: anchorUri,
    lines: { start: startLine, end: endLine },
    location: rangeLabel,
    text,
    text_hash: createHash('sha256').update(text).digest('hex'),
    exported_at: new Date().toISOString(),
    ...(metadata ? { metadata } : {}),
    backlinks: backlinks.map(link => ({ from: link.sourcePath, line: link.line })),
    forward_links: forwardLinks.map(link => ({
      to: link.targetPath ?? link.href,
      line: link.line,
    })),
  };
  const jsonText = JSON.stringify(jsonContent, null, 2);
  const layout = secureExportLayout(vaultRoot);
  const exported = publishSelection(layout, mdContent, jsonText);

  await serializeAliasUpdate(() => {
    validateExportResult(exported);
    atomicReplace(join(layout.agentDir, 'selection.md'), mdContent);
    atomicReplace(join(layout.agentDir, 'selection.json'), jsonText);
    removeAlias(join(layout.agentDir, 'selection.png'));
  });

  vscode.window.showInformationMessage(
    `Selection exported to .hl/agent/selection.md + .hl/agent/selection.json`
  );
  return exported;
}

async function selectionLinkContext(vaultRoot: string, relPath: string) {
  try {
    const wiki = await loadFilesystemWiki(vaultRoot, AGENT_CONTEXT_WIKI_LIMITS);
    return {
      backlinks: getBacklinks(wiki, relPath),
      forwardLinks: getForwardLinks(wiki, relPath),
    };
  } catch {
    return { backlinks: [], forwardLinks: [] };
  }
}

function markdownFenceFor(text: string): string {
  let longestRun = 0;
  for (const match of text.matchAll(/`+/g)) {
    longestRun = Math.max(longestRun, match[0].length);
  }
  return '`'.repeat(Math.max(3, longestRun + 1));
}

export async function syncSelectionExportAttachment(
  exported: SelectionContextExportResult,
  fileName: 'selection.png',
  bytes?: Uint8Array,
): Promise<string | undefined> {
  if (fileName !== 'selection.png') throw new Error('Unsupported selection export attachment.');
  validateExportResult(exported);
  const attachmentPath = join(exported.directoryPath, fileName);

  if (bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error('Selection attachment bytes are invalid.');
    publishImmutableFile(attachmentPath, bytes);
  }

  await serializeAliasUpdate(() => {
    const current = validateExportResult(exported);
    atomicReplace(join(current.agentDir, 'selection.md'), readFileSync(exported.markdownPath));
    atomicReplace(join(current.agentDir, 'selection.json'), readFileSync(exported.jsonPath));
    const aliasPath = join(current.agentDir, fileName);
    if (bytes) {
      atomicReplace(aliasPath, readFileSync(attachmentPath));
    } else {
      removeAlias(aliasPath);
    }
  });
  return bytes ? attachmentPath : undefined;
}

function getNativeSelectionContext(): SelectionContext | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;

  const selection = editor.selection;
  if (selection.isEmpty) {
    return {
      uri: editor.document.uri,
      text: '',
      startLine: selection.start.line + 1,
      endLine: selection.end.line + 1,
    };
  }

  return {
    uri: editor.document.uri,
    text: editor.document.getText(selection),
    startLine: selection.start.line + 1,
    endLine: selection.end.line + 1,
  };
}

interface ExportLayout {
  rootRealPath: string;
  agentDir: string;
  exportsDir: string;
}

function secureExportLayout(vaultRoot: string): ExportLayout {
  const rootPath = resolve(vaultRoot);
  assertDirectory(rootPath);
  const rootRealPath = realpathSync(rootPath);
  let current = rootPath;
  for (const segment of ['.hl', 'agent', 'exports']) {
    current = join(current, segment);
    const stat = lstat(current);
    if (stat) {
      assertDirectory(current);
    } else {
      mkdirSync(current, { mode: 0o700 });
    }
    assertConfined(rootRealPath, realpathSync(current));
  }
  const agentDir = dirname(current);
  for (const name of ['selection.md', 'selection.json', 'selection.png']) {
    assertAliasTarget(join(agentDir, name));
  }
  return { rootRealPath, agentDir, exportsDir: current };
}

function publishSelection(
  layout: ExportLayout,
  markdown: string,
  json: string,
): SelectionContextExportResult {
  const id = randomUUID();
  const directoryPath = join(layout.exportsDir, id);
  const stagingPath = join(layout.exportsDir, `.${id}.${randomUUID()}.tmp`);
  mkdirSync(stagingPath, { mode: 0o700 });
  try {
    writeFileSync(join(stagingPath, 'selection.md'), markdown, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(stagingPath, 'selection.json'), json, { flag: 'wx', mode: 0o600 });
    renameSync(stagingPath, directoryPath);
  } catch (error) {
    rmSync(stagingPath, { recursive: true, force: true });
    throw error;
  }
  assertDirectory(directoryPath);
  assertConfined(layout.rootRealPath, realpathSync(directoryPath));
  return {
    directoryPath,
    markdownPath: join(directoryPath, 'selection.md'),
    jsonPath: join(directoryPath, 'selection.json'),
  };
}

function validateExportResult(exported: SelectionContextExportResult): ExportLayout {
  const directoryPath = resolve(exported.directoryPath);
  const exportsDir = dirname(directoryPath);
  const agentDir = dirname(exportsDir);
  const hlDir = dirname(agentDir);
  const rootPath = dirname(hlDir);
  if (
    basename(exportsDir) !== 'exports'
    || basename(agentDir) !== 'agent'
    || basename(hlDir) !== '.hl'
    || basename(directoryPath).startsWith('.')
    || resolve(exported.markdownPath) !== join(directoryPath, 'selection.md')
    || resolve(exported.jsonPath) !== join(directoryPath, 'selection.json')
  ) throw new Error('Selection export paths are invalid.');

  assertDirectory(rootPath);
  const rootRealPath = realpathSync(rootPath);
  for (const path of [hlDir, agentDir, exportsDir, directoryPath]) {
    assertDirectory(path);
    assertConfined(rootRealPath, realpathSync(path));
  }
  for (const path of [exported.markdownPath, exported.jsonPath]) assertRegularFile(path);
  for (const name of ['selection.md', 'selection.json', 'selection.png']) {
    assertAliasTarget(join(agentDir, name));
  }
  return { rootRealPath, agentDir, exportsDir };
}

function publishImmutableFile(path: string, bytes: Uint8Array): void {
  if (lstat(path)) throw new Error(`Selection export attachment already exists: ${path}`);
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    linkSync(temporary, path);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {}
  }
}

function atomicReplace(path: string, content: string | Uint8Array): void {
  assertAliasTarget(path);
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {}
  }
}

function removeAlias(path: string): void {
  const stat = lstat(path);
  if (!stat) return;
  assertAliasTarget(path);
  unlinkSync(path);
}

async function serializeAliasUpdate(update: () => void): Promise<void> {
  const pending = latestAliasUpdate.then(update, update);
  latestAliasUpdate = pending.catch(() => undefined);
  await pending;
}

function assertDirectory(path: string): void {
  const stat = lstat(path);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Unsafe selection export directory: ${path}`);
  }
}

function assertRegularFile(path: string): void {
  const stat = lstat(path);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Unsafe selection export file: ${path}`);
  }
}

function assertAliasTarget(path: string): void {
  const stat = lstat(path);
  if (stat && (stat.isSymbolicLink() || !stat.isFile())) {
    throw new Error(`Unsafe selection export alias: ${path}`);
  }
}

function assertConfined(rootRealPath: string, targetRealPath: string): void {
  const rel = relative(rootRealPath, targetRealPath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Selection export path escapes the workspace.');
  }
}

function lstat(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
