import { createHash } from 'crypto';
import { Database } from '../db/connection';

export const LOCAL_EMBEDDING_MODEL = 'hl-local-hash-v1';
export const LOCAL_EMBEDDING_DIMENSIONS = 64;

export interface EmbeddingRefreshResult {
  model_id: string;
  dimensions: number;
  scanned: number;
  embedded: number;
  skipped: number;
}

export interface EmbeddingStatus {
  model_id: string;
  total_chunks: number;
  embedded_chunks: number;
  missing_chunks: number;
  stale_chunks: number;
}

export function embedText(text: string, dimensions = LOCAL_EMBEDDING_DIMENSIONS): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  for (const token of tokenize(text)) {
    const hash = createHash('sha256').update(token).digest();
    const slot = hash.readUInt32BE(0) % dimensions;
    const sign = (hash[4]! & 1) === 0 ? 1 : -1;
    vector[slot] = (vector[slot] ?? 0) + sign * (1 + Math.log1p(token.length));
  }
  return normalize(vector);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

export function refreshEmbeddings(
  db: Database,
  options: { changedOnly?: boolean; modelId?: string; dimensions?: number } = {},
): EmbeddingRefreshResult {
  const modelId = options.modelId ?? LOCAL_EMBEDDING_MODEL;
  const dimensions = options.dimensions ?? LOCAL_EMBEDDING_DIMENSIONS;
  const chunks = db.prepare(`
    SELECT id, text, content_hash
    FROM chunks
    WHERE active = 1
    ORDER BY id
  `).all() as Array<{ id: string; text: string; content_hash: string }>;

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO chunk_embeddings
      (chunk_id, model_id, dimensions, content_hash, vector_json, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);

  let embedded = 0;
  let skipped = 0;

  const txn = db.transaction(() => {
    for (const chunk of chunks) {
      if (options.changedOnly) {
        const existing = db.prepare(`
          SELECT content_hash
          FROM chunk_embeddings
          WHERE chunk_id = ? AND model_id = ?
        `).get(chunk.id, modelId) as { content_hash: string } | undefined;
        if (existing?.content_hash === chunk.content_hash) {
          skipped++;
          continue;
        }
      }

      const vector = embedText(chunk.text, dimensions);
      upsert.run(chunk.id, modelId, dimensions, chunk.content_hash, JSON.stringify(vector));
      embedded++;
    }
  });

  txn();

  return {
    model_id: modelId,
    dimensions,
    scanned: chunks.length,
    embedded,
    skipped,
  };
}

export function getEmbeddingStatus(
  db: Database,
  modelId: string = LOCAL_EMBEDDING_MODEL,
): EmbeddingStatus {
  const totals = db.prepare(`
    SELECT COUNT(*) as c
    FROM chunks
    WHERE active = 1
  `).get() as { c: number };

  const embedded = db.prepare(`
    SELECT COUNT(*) as c
    FROM chunks c
    JOIN chunk_embeddings e ON e.chunk_id = c.id
    WHERE c.active = 1 AND e.model_id = ? AND e.content_hash = c.content_hash
  `).get(modelId) as { c: number };

  const stale = db.prepare(`
    SELECT COUNT(*) as c
    FROM chunks c
    JOIN chunk_embeddings e ON e.chunk_id = c.id
    WHERE c.active = 1 AND e.model_id = ? AND e.content_hash != c.content_hash
  `).get(modelId) as { c: number };

  return {
    model_id: modelId,
    total_chunks: totals.c,
    embedded_chunks: embedded.c,
    missing_chunks: Math.max(0, totals.c - embedded.c),
    stale_chunks: stale.c,
  };
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/i).filter(t => t.length > 1);
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map(value => Number((value / norm).toFixed(8)));
}
