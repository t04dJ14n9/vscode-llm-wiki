import { createHash } from 'crypto';
import { Database } from '../db/connection';

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
