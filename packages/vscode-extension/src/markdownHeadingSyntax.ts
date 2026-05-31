export type SetextHeadingLevel = 1 | 2;

export function setextHeadingLevelForLines(
  contentLine: string,
  underlineLine: string | undefined,
): SetextHeadingLevel | null {
  if (underlineLine == null) return null;
  if (!isSetextHeadingContentLine(contentLine)) return null;

  const underline = underlineLine.match(/^ {0,3}(=+|-+)\s*$/);
  if (!underline) return null;
  return underline[1]![0] === '=' ? 1 : 2;
}

function isSetextHeadingContentLine(text: string): boolean {
  if (text.trim().length === 0) return false;
  if (/^ {4}/.test(text)) return false;
  if (/^ {0,3}(?:#{1,6})(?:\s+|$)/.test(text)) return false;
  if (/^ {0,3}(?:`{3,}|~{3,})/.test(text)) return false;
  if (/^ {0,3}>/.test(text)) return false;
  if (/^ {0,3}(?:[-*+]|\d+[.)])\s+/.test(text)) return false;
  if (/^ {0,3}[-*_](?:\s*[-*_]){2,}\s*$/.test(text)) return false;
  return true;
}
