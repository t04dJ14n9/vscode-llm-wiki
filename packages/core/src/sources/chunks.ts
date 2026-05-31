import { Database } from '../db/connection';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractPdfFullText } from './pdf-extract';

export interface ChunkRecord {
  id: string;
  source_id: string;
  text: string;
  title: string;
  token_count: number;
  content_hash: string;
  metadata_json?: string;
  line_start?: number;
  line_end?: number;
}

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function tokenCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Chunk markdown by headings (# and ##) */
export function chunkMarkdown(content: string, sourcePath: string): Array<{
  title: string; text: string; lineStart: number; lineEnd: number;
}> {
  const chunks: Array<{ title: string; text: string; lineStart: number; lineEnd: number }> = [];
  const lines = content.split('\n');
  let currentTitle = sourcePath;
  let currentText = '';
  let lineStart = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,2}\s/.test(line) && currentText.trim()) {
      chunks.push({
        title: currentTitle,
        text: currentText.trim(),
        lineStart,
        lineEnd: i,
      });
      currentTitle = line.replace(/^#+\s*/, '').trim();
      currentText = '';
      lineStart = i + 1;
    } else {
      currentText += line + '\n';
    }
  }
  if (currentText.trim()) {
    chunks.push({
      title: currentTitle,
      text: currentText.trim(),
      lineStart,
      lineEnd: lines.length,
    });
  }
  return chunks.length > 0 ? chunks : [{ title: sourcePath, text: content, lineStart: 1, lineEnd: lines.length }];
}

/** Chunk PDF text by page break markers. Each \f-delimited segment is a page chunk. */
export function chunkPdfText(content: string, sourcePath: string): Array<{
  title: string; text: string; lineStart: number; lineEnd: number;
}> {
  const pages = content.split('\f').filter(s => s.trim());
  return pages.map((text, i) => ({
    title: `${sourcePath} p.${i + 1}`,
    text: text.trim(),
    lineStart: 1,
    lineEnd: text.split('\n').length,
  }));
}

/** Chunk code by logical blocks (functions, classes via simple heuristic) */
export function chunkCode(content: string, sourcePath: string): Array<{
  title: string; text: string; lineStart: number; lineEnd: number;
}> {
  const chunks: Array<{ title: string; text: string; lineStart: number; lineEnd: number }> = [];
  const lines = content.split('\n');
  let currentTitle = sourcePath;
  let currentText = '';
  let lineStart = 1;

  // Simple heuristic: chunk at function/class definition lines
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^(export\s+)?(async\s+)?function|^class\s|^pub\s+fn|^def\s|^func\s/.test(line.trim()) && currentText.trim()) {
      chunks.push({
        title: currentTitle,
        text: currentText.trim(),
        lineStart,
        lineEnd: i,
      });
      currentTitle = line.trim().substring(0, 80);
      currentText = '';
      lineStart = i + 1;
    } else {
      currentText += line + '\n';
    }
  }
  if (currentText.trim()) {
    chunks.push({
      title: currentTitle,
      text: currentText.trim(),
      lineStart,
      lineEnd: lines.length,
    });
  }
  return chunks.length > 0 ? chunks : [{ title: sourcePath, text: content, lineStart: 1, lineEnd: lines.length }];
}

/** Ingest file into chunks, updating SQLite and search index */
export async function ingestFile(
  db: Database,
  vaultPath: string,
  relativePath: string,
  sourceId: string,
): Promise<{ chunkCount: number; newChunks: number; updatedChunks: number }> {
  const fullPath = relativePath.startsWith('/') ? relativePath : join(vaultPath, relativePath);
  const ext = relativePath.split('.').pop()?.toLowerCase();

  let rawChunks: Array<{ title: string; text: string; lineStart: number; lineEnd: number }>;

  if (ext === 'pdf') {
    // Extract text from PDF and chunk by page
    const content = await extractPdfFullText(fullPath);
    if (!content.trim()) {
      return { chunkCount: 0, newChunks: 0, updatedChunks: 0 };
    }
    rawChunks = chunkPdfText(content, relativePath);
  } else if (ext === 'md') {
    const content = readFileSync(fullPath, 'utf-8');
    rawChunks = chunkMarkdown(content, relativePath);
  } else {
    const content = readFileSync(fullPath, 'utf-8');
    rawChunks = chunkCode(content, relativePath);
  }

  let newCount = 0;
  let updatedCount = 0;

  const insertChunk = db.prepare(`
    INSERT OR REPLACE INTO chunks (id, source_id, text, title, token_count, content_hash, metadata_json, active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
  `);

  const transaction = db.transaction(() => {
    for (const c of rawChunks) {
      const ch = hashContent(c.text);
      const chunkId = 'chk_' + ch.substring(0, 12);

      const existing = db.prepare(
        'SELECT content_hash FROM chunks WHERE id = ?'
      ).get(chunkId) as { content_hash: string } | undefined;

      if (existing) {
        if (existing.content_hash !== ch) {
          insertChunk.run(chunkId, sourceId, c.text, c.title, tokenCount(c.text), ch, JSON.stringify({
            line_start: c.lineStart,
            line_end: c.lineEnd,
            source_path: relativePath,
          }));
          updatedCount++;
        }
      } else {
        insertChunk.run(chunkId, sourceId, c.text, c.title, tokenCount(c.text), ch, JSON.stringify({
          line_start: c.lineStart,
          line_end: c.lineEnd,
          source_path: relativePath,
        }));
        newCount++;
      }
    }
  });

  transaction();

  // Rebuild search index (simple token-based, no FTS5 dependency)
  for (const c of rawChunks) {
    const ch = hashContent(c.text);
    const chunkId = 'chk_' + ch.substring(0, 12);
    // Delete old tokens and re-index
    db.prepare('DELETE FROM search_index WHERE chunk_id = ?').run(chunkId);
    const tokens = tokenize(c.text);
    const insertToken = db.prepare('INSERT OR REPLACE INTO search_index (chunk_id, token) VALUES (?, ?)');
    for (const token of tokens) {
      insertToken.run(chunkId, token);
    }
  }

  return { chunkCount: rawChunks.length, newChunks: newCount, updatedChunks: updatedCount };
}

/** Simple tokenizer — splits on non-word boundaries, lowercases, filters short tokens */
function tokenize(text: string): string[] {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/i).filter(t => t.length > 1);
  // Deduplicate
  return [...new Set(tokens)];
}

/** Get chunks for a source */
export function getChunks(db: Database, sourceId: string): ChunkRecord[] {
  return db.prepare(
    'SELECT id, source_id, text, title, token_count, content_hash, metadata_json FROM chunks WHERE source_id = ? AND active = 1'
  ).all(sourceId) as ChunkRecord[];
}
