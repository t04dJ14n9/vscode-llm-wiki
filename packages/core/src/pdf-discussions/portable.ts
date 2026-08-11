import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import type { PdfDiscussionAnnotationV1, PdfDiscussionRectV1 } from './schema';

const WEB_ANNOTATION_CONTEXT = 'http://www.w3.org/ns/anno.jsonld';
export const HUMAN_LEARNING_CONTEXT = 'urn:human-learning:';
export const PDF_FRAGMENT_CONFORMS_TO = 'https://www.rfc-editor.org/rfc/rfc8118';

export interface PortablePdfAnnotationInput {
  annotation: PdfDiscussionAnnotationV1;
  pdfSha256: string;
  sourcePath: string;
  annotationPath: string;
  learningNotePath?: string;
}

export interface PortablePdfAnnotation {
  '@context': readonly [
    'http://www.w3.org/ns/anno.jsonld',
    { readonly hl: typeof HUMAN_LEARNING_CONTEXT },
  ];
  id: string;
  type: 'Annotation';
  motivation: 'commenting';
  created: string;
  modified: string;
  'hl:discussionId': string;
  'hl:selectionKey': string;
  body?: {
    id: string;
    type: 'Text';
    format: 'text/markdown';
    purpose: 'commenting';
  };
  target: {
    type: 'SpecificResource';
    source: {
      id: string;
      type: 'Document';
      format: 'application/pdf';
      'hl:sha256': string;
    };
    selector: Array<Record<string, unknown>>;
  };
  'hl:snapshot'?: Record<string, unknown>;
}

export interface ScannedPortablePdfAnnotation {
  annotationId: string;
  annotationPath: string;
  pdfSha256: string;
  sourcePath: string;
  page: number;
  exactText: string;
  prefix?: string;
  suffix?: string;
  rects: PdfDiscussionRectV1[];
  learningNotePath?: string;
  snapshotPath?: string;
}

/** Build a repository-portable W3C Web Annotation mirror. */
export function toPortablePdfAnnotation(
  input: PortablePdfAnnotationInput,
): PortablePdfAnnotation {
  const annotationPath = repositoryPath(input.annotationPath);
  const sourcePath = repositoryPath(input.sourcePath);
  const pdfSha256 = sha256(input.pdfSha256);
  const { annotation } = input;
  const { anchor, snapshot } = annotation;
  const selectors: Array<Record<string, unknown>> = [
    {
      type: 'TextQuoteSelector',
      exact: anchor.quote,
      ...(anchor.prefix !== undefined ? { prefix: anchor.prefix } : {}),
      ...(anchor.suffix !== undefined ? { suffix: anchor.suffix } : {}),
    },
    {
      type: 'FragmentSelector',
      conformsTo: PDF_FRAGMENT_CONFORMS_TO,
      value: `page=${anchor.page}`,
    },
    {
      type: 'hl:PdfRectSelector',
      'hl:page': anchor.page,
      'hl:unit': 'pt',
      'hl:origin': 'top-left',
      'hl:coordinates': 'left,top,right,bottom',
      'hl:rects': anchor.rects.map(copyRect),
    },
  ];
  const textPosition = pdfTextPositionSelector(anchor);
  if (textPosition) selectors.push(textPosition);

  return {
    '@context': [
      WEB_ANNOTATION_CONTEXT,
      { hl: HUMAN_LEARNING_CONTEXT },
    ],
    id: annotationUrn(annotation.id),
    type: 'Annotation',
    motivation: 'commenting',
    created: annotation.createdAt,
    modified: annotation.updatedAt,
    'hl:discussionId': annotation.id,
    'hl:selectionKey': annotation.selectionKey,
    ...(input.learningNotePath
      ? {
          body: {
            id: relativeIri(annotationPath, repositoryPath(input.learningNotePath)),
            type: 'Text',
            format: 'text/markdown',
            purpose: 'commenting',
          } as const,
        }
      : {}),
    target: {
      type: 'SpecificResource',
      source: {
        id: relativeIri(annotationPath, sourcePath),
        type: 'Document',
        format: 'application/pdf',
        'hl:sha256': pdfSha256,
      },
      selector: selectors,
    },
    ...(snapshot
      ? {
          'hl:snapshot': {
            id: relativeIri(
              annotationPath,
              repositoryPath(posix.join('.hl/annotations/pdf', snapshot.file)),
            ),
            type: 'Image',
            format: 'image/png',
            'hl:sha256': snapshot.sha256,
            'hl:width': snapshot.width,
            'hl:height': snapshot.height,
            'hl:page': anchor.page,
            ...(snapshot.cropRect
              ? {
                  'hl:cropRect': copyRect(snapshot.cropRect),
                  'hl:padding': snapshot.padding,
                  'hl:unit': snapshot.unit,
                }
              : {}),
          },
        }
      : {}),
  };
}

/** Scan only portable annotation mirrors and expose their original text. */
export async function scanPortablePdfAnnotations(
  workspaceRoot: string,
): Promise<ScannedPortablePdfAnnotation[]> {
  let canonicalWorkspace: string;
  try {
    canonicalWorkspace = await realpath(resolve(workspaceRoot));
  } catch {
    return [];
  }
  const root = resolve(canonicalWorkspace, '.hl', 'annotations', 'pdf');
  if (!await plainPath(canonicalWorkspace, root, 'directory')) return [];
  const records: ScannedPortablePdfAnnotation[] = [];
  for (const directory of await entries(root)) {
    if (!directory.isDirectory() || !/^[a-f0-9]{64}$/u.test(directory.name)) continue;
    const hashRoot = resolve(root, directory.name);
    if (!await plainPath(canonicalWorkspace, hashRoot, 'directory')) continue;
    for (const file of await entries(hashRoot)) {
      if (!file.isFile() || !file.name.endsWith('.jsonld')) continue;
      const path = resolve(hashRoot, file.name);
      try {
        const annotationPath = posix.join(
          '.hl',
          'annotations',
          'pdf',
          directory.name,
          file.name,
        );
        const json = await readPlainFile(canonicalWorkspace, path);
        if (json === undefined) continue;
        const record = scanRecord(
          JSON.parse(json),
          annotationPath,
          directory.name,
        );
        if (record) records.push(record);
      } catch {
        // One damaged mirror must not hide the remaining annotations.
      }
    }
  }
  return records.sort((left, right) =>
    left.annotationPath.localeCompare(right.annotationPath));
}

function pdfTextPositionSelector(
  anchor: PdfDiscussionAnnotationV1['anchor'],
): Record<string, unknown> | undefined {
  const values = [
    anchor.textItemIndex,
    anchor.charOffset,
    anchor.endTextItemIndex,
    anchor.endCharOffset,
  ];
  if (values.every(value => value === undefined)) return undefined;
  return {
    type: 'hl:PdfTextItemSelector',
    'hl:start': {
      ...(anchor.textItemIndex !== undefined
        ? { 'hl:textItemIndex': anchor.textItemIndex }
        : {}),
      ...(anchor.charOffset !== undefined ? { 'hl:charOffset': anchor.charOffset } : {}),
    },
    'hl:end': {
      ...(anchor.endTextItemIndex !== undefined
        ? { 'hl:textItemIndex': anchor.endTextItemIndex }
        : {}),
      ...(anchor.endCharOffset !== undefined
        ? { 'hl:charOffset': anchor.endCharOffset }
        : {}),
    },
  };
}

function scanRecord(
  value: unknown,
  annotationPath: string,
  directoryHash: string,
): ScannedPortablePdfAnnotation | undefined {
  if (
    !record(value)
    || !portableContext(value['@context'])
    || value.type !== 'Annotation'
    || value.motivation !== 'commenting'
    || typeof value['hl:discussionId'] !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value['hl:discussionId'])
    || value.id !== annotationUrn(value['hl:discussionId'])
    || typeof value['hl:selectionKey'] !== 'string'
    || !value['hl:selectionKey']
    || typeof value.created !== 'string'
    || typeof value.modified !== 'string'
    || !record(value.target)
    || value.target.type !== 'SpecificResource'
  ) return undefined;
  const source = value.target.source;
  if (
    !record(source)
    || typeof source.id !== 'string'
    || source.type !== 'Document'
    || source.format !== 'application/pdf'
    || source['hl:sha256'] !== directoryHash
  ) return undefined;

  const selectors = unknownArray(value.target.selector);
  const quote = uniqueSelector(selectors, 'TextQuoteSelector');
  const pageSelector = uniqueSelector(selectors, 'FragmentSelector');
  const geometry = uniqueSelector(selectors, 'hl:PdfRectSelector');
  const textPosition = optionalSelector(selectors, 'hl:PdfTextItemSelector');
  if (
    !quote
    || typeof quote.exact !== 'string'
    || ('prefix' in quote && typeof quote.prefix !== 'string')
    || ('suffix' in quote && typeof quote.suffix !== 'string')
    || !pageSelector
    || pageSelector.conformsTo !== PDF_FRAGMENT_CONFORMS_TO
    || !geometry
    || textPosition === null
    || (textPosition !== undefined && !validPdfTextPosition(textPosition))
  ) return undefined;
  const pageMatch = typeof pageSelector.value === 'string'
    ? /^page=(\d+)$/u.exec(pageSelector.value)
    : undefined;
  const page = Number(pageMatch?.[1]);
  const rects = pdfRects(geometry['hl:rects']);
  const sourcePath = resolveIri(annotationPath, source.id);
  if (
    !Number.isSafeInteger(page)
    || page < 1
    || geometry['hl:page'] !== page
    || geometry['hl:unit'] !== 'pt'
    || geometry['hl:origin'] !== 'top-left'
    || geometry['hl:coordinates'] !== 'left,top,right,bottom'
    || !rects
    || !sourcePath
    || !sourcePath.toLowerCase().endsWith('.pdf')
  ) return undefined;

  const body = optionalBody(value.body, annotationPath);
  const snapshot = optionalSnapshot(
    value['hl:snapshot'],
    annotationPath,
    value['hl:discussionId'],
    page,
  );
  if (body === null || snapshot === null) return undefined;
  return {
    annotationId: value['hl:discussionId'],
    annotationPath,
    pdfSha256: directoryHash,
    sourcePath,
    page,
    exactText: quote.exact,
    ...(typeof quote.prefix === 'string' ? { prefix: quote.prefix } : {}),
    ...(typeof quote.suffix === 'string' ? { suffix: quote.suffix } : {}),
    rects,
    ...(body ? { learningNotePath: body } : {}),
    ...(snapshot ? { snapshotPath: snapshot } : {}),
  };
}

function annotationUrn(annotationId: string): string {
  return `urn:human-learning:annotation:${encodeURIComponent(annotationId)}`;
}

function portableContext(value: unknown): boolean {
  return Array.isArray(value)
    && value.length === 2
    && value[0] === WEB_ANNOTATION_CONTEXT
    && record(value[1])
    && Object.keys(value[1]).length === 1
    && value[1].hl === HUMAN_LEARNING_CONTEXT;
}

function uniqueSelector(
  selectors: unknown[],
  type: string,
): Record<string, unknown> | undefined {
  const matches = selectors.filter(
    (selector): selector is Record<string, unknown> =>
      record(selector) && selector.type === type,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function optionalSelector(
  selectors: unknown[],
  type: string,
): Record<string, unknown> | null | undefined {
  const matches = selectors.filter(
    (selector): selector is Record<string, unknown> =>
      record(selector) && selector.type === type,
  );
  return matches.length > 1 ? null : matches[0];
}

function validPdfTextPosition(selector: Record<string, unknown>): boolean {
  const endpoints = [selector['hl:start'], selector['hl:end']];
  return endpoints.every(endpoint => {
    if (!record(endpoint)) return false;
    const keys = Object.keys(endpoint);
    return keys.every(key => key === 'hl:textItemIndex' || key === 'hl:charOffset')
      && keys.every(key => {
        const value = endpoint[key];
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
      });
  });
}

function optionalBody(
  value: unknown,
  annotationPath: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (
    !record(value)
    || typeof value.id !== 'string'
    || value.type !== 'Text'
    || value.format !== 'text/markdown'
    || value.purpose !== 'commenting'
  ) return null;
  const path = resolveIri(annotationPath, value.id);
  return path?.toLowerCase().endsWith('.md') ? path : null;
}

function optionalSnapshot(
  value: unknown,
  annotationPath: string,
  annotationId: string,
  page: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (
    !record(value)
    || typeof value.id !== 'string'
    || value.type !== 'Image'
    || value.format !== 'image/png'
    || !/^[a-f0-9]{64}$/u.test(String(value['hl:sha256']))
    || !positiveInteger(value['hl:width'])
    || !positiveInteger(value['hl:height'])
    || value['hl:page'] !== page
  ) return null;
  const path = resolveIri(annotationPath, value.id);
  if (
    path !== posix.join(
      '.hl',
      'annotations',
      'pdf',
      'assets',
      annotationId,
      'selection.png',
    )
  ) return null;
  const crop = value['hl:cropRect'];
  const padding = value['hl:padding'];
  const unit = value['hl:unit'];
  const hasCrop = crop !== undefined || padding !== undefined || unit !== undefined;
  if (
    hasCrop
    && (
      !pdfRect(crop)
      || typeof padding !== 'number'
      || !Number.isFinite(padding)
      || padding < 0
      || unit !== 'pt'
    )
  ) return null;
  return path;
}

function repositoryPath(value: string): string {
  const path = posix.normalize(value.replace(/\\/gu, '/')).replace(/^\.\//u, '');
  if (
    !path
    || path.includes('\0')
    || path === '.'
    || path === '..'
    || path.startsWith('../')
    || path.startsWith('/')
    || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(path)
  ) throw new TypeError('Portable annotation paths must stay inside the repository');
  return path;
}

function relativeIri(annotationPath: string, targetPath: string): string {
  const relative = posix.relative(posix.dirname(annotationPath), targetPath);
  return relative.split('/').map(segment =>
    segment === '.' || segment === '..' ? segment : encodeURIComponent(segment)).join('/');
}

function resolveIri(annotationPath: string, iri: string): string | undefined {
  if (
    !iri
    || iri.includes('?')
    || iri.includes('#')
    || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(iri)
    || iri.startsWith('/')
  ) return undefined;
  try {
    const decoded = iri.split('/').map(segment => decodeURIComponent(segment)).join('/');
    return repositoryPath(posix.join(posix.dirname(annotationPath), decoded));
  } catch {
    return undefined;
  }
}

function pdfRects(value: unknown): PdfDiscussionRectV1[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rects = value.filter((item): item is number[] => pdfRect(item));
  return rects.length === value.length && rects.length > 0 ? rects.map(copyRect) : undefined;
}

function pdfRect(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length === 4
    && value.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate))
    && value[2]! > value[0]!
    && value[3]! > value[1]!;
}

function positiveInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function copyRect(rect: readonly number[]): PdfDiscussionRectV1 {
  return [rect[0]!, rect[1]!, rect[2]!, rect[3]!];
}

function sha256(value: string): string {
  if (!/^[a-f0-9]{64}$/iu.test(value)) throw new TypeError('Invalid PDF SHA-256');
  return value.toLowerCase();
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value as unknown[] : [];
}

async function entries(path: string) {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter(entry => !entry.isSymbolicLink())
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

async function plainPath(
  root: string,
  path: string,
  kind: 'file' | 'directory',
): Promise<boolean> {
  try {
    if (!pathIsWithin(root, path)) return false;
    const stat = await lstat(path);
    const canonical = await realpath(path);
    return !stat.isSymbolicLink()
      && samePath(canonical, resolve(path))
      && (kind === 'file' ? stat.isFile() : stat.isDirectory());
  } catch {
    return false;
  }
}

async function readPlainFile(root: string, path: string): Promise<string | undefined> {
  if (!await plainPath(root, path, 'file')) return undefined;
  let descriptor: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const before = await lstat(path);
    descriptor = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await descriptor.stat();
    if (!sameEntry(before, opened)) return undefined;
    const contents = await descriptor.readFile({ encoding: 'utf8' });
    const after = await lstat(path);
    const canonical = await realpath(path);
    return sameEntry(opened, after) && samePath(canonical, resolve(path))
      ? contents
      : undefined;
  } catch {
    return undefined;
  } finally {
    await descriptor?.close();
  }
}

function pathIsWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === ''
    || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function sameEntry(
  left: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number },
  right: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number },
): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}
