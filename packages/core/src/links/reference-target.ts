export type ReferenceKind = 'note' | 'pdf' | 'code' | 'web' | 'image' | 'text' | 'unknown';

export interface ReferenceTarget {
  kind: ReferenceKind;
  uri: string;
  path?: string;
  url?: string;
  heading?: string;
  lines?: { start: number; end: number };
  page?: number;
  chunkId?: string;
  anchorId?: string;
  webTargetId?: string;
}

const codeExtensions = new Set([
  'c', 'cc', 'cpp', 'cu', 'cuh', 'go', 'h', 'hpp', 'java', 'js', 'jsx',
  'kt', 'm', 'mm', 'py', 'rb', 'rs', 'sh', 'swift', 'ts', 'tsx',
]);

export function classifyReferenceTarget(uri: string): ReferenceTarget {
  const cleaned = stripMarkdownDestination(uri);
  if (/^https?:\/\//i.test(cleaned)) {
    return classifyWebTarget(cleaned);
  }

  const { path, fragment } = splitPathAndFragment(cleaned);
  const decodedPath = decodePath(path);
  const extension = fileExtension(decodedPath);

  if (extension === 'pdf' || decodedPath.startsWith('raw/pdf/')) {
    const params = fragmentParams(fragment);
    const page = numberParam(params, 'page');
    const chunkId = params.get('chunk') ?? undefined;
    const anchorId = params.get('anchor') ?? undefined;
    return withoutUndefined({
      kind: 'pdf',
      uri: cleaned,
      path: decodedPath,
      page,
      chunkId,
      anchorId,
    });
  }

  if (extension === 'md') {
    return withoutUndefined({
      kind: 'note',
      uri: cleaned,
      path: decodedPath,
      heading: fragment ? decodeURIComponent(fragment) : undefined,
    });
  }

  if (isImageExtension(extension)) {
    return { kind: 'image', uri: cleaned, path: decodedPath };
  }

  if (extension === 'txt' || extension === 'text') {
    return { kind: 'text', uri: cleaned, path: decodedPath };
  }

  if (codeExtensions.has(extension) || hasLineFragment(fragment)) {
    return withoutUndefined({
      kind: 'code',
      uri: cleaned,
      path: decodedPath,
      lines: parseLineFragment(fragment),
    });
  }

  return withoutUndefined({
    kind: decodedPath ? 'unknown' : 'unknown',
    uri: cleaned,
    path: decodedPath || undefined,
    heading: fragment ? decodeURIComponent(fragment) : undefined,
  });
}

export function noteHref(path: string, heading?: string): string {
  return `${normalizeRelativePath(path)}${heading ? `#${heading}` : ''}`;
}

export function pdfHref(path: string, options: {
  page?: number;
  chunkId?: string;
  anchorId?: string;
} = {}): string {
  const params = new URLSearchParams();
  if (typeof options.page === 'number' && Number.isFinite(options.page)) {
    params.set('page', String(Math.max(1, Math.floor(options.page))));
  }
  if (options.chunkId) params.set('chunk', options.chunkId);
  if (options.anchorId) params.set('anchor', options.anchorId);
  const suffix = params.toString();
  return `${normalizeRelativePath(path)}${suffix ? `#${suffix}` : ''}`;
}

export function codeHref(path: string, lines?: { start: number; end?: number }): string {
  const normalized = normalizeRelativePath(path);
  if (!lines) return normalized;
  const start = Math.max(1, Math.floor(lines.start));
  const end = Math.max(start, Math.floor(lines.end ?? start));
  return `${normalized}#L${start}${end > start ? `-L${end}` : ''}`;
}

export function normalizeRelativePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)
    .join('/');
}

function classifyWebTarget(uri: string): ReferenceTarget {
  const webTargetId = webTargetIdFromUrl(uri);
  return withoutUndefined({
    kind: 'web',
    uri,
    url: uri,
    webTargetId,
  });
}

function webTargetIdFromUrl(uri: string): string | undefined {
  const hash = uri.match(/#(.+)$/)?.[1] ?? '';
  if (!hash.startsWith('hl-web=')) return undefined;
  const value = hash.slice('hl-web='.length);
  return value ? decodeURIComponent(value) : undefined;
}

function splitPathAndFragment(uri: string): { path: string; fragment: string } {
  const hashIndex = uri.indexOf('#');
  if (hashIndex < 0) return { path: uri, fragment: '' };
  return {
    path: uri.slice(0, hashIndex),
    fragment: uri.slice(hashIndex + 1),
  };
}

function fragmentParams(fragment: string): URLSearchParams {
  return new URLSearchParams(fragment.startsWith('?') ? fragment.slice(1) : fragment);
}

function numberParam(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function parseLineFragment(fragment: string): { start: number; end: number } | undefined {
  const match = fragment.match(/^L?(\d+)(?:-L?(\d+))?$/i);
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return { start, end: Math.max(start, end) };
}

function hasLineFragment(fragment: string): boolean {
  return Boolean(parseLineFragment(fragment));
}

function fileExtension(path: string): string {
  return path.split('/').pop()?.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? '';
}

function isImageExtension(extension: string): boolean {
  return ['gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'].includes(extension);
}

function decodePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map(segment => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}

function stripMarkdownDestination(uri: string): string {
  const trimmed = uri.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function withoutUndefined(value: ReferenceTarget): ReferenceTarget {
  for (const key of Object.keys(value)) {
    const typedKey = key as keyof ReferenceTarget;
    if (value[typedKey] === undefined) {
      delete value[typedKey];
    }
  }
  return value;
}
