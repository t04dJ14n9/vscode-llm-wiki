export interface WikiLinkTarget {
  noteName: string;
  heading?: string;
  alias?: string;
  uri: string;
  label: string;
}

export function parseWikiLinkTarget(
  rawTarget: string,
  currentNotePath?: string,
  notePaths?: string[],
): WikiLinkTarget | null {
  const [target, alias] = splitOnce(rawTarget.trim(), '|');
  const [rawNoteName, heading] = splitOnce(target.trim(), '#');
  const notePath = notePathFromWikiTarget(rawNoteName, currentNotePath, notePaths);
  if (!notePath || /\.pdf$/i.test(notePath)) return null;

  const noteName = notePath.replace(/^notes\//, '').replace(/\.md$/i, '');
  const uri = `${notePath}${heading ? `#${heading.trim()}` : ''}`;
  const cleanAlias = alias?.trim();
  const cleanHeading = heading?.trim();
  const sameNoteHeading = rawNoteName.trim().length === 0 && Boolean(cleanHeading);
  const label = cleanAlias || wikiLinkDisplayLabel(noteName, cleanHeading, sameNoteHeading);

  return {
    noteName,
    heading: cleanHeading || undefined,
    alias: cleanAlias || undefined,
    uri,
    label,
  };
}

export function wikiLinkTargetToUri(
  rawTarget: string,
  currentNotePath?: string,
  notePaths?: string[],
): string | null {
  return parseWikiLinkTarget(rawTarget, currentNotePath, notePaths)?.uri ?? null;
}

export function notePathToUri(notePath: string): string {
  return notePath;
}

function notePathFromWikiTarget(
  rawNoteName: string,
  currentNotePath?: string,
  notePaths?: string[],
): string | undefined {
  const cleanedSegments = rawNoteName
    .replace(/\\/g, '/')
    .split('/')
    .map(segment => segment.replace(/[<>:"|?*]/g, '').trim())
    .filter(segment => segment.length > 0);
  if (cleanedSegments.length === 0) return normalizeNotePath(currentNotePath);

  if (cleanedSegments.length === 1) {
    const existingPath = findUniqueNotePathByBasename(cleanedSegments[0]!, notePaths);
    if (existingPath) return existingPath;
  }

  const withRoot = cleanedSegments[0] === 'notes'
    ? cleanedSegments
    : cleanedSegments.length > 1
      ? ['notes', ...cleanedSegments]
      : ['notes', 'Concepts', ...cleanedSegments];
  const withExtension = withRoot.at(-1)!.endsWith('.md')
    ? withRoot
    : [...withRoot.slice(0, -1), `${withRoot.at(-1)!}.md`];
  return withExtension.join('/');
}

function findUniqueNotePathByBasename(noteName: string, notePaths: string[] | undefined): string | undefined {
  if (!notePaths || notePaths.length === 0) return undefined;
  const target = noteName.replace(/\.md$/i, '').toLowerCase();
  const matches = notePaths
    .map(normalizeNotePath)
    .filter((path): path is string => Boolean(path))
    .filter(path => path.split('/').at(-1)?.replace(/\.md$/i, '').toLowerCase() === target);
  return matches.length === 1 ? matches[0] : undefined;
}

function normalizeNotePath(notePath: string | undefined): string | undefined {
  const cleanedSegments = notePath
    ?.replace(/\\/g, '/')
    .split('/')
    .map(segment => segment.replace(/[<>:"|?*]/g, '').trim())
    .filter(segment => segment.length > 0);
  if (!cleanedSegments || cleanedSegments.length === 0) return undefined;
  const withExtension = cleanedSegments.at(-1)!.endsWith('.md')
    ? cleanedSegments
    : [...cleanedSegments.slice(0, -1), `${cleanedSegments.at(-1)!}.md`];
  return withExtension.join('/');
}

function wikiLinkDisplayLabel(noteName: string, heading: string | undefined, sameNoteHeading: boolean): string {
  const displayName = noteName.split('/').filter(Boolean).at(-1) ?? noteName;
  if (!heading) return displayName;
  return sameNoteHeading ? heading : `${displayName} > ${heading}`;
}

function splitOnce(input: string, separator: string): [string, string | undefined] {
  const index = input.indexOf(separator);
  if (index < 0) return [input, undefined];
  return [input.slice(0, index), input.slice(index + separator.length)];
}
