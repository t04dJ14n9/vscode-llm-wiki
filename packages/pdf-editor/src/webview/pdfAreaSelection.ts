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
  page: number;
  wrapper: HTMLElement;
  overlay: HTMLDivElement;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export function beginPdfAreaDrag(
  event: PointerEvent,
  wrapper: HTMLElement,
  page: number,
): PdfAreaDrag {
  const bounds = wrapper.getBoundingClientRect();
  const startX = clamp(event.clientX - bounds.left, 0, bounds.width);
  const startY = clamp(event.clientY - bounds.top, 0, bounds.height);
  const overlay = document.createElement('div');
  overlay.className = 'rectangle-selection-overlay';
  overlay.style.left = `${startX}px`;
  overlay.style.top = `${startY}px`;
  overlay.style.width = '0px';
  overlay.style.height = '0px';
  wrapper.appendChild(overlay);
  wrapper.setPointerCapture?.(event.pointerId);
  return {
    pointerId: event.pointerId,
    page,
    wrapper,
    overlay,
    startX,
    startY,
    currentX: startX,
    currentY: startY,
  };
}

export function updatePdfAreaDrag(drag: PdfAreaDrag, event: PointerEvent): void {
  const bounds = drag.wrapper.getBoundingClientRect();
  drag.currentX = clamp(event.clientX - bounds.left, 0, bounds.width);
  drag.currentY = clamp(event.clientY - bounds.top, 0, bounds.height);
  const left = Math.min(drag.startX, drag.currentX);
  const top = Math.min(drag.startY, drag.currentY);
  drag.overlay.style.left = `${left}px`;
  drag.overlay.style.top = `${top}px`;
  drag.overlay.style.width = `${Math.abs(drag.currentX - drag.startX)}px`;
  drag.overlay.style.height = `${Math.abs(drag.currentY - drag.startY)}px`;
}

export function finishPdfAreaDrag(
  drag: PdfAreaDrag,
  event: PointerEvent,
  pageWidth: number,
  pageHeight: number,
): PdfRect | undefined {
  updatePdfAreaDrag(drag, event);
  drag.wrapper.releasePointerCapture?.(event.pointerId);
  const left = Math.min(drag.startX, drag.currentX);
  const top = Math.min(drag.startY, drag.currentY);
  const right = Math.max(drag.startX, drag.currentX);
  const bottom = Math.max(drag.startY, drag.currentY);
  drag.overlay.remove();
  if (right - left < 4 || bottom - top < 4) return undefined;
  const bounds = drag.wrapper.getBoundingClientRect();
  const scaleX = pageWidth / Math.max(1, bounds.width);
  const scaleY = pageHeight / Math.max(1, bounds.height);
  return [
    roundCoordinate(left * scaleX),
    roundCoordinate(top * scaleY),
    roundCoordinate(right * scaleX),
    roundCoordinate(bottom * scaleY),
  ];
}

export function cancelPdfAreaDrag(drag: PdfAreaDrag | null): void {
  drag?.overlay.remove();
  if (drag) drag.wrapper.releasePointerCapture?.(drag.pointerId);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000;
}
