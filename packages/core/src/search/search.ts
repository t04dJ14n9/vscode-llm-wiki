import { Database } from '../db/connection';
import { cosineSimilarity, embedText, LOCAL_EMBEDDING_MODEL } from '../embeddings/local';

export interface SearchResult {
  chunk_id: string;
  title: string;
  snippet: string;
  source_path: string;
  source_kind: string;
  rank: number;
  anchor_uri: string;
}

export type SearchMode = 'lexical' | 'semantic' | 'hybrid';

function tokenize(query: string): string[] {
  return [...new Set(
    query.toLowerCase().split(/[^a-z0-9]+/i).filter(t => t.length > 1)
  )];
}

export function searchLexical(
  db: Database,
  query: string,
  limit: number = 10,
): SearchResult[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const placeholders = tokens.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT
      c.id as chunk_id,
      c.title,
      c.text,
      s.path as source_path,
      s.kind as source_kind,
      COUNT(si.token) as matched_tokens,
      c.token_count
    FROM search_index si
    JOIN chunks c ON si.chunk_id = c.id
    JOIN sources s ON c.source_id = s.id
    WHERE si.token IN (${placeholders}) AND c.active = 1
    GROUP BY c.id
    ORDER BY matched_tokens DESC
    LIMIT ?
  `).all(...tokens, limit) as Array<{
    chunk_id: string; title: string; text: string;
    source_path: string; source_kind: string;
    matched_tokens: number; token_count: number;
  }>;

  return rows.map(r => ({
    chunk_id: r.chunk_id,
    title: r.title,
    snippet: r.text.substring(0, 200).replace(/\n/g, ' '),
    source_path: r.source_path,
    source_kind: r.source_kind,
    rank: -r.matched_tokens,
    anchor_uri: uriForSource(r.source_kind, r.source_path),
  }));
}

export function searchSemantic(
  db: Database,
  query: string,
  limit: number = 10,
  modelId: string = LOCAL_EMBEDDING_MODEL,
): SearchResult[] {
  const queryVector = embedText(query);
  const rows = db.prepare(`
    SELECT
      c.id as chunk_id,
      c.title,
      c.text,
      s.path as source_path,
      s.kind as source_kind,
      e.vector_json
    FROM chunk_embeddings e
    JOIN chunks c ON e.chunk_id = c.id
    JOIN sources s ON c.source_id = s.id
    WHERE e.model_id = ? AND c.active = 1
  `).all(modelId) as Array<{
    chunk_id: string;
    title: string;
    text: string;
    source_path: string;
    source_kind: string;
    vector_json: string;
  }>;

  return rows
    .map(row => {
      const vector = parseVector(row.vector_json);
      const score = cosineSimilarity(queryVector, vector);
      return {
        chunk_id: row.chunk_id,
        title: row.title,
        snippet: row.text.substring(0, 200).replace(/\n/g, ' '),
        source_path: row.source_path,
        source_kind: row.source_kind,
        rank: score,
        anchor_uri: uriForSource(row.source_kind, row.source_path),
      };
    })
    .filter(result => result.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit);
}

export function searchHybrid(
  db: Database,
  query: string,
  limit: number = 10,
): SearchResult[] {
  const lexical = searchLexical(db, query, Math.max(limit * 2, 10));
  const semantic = searchSemantic(db, query, Math.max(limit * 2, 10));
  const byChunk = new Map<string, SearchResult & { score: number }>();

  lexical.forEach((result, index) => {
    const existing = byChunk.get(result.chunk_id);
    const score = 1 / (60 + index + 1);
    byChunk.set(result.chunk_id, {
      ...(existing ?? result),
      score: (existing?.score ?? 0) + score,
    });
  });

  semantic.forEach((result, index) => {
    const existing = byChunk.get(result.chunk_id);
    const score = 1 / (60 + index + 1);
    byChunk.set(result.chunk_id, {
      ...(existing ?? result),
      score: (existing?.score ?? 0) + score,
    });
  });

  return [...byChunk.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, ...result }) => ({
      ...result,
      rank: score,
    }));
}

export function searchNotes(
  db: Database,
  query: string,
  limit: number = 10,
): SearchResult[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const placeholders = tokens.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT
      c.id as chunk_id,
      c.title,
      c.text,
      s.path as source_path,
      s.kind as source_kind,
      COUNT(si.token) as matched_tokens
    FROM search_index si
    JOIN chunks c ON si.chunk_id = c.id
    JOIN sources s ON c.source_id = s.id
    WHERE si.token IN (${placeholders}) AND c.active = 1 AND s.kind = 'markdown'
    GROUP BY c.id
    ORDER BY matched_tokens DESC
    LIMIT ?
  `).all(...tokens, limit) as Array<{
    chunk_id: string; title: string; text: string;
    source_path: string; source_kind: string;
    matched_tokens: number;
  }>;

  return rows.map(r => ({
    chunk_id: r.chunk_id,
    title: r.title,
    snippet: r.text.substring(0, 200).replace(/\n/g, ' '),
    source_path: r.source_path,
    source_kind: r.source_kind,
    rank: -r.matched_tokens,
    anchor_uri: uriForSource(r.source_kind, r.source_path),
  }));
}

function parseVector(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(Number) : [];
  } catch {
    return [];
  }
}

function uriForSource(sourceKind: string, sourcePath: string): string {
  const kind = sourceKind === 'markdown' ? 'note' : sourceKind;
  return `hl://${kind}/${encodePath(sourcePath)}`;
}

function encodePath(path: string): string {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}
