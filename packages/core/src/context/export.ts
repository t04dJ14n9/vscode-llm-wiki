import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Database } from '../db/connection';
import { getBacklinks, getForwardLinks, LinkRecord } from '../links/graph';
import { getSource } from '../sources/registry';
import { resolveAnchor } from '../anchors/pdf';

export interface ExportContextOptions {
  sourcePath?: string;
  anchorId?: string;
  uri?: string;
}

export interface ExportedContext {
  source: string;
  anchor_uri?: string;
  text: string;
  text_hash: string;
  markdown: string;
  backlinks: Array<Pick<LinkRecord, 'from_note_path' | 'from_line' | 'label' | 'to_uri'>>;
  forward_links: Array<Pick<LinkRecord, 'from_line' | 'label' | 'to_uri'>>;
  files: {
    markdown: string;
    json: string;
  };
}

export function exportSourceContext(
  db: Database,
  vaultPath: string,
  options: ExportContextOptions,
): ExportedContext {
  const anchor = options.anchorId ? resolveAnchor(db, options.anchorId) : null;
  const sourcePath = options.sourcePath ?? sourcePathForAnchor(db, anchor?.source_id ?? '');
  if (!sourcePath) {
    throw new Error('Context export requires sourcePath or anchorId');
  }

  const fullPath = sourcePath.startsWith('/') ? sourcePath : join(vaultPath, sourcePath);
  if (!existsSync(fullPath)) {
    throw new Error(`Source not found: ${sourcePath}`);
  }

  const text = readFileSync(fullPath, 'utf8');
  const source = getSource(db, sourcePath);
  const sourceUri = options.uri ?? anchor?.uri ?? uriForSource(source?.kind ?? 'text', sourcePath);
  const backlinks = getBacklinks(db, sourceUri);
  const forwardLinks = sourcePath.endsWith('.md') ? getForwardLinks(db, sourcePath) : [];
  const markdown = renderContextMarkdown({
    sourcePath,
    sourceUri,
    anchorUri: anchor?.uri,
    text,
    backlinks,
    forwardLinks,
  });

  const agentDir = join(vaultPath, '.hl', 'agent');
  if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true });
  const markdownPath = join(agentDir, 'context.md');
  const jsonPath = join(agentDir, 'context.json');
  const result: ExportedContext = {
    source: sourcePath,
    anchor_uri: anchor?.uri,
    text,
    text_hash: createHash('sha256').update(text).digest('hex'),
    markdown,
    backlinks: backlinks.map(b => ({
      from_note_path: b.from_note_path,
      from_line: b.from_line,
      label: b.label,
      to_uri: b.to_uri,
    })),
    forward_links: forwardLinks.map(f => ({
      from_line: f.from_line,
      label: f.label,
      to_uri: f.to_uri,
    })),
    files: {
      markdown: markdownPath,
      json: jsonPath,
    },
  };

  writeFileSync(markdownPath, markdown);
  writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  return result;
}

function sourcePathForAnchor(db: Database, sourceId: string): string | null {
  if (!sourceId) return null;
  const row = db.prepare('SELECT path FROM sources WHERE id = ?').get(sourceId) as { path: string } | undefined;
  return row?.path ?? null;
}

function uriForSource(kind: string, sourcePath: string): string {
  return sourcePath;
}

function renderContextMarkdown(input: {
  sourcePath: string;
  sourceUri: string;
  anchorUri?: string;
  text: string;
  backlinks: LinkRecord[];
  forwardLinks: LinkRecord[];
}): string {
  const lines: string[] = [
    '# Source Context',
    '',
    `**Source**: ${input.sourcePath}`,
    `**URI**: ${input.sourceUri}`,
  ];
  if (input.anchorUri) lines.push(`**Anchor**: ${input.anchorUri}`);
  lines.push('', '## Text', '', '```', input.text.trimEnd(), '```', '');

  lines.push('## Backlinks', '');
  if (input.backlinks.length === 0) {
    lines.push('- None');
  } else {
    for (const link of input.backlinks) {
      lines.push(`- ${link.from_note_path}:${link.from_line}${link.label ? ` - ${link.label}` : ''}`);
    }
  }

  lines.push('', '## Forward Links', '');
  if (input.forwardLinks.length === 0) {
    lines.push('- None');
  } else {
    for (const link of input.forwardLinks) {
      lines.push(`- ${link.to_uri}${link.label ? ` - ${link.label}` : ''}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
