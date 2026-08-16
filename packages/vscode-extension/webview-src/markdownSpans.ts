import { isCodeFenceClosing, parseCodeFenceOpening } from './markdownFences';

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

export interface MarkdownFootnoteDefinition {
  id: string;
  position: number;
  text: string;
}

export interface MarkdownFootnoteIndex {
  definitions: Map<string, MarkdownFootnoteDefinition>;
  references: Map<string, number[]>;
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

export function markdownFootnoteIndex(text: string): MarkdownFootnoteIndex {
  const definitions = new Map<string, MarkdownFootnoteDefinition>();
  const references = new Map<string, number[]>();
  const lines = markdownSourceLines(text);
  const fencedCode = fencedCodeSourceSpans(lines);
  const excluded = [
    ...fencedCode,
    ...obsidianCommentSourceSpansOutside(text, fencedCode),
    ...htmlCommentSourceSpans(text),
  ];

  lines.forEach((line, lineIndex) => {
    const inlineCode = inlineCodeSourceSpans(line.from, line.text);
    const definition = line.text.match(/^(\s*)\[\^([^\]\s]+)\]:\s*(.*)$/);
    const definitionStart = definition ? line.from + definition[1]!.length : -1;
    if (
      definition
      && !isEscapedAt(line.text, definition[1]!.length)
      && !overlapsSpan(
        { from: definitionStart, to: line.from + definition[0].length },
        [...excluded, ...inlineCode],
      )
    ) {
      const id = definition[2]!;
      if (!definitions.has(id)) {
        definitions.set(id, {
          id,
          position: definitionStart,
          text: footnoteDefinitionText(lines, lineIndex, definition[3] ?? '', excluded),
        });
      }
    }

    for (const match of line.text.matchAll(/\[\^([^\]\s]+)\]/g)) {
      const index = match.index ?? 0;
      const from = line.from + index;
      const to = from + match[0].length;
      const id = match[1]!;
      if (isEscapedAt(line.text, index)) continue;
      if (overlapsSpan({ from, to }, [...excluded, ...inlineCode])) continue;
      if (definition && id === definition[2] && from === definitionStart) continue;
      references.set(id, [...(references.get(id) ?? []), from]);
    }
  });

  return { definitions, references };
}

export function obsidianCommentSourceSpans(text: string): SourceSpan[] {
  return obsidianCommentSourceSpansOutside(
    text,
    fencedCodeSourceSpans(markdownSourceLines(text)),
  );
}

function obsidianCommentSourceSpansOutside(
  text: string,
  fencedCode: SourceSpan[],
): SourceSpan[] {
  const ranges: SourceSpan[] = [];
  let start: number | null = null;
  let index = 0;

  while (index < text.length - 1) {
    if (text[index] !== '%' || text[index + 1] !== '%') {
      index++;
      continue;
    }
    if (overlapsSpan({ from: index, to: index + 2 }, fencedCode)) {
      index += 2;
      continue;
    }
    if (start == null) {
      start = index;
    } else {
      ranges.push({ from: start, to: index + 2 });
      start = null;
    }
    index += 2;
  }
  if (start != null) ranges.push({ from: start, to: text.length });
  return ranges;
}

export function htmlCommentSourceSpans(text: string): SourceSpan[] {
  const ranges: SourceSpan[] = [];
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const start = text.indexOf('<!--', searchFrom);
    if (start < 0) break;
    const end = text.indexOf('-->', start + 4);
    if (end < 0) {
      ranges.push({ from: start, to: text.length });
      break;
    }
    ranges.push({ from: start, to: end + 3 });
    searchFrom = end + 3;
  }
  return ranges;
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

function fencedCodeSourceSpans(lines: MarkdownSourceLine[]): SourceSpan[] {
  const spans: SourceSpan[] = [];
  let opening: { from: number; marker: string } | undefined;
  for (const line of lines) {
    if (!opening) {
      const fence = parseCodeFenceOpening(line.text);
      if (fence) opening = { from: line.from, marker: fence.marker };
      continue;
    }
    if (!isCodeFenceClosing(line.text, opening.marker)) continue;
    spans.push({ from: opening.from, to: line.to });
    opening = undefined;
  }
  if (opening) {
    spans.push({ from: opening.from, to: lines.at(-1)?.to ?? opening.from });
  }
  return spans;
}

function footnoteDefinitionText(
  lines: MarkdownSourceLine[],
  definitionLineIndex: number,
  firstLine: string,
  excluded: SourceSpan[],
): string {
  const text = [firstLine];
  for (let index = definitionLineIndex + 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (!/^(?: {2,}|\t)\S/.test(line.text)) break;
    if (overlapsSpan({ from: line.from, to: line.to }, excluded)) continue;
    text.push(line.text.trim());
  }
  return text.join(' ').replace(/\s+/gu, ' ').trim().slice(0, 480);
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
