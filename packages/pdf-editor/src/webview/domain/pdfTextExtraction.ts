import type { PdfRect } from '../pdfTextBands';

export interface PdfSelectionGlyph {
  offsetStart: number;
  offsetEnd: number;
  sourceCharIndex: number;
  looseRect: PdfRect;
  hitRect: PdfRect;
}

interface OrderedPdfTextItem {
  sourceOrder: number;
  item: any;
  rect: { left: number; top: number; width: number; height: number };
}

export function finitePdfTextRect(
  value: any,
): { left: number; top: number; width: number; height: number } | undefined {
  const left = Number(value?.origin?.x);
  const top = Number(value?.origin?.y);
  const width = Number(value?.size?.width);
  const height = Number(value?.size?.height);
  if (![left, top, width, height].every(Number.isFinite) || width < 0 || height <= 0) return undefined;
  return { left, top, width, height };
}

export function normalizePdfTextRuns(
  value: unknown,
  glyphValue: unknown = [],
  sourceCharactersByRun?: Map<number, string[]>,
): any[] {
  if (!Array.isArray(value)) return [];
  const pageGlyphs = Array.isArray(glyphValue) ? glyphValue : [];
  const items = value.flatMap((run, sourceOrder) => {
    const rect = finitePdfTextRect(run?.rect);
    if (!rect) return [];
    const rawText = typeof run?.text === 'string' ? run.text : '';
    const sourceCharIndex = Number(run?.charIndex);
    const normalized = normalizePdfRunCharacters(
      rawText,
      Number.isFinite(sourceCharIndex) ? sourceCharIndex : 0,
      pageGlyphs,
      sourceCharactersByRun?.get(sourceOrder),
    );
    const sanitized = normalized.content;
    const content = sanitized || (isEmptyPdfWordJoinRun(run, rawText) ? '\u00ad' : '');
    if (!content) return [];
    const declaredSize = Number(run?.fontSize);
    const family = typeof run?.font?.familyName === 'string' && run.font.familyName.trim()
      ? run.font.familyName.trim()
      : typeof run?.font?.name === 'string'
        ? run.font.name.trim()
        : '';
    return [{
      sourceOrder,
      item: {
        content,
        rect: run.rect,
        font: {
          family,
          size: Number.isFinite(declaredSize) && declaredSize > 1 ? declaredSize : rect.height,
          weight: Number(run?.font?.weight),
          italic: run?.font?.italic === true,
        },
        sourceCharIndex: Number.isFinite(sourceCharIndex) ? sourceCharIndex : undefined,
        sourceCharCount: Number.isFinite(Number(run?.charCount)) ? Number(run.charCount) : undefined,
        selectionGlyphs: isPdfWordJoinMarker(content)
          ? []
          : normalized.glyphs.length > 0
            ? normalized.glyphs
            : approximatePdfSelectionGlyphs(
              content,
              rect,
              Number.isFinite(sourceCharIndex) ? sourceCharIndex : 0,
            ),
      },
      rect,
    }];
  });
  return orderPdfTextItems(items);
}

export function normalizeBasicPdfTextRects(value: unknown): any[] {
  if (!Array.isArray(value)) return [];
  const items = value.flatMap((item, sourceOrder) => {
    const rect = finitePdfTextRect(item?.rect);
    if (!rect) return [];
    const content = sanitizePdfTextContent(String(item?.content ?? ''));
    if (!content) return [];
    return [{
      sourceOrder,
      item: {
        ...item,
        content,
        selectionGlyphs: approximatePdfSelectionGlyphs(content, rect, sourceOrder * 100_000),
      },
      rect,
    }];
  });
  return orderPdfTextItems(items);
}

function normalizePdfRunCharacters(
  rawText: string,
  sourceCharIndex: number,
  pageGlyphs: any[],
  sourceCharacters?: string[],
): { content: string; glyphs: PdfSelectionGlyph[] } {
  let content = '';
  const glyphs: PdfSelectionGlyph[] = [];
  const characters = sourceCharacters?.length ? sourceCharacters : Array.from(rawText);
  for (let sourceOffset = 0; sourceOffset < characters.length; sourceOffset++) {
    const sourceCharacter = String(characters[sourceOffset] ?? '');
    const sanitized = isPdfSourceWordJoinMarker(sourceCharacter)
      ? '\u00ad'
      : sanitizePdfTextContent(sourceCharacter);
    const glyph = pageGlyphs[sourceCharIndex + sourceOffset];
    const offsetStart = content.length;
    content += sanitized;
    const offsetEnd = content.length;
    if (sanitized && offsetEnd > offsetStart) {
      const looseRect = pdfGlyphRect(glyph, false);
      const hitRect = pdfGlyphRect(glyph, true) ?? looseRect;
      if (looseRect && hitRect && !glyph?.isEmpty) {
        glyphs.push({
          offsetStart,
          offsetEnd,
          sourceCharIndex: sourceCharIndex + sourceOffset,
          looseRect,
          hitRect,
        });
      }
    }
  }
  return { content, glyphs };
}

function isPdfSourceWordJoinMarker(text: string): boolean {
  return Boolean(text) && Array.from(text).every(char => /[\u00ad\ufffe\uffff]/u.test(char));
}

function pdfGlyphRect(glyph: any, tight: boolean): PdfRect | undefined {
  const origin = tight && glyph?.tightOrigin ? glyph.tightOrigin : glyph?.origin;
  const size = tight && glyph?.tightSize ? glyph.tightSize : glyph?.size;
  const left = Number(origin?.x);
  const top = Number(origin?.y);
  const width = Number(size?.width);
  const height = Number(size?.height);
  if (![left, top, width, height].every(Number.isFinite) || width < 0 || height <= 0) return undefined;
  const effectiveWidth = Math.max(width, 0.25);
  return [left, top, left + effectiveWidth, top + height];
}

function approximatePdfSelectionGlyphs(
  content: string,
  rect: { left: number; top: number; width: number; height: number },
  sourceCharIndex: number,
): PdfSelectionGlyph[] {
  const characters = Array.from(content);
  if (!characters.length) return [];
  const width = rect.width / characters.length;
  const glyphs: PdfSelectionGlyph[] = [];
  let offset = 0;
  characters.forEach((character, index) => {
    const nextOffset = offset + character.length;
    const left = rect.left + index * width;
    const glyphRect: PdfRect = [left, rect.top, left + Math.max(width, 0.25), rect.top + rect.height];
    glyphs.push({
      offsetStart: offset,
      offsetEnd: nextOffset,
      sourceCharIndex: sourceCharIndex + index,
      looseRect: glyphRect,
      hitRect: glyphRect,
    });
    offset = nextOffset;
  });
  return glyphs;
}

function orderPdfTextItems(items: OrderedPdfTextItem[]): any[] {
  if (items.length < 2) return items.map(candidate => candidate.item);
  const flows: OrderedPdfTextItem[][] = [];
  let currentFlow: OrderedPdfTextItem[] = [];
  for (const item of items) {
    if (startsNewPdfTextColumn(currentFlow, item)) {
      flows.push(currentFlow);
      currentFlow = [];
    }
    currentFlow.push(item);
  }
  if (currentFlow.length) flows.push(currentFlow);
  return flows.flatMap(orderSinglePdfTextFlow).map(candidate => candidate.item);
}

function startsNewPdfTextColumn(flow: OrderedPdfTextItem[], candidate: OrderedPdfTextItem): boolean {
  if (flow.length < 3) return false;
  const recent = flow.slice(-16);
  const recentBottom = Math.max(...recent.map(item => item.rect.top));
  const typicalHeight = median(recent.map(item => item.rect.height));
  if (candidate.rect.top + Math.max(2, typicalHeight * 1.25) >= recentBottom) return false;

  // Use the bottom-local reading lane rather than the full recent envelope.
  // A distant full-width header can otherwise bridge a margin caption into the
  // body flow and make a drag appear to jump sideways between columns.
  const localWindow = Math.max(24, typicalHeight * 12);
  const laneItems = recent.filter(item => recentBottom - item.rect.top <= localWindow);
  const recentLeft = Math.min(...laneItems.map(item => item.rect.left));
  const recentRight = Math.max(...laneItems.map(item => item.rect.left + item.rect.width));
  const candidateLeft = candidate.rect.left;
  const candidateRight = candidate.rect.left + candidate.rect.width;
  const columnGap = Math.max(6, typicalHeight * 0.7);
  return candidateLeft > recentRight + columnGap || candidateRight < recentLeft - columnGap;
}

function orderSinglePdfTextFlow(items: OrderedPdfTextItem[]): OrderedPdfTextItem[] {
  const verticallySorted = [...items].sort((left, right) => (
    left.rect.top - right.rect.top
    || left.rect.left - right.rect.left
    || left.sourceOrder - right.sourceOrder
  ));
  const lines: Array<{ center: number; height: number; items: OrderedPdfTextItem[] }> = [];
  for (const item of verticallySorted) {
    const center = item.rect.top + item.rect.height / 2;
    const line = lines[lines.length - 1];
    const tolerance = line ? Math.max(1, Math.min(line.height, item.rect.height) * 0.5) : 0;
    if (line && Math.abs(center - line.center) <= tolerance) {
      const count = line.items.length;
      line.center = (line.center * count + center) / (count + 1);
      line.height = Math.max(line.height, item.rect.height);
      line.items.push(item);
    } else {
      lines.push({ center, height: item.rect.height, items: [item] });
    }
  }
  return lines.flatMap(line => line.items.sort((left, right) => (
    left.rect.left - right.rect.left || left.sourceOrder - right.sourceOrder
  )));
}

function sanitizePdfTextContent(text: string): string {
  return text
    .replace(/\r\n?|\n/gu, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, '')
    .replace(/[\u200b\u2060\ufeff\ufffe\uffff]/gu, '');
}

function isEmptyPdfWordJoinRun(run: any, rawText: string): boolean {
  const charCount = Number(run?.charCount);
  return (rawText.length === 0 && Number.isFinite(charCount) && charCount > 0)
    || /[\u00ad\ufffe\uffff]/u.test(rawText);
}

export function isPdfWordJoinMarker(text: string): boolean {
  return Boolean(text) && Array.from(text).every(char => char === '\u00ad');
}

export function endsWithPdfWordJoinMarker(text: string): boolean {
  return /\u00ad$/u.test(text);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0;
}
