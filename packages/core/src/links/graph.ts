import { Database } from '../db/connection';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseMarkdownLinks, ParsedLink } from './link-parser';
import { parseHlUri } from './uri-parser';

export interface LinkRecord {
  id: string;
  from_note_path: string;
  from_line: number;
  to_uri: string;
  to_anchor_id: string | null;
  label: string | null;
  relation: string;
  status: string;
}

/** Rebuild all parser-generated links for a single note */
export function rebuildLinksForNote(
  db: Database,
  vaultPath: string,
  notePath: string,
  notePaths = markdownSourcePaths(db),
): { deleted: number; inserted: number } {
  // Delete existing parser links for this note
  const deleted = db.prepare(
    "DELETE FROM links WHERE from_note_path = ? AND created_by = 'parser'"
  ).run(notePath).changes;

  const fullPath = join(vaultPath, notePath);
  if (!existsSync(fullPath)) {
    return { deleted, inserted: 0 };
  }

  const content = readFileSync(fullPath, 'utf-8');
  const parsedLinks = parseMarkdownLinks(content, notePath, { notePaths });

  const insertLink = db.prepare(`
    INSERT INTO links (id, from_note_path, from_line, to_uri, to_anchor_id, label, relation, created_by, status)
    VALUES (?, ?, ?, ?, ?, ?, 'references', 'parser', 'resolved')
  `);

  let inserted = 0;
  for (const link of parsedLinks) {
    const linkId = 'lnk_' + createHash('sha256')
      .update(`${notePath}:${link.line}:${link.uri}`)
      .digest('hex').substring(0, 12);
    const parsed = parseHlUri(link.uri);
    const anchorId = parsed?.anchorId ?? (parsed?.kind === 'anchor' ? parsed.path ?? null : null);
    insertLink.run(linkId, notePath, link.line, link.uri, anchorId, link.label);
    inserted++;
  }
  return { deleted, inserted };
}

/** Rebuild all links for all notes */
export function rebuildAllLinks(
  db: Database,
  vaultPath: string,
): { notes: number; total_deleted: number; total_inserted: number } {
  const notes = db.prepare(
    "SELECT path FROM sources WHERE kind = 'markdown'"
  ).all() as Array<{ path: string }>;
  const notePaths = notes.map(note => note.path);

  let totalDeleted = 0;
  let totalInserted = 0;
  let processedNotes = 0;

  const transaction = db.transaction(() => {
    for (const { path } of notes) {
      const exists = existsSync(join(vaultPath, path));
      const result = rebuildLinksForNote(db, vaultPath, path, notePaths);
      totalDeleted += result.deleted;
      totalInserted += result.inserted;
      if (exists) {
        processedNotes++;
      }
    }
  });

  transaction();
  return { notes: processedNotes, total_deleted: totalDeleted, total_inserted: totalInserted };
}

function markdownSourcePaths(db: Database): string[] {
  return (db.prepare(
    "SELECT path FROM sources WHERE kind = 'markdown'"
  ).all() as Array<{ path: string }>).map(note => note.path);
}

/** Get backlinks (incoming links) to a URI */
export function getBacklinks(
  db: Database,
  toUri: string,
): LinkRecord[] {
  return db.prepare(`
    SELECT id, from_note_path, from_line, to_uri, to_anchor_id, label, relation, status
    FROM links
    WHERE to_uri = ? AND status = 'resolved'
    ORDER BY from_note_path, from_line
  `).all(toUri) as LinkRecord[];
}

/** Get forward links (outgoing links) from a note */
export function getForwardLinks(
  db: Database,
  fromNotePath: string,
): LinkRecord[] {
  return db.prepare(`
    SELECT id, from_note_path, from_line, to_uri, to_anchor_id, label, relation, status
    FROM links
    WHERE from_note_path = ? AND status = 'resolved'
    ORDER BY from_line
  `).all(fromNotePath) as LinkRecord[];
}

/** Check links and return diagnostics */
export function checkLinks(
  db: Database,
): Array<{ link_id: string; status: string; message: string }> {
  const issues: Array<{ link_id: string; status: string; message: string }> = [];

  const links = db.prepare("SELECT id, from_note_path, to_uri, to_anchor_id FROM links").all() as LinkRecord[];

  for (const link of links) {
    const linkIssues: Array<{ link_id: string; status: string; message: string }> = [];
    const parsed = parseHlUri(link.to_uri);
    if (!parsed) {
      linkIssues.push({
        link_id: link.id,
        status: 'broken',
        message: `Invalid Human Learning URI: ${link.to_uri}`,
      });
    } else if (parsed.kind === 'note' && parsed.path) {
      const notePath = decodeURIComponent(parsed.path);
      const source = db.prepare('SELECT id FROM sources WHERE path = ?').get(notePath);
      if (!source) {
        linkIssues.push({
          link_id: link.id,
          status: 'broken',
          message: `Target note not found: ${notePath}`,
        });
      }
    } else if ((parsed.kind === 'pdf' || parsed.kind === 'code' || parsed.kind === 'web' || parsed.kind === 'image') && parsed.path) {
      const sourcePath = decodeURIComponent(parsed.path);
      const source = db.prepare('SELECT id FROM sources WHERE path = ?').get(sourcePath);
      if (!source) {
        linkIssues.push({
          link_id: link.id,
          status: 'broken',
          message: `Target source not found: ${sourcePath}`,
        });
      }
    }

    // Check if target anchor exists
    const anchorId = parsed
      ? link.to_anchor_id ?? parsed.anchorId ?? (parsed.kind === 'anchor' ? parsed.path : undefined)
      : link.to_anchor_id;
    if (anchorId) {
      const anchor = db.prepare('SELECT id FROM anchors WHERE id = ?').get(anchorId);
      if (!anchor) {
        linkIssues.push({
          link_id: link.id,
          status: 'broken',
          message: `Target anchor not found: ${anchorId}`,
        });
      }
    }

    const nextStatus = linkIssues.length > 0 ? 'broken' : 'resolved';
    db.prepare(
      "UPDATE links SET status = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(nextStatus, link.id);
    issues.push(...linkIssues);
  }

  return issues;
}

/** Fix broken links where a safe repair is possible */
export function safeRepairLinks(
  db: Database,
): { fixed: number; ambiguous: number } {
  let fixed = 0;
  let ambiguous = 0;

  const brokenLinks = db.prepare(
    "SELECT id, to_uri FROM links WHERE status = 'broken'"
  ).all() as Array<{ id: string; to_uri: string }>;

  for (const link of brokenLinks) {
    if (link.to_uri.startsWith('hl://note/')) {
      const notePath = link.to_uri.replace('hl://note/', '');
      // Try fuzzy match: case-insensitive
      const matches = db.prepare(
        'SELECT path FROM sources WHERE LOWER(path) = LOWER(?)'
      ).all(notePath) as Array<{ path: string }>;

      if (matches.length === 1) {
        const newUri = `hl://note/${matches[0]!.path}`;
        db.prepare(
          "UPDATE links SET to_uri = ?, status = 'resolved', updated_at = datetime('now') WHERE id = ?"
        ).run(newUri, link.id);
        fixed++;
      } else if (matches.length > 1) {
        ambiguous++;
      }
    }
  }

  return { fixed, ambiguous };
}
