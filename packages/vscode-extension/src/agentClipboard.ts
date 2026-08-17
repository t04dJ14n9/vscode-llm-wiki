import { pdfHref } from '@llm-wiki/core';
import type { SelectionContext } from './selectionContext';

const MAX_AGENT_CLIPBOARD_TEXT_CHARACTERS = 65_536;
const MAX_AGENT_CLIPBOARD_PATH_CHARACTERS = 32 * 1024;
const MAX_AGENT_CLIPBOARD_KEY_CHARACTERS = 256 * 1024;
const MAX_AGENT_CLIPBOARD_PAGES = 256;
const MAX_AGENT_CLIPBOARD_RECTS_PER_PAGE = 256;

export interface PdfAgentClipboardContextInput {
  selectionKey: string;
  relativePath: string;
  sourceSha256: string;
  selection: PdfAgentClipboardSelection;
}

export interface PdfAgentClipboardContext {
  selectionKey: string;
  sourceLabel: string;
  sourceHref: string;
  selectedText?: SelectionContext['text'];
  plainText: string;
}

export interface PdfAgentClipboardPageSelection {
  page: number;
  rects: ReadonlyArray<readonly [number, number, number, number]>;
}

export type PdfAgentClipboardSelection =
  | {
      kind: 'text';
      startPage: number;
      endPage: number;
      pages: readonly PdfAgentClipboardPageSelection[];
      selectedText: SelectionContext['text'];
    }
  | {
      kind: 'area';
      startPage: number;
      endPage: number;
      pages: readonly PdfAgentClipboardPageSelection[];
    };

/**
 * Format the provider-neutral Markdown reference copied to an agent's input.
 */
export function formatMarkdownAgentReference(
  relativePath: string,
  startLine: number,
  endLine: number,
): string {
  const normalizedPath = normalizeWorkspaceRelativePath(relativePath);
  if (!normalizedPath) {
    throw new TypeError('Markdown agent reference path must be workspace-relative.');
  }
  if (!isPositiveSafeInteger(startLine) || !isPositiveSafeInteger(endLine)) {
    throw new TypeError('Markdown agent reference lines must be positive safe integers.');
  }
  if (endLine < startLine) {
    throw new RangeError('Markdown agent reference lines must be ordered.');
  }

  const lineRange = startLine === endLine
    ? String(startLine)
    : `${startLine}-${endLine}`;
  return `@${normalizedPath}#${lineRange}`;
}

export function createPdfAgentClipboardContext(
  input: PdfAgentClipboardContextInput,
): PdfAgentClipboardContext | undefined {
  if (!isRecord(input)) return undefined;
  const selectionKey = boundedNonEmptyString(input.selectionKey, MAX_AGENT_CLIPBOARD_KEY_CHARACTERS);
  const relativePath = normalizeWorkspaceRelativePath(input.relativePath);
  const sourceSha256 = normalizeSha256(input.sourceSha256);
  const selection = normalizePdfAgentClipboardSelection(input.selection);
  if (!selectionKey || !relativePath || !sourceSha256 || !selection) return undefined;

  const links = selection.pages.map(pageSelection => {
    const viewRect = unionPdfAgentClipboardRects(pageSelection.rects);
    const sourceHref = pdfHref(relativePath, {
      page: pageSelection.page,
      viewRect,
    });
    const suffix = selection.kind === 'area' ? ' region' : '';
    const label = escapeMarkdownLinkLabel(
      `${relativePath} (page ${pageSelection.page}${suffix})`,
    );
    return { sourceHref, markdown: `[${label}](<${sourceHref}>)` };
  });
  const sourceHref = links[0]!.sourceHref;
  const sourceLabel = selection.startPage === selection.endPage
    ? `${relativePath} (page ${selection.startPage})`
    : `${relativePath} (pages ${selection.startPage}–${selection.endPage})`;
  const sourceLines = links.length === 1
    ? [`Source: ${links[0]!.markdown}`]
    : ['Sources:', ...links.map(link => `- ${link.markdown}`)];
  const selectedText = selection.kind === 'text' ? selection.selectedText : undefined;
  const plainText = [
    ...sourceLines,
    `PDF source SHA-256: \`${sourceSha256}\``,
    '',
    ...(selectedText
      ? ['Selected text:', selectedText]
      : [
          'Selected PDF region. Use the vault PDF skill to extract its text and inspect its visual content.',
        ]),
  ].join('\n');

  return {
    selectionKey,
    sourceLabel,
    sourceHref,
    ...(selectedText ? { selectedText } : {}),
    plainText,
  };
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/[\\[\]`*_{}<>&|~]/gu, '\\$&');
}

export function pdfAgentClipboardSelectionKey(
  input: PdfAgentClipboardSelection,
): string | undefined {
  const normalized = normalizePdfAgentClipboardSelection(input);
  if (!normalized) return undefined;

  const key = JSON.stringify(normalized);
  return key.length <= MAX_AGENT_CLIPBOARD_KEY_CHARACTERS ? key : undefined;
}

function normalizePdfAgentClipboardSelection(
  input: unknown,
): PdfAgentClipboardSelection | undefined {
  if (!isRecord(input) || (input.kind !== 'text' && input.kind !== 'area')) return undefined;
  if (
    !isPositiveSafeInteger(input.startPage)
    || !isPositiveSafeInteger(input.endPage)
    || input.endPage < input.startPage
    || !Array.isArray(input.pages)
    || input.pages.length === 0
    || input.pages.length > MAX_AGENT_CLIPBOARD_PAGES
  ) return undefined;

  const selectedText = input.kind === 'text'
    ? boundedNonEmptyString(input.selectedText, MAX_AGENT_CLIPBOARD_TEXT_CHARACTERS)
    : undefined;
  if (input.kind === 'text' && !selectedText) return undefined;
  if (input.kind === 'area' && input.selectedText !== undefined) return undefined;

  const normalizedPages: PdfAgentClipboardPageSelection[] = [];
  const seenPages = new Set<number>();
  for (const pageSelection of input.pages) {
    if (!isRecord(pageSelection)) return undefined;
    const page = pageSelection.page;
    const rectValues = asUnknownArray(pageSelection.rects);
    if (
      !isPositiveSafeInteger(page)
      || page < input.startPage
      || page > input.endPage
      || seenPages.has(page)
      || !rectValues
      || rectValues.length === 0
      || rectValues.length > MAX_AGENT_CLIPBOARD_RECTS_PER_PAGE
    ) return undefined;
    const rects = rectValues.map(normalizePdfAgentClipboardRect);
    if (rects.some(rect => rect === undefined)) return undefined;
    seenPages.add(page);
    normalizedPages.push({
      page,
      rects: rects as Array<readonly [number, number, number, number]>,
    });
  }

  normalizedPages.sort((left, right) => left.page - right.page);
  for (const pageSelection of normalizedPages) {
    (pageSelection.rects as Array<readonly [number, number, number, number]>).sort(
      comparePdfAgentClipboardRects,
    );
  }

  if (
    normalizedPages[0]?.page !== input.startPage
    || normalizedPages[normalizedPages.length - 1]?.page !== input.endPage
  ) return undefined;

  return input.kind === 'text'
    ? {
        kind: 'text',
        startPage: input.startPage,
        endPage: input.endPage,
        pages: normalizedPages,
        selectedText: selectedText!,
      }
    : {
        kind: 'area',
        startPage: input.startPage,
        endPage: input.endPage,
        pages: normalizedPages,
      };
}

function unionPdfAgentClipboardRects(
  rects: PdfAgentClipboardPageSelection['rects'],
): { left: number; top: number; width: number; height: number } {
  const left = Math.min(...rects.map(rect => rect[0]));
  const top = Math.min(...rects.map(rect => rect[1]));
  const right = Math.max(...rects.map(rect => rect[2]));
  const bottom = Math.max(...rects.map(rect => rect[3]));
  return { left, top, width: right - left, height: bottom - top };
}

function normalizeSha256(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{64}$/iu.test(value)
    ? value.toLowerCase()
    : undefined;
}

function normalizeWorkspaceRelativePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replaceAll('\\', '/');
  if (
    !normalized
    || normalized.trim() !== normalized
    || normalized.length > MAX_AGENT_CLIPBOARD_PATH_CHARACTERS
    || hasControlCharacters(normalized)
    || normalized.startsWith('/')
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)
    || /^[A-Za-z]:($|\/)/.test(normalized)
    || normalized.split('/').some(segment => segment === '..')
  ) return undefined;
  return normalized;
}

function boundedNonEmptyString(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string' || value.length > maximum || !value.trim()) return undefined;
  return value;
}

function normalizePdfAgentClipboardRect(
  value: unknown,
): readonly [number, number, number, number] | undefined {
  if (
    !Array.isArray(value)
    || value.length !== 4
    || !value.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate))
    || value[2] <= value[0]
    || value[3] <= value[1]
  ) return undefined;
  const [left, top, right, bottom] = value as [number, number, number, number];
  const normalized = [
    Math.round(left * 1_000) / 1_000,
    Math.round(top * 1_000) / 1_000,
    Math.round(right * 1_000) / 1_000,
    Math.round(bottom * 1_000) / 1_000,
  ] as const;
  return normalized.every(coordinate => Number.isFinite(coordinate))
    && normalized[2] > normalized[0]
    && normalized[3] > normalized[1]
    ? normalized
    : undefined;
}

function comparePdfAgentClipboardRects(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): number {
  return left[0] - right[0]
    || left[1] - right[1]
    || left[2] - right[2]
    || left[3] - right[3];
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || codePoint === 0x7f;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asUnknownArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value as unknown[] : undefined;
}
