import { randomUUID } from 'node:crypto';
import type { Database } from '../db/connection';

export interface ActivityEvent {
  event_type:
    | 'open_note' | 'open_pdf' | 'open_code' | 'open_web'
    | 'view_page' | 'view_section'
    | 'select_text' | 'create_link' | 'export_context'
    | 'create_anchor' | 'create_review_item' | 'record_review';
  source_id?: string;
  anchor_id?: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}
export function recordActivity(db: Database, event: ActivityEvent): void {
  try {
    const id = 'act_' + randomUUID().replace(/-/g, '').substring(0, 12);
    db.prepare(`
      INSERT INTO activity (id, source_id, anchor_id, event_type, duration_ms, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      event.source_id ?? null,
      event.anchor_id ?? null,
      event.event_type,
      event.duration_ms ?? null,
      JSON.stringify(event.metadata ?? {}),
    );
  } catch {
    // Activity recording must never break callers
  }
}
