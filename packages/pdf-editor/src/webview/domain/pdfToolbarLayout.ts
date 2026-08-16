export type PdfToolbarDock = 'top' | 'left';

export interface PdfToolbarPreference {
  dock: PdfToolbarDock;
  hidden: boolean;
}

export const DEFAULT_PDF_TOOLBAR_PREFERENCE: PdfToolbarPreference = Object.freeze({
  dock: 'top',
  hidden: false,
});

const MINIMUM_DOCK_EDGE_SIZE = 16;
const MAXIMUM_DOCK_EDGE_SIZE = 160;
const DEFAULT_DOCK_EDGE_SIZE = 72;

export function normalizePdfToolbarPreference(
  value: unknown,
  fallback: PdfToolbarPreference = DEFAULT_PDF_TOOLBAR_PREFERENCE,
): PdfToolbarPreference {
  const normalizedFallback = validPdfToolbarPreference(fallback)
    ? fallback
    : DEFAULT_PDF_TOOLBAR_PREFERENCE;
  if (!validPdfToolbarPreference(value)) {
    return {
      dock: normalizedFallback.dock,
      hidden: normalizedFallback.hidden,
    };
  }
  return {
    dock: value.dock,
    hidden: value.hidden,
  };
}

export function togglePdfToolbarPreference(
  value: PdfToolbarPreference,
): PdfToolbarPreference {
  const normalized = normalizePdfToolbarPreference(value);
  return {
    dock: normalized.dock,
    hidden: !normalized.hidden,
  };
}

export function pdfToolbarDockAtPoint(
  point: { clientX: number; clientY: number },
  viewport: { width: number; height: number },
  edgeSize = DEFAULT_DOCK_EDGE_SIZE,
): PdfToolbarDock | undefined {
  const clientX = Number(point?.clientX);
  const clientY = Number(point?.clientY);
  const width = Number(viewport?.width);
  const height = Number(viewport?.height);
  if (
    ![clientX, clientY, width, height].every(Number.isFinite)
    || width <= 0
    || height <= 0
    || clientX < 0
    || clientY < 0
    || clientX > width
    || clientY > height
  ) return undefined;

  const requestedEdge = Number.isFinite(Number(edgeSize))
    ? Number(edgeSize)
    : DEFAULT_DOCK_EDGE_SIZE;
  const edge = Math.min(
    MAXIMUM_DOCK_EDGE_SIZE,
    Math.max(MINIMUM_DOCK_EDGE_SIZE, requestedEdge),
  );
  const left = clientX <= edge;
  const top = clientY <= edge;
  if (left && top) return clientX <= clientY ? 'left' : 'top';
  if (left) return 'left';
  if (top) return 'top';
  return undefined;
}

function validPdfToolbarPreference(value: unknown): value is PdfToolbarPreference {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PdfToolbarPreference>;
  return (record.dock === 'top' || record.dock === 'left')
    && typeof record.hidden === 'boolean';
}
