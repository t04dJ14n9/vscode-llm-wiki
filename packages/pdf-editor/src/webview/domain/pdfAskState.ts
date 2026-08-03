import type { PdfRect } from '../pdfTextBands';

const ASK_PDF_MIN_WIDTH = 320;
const ASK_PDF_DEFAULT_WIDTH = 380;
const ASK_PDF_MAX_WIDTH = 560;

export type PdfDiscussionTurnStatus = 'idle' | 'running' | 'failed' | 'cancelled';

export interface PdfAskSelection {
  page: number;
  snippet?: string;
  quote?: string;
  prefix?: string;
  suffix?: string;
  rects: number[][];
  textItemIndex?: number;
  charOffset?: number;
  endTextItemIndex?: number;
  endCharOffset?: number;
}

export interface PdfDiscussionMessageSnapshot {
  id: string;
  role: 'user' | 'assistant';
  markdown: string;
  createdAt: string;
  codexTurnId?: string;
  codexModel?: string;
}

export interface PdfDiscussionModelSnapshot {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
}

export interface PdfDiscussionAnnotationSnapshot {
  id: string;
  kind: 'agent_discussion';
  selectionKey: string;
  anchor: {
    page: number;
    quote: string;
    prefix?: string;
    suffix?: string;
    rects: PdfRect[];
    textItemIndex?: number;
    charOffset?: number;
    endTextItemIndex?: number;
    endCharOffset?: number;
  };
  snapshot?: {
    sha256: string;
    width: number;
    height: number;
    mimeType: 'image/png';
  };
  messages: PdfDiscussionMessageSnapshot[];
  summaryMarkdown?: string;
  lastTurn: {
    status: PdfDiscussionTurnStatus;
    questionMessageId?: string;
    model?: string;
    error?: string;
  };
  promotion?: {
    threadId: string;
    promotedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AskPdfWebviewState {
  askPdfPanelWidth?: number;
  askPdfDraft?: string;
  askPdfDrafts?: Record<string, string>;
  askPdfModelSelections?: Record<string, string>;
  askPdfWindows?: Record<string, AskPdfWindowState>;
}

export interface AskPdfWindowState {
  left: number;
  top: number;
  width: number;
  height: number;
  detached: boolean;
  minimized: boolean;
}

export function selectionFromAnnotation(
  annotation: PdfDiscussionAnnotationSnapshot,
): PdfAskSelection {
  return {
    page: annotation.anchor.page,
    snippet: annotation.anchor.quote,
    quote: annotation.anchor.quote,
    prefix: annotation.anchor.prefix,
    suffix: annotation.anchor.suffix,
    rects: annotation.anchor.rects,
    textItemIndex: annotation.anchor.textItemIndex,
    charOffset: annotation.anchor.charOffset,
    endTextItemIndex: annotation.anchor.endTextItemIndex,
    endCharOffset: annotation.anchor.endCharOffset,
  };
}

export function sortAnnotations(
  annotations: PdfDiscussionAnnotationSnapshot[],
): PdfDiscussionAnnotationSnapshot[] {
  return [...annotations].sort((left, right) => (
    left.anchor.page - right.anchor.page
    || Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    || left.id.localeCompare(right.id)
  ));
}

export function annotationVisualStatus(
  annotation: PdfDiscussionAnnotationSnapshot,
  turnStatus: PdfDiscussionTurnStatus,
): string {
  if (annotation.promotion) return 'promoted';
  if (turnStatus === 'running' || turnStatus === 'failed' || turnStatus === 'cancelled') {
    return turnStatus;
  }
  return annotationHasAnswer(annotation) ? 'answered' : 'draft';
}

export function annotationHasAnswer(annotation: PdfDiscussionAnnotationSnapshot): boolean {
  return annotation.messages.some(message => message.role === 'assistant');
}

export function validPdfRects(value: unknown): PdfRect[] {
  if (!Array.isArray(value)) return [];
  return value.filter((rect): rect is PdfRect => (
    Array.isArray(rect)
    && rect.length === 4
    && rect.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate))
    && rect[2]! > rect[0]!
    && rect[3]! > rect[1]!
  ));
}

export function normalizeTurnStatus(value: unknown): PdfDiscussionTurnStatus {
  return value === 'running' || value === 'failed' || value === 'cancelled' ? value : 'idle';
}

export function normalizeAskPdfState(value: unknown): AskPdfWebviewState {
  return value && typeof value === 'object' ? value : {};
}

export function normalizeAskPdfWindows(value: unknown): Record<string, AskPdfWindowState> {
  if (!value || typeof value !== 'object') return {};
  const windows: Record<string, AskPdfWindowState> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Partial<AskPdfWindowState>;
    if (![record.left, record.top, record.width, record.height].every(number => (
      typeof number === 'number' && Number.isFinite(number)
    ))) continue;
    windows[key] = {
      left: record.left!,
      top: record.top!,
      width: record.width!,
      height: record.height!,
      detached: record.detached === true,
      minimized: record.minimized === true,
    };
  }
  return windows;
}

export function normalizeAskPdfDrafts(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export function normalizeAskPdfModelSelections(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => (
      typeof entry[1] === 'string' && entry[1].trim().length > 0
    )),
  );
}

export function normalizePdfDiscussionModels(value: unknown): PdfDiscussionModelSnapshot[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object') return [];
    const record = candidate as Partial<PdfDiscussionModelSnapshot>;
    if (
      typeof record.id !== 'string'
      || typeof record.model !== 'string'
      || typeof record.displayName !== 'string'
      || typeof record.description !== 'string'
      || typeof record.isDefault !== 'boolean'
      || !record.model.trim()
      || seen.has(record.model)
    ) return [];
    seen.add(record.model);
    return [{
      id: record.id,
      model: record.model,
      displayName: record.displayName || record.model,
      description: record.description,
      isDefault: record.isDefault,
    }];
  });
}

export function isTransientAskPdfWindowKey(key: string | undefined): boolean {
  return Boolean(key?.startsWith('draft:') || key?.startsWith('selection:'));
}

export function clampAskPdfPanelWidth(value: unknown): number {
  const number = typeof value === 'number' && Number.isFinite(value)
    ? value
    : ASK_PDF_DEFAULT_WIDTH;
  return Math.round(clamp(number, ASK_PDF_MIN_WIDTH, ASK_PDF_MAX_WIDTH));
}

export function base64ByteLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(value.length * 3 / 4) - padding);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
