import { existsSync, readFileSync, mkdirSync, appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AnchorRecord } from './pdf';

const ANCHORS_FILE = '.hl/anchors/anchors.jsonl';

function anchorsDir(vaultPath: string): string {
  return join(vaultPath, '.hl', 'anchors');
}

function anchorsPath(vaultPath: string): string {
  return join(vaultPath, ANCHORS_FILE);
}

/** Read all anchors from the canonical JSONL file */
export function readAnchorsFile(vaultPath: string): AnchorRecord[] {
  const path = anchorsPath(vaultPath);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf-8');
  const anchors: AnchorRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.id) anchors.push(parsed as AnchorRecord);
    } catch {
      // skip malformed lines
    }
  }
  return anchors;
}

/** Append a single anchor as a JSON line to the canonical file */
export function appendAnchorToFile(vaultPath: string, anchor: AnchorRecord): void {
  const dir = anchorsDir(vaultPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Upsert: read all, replace if id exists, write back
  const all = readAnchorsFile(vaultPath);
  const idx = all.findIndex(a => a.id === anchor.id);
  if (idx >= 0) {
    all[idx] = anchor;
  } else {
    all.push(anchor);
  }
  writeAnchorsFileFromList(vaultPath, all);
}

/** Rewrite the entire anchors JSONL from an in-memory list */
function writeAnchorsFileFromList(vaultPath: string, anchors: AnchorRecord[]): void {
  const dir = anchorsDir(vaultPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const lines = anchors.map(a => JSON.stringify(a)).join('\n') + (anchors.length > 0 ? '\n' : '');
  writeFileSync(anchorsPath(vaultPath), lines);
}

/** Rebuild SQLite anchors from the canonical JSONL — used by `hl index rebuild` */
export function anchorsFromJsonl(vaultPath: string): AnchorRecord[] {
  return readAnchorsFile(vaultPath);
}

/** Write all in-memory anchors back to JSONL (e.g. after repair) */
export function writeAnchorsFile(vaultPath: string, anchors: AnchorRecord[]): void {
  writeAnchorsFileFromList(vaultPath, anchors);
}
