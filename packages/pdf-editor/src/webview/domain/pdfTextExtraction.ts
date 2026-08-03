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

interface OrderedPdfTextLane {
  items: OrderedPdfTextItem[];
  left: number;
  leftBucket?: number;
  coverageBuckets: number[];
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
  const typicalHeight = median(items.map(item => item.rect.height));
  const laneGap = Math.max(6, typicalHeight * 0.7);
  const leftAlignmentTolerance = Math.max(8, typicalHeight * 2.25);
  const bucketSize = Math.max(16, typicalHeight * 4);
  const lanes: OrderedPdfTextLane[] = [];
  const leftIndex = new Map<number, Set<OrderedPdfTextLane>>();
  const coverageIndex = new Map<number, Set<OrderedPdfTextLane>>();
  let previousLane: OrderedPdfTextLane | undefined;
  let previousItem: OrderedPdfTextItem | undefined;

  for (const item of items) {
    let bestLane: OrderedPdfTextLane | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;
    const candidates = pdfTextLaneCandidates(
      item,
      previousLane,
      leftIndex,
      coverageIndex,
      bucketSize,
      laneGap,
      leftAlignmentTolerance,
    );
    for (const lane of candidates) {
      const match = pdfTextLaneMatch(
        lane,
        item,
        previousLane === lane ? previousItem : undefined,
        typicalHeight,
        laneGap,
        leftAlignmentTolerance,
      );
      if (match !== undefined && match > bestScore) {
        bestLane = lane;
        bestScore = match;
      }
    }
    if (!bestLane) {
      bestLane = { items: [], left: item.rect.left, coverageBuckets: [] };
      lanes.push(bestLane);
    }
    bestLane.items.push(item);
    updatePdfTextLaneIndex(bestLane, leftIndex, coverageIndex, bucketSize);
    previousLane = bestLane;
    previousItem = item;
  }

  return mergeSingleRowPdfTextLanes(lanes, typicalHeight, laneGap)
    .flatMap(lane => orderSinglePdfTextFlow(lane.items))
    .map(candidate => candidate.item);
}

function pdfTextLaneCandidates(
  candidate: OrderedPdfTextItem,
  previousLane: OrderedPdfTextLane | undefined,
  leftIndex: Map<number, Set<OrderedPdfTextLane>>,
  coverageIndex: Map<number, Set<OrderedPdfTextLane>>,
  bucketSize: number,
  laneGap: number,
  leftAlignmentTolerance: number,
): OrderedPdfTextLane[] {
  const result: OrderedPdfTextLane[] = [];
  const seen = new Set<OrderedPdfTextLane>();
  const add = (lane: OrderedPdfTextLane) => {
    if (seen.size >= 256 || seen.has(lane)) return;
    seen.add(lane);
    result.push(lane);
  };
  if (previousLane) add(previousLane);
  for (const key of pdfTextBucketKeys(
    candidate.rect.left - leftAlignmentTolerance,
    candidate.rect.left + leftAlignmentTolerance,
    bucketSize,
  )) {
    leftIndex.get(key)?.forEach(add);
  }
  for (const key of pdfTextBucketKeys(
    candidate.rect.left - laneGap,
    candidate.rect.left + candidate.rect.width + laneGap,
    bucketSize,
  )) {
    coverageIndex.get(key)?.forEach(add);
  }
  return result;
}

function updatePdfTextLaneIndex(
  lane: OrderedPdfTextLane,
  leftIndex: Map<number, Set<OrderedPdfTextLane>>,
  coverageIndex: Map<number, Set<OrderedPdfTextLane>>,
  bucketSize: number,
): void {
  if (lane.leftBucket !== undefined) removePdfTextLaneIndexValue(leftIndex, lane.leftBucket, lane);
  for (const key of lane.coverageBuckets) removePdfTextLaneIndexValue(coverageIndex, key, lane);

  const recent = lane.items.slice(-64);
  lane.left = median(recent.map(item => item.rect.left));
  lane.leftBucket = Math.floor(lane.left / bucketSize);
  lane.coverageBuckets = Array.from(new Set(recent.flatMap(item => pdfTextBucketKeys(
    item.rect.left,
    item.rect.left + item.rect.width,
    bucketSize,
  ))));
  addPdfTextLaneIndexValue(leftIndex, lane.leftBucket, lane);
  for (const key of lane.coverageBuckets) addPdfTextLaneIndexValue(coverageIndex, key, lane);
}

function addPdfTextLaneIndexValue(
  index: Map<number, Set<OrderedPdfTextLane>>,
  key: number,
  lane: OrderedPdfTextLane,
): void {
  const values = index.get(key) ?? new Set<OrderedPdfTextLane>();
  values.add(lane);
  index.set(key, values);
}

function removePdfTextLaneIndexValue(
  index: Map<number, Set<OrderedPdfTextLane>>,
  key: number,
  lane: OrderedPdfTextLane,
): void {
  const values = index.get(key);
  values?.delete(lane);
  if (values?.size === 0) index.delete(key);
}

function pdfTextBucketKeys(left: number, right: number, bucketSize: number): number[] {
  const first = Math.floor(Math.min(left, right) / bucketSize);
  const last = Math.floor(Math.max(left, right) / bucketSize);
  if (last - first <= 128) {
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  }
  return [first, Math.floor((first + last) / 2), last];
}

function pdfTextLaneMatch(
  lane: OrderedPdfTextLane,
  candidate: OrderedPdfTextItem,
  previousItem: OrderedPdfTextItem | undefined,
  typicalHeight: number,
  laneGap: number,
  leftAlignmentTolerance: number,
): number | undefined {
  const recent = lane.items.slice(-64);
  const leftDistance = Math.abs(candidate.rect.left - lane.left);
  const aligned = leftDistance <= leftAlignmentTolerance;
  const supportRows = pdfTextLaneSupportRows(recent, candidate, typicalHeight, laneGap);
  const inlineGap = previousItem
    ? pdfTextIntervalDistance(previousItem.rect, candidate.rect)
    : Number.POSITIVE_INFINITY;
  const continuesInlineRun = Boolean(
    previousItem
    && pdfTextItemsShareVisualLine(previousItem, candidate)
    && (
      inlineGap <= laneGap
      // Some generators emit styled fragments on one line in reverse x order.
      // Keep that local reversal together without letting a forward margin
      // column bootstrap an otherwise multi-row body lane.
      || (
        candidate.rect.left < previousItem.rect.left
        && inlineGap <= Math.max(laneGap, typicalHeight * 1.5)
      )
    )
  );
  if (!aligned && supportRows < 2 && !continuesInlineRun) return undefined;

  // Repeated overlap on different rows is stronger evidence than one sparse,
  // full-width header. Source-adjacent styled runs get the highest priority so
  // a sentence split across font changes remains in one reading lane.
  return (continuesInlineRun ? 10_000 : 0)
    + supportRows * 100
    + (aligned ? Math.max(0, 50 - leftDistance) : 0);
}

function mergeSingleRowPdfTextLanes(
  lanes: OrderedPdfTextLane[],
  typicalHeight: number,
  laneGap: number,
): OrderedPdfTextLane[] {
  const itemBySourceOrder = new Map<number, OrderedPdfTextItem>();
  const laneBySourceOrder = new Map<number, OrderedPdfTextLane>();
  for (const lane of lanes) {
    for (const item of lane.items) {
      itemBySourceOrder.set(item.sourceOrder, item);
      laneBySourceOrder.set(item.sourceOrder, lane);
    }
  }
  const mergedInto = new Map<OrderedPdfTextLane, OrderedPdfTextLane>();
  const resolveLane = (lane: OrderedPdfTextLane): OrderedPdfTextLane => {
    let resolved = lane;
    while (mergedInto.has(resolved)) resolved = mergedInto.get(resolved)!;
    return resolved;
  };

  for (const lane of lanes) {
    if (pdfTextVisualRowCount(lane.items, typicalHeight) > 1) continue;
    const firstItem = lane.items.reduce((first, item) => (
      item.sourceOrder < first.sourceOrder ? item : first
    ));
    const previousItem = itemBySourceOrder.get(firstItem.sourceOrder - 1);
    const previousLane = laneBySourceOrder.get(firstItem.sourceOrder - 1);
    if (!previousItem || !previousLane || previousLane === lane) continue;
    const target = resolveLane(previousLane);
    const heightRatio = Math.min(previousItem.rect.height, firstItem.rect.height)
      / Math.max(previousItem.rect.height, firstItem.rect.height);
    const itemGap = pdfTextIntervalDistance(previousItem.rect, firstItem.rect);
    const hasSupportingTargetRow = pdfTextLaneSupportRows(
      target.items,
      firstItem,
      typicalHeight,
      laneGap,
    ) >= 1;
    const maximumInlineGap = Math.max(
      laneGap,
      typicalHeight * (hasSupportingTargetRow ? 3 : 1.5),
    );
    if (
      heightRatio < 0.75
      || !pdfTextItemsShareVisualLine(previousItem, firstItem)
      || itemGap > maximumInlineGap
    ) {
      continue;
    }
    target.items.push(...lane.items);
    mergedInto.set(lane, target);
  }
  return lanes.filter(lane => !mergedInto.has(lane));
}

function pdfTextVisualRowCount(items: OrderedPdfTextItem[], typicalHeight: number): number {
  const centers = items
    .map(item => item.rect.top + item.rect.height / 2)
    .sort((left, right) => left - right);
  const tolerance = Math.max(1, typicalHeight * 0.55);
  let rows = 0;
  let lastCenter: number | undefined;
  for (const center of centers) {
    if (lastCenter === undefined || center - lastCenter > tolerance) {
      rows++;
      lastCenter = center;
    }
  }
  return rows;
}

function pdfTextLaneSupportRows(
  items: OrderedPdfTextItem[],
  candidate: OrderedPdfTextItem,
  typicalHeight: number,
  laneGap: number,
): number {
  const centers = items
    .filter(item => pdfTextIntervalDistance(item.rect, candidate.rect) <= laneGap)
    .map(item => item.rect.top + item.rect.height / 2)
    .sort((left, right) => left - right);
  const rowTolerance = Math.max(1, typicalHeight * 0.55);
  let rows = 0;
  let lastCenter: number | undefined;
  for (const center of centers) {
    if (lastCenter === undefined || center - lastCenter > rowTolerance) {
      rows++;
      lastCenter = center;
    }
  }
  return rows;
}

function pdfTextItemsShareVisualLine(
  left: OrderedPdfTextItem,
  right: OrderedPdfTextItem,
): boolean {
  const leftCenter = left.rect.top + left.rect.height / 2;
  const rightCenter = right.rect.top + right.rect.height / 2;
  return Math.abs(leftCenter - rightCenter)
    <= Math.max(1, Math.min(left.rect.height, right.rect.height) * 0.65);
}

function pdfTextIntervalDistance(
  left: OrderedPdfTextItem['rect'],
  right: OrderedPdfTextItem['rect'],
): number {
  const leftRight = left.left + left.width;
  const rightRight = right.left + right.width;
  if (leftRight < right.left) return right.left - leftRight;
  if (rightRight < left.left) return left.left - rightRight;
  return 0;
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
