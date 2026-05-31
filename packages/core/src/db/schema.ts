// SQLite schema for Human Learning.
// Uses sql.js (WASM, zero native deps) — works in VS Code Extension Host + CLI.

export const SCHEMA_VERSION = 2;

export const MIGRATIONS: Record<number, string[]> = {
  1: [
    `CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK(kind IN ('pdf','html','markdown','code','image','text')),
      sha256 TEXT NOT NULL,
      title TEXT,
      original_url TEXT,
      zotero_key TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      metadata_json TEXT NOT NULL DEFAULT '{}'
    )`,

    `CREATE TABLE IF NOT EXISTS anchors (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('pdf_rect','note_block','line_range','heading','symbol','dom_range','image_rect')),
      uri TEXT NOT NULL UNIQUE,
      locator_json TEXT NOT NULL DEFAULT '{}',
      text_quote TEXT,
      text_hash TEXT,
      source_hash TEXT,
      status TEXT NOT NULL DEFAULT 'resolved' CHECK(status IN ('resolved','stale','broken','ambiguous')),
      confidence REAL,
      created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user','agent','parser','repair')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(source_id) REFERENCES sources(id)
    )`,

    `CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      from_note_path TEXT,
      from_line INTEGER,
      from_anchor_id TEXT,
      to_uri TEXT NOT NULL,
      to_anchor_id TEXT,
      label TEXT,
      relation TEXT NOT NULL DEFAULT 'references' CHECK(relation IN ('references','implements','extends','contrasts','supports','refutes')),
      created_by TEXT NOT NULL DEFAULT 'parser' CHECK(created_by IN ('parser','user','agent')),
      confidence REAL,
      status TEXT NOT NULL DEFAULT 'resolved' CHECK(status IN ('resolved','broken','stale','ambiguous')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      anchor_id TEXT,
      collection_id TEXT,
      text TEXT NOT NULL,
      title TEXT,
      token_count INTEGER,
      content_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(source_id) REFERENCES sources(id),
      FOREIGN KEY(anchor_id) REFERENCES anchors(id)
    )`,

    `CREATE TABLE IF NOT EXISTS search_index (
      chunk_id TEXT NOT NULL,
      token TEXT NOT NULL,
      PRIMARY KEY(chunk_id, token),
      FOREIGN KEY(chunk_id) REFERENCES chunks(id)
    )`,

    `CREATE INDEX IF NOT EXISTS idx_search_token ON search_index(token)`,

    `CREATE TABLE IF NOT EXISTS chunk_embeddings (
      chunk_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      dimensions INTEGER,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(chunk_id, model_id)
    )`,

    `CREATE TABLE IF NOT EXISTS learning_objects (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN (
        'concept_card','cloze_card','code_trace','explain_from_memory',
        'bug_hunt','implementation_drill','compare_and_contrast',
        'paper_claim_check','summary_reconstruction','transfer_task'
      )),
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      ideal_answer TEXT,
      hints_json TEXT NOT NULL DEFAULT '[]',
      anchor_ids_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      difficulty_seed REAL NOT NULL DEFAULT 0.5,
      importance REAL NOT NULL DEFAULT 0.5,
      retention_target REAL NOT NULL DEFAULT 0.9,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','suspended','retired')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS review_history (
      id TEXT PRIMARY KEY,
      learning_object_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL,
      confidence REAL,
      latency_ms INTEGER,
      hints_used INTEGER NOT NULL DEFAULT 0,
      source_revealed INTEGER NOT NULL DEFAULT 0,
      correctness TEXT CHECK(correctness IN ('correct','partial','incorrect','skip')),
      scheduled_interval_days INTEGER,
      due_at TEXT,
      reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(learning_object_id) REFERENCES learning_objects(id)
    )`,

    `CREATE TABLE IF NOT EXISTS diagnostics (
      id TEXT PRIMARY KEY,
      severity TEXT NOT NULL CHECK(severity IN ('error','warning','info','hint')),
      kind TEXT NOT NULL,
      source_path TEXT,
      line INTEGER,
      message TEXT NOT NULL,
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      anchor_id TEXT,
      event_type TEXT NOT NULL CHECK(event_type IN (
        'open_note','open_pdf','open_code','open_web',
        'view_page','view_section',
        'select_text','create_link','export_context',
        'create_anchor','create_review_item','record_review'
      )),
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      duration_ms INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(source_id) REFERENCES sources(id),
      FOREIGN KEY(anchor_id) REFERENCES anchors(id)
    )`,

    `CREATE INDEX IF NOT EXISTS idx_anchors_source ON anchors(source_id)`,
    `CREATE INDEX IF NOT EXISTS idx_anchors_uri ON anchors(uri)`,
    `CREATE INDEX IF NOT EXISTS idx_links_from_note ON links(from_note_path)`,
    `CREATE INDEX IF NOT EXISTS idx_links_to_uri ON links(to_uri)`,
    `CREATE INDEX IF NOT EXISTS idx_links_to_anchor ON links(to_anchor_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(content_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_learning_objects_status ON learning_objects(status)`,
    `CREATE INDEX IF NOT EXISTS idx_review_history_object ON review_history(learning_object_id)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity(timestamp)`,

    `CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ],
  2: [
    `ALTER TABLE chunks ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'`,
    `ALTER TABLE chunk_embeddings ADD COLUMN vector_json TEXT NOT NULL DEFAULT '[]'`,
  ],
};
