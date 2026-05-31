export interface PdfPageSize {
  width: number;
  height: number;
}

export interface PdfPageLayout {
  cssWidth: number;
  cssHeight: number;
  bitmapWidth: number;
  bitmapHeight: number;
  dpr: number;
  scale: number;
}

export function createPdfPageLayout(pageSize: PdfPageSize, scale: number, rawDpr: number): PdfPageLayout {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const dpr = Number.isFinite(rawDpr) && rawDpr > 0 ? rawDpr : 1;
  const cssWidth = pageSize.width * safeScale;
  const cssHeight = pageSize.height * safeScale;

  return {
    cssWidth,
    cssHeight,
    bitmapWidth: Math.max(1, Math.round(cssWidth * dpr)),
    bitmapHeight: Math.max(1, Math.round(cssHeight * dpr)),
    dpr,
    scale: safeScale,
  };
}

export function formatCssPx(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return `${Number(rounded.toFixed(3))}px`;
}
