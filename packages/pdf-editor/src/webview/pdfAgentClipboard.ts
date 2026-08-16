import type { PdfRect } from './pdfTextBands';

export const PDF_SELECTION_CROP_PADDING_POINTS = 24;
export const PDF_AGENT_CLIPBOARD_MAX_PNG_BYTES = 5 * 1024 * 1024;
export const PDF_AGENT_CLIPBOARD_MAX_CROP_EDGE = 1600;
export const PDF_AGENT_CLIPBOARD_GUTTER_PX = 12;

const PDF_SELECTION_OUTLINE_COLOR = '#4dabf7';
const PDF_CROP_SCALE_RETRY_FACTOR = 0.72;
const PDF_CROP_MAX_ATTEMPTS = 8;
const PDF_AGENT_CLIPBOARD_MAX_PAGES = 256;

export interface PdfPageSurface {
  canvas: HTMLCanvasElement;
  pageWidth: number;
  pageHeight: number;
}

export interface PdfSelectionCropSource extends PdfPageSurface {
  page: number;
  rects: unknown;
}

export interface PdfAgentClipboardCropInput {
  pages: readonly PdfSelectionCropSource[];
}

export interface PdfSelectionCrop {
  page: number;
  canvas: HTMLCanvasElement;
  cropRect: PdfRect;
}

export interface PdfSelectionCropSnapshot {
  dataUrl: string;
  cropRect: PdfRect;
}

interface PdfSelectionWithRects {
  page: number;
  rects: unknown;
}

interface PdfSelectionCropGeometry {
  cropRect: PdfRect;
  heightPoints: number;
  rects: PdfRect[];
  sourceScaleX: number;
  sourceScaleY: number;
  widthPoints: number;
}

export function capturePdfSelectionCrop(
  surface: PdfPageSurface,
  selection: PdfSelectionWithRects,
  options?: { throwOnCaptureError?: boolean },
): string | undefined {
  return capturePdfSelectionSnapshot(surface, selection, options)?.dataUrl;
}

export function capturePdfSelectionSnapshot(
  surface: PdfPageSurface,
  selection: PdfSelectionWithRects,
  options?: { throwOnCaptureError?: boolean },
): PdfSelectionCropSnapshot | undefined {
  const source = {
    page: selection.page,
    canvas: surface.canvas,
    pageWidth: surface.pageWidth,
    pageHeight: surface.pageHeight,
    rects: selection.rects,
  };
  const geometry = pdfSelectionCropGeometry(source);
  if (!geometry) return undefined;
  let outputScale = pdfSelectionCropScale(geometry);
  if (!positiveFiniteNumber(outputScale)) return undefined;
  for (let attempt = 0; attempt < PDF_CROP_MAX_ATTEMPTS; attempt++) {
    const crop = drawPdfSelectionCrop(source, geometry, outputScale, options);
    if (!crop) return undefined;
    try {
      const dataUrl = crop.canvas.toDataURL('image/png');
      if (base64ByteLength(dataUrl.split(',')[1] ?? '') <= PDF_AGENT_CLIPBOARD_MAX_PNG_BYTES) {
        return {
          dataUrl,
          cropRect: crop.cropRect,
        };
      }
    } catch (cause) {
      if (options?.throwOnCaptureError) throw cause;
      return undefined;
    }
    outputScale *= PDF_CROP_SCALE_RETRY_FACTOR;
  }
  return undefined;
}

export function renderPdfSelectionCrop(
  source: PdfSelectionCropSource,
  scaleMultiplier = 1,
): PdfSelectionCrop | undefined {
  const geometry = pdfSelectionCropGeometry(source);
  if (
    !geometry
    || !Number.isFinite(scaleMultiplier)
    || scaleMultiplier <= 0
  ) return undefined;
  return drawPdfSelectionCrop(
    source,
    geometry,
    pdfSelectionCropScale(geometry) * scaleMultiplier,
  );
}

function drawPdfSelectionCrop(
  source: PdfSelectionCropSource,
  geometry: PdfSelectionCropGeometry,
  outputScale: number,
  options?: { throwOnCaptureError?: boolean },
): PdfSelectionCrop | undefined {
  const {
    cropRect: [left, top],
    heightPoints,
    rects,
    sourceScaleX,
    sourceScaleY,
    widthPoints,
  } = geometry;
  if (!Number.isFinite(outputScale) || outputScale <= 0) return undefined;

  try {
    const output = document.createElement('canvas');
    output.width = Math.max(1, Math.round(widthPoints * outputScale));
    output.height = Math.max(1, Math.round(heightPoints * outputScale));
    const context = output.getContext('2d');
    if (!context) return undefined;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(
      source.canvas,
      left * sourceScaleX,
      top * sourceScaleY,
      widthPoints * sourceScaleX,
      heightPoints * sourceScaleY,
      0,
      0,
      output.width,
      output.height,
    );
    context.strokeStyle = PDF_SELECTION_OUTLINE_COLOR;
    context.lineWidth = Math.max(2, Math.min(4, outputScale * 1.35));
    for (const rect of rects) {
      context.strokeRect(
        (rect[0] - left) * outputScale,
        (rect[1] - top) * outputScale,
        (rect[2] - rect[0]) * outputScale,
        (rect[3] - rect[1]) * outputScale,
      );
    }
    return {
      page: source.page,
      canvas: output,
      cropRect: geometry.cropRect,
    };
  } catch (cause) {
    if (options?.throwOnCaptureError) throw cause;
    return undefined;
  }
}

export function stitchPdfSelectionCrops(
  crops: readonly PdfSelectionCrop[],
): HTMLCanvasElement | undefined {
  return stitchPdfSelectionCropsAtScale(crops, 1);
}

export async function capturePdfAgentClipboardPng(
  input: PdfAgentClipboardCropInput,
): Promise<Blob | undefined> {
  const pageValues = asReadonlyArray<PdfSelectionCropSource>(input?.pages);
  if (
    !input
    || !pageValues
    || pageValues.length === 0
    || pageValues.length > PDF_AGENT_CLIPBOARD_MAX_PAGES
  ) return undefined;

  const seenPages = new Set<number>();
  for (const page of pageValues) {
    if (
      !page
      || !Number.isSafeInteger(page.page)
      || page.page <= 0
      || seenPages.has(page.page)
    ) return undefined;
    seenPages.add(page.page);
  }

  const pages = [...pageValues].sort((left, right) => left.page - right.page);
  const crops: PdfSelectionCrop[] = [];
  for (const page of pages) {
    const crop = renderPdfSelectionCrop(page);
    if (!crop) return undefined;
    crops.push(crop);
  }

  let scaleMultiplier = 1;
  for (let attempt = 0; attempt < PDF_CROP_MAX_ATTEMPTS; attempt++) {
    const output = stitchPdfSelectionCropsAtScale(crops, scaleMultiplier);
    if (!output) return undefined;
    const blob = await canvasPngBlob(output);
    if (!blob) return undefined;
    if (
      output.width <= PDF_AGENT_CLIPBOARD_MAX_CROP_EDGE
      && output.height <= PDF_AGENT_CLIPBOARD_MAX_CROP_EDGE
      && blob.size <= PDF_AGENT_CLIPBOARD_MAX_PNG_BYTES
    ) return blob;
    scaleMultiplier *= PDF_CROP_SCALE_RETRY_FACTOR;
  }
  return undefined;
}

function pdfSelectionCropGeometry(
  source: PdfSelectionCropSource,
): PdfSelectionCropGeometry | undefined {
  if (
    !source
    || !isCanvas(source.canvas)
    || !positiveFiniteNumber(source.pageWidth)
    || !positiveFiniteNumber(source.pageHeight)
  ) return undefined;
  const rects = validPdfRects(source.rects);
  if (!rects.length) return undefined;
  const union = rects.reduce((current, rect) => ({
    left: Math.min(current.left, rect[0]),
    top: Math.min(current.top, rect[1]),
    right: Math.max(current.right, rect[2]),
    bottom: Math.max(current.bottom, rect[3]),
  }), {
    left: rects[0]![0],
    top: rects[0]![1],
    right: rects[0]![2],
    bottom: rects[0]![3],
  });
  const left = clamp(
    union.left - PDF_SELECTION_CROP_PADDING_POINTS,
    0,
    source.pageWidth,
  );
  const top = clamp(
    union.top - PDF_SELECTION_CROP_PADDING_POINTS,
    0,
    source.pageHeight,
  );
  const right = clamp(
    union.right + PDF_SELECTION_CROP_PADDING_POINTS,
    left,
    source.pageWidth,
  );
  const bottom = clamp(
    union.bottom + PDF_SELECTION_CROP_PADDING_POINTS,
    top,
    source.pageHeight,
  );
  const widthPoints = right - left;
  const heightPoints = bottom - top;
  if (widthPoints <= 0 || heightPoints <= 0) return undefined;

  const sourceScaleX = source.canvas.width / source.pageWidth;
  const sourceScaleY = source.canvas.height / source.pageHeight;
  if (
    !positiveFiniteNumber(sourceScaleX)
    || !positiveFiniteNumber(sourceScaleY)
  ) return undefined;
  return {
    cropRect: [left, top, right, bottom],
    heightPoints,
    rects,
    sourceScaleX,
    sourceScaleY,
    widthPoints,
  };
}

function pdfSelectionCropScale(geometry: PdfSelectionCropGeometry): number {
  return Math.min(
    geometry.sourceScaleX,
    geometry.sourceScaleY,
    PDF_AGENT_CLIPBOARD_MAX_CROP_EDGE
      / Math.max(geometry.widthPoints, geometry.heightPoints),
  );
}

function stitchPdfSelectionCropsAtScale(
  crops: readonly PdfSelectionCrop[],
  scaleMultiplier: number,
): HTMLCanvasElement | undefined {
  const cropValues = asReadonlyArray<PdfSelectionCrop>(crops);
  if (
    !cropValues
    || cropValues.length === 0
    || !Number.isFinite(scaleMultiplier)
    || scaleMultiplier <= 0
  ) return undefined;
  const seenPages = new Set<number>();
  for (const crop of cropValues) {
    if (
      !crop
      || !Number.isSafeInteger(crop.page)
      || crop.page <= 0
      || seenPages.has(crop.page)
      || !isCanvas(crop.canvas)
      || !validPdfRect(crop.cropRect)
    ) return undefined;
    seenPages.add(crop.page);
  }

  const ordered = [...cropValues].sort((left, right) => left.page - right.page);
  const commonWidth = Math.max(...ordered.map(crop => crop.canvas.width));
  const commonHeights = ordered.map(crop => (
    crop.canvas.height * commonWidth / crop.canvas.width
  ));
  const combinedCropHeight = commonHeights.reduce(
    (sum, height) => sum + height,
    0,
  );
  const combinedGutterHeight = PDF_AGENT_CLIPBOARD_GUTTER_PX
    * (ordered.length - 1);
  if (
    !positiveFiniteNumber(commonWidth)
    || !positiveFiniteNumber(combinedCropHeight)
    || !Number.isFinite(combinedGutterHeight)
    || combinedGutterHeight >= PDF_AGENT_CLIPBOARD_MAX_CROP_EDGE
    || commonHeights.some(height => !positiveFiniteNumber(height))
  ) return undefined;
  const edgeScale = Math.min(
    1,
    PDF_AGENT_CLIPBOARD_MAX_CROP_EDGE / commonWidth,
    (PDF_AGENT_CLIPBOARD_MAX_CROP_EDGE - combinedGutterHeight)
      / combinedCropHeight,
  );
  const outputScale = edgeScale * scaleMultiplier;
  if (!positiveFiniteNumber(outputScale)) return undefined;

  try {
    const output = document.createElement('canvas');
    output.width = Math.max(
      1,
      Math.min(
        PDF_AGENT_CLIPBOARD_MAX_CROP_EDGE,
        Math.ceil(commonWidth * outputScale),
      ),
    );
    output.height = Math.max(
      1,
      Math.min(
        PDF_AGENT_CLIPBOARD_MAX_CROP_EDGE,
        Math.ceil(
          combinedCropHeight * outputScale + combinedGutterHeight,
        ),
      ),
    );
    const context = output.getContext('2d');
    if (!context) return undefined;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, output.width, output.height);
    let top = 0;
    ordered.forEach((crop, index) => {
      const height = commonHeights[index]! * outputScale;
      context.drawImage(
        crop.canvas,
        0,
        top,
        commonWidth * outputScale,
        height,
      );
      top += height;
      if (index < ordered.length - 1) {
        top += PDF_AGENT_CLIPBOARD_GUTTER_PX;
      }
    });
    return output;
  } catch {
    return undefined;
  }
}

function canvasPngBlob(canvas: HTMLCanvasElement): Promise<Blob | undefined> {
  return new Promise(resolve => {
    try {
      canvas.toBlob(blob => resolve(blob ?? undefined), 'image/png');
    } catch {
      resolve(undefined);
    }
  });
}

function validPdfRects(value: unknown): PdfRect[] {
  if (
    !Array.isArray(value)
    || value.length === 0
    || !value.every(validPdfRect)
  ) return [];
  return value.map(rect => [...rect] as PdfRect);
}

function validPdfRect(value: unknown): value is PdfRect {
  return (
    Array.isArray(value)
    && value.length === 4
    && value.every(coordinate => (
      typeof coordinate === 'number' && Number.isFinite(coordinate)
    ))
    && value[2]! > value[0]!
    && value[3]! > value[1]!
  );
}

function isCanvas(value: unknown): value is HTMLCanvasElement {
  if (!value || typeof value !== 'object') return false;
  const canvas = value as Partial<HTMLCanvasElement>;
  return (
    positiveFiniteNumber(canvas.width)
    && positiveFiniteNumber(canvas.height)
    && typeof canvas.getContext === 'function'
  );
}

function positiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function asReadonlyArray<T>(value: unknown): readonly T[] | undefined {
  return Array.isArray(value) ? value as T[] : undefined;
}

function base64ByteLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(value.length * 3 / 4) - padding);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
