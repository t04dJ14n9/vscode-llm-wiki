export interface MarkdownLinkSpan {
  image: boolean;
  destination: string;
  destinationFrom: number;
  destinationTo: number;
}

export interface MarkdownReferenceDefinition {
  destination: string;
  destinationFrom: number;
  destinationTo: number;
  from: number;
}

export function markdownLinkSourceSpans(lineFrom: number, text: string): MarkdownLinkSpan[] {
  const spans: MarkdownLinkSpan[] = [];
  let index = 0;

  while (index < text.length) {
    const bracket = text.indexOf('[', index);
    if (bracket < 0) break;
    const image = bracket > 0 && text[bracket - 1] === '!';
    const sourceStart = image ? bracket - 1 : bracket;
    const closeBracket = findClosingBracket(text, bracket + 1);
    if (closeBracket < 0 || text[closeBracket + 1] !== '(') {
      index = bracket + 1;
      continue;
    }
    const closeParen = findClosingDestination(text, closeBracket + 2);
    if (closeParen < 0) {
      index = closeBracket + 1;
      continue;
    }
    const destinationFrom = lineFrom + closeBracket + 2;
    const destinationTo = lineFrom + closeParen;
    spans.push({
      image,
      destination: text.slice(closeBracket + 2, closeParen),
      destinationFrom,
      destinationTo,
    });
    index = Math.max(closeParen + 1, sourceStart + 1);
  }

  return spans;
}

export function markdownReferenceDefinitionSourceSpans(
  text: string,
): MarkdownReferenceDefinition[] {
  const definitions: MarkdownReferenceDefinition[] = [];
  let lineFrom = 0;

  while (lineFrom <= text.length) {
    const newline = text.indexOf('\n', lineFrom);
    const lineTo = newline < 0 ? text.length : newline;
    const line = text.slice(lineFrom, lineTo);
    const match = line.match(/^ {0,3}\[[^\]\n]+\]:[ \t]*(\S.*)$/);
    if (match) {
      const rawDestination = match[1] ?? '';
      const destination = parseMarkdownLinkDestination(rawDestination);
      if (destination) {
        const destinationStart = line.lastIndexOf(rawDestination);
        definitions.push({
          destination,
          destinationFrom: lineFrom + destinationStart,
          destinationTo: lineTo,
          from: lineFrom,
        });
      }
    }
    if (newline < 0) break;
    lineFrom = newline + 1;
  }

  return definitions;
}

export function parseMarkdownLinkDestination(rawDestination: string): string | null {
  const destination = rawDestination.trim();
  if (!destination) return null;
  if (destination.startsWith('<')) {
    const close = destination.indexOf('>');
    if (close > 1) return destination.slice(1, close);
  }
  return destination.match(/^(\S+)/u)?.[1] ?? null;
}

function findClosingBracket(text: string, from: number): number {
  let depth = 0;
  for (let index = from; index < text.length; index++) {
    if (text[index] === '[') depth++;
    if (text[index] !== ']') continue;
    if (depth === 0) return index;
    depth--;
  }
  return -1;
}

function findClosingDestination(text: string, from: number): number {
  let depth = 0;
  for (let index = from; index < text.length; index++) {
    const char = text[index];
    if (char === '\\') {
      index++;
      continue;
    }
    if (char === '(') {
      depth++;
      continue;
    }
    if (char !== ')') continue;
    if (depth === 0) return index;
    depth--;
  }
  return -1;
}
