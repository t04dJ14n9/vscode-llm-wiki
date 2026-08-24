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
      pdfRunSourceCharacters(value, sourceOrder, pageGlyphs, sourceCharactersByRun?.get(sourceOrder)),
    );
    const sanitized = normalized.content;
    const content = sanitized || (isEmptyPdfWordJoinRun(run, rawText) ? '\u00ad' : '');
    if (!content.trim()) return [];
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
        ...(normalized.wordJoinAfter ? { wordJoinAfter: true } : {}),
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
  return orderPdfTextItems(foldPdfWordJoinItems(items));
}

function foldPdfWordJoinItems(items: OrderedPdfTextItem[]): OrderedPdfTextItem[] {
  const result: OrderedPdfTextItem[] = [];
  let previous: OrderedPdfTextItem | undefined;
  for (const candidate of items) {
    if (isPdfWordJoinMarker(String(candidate.item?.content ?? '')) && previous) {
      previous.item.wordJoinAfter = true;
      continue;
    }
    result.push(candidate);
    if (!isPdfWordJoinMarker(String(candidate.item?.content ?? ''))) previous = candidate;
  }
  return result;
}

function pdfRunSourceCharacters(
  runs: any[],
  sourceOrder: number,
  pageGlyphs: any[],
  sourceCharacters: string[] | undefined,
): string[] | undefined {
  const run = runs[sourceOrder];
  const nextRun = runs[sourceOrder + 1];
  const rawCharacters: string[] = Array.from(typeof run?.text === 'string' ? run.text : '');
  const nextCharacters: string[] = Array.from(typeof nextRun?.text === 'string' ? nextRun.text : '');
  const charIndex = Number(run?.charIndex);
  const charCount = Number(run?.charCount);
  const nextCharIndex = Number(nextRun?.charIndex);
  const runRect = finitePdfTextRect(run?.rect);
  const nextRect = finitePdfTextRect(nextRun?.rect);
  if (
    !sourceCharacters
    || sourceCharacters.length !== charCount
    || charCount !== rawCharacters.length + 1
    || sourceCharacters[charCount - 1] !== ''
    || sourceCharacters.slice(0, -1).some(character => character === '')
    || !/[\p{L}\p{N}]$/u.test(rawCharacters.at(-1) ?? '')
    || !/^[\p{L}\p{N}]/u.test(nextCharacters[0] ?? '')
    || !Number.isInteger(charIndex)
    || !Number.isInteger(nextCharIndex)
    || nextCharIndex !== charIndex + charCount
    || !runRect
    || !nextRect
  ) {
    return sourceCharacters;
  }

  const glyph = pageGlyphs[charIndex + charCount - 1];
  const looseRect = pdfGlyphRect(glyph, false);
  const tightRect = glyph?.tightOrigin && glyph?.tightSize
    ? pdfGlyphRect(glyph, true)
    : undefined;
  if (!looseRect || !tightRect || glyph?.isEmpty === true) return sourceCharacters;

  const looseWidth = looseRect[2] - looseRect[0];
  const looseHeight = looseRect[3] - looseRect[1];
  const tightWidth = tightRect[2] - tightRect[0];
  const tightHeight = tightRect[3] - tightRect[1];
  const runRight = runRect.left + runRect.width;
  const nextLineOffset = nextRect.top - runRect.top;
  if (
    tightWidth <= 0
    || tightWidth > looseHeight * 0.5
    || tightHeight > Math.max(1.5, looseHeight * 0.22)
    || Math.abs(looseRect[2] - runRight) > 1.25
    || Math.abs(tightRect[2] - runRight) > 1.25
    || looseWidth > looseHeight * 0.5
    || nextLineOffset < runRect.height * 0.5
    || nextLineOffset > runRect.height * 1.75
    || nextRect.left >= runRight
  ) {
    return sourceCharacters;
  }
  return [...sourceCharacters.slice(0, -1), '\u00ad'];
}

export function normalizeBasicPdfTextRects(value: unknown): any[] {
  if (!Array.isArray(value)) return [];
  const items = value.flatMap((item, sourceOrder) => {
    const rect = finitePdfTextRect(item?.rect);
    if (!rect) return [];
    const content = sanitizePdfTextContent(String(item?.content ?? ''));
    if (!content.trim()) return [];
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
): { content: string; glyphs: PdfSelectionGlyph[]; wordJoinAfter: boolean } {
  let content = '';
  let wordJoinAfter = false;
  const glyphs: PdfSelectionGlyph[] = [];
  const characters = sourceCharacters?.length ? sourceCharacters : Array.from(rawText);
  for (let sourceOffset = 0; sourceOffset < characters.length; sourceOffset++) {
    const sourceCharacter = String(characters[sourceOffset] ?? '');
    if (isPdfSourceWordJoinMarker(sourceCharacter)) {
      wordJoinAfter = true;
      continue;
    }
    const sanitized = sanitizePdfTextContent(sourceCharacter);
    if (sanitized) wordJoinAfter = false;
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
  return { content, glyphs, wordJoinAfter };
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

  const singleRowMerged = mergeSingleRowPdfTextLanes(lanes, typicalHeight, laneGap);
  const segmented = singleRowMerged.flatMap(lane => (
    pdfTextLaneHasDisjointPeer(lane, singleRowMerged, typicalHeight)
      ? [lane]
      : splitPdfTextLaneAtVerticalGaps(lane, typicalHeight, laneGap)
  ));
  const ordered = orderPdfTextLaneRegions(
    mergeAdjacentPdfTextLanes(segmented, typicalHeight, laneGap, leftAlignmentTolerance),
  )
    .flatMap(lane => orderSinglePdfTextFlow(lane.items));
  const gridOrdered = restoreCompactPdfGridOrder(ordered, items, typicalHeight);
  return restoreLocalPdfSourceOrder(gridOrdered, items, typicalHeight)
    .map(candidate => candidate.item);
}

function pdfTextLaneHasDisjointPeer(
  lane: OrderedPdfTextLane,
  lanes: OrderedPdfTextLane[],
  typicalHeight: number,
): boolean {
  if (pdfTextVisualRowCount(lane.items, typicalHeight) < 2) return false;
  const bounds = pdfTextLaneBounds(lane);
  return lanes.some(peer => {
    if (
      peer === lane
      || pdfTextVisualRowCount(peer.items, typicalHeight) < 2
    ) {
      return false;
    }
    const peerBounds = pdfTextLaneBounds(peer);
    const verticalOverlap = Math.min(bounds.bottom, peerBounds.bottom)
      - Math.max(bounds.top, peerBounds.top);
    const horizontalGap = Math.max(
      peerBounds.left - bounds.right,
      bounds.left - peerBounds.right,
    );
    return verticalOverlap >= typicalHeight && horizontalGap >= 0;
  });
}

function splitPdfTextLaneAtVerticalGaps(
  lane: OrderedPdfTextLane,
  typicalHeight: number,
  laneGap: number,
): OrderedPdfTextLane[] {
  const items = orderSinglePdfTextFlow(lane.items);
  const maximumGap = Math.max(laneGap, typicalHeight * 0.75);
  const segments: OrderedPdfTextItem[][] = [];
  let bottom = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    if (segments.length === 0 || item.rect.top > bottom + maximumGap) {
      segments.push([]);
      bottom = Number.NEGATIVE_INFINITY;
    }
    segments[segments.length - 1]!.push(item);
    bottom = Math.max(bottom, item.rect.top + item.rect.height);
  }
  return segments.map(segment => ({
    items: segment,
    left: median(segment.map(item => item.rect.left)),
    coverageBuckets: [],
  }));
}

function mergeAdjacentPdfTextLanes(
  lanes: OrderedPdfTextLane[],
  typicalHeight: number,
  laneGap: number,
  leftAlignmentTolerance: number,
): OrderedPdfTextLane[] {
  const result = [...lanes];
  while (true) {
    let best: { left: number; right: number; score: number } | undefined;
    for (let left = 0; left < result.length; left++) {
      for (let right = left + 1; right < result.length; right++) {
        const score = pdfTextLaneMergeScore(
          result[left]!,
          result[right]!,
          typicalHeight,
          laneGap,
          leftAlignmentTolerance,
        );
        if (score !== undefined && (!best || score < best.score)) {
          best = { left, right, score };
        }
      }
    }
    if (!best) return result;
    const target = result[best.left]!;
    target.items.push(...result[best.right]!.items);
    target.left = median(target.items.map(item => item.rect.left));
    result.splice(best.right, 1);
  }
}

function pdfTextLaneMergeScore(
  left: OrderedPdfTextLane,
  right: OrderedPdfTextLane,
  typicalHeight: number,
  laneGap: number,
  leftAlignmentTolerance: number,
): number | undefined {
  const leftBounds = pdfTextLaneBounds(left);
  const rightBounds = pdfTextLaneBounds(right);
  const leftHeight = median(left.items.map(item => item.rect.height));
  const rightHeight = median(right.items.map(item => item.rect.height));
  const heightRatio = Math.min(leftHeight, rightHeight) / Math.max(leftHeight, rightHeight);
  if (heightRatio < 0.75) return undefined;

  const verticalOverlap = Math.min(leftBounds.bottom, rightBounds.bottom)
    - Math.max(leftBounds.top, rightBounds.top);
  const maximumVerticalDistance = Math.max(laneGap, typicalHeight * 1.5);
  if (
    verticalOverlap > Math.max(leftHeight, rightHeight) * 1.1
    || verticalOverlap < -maximumVerticalDistance
  ) {
    return undefined;
  }

  const leftDistance = Math.abs(left.left - right.left);
  const horizontalOverlap = Math.min(leftBounds.right, rightBounds.right)
    - Math.max(leftBounds.left, rightBounds.left);
  const narrowerWidth = Math.min(
    leftBounds.right - leftBounds.left,
    rightBounds.right - rightBounds.left,
  );
  const widerWidth = Math.max(
    leftBounds.right - leftBounds.left,
    rightBounds.right - rightBounds.left,
  );
  const coverageRatio = Math.max(0, horizontalOverlap) / Math.max(1, narrowerWidth);
  const coverageWidthRatio = narrowerWidth / Math.max(1, widerWidth);
  if (
    leftDistance > leftAlignmentTolerance
    || coverageRatio < 0.5
    || coverageWidthRatio < 0.5
  ) {
    return undefined;
  }

  return Math.abs(verticalOverlap) * 10 + leftDistance;
}

function pdfTextLaneBounds(lane: OrderedPdfTextLane): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  return {
    left: Math.min(...lane.items.map(item => item.rect.left)),
    top: Math.min(...lane.items.map(item => item.rect.top)),
    right: Math.max(...lane.items.map(item => item.rect.left + item.rect.width)),
    bottom: Math.max(...lane.items.map(item => item.rect.top + item.rect.height)),
  };
}

function orderPdfTextLaneRegions(lanes: OrderedPdfTextLane[]): OrderedPdfTextLane[] {
  const entries = lanes.map((lane, sourceOrder) => ({
    lane,
    sourceOrder,
    top: Math.min(...lane.items.map(item => item.rect.top)),
    bottom: Math.max(...lane.items.map(item => item.rect.top + item.rect.height)),
  })).sort((left, right) => (
    left.top - right.top
    || left.bottom - right.bottom
    || left.sourceOrder - right.sourceOrder
  ));
  const regions: Array<{ bottom: number; entries: typeof entries }> = [];
  for (const entry of entries) {
    const region = regions[regions.length - 1];
    if (region && entry.top < region.bottom) {
      region.bottom = Math.max(region.bottom, entry.bottom);
      region.entries.push(entry);
    } else {
      regions.push({ bottom: entry.bottom, entries: [entry] });
    }
  }
  return regions.flatMap(region => region.entries
    .sort((left, right) => left.sourceOrder - right.sourceOrder)
    .map(entry => entry.lane));
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
  const sharesVisualLine = Boolean(
    previousItem
    && pdfTextItemsShareVisualLine(previousItem, candidate)
  );
  const continuesSourceAlignedRun = Boolean(previousItem && aligned);
  const continuesInlineRun = sharesVisualLine && inlineGap <= laneGap;
  const continuesStyledForwardRun = Boolean(
    sharesVisualLine
    && previousItem
    && candidate.rect.left >= previousItem.rect.left
    && inlineGap > laneGap
    && inlineGap <= Math.max(laneGap, typicalHeight * 3)
    && pdfTextItemsHaveDistinctFontStyle(previousItem, candidate)
  );
  // Some generators emit styled fragments on one line in reverse x order.
  // Keep that relaxed reversal eligible, but do not let it outrank a
  // geometrically aligned lane: alternating columns can have the same shape.
  const continuesRelaxedReverseRun = Boolean(
    sharesVisualLine
    && previousItem
    && candidate.rect.left < previousItem.rect.left
    && inlineGap > laneGap
    && inlineGap <= Math.max(laneGap, typicalHeight * 1.5)
  );
  const conflictsWithExistingLine = recent.some(item => (
    pdfTextItemsShareVisualLine(item, candidate)
    && pdfTextIntervalDistance(item.rect, candidate.rect) > laneGap
  ));
  if (
    conflictsWithExistingLine
    && !continuesInlineRun
    && !continuesStyledForwardRun
    && !continuesRelaxedReverseRun
  ) {
    return undefined;
  }
  if (
    !aligned
    && supportRows < 2
    && !continuesInlineRun
    && !continuesStyledForwardRun
    && !continuesRelaxedReverseRun
  ) {
    return undefined;
  }
  const relaxedUnalignedMatch = !aligned
    && (continuesStyledForwardRun || continuesRelaxedReverseRun);

  // Repeated overlap on different rows is stronger evidence than one sparse,
  // full-width header. A source-adjacent aligned run must outrank accumulated
  // header overlap, which can otherwise steal one line from a prose column.
  // Relaxed style/reversal matches stay below a geometrically aligned lane.
  return (continuesInlineRun ? 10_000 : 0)
    + (continuesSourceAlignedRun ? 10_000 : 0)
    + (continuesStyledForwardRun ? 10 : 0)
    + (continuesRelaxedReverseRun ? 10 : 0)
    + (relaxedUnalignedMatch ? 0 : supportRows * 100)
    + (aligned ? 20 + Math.max(0, 50 - leftDistance) : 0);
}

function pdfTextItemsHaveDistinctFontStyle(
  left: OrderedPdfTextItem,
  right: OrderedPdfTextItem,
): boolean {
  const leftFont = left.item?.font;
  const rightFont = right.item?.font;
  if (!leftFont || !rightFont) return false;
  return String(leftFont.family ?? '').trim() !== String(rightFont.family ?? '').trim()
    || String(leftFont.size ?? '') !== String(rightFont.size ?? '')
    || String(leftFont.weight ?? '') !== String(rightFont.weight ?? '')
    || (leftFont.italic === true) !== (rightFont.italic === true);
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

interface OrderedPdfTextRow {
  center: number;
  height: number;
  items: OrderedPdfTextItem[];
}

function restoreCompactPdfGridOrder(
  ordered: OrderedPdfTextItem[],
  sourceItems: OrderedPdfTextItem[],
  typicalHeight: number,
): OrderedPdfTextItem[] {
  const rows = pdfTextVisualRows(sourceItems);
  const maximumRowGap = Math.max(3, typicalHeight * 3);
  const minimumCellGap = Math.max(6, typicalHeight * 3);
  const maximumFragmentGap = Math.max(6, typicalHeight * 0.7);
  const coreRows = rows.map(row => {
    const items = [...row.items].sort((left, right) => left.rect.left - right.rect.left);
    let largeGaps = 0;
    let inlineStyleTransitions = 0;
    for (let index = 1; index < items.length; index++) {
      const previous = items[index - 1]!;
      const current = items[index]!;
      const gap = current.rect.left - (previous.rect.left + previous.rect.width);
      if (gap > minimumCellGap) {
        largeGaps++;
      }
      if (
        gap <= maximumFragmentGap
        && pdfTextItemsHaveDistinctFontStyle(previous, current)
      ) {
        inlineStyleTransitions++;
      }
    }
    return largeGaps >= 2 || (items.length >= 4 && inlineStyleTransitions >= 2);
  });
  const blocks: Array<{ orders: Set<number>; maximumSourceOrder: number }> = [];
  for (let start = 0; start < rows.length;) {
    if (!coreRows[start]) {
      start++;
      continue;
    }
    let end = start;
    while (
      coreRows[end + 1]
      && rows[end + 1]!.center - rows[end]!.center <= maximumRowGap
    ) {
      end++;
    }
    if (end === start) {
      start++;
      continue;
    }
    while (
      (rows[end + 1]?.items.length ?? 0) >= 2
      && rows[end + 1]!.center - rows[end]!.center <= maximumRowGap
    ) {
      end++;
    }
    const blockItems = rows
      .slice(start, end + 1)
      .flatMap(row => row.items)
      .sort((left, right) => left.sourceOrder - right.sourceOrder);
    const minimumSourceOrder = blockItems[0]!.sourceOrder;
    const maximumSourceOrder = blockItems.at(-1)!.sourceOrder;
    if (maximumSourceOrder - minimumSourceOrder + 1 !== blockItems.length) {
      start = end + 1;
      continue;
    }
    blocks.push({
      orders: new Set(blockItems.map(item => item.sourceOrder)),
      maximumSourceOrder,
    });
    start = end + 1;
  }

  let result = [...ordered];
  for (const block of blocks) {
    const blockItems = sourceItems
      .filter(item => block.orders.has(item.sourceOrder))
      .sort((left, right) => left.sourceOrder - right.sourceOrder);
    result = result.filter(item => !block.orders.has(item.sourceOrder));
    const insertionIndex = result.findIndex(item => item.sourceOrder > block.maximumSourceOrder);
    result.splice(insertionIndex < 0 ? result.length : insertionIndex, 0, ...blockItems);
  }
  return result;
}

// Geometry establishes page lanes, but source order remains authoritative
// inside a spatially local run. This keeps stacked math fragments semantic
// without reconnecting broad column jumps or reverse-x plain-text columns.
function restoreLocalPdfSourceOrder(
  ordered: OrderedPdfTextItem[],
  sourceItems: OrderedPdfTextItem[],
  typicalHeight: number,
): OrderedPdfTextItem[] {
  const sourceOrdered = [...sourceItems].sort((left, right) => left.sourceOrder - right.sourceOrder);
  const groups: OrderedPdfTextItem[][] = [];
  for (const item of sourceOrdered) {
    const group = groups[groups.length - 1];
    if (!group || !pdfTextItemsContinueLocalSourceFlow(group, item, typicalHeight)) {
      groups.push([item]);
    } else {
      group.push(item);
    }
  }

  let result = [...ordered];
  for (const group of groups) {
    if (group.length < 2) continue;
    const groupItems = new Set(group);
    const current = result.filter(item => groupItems.has(item));
    if (current.length !== group.length || current.every((item, index) => item === group[index])) continue;
    const firstIndex = Math.min(...group.map(item => result.indexOf(item)).filter(index => index >= 0));
    const insertionIndex = result
      .slice(0, firstIndex)
      .filter(item => !groupItems.has(item))
      .length;
    result = result.filter(item => !groupItems.has(item));
    result.splice(insertionIndex, 0, ...group);
  }
  return result;
}

function pdfTextItemsContinueLocalSourceFlow(
  group: OrderedPdfTextItem[],
  candidate: OrderedPdfTextItem,
  typicalHeight: number,
): boolean {
  const previous = group[group.length - 1]!;
  const previousBottom = previous.rect.top + previous.rect.height;
  const candidateBottom = candidate.rect.top + candidate.rect.height;
  const verticalGap = previousBottom < candidate.rect.top
    ? candidate.rect.top - previousBottom
    : candidateBottom < previous.rect.top
      ? previous.rect.top - candidateBottom
      : 0;
  if (verticalGap > Math.max(6, typicalHeight * 2.5)) return false;

  const horizontalGap = pdfTextIntervalDistance(previous.rect, candidate.rect);
  const leftDistance = Math.abs(previous.rect.left - candidate.rect.left);
  const fullFlowLeft = median(group
    .filter(item => item.rect.height >= typicalHeight * 0.82)
    .map(item => item.rect.left));
  const recentFlowLeft = median(group
    .slice(-12)
    .filter(item => item.rect.height >= typicalHeight * 0.82)
    .map(item => item.rect.left));
  const wrapsToFlowStart = candidate.rect.top >= previous.rect.top
    && (
      Math.abs(candidate.rect.left - fullFlowLeft) <= Math.max(8, typicalHeight * 4)
      || Math.abs(candidate.rect.left - recentFlowLeft) <= Math.max(8, typicalHeight * 4)
    );
  const isEquationNumber = /^\(\s*\d+[a-z]?\s*\)$/iu.test(String(candidate.item?.content ?? '').trim());
  const followsEquationBand = isEquationNumber
    && verticalGap <= typicalHeight
    && Math.abs(
      (previous.rect.top + previous.rect.height / 2)
      - (candidate.rect.top + candidate.rect.height / 2)
    ) <= typicalHeight * 1.5;
  const groupLeft = Math.min(...group.map(item => item.rect.left));
  const groupRight = Math.max(...group.map(item => item.rect.left + item.rect.width));
  const candidateRight = candidate.rect.left + candidate.rect.width;
  const hasCompactFragments = candidate.rect.height <= typicalHeight * 0.9
    || group.some(item => item.rect.height <= typicalHeight * 0.9);
  const stacksWithinFlowSpan = candidate.rect.top > previous.rect.top
    && verticalGap <= typicalHeight * 0.5
    && hasCompactFragments
    && Math.min(groupRight, candidateRight) > Math.max(groupLeft, candidate.rect.left);
  const startsRaisedMath = candidate.rect.top < previous.rect.top
    && verticalGap === 0
    && candidate.rect.height <= previous.rect.height
    && horizontalGap <= typicalHeight * 4
    && leftDistance <= typicalHeight * 12;
  const separatesBroadColumns = leftDistance > Math.max(48, typicalHeight * 6)
    && horizontalGap > Math.max(6, typicalHeight * 0.7)
    && !wrapsToFlowStart;
  if (
    separatesBroadColumns
    && !followsEquationBand
    && !startsRaisedMath
    && !stacksWithinFlowSpan
  ) {
    return false;
  }
  const previousCenter = previous.rect.top + previous.rect.height / 2;
  const candidateCenter = candidate.rect.top + candidate.rect.height / 2;
  const sameVisualLine = Math.abs(previousCenter - candidateCenter)
    <= Math.max(1, Math.min(previous.rect.height, candidate.rect.height) * 0.55);
  const reversesPlainVisualText = candidate.rect.left < previous.rect.left
    && sameVisualLine
    && previous.rect.height >= typicalHeight * 0.82
    && candidate.rect.height >= typicalHeight * 0.82;
  if (reversesPlainVisualText) return false;
  const immediatelyAdjacent = horizontalGap <= Math.max(4, typicalHeight * 1.5);
  const nearbyCluster = horizontalGap <= Math.max(8, typicalHeight * 4)
    && leftDistance <= Math.max(24, typicalHeight * 6);
  return immediatelyAdjacent
    || nearbyCluster
    || wrapsToFlowStart
    || followsEquationBand
    || startsRaisedMath
    || stacksWithinFlowSpan;
}

function pdfTextVisualRows(items: OrderedPdfTextItem[]): OrderedPdfTextRow[] {
  const verticallySorted = [...items].sort((left, right) => (
    left.rect.top - right.rect.top
    || left.rect.left - right.rect.left
    || left.sourceOrder - right.sourceOrder
  ));
  const lines: OrderedPdfTextRow[] = [];
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
  return lines;
}

function orderSinglePdfTextFlow(items: OrderedPdfTextItem[]): OrderedPdfTextItem[] {
  return pdfTextVisualRows(items).flatMap(line => line.items.sort((left, right) => (
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
