import { Database } from '../db/connection';
import { createHash } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { basename } from 'path';

export interface SourceRecord {
  id: string;
  path: string;
  kind: 'pdf' | 'html' | 'markdown' | 'code' | 'image' | 'text';
  sha256: string;
  title?: string;
  original_url?: string;
}

function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

export function registerSource(
  db: Database,
  vaultPath: string,
  relativePath: string,
  kind?: string
): SourceRecord {
  const fullPath = relativePath.startsWith('/') ? relativePath : `${vaultPath}/${relativePath}`;
  const sha256 = hashFile(fullPath);

  // Deduplicate by hash — same content under different name?
  const existingByHash = db.prepare(
    'SELECT id, path FROM sources WHERE sha256 = ?'
  ).get(sha256) as { id: string; path: string } | undefined;

  if (existingByHash && existingByHash.path !== relativePath) {
    return {
      id: existingByHash.id,
      path: existingByHash.path,
      kind: (kind || detectKind(relativePath)) as SourceRecord['kind'],
      sha256,
    };
  }

  const sourceId = 'src_' + sha256.substring(0, 12);
  const detectedKind = kind || detectKind(relativePath);
  const title = basename(relativePath, extension(relativePath));

  db.prepare(`
    INSERT OR REPLACE INTO sources (id, path, kind, sha256, title, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(sourceId, relativePath, detectedKind, sha256, title);

  return { id: sourceId, path: relativePath, kind: detectedKind as SourceRecord['kind'], sha256, title };
}

export function getSource(db: Database, idOrPath: string): SourceRecord | null {
  return (db.prepare(
    'SELECT id, path, kind, sha256, title, original_url FROM sources WHERE id = ? OR path = ?'
  ).get(idOrPath, idOrPath) as SourceRecord) || null;
}

export function listSources(db: Database, kind?: string): SourceRecord[] {
  if (kind) {
    return db.prepare('SELECT id, path, kind, sha256, title FROM sources WHERE kind = ? ORDER BY path')
      .all(kind) as SourceRecord[];
  }
  return db.prepare('SELECT id, path, kind, sha256, title FROM sources ORDER BY kind, path')
    .all() as SourceRecord[];
}

function detectKind(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return 'pdf';
    case 'html': case 'htm': return 'html';
    case 'md': return 'markdown';
    case 'txt': case 'text': return 'text';
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp': return 'image';
    default: return 'code';
  }
}

function extension(filePath: string): string {
  const match = filePath.match(/\.([^.]+)$/);
  return match ? '.' + match[1] : '';
}
