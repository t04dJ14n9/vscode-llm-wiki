import type { PdfRect } from './pdfTextBands';

export interface PdfAreaCssRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PdfAreaPageBounds extends PdfAreaCssRect {
  page: number;
}

export interface PdfAreaPageSelection {
  page: number;
  rects: PdfRect[];
}

export interface PdfAreaPageSurface {
  page: number;
  wrapper: HTMLElement;
  pdfWidth: number;
  pdfHeight: number;
}

export function pdfAreaPageIntersections(
  marquee: PdfAreaCssRect,
  pages: readonly PdfAreaPageBounds[],
): Array<{ page: number; rect: PdfRect }> {
  const normalized = normalizeCssRect(marquee);
  return pages
    .map(bounds => {
      const pageBounds = normalizeCssRect(bounds);
      const left = Math.max(normalized.left, pageBounds.left);
      const top = Math.max(normalized.top, pageBounds.top);
      const right = Math.min(normalized.right, pageBounds.right);
      const bottom = Math.min(normalized.bottom, pageBounds.bottom);
      return right > left && bottom > top
        ? {
            page: bounds.page,
            rect: [
              left - pageBounds.left,
              top - pageBounds.top,
              right - pageBounds.left,
              bottom - pageBounds.top,
            ] as PdfRect,
          }
        : undefined;
    })
    .filter((value): value is { page: number; rect: PdfRect } => Boolean(value))
    .sort((left, right) => left.page - right.page);
}

export function mergePdfAreaPageSelections(
  existing: readonly PdfAreaPageSelection[],
  added: readonly PdfAreaPageSelection[],
): PdfAreaPageSelection[] {
  const byPage = new Map<number, PdfRect[]>();
  for (const selection of [...existing, ...added]) {
    const rects = byPage.get(selection.page) ?? [];
    rects.push(...selection.rects.map(rect => [...rect] as PdfRect));
    byPage.set(selection.page, rects);
  }
  return [...byPage.entries()]
    .sort(([left], [right]) => left - right)
    .map(([page, rects]) => ({ page, rects: mergeTouchingRects(rects) }));
}

export function drawPdfAreaDragOverlays(
  drag: PdfAreaDrag,
  container: HTMLElement,
  surfaces: readonly PdfAreaPageSurface[],
): void {
  for (const overlay of drag.overlays) overlay.remove();
  drag.overlays = [];
  const byPage = new Map(surfaces.map(surface => [surface.page, surface]));
  for (const { page, rect } of pdfAreaPageIntersections(
    pdfAreaDragMarquee(drag),
    pdfAreaPageBoundsForSurfaces(container, surfaces),
  )) {
    if (!validCssSelectionRect(rect)) continue;
    const wrapper = byPage.get(page)?.wrapper;
    if (!wrapper) continue;
    const overlay = document.createElement('div');
    overlay.className = 'rectangle-selection-overlay';
    overlay.style.left = `${rect[0]}px`;
    overlay.style.top = `${rect[1]}px`;
    overlay.style.width = `${rect[2] - rect[0]}px`;
    overlay.style.height = `${rect[3] - rect[1]}px`;
    wrapper.appendChild(overlay);
    drag.overlays.push(overlay);
  }
}

export function pdfAreaSelectionsForMarquee(
  marquee: PdfAreaCssRect,
  container: HTMLElement,
  surfaces: readonly PdfAreaPageSurface[],
): PdfAreaPageSelection[] {
  const byPage = new Map(surfaces.map(surface => [surface.page, surface]));
  const output: PdfAreaPageSelection[] = [];
  for (const { page, rect } of pdfAreaPageIntersections(
    marquee,
    pdfAreaPageBoundsForSurfaces(container, surfaces),
  )) {
    if (!validCssSelectionRect(rect)) continue;
    const surface = byPage.get(page);
    const bounds = surface?.wrapper.getBoundingClientRect();
    if (!surface || !bounds || bounds.width <= 0 || bounds.height <= 0) continue;
    const scaleX = surface.pdfWidth / bounds.width;
    const scaleY = surface.pdfHeight / bounds.height;
    output.push({
      page,
      rects: [[
        roundCoordinate(rect[0] * scaleX),
        roundCoordinate(rect[1] * scaleY),
        roundCoordinate(rect[2] * scaleX),
        roundCoordinate(rect[3] * scaleY),
      ]],
    });
  }
  return output;
}

function pdfAreaPageBoundsForSurfaces(
  container: HTMLElement,
  surfaces: readonly PdfAreaPageSurface[],
): PdfAreaPageBounds[] {
  const containerBounds = container.getBoundingClientRect();
  return surfaces.flatMap(surface => {
    if (surface.wrapper.style.display === 'none') return [];
    const bounds = surface.wrapper.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0
      ? [{
          page: surface.page,
          left: bounds.left - containerBounds.left,
          top: bounds.top - containerBounds.top,
          right: bounds.right - containerBounds.left,
          bottom: bounds.bottom - containerBounds.top,
        }]
      : [];
  });
}

function validCssSelectionRect(rect: PdfRect): boolean {
  return rect[2] - rect[0] >= 4 && rect[3] - rect[1] >= 4;
}

function mergeTouchingRects(rects: PdfRect[]): PdfRect[] {
  const pending = rects.map(rect => [...rect] as PdfRect);
  const merged: PdfRect[] = [];
  while (pending.length) {
    let current = pending.shift()!;
    for (let index = pending.length - 1; index >= 0; index--) {
      const candidate = pending[index]!;
      if (!rectsTouch(current, candidate)) continue;
      current = [
        Math.min(current[0], candidate[0]),
        Math.min(current[1], candidate[1]),
        Math.max(current[2], candidate[2]),
        Math.max(current[3], candidate[3]),
      ];
      pending.splice(index, 1);
      index = pending.length;
    }
    merged.push(current);
  }
  return merged.sort((left, right) => (
    left[1] - right[1]
    || left[0] - right[0]
    || left[3] - right[3]
    || left[2] - right[2]
  ));
}

function rectsTouch(left: PdfRect, right: PdfRect): boolean {
  return left[0] <= right[2]
    && left[2] >= right[0]
    && left[1] <= right[3]
    && left[3] >= right[1];
}

function normalizeCssRect(rect: PdfAreaCssRect): PdfAreaCssRect {
  return {
    left: Math.min(rect.left, rect.right),
    top: Math.min(rect.top, rect.bottom),
    right: Math.max(rect.left, rect.right),
    bottom: Math.max(rect.top, rect.bottom),
  };
}

export interface PdfAreaDrag {
  pointerId: number;
  captureTarget: HTMLElement;
  startContainerX: number;
  startContainerY: number;
  currentContainerX: number;
  currentContainerY: number;
  clientX: number;
  clientY: number;
  additive: boolean;
  overlays: HTMLDivElement[];
}

export function beginPdfAreaDrag(
  event: PointerEvent,
  captureTarget: HTMLElement,
  container: HTMLElement,
  additive: boolean,
): PdfAreaDrag {
  const point = pdfAreaContainerPoint(container, event.clientX, event.clientY);
  captureTarget.setPointerCapture?.(event.pointerId);
  return {
    pointerId: event.pointerId,
    captureTarget,
    startContainerX: point.x,
    startContainerY: point.y,
    currentContainerX: point.x,
    currentContainerY: point.y,
    clientX: event.clientX,
    clientY: event.clientY,
    additive,
    overlays: [],
  };
}

export function updatePdfAreaDrag(
  drag: PdfAreaDrag,
  event: PointerEvent,
  container: HTMLElement,
): void {
  updatePdfAreaDragPoint(drag, event.clientX, event.clientY, container);
}

export function updatePdfAreaDragPoint(
  drag: PdfAreaDrag,
  clientX: number,
  clientY: number,
  container: HTMLElement,
): void {
  const point = pdfAreaContainerPoint(container, clientX, clientY);
  drag.currentContainerX = point.x;
  drag.currentContainerY = point.y;
  drag.clientX = clientX;
  drag.clientY = clientY;
}

export function pdfAreaDragMarquee(drag: PdfAreaDrag): PdfAreaCssRect {
  return normalizeCssRect({
    left: drag.startContainerX,
    top: drag.startContainerY,
    right: drag.currentContainerX,
    bottom: drag.currentContainerY,
  });
}

export function finishPdfAreaDrag(
  drag: PdfAreaDrag,
  event: PointerEvent,
  container: HTMLElement,
): PdfAreaCssRect | undefined {
  updatePdfAreaDrag(drag, event, container);
  const marquee = pdfAreaDragMarquee(drag);
  releasePdfAreaDrag(drag);
  return marquee.right - marquee.left >= 4 && marquee.bottom - marquee.top >= 4
    ? marquee
    : undefined;
}

export function cancelPdfAreaDrag(drag: PdfAreaDrag | null): void {
  if (drag) releasePdfAreaDrag(drag);
}

function releasePdfAreaDrag(drag: PdfAreaDrag): void {
  for (const overlay of drag.overlays) overlay.remove();
  drag.overlays = [];
  drag.captureTarget.releasePointerCapture?.(drag.pointerId);
}

function pdfAreaContainerPoint(
  container: HTMLElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const bounds = container.getBoundingClientRect();
  return { x: clientX - bounds.left, y: clientY - bounds.top };
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000;
}
