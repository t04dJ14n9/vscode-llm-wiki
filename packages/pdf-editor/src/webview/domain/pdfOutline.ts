import {
  PdfActionType,
  PdfZoomMode,
  type PdfBookmarkObject,
  type PdfDestinationObject,
} from '@embedpdf/models';

export type PdfOutlineDestination = PdfDestinationObject;

export interface PdfOutlineEntry {
  title: string;
  destination?: PdfOutlineDestination;
  children: PdfOutlineEntry[];
}

export const PDF_OUTLINE_MAX_DEPTH = 32;
export const PDF_OUTLINE_MAX_ENTRIES = 10_000;
export const PDF_OUTLINE_MAX_TITLE_LENGTH = 500;
export const PDF_OUTLINE_MAX_DESTINATION_VIEW_LENGTH = 8;

const PDF_OUTLINE_MAX_TITLE_INPUT_LENGTH = PDF_OUTLINE_MAX_TITLE_LENGTH * 4;

/**
 * Converts the bookmark hierarchy returned by EmbedPDF into data that is safe
 * to send across a webview message boundary.
 *
 * Remote, URI, launch, and unsupported actions remain visible in the
 * hierarchy, but deliberately have no clickable destination.
 */
export function pdfBookmarksToOutlineEntries(
  bookmarks: readonly PdfBookmarkObject[],
): PdfOutlineEntry[] {
  return normalizeOutlineTree(bookmarks, bookmark => {
    const record = asRecord(bookmark);
    if (!record) return undefined;
    return {
      title: record.title,
      destination: pdfBookmarkInternalDestination(
        bookmark as Pick<PdfBookmarkObject, 'target'>,
      ),
      children: record.children,
    };
  });
}

/**
 * Returns only destinations that stay inside the current PDF.
 */
export function pdfBookmarkInternalDestination(
  bookmark: Pick<PdfBookmarkObject, 'target'>,
): PdfDestinationObject | undefined {
  const target = asRecord(asRecord(bookmark)?.target);
  if (!target) return undefined;

  if (target.type === 'destination') {
    return normalizePdfOutlineDestination(target.destination);
  }
  if (target.type !== 'action') return undefined;

  const action = asRecord(target.action);
  if (action?.type !== PdfActionType.Goto) return undefined;
  return normalizePdfOutlineDestination(action.destination);
}

/**
 * Validates an untrusted destination received from a webview or extension-host
 * message and returns a fresh object containing only supported fields.
 */
export function normalizePdfOutlineDestination(
  value: unknown,
): PdfDestinationObject | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const pageIndex = record.pageIndex;
  const zoomRecord = asRecord(record.zoom);
  const rawView = record.view;
  if (
    typeof pageIndex !== 'number'
    || !Number.isSafeInteger(pageIndex)
    || pageIndex < 0
    || !zoomRecord
    || !Array.isArray(rawView)
    || rawView.length > PDF_OUTLINE_MAX_DESTINATION_VIEW_LENGTH
  ) {
    return undefined;
  }

  const view: number[] = [];
  for (let index = 0; index < rawView.length; index++) {
    const coordinate = finiteNumber(rawView[index]);
    if (coordinate === undefined) return undefined;
    view.push(coordinate);
  }

  const mode = zoomRecord.mode;
  switch (mode) {
    case PdfZoomMode.Unknown:
      return { pageIndex, zoom: { mode: PdfZoomMode.Unknown }, view };
    case PdfZoomMode.XYZ: {
      const params = asRecord(zoomRecord.params);
      if (!params) return undefined;
      const x = finiteNumber(params.x);
      const y = finiteNumber(params.y);
      const zoom = finiteNumber(params.zoom);
      if (x === undefined || y === undefined || zoom === undefined) return undefined;
      return {
        pageIndex,
        zoom: {
          mode: PdfZoomMode.XYZ,
          params: { x, y, zoom },
        },
        view,
      };
    }
    case PdfZoomMode.FitPage:
      return { pageIndex, zoom: { mode: PdfZoomMode.FitPage }, view };
    case PdfZoomMode.FitHorizontal:
      return { pageIndex, zoom: { mode: PdfZoomMode.FitHorizontal }, view };
    case PdfZoomMode.FitVertical:
      return { pageIndex, zoom: { mode: PdfZoomMode.FitVertical }, view };
    case PdfZoomMode.FitRectangle:
      return { pageIndex, zoom: { mode: PdfZoomMode.FitRectangle }, view };
    case PdfZoomMode.FitBoundingBox:
      return { pageIndex, zoom: { mode: PdfZoomMode.FitBoundingBox }, view };
    case PdfZoomMode.FitBoundingBoxHorizontal:
      return { pageIndex, zoom: { mode: PdfZoomMode.FitBoundingBoxHorizontal }, view };
    case PdfZoomMode.FitBoundingBoxVertical:
      return { pageIndex, zoom: { mode: PdfZoomMode.FitBoundingBoxVertical }, view };
    default:
      return undefined;
  }
}

/**
 * Creates an internal XYZ destination without changing the reader's zoom.
 */
export function pdfOutlineXyzDestination(
  pageIndex: number,
  x: number,
  y: number,
): PdfDestinationObject | undefined {
  return normalizePdfOutlineDestination({
    pageIndex,
    zoom: {
      mode: PdfZoomMode.XYZ,
      params: { x, y, zoom: 0 },
    },
    view: [],
  });
}

/**
 * Defensively normalizes outline entries received through a message boundary.
 */
export function normalizePdfOutlineEntries(value: unknown): PdfOutlineEntry[] {
  if (!Array.isArray(value)) return [];
  return normalizeOutlineTree(value, item => {
    const record = asRecord(item);
    if (!record) return undefined;
    return {
      title: record.title,
      destination: normalizePdfOutlineDestination(record.destination),
      children: record.children,
    };
  });
}

interface RawOutlineEntry {
  title: unknown;
  destination: PdfDestinationObject | undefined;
  children: unknown;
}

function normalizeOutlineTree(
  roots: readonly unknown[],
  readEntry: (value: unknown) => RawOutlineEntry | undefined,
): PdfOutlineEntry[] {
  let visitedCount = 0;
  const seen = new WeakSet<object>();

  const visit = (values: readonly unknown[], depth: number): PdfOutlineEntry[] => {
    if (depth >= PDF_OUTLINE_MAX_DEPTH || visitedCount >= PDF_OUTLINE_MAX_ENTRIES) {
      return [];
    }

    const entries: PdfOutlineEntry[] = [];
    for (const value of values) {
      if (visitedCount >= PDF_OUTLINE_MAX_ENTRIES) break;
      visitedCount += 1;

      const object = objectValue(value);
      if (!object || seen.has(object)) continue;
      seen.add(object);

      const rawEntry = readEntry(value);
      if (!rawEntry) continue;
      const title = normalizePdfOutlineTitle(rawEntry.title);
      if (!title) continue;

      const children = Array.isArray(rawEntry.children)
        ? visit(rawEntry.children, depth + 1)
        : [];
      entries.push({
        title,
        ...(rawEntry.destination ? { destination: rawEntry.destination } : {}),
        children,
      });
    }
    return entries;
  };

  return visit(roots, 0);
}

function normalizePdfOutlineTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const title = value
    .slice(0, PDF_OUTLINE_MAX_TITLE_INPUT_LENGTH)
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, PDF_OUTLINE_MAX_TITLE_LENGTH);
  return title || undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(number)) return undefined;
  return Object.is(number, -0) ? 0 : number;
}

function objectValue(value: unknown): object | undefined {
  return value !== null && typeof value === 'object' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return objectValue(value) as Record<string, unknown> | undefined;
}
