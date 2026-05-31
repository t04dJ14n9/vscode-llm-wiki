import { parseHlUri } from './uri-parser';

export interface ParsedLink {
  /** The raw matched text */
  raw: string;
  /** Canonical hl:// URI */
  uri: string;
  /** Display label */
  label: string;
  /** Line number in source (1-indexed) */
  line: number;
  /** Link kind */
  kind: 'hl_uri' | 'wikilink' | 'heading_wikilink';
}

export interface ParseMarkdownLinksOptions {
  notePaths?: string[];
}

/** Parse all links from markdown content */
export function parseMarkdownLinks(
  content: string,
  sourcePath: string,
  options: ParseMarkdownLinksOptions = {},
): ParsedLink[] {
  const links: ParsedLink[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Standard markdown links: [label](hl://...)
    for (const m of line.matchAll(/\[([^\]]*)\]\((hl:\/\/[^)]+)\)/g)) {
      const label = m[1] || '';
      const uri = m[2]!;
      links.push({ raw: m[0], uri, label, line: i + 1, kind: 'hl_uri' });
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
      let uri: string;
      if (heading) {
        uri = `hl://note/${notePath}#${encodeURIComponent(heading)}`;
      } else {
        uri = `hl://note/${notePath}`;
      }

      const label = alias || wikilinkDisplayLabel(noteName, heading);
      links.push({ raw: m[0], uri, label, line: i + 1, kind: heading ? 'heading_wikilink' : 'wikilink' });
    }

    // Image embeds: ![[image.png]]
    for (const m of line.matchAll(/!\[\[([^\]]+)\]\]/g)) {
      const imgPath = m[1]!.trim();
      const uri = `hl://image/notes/assets/ink/${imgPath}`;
      links.push({ raw: m[0], uri, label: imgPath, line: i + 1, kind: 'wikilink' });
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
    if (existingPath) return encodePath(existingPath);
  }

  const rootedSegments = cleanedSegments[0] === 'notes'
    ? cleanedSegments
    : cleanedSegments.length > 1
      ? ['notes', ...cleanedSegments]
      : ['notes', 'Concepts', ...cleanedSegments];
  const pathSegments = rootedSegments.at(-1)!.endsWith('.md')
    ? rootedSegments
    : [...rootedSegments.slice(0, -1), `${rootedSegments.at(-1)!}.md`];
  return encodePath(pathSegments.join('/'));
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
  return encodePath(pathSegments.join('/'));
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

function encodePath(path: string): string {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

/** Quick check: does a line contain any link syntax? */
export function hasLinks(line: string): boolean {
  return /\[\[[^\]]+\]\]|\[[^\]]*\]\(hl:\/\/[^)]+\)/.test(line);
}
