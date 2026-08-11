import {
  PdfActionType,
  PdfZoomMode,
  type PdfDestinationObject,
  type PdfLinkAnnoObject,
} from '@embedpdf/models';

export type PdfNavigationDirection = -1 | 1;
export type PdfPresentationMode = 'single' | 'single-continuous' | 'two' | 'two-continuous';
export type PdfSpreadParity = 'odd' | 'even';
export type PdfViewportAxis = 'horizontal' | 'vertical';

export interface PdfPresentationPolicy {
  continuousScroll: boolean;
  twoPageView: boolean;
  spreadParity: PdfSpreadParity;
  scrollMode: 'vertical';
}

export interface PdfViewportMetrics {
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
}

export interface PdfViewportProgress {
  x: number;
  y: number;
}

export interface PdfViewportScrollPosition {
  left: number;
  top: number;
}

export interface PdfAnnotationRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PdfDestinationViewerTarget {
  x: number;
  y: number;
  alignX: boolean;
}

export const PDF_VIEWPORT_BOUNDARY_EPSILON_PX = 4;

export function pdfPresentationMode(
  continuousScroll: boolean,
  twoPageView: boolean,
): PdfPresentationMode {
  if (twoPageView) return continuousScroll ? 'two-continuous' : 'two';
  return continuousScroll ? 'single-continuous' : 'single';
}

export function pdfPresentationPolicy(mode: PdfPresentationMode): PdfPresentationPolicy {
  return {
    continuousScroll: mode === 'single-continuous' || mode === 'two-continuous',
    twoPageView: mode === 'two' || mode === 'two-continuous',
    // Preview's four presentation choices use cover-page spreads.
    spreadParity: 'even',
    scrollMode: 'vertical',
  };
}

export function pdfSpreadStart(page: number, parity: PdfSpreadParity): number {
  if (parity === 'even') {
    if (page <= 1) return 1;
    return page % 2 === 0 ? page : page - 1;
  }
  return Math.max(1, page % 2 === 0 ? page - 1 : page);
}

export function pdfSpreadStarts(pageCount: number, parity: PdfSpreadParity): number[] {
  const starts: number[] = [];
  if (parity === 'even') {
    starts.push(1);
    for (let page = 2; page <= pageCount; page += 2) starts.push(page);
  } else {
    for (let page = 1; page <= pageCount; page += 2) starts.push(page);
  }
  return starts;
}

export function pdfSpreadPageNumbers(
  page: number,
  pageCount: number,
  parity: PdfSpreadParity,
): number[] {
  const start = pdfSpreadStart(page, parity);
  if (parity === 'even' && start === 1) return [1];
  return [start, start + 1].filter(pageNumber => pageNumber <= pageCount);
}

export function pdfNavigationTarget(
  currentPage: number,
  direction: PdfNavigationDirection,
  pageCount: number,
  twoPageView: boolean,
  parity: PdfSpreadParity,
): number | undefined {
  if (!twoPageView) {
    const target = currentPage + direction;
    return target >= 1 && target <= pageCount ? target : undefined;
  }

  const starts = pdfSpreadStarts(pageCount, parity);
  const currentStart = pdfSpreadStart(currentPage, parity);
  const currentIndex = starts.indexOf(currentStart);
  const targetStart = starts[currentIndex + direction];
  if (targetStart === undefined) return undefined;
  if (targetStart === 1) return 1;
  // Preview advances facing-page mode by one spread and makes the
  // right-hand page current (1 → 3 → 5 …).
  return Math.min(targetStart + 1, pageCount);
}

export function spreadGridPosition(
  page: number,
  parity: PdfSpreadParity,
): { row: number; column: number } {
  if (parity === 'even') {
    if (page <= 1) return { row: 1, column: 2 };
    return {
      row: Math.floor(page / 2) + 1,
      column: page % 2 === 0 ? 1 : 2,
    };
  }
  return {
    row: Math.floor((Math.max(1, page) - 1) / 2) + 1,
    column: page % 2 === 0 ? 2 : 1,
  };
}

export function canScrollPdfViewport(
  axis: PdfViewportAxis,
  direction: PdfNavigationDirection,
  viewport: PdfViewportMetrics,
  epsilon = PDF_VIEWPORT_BOUNDARY_EPSILON_PX,
): boolean {
  // PDF dimensions and zoom factors frequently land on fractional CSS pixels.
  // A tiny remainder is the page boundary, not another meaningful pan step.
  if (axis === 'horizontal') {
    return direction < 0
      ? viewport.scrollLeft > epsilon
      : viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - epsilon;
  }
  return direction < 0
    ? viewport.scrollTop > epsilon
    : viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - epsilon;
}

export function capturePdfViewportProgress(viewport: PdfViewportMetrics): PdfViewportProgress {
  const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  return {
    // A fitted axis is visually centered. Treat it as the midpoint so a
    // differently sized destination page remains centered on that axis.
    x: maxScrollLeft > 0 ? clamp(viewport.scrollLeft / maxScrollLeft, 0, 1) : 0.5,
    y: maxScrollTop > 0 ? clamp(viewport.scrollTop / maxScrollTop, 0, 1) : 0.5,
  };
}

export function restorePdfViewportProgress(
  progress: PdfViewportProgress,
  viewport: Pick<PdfViewportMetrics, 'scrollWidth' | 'scrollHeight' | 'clientWidth' | 'clientHeight'>,
  override: Partial<PdfViewportProgress> = {},
): PdfViewportScrollPosition {
  const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  return {
    left: clamp((override.x ?? progress.x) * maxScrollLeft, 0, maxScrollLeft),
    top: clamp((override.y ?? progress.y) * maxScrollTop, 0, maxScrollTop),
  };
}

export function pdfInternalDestination(
  annotation: PdfLinkAnnoObject,
): PdfDestinationObject | undefined {
  const target = annotation.target;
  if (target?.type === 'destination') return target.destination;
  if (target?.type === 'action' && target.action.type === PdfActionType.Goto) {
    return target.action.destination;
  }
  return undefined;
}

export function normalizePdfAnnotationRect(
  value: unknown,
  pageSize: { width: number; height: number },
): PdfAnnotationRect | undefined {
  const rect = value as any;
  const x1 = Number(rect?.origin?.x);
  const y1 = Number(rect?.origin?.y);
  const x2 = x1 + Number(rect?.size?.width);
  const y2 = y1 + Number(rect?.size?.height);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return undefined;
  const left = clamp(Math.min(x1, x2), 0, Number(pageSize.width));
  const top = clamp(Math.min(y1, y2), 0, Number(pageSize.height));
  const right = clamp(Math.max(x1, x2), 0, Number(pageSize.width));
  const bottom = clamp(Math.max(y1, y2), 0, Number(pageSize.height));
  if (right - left < 1 || bottom - top < 1) return undefined;
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Keeps a PDF link's original horizontal hit area while snapping its vertical
 * bounds to the text runs it actually covers. PDF producers commonly pad link
 * annotation rectangles above and below a line; that padding becomes visibly
 * detached from the selectable text layer at high zoom.
 */
export function alignPdfLinkRectToTextLayer(
  link: PdfAnnotationRect,
  textRects: readonly PdfAnnotationRect[],
): PdfAnnotationRect {
  const linkRight = link.left + link.width;
  const linkBottom = link.top + link.height;
  if (
    ![link.left, link.top, linkRight, linkBottom].every(Number.isFinite)
    || link.width <= 0
    || link.height <= 0
  ) {
    return link;
  }

  const matching = textRects.filter(text => {
    const textRight = text.left + text.width;
    const textBottom = text.top + text.height;
    if (
      ![text.left, text.top, textRight, textBottom].every(Number.isFinite)
      || text.width <= 0
      || text.height <= 0
    ) {
      return false;
    }
    const horizontalOverlap = Math.min(linkRight, textRight) - Math.max(link.left, text.left);
    const verticalOverlap = Math.min(linkBottom, textBottom) - Math.max(link.top, text.top);
    return horizontalOverlap > 0
      && verticalOverlap >= Math.min(link.height, text.height) / 2;
  });
  if (!matching.length) return link;

  const top = Math.min(...matching.map(text => text.top));
  const bottom = Math.max(...matching.map(text => text.top + text.height));
  return {
    ...link,
    top,
    height: bottom - top,
  };
}

/**
 * Aligns every link on a page with the text layer as one coordinated batch.
 *
 * Some PDF producers use a non-zero MediaBox/CropBox origin. EmbedPDF 2.14
 * currently exposes link annotations in that global page coordinate space
 * while exposing text runs in crop-local coordinates. Aligning each annotation
 * independently is unsafe: a uniformly shifted link can overlap a neighboring
 * row and inherit that row's visible position while retaining its own target.
 *
 * This routine finds the common vertical translation supported by the largest
 * monotonic one-to-one link/line assignment. Once that page-level calibration
 * is confident, each link is moved with the common translation and snapped to
 * its assigned text line. Weak or ambiguous evidence leaves the input intact.
 */
export function alignPdfLinkRectsToTextLayer(
  links: readonly PdfAnnotationRect[],
  textRects: readonly PdfAnnotationRect[],
  pageSize?: { width: number; height: number },
): PdfAnnotationRect[] {
  if (links.length === 0) return [];
  if (links.length === 1) {
    return [alignSinglePdfLinkRectToTextLayer(links[0]!, textRects, pageSize)];
  }

  const validLinks = links
    .map((rect, index) => ({ index, rect }))
    .filter(candidate => validPdfAnnotationRect(candidate.rect));
  const pageBoxCorrection = pageSize
    ? pdfPageBoxOriginCorrection(validLinks, textRects, pageSize)
    : undefined;
  if (pageBoxCorrection && pageSize) {
    const correctedPageSize = pageSize;
    return links.map(link => {
      if (!validPdfAnnotationRect(link)) return { ...link };
      const translated = {
        ...link,
        left: link.left + pageBoxCorrection.x,
        top: link.top + pageBoxCorrection.y,
      };
      return clampPdfAnnotationRect(
        alignPdfLinkRectToTextLayer(translated, textRects),
        correctedPageSize,
      );
    });
  }

  const lines = pdfTextLines(textRects);
  if (validLinks.length < 2 || lines.length < 2) {
    return links.map(link => alignPdfLinkRectToTextLayer(link, textRects));
  }

  const calibration = pdfLinkLineCalibration(validLinks, lines, pageSize);
  if (!calibration) {
    return links.map(link => alignPdfLinkRectToTextLayer(link, textRects));
  }

  const horizontalOffset = pdfLinkHorizontalOffset(
    calibration.matches,
    validLinks,
    lines,
    calibration.offset,
  );
  const matchByLinkIndex = new Map(
    calibration.matches.map(match => [validLinks[match.linkIndex]!.index, match]),
  );

  return links.map((link, index) => {
    if (!validPdfAnnotationRect(link)) return { ...link };
    const match = matchByLinkIndex.get(index);
    const translated = {
      ...link,
      left: link.left + horizontalOffset,
      top: link.top + calibration.offset,
    };
    const aligned = match
      ? {
        ...translated,
        top: lines[match.lineIndex]!.rect.top,
        height: lines[match.lineIndex]!.rect.height,
      }
      : translated;
    return pageSize ? clampPdfAnnotationRect(aligned, pageSize) : aligned;
  });
}

/**
 * Restricts a calibrated PDF annotation to the text glyphs it actually covers.
 *
 * Link annotations often span the whitespace between a contents label and its
 * page number, or retain generous horizontal padding around a body reference.
 * A single rectangular button would make that blank space look and behave like
 * a link. Returning separate visual fragments keeps the annotation accessible
 * as one control while limiting pointer hit-testing to visible text.
 */
export function pdfLinkHitRects(
  link: PdfAnnotationRect,
  glyphRects: readonly PdfAnnotationRect[],
): PdfAnnotationRect[] {
  if (!validPdfAnnotationRect(link)) return [{ ...link }];

  const linkRight = link.left + link.width;
  const linkBottom = link.top + link.height;
  const clipped = glyphRects
    .filter(validPdfAnnotationRect)
    .flatMap(glyph => {
      const left = Math.max(link.left, glyph.left);
      const top = Math.max(link.top, glyph.top);
      const right = Math.min(linkRight, glyph.left + glyph.width);
      const bottom = Math.min(linkBottom, glyph.top + glyph.height);
      const width = right - left;
      const height = bottom - top;
      const minimumVerticalOverlap = Math.min(link.height, glyph.height) * 0.2;
      const minimumHorizontalOverlap = Math.min(link.width, glyph.width) * 0.25;
      if (
        width < minimumHorizontalOverlap
        || height < minimumVerticalOverlap
      ) {
        return [];
      }

      // PDF annotations are frequently shorter than the glyph boxes they
      // label (sometimes covering only an underline-height strip). Promote
      // the vertical hit area to the visible glyph, but keep the horizontal
      // bounds clipped to the annotation so adjacent ordinary text cannot
      // become part of the link.
      return [{
        left,
        top: glyph.top,
        width,
        height: glyph.height,
      }];
    })
    .sort((left, right) => (
      left.top - right.top
      || left.left - right.left
      || left.height - right.height
    ));
  if (!clipped.length) return [{ ...link }];

  const merged: PdfAnnotationRect[] = [];
  for (const rect of clipped) {
    const rectBottom = rect.top + rect.height;
    const rectCenter = rect.top + rect.height / 2;
    let match: PdfAnnotationRect | undefined;

    for (let index = merged.length - 1; index >= 0; index--) {
      const candidate = merged[index]!;
      const candidateBottom = candidate.top + candidate.height;
      if (rect.top - candidateBottom > Math.max(rect.height, candidate.height)) break;

      const verticalOverlap = Math.min(rectBottom, candidateBottom)
        - Math.max(rect.top, candidate.top);
      const centerDistance = Math.abs(
        rectCenter - (candidate.top + candidate.height / 2),
      );
      const sameLine = verticalOverlap >= Math.min(rect.height, candidate.height) * 0.35
        || centerDistance <= Math.max(1, Math.min(rect.height, candidate.height) * 0.55);
      const horizontalGap = Math.max(
        0,
        Math.max(rect.left, candidate.left)
          - Math.min(rect.left + rect.width, candidate.left + candidate.width),
      );
      const mergeGap = Math.max(1, Math.min(rect.height, candidate.height) * 0.45);
      if (sameLine && horizontalGap <= mergeGap) {
        match = candidate;
        break;
      }
    }

    if (!match) {
      merged.push({ ...rect });
      continue;
    }

    const left = Math.min(match.left, rect.left);
    const top = Math.min(match.top, rect.top);
    const right = Math.max(match.left + match.width, rect.left + rect.width);
    const bottom = Math.max(match.top + match.height, rectBottom);
    match.left = left;
    match.top = top;
    match.width = right - left;
    match.height = bottom - top;
  }

  return merged;
}

/**
 * Corrects a lone link when a non-zero page-box origin displaced it away from
 * its text. With only one annotation there is no page-level sequence to
 * calibrate, so require a unique text run with near-identical dimensions and
 * the opposing, near-equal X/Y shift produced by a shared CropBox origin.
 */
function alignSinglePdfLinkRectToTextLayer(
  link: PdfAnnotationRect,
  textRects: readonly PdfAnnotationRect[],
  pageSize?: { width: number; height: number },
): PdfAnnotationRect {
  if (!pageSize || !validPdfAnnotationRect(link)) {
    return alignPdfLinkRectToTextLayer(link, textRects);
  }

  const pageExtent = Math.max(Number(pageSize.width), Number(pageSize.height));
  const maxShift = Number.isFinite(pageExtent) ? pageExtent * 0.4 : 256;
  const widthTolerance = Math.max(1.5, link.width * 0.05);
  const heightTolerance = Math.max(1.5, link.height * 0.18);
  const candidates = textRects
    .filter(validPdfAnnotationRect)
    .flatMap(text => {
      const widthDelta = Math.abs(text.width - link.width);
      const heightDelta = Math.abs(text.height - link.height);
      if (widthDelta > widthTolerance || heightDelta > heightTolerance) return [];

      const dx = text.left - link.left;
      const dy = text.top - link.top;
      const shiftMagnitude = Math.max(Math.abs(dx), Math.abs(dy));
      const axisDifference = Math.abs(Math.abs(dx) - Math.abs(dy));
      if (
        shiftMagnitude < 4
        || shiftMagnitude > maxShift
        || dx * dy >= 0
        || axisDifference > Math.max(2, shiftMagnitude * 0.12)
      ) {
        return [];
      }

      const horizontalOverlap = Math.min(
        link.left + link.width,
        text.left + text.width,
      ) - Math.max(link.left, text.left);
      if (horizontalOverlap < Math.min(link.width, text.width) * 0.2) return [];

      return [{
        rect: text,
        score: widthDelta + heightDelta + axisDifference,
      }];
    })
    .sort((left, right) => left.score - right.score);
  const best = candidates[0];
  if (!best || best.score > 4) {
    return alignPdfLinkRectToTextLayer(link, textRects);
  }
  const runnerUp = candidates[1];
  if (runnerUp && runnerUp.score <= best.score + 1.5) {
    return alignPdfLinkRectToTextLayer(link, textRects);
  }

  return clampPdfAnnotationRect({
    ...link,
    left: best.rect.left,
    top: best.rect.top,
    height: best.rect.height,
  }, pageSize);
}

export function pdfDestinationViewerTarget(
  destination: PdfDestinationObject,
  page: { size: { width: number; height: number }; rotation?: number },
  normalizedRotation: boolean,
): PdfDestinationViewerTarget {
  const width = Math.max(1, Number(page.size.width));
  const height = Math.max(1, Number(page.size.height));
  const view = Array.isArray(destination.view) ? destination.view.map(Number) : [];
  const rotation = normalizedRotation ? 0 : (Number(page.rotation ?? 0) & 3);
  let pageX = 0;
  let pageY = height;
  let hasHorizontalTarget = false;

  switch (destination.zoom.mode) {
    case PdfZoomMode.XYZ:
      if (Number.isFinite(destination.zoom.params.x)) {
        pageX = destination.zoom.params.x;
        hasHorizontalTarget = true;
      }
      if (Number.isFinite(destination.zoom.params.y)) {
        pageY = destination.zoom.params.y;
      }
      break;
    case PdfZoomMode.FitHorizontal:
    case PdfZoomMode.FitBoundingBoxHorizontal:
      if (view.length >= 1 && Number.isFinite(view[0])) pageY = view[0]!;
      hasHorizontalTarget = rotation === 1 || rotation === 3;
      break;
    case PdfZoomMode.FitVertical:
    case PdfZoomMode.FitBoundingBoxVertical:
      if (view.length >= 1 && Number.isFinite(view[0])) pageX = view[0]!;
      hasHorizontalTarget = true;
      break;
    case PdfZoomMode.FitRectangle:
      if (view.length >= 4 && view.slice(0, 4).every(Number.isFinite)) {
        pageX = view[0]!;
        pageY = view[3]!;
        hasHorizontalTarget = true;
      }
      break;
    default:
      break;
  }

  let point: { x: number; y: number };
  switch (rotation) {
    case 1:
      point = { x: pageY, y: pageX };
      break;
    case 2:
      point = { x: width - pageX, y: pageY };
      break;
    case 3:
      point = { x: width - pageY, y: height - pageX };
      break;
    default:
      point = { x: pageX, y: height - pageY };
      break;
  }
  return {
    x: clamp(point.x, 0, width),
    y: clamp(point.y, 0, height),
    alignX: hasHorizontalTarget,
  };
}

interface IndexedPdfAnnotationRect {
  index: number;
  rect: PdfAnnotationRect;
}

interface PdfTextLine {
  rect: PdfAnnotationRect;
}

interface PdfLinkLineMatch {
  linkIndex: number;
  lineIndex: number;
  distance: number;
}

interface PdfLinkLineCalibration {
  offset: number;
  matches: PdfLinkLineMatch[];
  totalDistance: number;
}

interface PdfPageBoxCorrection {
  x: number;
  y: number;
}

interface PdfPageBoxShiftEvidence {
  linkIndex: number;
  x: number;
  y: number;
  score: number;
}

function validPdfAnnotationRect(rect: PdfAnnotationRect): boolean {
  return [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0
    && rect.height > 0;
}

/**
 * Detects the opposing X/Y translation produced when link annotations retain
 * a non-zero page-box origin but text runs are crop-local.
 *
 * Vertical-only line matching can be ambiguous on dense body pages: the raw
 * annotation row may coincide with unrelated prose while the intended label
 * sits one CropBox-origin below it. A genuine page-box correction also moves
 * X by the same magnitude in the opposite direction, and multiple annotation
 * rectangles retain the dimensions of their intended text runs. Requiring
 * that shared two-dimensional evidence keeps ordinary padded annotations
 * unchanged while resolving narrow links that have little or no overlap with
 * their visible labels before correction.
 */
function pdfPageBoxOriginCorrection(
  links: readonly IndexedPdfAnnotationRect[],
  textRects: readonly PdfAnnotationRect[],
  pageSize: { width: number; height: number },
): PdfPageBoxCorrection | undefined {
  if (links.length < 2) return undefined;
  const texts = textRects.filter(validPdfAnnotationRect);
  if (texts.length < 2) return undefined;

  const pageExtent = Math.max(Number(pageSize.width), Number(pageSize.height));
  const maxShift = Number.isFinite(pageExtent) ? pageExtent * 0.4 : 256;
  const typicalHeight = median([
    ...links.map(link => link.rect.height),
    ...texts.map(text => text.height),
  ]);
  const clusterTolerance = Math.max(1.5, typicalHeight * 0.18);
  const evidence: PdfPageBoxShiftEvidence[] = [];
  const zeroEvidenceByLink = new Map<number, number>();

  for (const link of links) {
    const widthTolerance = Math.max(2, link.rect.width * 0.12);
    const heightTolerance = Math.max(1.5, link.rect.height * 0.22);
    for (const text of texts) {
      const widthDelta = Math.abs(text.width - link.rect.width);
      const heightDelta = Math.abs(text.height - link.rect.height);
      if (widthDelta > widthTolerance || heightDelta > heightTolerance) continue;

      const x = text.left - link.rect.left;
      const y = text.top - link.rect.top;
      if (Math.abs(x) <= clusterTolerance && Math.abs(y) <= clusterTolerance) {
        const score = widthDelta + heightDelta + Math.abs(x) + Math.abs(y);
        const previous = zeroEvidenceByLink.get(link.index);
        if (previous === undefined || score < previous) {
          zeroEvidenceByLink.set(link.index, score);
        }
        continue;
      }
      const magnitude = Math.max(Math.abs(x), Math.abs(y));
      const axisDifference = Math.abs(Math.abs(x) - Math.abs(y));
      if (
        magnitude < 4
        || magnitude > maxShift
        || x * y >= 0
        || axisDifference > Math.max(2, magnitude * 0.12)
      ) {
        continue;
      }

      evidence.push({
        linkIndex: link.index,
        x,
        y,
        score: widthDelta + heightDelta + axisDifference,
      });
    }
  }
  if (!evidence.length) return undefined;

  const candidates = evidence.map(seed => {
    const cluster = evidence.filter(candidate => (
      Math.abs(candidate.x - seed.x) <= clusterTolerance
      && Math.abs(candidate.y - seed.y) <= clusterTolerance
    ));
    const bestByLink = new Map<number, PdfPageBoxShiftEvidence>();
    for (const candidate of cluster) {
      const previous = bestByLink.get(candidate.linkIndex);
      if (!previous || candidate.score < previous.score) {
        bestByLink.set(candidate.linkIndex, candidate);
      }
    }
    const matches = [...bestByLink.values()];
    return {
      x: median(matches.map(match => match.x)),
      y: median(matches.map(match => match.y)),
      support: matches.length,
      score: matches.reduce((sum, match) => sum + match.score, 0),
    };
  }).sort((left, right) => (
    right.support - left.support
    || left.score - right.score
    || Math.abs(Math.abs(left.x) - Math.abs(left.y))
      - Math.abs(Math.abs(right.x) - Math.abs(right.y))
  ));

  const best = candidates[0];
  const requiredSupport = Math.max(2, Math.ceil(links.length * 0.45));
  if (!best || best.support < requiredSupport) return undefined;

  const zeroSupport = zeroEvidenceByLink.size;
  const zeroScore = [...zeroEvidenceByLink.values()]
    .reduce((sum, score) => sum + score, 0);
  if (
    zeroSupport >= best.support
    && zeroScore <= best.score + clusterTolerance * best.support
  ) {
    return undefined;
  }

  const runnerUp = candidates.find(candidate => (
    Math.abs(candidate.x - best.x) > clusterTolerance
    || Math.abs(candidate.y - best.y) > clusterTolerance
  ));
  if (
    runnerUp
    && runnerUp.support === best.support
    && runnerUp.score <= best.score + clusterTolerance * best.support
  ) {
    return undefined;
  }
  return { x: best.x, y: best.y };
}

function pdfTextLines(textRects: readonly PdfAnnotationRect[]): PdfTextLine[] {
  const sorted = textRects
    .filter(validPdfAnnotationRect)
    .map(rect => ({ ...rect }))
    .sort((left, right) => left.top - right.top || left.left - right.left);
  const lines: PdfTextLine[] = [];

  for (const rect of sorted) {
    let bestLine: PdfTextLine | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index]!;
      if (rect.top - (line.rect.top + line.rect.height) > Math.max(rect.height, line.rect.height)) {
        break;
      }
      const overlap = Math.min(
        rect.top + rect.height,
        line.rect.top + line.rect.height,
      ) - Math.max(rect.top, line.rect.top);
      const centerDistance = Math.abs(
        rect.top + rect.height / 2 - (line.rect.top + line.rect.height / 2),
      );
      if (
        overlap < Math.min(rect.height, line.rect.height) / 2
        || centerDistance >= bestDistance
      ) {
        continue;
      }
      bestLine = line;
      bestDistance = centerDistance;
    }

    if (!bestLine) {
      lines.push({ rect: { ...rect } });
      continue;
    }

    const left = Math.min(bestLine.rect.left, rect.left);
    const top = Math.min(bestLine.rect.top, rect.top);
    const right = Math.max(
      bestLine.rect.left + bestLine.rect.width,
      rect.left + rect.width,
    );
    const bottom = Math.max(
      bestLine.rect.top + bestLine.rect.height,
      rect.top + rect.height,
    );
    bestLine.rect = {
      left,
      top,
      width: right - left,
      height: bottom - top,
    };
  }

  return lines.sort((left, right) => (
    left.rect.top - right.rect.top || left.rect.left - right.rect.left
  ));
}

function pdfLinkLineCalibration(
  links: readonly IndexedPdfAnnotationRect[],
  lines: readonly PdfTextLine[],
  pageSize?: { width: number; height: number },
): PdfLinkLineCalibration | undefined {
  const typicalHeight = median([
    ...links.map(link => link.rect.height),
    ...lines.map(line => line.rect.height),
  ]);
  const clusterTolerance = Math.max(2, typicalHeight * 0.25);
  const maxShift = pageSize
    ? Math.max(Number(pageSize.width), Number(pageSize.height)) * 0.4
    : 256;
  const samples: number[] = [];

  for (const link of links) {
    for (const line of lines) {
      if (
        !pdfLinkLineHeightsCompatible(link.rect, line.rect)
        || !pdfLinkLineHorizontallyCompatible(link.rect, line.rect)
      ) {
        continue;
      }
      const offset = pdfRectCenterY(line.rect) - pdfRectCenterY(link.rect);
      if (Math.abs(offset) <= maxShift) samples.push(offset);
    }
  }
  if (!samples.length) return undefined;

  samples.sort((left, right) => left - right);
  const windows: Array<{ offset: number; count: number }> = [];
  let start = 0;
  for (let end = 0; end < samples.length; end++) {
    while (samples[end]! - samples[start]! > clusterTolerance * 2) start++;
    const values = samples.slice(start, end + 1);
    windows.push({
      offset: median(values),
      count: values.length,
    });
  }
  windows.push({ offset: 0, count: 0 });
  windows.sort((left, right) => right.count - left.count || Math.abs(left.offset) - Math.abs(right.offset));

  const offsets: number[] = [];
  for (const window of windows) {
    if (offsets.some(offset => Math.abs(offset - window.offset) <= clusterTolerance)) continue;
    offsets.push(window.offset);
    if (offsets.length >= 16) break;
  }

  const candidates = offsets.map(offset => (
    pdfLinkLineMatches(links, lines, offset, clusterTolerance)
  )).sort((left, right) => (
    right.matches.length - left.matches.length
    || left.totalDistance - right.totalDistance
    || Math.abs(left.offset) - Math.abs(right.offset)
  ));
  const best = candidates[0];
  if (!best) return undefined;

  const requiredMatches = Math.max(
    2,
    Math.ceil(Math.min(links.length, lines.length) * 0.45),
  );
  if (best.matches.length < requiredMatches) return undefined;

  const runnerUp = candidates.find(candidate => (
    Math.abs(candidate.offset - best.offset) > clusterTolerance
  ));
  if (
    runnerUp
    && runnerUp.matches.length === best.matches.length
    && runnerUp.totalDistance <= best.totalDistance + clusterTolerance
  ) {
    return undefined;
  }
  return best;
}

function pdfLinkLineMatches(
  links: readonly IndexedPdfAnnotationRect[],
  lines: readonly PdfTextLine[],
  offset: number,
  baseTolerance: number,
): PdfLinkLineCalibration {
  const orderedLinks = links
    .map((link, linkIndex) => ({ link, linkIndex }))
    .sort((left, right) => (
      pdfRectCenterY(left.link.rect) - pdfRectCenterY(right.link.rect)
      || left.link.rect.left - right.link.rect.left
    ));
  const matches: PdfLinkLineMatch[] = [];
  let previousLineIndex = -1;

  for (const { link, linkIndex } of orderedLinks) {
    let bestLineIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let lineIndex = previousLineIndex + 1; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]!;
      if (
        !pdfLinkLineHeightsCompatible(link.rect, line.rect)
        || !pdfLinkLineHorizontallyCompatible(link.rect, line.rect)
      ) {
        continue;
      }
      const distance = Math.abs(
        pdfRectCenterY(link.rect) + offset - pdfRectCenterY(line.rect),
      );
      const tolerance = Math.max(
        baseTolerance,
        Math.min(link.rect.height, line.rect.height) * 0.35,
      );
      if (distance > tolerance || distance >= bestDistance) continue;
      bestLineIndex = lineIndex;
      bestDistance = distance;
    }
    if (bestLineIndex < 0) continue;
    matches.push({ linkIndex, lineIndex: bestLineIndex, distance: bestDistance });
    previousLineIndex = bestLineIndex;
  }

  return {
    offset,
    matches,
    totalDistance: matches.reduce((sum, match) => sum + match.distance, 0),
  };
}

function pdfLinkHorizontalOffset(
  matches: readonly PdfLinkLineMatch[],
  links: readonly IndexedPdfAnnotationRect[],
  lines: readonly PdfTextLine[],
  verticalOffset: number,
): number {
  if (Math.abs(verticalOffset) < 4) return 0;
  let lowerBound = Number.NEGATIVE_INFINITY;
  let upperBound = Number.POSITIVE_INFINITY;
  const centerOffsets: number[] = [];

  for (const match of matches) {
    const link = links[match.linkIndex]!.rect;
    const line = lines[match.lineIndex]!.rect;
    centerOffsets.push(
      line.left + line.width / 2 - (link.left + link.width / 2),
    );
    if (link.width + 1 < line.width) continue;
    lowerBound = Math.max(
      lowerBound,
      line.left + line.width - (link.left + link.width),
    );
    upperBound = Math.min(upperBound, line.left - link.left);
  }

  const preferred = -verticalOffset;
  if (
    Number.isFinite(lowerBound)
    && Number.isFinite(upperBound)
    && lowerBound <= upperBound
  ) {
    return clamp(preferred, lowerBound, upperBound);
  }
  return centerOffsets.length ? median(centerOffsets) : 0;
}

function pdfLinkLineHeightsCompatible(
  link: PdfAnnotationRect,
  line: PdfAnnotationRect,
): boolean {
  const smaller = Math.min(link.height, line.height);
  const larger = Math.max(link.height, line.height);
  return smaller > 0 && larger / smaller <= 2.75;
}

function pdfLinkLineHorizontallyCompatible(
  link: PdfAnnotationRect,
  line: PdfAnnotationRect,
): boolean {
  const overlap = Math.min(
    link.left + link.width,
    line.left + line.width,
  ) - Math.max(link.left, line.left);
  return overlap > 0
    && overlap >= Math.min(link.width, line.width) * 0.2;
}

function pdfRectCenterY(rect: PdfAnnotationRect): number {
  return rect.top + rect.height / 2;
}

function clampPdfAnnotationRect(
  rect: PdfAnnotationRect,
  pageSize: { width: number; height: number },
): PdfAnnotationRect {
  const pageWidth = Math.max(0, Number(pageSize.width));
  const pageHeight = Math.max(0, Number(pageSize.height));
  const left = clamp(rect.left, 0, pageWidth);
  const top = clamp(rect.top, 0, pageHeight);
  const right = clamp(rect.left + rect.width, left, pageWidth);
  const bottom = clamp(rect.top + rect.height, top, pageHeight);
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
