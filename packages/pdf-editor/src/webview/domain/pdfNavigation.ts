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
      if (view.length >= 1 && Number.isFinite(destination.zoom.params.x)) {
        pageX = destination.zoom.params.x;
        hasHorizontalTarget = true;
      }
      if (view.length >= 2 && Number.isFinite(destination.zoom.params.y)) {
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
