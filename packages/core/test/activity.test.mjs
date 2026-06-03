import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import core from '../dist/index.js';

const {
  initVault,
  openDatabase,
  runMigrations,
  closeDatabase,
  registerSource,
  recordActivity,
} = core;

function makeVault() {
  const root = mkdtempSync(join(tmpdir(), 'hl-activity-'));
  initVault(root, 'Activity Test Vault');
  mkdirSync(join(root, 'notes', 'Concepts'), { recursive: true });
  return root;
}

async function withDb(root, fn) {
  const db = await openDatabase(root);
  runMigrations(db);
  try {
    return await fn(db);
  } finally {
    closeDatabase(db);
  }
}

test('records activity events and queries by date', async () => {
  const root = makeVault();
  await withDb(root, async (db) => {
    recordActivity(db, { event_type: 'open_note', metadata: { path: 'notes/Concepts/A.md' } });
    recordActivity(db, { event_type: 'view_page', metadata: { page: 3 } });
    recordActivity(db, { event_type: 'export_context', metadata: { source: 'notes/Concepts/A.md' } });

    const row = db.prepare("SELECT COUNT(*) as cnt FROM activity WHERE date(timestamp) = date('now')").get();
    assert.equal(row.cnt, 3);
  });
});

test('recordActivity is silent on invalid source_id (FK violation)', async () => {
  const root = makeVault();
  await withDb(root, async (db) => {
    assert.doesNotThrow(() => {
      recordActivity(db, { event_type: 'open_note', source_id: 'nonexistent_src_id' });
    });
    // Row may or may not be inserted depending on FK enforcement; no exception is the key assertion
  });
});

test('activity metadata_json round-trips correctly', async () => {
  const root = makeVault();
  await withDb(root, async (db) => {
    const meta = { query: 'attention mechanism', page: 7, nested: { score: 0.95 } };
    recordActivity(db, { event_type: 'select_text', metadata: meta });

    const row = db.prepare("SELECT metadata_json FROM activity WHERE event_type = 'select_text'").get();
    assert.ok(row, 'row should exist');
    assert.deepEqual(JSON.parse(row.metadata_json), meta);
  });
});

test('recordActivity with invalid event_type is silently dropped', async () => {
  const root = makeVault();
  await withDb(root, async (db) => {
    assert.doesNotThrow(() => {
      recordActivity(db, { event_type: 'invalid_event_type_xyz' });
    });
    const row = db.prepare("SELECT COUNT(*) as cnt FROM activity WHERE event_type = 'invalid_event_type_xyz'").get();
    assert.equal(row.cnt, 0);
  });
});

test('records activity with source_id from registered source', async () => {
  const root = makeVault();
  writeFileSync(join(root, 'notes', 'Concepts', 'Test.md'), '# Test\n\nContent.\n');
  await withDb(root, async (db) => {
    const source = registerSource(db, root, 'notes/Concepts/Test.md');
    recordActivity(db, { event_type: 'open_note', source_id: source.id, metadata: { path: 'notes/Concepts/Test.md' } });

    const row = db.prepare("SELECT source_id FROM activity WHERE event_type = 'open_note'").get();
    assert.equal(row.source_id, source.id);
  });
});
