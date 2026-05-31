import { Database } from '../db/connection';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractPdfFullText } from './pdf-extract';

interface RawChunk {
  title: string;
  text: string;
  lineStart: number;
  lineEnd: number;
  metadata?: Record<string, unknown>;
}

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

/** Chunk PDF text into layout-ish blocks with durable locator metadata. */
export function chunkPdfText(content: string, sourcePath: string): RawChunk[] {
  const pages = content.split('\f').filter(s => s.trim());
  const chunks: RawChunk[] = [];

  pages.forEach((pageText, pageIndex) => {
    const page = pageIndex + 1;
    const blocks = splitPdfPageIntoBlocks(pageText);
    let readingOrder = 0;
    let pageOffset = 0;
    for (const block of blocks) {
      const textOffsetStart = pageText.indexOf(block.text, pageOffset);
      const textOffsetEnd = textOffsetStart >= 0 ? textOffsetStart + block.text.length : undefined;
      if (textOffsetEnd !== undefined) pageOffset = textOffsetEnd;
      chunks.push({
        title: `${sourcePath} p.${page} ${block.type}`,
        text: block.text,
        lineStart: block.lineStart,
        lineEnd: block.lineEnd,
        metadata: {
          source_path: sourcePath,
          page_start: page,
          page_end: page,
          block_type: block.type,
          reading_order: readingOrder++,
          text_offset_start: textOffsetStart >= 0 ? textOffsetStart : null,
          text_offset_end: textOffsetEnd ?? null,
          bbox_rects: [],
          section_path: [],
          source_hash: hashContent(content),
          chunk_hash: hashContent(block.text),
        },
      });
    }
  });

  return chunks;
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

  let rawChunks: RawChunk[];
  let chunkIdPrefix = 'chk_';

  if (ext === 'pdf') {
    // Extract text from PDF and chunk by page
    const content = await extractPdfFullText(fullPath);
    if (!content.trim()) {
      return { chunkCount: 0, newChunks: 0, updatedChunks: 0 };
    }
    rawChunks = chunkPdfText(content, relativePath);
    chunkIdPrefix = 'chk_pdf_';
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
      const chunkId = chunkIdPrefix + ch.substring(0, 12);

      const existing = db.prepare(
        'SELECT content_hash FROM chunks WHERE id = ?'
      ).get(chunkId) as { content_hash: string } | undefined;

      if (existing) {
        if (existing.content_hash !== ch) {
          insertChunk.run(chunkId, sourceId, c.text, c.title, tokenCount(c.text), ch, JSON.stringify({
            line_start: c.lineStart,
            line_end: c.lineEnd,
            source_path: relativePath,
            ...(c.metadata ?? {}),
          }));
          updatedCount++;
        }
      } else {
        insertChunk.run(chunkId, sourceId, c.text, c.title, tokenCount(c.text), ch, JSON.stringify({
          line_start: c.lineStart,
          line_end: c.lineEnd,
          source_path: relativePath,
          ...(c.metadata ?? {}),
        }));
        newCount++;
      }
    }
  });

  transaction();

  // Rebuild search index (simple token-based, no FTS5 dependency)
  for (const c of rawChunks) {
    const ch = hashContent(c.text);
    const chunkId = chunkIdPrefix + ch.substring(0, 12);
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

function splitPdfPageIntoBlocks(pageText: string): Array<{
  text: string;
  lineStart: number;
  lineEnd: number;
  type: 'paragraph' | 'heading' | 'caption' | 'table' | 'list' | 'formula';
}> {
  const lines = pageText.split('\n');
  const blocks: Array<{ text: string; lineStart: number; lineEnd: number; type: 'paragraph' | 'heading' | 'caption' | 'table' | 'list' | 'formula' }> = [];
  let current: string[] = [];
  let start = 1;

  const flush = (endLine: number) => {
    const text = current.join('\n').trim();
    if (!text) {
      current = [];
      return;
    }
    blocks.push({
      text,
      lineStart: start,
      lineEnd: endLine,
      type: classifyPdfBlock(text),
    });
    current = [];
  };

  lines.forEach((line, index) => {
    if (!line.trim()) {
      flush(index);
      start = index + 2;
      return;
    }
    if (current.length === 0) start = index + 1;
    current.push(line);
  });
  flush(lines.length);

  if (blocks.length > 0) return blocks;
  const trimmed = pageText.trim();
  return trimmed
    ? [{ text: trimmed, lineStart: 1, lineEnd: lines.length, type: classifyPdfBlock(trimmed) }]
    : [];
}

function classifyPdfBlock(text: string): 'paragraph' | 'heading' | 'caption' | 'table' | 'list' | 'formula' {
  const first = text.split('\n').find(line => line.trim())?.trim() ?? '';
  if (/^(figure|fig\.|table)\s+\d+/i.test(first)) return 'caption';
  if (/^[-*•]\s+|^\d+\.\s+/.test(first)) return 'list';
  if ((text.match(/\|/g)?.length ?? 0) >= 2 || /\t/.test(text)) return 'table';
  if (/[$=∑∫√≤≥≈]/.test(text) && text.length < 240) return 'formula';
  if (text.length < 120 && /^[A-Z0-9][A-Za-z0-9 .:-]+$/.test(first) && !/[.!?]$/.test(first)) return 'heading';
  return 'paragraph';
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
