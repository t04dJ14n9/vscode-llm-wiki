import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Database } from '../db/connection';
import { registerSource, SourceRecord } from '../sources/registry';
import { appendAnchorToFile } from '../anchors/store';

export interface WebTargetRecord {
  id: string;
  url: string;
  title: string | null;
  selected_text: string | null;
  text_fragment: string | null;
  css_selector: string | null;
  xpath: string | null;
  text_hash: string | null;
  captured_at: string;
  updated_at: string;
  metadata_json: string;
}

export interface UpsertWebTargetInput {
  id?: string;
  url: string;
  title?: string;
  selectedText?: string;
  textFragment?: string;
  cssSelector?: string;
  xpath?: string;
  metadata?: Record<string, unknown>;
}

export interface PersistWebPageSnapshotInput extends UpsertWebTargetInput {
  html: string;
  selectedHtml?: string;
}

export interface WebAnchorRecord {
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

export interface PersistWebPageSnapshotResult {
  status: 'ok';
  persistedPath: string;
  source: SourceRecord;
  target: WebTargetRecord;
  anchor: WebAnchorRecord;
  href: string;
  markdownLink: string;
  quoteMarkdown: string;
}

export function upsertWebTarget(db: Database, input: UpsertWebTargetInput): WebTargetRecord {
  const textHash = input.selectedText
    ? createHash('sha256').update(input.selectedText).digest('hex')
    : null;
  const id = input.id ?? 'web_' + createHash('sha256')
    .update([input.url, input.selectedText ?? '', input.cssSelector ?? '', input.xpath ?? ''].join('\n'))
    .digest('hex')
    .substring(0, 12);

  db.prepare(`
    INSERT OR REPLACE INTO web_targets
      (id, url, title, selected_text, text_fragment, css_selector, xpath, text_hash, updated_at, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `).run(
    id,
    input.url,
    input.title ?? null,
    input.selectedText ?? null,
    input.textFragment ?? null,
    input.cssSelector ?? null,
    input.xpath ?? null,
    textHash,
    JSON.stringify(input.metadata ?? {}),
  );

  return resolveWebTarget(db, id)!;
}

export function resolveWebTarget(db: Database, id: string): WebTargetRecord | null {
  return (db.prepare(`
    SELECT id, url, title, selected_text, text_fragment, css_selector, xpath, text_hash,
      captured_at, updated_at, metadata_json
    FROM web_targets
    WHERE id = ?
  `).get(id) as WebTargetRecord | undefined) ?? null;
}

export function persistWebPageSnapshot(
  db: Database,
  vaultPath: string,
  input: PersistWebPageSnapshotInput,
): PersistWebPageSnapshotResult {
  const title = normalizedTitle(input.title, input.url);
  const contentHash = createHash('sha256').update(input.html).digest('hex');
  const persistedPath = `raw/web/${slugify(title)}-${contentHash.slice(0, 12)}.html`;
  const fullPath = join(vaultPath, persistedPath);
  mkdirSync(join(vaultPath, 'raw', 'web'), { recursive: true });
  writeFileSync(fullPath, input.html);

  const source = registerSource(db, vaultPath, persistedPath, 'html');
  db.prepare(`
    UPDATE sources
    SET title = ?, original_url = ?, metadata_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title,
    input.url,
    JSON.stringify({
      original_url: input.url,
      persisted_from: 'web-browser',
      selected_html: input.selectedHtml ?? null,
      ...(input.metadata ?? {}),
    }),
    source.id,
  );
  source.title = title;
  source.original_url = input.url;

  const target = upsertWebTarget(db, {
    url: input.url,
    title,
    selectedText: input.selectedText,
    textFragment: input.textFragment,
    cssSelector: input.cssSelector,
    xpath: input.xpath,
    metadata: {
      persistedPath,
      sourceId: source.id,
      selectedHtml: input.selectedHtml ?? null,
      ...(input.metadata ?? {}),
    },
  });
  const href = webTargetHref(target);
  const quote = normalizeQuote(input.selectedText ?? '');
  const anchor = createWebDomAnchor(db, source, target, {
    href,
    quote,
    selectedHtml: input.selectedHtml,
    persistedPath,
  });
  appendAnchorToFile(vaultPath, anchor);

  const markdownLink = `[${escapeMarkdownLabel(title)}](${href})`;
  return {
    status: 'ok',
    persistedPath,
    source,
    target,
    anchor,
    href,
    markdownLink,
    quoteMarkdown: formatQuoteAndLink(quote, markdownLink),
  };
}

export function webTargetHref(
  target: Pick<WebTargetRecord, 'id' | 'url'> & Partial<Pick<WebTargetRecord, 'text_fragment'>>,
): string {
  const fragmentDirective = textFragmentDirective(target.text_fragment);
  const hash = `hl-web=${encodeURIComponent(target.id)}${fragmentDirective ? `:~:${fragmentDirective}` : ''}`;
  try {
    const parsed = new URL(target.url);
    parsed.hash = hash;
    return parsed.toString();
  } catch {
    return `${target.url.replace(/#.*$/, '')}#${hash}`;
  }
}

function textFragmentDirective(textFragment: string | null | undefined): string | undefined {
  const raw = textFragment?.trim();
  if (!raw) return undefined;
  const match = raw.match(/:~:(.+)$/);
  return match?.[1] || undefined;
}

function createWebDomAnchor(
  db: Database,
  source: SourceRecord,
  target: WebTargetRecord,
  options: {
    href: string;
    quote: string;
    selectedHtml?: string;
    persistedPath: string;
  },
): WebAnchorRecord {
  const textHash = options.quote
    ? createHash('sha256').update(options.quote).digest('hex')
    : null;
  const id = 'anc_web_' + createHash('sha256')
    .update([
      source.id,
      target.id,
      options.quote,
      target.css_selector ?? '',
      target.xpath ?? '',
    ].join('\n'))
    .digest('hex')
    .substring(0, 12);
  const locator = {
    strategy: target.selected_text ? 'text-fragment' : 'whole-page',
    targetId: target.id,
    url: target.url,
    textFragment: target.text_fragment,
    cssSelector: target.css_selector,
    xpath: target.xpath,
    persistedPath: options.persistedPath,
    selectedHtml: options.selectedHtml ?? null,
  };

  db.prepare(`
    INSERT OR REPLACE INTO anchors
      (id, source_id, kind, uri, locator_json, text_quote, text_hash, source_hash, status, confidence, created_by, updated_at)
    VALUES (?, ?, 'dom_range', ?, ?, ?, ?, ?, 'resolved', ?, 'user', datetime('now'))
  `).run(
    id,
    source.id,
    options.href,
    JSON.stringify(locator),
    options.quote || null,
    textHash,
    source.sha256,
    target.selected_text ? 1 : 0.75,
  );

  return db.prepare(`
    SELECT id, source_id, kind, uri, locator_json, text_quote, text_hash, source_hash, status, confidence
    FROM anchors
    WHERE id = ?
  `).get(id) as WebAnchorRecord;
}

function normalizedTitle(title: string | undefined, url: string): string {
  const cleanTitle = title?.replace(/\s+/g, ' ').trim();
  if (cleanTitle) return cleanTitle;
  try {
    const parsed = new URL(url);
    return parsed.hostname || 'Web Page';
  } catch {
    return 'Web Page';
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'web-page';
}

function normalizeQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function escapeMarkdownLabel(input: string): string {
  return input.replace(/]/g, '\\]');
}

function formatQuoteAndLink(quote: string, markdownLink: string): string {
  if (!quote) return markdownLink;
  return `> ${quote}\n>\n> ${markdownLink}`;
}
