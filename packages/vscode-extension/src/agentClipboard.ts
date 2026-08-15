import { llmWikiOpenAnchorUri } from './anchorUris';
import type { SelectionContext } from './selectionContext';

const MAX_AGENT_CLIPBOARD_TEXT_CHARACTERS = 65_536;
const MAX_AGENT_CLIPBOARD_PATH_CHARACTERS = 32 * 1024;
const MAX_AGENT_CLIPBOARD_KEY_CHARACTERS = 256 * 1024;
const MAX_AGENT_CLIPBOARD_PAGES = 256;
const MAX_AGENT_CLIPBOARD_RECTS_PER_PAGE = 256;

export interface PdfAgentClipboardContextInput {
  selectionKey: string;
  relativePath: string;
  startPage: number;
  endPage: number;
  selectedText: SelectionContext['text'];
  anchorUri: string;
}

export interface PdfAgentClipboardContext {
  selectionKey: string;
  sourceLabel: string;
  sourceHref: string;
  selectedText: SelectionContext['text'];
  plainText: string;
}

export interface PdfAgentClipboardPageSelection {
  page: number;
  rects: ReadonlyArray<readonly [number, number, number, number]>;
}

export interface PdfAgentClipboardSelection {
  startPage: number;
  endPage: number;
  pages: readonly PdfAgentClipboardPageSelection[];
  selectedText: SelectionContext['text'];
}

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
  const selectedText = boundedNonEmptyString(
    input.selectedText,
    MAX_AGENT_CLIPBOARD_TEXT_CHARACTERS,
  );
  if (
    !selectionKey
    || !relativePath
    || !selectedText
    || !isPositiveSafeInteger(input.startPage)
    || !isPositiveSafeInteger(input.endPage)
    || input.endPage < input.startPage
  ) return undefined;

  const sourceHref = openAnchorHref(input.anchorUri);
  if (!sourceHref) return undefined;

  const sourceLabel = input.startPage === input.endPage
    ? `${relativePath} (page ${input.startPage})`
    : `${relativePath} (pages ${input.startPage}–${input.endPage})`;
  const plainText = [
    `Source: [${sourceLabel}](<${sourceHref}>)`,
    '',
    'Selected text:',
    selectedText,
  ].join('\n');

  return {
    selectionKey,
    sourceLabel,
    sourceHref,
    selectedText,
    plainText,
  };
}

export function pdfAgentClipboardSelectionKey(
  input: PdfAgentClipboardSelection,
): string | undefined {
  if (!isRecord(input)) return undefined;
  if (
    !isPositiveSafeInteger(input.startPage)
    || !isPositiveSafeInteger(input.endPage)
    || input.endPage < input.startPage
    || !Array.isArray(input.pages)
    || input.pages.length === 0
    || input.pages.length > MAX_AGENT_CLIPBOARD_PAGES
  ) return undefined;
  const selectedText = boundedNonEmptyString(
    input.selectedText,
    MAX_AGENT_CLIPBOARD_TEXT_CHARACTERS,
  );
  if (!selectedText) return undefined;

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

  const key = JSON.stringify({
    startPage: input.startPage,
    endPage: input.endPage,
    selectedText,
    pages: normalizedPages,
  });
  return key.length <= MAX_AGENT_CLIPBOARD_KEY_CHARACTERS ? key : undefined;
}

function openAnchorHref(value: unknown): string | undefined {
  const target = normalizeAnchorTarget(value);
  if (!target) return undefined;
  try {
    const href = llmWikiOpenAnchorUri(target);
    return typeof href === 'string' && href.trim() ? href : undefined;
  } catch {
    return undefined;
  }
}

function normalizeAnchorTarget(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.trim() !== value) return undefined;
  const hashIndex = value.indexOf('#');
  const rawPath = hashIndex < 0 ? value : value.slice(0, hashIndex);
  const normalizedPath = normalizeWorkspaceRelativePath(rawPath);
  if (!normalizedPath || normalizedPath.toLowerCase().endsWith('.llm_wiki_anchor')) {
    return undefined;
  }
  return hashIndex < 0
    ? normalizedPath
    : `${normalizedPath}${value.slice(hashIndex)}`;
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
