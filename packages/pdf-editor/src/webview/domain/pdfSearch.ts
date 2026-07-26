export interface PdfTextFragment {
  textStart: string;
  textEnd?: string;
  prefix?: string;
  suffix?: string;
}

export interface PdfSearchSegment {
  textItemIndex: number;
  from: number;
  to: number;
}

export interface PdfSearchIndexChar {
  value: string;
  textItemIndex?: number;
  offset?: number;
}

export type PdfItemGapMode = boolean | 'geometry';

export function segmentsForPdfTextFragment(
  textRects: any[],
  fragment: PdfTextFragment,
): PdfSearchSegment[] {
  const textStart = normalizeSearchText(fragment.textStart, false, true);
  if (!textStart) return [];
  const textEnd = typeof fragment.textEnd === 'string'
    ? normalizeSearchText(fragment.textEnd, false, true)
    : '';
  const prefix = typeof fragment.prefix === 'string'
    ? normalizeSearchText(fragment.prefix, false, true)
    : '';
  const suffix = typeof fragment.suffix === 'string'
    ? normalizeSearchText(fragment.suffix, false, true)
    : '';
  for (const itemGapMode of ([true, false, 'geometry'] satisfies PdfItemGapMode[])) {
    const index = buildPdfSearchIndex(textRects, itemGapMode, false, false, true);
    const haystack = index.map(char => char.value).join('');
    let from = haystack.indexOf(textStart);
    while (from >= 0) {
      const startTo = from + textStart.length;
      const prefixMatches = !prefix || haystack.slice(0, from).trimEnd().endsWith(prefix);
      if (prefixMatches) {
        let endFrom = textEnd ? haystack.indexOf(textEnd, startTo) : startTo;
        while (endFrom >= 0) {
          const to = textEnd ? endFrom + textEnd.length : startTo;
          const suffixMatches = !suffix || haystack.slice(to).trimStart().startsWith(suffix);
          if (suffixMatches) {
            const segments = segmentsForSearchRange(index, from, to);
            if (segments.length > 0) return segments;
          }
          if (!textEnd) break;
          endFrom = haystack.indexOf(textEnd, endFrom + 1);
        }
      }
      from = haystack.indexOf(textStart, from + 1);
    }
  }
  return [];
}

export function buildPdfSearchIndex(
  textRects: any[],
  itemGapMode: PdfItemGapMode,
  skipNonAsciiArtifacts: boolean,
  matchCase: boolean,
  matchDiacritics: boolean,
): PdfSearchIndexChar[] {
  const index: PdfSearchIndexChar[] = [];
  let previousTextItemIndex: number | undefined;
  let suppressNextGap = false;
  for (let itemIndex = 0; itemIndex < textRects.length; itemIndex++) {
    const content = String(textRects[itemIndex]?.content ?? '');
    if (!content) continue;
    const firstValue = firstSearchValue(content, skipNonAsciiArtifacts, matchCase, matchDiacritics);
    if (!firstValue) {
      if (isPdfWordJoinMarker(content)) suppressNextGap = true;
      continue;
    }
    const insertGap = !suppressNextGap && (itemGapMode === true
      || (itemGapMode === 'geometry'
        && previousTextItemIndex !== undefined
        && shouldInsertGeometryGap(textRects[previousTextItemIndex], textRects[itemIndex])));
    if (insertGap && shouldInsertSearchGap(index, firstValue)) {
      index.push({ value: ' ' });
    }
    for (let offset = 0; offset < content.length; offset++) {
      appendSearchChar(index, content.charAt(offset), itemIndex, offset, skipNonAsciiArtifacts, matchCase, matchDiacritics);
    }
    suppressNextGap = endsWithPdfWordJoinMarker(content);
    previousTextItemIndex = itemIndex;
  }
  while (index.length) {
    const last = index[index.length - 1];
    if (!last || last.value !== ' ') break;
    index.pop();
  }
  return index;
}

function firstSearchValue(
  content: string,
  skipNonAsciiArtifacts: boolean,
  matchCase: boolean,
  matchDiacritics: boolean,
): string | undefined {
  for (let offset = 0; offset < content.length; offset++) {
    const value = searchCharValue(content.charAt(offset), skipNonAsciiArtifacts, matchCase, matchDiacritics);
    if (value) return value.charAt(0);
  }
  return undefined;
}

function shouldInsertSearchGap(index: PdfSearchIndexChar[], nextValue: string): boolean {
  if (!index.length) return false;
  const last = index[index.length - 1];
  if (!last || last.value === ' ') return false;
  return nextValue !== ' ';
}

export function shouldInsertGeometryGap(previousItem: any, nextItem: any): boolean {
  const previousContent = String(previousItem?.content ?? '').trimEnd();
  if (/[-\u00ad\u2010\u2011]$/u.test(previousContent)) return false;

  const previousRect = finitePdfTextRect(previousItem?.rect);
  const nextRect = finitePdfTextRect(nextItem?.rect);
  if (!previousRect || !nextRect) return false;

  const previousCenterY = previousRect.top + previousRect.height / 2;
  const nextCenterY = nextRect.top + nextRect.height / 2;
  const sameLineTolerance = Math.max(1, Math.min(previousRect.height, nextRect.height) * 0.5);
  if (Math.abs(previousCenterY - nextCenterY) > sameLineTolerance) return true;

  const horizontalGap = Math.max(
    nextRect.left - (previousRect.left + previousRect.width),
    previousRect.left - (nextRect.left + nextRect.width),
    0,
  );
  const wordGapThreshold = Math.max(0.5, Math.min(previousRect.height, nextRect.height) * 0.18);
  return horizontalGap > wordGapThreshold;
}

function finitePdfTextRect(
  value: any,
): { left: number; top: number; width: number; height: number } | undefined {
  const left = Number(value?.origin?.x);
  const top = Number(value?.origin?.y);
  const width = Number(value?.size?.width);
  const height = Number(value?.size?.height);
  if (![left, top, width, height].every(Number.isFinite) || width < 0 || height <= 0) return undefined;
  return { left, top, width, height };
}

function isPdfWordJoinMarker(text: string): boolean {
  return Boolean(text) && Array.from(text).every(char => char === '\u00ad');
}

function endsWithPdfWordJoinMarker(text: string): boolean {
  return /\u00ad$/u.test(text);
}

function appendSearchChar(
  index: PdfSearchIndexChar[],
  char: string,
  textItemIndex: number,
  offset: number,
  skipNonAsciiArtifacts: boolean,
  matchCase: boolean,
  matchDiacritics: boolean,
): void {
  const value = searchCharValue(char, skipNonAsciiArtifacts, matchCase, matchDiacritics);
  if (!value) return;
  for (let valueOffset = 0; valueOffset < value.length; valueOffset++) {
    const outputUnit = value.charAt(valueOffset);
    const last = index[index.length - 1];
    if (outputUnit === ' ' && (!last || last.value === ' ')) continue;
    index.push({ value: outputUnit, textItemIndex, offset });
  }
}

function searchCharValue(
  char: string,
  skipNonAsciiArtifacts: boolean,
  matchCase: boolean,
  matchDiacritics: boolean,
): string | undefined {
  if (char === '\u00ad') return undefined;
  if (isSearchWhitespace(char)) return ' ';
  const codePoint = char.codePointAt(0);
  if (typeof codePoint !== 'number') return undefined;
  if (isPdfExtractionArtifact(codePoint, skipNonAsciiArtifacts)) return undefined;
  const normalized = matchDiacritics ? char : stripSearchDiacritics(char);
  if (!normalized) return undefined;
  return matchCase ? normalized : foldSearchCase(normalized);
}

function foldSearchCase(text: string): string {
  return text.toLowerCase().replace(/\u03c2/g, '\u03c3');
}

function isPdfExtractionArtifact(codePoint: number, skipNonAsciiArtifacts: boolean): boolean {
  if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  if (codePoint >= 0xe000 && codePoint <= 0xf8ff) return true;
  return skipNonAsciiArtifacts && codePoint > 0x7f;
}

export function segmentsForSearchRange(
  index: PdfSearchIndexChar[],
  from: number,
  to: number,
): PdfSearchSegment[] {
  const segments: PdfSearchSegment[] = [];
  for (let cursor = from; cursor < to; cursor++) {
    const char = index[cursor];
    if (typeof char?.textItemIndex !== 'number' || typeof char.offset !== 'number') continue;
    const last = segments[segments.length - 1];
    if (last && last.textItemIndex === char.textItemIndex && char.offset <= last.to) {
      last.to = Math.max(last.to, char.offset + 1);
    } else {
      segments.push({
        textItemIndex: char.textItemIndex,
        from: char.offset,
        to: char.offset + 1,
      });
    }
  }
  return segments;
}

export function normalizeSearchText(
  text: string,
  matchCase: boolean,
  matchDiacritics: boolean,
): string {
  const output: string[] = [];
  for (let offset = 0; offset < text.length; offset++) {
    const value = searchCharValue(text.charAt(offset), false, matchCase, matchDiacritics);
    if (!value) continue;
    for (let valueOffset = 0; valueOffset < value.length; valueOffset++) {
      const outputUnit = value.charAt(valueOffset);
      if (outputUnit === ' ' && (!output.length || output[output.length - 1] === ' ')) continue;
      output.push(outputUnit);
    }
  }
  while (output[0] === ' ') output.shift();
  while (output[output.length - 1] === ' ') output.pop();
  return output.join('');
}

function stripSearchDiacritics(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '');
}

export function isWholeWordSearchMatch(haystack: string, from: number, length: number): boolean {
  const before = from > 0 ? haystack.charAt(from - 1) : '';
  const after = from + length < haystack.length ? haystack.charAt(from + length) : '';
  return !isSearchWordCharacter(before) && !isSearchWordCharacter(after);
}

function isSearchWordCharacter(char: string): boolean {
  return Boolean(char) && /[\p{L}\p{N}_]/u.test(char);
}

export function isAsciiSearchQuery(text: string): boolean {
  return /^[\x00-\x7f]*$/.test(text);
}

export function isSearchWhitespace(char: string): boolean {
  return /\s/.test(char);
}
