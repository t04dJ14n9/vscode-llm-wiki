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
  ingestFile,
  refreshEmbeddings,
  HlConfigSchema,
  LOCAL_EMBEDDING_MODEL,
} = core;

function makeVault() {
  const root = mkdtempSync(join(tmpdir(), 'hl-embed-'));
  initVault(root, 'Embedding Test Vault');
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

test('local mode uses hash-vector and model_id is hl-local-hash-v1', async () => {
  const root = makeVault();
  writeFileSync(join(root, 'notes', 'Concepts', 'A.md'), '# A\n\nAttention mechanism.\n');
  await withDb(root, async (db) => {
    const source = registerSource(db, root, 'notes/Concepts/A.md');
    ingestFile(db, root, 'notes/Concepts/A.md', source.id);

    const result = await refreshEmbeddings(db, { changedOnly: true });
    assert.equal(result.model_id, LOCAL_EMBEDDING_MODEL);
    assert.equal(result.embedded, 1);
    assert.equal(result.skipped, 0);
  });
});

test('HlConfigSchema parses full remote config', () => {
  const config = HlConfigSchema.parse({
    version: 1,
    embeddings: {
      mode: 'remote',
      provider: 'ollama',
      model: 'nomic-embed-text',
      base_url: 'http://localhost:11434',
      dimensions: 768,
    },
  });
  assert.equal(config.embeddings.mode, 'remote');
  assert.equal(config.embeddings.provider, 'ollama');
  assert.equal(config.embeddings.model, 'nomic-embed-text');
  assert.equal(config.embeddings.base_url, 'http://localhost:11434');
  assert.equal(config.embeddings.dimensions, 768);
});

test('HlConfigSchema defaults mode to local', () => {
  const config = HlConfigSchema.parse({});
  assert.equal(config.embeddings.mode, 'local');
});

test('disabled mode behaves like local (backward compat)', async () => {
  const root = makeVault();
  writeFileSync(join(root, 'notes', 'Concepts', 'B.md'), '# B\n\nBackward compat.\n');
  await withDb(root, async (db) => {
    const source = registerSource(db, root, 'notes/Concepts/B.md');
    ingestFile(db, root, 'notes/Concepts/B.md', source.id);

    const config = HlConfigSchema.parse({ embeddings: { mode: 'disabled' } });
    const result = await refreshEmbeddings(db, { changedOnly: false, config });
    assert.equal(result.model_id, LOCAL_EMBEDDING_MODEL);
    assert.equal(result.embedded, 1);
  });
});

test('remote mode with unreachable server returns embedded=0 and skipped=N without throwing', async () => {
  const root = makeVault();
  writeFileSync(join(root, 'notes', 'Concepts', 'C.md'), '# C\n\nRemote test.\n');
  await withDb(root, async (db) => {
    const source = registerSource(db, root, 'notes/Concepts/C.md');
    ingestFile(db, root, 'notes/Concepts/C.md', source.id);

    const config = HlConfigSchema.parse({
      embeddings: {
        mode: 'remote',
        provider: 'ollama',
        model: 'nomic-embed-text',
        base_url: 'http://127.0.0.1:19999',
      },
    });

    let result;
    assert.doesNotThrow(async () => {
      result = await refreshEmbeddings(db, { changedOnly: false, config });
    });
    result = await refreshEmbeddings(db, { changedOnly: false, config });
    assert.equal(result.embedded, 0);
    assert.ok(result.skipped >= 1);
  });
});
