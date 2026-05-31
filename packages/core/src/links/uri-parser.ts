// hl:// URI parser — matches the implementation plan §3.1 and feature list §6.
//
// Supported forms:
//   hl://note/<path>                        — whole note
//   hl://note/<path>#<heading>              — heading in note
//   hl://anchor/<anchor_id>                 — explicit anchor
//   hl://pdf/<path>?anchor=<anchor_id>      — PDF region anchor
//   hl://code/<path>?lines=<start>-<end>    — code line range
//   hl://code/<path>?symbol=<name>          — code symbol
//   hl://web/<path>?selector=<css>          — HTML element

export interface HlUri {
  kind: 'note' | 'anchor' | 'pdf' | 'code' | 'web' | 'image';
  path?: string;
  anchorId?: string;
  heading?: string;
  lines?: { start: number; end: number };
  symbol?: string;
  selector?: string;
  rect?: number[]; // [x0,y0,x1,y1]
  page?: number;
}

export function parseHlUri(uri: string): HlUri | null {
  if (!uri.startsWith('hl://')) return null;

  const rest = uri.slice('hl://'.length);
  const questionIdx = rest.indexOf('?');
  const hashIdx = rest.indexOf('#');

  // Extract path (before ? or #)
  let pathPart: string;
  let queryPart = '';
  if (questionIdx >= 0) {
    pathPart = rest.substring(0, questionIdx);
    queryPart = rest.substring(questionIdx + 1);
  } else if (hashIdx >= 0) {
    pathPart = rest.substring(0, hashIdx);
    queryPart = 'heading=' + encodeURIComponent(rest.substring(hashIdx + 1));
  } else {
    pathPart = rest;
  }

  const [kind, ...pathSegments] = pathPart.split('/');
  const path = pathSegments.length > 0 ? pathSegments.join('/') : undefined;

  const params = new URLSearchParams(queryPart);

  const result: HlUri = { kind: kind as HlUri['kind'] };

  if (path) result.path = path;

  if (params.has('anchor')) result.anchorId = params.get('anchor')!;
  if (params.has('heading')) result.heading = decodeURIComponent(params.get('heading')!);
  if (params.has('lines')) {
    const [s, e] = params.get('lines')!.split('-').map(Number);
    if (!isNaN(s!) && !isNaN(e!)) result.lines = { start: s!, end: e! };
  }
  if (params.has('symbol')) result.symbol = params.get('symbol')!;
  if (params.has('selector')) result.selector = decodeURIComponent(params.get('selector')!);
  if (params.has('rect')) {
    result.rect = params.get('rect')!.split(',').map(Number);
  }
  if (params.has('page')) result.page = parseInt(params.get('page')!, 10);

  return result;
}

export function formatHlUri(parsed: HlUri): string {
  const params = new URLSearchParams();
  if (parsed.anchorId) params.set('anchor', parsed.anchorId);
  if (parsed.heading) params.set('heading', parsed.heading);
  if (parsed.lines) params.set('lines', `${parsed.lines.start}-${parsed.lines.end}`);
  if (parsed.symbol) params.set('symbol', parsed.symbol);
  if (parsed.selector) params.set('selector', parsed.selector);
  if (parsed.rect) params.set('rect', parsed.rect.join(','));
  if (parsed.page !== undefined) params.set('page', String(parsed.page));

  const path = parsed.path ? `/${parsed.path}` : '';
  const qs = params.toString();
  return `hl://${parsed.kind}${path}${qs ? '?' + qs : ''}`;
}

/** Normalize a URI — resolve wikilink references, deduplicate forms */
export function normalizeUri(uri: string): string | null {
  const parsed = parseHlUri(uri);
  if (!parsed) return null;
  return formatHlUri(parsed);
}
