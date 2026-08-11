import { open, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const EXCLUDED_DIRECTORIES = new Set(['.git', '.hl', 'dist', 'node_modules', 'out']);
const DEFAULT_MAX_FILES = 10_000;
const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 100_000;
const HARD_MAX_FILES = 100_000;
const HARD_MAX_FILE_BYTES = 64 * 1024 * 1024;
const HARD_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const HARD_MAX_ENTRIES = 1_000_000;

export interface MarkdownSource {
  path: string;
  text: string;
}

export interface WikiHeading {
  id: string;
  text: string;
  level: number;
  line: number;
}

export interface WikiDocument {
  path: string;
  title: string;
  headings: readonly WikiHeading[];
  concepts: readonly string[];
  entities: readonly string[];
}

export type WikiLinkKind = 'markdown' | 'wikilink' | 'external' | 'asset';

export interface WikiLink {
  kind: WikiLinkKind;
  sourcePath: string;
  sourceOffset: number;
  line: number;
  label: string;
  rawTarget: string;
  href: string;
  targetPath?: string;
  heading?: string;
  targetExists: boolean;
  headingExists?: boolean;
  resolved: boolean;
}

export interface FilesystemWiki {
  documents: readonly WikiDocument[];
  links: readonly WikiLink[];
}

export interface FilesystemWikiLoadOptions {
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxEntries?: number;
}

export interface BrokenWikiLink {
  reason: 'missing-note' | 'missing-heading';
  message: string;
  link: WikiLink;
}

export interface ConceptGraphNode {
  id: string;
  label: string;
  path?: string;
  kind: 'note' | 'concept' | 'entity';
}

export interface ConceptGraphEdge {
  id: string;
  source: string;
  target: string;
  count: number;
  labels: readonly string[];
  kind?: 'concept' | 'entity';
}

export interface ConceptGraph {
  nodes: readonly ConceptGraphNode[];
  edges: readonly ConceptGraphEdge[];
}

/**
 * Read every Markdown note below a workspace root and build an in-memory link index.
 * The returned index is disposable: callers can rebuild it whenever files change.
 */
export async function loadFilesystemWiki(
  workspaceRoot: string,
  options: FilesystemWikiLoadOptions = {},
): Promise<FilesystemWiki> {
  const root = resolve(workspaceRoot);
  const sources: MarkdownSource[] = [];
  await collectMarkdownSources(root, root, sources, {
    files: 0,
    bytes: 0,
    entries: 0,
    maxFiles: positiveLimit(options.maxFiles, DEFAULT_MAX_FILES, HARD_MAX_FILES),
    maxFileBytes: positiveLimit(
      options.maxFileBytes,
      DEFAULT_MAX_FILE_BYTES,
      HARD_MAX_FILE_BYTES,
    ),
    maxTotalBytes: positiveLimit(
      options.maxTotalBytes,
      DEFAULT_MAX_TOTAL_BYTES,
      HARD_MAX_TOTAL_BYTES,
    ),
    maxEntries: positiveLimit(options.maxEntries, DEFAULT_MAX_ENTRIES, HARD_MAX_ENTRIES),
  });
  return createFilesystemWiki(sources);
}

/**
 * Build a wiki index from in-memory sources. This is the pure entry point used by
 * tests and by callers that already have note contents.
 */
export function createFilesystemWiki(sources: readonly MarkdownSource[]): FilesystemWiki {
  const normalizedSources = [...sources]
    .map(source => ({ path: normalizeNotePath(source.path), text: source.text }))
    .filter(source => source.path.toLowerCase().endsWith('.md'))
    .sort((left, right) => left.path.localeCompare(right.path));

  const seenPaths = new Set<string>();
  const uniqueSources = normalizedSources.filter(source => {
    const key = comparablePath(source.path);
    if (seenPaths.has(key)) return false;
    seenPaths.add(key);
    return true;
  });

  const documents = uniqueSources.map(source => {
    const headings = parseHeadings(source.text);
    const metadata = parseKnowledgeMetadata(source.text);
    return {
      path: source.path,
      title: headings.find(heading => heading.level === 1)?.text ?? noteTitle(source.path),
      headings,
      concepts: metadata.concepts,
      entities: metadata.entities,
    } satisfies WikiDocument;
  });

  const links = uniqueSources
    .flatMap(source => parseLinks(source.text, source.path, documents))
    .sort(compareLinks);

  return { documents, links };
}

export function getForwardLinks(wiki: FilesystemWiki, sourcePath: string): WikiLink[] {
  const key = comparablePath(sourcePath);
  return wiki.links
    .filter(link => comparablePath(link.sourcePath) === key)
    .sort(compareLinks);
}

export function getBacklinks(wiki: FilesystemWiki, targetPath: string): WikiLink[] {
  const key = comparablePath(splitOnce(normalizeNotePath(targetPath), '#')[0]);
  return wiki.links
    .filter(link => {
      if (link.targetPath !== undefined) return comparablePath(link.targetPath) === key;
      if (link.kind !== 'asset') return false;
      const rawPath = safeDecodeURIComponent(splitOnce(link.href, '#')[0]);
      return comparablePath(resolveRelativeNotePath(link.sourcePath, rawPath)) === key;
    })
    .sort(compareLinks);
}

export function getBrokenLinks(wiki: FilesystemWiki): BrokenWikiLink[] {
  const broken: BrokenWikiLink[] = [];
  for (const link of wiki.links) {
    if (link.kind !== 'markdown' && link.kind !== 'wikilink') continue;
    if (!link.targetExists) {
      broken.push({
        reason: 'missing-note',
        message: `Target note not found: ${link.targetPath ?? link.rawTarget} (${link.sourcePath}:${link.line})`,
        link,
      });
      continue;
    }
    if (link.heading && link.headingExists === false) {
      broken.push({
        reason: 'missing-heading',
        message: `Heading not found: ${link.targetPath}#${link.heading} (${link.sourcePath}:${link.line})`,
        link,
      });
    }
  }
  return broken.sort((left, right) => compareLinks(left.link, right.link));
}

export function getConceptGraph(wiki: FilesystemWiki): ConceptGraph {
  const noteNodes = wiki.documents
    .map(document => ({
      id: document.path,
      label: document.title,
      path: document.path,
      kind: 'note' as const,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const metadataNodes = new Map<string, ConceptGraphNode>();

  const edgesByPair = new Map<string, {
    source: string;
    target: string;
    count: number;
    labels: Set<string>;
    kind?: 'concept' | 'entity';
  }>();

  for (const link of wiki.links) {
    if (!link.resolved || !link.targetPath || link.sourcePath === link.targetPath) continue;
    const key = `${link.sourcePath}\u0000${link.targetPath}`;
    const existing = edgesByPair.get(key);
    if (existing) {
      existing.count += 1;
      if (link.label) existing.labels.add(link.label);
      continue;
    }
    edgesByPair.set(key, {
      source: link.sourcePath,
      target: link.targetPath,
      count: 1,
      labels: new Set(link.label ? [link.label] : []),
    });
  }

  for (const document of wiki.documents) {
    addMetadataEdges(document.path, 'concept', document.concepts ?? [], metadataNodes, edgesByPair);
    addMetadataEdges(document.path, 'entity', document.entities ?? [], metadataNodes, edgesByPair);
  }

  const nodes = [
    ...noteNodes,
    ...[...metadataNodes.values()].sort((left, right) =>
      left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label)
    ),
  ];
  const edges = [...edgesByPair.values()]
    .map(edge => ({
      id: `${edge.source}->${edge.target}`,
      source: edge.source,
      target: edge.target,
      count: edge.count,
      labels: [...edge.labels].sort((left, right) => left.localeCompare(right)),
      ...(edge.kind ? { kind: edge.kind } : {}),
    }))
    .sort((left, right) =>
      left.source.localeCompare(right.source) || left.target.localeCompare(right.target)
    );

  return { nodes, edges };
}

function addMetadataEdges(
  sourcePath: string,
  kind: 'concept' | 'entity',
  values: readonly string[],
  nodes: Map<string, ConceptGraphNode>,
  edges: Map<string, {
    source: string;
    target: string;
    count: number;
    labels: Set<string>;
    kind?: 'concept' | 'entity';
  }>,
): void {
  for (const value of values) {
    const id = metadataNodeId(kind, value);
    if (!nodes.has(id)) {
      nodes.set(id, { id, label: value, kind });
    }
    const key = `${sourcePath}\u0000${id}`;
    if (!edges.has(key)) {
      edges.set(key, {
        source: sourcePath,
        target: id,
        count: 1,
        labels: new Set(),
        kind,
      });
    }
  }
}

function metadataNodeId(kind: 'concept' | 'entity', value: string): string {
  return `${kind}:${value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')}`;
}

async function collectMarkdownSources(
  root: string,
  directory: string,
  output: MarkdownSource[],
  budget: MarkdownCollectionBudget,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  budget.entries += entries.length;
  assertWithinWikiLimit(
    budget.entries <= budget.maxEntries,
    `entry count exceeds ${budget.maxEntries}`,
  );
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        await collectMarkdownSources(root, absolutePath, output, budget);
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    budget.files += 1;
    assertWithinWikiLimit(
      budget.files <= budget.maxFiles,
      `Markdown file count exceeds ${budget.maxFiles}`,
    );
    const metadata = await stat(absolutePath);
    assertWithinWikiLimit(
      metadata.size <= budget.maxFileBytes,
      `${normalizeNotePath(relative(root, absolutePath))} exceeds ${budget.maxFileBytes} bytes`,
    );
    budget.bytes += metadata.size;
    assertWithinWikiLimit(
      budget.bytes <= budget.maxTotalBytes,
      `Markdown bytes exceed ${budget.maxTotalBytes}`,
    );
    output.push({
      path: normalizeNotePath(relative(root, absolutePath)),
      text: await readBoundedUtf8(absolutePath, budget.maxFileBytes),
    });
  }
}

interface MarkdownCollectionBudget {
  files: number;
  bytes: number;
  entries: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxEntries: number;
}

function positiveLimit(value: number | undefined, fallback: number, maximum: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Math.min(Number(value), maximum)
    : fallback;
}

function assertWithinWikiLimit(condition: boolean, detail: string): asserts condition {
  if (!condition) throw new Error(`Filesystem wiki scan limit exceeded: ${detail}.`);
}

async function readBoundedUtf8(filePath: string, maxBytes: number): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    assertWithinWikiLimit(
      offset <= maxBytes,
      `${filePath} changed while reading and exceeds ${maxBytes} bytes`,
    );
    return buffer.subarray(0, offset).toString('utf8');
  } finally {
    await handle.close();
  }
}

function parseLinks(
  text: string,
  sourcePath: string,
  documents: readonly WikiDocument[],
): WikiLink[] {
  const masked = maskCode(text);
  const links: WikiLink[] = [];
  const markdownRanges: Array<{ start: number; end: number }> = [];
  const markdownLinkPattern = /!?\[([^\]\n]*)\]\((<[^>\n]+>|[^)\n]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = markdownLinkPattern.exec(masked)) !== null) {
    if (match[0].startsWith('!')) continue;
    const destination = normalizeMarkdownDestination(match[2] ?? '');
    if (!destination) continue;
    markdownRanges.push({ start: match.index, end: match.index + match[0].length });
    links.push(resolveMarkdownLink({
      destination,
      label: cleanInlineText(match[1] ?? ''),
      sourcePath,
      sourceOffset: match.index,
      line: lineNumberAt(text, match.index),
      documents,
    }));
  }

  const wikiLinkPattern = /!?\[\[([^\]\n]+)\]\]/g;
  while ((match = wikiLinkPattern.exec(masked)) !== null) {
    if (match[0].startsWith('!')) continue;
    if (markdownRanges.some(range => match!.index >= range.start && match!.index < range.end)) {
      continue;
    }
    links.push(resolveWikiLink({
      inner: match[1] ?? '',
      sourcePath,
      sourceOffset: match.index,
      line: lineNumberAt(text, match.index),
      documents,
    }));
  }

  return links.sort(compareLinks);
}

function resolveMarkdownLink(input: {
  destination: string;
  label: string;
  sourcePath: string;
  sourceOffset: number;
  line: number;
  documents: readonly WikiDocument[];
}): WikiLink {
  const customNoteTarget = parseHumanLearningNoteUri(input.destination);
  if (customNoteTarget) {
    return resolvedInternalLink({
      kind: 'markdown',
      sourcePath: input.sourcePath,
      sourceOffset: input.sourceOffset,
      line: input.line,
      label: input.label,
      rawTarget: input.destination,
      candidatePath: customNoteTarget.path,
      rawHeading: customNoteTarget.heading,
      documents: input.documents,
    });
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(input.destination) || input.destination.startsWith('//')) {
    return {
      kind: 'external',
      sourcePath: input.sourcePath,
      sourceOffset: input.sourceOffset,
      line: input.line,
      label: input.label || input.destination,
      rawTarget: input.destination,
      href: input.destination,
      targetExists: true,
      resolved: true,
    };
  }

  const [rawPath, rawHeading] = splitOnce(input.destination, '#');
  const decodedPath = safeDecodeURIComponent(rawPath);
  if (decodedPath && hasNonMarkdownExtension(decodedPath)) {
    return {
      kind: 'asset',
      sourcePath: input.sourcePath,
      sourceOffset: input.sourceOffset,
      line: input.line,
      label: input.label || noteTitle(decodedPath),
      rawTarget: input.destination,
      href: input.destination,
      targetExists: true,
      resolved: true,
    };
  }

  const candidatePath = decodedPath
    ? resolveRelativeNotePath(input.sourcePath, decodedPath)
    : input.sourcePath;

  return resolvedInternalLink({
    kind: 'markdown',
    sourcePath: input.sourcePath,
    sourceOffset: input.sourceOffset,
    line: input.line,
    label: input.label,
    rawTarget: input.destination,
    candidatePath,
    rawHeading,
    documents: input.documents,
  });
}

function resolveWikiLink(input: {
  inner: string;
  sourcePath: string;
  sourceOffset: number;
  line: number;
  documents: readonly WikiDocument[];
}): WikiLink {
  const [targetPart, alias] = splitOnce(input.inner, '|');
  const [rawPath, rawHeading] = splitOnce(targetPart.trim(), '#');
  const candidatePath = rawPath.trim()
    ? resolveWikiNotePath(input.sourcePath, safeDecodeURIComponent(rawPath.trim()), input.documents)
    : input.sourcePath;

  return resolvedInternalLink({
    kind: 'wikilink',
    sourcePath: input.sourcePath,
    sourceOffset: input.sourceOffset,
    line: input.line,
    label: cleanInlineText(alias ?? ''),
    rawTarget: input.inner,
    candidatePath,
    rawHeading,
    documents: input.documents,
  });
}

function resolvedInternalLink(input: {
  kind: 'markdown' | 'wikilink';
  sourcePath: string;
  sourceOffset: number;
  line: number;
  label: string;
  rawTarget: string;
  candidatePath: string;
  rawHeading?: string;
  documents: readonly WikiDocument[];
}): WikiLink {
  const targetPath = resolveKnownDocumentPath(input.candidatePath, input.documents)
    ?? ensureMarkdownExtension(normalizeNotePath(input.candidatePath));
  const targetDocument = findDocument(input.documents, targetPath);
  const heading = input.rawHeading
    ? safeDecodeURIComponent(input.rawHeading).trim()
    : undefined;
  const headingExists = targetDocument && heading
    ? documentHasHeading(targetDocument, heading)
    : undefined;
  const targetExists = targetDocument !== undefined;
  const fragment = input.rawHeading ? `#${input.rawHeading}` : '';

  return {
    kind: input.kind,
    sourcePath: input.sourcePath,
    sourceOffset: input.sourceOffset,
    line: input.line,
    label: input.label || noteTitle(targetPath),
    rawTarget: input.rawTarget,
    href: `${targetPath}${fragment}`,
    targetPath,
    heading,
    targetExists,
    headingExists,
    resolved: targetExists && headingExists !== false,
  };
}

function parseKnowledgeMetadata(text: string): {
  concepts: readonly string[];
  entities: readonly string[];
} {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { concepts: [], entities: [] };
  const closingIndex = lines.findIndex((line, index) =>
    index > 0 && /^(---|\.\.\.)\s*$/.test(line.trim())
  );
  if (closingIndex < 0) return { concepts: [], entities: [] };

  const values = {
    concepts: [] as string[],
    entities: [] as string[],
  };
  let activeKey: keyof typeof values | undefined;

  for (let index = 1; index < closingIndex; index += 1) {
    const line = lines[index] ?? '';

    const property = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/);
    if (property) {
      const key = property[1]?.toLowerCase();
      activeKey = key === 'concepts' || key === 'entities' ? key : undefined;
      if (!activeKey) continue;

      const inlineValue = property[2]?.trim() ?? '';
      if (inlineValue.startsWith('[') && inlineValue.endsWith(']')) {
        values[activeKey].push(...parseInlineYamlList(inlineValue.slice(1, -1)));
        activeKey = undefined;
      } else if (inlineValue) {
        // Only YAML sequences are supported. Scalar or object metadata is
        // intentionally ignored so a typo cannot create a misleading graph.
        activeKey = undefined;
      }
      continue;
    }

    if (!activeKey || /^\s*(?:#.*)?$/.test(line)) continue;
    const item = line.match(/^\s+-\s+(.+?)\s*$/)?.[1];
    if (item === undefined) {
      activeKey = undefined;
      continue;
    }
    const value = parseYamlString(item);
    if (value) values[activeKey].push(value);
  }

  return {
    concepts: uniqueMetadataValues(values.concepts),
    entities: uniqueMetadataValues(values.entities),
  };
}

function parseInlineYamlList(value: string): string[] {
  const items: string[] = [];
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let start = 0;

  for (let index = 0; index <= value.length; index += 1) {
    const character = value[index];
    if (index === value.length || (character === ',' && !quote)) {
      const item = parseYamlString(value.slice(start, index));
      if (item) items.push(item);
      start = index + 1;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? undefined : quote ?? character;
    }
  }

  return items;
}

function parseYamlString(rawValue: string): string | undefined {
  let value = rawValue.trim();
  if (!value) return undefined;

  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      value = typeof parsed === 'string' ? parsed : '';
    } catch {
      value = value.slice(1, -1);
    }
  } else if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1).replace(/''/g, "'");
  } else {
    value = value.replace(/\s+#.*$/, '');
  }

  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || undefined;
}

function uniqueMetadataValues(values: readonly string[]): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const key = value.toLocaleLowerCase('en-US');
    if (!unique.has(key)) unique.set(key, value);
  }
  return [...unique.values()];
}

function parseHeadings(text: string): WikiHeading[] {
  const headings: WikiHeading[] = [];
  const duplicateCounts = new Map<string, number>();
  let inFence: '`' | '~' | undefined;

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1]?.[0];
      if (!inFence && (marker === '`' || marker === '~')) inFence = marker;
      else if (inFence === marker) inFence = undefined;
      continue;
    }
    if (inFence) continue;

    const match = line.match(/^\s{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
    if (!match) continue;
    const textValue = cleanInlineText(match[2] ?? '');
    const baseId = slugifyHeading(textValue);
    if (!baseId) continue;
    const duplicateIndex = duplicateCounts.get(baseId) ?? 0;
    duplicateCounts.set(baseId, duplicateIndex + 1);
    headings.push({
      id: duplicateIndex === 0 ? baseId : `${baseId}-${duplicateIndex}`,
      text: textValue,
      level: match[1]?.length ?? 1,
      line: index + 1,
    });
  }

  return headings;
}

function documentHasHeading(document: WikiDocument, fragment: string): boolean {
  const normalized = safeDecodeURIComponent(fragment).trim().replace(/^#/, '').toLowerCase();
  const slug = slugifyHeading(normalized);
  return document.headings.some(heading =>
    heading.id.toLowerCase() === normalized || heading.id.toLowerCase() === slug
  );
}

function resolveWikiNotePath(
  sourcePath: string,
  rawPath: string,
  documents: readonly WikiDocument[],
): string {
  const sourceDirectory = dirnameNotePath(sourcePath);
  const normalizedRawPath = normalizeNotePath(rawPath);
  const candidates = rawPath.startsWith('/')
    ? [normalizedRawPath]
    : rawPath.includes('/') || rawPath.startsWith('.')
      ? [normalizedRawPath, joinNotePath(sourceDirectory, rawPath)]
      : [joinNotePath(sourceDirectory, rawPath), normalizedRawPath];

  for (const candidate of candidates) {
    const resolvedPath = resolveKnownDocumentPath(candidate, documents);
    if (resolvedPath) return resolvedPath;
  }

  const comparableStem = comparablePath(stripMarkdownExtension(normalizedRawPath));
  const suffixMatches = documents
    .filter(document => {
      const documentStem = comparablePath(stripMarkdownExtension(document.path));
      return documentStem === comparableStem || documentStem.endsWith(`/${comparableStem}`);
    })
    .sort((left, right) =>
      pathDistance(sourcePath, left.path) - pathDistance(sourcePath, right.path)
      || left.path.localeCompare(right.path)
    );

  return suffixMatches[0]?.path ?? candidates[0] ?? normalizedRawPath;
}

function resolveRelativeNotePath(sourcePath: string, rawPath: string): string {
  if (rawPath.startsWith('/')) return normalizeNotePath(rawPath);
  return joinNotePath(dirnameNotePath(sourcePath), rawPath);
}

function resolveKnownDocumentPath(
  candidate: string,
  documents: readonly WikiDocument[],
): string | undefined {
  const normalized = comparablePath(candidate);
  const withExtension = comparablePath(ensureMarkdownExtension(candidate));
  return documents.find(document => {
    const path = comparablePath(document.path);
    return path === normalized || path === withExtension;
  })?.path;
}

function findDocument(
  documents: readonly WikiDocument[],
  targetPath: string,
): WikiDocument | undefined {
  const key = comparablePath(targetPath);
  return documents.find(document => comparablePath(document.path) === key);
}

function normalizeMarkdownDestination(raw: string): string | undefined {
  const destination = raw.trim();
  if (!destination) return undefined;
  if (destination.startsWith('<')) {
    const end = destination.indexOf('>');
    return end > 1 ? destination.slice(1, end) : undefined;
  }
  return destination.match(/^(\S+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?$/)?.[1];
}

function parseHumanLearningNoteUri(
  destination: string,
): { path: string; heading?: string } | undefined {
  const match = destination.match(/^hl:\/\/note\/([^#?]*)(?:#(.*))?$/i);
  if (!match) return undefined;
  return {
    path: normalizeNotePath(safeDecodeURIComponent(match[1] ?? '')),
    heading: match[2],
  };
}

function hasNonMarkdownExtension(path: string): boolean {
  const filename = path.split('/').pop() ?? path;
  const extensionIndex = filename.lastIndexOf('.');
  return extensionIndex > 0 && !filename.toLowerCase().endsWith('.md');
}

function maskCode(text: string): string {
  return text
    .replace(/(```|~~~)[\s\S]*?\1/g, preserveLineBreaks)
    .replace(/`[^`\n]*`/g, preserveLineBreaks);
}

function preserveLineBreaks(value: string): string {
  return value.replace(/[^\r\n]/g, ' ');
}

function cleanInlineText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function slugifyHeading(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function noteTitle(path: string): string {
  const filename = safeDecodeURIComponent(splitOnce(path, '#')[0]).split('/').pop() ?? path;
  return filename.replace(/\.md$/i, '') || path;
}

function normalizeNotePath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
}

function comparablePath(path: string): string {
  return normalizeNotePath(safeDecodeURIComponent(path)).toLowerCase();
}

function ensureMarkdownExtension(path: string): string {
  return path.toLowerCase().endsWith('.md') ? path : `${path}.md`;
}

function stripMarkdownExtension(path: string): string {
  return path.replace(/\.md$/i, '');
}

function dirnameNotePath(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function joinNotePath(basePath: string, targetPath: string): string {
  return normalizeNotePath(basePath ? `${basePath}/${targetPath}` : targetPath);
}

function pathDistance(sourcePath: string, targetPath: string): number {
  const sourceSegments = dirnameNotePath(sourcePath).split('/').filter(Boolean);
  const targetSegments = dirnameNotePath(targetPath).split('/').filter(Boolean);
  let shared = 0;
  while (sourceSegments[shared] === targetSegments[shared] && shared < sourceSegments.length) {
    shared += 1;
  }
  return sourceSegments.length + targetSegments.length - (shared * 2);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function splitOnce(input: string, separator: string): [string, string | undefined] {
  const index = input.indexOf(separator);
  if (index < 0) return [input, undefined];
  return [input.slice(0, index), input.slice(index + separator.length)];
}

function compareLinks(left: WikiLink, right: WikiLink): number {
  return left.sourcePath.localeCompare(right.sourcePath)
    || left.line - right.line
    || left.sourceOffset - right.sourceOffset
    || left.href.localeCompare(right.href);
}
