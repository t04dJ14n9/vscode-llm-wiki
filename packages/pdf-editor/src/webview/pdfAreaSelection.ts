import type { PdfRect } from './pdfTextBands';

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
