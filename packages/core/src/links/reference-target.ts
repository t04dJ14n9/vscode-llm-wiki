export type ReferenceKind = 'note' | 'pdf' | 'code' | 'web' | 'image' | 'text' | 'unknown';

export interface PdfTextFragment {
  textStart: string;
  textEnd?: string;
  prefix?: string;
  suffix?: string;
}

export interface ReferenceTarget {
  kind: ReferenceKind;
  uri: string;
  path?: string;
  url?: string;
  heading?: string;
  lines?: { start: number; end: number };
  page?: number;
  textFragment?: PdfTextFragment;
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
    const { navigation, directives } = splitFragmentDirective(fragment);
    const params = fragmentParams(navigation);
    const page = numberParam(params, 'page');
    const textFragment = parsePdfTextFragment(directives);
    return withoutUndefined({
      kind: 'pdf',
      uri: cleaned,
      path: decodedPath,
      page,
      textFragment,
    });
  }

  if (extension === 'md') {
    const lines = parseLineFragment(fragment);
    return withoutUndefined({
      kind: 'note',
      uri: cleaned,
      path: decodedPath,
      heading: fragment && !lines ? decodeURIComponent(fragment) : undefined,
      lines,
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
  textFragment?: PdfTextFragment;
} = {}): string {
  const params = new URLSearchParams();
  if (typeof options.page === 'number' && Number.isFinite(options.page)) {
    params.set('page', String(Math.max(1, Math.floor(options.page))));
  }
  const navigation = params.toString();
  const textDirective = serializePdfTextFragment(options.textFragment);
  const fragment = `${navigation}${textDirective ? `:~:${textDirective}` : ''}`;
  return `${normalizePdfPath(path)}${fragment ? `#${fragment}` : ''}`;
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

function normalizePdfPath(path: string): string {
  const slashNormalized = path.replace(/\\/g, '/');
  const absolutePrefix = slashNormalized.startsWith('//')
    ? '//'
    : slashNormalized.startsWith('/')
      ? '/'
      : '';
  return `${absolutePrefix}${normalizeRelativePath(slashNormalized)}`;
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
  const value = hash.slice('hl-web='.length).split(':~:')[0];
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

function splitFragmentDirective(fragment: string): { navigation: string; directives: string } {
  const directiveIndex = fragment.indexOf(':~:');
  if (directiveIndex < 0) {
    return { navigation: fragment, directives: '' };
  }
  return {
    navigation: fragment.slice(0, directiveIndex),
    directives: fragment.slice(directiveIndex + 3),
  };
}

function serializePdfTextFragment(fragment: PdfTextFragment | undefined): string | undefined {
  if (!fragment?.textStart) return undefined;
  const terms: string[] = [];
  if (fragment.prefix) terms.push(`${encodeTextTerm(fragment.prefix)}-`);
  terms.push(encodeTextTerm(fragment.textStart));
  if (fragment.textEnd) terms.push(encodeTextTerm(fragment.textEnd));
  if (fragment.suffix) terms.push(`-${encodeTextTerm(fragment.suffix)}`);
  return `text=${terms.join(',')}`;
}

function parsePdfTextFragment(directives: string): PdfTextFragment | undefined {
  for (const directive of directives.split('&')) {
    if (!directive.startsWith('text=')) continue;
    const parsed = parsePdfTextDirective(directive.slice('text='.length));
    if (parsed) return parsed;
  }
  return undefined;
}

function parsePdfTextDirective(value: string): PdfTextFragment | undefined {
  const terms = value.split(',');
  if (terms.length < 1 || terms.length > 4) return undefined;

  let firstTextTerm = 0;
  let afterLastTextTerm = terms.length;
  let rawPrefix: string | undefined;
  let rawSuffix: string | undefined;

  if (terms[0]!.endsWith('-')) {
    rawPrefix = terms[0]!.slice(0, -1);
    firstTextTerm++;
  }
  if (terms[terms.length - 1]!.startsWith('-')) {
    rawSuffix = terms[terms.length - 1]!.slice(1);
    afterLastTextTerm--;
  }

  const rawTextTerms = terms.slice(firstTextTerm, afterLastTextTerm);
  if (rawTextTerms.length < 1 || rawTextTerms.length > 2) return undefined;

  const prefix = rawPrefix === undefined ? undefined : decodeTextTerm(rawPrefix);
  const textStart = decodeTextTerm(rawTextTerms[0]!);
  const textEnd = rawTextTerms[1] === undefined ? undefined : decodeTextTerm(rawTextTerms[1]);
  const suffix = rawSuffix === undefined ? undefined : decodeTextTerm(rawSuffix);
  if (!textStart) return undefined;
  if (rawPrefix !== undefined && !prefix) return undefined;
  if (rawTextTerms[1] !== undefined && !textEnd) return undefined;
  if (rawSuffix !== undefined && !suffix) return undefined;

  return withoutUndefinedTextFragment({ textStart, textEnd, prefix, suffix });
}

function encodeTextTerm(term: string): string {
  return encodeURIComponent(term).replace(/-/g, '%2D');
}

function decodeTextTerm(term: string): string | undefined {
  if (!term || term.includes('-')) return undefined;
  try {
    return decodeURIComponent(term) || undefined;
  } catch {
    return undefined;
  }
}

function withoutUndefinedTextFragment(fragment: PdfTextFragment): PdfTextFragment {
  if (fragment.textEnd === undefined) delete fragment.textEnd;
  if (fragment.prefix === undefined) delete fragment.prefix;
  if (fragment.suffix === undefined) delete fragment.suffix;
  return fragment;
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
