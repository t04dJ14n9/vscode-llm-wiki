export interface SourceSpan {
  from: number;
  to: number;
}

export interface InlineCodeSpan extends SourceSpan {
  contentFrom: number;
  contentTo: number;
}

export interface MarkdownLinkSpan extends SourceSpan {
  image: boolean;
  label: string;
  labelFrom: number;
  labelTo: number;
  destination: string;
  destinationFrom: number;
  destinationTo: number;
}

export interface MarkdownReferenceDefinition extends SourceSpan {
  label: string;
  normalizedLabel: string;
  destination: string;
  destinationFrom: number;
  destinationTo: number;
}

export interface MarkdownReferenceLinkSpan extends SourceSpan {
  image: boolean;
  label: string;
  labelFrom: number;
  labelTo: number;
  reference: string;
  referenceFrom: number;
  referenceTo: number;
  definition: MarkdownReferenceDefinition;
}

export function isEscapedAt(text: string, index: number): boolean {
  let backslashes = 0;
  for (let position = index - 1; position >= 0 && text[position] === '\\'; position--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

export function overlapsSpan(span: SourceSpan, reserved: SourceSpan[]): boolean {
  return reserved.some(item => span.from < item.to && span.to > item.from);
}

export function inlineCodeSourceSpans(lineFrom: number, text: string): InlineCodeSpan[] {
  const spans: InlineCodeSpan[] = [];
  let index = 0;

  while (index < text.length) {
    if (text[index] !== '`' || isEscapedAt(text, index)) {
      index++;
      continue;
    }

    const delimiterLength = countBackticks(text, index);
    const closeIndex = findClosingBackticks(text, index + delimiterLength, delimiterLength);
    if (closeIndex < 0) {
      index += delimiterLength;
      continue;
    }

    spans.push({
      from: lineFrom + index,
      to: lineFrom + closeIndex + delimiterLength,
      contentFrom: lineFrom + index + delimiterLength,
      contentTo: lineFrom + closeIndex,
    });
    index = closeIndex + delimiterLength;
  }

  return spans;
}

export function markdownLinkSourceSpans(lineFrom: number, text: string): MarkdownLinkSpan[] {
  const spans: MarkdownLinkSpan[] = [];
  let index = 0;

  while (index < text.length) {
    const bracket = text.indexOf('[', index);
    if (bracket < 0) break;
    const hasBangPrefix = bracket > 0 && text[bracket - 1] === '!';
    if (hasBangPrefix && isEscapedAt(text, bracket - 1)) {
      index = bracket + 1;
      continue;
    }
    const bang = hasBangPrefix;
    const sourceStart = bang ? bracket - 1 : bracket;

    if (isEscapedAt(text, bracket)) {
      index = bracket + 1;
      continue;
    }

    const closeBracket = findClosingLinkLabel(text, bracket + 1);
    if (closeBracket < 0 || text[closeBracket + 1] !== '(') {
      index = bracket + 1;
      continue;
    }

    const closeParen = findClosingLinkDestination(text, closeBracket + 2);
    if (closeParen < 0) {
      index = closeBracket + 1;
      continue;
    }

    spans.push({
      image: bang,
      from: lineFrom + sourceStart,
      to: lineFrom + closeParen + 1,
      label: text.slice(bracket + 1, closeBracket),
      labelFrom: lineFrom + bracket + 1,
      labelTo: lineFrom + closeBracket,
      destination: text.slice(closeBracket + 2, closeParen),
      destinationFrom: lineFrom + closeBracket + 2,
      destinationTo: lineFrom + closeParen,
    });
    index = closeParen + 1;
  }

  return spans;
}

export function markdownReferenceDefinitions(text: string): Map<string, MarkdownReferenceDefinition> {
  const definitions = new Map<string, MarkdownReferenceDefinition>();
  for (const definition of markdownReferenceDefinitionSourceSpans(text)) {
    if (!definitions.has(definition.normalizedLabel)) {
      definitions.set(definition.normalizedLabel, definition);
    }
  }
  return definitions;
}

export function markdownReferenceDefinitionSourceSpans(text: string): MarkdownReferenceDefinition[] {
  const definitions: MarkdownReferenceDefinition[] = [];
  const lines = markdownSourceLines(text);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    const definition = markdownReferenceDefinitionSourceSpan(line.from, line.text);
    if (!definition) {
      index++;
      continue;
    }

    const nextLine = lines[index + 1];
    if (!definitionHasInlineTitle(line.text) && nextLine && isReferenceDefinitionTitleLine(nextLine.text)) {
      definitions.push({ ...definition, to: nextLine.to });
      index += 2;
      continue;
    }

    definitions.push(definition);
    index++;
  }

  return definitions;
}

interface MarkdownSourceLine {
  from: number;
  to: number;
  text: string;
}

function markdownSourceLines(text: string): MarkdownSourceLine[] {
  const lines: MarkdownSourceLine[] = [];
  let lineFrom = 0;

  while (lineFrom <= text.length) {
    const newline = text.indexOf('\n', lineFrom);
    const lineTo = newline < 0 ? text.length : newline;
    lines.push({ from: lineFrom, to: lineTo, text: text.slice(lineFrom, lineTo) });
    if (newline < 0) break;
    lineFrom = newline + 1;
  }

  return lines;
}

export function markdownReferenceDefinitionSourceSpan(
  lineFrom: number,
  text: string,
): MarkdownReferenceDefinition | null {
  const match = text.match(/^( {0,3})\[([^\]\n]+)\]:[ \t]*(\S.*)$/);
  if (!match) return null;

  const label = match[2] ?? '';
  const rawDestination = match[3] ?? '';
  const destination = parseMarkdownLinkDestination(rawDestination);
  const normalizedLabel = normalizeReferenceLabel(label);
  if (!destination || normalizedLabel.length === 0) return null;

  const destinationStart = match[0].lastIndexOf(rawDestination);
  return {
    from: lineFrom,
    to: lineFrom + text.length,
    label,
    normalizedLabel,
    destination,
    destinationFrom: lineFrom + destinationStart,
    destinationTo: lineFrom + text.length,
  };
}

export function markdownReferenceLinkSourceSpans(
  lineFrom: number,
  text: string,
  definitions: Map<string, MarkdownReferenceDefinition>,
): MarkdownReferenceLinkSpan[] {
  const spans: MarkdownReferenceLinkSpan[] = [];
  let index = 0;

  while (index < text.length) {
    const bracket = text.indexOf('[', index);
    if (bracket < 0) break;
    const hasBangPrefix = bracket > 0 && text[bracket - 1] === '!';
    if (hasBangPrefix && isEscapedAt(text, bracket - 1)) {
      index = bracket + 1;
      continue;
    }
    const image = hasBangPrefix;
    const sourceStart = image ? bracket - 1 : bracket;
    if (isEscapedAt(text, bracket)) {
      index = bracket + 1;
      continue;
    }

    const closeLabel = findClosingLinkLabel(text, bracket + 1);
    if (closeLabel < 0) {
      index = bracket + 1;
      continue;
    }

    const label = text.slice(bracket + 1, closeLabel);
    const afterLabel = text[closeLabel + 1];
    if (afterLabel === '[') {
      const referenceOpen = closeLabel + 1;
      const closeReference = findClosingLinkLabel(text, referenceOpen + 1);
      if (closeReference < 0) {
        index = closeLabel + 1;
        continue;
      }

      const explicitReference = text.slice(referenceOpen + 1, closeReference);
      const reference = explicitReference.length > 0 ? explicitReference : label;
      const definition = definitions.get(normalizeReferenceLabel(reference));
      if (!definition) {
        index = closeReference + 1;
        continue;
      }

      spans.push({
        image,
        from: lineFrom + sourceStart,
        to: lineFrom + closeReference + 1,
        label,
        labelFrom: lineFrom + bracket + 1,
        labelTo: lineFrom + closeLabel,
        reference,
        referenceFrom: lineFrom + referenceOpen + 1,
        referenceTo: lineFrom + closeReference,
        definition,
      });
      index = closeReference + 1;
      continue;
    }

    if (afterLabel === '(') {
      index = closeLabel + 1;
      continue;
    }

    const reference = label;
    const definition = definitions.get(normalizeReferenceLabel(reference));
    if (!definition) {
      index = closeLabel + 1;
      continue;
    }

    spans.push({
      image,
      from: lineFrom + sourceStart,
      to: lineFrom + closeLabel + 1,
      label,
      labelFrom: lineFrom + bracket + 1,
      labelTo: lineFrom + closeLabel,
      reference,
      referenceFrom: lineFrom + bracket + 1,
      referenceTo: lineFrom + closeLabel,
      definition,
    });
    index = closeLabel + 1;
  }

  return spans;
}

export function normalizeReferenceLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function parseMarkdownLinkDestination(rawDestination: string): string | null {
  return parseMarkdownLinkDestinationParts(rawDestination)?.destination ?? null;
}

function parseMarkdownLinkDestinationParts(rawDestination: string): { destination: string; hasTitle: boolean } | null {
  const destination = rawDestination.trim();
  if (destination.length === 0) return null;

  if (destination.startsWith('<')) {
    const closingBracket = destination.indexOf('>');
    if (closingBracket > 1) {
      const title = destination.slice(closingBracket + 1).trim();
      if (title.length > 0 && !isMarkdownLinkTitle(title)) return null;
      return {
        destination: destination.slice(1, closingBracket),
        hasTitle: title.length > 0,
      };
    }
  }

  const match = destination.match(/^(\S+)(?:\s+("[^"]*"|'[^']*'|\([^)]*\)))?$/);
  if (!match) return null;
  return {
    destination: match[1] ?? '',
    hasTitle: Boolean(match[2]),
  };
}

function definitionHasInlineTitle(text: string): boolean {
  const match = text.match(/^( {0,3})\[([^\]\n]+)\]:[ \t]*(\S.*)$/);
  if (!match) return false;
  return Boolean(parseMarkdownLinkDestinationParts(match[3] ?? '')?.hasTitle);
}

function isReferenceDefinitionTitleLine(text: string): boolean {
  return /^[ \t]{0,3}(?:"[^"]*"|'[^']*'|\([^)]*\))[ \t]*$/.test(text);
}

function isMarkdownLinkTitle(text: string): boolean {
  return /^(?:"[^"]*"|'[^']*'|\([^)]*\))$/.test(text);
}

function findClosingLinkLabel(text: string, from: number): number {
  let depth = 0;
  for (let index = from; index < text.length; index++) {
    const char = text[index];
    if (text[index] === '\n') return -1;
    if (isEscapedAt(text, index)) continue;
    if (char === '[') {
      depth++;
      continue;
    }
    if (char === ']') {
      if (depth === 0) return index;
      depth--;
    }
  }
  return -1;
}

function findClosingLinkDestination(text: string, from: number): number {
  let depth = 0;
  for (let index = from; index < text.length; index++) {
    const char = text[index];
    if (char === '\n') return -1;
    if (isEscapedAt(text, index)) continue;
    if (char === '(') {
      depth++;
      continue;
    }
    if (char === ')') {
      if (depth === 0) return index;
      depth--;
    }
  }
  return -1;
}

function findClosingBackticks(text: string, from: number, delimiterLength: number): number {
  let index = from;
  while (index < text.length) {
    const next = text.indexOf('`', index);
    if (next < 0) return -1;
    const runLength = countBackticks(text, next);
    if (!isEscapedAt(text, next) && runLength === delimiterLength) return next;
    index = next + runLength;
  }
  return -1;
}

function countBackticks(text: string, from: number): number {
  let count = 0;
  while (text[from + count] === '`') count++;
  return count;
}
