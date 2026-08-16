import { open, realpath } from 'fs/promises';
import * as path from 'path';

const LINK_PREVIEW_EXCERPT_LIMIT = 480;
const LINK_PREVIEW_READ_LIMIT = 32 * 1024;

export type LinkPreviewKind = 'markdown' | 'text' | 'pdf' | 'external' | 'unavailable';

export interface LinkPreview {
  kind: LinkPreviewKind;
  target: string;
  title: string;
  path?: string;
  page?: number;
  excerpt?: string;
}

export interface LinkPreviewRequest {
  workspaceRoot: string | undefined;
  documentPath: string | undefined;
  target: string;
  relativeToDocument: boolean;
}

export interface LinkPreviewFileSystem {
  realpath(filePath: string): Promise<string>;
  readText(filePath: string, maxBytes: number): Promise<string>;
}

const nodeFileSystem: LinkPreviewFileSystem = {
  realpath,
  async readText(filePath, maxBytes) {
    const handle = await open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  },
};

/**
 * Resolve a preview without invoking navigation or creating an editor. Local
 * reads are restricted by both lexical and real-path workspace containment.
 */
export async function resolveLinkPreviewTarget(
  request: LinkPreviewRequest,
  fileSystem: LinkPreviewFileSystem = nodeFileSystem,
): Promise<LinkPreview | null> {
  const { target } = request;
  if (!validPreviewTarget(target)) return null;

  const scheme = target.match(/^([A-Za-z][A-Za-z0-9+.-]*):/)?.[1]?.toLowerCase();
  if (scheme) {
    return scheme === 'http' || scheme === 'https' || scheme === 'mailto'
      ? { kind: 'external', target, title: target }
      : unavailablePreview(target);
  }

  const { rawPath, fragment } = splitTarget(target);
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (!decodedPath || decodedPath.includes('\0') || containsControlCharacter(decodedPath)) return null;

  const extension = path.extname(decodedPath).toLowerCase();
  if (extension === '.pdf') {
    const page = pdfPageFromFragment(fragment);
    const filename = path.basename(decodedPath);
    return {
      kind: 'pdf',
      target,
      title: page ? `${filename} — page ${page}` : filename,
      path: normalizedDisplayPath(decodedPath),
      ...(page ? { page } : {}),
    };
  }
  if (extension !== '.md' && extension !== '.txt' && extension !== '.text') {
    return unavailablePreview(target);
  }

  const workspaceRoot = request.workspaceRoot;
  if (!workspaceRoot) return unavailablePreview(target);
  const root = path.resolve(workspaceRoot);
  const base = request.relativeToDocument && request.documentPath
    ? path.dirname(path.resolve(request.documentPath))
    : root;
  const candidate = path.isAbsolute(decodedPath)
    ? path.resolve(decodedPath)
    : path.resolve(base, decodedPath);
  if (!isContainedPath(root, candidate)) return unavailablePreview(target);

  let realRoot: string;
  let realCandidate: string;
  try {
    [realRoot, realCandidate] = await Promise.all([
      fileSystem.realpath(root),
      fileSystem.realpath(candidate),
    ]);
  } catch {
    return unavailablePreview(target);
  }
  if (!isContainedPath(realRoot, realCandidate)) return unavailablePreview(target);

  let content: string;
  try {
    content = await fileSystem.readText(realCandidate, LINK_PREVIEW_READ_LIMIT);
  } catch {
    return unavailablePreview(target);
  }
  const relativePath = path.relative(realRoot, realCandidate).split(path.sep).join('/');
  const excerpt = boundedExcerpt(content);
  const kind = extension === '.md' ? 'markdown' : 'text';
  return {
    kind,
    target,
    title: kind === 'markdown' ? markdownTitle(content, realCandidate) : path.basename(realCandidate),
    path: relativePath,
    ...(excerpt ? { excerpt } : {}),
  };
}

function validPreviewTarget(target: unknown): target is string {
  return typeof target === 'string'
    && target.trim().length > 0
    && !target.includes('\0')
    && !containsControlCharacter(target);
}

function containsControlCharacter(value: string): boolean {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function splitTarget(target: string): { rawPath: string; fragment: string } {
  const suffixIndex = target.search(/[?#]/);
  return suffixIndex < 0
    ? { rawPath: target, fragment: '' }
    : { rawPath: target.slice(0, suffixIndex), fragment: target.slice(suffixIndex) };
}

function pdfPageFromFragment(fragment: string): number | undefined {
  const raw = fragment.match(/(?:^|[?#&])page=(\d+)/i)?.[1];
  const page = Number(raw);
  return Number.isSafeInteger(page) && page > 0 ? page : undefined;
}

function normalizedDisplayPath(filePath: string): string {
  return filePath.replace(/^[/\\]+/, '').split(path.sep).join('/');
}

function isContainedPath(root: string, candidate: string): boolean {
  const relativePath = path.relative(path.resolve(root), path.resolve(candidate));
  return relativePath === ''
    || (
      relativePath !== '..'
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath)
    );
}

function unavailablePreview(target: string): LinkPreview {
  return { kind: 'unavailable', target, title: target };
}

function markdownTitle(content: string, filePath: string): string {
  const heading = content.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();
  return heading || path.basename(filePath, path.extname(filePath));
}

function boundedExcerpt(content: string): string {
  const withoutFrontmatter = content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '');
  const normalized = withoutFrontmatter
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (normalized.length <= LINK_PREVIEW_EXCERPT_LIMIT) return normalized;
  return `${normalized.slice(0, LINK_PREVIEW_EXCERPT_LIMIT - 1).trimEnd()}…`;
}
