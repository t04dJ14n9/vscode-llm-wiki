import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const PDF_AGENT_CLIPBOARD_CACHE_LIMIT = 16;
const PDF_AGENT_CLIPBOARD_FILE_PATTERN =
  /^pdf-selection-[a-f0-9]{64}\.png$/u;

export interface PersistPdfAgentClipboardImageInput {
  rootPath: string;
  sourceIdentity: string;
  selectionKey: string;
  bytes: Uint8Array;
}

export interface PersistedPdfAgentClipboardImage {
  absolutePath: string;
  relativePath: string;
}

export function persistPdfAgentClipboardImage(
  input: PersistPdfAgentClipboardImageInput,
): PersistedPdfAgentClipboardImage {
  if (
    typeof input?.rootPath !== 'string'
    || !input.rootPath
    || typeof input.sourceIdentity !== 'string'
    || !input.sourceIdentity
    || typeof input.selectionKey !== 'string'
    || !input.selectionKey
    || !(input.bytes instanceof Uint8Array)
    || input.bytes.byteLength === 0
  ) {
    throw new TypeError('PDF agent clipboard image input is invalid.');
  }

  const rootPath = resolve(input.rootPath);
  assertSafeDirectory(rootPath);
  const rootRealPath = realpathSync(rootPath);
  const llmWikiPath = ensureSafeChildDirectory(rootRealPath, '.llm_wiki');
  const agentPath = ensureSafeChildDirectory(llmWikiPath, 'agent');
  const cachePath = ensureSafeChildDirectory(agentPath, 'clipboard');
  assertConfined(rootRealPath, realpathSync(cachePath));

  const digest = createHash('sha256')
    .update(input.sourceIdentity)
    .update('\0')
    .update(input.selectionKey)
    .update('\0')
    .update(input.bytes)
    .digest('hex');
  const fileName = `pdf-selection-${digest}.png`;
  const absolutePath = join(cachePath, fileName);
  publishImmutableFile(absolutePath, input.bytes);
  prunePdfAgentClipboardCache(cachePath, fileName);

  return {
    absolutePath,
    relativePath: [
      '.llm_wiki',
      'agent',
      'clipboard',
      fileName,
    ].join('/'),
  };
}

function ensureSafeChildDirectory(parentPath: string, name: string): string {
  const childPath = join(parentPath, name);
  const existing = lstatSync(childPath, { throwIfNoEntry: false });
  if (!existing) mkdirSync(childPath, { mode: 0o700 });
  assertSafeDirectory(childPath);
  assertConfined(realpathSync(parentPath), realpathSync(childPath));
  return childPath;
}

function assertSafeDirectory(path: string): void {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Unsafe PDF agent clipboard directory: ${path}`);
  }
}

function assertConfined(rootPath: string, candidatePath: string): void {
  const rel = relative(rootPath, candidatePath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(rootPath, rel) !== candidatePath) {
    throw new Error(`Unsafe PDF agent clipboard path: ${candidatePath}`);
  }
}

function publishImmutableFile(path: string, bytes: Uint8Array): void {
  const existing = lstatSync(path, { throwIfNoEntry: false });
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error(`Unsafe PDF agent clipboard file: ${path}`);
    }
    const existingBytes = readFileSync(path);
    if (
      existingBytes.byteLength !== bytes.byteLength
      || !existingBytes.equals(Buffer.from(bytes))
    ) {
      throw new Error(`PDF agent clipboard image hash collision: ${path}`);
    }
    return;
  }

  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
    renameSync(temporaryPath, path);
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch {}
  }
}

function prunePdfAgentClipboardCache(cachePath: string, currentFileName: string): void {
  const files = readdirSync(cachePath)
    .filter(name => PDF_AGENT_CLIPBOARD_FILE_PATTERN.test(name))
    .map(name => {
      const path = join(cachePath, name);
      const stat = lstatSync(path, { throwIfNoEntry: false });
      return stat && !stat.isSymbolicLink() && stat.isFile()
        ? { name, path, mtimeMs: stat.mtimeMs }
        : undefined;
    })
    .filter((entry): entry is { name: string; path: string; mtimeMs: number } =>
      entry !== undefined
    )
    .sort((left, right) =>
      Number(right.name === currentFileName) - Number(left.name === currentFileName)
      || right.mtimeMs - left.mtimeMs
      || left.name.localeCompare(right.name)
    );
  for (const entry of files.slice(PDF_AGENT_CLIPBOARD_CACHE_LIMIT)) {
    try {
      unlinkSync(entry.path);
    } catch {}
  }
}
