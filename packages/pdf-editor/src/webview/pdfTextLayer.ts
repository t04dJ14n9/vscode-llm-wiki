import { pdfTextItemSelectionSeparator } from './domain/pdfSelection';
import { isPdfWordJoinMarker } from './domain/pdfTextExtraction';
import { formatCssPx } from './pdfLayout';

export interface PdfTextLayerItem {
  content: string;
  rect: {
    origin: { x: number; y: number };
    size: { width: number; height: number };
  };
  font?: {
    family?: string;
    size?: number;
    weight?: number;
    italic?: boolean;
  };
}

/**
 * Replaces a page's selectable text layer with spans aligned to its PDF text
 * geometry. Item indexes deliberately refer to the original array: anchors
 * and selection state use those indexes even when marker-only items are not
 * rendered.
 */
export function renderPdfTextLayer(
  layer: HTMLElement,
  items: PdfTextLayerItem[],
  scale: number,
): void {
  layer.innerHTML = '';
  items.forEach((item, itemIndex) => {
    if (isPdfWordJoinMarker(String(item.content ?? ''))) return;

    const span = document.createElement('span');
    span.dataset.itemIndex = String(itemIndex);
    span.dataset.contentLength = String(String(item.content ?? '').length);
    const left = item.rect.origin.x * scale;
    const top = item.rect.origin.y * scale;
    const width = item.rect.size.width * scale;
    const height = item.rect.size.height * scale;
    span.style.left = formatCssPx(left);
    span.style.top = formatCssPx(top);
    span.style.width = formatCssPx(width);
    span.style.height = formatCssPx(height);
    span.style.lineHeight = formatCssPx(height);

    const glyphs = document.createElement('span');
    glyphs.className = 'pdf-text-glyphs';
    glyphs.textContent = item.content;
    glyphs.style.left = '0px';
    glyphs.style.top = '0px';
    glyphs.style.width = 'max-content';
    glyphs.style.height = 'max-content';
    glyphs.style.lineHeight = formatCssPx(height);
    const declaredFontSize = Number(item.font?.size);
    glyphs.style.fontSize = formatCssPx(Math.max(
      1,
      (Number.isFinite(declaredFontSize) && declaredFontSize > 0 ? declaredFontSize : item.rect.size.height) * scale,
    ));
    const declaredFontFamily = typeof item.font?.family === 'string' ? item.font.family.trim() : '';
    if (declaredFontFamily) glyphs.style.fontFamily = declaredFontFamily;
    const declaredWeight = Number(item.font?.weight);
    if (Number.isFinite(declaredWeight) && declaredWeight >= 100 && declaredWeight <= 900) {
      glyphs.style.fontWeight = String(declaredWeight);
    }
    if (item.font?.italic === true) glyphs.style.fontStyle = 'italic';
    glyphs.style.transformOrigin = '0 0';

    // Alignment reads the rendered glyph bounds, so the node must be in the
    // live layer before alignPdfTextSpanToRect runs.
    span.appendChild(glyphs);
    layer.appendChild(span);
    alignPdfTextSpanToRect(span, glyphs, { left, top, width, height });

    if (pdfTextItemSelectionSeparator(items, itemIndex)) {
      const separator = document.createElement('span');
      separator.className = 'pdf-text-selection-separator';
      separator.textContent = ' ';
      separator.style.left = formatCssPx(left + width);
      separator.style.top = formatCssPx(top);
      layer.appendChild(separator);
    }
  });
}

export function closestPdfTextSpan(node: Node): HTMLElement | null {
  if (node instanceof HTMLElement) return node.closest<HTMLElement>('span[data-item-index]');
  return node.parentElement?.closest<HTMLElement>('span[data-item-index]') ?? null;
}

export function pdfTextOffset(node: Node, offset: number, span: HTMLElement): number {
  const declaredLength = Number(span.dataset.contentLength);
  const contentLength = Number.isInteger(declaredLength) && declaredLength >= 0
    ? declaredLength
    : span.textContent?.length ?? 0;
  try {
    const range = document.createRange();
    range.selectNodeContents(span);
    range.setEnd(node, offset);
    const length = range.toString().length;
    range.detach();
    return Math.min(length, contentLength);
  } catch {
    if (node.nodeType === Node.TEXT_NODE) return Math.min(offset, contentLength);
    return offset === 0 ? 0 : contentLength;
  }
}

function alignPdfTextSpanToRect(
  span: HTMLElement,
  glyphs: HTMLElement,
  target: { left: number; top: number; width: number; height: number },
): void {
  if (![target.left, target.top, target.width, target.height].every(Number.isFinite)
    || target.width <= 0
    || target.height <= 0
    || !span.textContent) return;

  const range = document.createRange();
  range.selectNodeContents(glyphs);
  const spanBounds = span.getBoundingClientRect();
  const textBounds = range.getBoundingClientRect();
  range.detach();
  if (textBounds.width <= 0 || textBounds.height <= 0) return;

  const scaleX = clamp(target.width / textBounds.width, 0.05, 20);
  const scaleY = clamp(target.height / textBounds.height, 0.05, 20);
  const offsetX = textBounds.left - spanBounds.left;
  const offsetY = textBounds.top - spanBounds.top;
  glyphs.style.transform = `matrix(${[
    scaleX,
    0,
    0,
    scaleY,
    -offsetX * scaleX,
    -offsetY * scaleY,
  ].map(roundCoordinate).join(', ')})`;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
