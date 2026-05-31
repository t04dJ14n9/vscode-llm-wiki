import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Database } from '../db/connection';
import { pdfHref } from '../links/reference-target';
import { getSource, registerSource } from '../sources/registry';
import { appendAnchorToFile } from './store';

export interface AnchorRecord {
  id: string;
  source_id: string;
  kind: string;
  uri: string;
  locator_json: string;
  text_quote: string | null;
  text_hash: string | null;
  source_hash: string | null;
  status: 'resolved' | 'stale' | 'broken' | 'ambiguous';
  confidence: number | null;
}

export interface CreatePdfAnchorOptions {
  quote: string;
  page?: number;
  rects?: number[][];
  textItemIndex?: number;
  charOffset?: number;
  endTextItemIndex?: number;
  endCharOffset?: number;
  createdBy?: 'user' | 'agent' | 'parser' | 'repair';
}

export function createPdfAnchorFromQuote(
  db: Database,
  vaultPath: string,
  sourcePath: string,
  options: CreatePdfAnchorOptions,
): AnchorRecord {
  const quote = normalizeQuote(options.quote);
  if (!quote) {
    throw new Error('Cannot create PDF anchor without a quote');
  }

  const source = getSource(db, sourcePath) ?? registerSource(db, vaultPath, sourcePath, 'pdf');
  const fullPath = sourcePath.startsWith('/') ? sourcePath : join(vaultPath, sourcePath);
  if (!existsSync(fullPath)) {
    throw new Error(`PDF source not found: ${sourcePath}`);
  }

  const raw = readFileSync(fullPath);
  const sourceHash = createHash('sha256').update(raw).digest('hex');
  const text = raw.toString('utf8');
  const normalizedText = normalizeQuote(text);
  const offset = normalizedText.toLowerCase().indexOf(quote.toLowerCase());
  const status = offset >= 0 ? 'resolved' : 'broken';
  const locator = {
    page: options.page ?? inferPage(text, quote),
    rects: options.rects ?? [],
    textItemIndex: options.textItemIndex,
    charOffset: options.charOffset,
    endTextItemIndex: options.endTextItemIndex,
    endCharOffset: options.endCharOffset,
    quote_offset: offset,
    quote_length: quote.length,
    strategy: options.rects?.length ? 'webview-selection' : 'quote-search',
  };
  const id = 'anc_pdf_' + createHash('sha256')
    .update(`${source.id}:${quote}:${locator.page}:${offset}`)
    .digest('hex')
    .substring(0, 12);
  const uri = pdfHref(source.path, { page: locator.page, anchorId: id });
  const textHash = createHash('sha256').update(quote).digest('hex');

  db.prepare(`
    INSERT OR REPLACE INTO anchors
      (id, source_id, kind, uri, locator_json, text_quote, text_hash, source_hash, status, confidence, created_by, updated_at)
    VALUES (?, ?, 'pdf_rect', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    id,
    source.id,
    uri,
    JSON.stringify(locator),
    quote,
    textHash,
    sourceHash,
    status,
    status === 'resolved' ? 1 : 0,
    options.createdBy ?? 'user',
  );

  const record = resolveAnchor(db, id)!;
  appendAnchorToFile(vaultPath, record);
  return record;
}

export function createPdfAnchorFromSelection(
  db: Database,
  vaultPath: string,
  sourcePath: string,
  selection: {
    quote: string;
    page: number;
    textItemIndex?: number;
    charOffset?: number;
    endTextItemIndex?: number;
    endCharOffset?: number;
    rects?: number[][];
    createdBy?: 'user' | 'agent' | 'parser' | 'repair';
  },
): AnchorRecord {
  const quote = normalizeQuote(selection.quote);
  if (!quote) {
    throw new Error('Cannot create PDF anchor without a quote');
  }

  const source = getSource(db, sourcePath) ?? registerSource(db, vaultPath, sourcePath, 'pdf');
  const fullPath = sourcePath.startsWith('/') ? sourcePath : join(vaultPath, sourcePath);
  if (!existsSync(fullPath)) {
    throw new Error(`PDF source not found: ${sourcePath}`);
  }

  const raw = readFileSync(fullPath);
  const sourceHash = createHash('sha256').update(raw).digest('hex');
  const locator = {
    page: selection.page,
    rects: selection.rects ?? [],
    textItemIndex: selection.textItemIndex,
    charOffset: selection.charOffset,
    endTextItemIndex: selection.endTextItemIndex,
    endCharOffset: selection.endCharOffset,
    quote_offset: null,
    quote_length: quote.length,
    strategy: 'webview-selection',
  };
  const id = 'anc_pdf_' + createHash('sha256')
    .update([
      source.id,
      quote,
      selection.page,
      selection.textItemIndex ?? '',
      selection.charOffset ?? '',
      selection.endTextItemIndex ?? '',
      selection.endCharOffset ?? '',
    ].join(':'))
    .digest('hex')
    .substring(0, 12);
  const uri = pdfHref(source.path, { page: locator.page, anchorId: id });
  const textHash = createHash('sha256').update(quote).digest('hex');

  db.prepare(`
    INSERT OR REPLACE INTO anchors
      (id, source_id, kind, uri, locator_json, text_quote, text_hash, source_hash, status, confidence, created_by, updated_at)
    VALUES (?, ?, 'pdf_rect', ?, ?, ?, ?, ?, 'resolved', 1, ?, datetime('now'))
  `).run(
    id,
    source.id,
    uri,
    JSON.stringify(locator),
    quote,
    textHash,
    sourceHash,
    selection.createdBy ?? 'user',
  );

  const record = resolveAnchor(db, id)!;
  appendAnchorToFile(vaultPath, record);
  return record;
}

export function resolveAnchor(db: Database, idOrUri: string): AnchorRecord | null {
  return (db.prepare(`
    SELECT id, source_id, kind, uri, locator_json, text_quote, text_hash, source_hash, status, confidence
    FROM anchors
    WHERE id = ? OR uri = ?
  `).get(idOrUri, idOrUri) as AnchorRecord | undefined) ?? null;
}

function normalizeQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function inferPage(text: string, quote: string): number {
  const normalized = normalizeQuote(text);
  const offset = normalized.toLowerCase().indexOf(normalizeQuote(quote).toLowerCase());
  if (offset < 0) return 1;
  const before = normalized.slice(0, offset);
  const explicit = [...before.matchAll(/\bpage\s+(\d+)\b/gi)].pop();
  if (explicit?.[1]) return Number(explicit[1]);
  return before.split('\f').length;
}
