import type { PdfTextLayerItem } from '../pdfTextLayer';
import {
  normalizePdfOutlineEntries,
  pdfOutlineXyzDestination,
  type PdfOutlineEntry,
} from './pdfOutline';

export interface PdfOutlineTextPage {
  pageIndex: number;
  width: number;
  height: number;
  items: readonly PdfTextLayerItem[];
}

export interface PdfInferredOutlineResult {
  entries: PdfOutlineEntry[];
  candidateCount: number;
}

interface PdfOutlineLine {
  pageIndex: number;
  pageHeight: number;
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  fontSize: number;
  fontWeight: number;
}

interface PdfHeadingCandidate extends PdfOutlineLine {
  numbering?: number[];
  score: number;
  styleKey: string;
  outlineLevel: number;
}

interface MutableOutlineEntry {
  candidate: PdfHeadingCandidate;
  entry: PdfOutlineEntry;
}

const NUMBERED_HEADING = /^(\d+(?:\.\d+){0,4})[.)]?\s+(\S.*)$/u;
const CONVENTIONAL_HEADING = /^(?:abstract|acknowledg(?:e)?ments?|appendix|conclusions?|discussion|evaluation|experiments?|introduction|limitations?|methods?|references|related work|results)$/iu;
const CAPTION_PREFIX = /^(?:fig(?:ure)?|table|algorithm|listing)\s*(?:[A-Z]?\d+|[IVXLC]+)\b/iu;
const BULLET_PREFIX = /^(?:[•●▪◦*+-]|\(\w+\))\s+/u;
const BIBLIOGRAPHY_PREFIX = /^(?:\[\d+\]|\d+\.\s+[A-Z][\p{L}'’-]+,\s)/u;
const PAGE_NUMBER = /^(?:\d+|[ivxlcdm]+)$/iu;
const EMAIL_ADDRESS = /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/u;
const EQUATION_LIKE = /^(?:[A-Za-z]\w*|[\p{L}\p{N}()[\]{}_^+\-*/.,]+\s*)=\s*\S/u;
const HEADING_ACCEPT_SCORE = 7;
const NUMBERED_SCORE = 5;
const LARGER_FONT_SCORE = 2;
const BOLD_SCORE = 2;
const WHITESPACE_SCORE = 1;
const RECURRING_STYLE_SCORE = 2;
const CONVENTIONAL_LABEL_SCORE = 1;

export function inferPdfOutline(
  pages: readonly PdfOutlineTextPage[],
): PdfInferredOutlineResult {
  const lines = pages
    .filter(validPage)
    .flatMap(page => reconstructPdfOutlineLines(page));
  const bodyFontSize = documentBodyFontSize(lines);
  const repeatedBands = repeatedPageBandText(lines);
  const styleCounts = lineStyleCounts(lines);
  const accepted = lines.flatMap((line, index) => {
    if (rejectHeadingLine(line, repeatedBands)) return [];
    const numberedMatch = NUMBERED_HEADING.exec(line.text);
    const numbering = numberedMatch?.[1]?.split('.').map(Number);
    if (numbering?.some(part => !Number.isSafeInteger(part) || part < 0)) return [];
    if (!numbering && !titleLikeLine(line.text)) return [];

    const larger = line.fontSize >= bodyFontSize * 1.15;
    const bold = line.fontWeight >= 600;
    const distinctStyle = larger || bold || line.fontSize >= bodyFontSize * 1.08;
    const styleKey = pdfOutlineStyleKey(line);
    const recurringStyle = distinctStyle && (styleCounts.get(styleKey) ?? 0) >= 2;
    const whitespace = hasHeadingWhitespace(lines, index);
    const conventional = CONVENTIONAL_HEADING.test(line.text);
    const score = (numbering ? NUMBERED_SCORE : 0)
      + (larger ? LARGER_FONT_SCORE : 0)
      + (bold ? BOLD_SCORE : 0)
      + (whitespace ? WHITESPACE_SCORE : 0)
      + (recurringStyle ? RECURRING_STYLE_SCORE : 0)
      + (conventional ? CONVENTIONAL_LABEL_SCORE : 0);
    if (
      score < HEADING_ACCEPT_SCORE
      || (!numbering && (!recurringStyle || (!larger && !bold && !whitespace)))
    ) return [];
    return [{
      ...line,
      ...(numbering ? { numbering } : {}),
      score,
      styleKey,
      outlineLevel: numbering?.length ?? 1,
    }];
  });
  const typographyLevels = unnumberedTypographyLevels(accepted);
  const candidates = accepted.map(candidate => ({
    ...candidate,
    outlineLevel: candidate.numbering?.length
      ?? typographyLevels.get(candidate.styleKey)
      ?? 1,
  }));

  const roots: PdfOutlineEntry[] = [];
  const visible: MutableOutlineEntry[] = [];
  for (const candidate of candidates) {
    const destination = pdfOutlineXyzDestination(
      candidate.pageIndex,
      candidate.left,
      candidate.pageHeight - candidate.top,
    );
    if (!destination) continue;
    const entry: PdfOutlineEntry = {
      title: candidate.text,
      destination,
      children: [],
    };
    const parent = candidate.numbering
      ? nearestCompatibleNumberedParent(visible, candidate.numbering)
      : nearestTypographyParent(visible, candidate.outlineLevel);
    if (parent) parent.entry.children.push(entry);
    else roots.push(entry);
    visible.push({ candidate, entry });
  }

  return {
    entries: normalizePdfOutlineEntries(roots),
    candidateCount: candidates.length,
  };
}

function reconstructPdfOutlineLines(page: PdfOutlineTextPage): PdfOutlineLine[] {
  const fragments = page.items.flatMap(item => {
    const content = normalizeLineText(item.content);
    const left = Number(item.rect?.origin?.x);
    const top = Number(item.rect?.origin?.y);
    const width = Number(item.rect?.size?.width);
    const height = Number(item.rect?.size?.height);
    if (
      !content
      || ![left, top, width, height].every(Number.isFinite)
      || width < 0
      || height <= 0
    ) return [];
    const declaredSize = Number(item.font?.size);
    const declaredWeight = Number(item.font?.weight);
    return [{
      pageIndex: page.pageIndex,
      pageHeight: page.height,
      text: content,
      left,
      top,
      right: left + width,
      bottom: top + height,
      fontSize: Number.isFinite(declaredSize) && declaredSize > 0 ? declaredSize : height,
      fontWeight: Number.isFinite(declaredWeight) ? declaredWeight : 400,
    }];
  }).sort((left, right) => (
    left.top - right.top
    || left.left - right.left
  ));

  const lines: PdfOutlineLine[] = [];
  for (const fragment of fragments) {
    const current = lines.at(-1);
    if (!current || !sameVisualLine(current, fragment)) {
      lines.push(fragment);
      continue;
    }
    current.text = normalizeLineText(`${current.text} ${fragment.text}`);
    current.left = Math.min(current.left, fragment.left);
    current.top = Math.min(current.top, fragment.top);
    current.right = Math.max(current.right, fragment.right);
    current.bottom = Math.max(current.bottom, fragment.bottom);
    current.fontSize = Math.max(current.fontSize, fragment.fontSize);
    current.fontWeight = Math.max(current.fontWeight, fragment.fontWeight);
  }
  return lines;
}

function sameVisualLine(left: PdfOutlineLine, right: PdfOutlineLine): boolean {
  const overlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  const minimumHeight = Math.min(left.bottom - left.top, right.bottom - right.top);
  const horizontalGap = right.left - left.right;
  const maximumGap = Math.max(12, Math.max(left.fontSize, right.fontSize) * 1.5);
  return overlap >= minimumHeight * 0.55
    && horizontalGap >= -2
    && horizontalGap <= maximumGap
    && Math.abs(left.fontSize - right.fontSize) <= Math.max(2, left.fontSize * 0.2);
}

function nearestCompatibleNumberedParent(
  visible: readonly MutableOutlineEntry[],
  numbering: readonly number[],
): MutableOutlineEntry | undefined {
  if (numbering.length <= 1) return undefined;
  for (let index = visible.length - 1; index >= 0; index--) {
    const candidate = visible[index]!;
    const parent = candidate.candidate.numbering;
    if (!parent) continue;
    if (parent.length !== numbering.length - 1) continue;
    if (parent.every((part, partIndex) => numbering[partIndex] === part)) return candidate;
  }
  return undefined;
}

function nearestTypographyParent(
  visible: readonly MutableOutlineEntry[],
  outlineLevel: number,
): MutableOutlineEntry | undefined {
  if (outlineLevel <= 1) return undefined;
  for (let index = visible.length - 1; index >= 0; index--) {
    const candidate = visible[index]!;
    if (candidate.candidate.outlineLevel < outlineLevel) return candidate;
  }
  return undefined;
}

function validPage(value: PdfOutlineTextPage): boolean {
  return Number.isSafeInteger(value.pageIndex)
    && value.pageIndex >= 0
    && Number.isFinite(value.width)
    && value.width > 0
    && Number.isFinite(value.height)
    && value.height > 0
    && Array.isArray(value.items);
}

function normalizeLineText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/gu, ' ').trim().slice(0, 2_000)
    : '';
}

function documentBodyFontSize(lines: readonly PdfOutlineLine[]): number {
  const prose = lines.filter(line => (
    line.text.length >= 24
    && line.fontWeight < 600
    && !CAPTION_PREFIX.test(line.text)
    && !EMAIL_ADDRESS.test(line.text)
  ));
  const source = prose.length > 0 ? prose : lines;
  if (source.length === 0) return 10;
  const weighted = source
    .map(line => ({
      size: line.fontSize,
      weight: Math.max(1, Array.from(line.text).length),
    }))
    .sort((left, right) => left.size - right.size);
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cumulative = 0;
  for (const item of weighted) {
    cumulative += item.weight;
    if (cumulative >= total / 2) return item.size;
  }
  return weighted.at(-1)?.size ?? 10;
}

function repeatedPageBandText(lines: readonly PdfOutlineLine[]): Set<string> {
  const pagesByText = new Map<string, Set<number>>();
  for (const line of lines) {
    const relativeTop = line.top / line.pageHeight;
    if (relativeTop > 0.12 && relativeTop < 0.88) continue;
    const key = normalizedRepeatedText(line.text);
    if (!key || PAGE_NUMBER.test(key)) continue;
    const pages = pagesByText.get(key) ?? new Set<number>();
    pages.add(line.pageIndex);
    pagesByText.set(key, pages);
  }
  return new Set(
    [...pagesByText.entries()]
      .filter(([, pages]) => pages.size >= 2)
      .map(([text]) => text),
  );
}

function lineStyleCounts(lines: readonly PdfOutlineLine[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = pdfOutlineStyleKey(line);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function unnumberedTypographyLevels(
  candidates: readonly PdfHeadingCandidate[],
): Map<string, number> {
  const styles = new Map<string, { size: number; weight: number }>();
  for (const candidate of candidates) {
    if (candidate.numbering || styles.has(candidate.styleKey)) continue;
    styles.set(candidate.styleKey, {
      size: candidate.fontSize,
      weight: candidate.fontWeight,
    });
  }
  const ordered = [...styles.entries()].sort((left, right) => (
    right[1].size - left[1].size
    || right[1].weight - left[1].weight
    || left[0].localeCompare(right[0])
  ));
  return new Map(ordered.map(([style], index) => [style, index + 1]));
}

function pdfOutlineStyleKey(line: PdfOutlineLine): string {
  return `${Math.round(line.fontSize * 2) / 2}:${line.fontWeight >= 600 ? 'bold' : 'regular'}`;
}

function rejectHeadingLine(
  line: PdfOutlineLine,
  repeatedBands: ReadonlySet<string>,
): boolean {
  const text = line.text;
  const words = text.split(/\s+/u);
  return repeatedBands.has(normalizedRepeatedText(text))
    || PAGE_NUMBER.test(text)
    || EMAIL_ADDRESS.test(text)
    || CAPTION_PREFIX.test(text)
    || BULLET_PREFIX.test(text)
    || BIBLIOGRAPHY_PREFIX.test(text)
    || EQUATION_LIKE.test(text)
    || text.length > 160
    || words.length > 18;
}

function titleLikeLine(text: string): boolean {
  if (!/^[\p{Lu}\p{Lt}\d]/u.test(text)) return false;
  if (/[.!?;,:]$/u.test(text)) return false;
  return text.split(/\s+/u).length <= 14;
}

function hasHeadingWhitespace(
  lines: readonly PdfOutlineLine[],
  index: number,
): boolean {
  const line = lines[index];
  if (!line) return false;
  let previous: PdfOutlineLine | undefined;
  let next: PdfOutlineLine | undefined;
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    if (lines[cursor]!.pageIndex !== line.pageIndex) break;
    previous = lines[cursor];
    break;
  }
  for (let cursor = index + 1; cursor < lines.length; cursor++) {
    if (lines[cursor]!.pageIndex !== line.pageIndex) break;
    next = lines[cursor];
    break;
  }
  const threshold = Math.max(4, line.fontSize * 0.55);
  const before = previous ? line.top - previous.bottom : 0;
  const after = next ? next.top - line.bottom : 0;
  return before >= threshold || after >= threshold;
}

function normalizedRepeatedText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\d+/gu, '#')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}
