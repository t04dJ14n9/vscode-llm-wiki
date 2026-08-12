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
import { pathToFileURL } from 'node:url';
import type { SelectionContext } from './selectionContext';
import {
  getBacklinks,
  getForwardLinks,
  loadFilesystemWiki,
} from './filesystemWiki';
import { encodeAnchorFile } from './anchorFileCodec';
import { llmWikiOpenAnchorUri } from './anchorUris';
import { notePathToUri } from './wikiLinks';

export interface AddSelectionToContextOptions {
  getActiveSelectionContext?: () => SelectionContext | undefined | Promise<SelectionContext | undefined>;
}

export interface SelectionContextExportResult {
  directoryPath: string;
  markdownPath: string;
  jsonPath: string;
  anchorPath?: string;
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

  const anchorUri = activeSelection.anchorUri
    ?? defaultSelectionAnchor(relPath, startLine, endLine);
  const openUri = llmWikiOpenAnchorUri(anchorUri);
  const anchorFile = /^https?:\/\//i.test(anchorUri)
    ? undefined
    : safeEncodeAnchorFile(anchorUri, vaultRoot);
  const layout = secureExportLayout(vaultRoot);
  const exportPaths = createSelectionExportPaths(layout, anchorFile?.fileName);
  const chatUri = /^https?:\/\//i.test(anchorUri)
    ? anchorUri
    : exportPaths.anchorPath
      ? pathToFileURL(exportPaths.anchorPath).toString()
      : undefined;
  const fence = markdownFenceFor(text);
  const sourceLabel = markdownLinkLabel(`${relPath} (${rangeLabel})`);
  const mdContent = `# Current Selection

**Source**: ${chatUri ? `[${sourceLabel}](<${chatUri}>)` : sourceLabel}
${chatUri
    ? '**Citation requirement**: In chat responses, reuse the exact Source link above. Do not construct a relative file or PDF link.\n'
    : ''}**Visual evidence**: [selection.png](./selection.png) when present

${fence}
${text}
${fence}
`;
  const { backlinks, forwardLinks } = await selectionLinkContext(vaultRoot, relPath);

  const jsonContent = {
    source: relPath,
    anchor_uri: anchorUri,
    ...(openUri ? { open_uri: openUri } : {}),
    ...(chatUri ? { chat_uri: chatUri } : {}),
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
  const exported = publishSelection(
    layout,
    exportPaths,
    mdContent,
    jsonText,
    anchorFile?.text,
  );

  await serializeAliasUpdate(() => {
    validateExportResult(exported);
    atomicReplace(join(layout.agentDir, 'selection.md'), mdContent);
    atomicReplace(join(layout.agentDir, 'selection.json'), jsonText);
    removeAlias(join(layout.agentDir, 'selection.png'));
  });

  vscode.window.showInformationMessage(
    `Selection exported to .llm_wiki/agent/selection.md + .llm_wiki/agent/selection.json`
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

function defaultSelectionAnchor(
  relPath: string,
  startLine: number,
  endLine: number,
): string {
  const lineFragment = `#L${startLine}-L${endLine}`;
  return /\.md$/i.test(relPath)
    ? `${notePathToUri(relPath)}${lineFragment}`
    : `${relPath}${lineFragment}`;
}

function markdownLinkLabel(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replaceAll('\\', '\\\\')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]');
}

function safeEncodeAnchorFile(
  target: string,
  vaultRoot: string,
): ReturnType<typeof encodeAnchorFile> {
  try {
    return encodeAnchorFile(target, vaultRoot);
  } catch {
    return undefined;
  }
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

type SelectionExportPaths = SelectionContextExportResult;

function secureExportLayout(vaultRoot: string): ExportLayout {
  const rootPath = resolve(vaultRoot);
  assertDirectory(rootPath);
  const rootRealPath = realpathSync(rootPath);
  let current = rootPath;
  for (const segment of ['.llm_wiki', 'agent', 'exports']) {
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

function createSelectionExportPaths(
  layout: ExportLayout,
  anchorFileName?: string,
): SelectionExportPaths {
  if (
    anchorFileName !== undefined
    && !/^source-[a-f0-9]{64}\.llm_wiki_anchor$/.test(anchorFileName)
  ) {
    throw new Error('Selection anchor filename is invalid.');
  }
  const directoryPath = join(layout.exportsDir, randomUUID());
  return {
    directoryPath,
    markdownPath: join(directoryPath, 'selection.md'),
    jsonPath: join(directoryPath, 'selection.json'),
    ...(anchorFileName
      ? { anchorPath: join(directoryPath, anchorFileName) }
      : {}),
  };
}

function publishSelection(
  layout: ExportLayout,
  paths: SelectionExportPaths,
  markdown: string,
  json: string,
  anchor?: string,
): SelectionContextExportResult {
  const directoryPath = resolve(paths.directoryPath);
  const id = basename(directoryPath);
  const anchorFileName = paths.anchorPath ? basename(paths.anchorPath) : undefined;
  if (
    dirname(directoryPath) !== layout.exportsDir
    || id.startsWith('.')
    || Boolean(anchorFileName) !== Boolean(anchor)
    || (
      anchorFileName !== undefined
      && !/^source-[a-f0-9]{64}\.llm_wiki_anchor$/.test(anchorFileName)
    )
    || resolve(paths.markdownPath) !== join(directoryPath, 'selection.md')
    || resolve(paths.jsonPath) !== join(directoryPath, 'selection.json')
    || (
      paths.anchorPath !== undefined
      && resolve(paths.anchorPath) !== join(directoryPath, anchorFileName ?? '')
    )
  ) throw new Error('Selection export paths are invalid.');
  const stagingPath = join(layout.exportsDir, `.${id}.${randomUUID()}.tmp`);
  mkdirSync(stagingPath, { mode: 0o700 });
  try {
    writeFileSync(join(stagingPath, 'selection.md'), markdown, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(stagingPath, 'selection.json'), json, { flag: 'wx', mode: 0o600 });
    if (anchorFileName && anchor) {
      writeFileSync(join(stagingPath, anchorFileName), anchor, { flag: 'wx', mode: 0o600 });
    }
    renameSync(stagingPath, directoryPath);
  } catch (error) {
    rmSync(stagingPath, { recursive: true, force: true });
    throw error;
  }
  assertDirectory(directoryPath);
  assertConfined(layout.rootRealPath, realpathSync(directoryPath));
  return paths;
}

function validateExportResult(exported: SelectionContextExportResult): ExportLayout {
  const directoryPath = resolve(exported.directoryPath);
  const exportsDir = dirname(directoryPath);
  const agentDir = dirname(exportsDir);
  const llmWikiDir = dirname(agentDir);
  const rootPath = dirname(llmWikiDir);
  const anchorFileName = exported.anchorPath
    ? basename(exported.anchorPath)
    : undefined;
  if (
    basename(exportsDir) !== 'exports'
    || basename(agentDir) !== 'agent'
    || basename(llmWikiDir) !== '.llm_wiki'
    || basename(directoryPath).startsWith('.')
    || resolve(exported.markdownPath) !== join(directoryPath, 'selection.md')
    || resolve(exported.jsonPath) !== join(directoryPath, 'selection.json')
    || (
      anchorFileName !== undefined
      && !/^source-[a-f0-9]{64}\.llm_wiki_anchor$/.test(anchorFileName)
    )
    || (
      exported.anchorPath !== undefined
      && resolve(exported.anchorPath) !== join(directoryPath, anchorFileName ?? '')
    )
  ) throw new Error('Selection export paths are invalid.');

  assertDirectory(rootPath);
  const rootRealPath = realpathSync(rootPath);
  for (const path of [llmWikiDir, agentDir, exportsDir, directoryPath]) {
    assertDirectory(path);
    assertConfined(rootRealPath, realpathSync(path));
  }
  for (const path of [
    exported.markdownPath,
    exported.jsonPath,
    ...(exported.anchorPath ? [exported.anchorPath] : []),
  ]) assertRegularFile(path);
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
