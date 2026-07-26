import {
  finitePdfTextRect,
  isPdfWordJoinMarker,
  type PdfSelectionGlyph,
} from './pdfTextExtraction';
import {
  buildPdfSearchIndex,
  isSearchWhitespace,
  normalizeSearchText,
  shouldInsertGeometryGap,
  type PdfItemGapMode,
  type PdfSearchIndexChar,
  type PdfTextFragment,
} from './pdfSearch';

const PDF_TEXT_FRAGMENT_CONTEXT_LENGTH = 32;

export interface PdfSelectionCaret {
  page: number;
  itemIndex: number;
  offset: number;
}

export interface PdfSelectionLine {
  top: number;
  bottom: number;
  center: number;
  height: number;
  count: number;
  glyphs: Array<{ glyph: PdfSelectionGlyph; itemIndex: number }>;
}

export interface PdfSelectionState {
  // The originating page remains available for the single-page annotation
  // protocol, while page-aware carets allow ordinary selection across pages.
  page: number;
  anchor: PdfSelectionCaret;
  focus: PdfSelectionCaret;
}

export interface PdfSelectionSearchRange {
  index: PdfSearchIndexChar[];
  from: number;
  to: number;
  text: string;
}

export function orderedPdfCarets(
  left: PdfSelectionCaret,
  right: PdfSelectionCaret,
): [PdfSelectionCaret, PdfSelectionCaret] {
  return comparePdfCarets(left, right) <= 0 ? [left, right] : [right, left];
}

export function comparePdfCarets(left: PdfSelectionCaret, right: PdfSelectionCaret): number {
  return left.page - right.page
    || left.itemIndex - right.itemIndex
    || left.offset - right.offset;
}

export function samePdfCaret(left: PdfSelectionCaret, right: PdfSelectionCaret): boolean {
  return left.page === right.page
    && left.itemIndex === right.itemIndex
    && left.offset === right.offset;
}

export function pdfSelectionContainsPage(selection: PdfSelectionState, page: number): boolean {
  const [start, end] = orderedPdfCarets(selection.anchor, selection.focus);
  return page >= start.page && page <= end.page;
}

export function buildPdfSelectionLines(selectionGlyphs: PdfSelectionGlyph[][]): PdfSelectionLine[] {
  const candidates: Array<{ glyph: PdfSelectionGlyph; itemIndex: number }> = [];
  for (let itemIndex = 0; itemIndex < selectionGlyphs.length; itemIndex++) {
    for (const glyph of selectionGlyphs[itemIndex] ?? []) {
      candidates.push({ glyph, itemIndex });
    }
  }

  const lines: PdfSelectionLine[] = [];
  const verticallySorted = candidates.sort((left, right) => (
    left.glyph.looseRect[1] - right.glyph.looseRect[1]
    || left.glyph.looseRect[0] - right.glyph.looseRect[0]
    || left.itemIndex - right.itemIndex
    || left.glyph.offsetStart - right.glyph.offsetStart
  ));

  for (const candidate of verticallySorted) {
    const [, top, , bottom] = candidate.glyph.looseRect;
    const center = (top + bottom) / 2;
    const height = bottom - top;
    let matchingLine: PdfSelectionLine | undefined;
    let matchingDistance = Number.POSITIVE_INFINITY;

    for (const line of lines) {
      const overlap = Math.min(line.bottom, bottom) - Math.max(line.top, top);
      const minimumHeight = Math.min(line.height, height);
      const centerDistance = Math.abs(line.center - center);
      const sameLine = overlap >= minimumHeight * 0.35
        || centerDistance <= Math.max(1, minimumHeight * 0.55);
      if (sameLine && centerDistance < matchingDistance) {
        matchingLine = line;
        matchingDistance = centerDistance;
      }
    }

    if (!matchingLine) {
      lines.push({
        top,
        bottom,
        center,
        height,
        count: 1,
        glyphs: [candidate],
      });
      continue;
    }

    matchingLine.top = Math.min(matchingLine.top, top);
    matchingLine.bottom = Math.max(matchingLine.bottom, bottom);
    matchingLine.center = (
      matchingLine.center * matchingLine.count + center
    ) / (matchingLine.count + 1);
    matchingLine.height = (
      matchingLine.height * matchingLine.count + height
    ) / (matchingLine.count + 1);
    matchingLine.count++;
    matchingLine.glyphs.push(candidate);
  }

  return lines;
}

export function previousSelectablePdfTextItem(textRects: any[], itemIndex: number): number {
  for (let index = itemIndex - 1; index >= 0; index--) {
    const content = String(textRects[index]?.content ?? '');
    if (content && !isPdfWordJoinMarker(content)) return index;
  }
  return -1;
}

export function nextSelectablePdfTextItem(textRects: any[], itemIndex: number): number {
  for (let index = itemIndex + 1; index < textRects.length; index++) {
    const content = String(textRects[index]?.content ?? '');
    if (content && !isPdfWordJoinMarker(content)) return index;
  }
  return -1;
}

export function pdfTextItemsJoinWord(
  textRects: any[],
  leftIndex: number,
  rightIndex: number,
): boolean {
  for (let index = leftIndex + 1; index < rightIndex; index++) {
    if (isPdfWordJoinMarker(String(textRects[index]?.content ?? ''))) return true;
  }
  return !shouldInsertGeometryGap(textRects[leftIndex], textRects[rightIndex]);
}

export function pdfTextItemSelectionSeparator(textRects: any[], itemIndex: number): boolean {
  const content = String(textRects[itemIndex]?.content ?? '');
  if (!content || /\s$/u.test(content)) return false;

  const nextIndex = nextSelectablePdfTextItem(textRects, itemIndex);
  if (nextIndex < 0) return false;

  const nextContent = String(textRects[nextIndex]?.content ?? '');
  if (!nextContent || /^\s/u.test(nextContent)) return false;
  return !pdfTextItemsJoinWord(textRects, itemIndex, nextIndex);
}

export function pdfTextLineItemRange(
  textRects: any[],
  itemIndex: number,
): { from: number; to: number } | undefined {
  const targetRect = finitePdfTextRect(textRects[itemIndex]?.rect);
  if (!targetRect) return undefined;

  const targetCenter = targetRect.top + targetRect.height / 2;
  const isSameLine = (candidateIndex: number): boolean => {
    const rect = finitePdfTextRect(textRects[candidateIndex]?.rect);
    if (!rect) return false;
    const center = rect.top + rect.height / 2;
    return Math.abs(center - targetCenter)
      <= Math.max(1, Math.min(rect.height, targetRect.height) * 0.55);
  };

  let from = itemIndex;
  let to = itemIndex;
  for (;;) {
    const previous = previousSelectablePdfTextItem(textRects, from);
    if (previous < 0 || !isSameLine(previous)) break;
    from = previous;
  }
  for (;;) {
    const next = nextSelectablePdfTextItem(textRects, to);
    if (next < 0 || !isSameLine(next)) break;
    to = next;
  }
  return { from, to };
}

export function isPdfWordCharacter(value: string): boolean {
  return Boolean(value) && /[\p{L}\p{N}_]/u.test(value);
}

export function pdfTextFragmentForSelection(
  textRects: any[],
  startTextItemIndex: number,
  startOffset: number,
  endTextItemIndex: number,
  endOffset: number,
  selectedText: string,
): PdfTextFragment {
  const normalizedSelection = normalizeSearchText(selectedText, true, true);
  const selectionRange = ([true, false, 'geometry'] satisfies PdfItemGapMode[])
    .map(itemGapMode => pdfSearchRangeForSelection(
      textRects,
      itemGapMode,
      startTextItemIndex,
      startOffset,
      endTextItemIndex,
      endOffset,
    ))
    .find((candidate): candidate is PdfSelectionSearchRange => (
      candidate?.text === normalizedSelection
    ));

  if (!selectionRange) return { textStart: normalizedSelection };

  const pageText = selectionRange.index.map(char => char.value).join('');
  const prefix = boundedTextFragmentPrefix(pageText.slice(0, selectionRange.from));
  const suffix = boundedTextFragmentSuffix(pageText.slice(selectionRange.to));
  return {
    textStart: normalizedSelection,
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
  };
}

export function pdfSearchRangeForSelection(
  textRects: any[],
  itemGapMode: PdfItemGapMode,
  startTextItemIndex: number,
  startOffset: number,
  endTextItemIndex: number,
  endOffset: number,
): PdfSelectionSearchRange | undefined {
  const index = buildPdfSearchIndex(textRects, itemGapMode, false, true, true);
  let from = -1;
  let to = -1;

  for (let cursor = 0; cursor < index.length; cursor++) {
    const char = index[cursor];
    if (typeof char?.textItemIndex !== 'number' || typeof char.offset !== 'number') continue;

    const afterStart = char.textItemIndex > startTextItemIndex
      || (char.textItemIndex === startTextItemIndex && char.offset >= startOffset);
    const beforeEnd = char.textItemIndex < endTextItemIndex
      || (char.textItemIndex === endTextItemIndex && char.offset < endOffset);
    if (!afterStart || !beforeEnd) continue;

    if (from < 0) from = cursor;
    to = cursor + 1;
  }

  if (from < 0 || to <= from) return undefined;
  while (from < to && index[from]?.value === ' ') from++;
  while (to > from && index[to - 1]?.value === ' ') to--;
  if (from >= to) return undefined;

  return {
    index,
    from,
    to,
    text: index.slice(from, to).map(char => char.value).join(''),
  };
}

export function boundedTextFragmentPrefix(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;

  const characters = Array.from(normalized);
  if (characters.length <= PDF_TEXT_FRAGMENT_CONTEXT_LENGTH) return normalized;

  const start = characters.length - PDF_TEXT_FRAGMENT_CONTEXT_LENGTH;
  let bounded = characters.slice(start);
  if (!isSearchWhitespace(characters[start - 1] ?? '')
    && !isSearchWhitespace(bounded[0] ?? '')) {
    const boundary = bounded.findIndex(isSearchWhitespace);
    bounded = boundary >= 0 ? bounded.slice(boundary + 1) : [];
  }

  const result = bounded.join('').trim();
  return result || undefined;
}

export function boundedTextFragmentSuffix(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;

  const characters = Array.from(normalized);
  if (characters.length <= PDF_TEXT_FRAGMENT_CONTEXT_LENGTH) return normalized;

  let bounded = characters.slice(0, PDF_TEXT_FRAGMENT_CONTEXT_LENGTH);
  if (!isSearchWhitespace(bounded[bounded.length - 1] ?? '')
    && !isSearchWhitespace(characters[PDF_TEXT_FRAGMENT_CONTEXT_LENGTH] ?? '')) {
    let boundary = bounded.length - 1;
    while (boundary >= 0 && !isSearchWhitespace(bounded[boundary] ?? '')) boundary--;
    bounded = boundary >= 0 ? bounded.slice(0, boundary) : [];
  }

  const result = bounded.join('').trim();
  return result || undefined;
}
