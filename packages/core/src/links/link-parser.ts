import { classifyReferenceTarget, noteHref, type ReferenceTarget } from './reference-target';

export interface ParsedLink {
  /** The raw matched text */
  raw: string;
  /** Native markdown-compatible target URI */
  uri: string;
  /** Parsed target metadata */
  target: ReferenceTarget;
  /** Display label */
  label: string;
  /** Line number in source (1-indexed) */
  line: number;
  /** Link kind */
  kind: 'markdown' | 'wikilink' | 'heading_wikilink' | 'image_embed';
}

export interface ParseMarkdownLinksOptions {
  notePaths?: string[];
}

/** Parse all markdown links that should create graph edges. */
export function parseMarkdownLinks(
  content: string,
  sourcePath: string,
  options: ParseMarkdownLinksOptions = {},
): ParsedLink[] {
  const links: ParsedLink[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    for (const m of line.matchAll(/(?<!!)\[([^\]]*)\]\(([^)]+)\)/g)) {
      const uri = normalizeMarkdownDestination(m[2]!);
      if (!uri) continue;
      links.push({
        raw: m[0],
        uri,
        target: classifyReferenceTarget(uri),
        label: m[1] || '',
        line: i + 1,
        kind: 'markdown',
      });
    }

    // Wikilinks: [[Note]], [[Note#Heading]], [[#Heading]], with optional aliases.
    for (const m of line.matchAll(/\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g)) {
      if (m.index && line[m.index - 1] === '!') continue;
      const noteName = m[1]!.trim();
      const heading = m[2]?.trim();
      const alias = m[3]?.trim();

      if (!noteName && !heading) continue;
      const notePath = resolveWikilink(noteName, sourcePath, options.notePaths);
      if (!notePath) continue;
      const uri = noteHref(notePath, heading);
      const label = alias || wikilinkDisplayLabel(noteName, heading);
      links.push({
        raw: m[0],
        uri,
        target: classifyReferenceTarget(uri),
        label,
        line: i + 1,
        kind: heading ? 'heading_wikilink' : 'wikilink',
      });
    }

    for (const m of line.matchAll(/!\[\[([^\]]+)\]\]/g)) {
      const imgPath = m[1]!.trim();
      const uri = `notes/assets/ink/${imgPath}`;
      links.push({
        raw: m[0],
        uri,
        target: classifyReferenceTarget(uri),
        label: imgPath,
        line: i + 1,
        kind: 'image_embed',
      });
    }
  }

  return links;
}

/** Resolve [[NoteName]] to a likely file path */
function resolveWikilink(name: string, sourcePath: string, notePaths: string[] | undefined): string {
  const cleanedSegments = name
    .replace(/\\/g, '/')
    .split('/')
    .map(segment => segment.replace(/[<>:"|?*]/g, '').trim())
    .filter(segment => segment.length > 0);
  if (cleanedSegments.length === 0) return normalizeNotePath(sourcePath);

  if (cleanedSegments.length === 1) {
    const existingPath = findUniqueNotePathByBasename(cleanedSegments[0]!, notePaths);
    if (existingPath) return existingPath;
  }

  const rootedSegments = cleanedSegments[0] === 'notes'
    ? cleanedSegments
    : cleanedSegments.length > 1
      ? ['notes', ...cleanedSegments]
      : ['notes', 'Concepts', ...cleanedSegments];
  const pathSegments = rootedSegments.at(-1)!.endsWith('.md')
    ? rootedSegments
    : [...rootedSegments.slice(0, -1), `${rootedSegments.at(-1)!}.md`];
  return pathSegments.join('/');
}

function findUniqueNotePathByBasename(noteName: string, notePaths: string[] | undefined): string | undefined {
  if (!notePaths || notePaths.length === 0) return undefined;
  const target = noteName.replace(/\.md$/i, '').toLowerCase();
  const matches = notePaths
    .map(normalizeKnownNotePath)
    .filter((path): path is string => Boolean(path))
    .filter(path => path.split('/').at(-1)?.replace(/\.md$/i, '').toLowerCase() === target);
  return matches.length === 1 ? matches[0] : undefined;
}

function normalizeKnownNotePath(notePath: string): string | undefined {
  const cleanedSegments = notePath
    .replace(/\\/g, '/')
    .split('/')
    .map(segment => segment.replace(/[<>:"|?*]/g, '').trim())
    .filter(segment => segment.length > 0);
  if (cleanedSegments.length === 0) return undefined;
  const rootedSegments = cleanedSegments[0] === 'notes'
    ? cleanedSegments
    : ['notes', ...cleanedSegments];
  const pathSegments = rootedSegments.at(-1)?.endsWith('.md')
    ? rootedSegments
    : [...rootedSegments.slice(0, -1), `${rootedSegments.at(-1) ?? ''}.md`];
  return pathSegments.join('/');
}

function normalizeNotePath(notePath: string): string {
  const cleanedSegments = notePath
    .replace(/\\/g, '/')
    .split('/')
    .map(segment => segment.replace(/[<>:"|?*]/g, '').trim())
    .filter(segment => segment.length > 0);
  const pathSegments = cleanedSegments.at(-1)?.endsWith('.md')
    ? cleanedSegments
    : [...cleanedSegments.slice(0, -1), `${cleanedSegments.at(-1) ?? ''}.md`];
  return pathSegments.join('/');
}

function wikilinkDisplayLabel(noteName: string, heading: string | undefined): string {
  const displayName = noteName
    .split('/')
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.md$/i, '') ?? '';
  if (!heading) return displayName;
  return displayName ? `${displayName} > ${heading}` : heading;
}

function normalizeMarkdownDestination(raw: string): string | undefined {
  const destination = raw.trim();
  if (!destination) return undefined;
  if (destination.startsWith('<')) {
    const end = destination.indexOf('>');
    return end > 1 ? destination.slice(1, end) : undefined;
  }
  const match = destination.match(/^(\S+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?$/);
  return match?.[1];
}

/** Quick check: does a line contain any link syntax? */
export function hasLinks(line: string): boolean {
  return /\[\[[^\]]+\]\]|\[[^\]]*\]\([^)]+\)/.test(line);
}
