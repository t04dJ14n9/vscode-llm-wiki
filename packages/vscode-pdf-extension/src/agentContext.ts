import * as vscode from 'vscode';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'node:crypto';
import {
  openDatabase,
  closeDatabase,
  getBacklinks,
  getForwardLinks,
  pdfHref,
  runMigrations,
} from '@human-learning/core';
import type { SelectionContext } from './selectionContext';

export interface AddSelectionToContextOptions {
  getActiveSelectionContext?: () => SelectionContext | undefined | Promise<SelectionContext | undefined>;
}

export async function addSelectionToContext(
  vaultRoot: string,
  options: AddSelectionToContextOptions = {},
): Promise<boolean> {
  const providedSelection = options.getActiveSelectionContext
    ? await options.getActiveSelectionContext()
    : undefined;
  const activeSelection = providedSelection ?? getNativeSelectionContext();
  if (!activeSelection) {
    vscode.window.showErrorMessage('No active editor');
    return false;
  }

  const { uri, text, startLine, endLine, metadata } = activeSelection;
  const relPath = activeSelection.sourceLabel ?? vscode.workspace.asRelativePath(uri);
  const rangeLabel = activeSelection.rangeLabel ?? `lines ${startLine}–${endLine}`;

  if (!text.trim()) {
    vscode.window.showErrorMessage('No text selected');
    return false;
  }

  const agentDir = join(vaultRoot, '.hl', 'agent');
  if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true });

  const anchorUri = activeSelection.anchorUri ?? fallbackAnchorUri(relPath, startLine, endLine);
  const mdContent = `# Current Selection

**Source**: ${relPath} (${rangeLabel})
**Anchor**: ${anchorUri}

\`\`\`
${text}
\`\`\`
`;

  writeFileSync(join(agentDir, 'selection.md'), mdContent);

  const db = await openDatabase(vaultRoot);
  runMigrations(db);
  const backlinks = getBacklinks(db, anchorUri);
  const forwardLinks = getForwardLinks(db, relPath);
  closeDatabase(db);

  const jsonContent = {
    source: relPath,
    anchor_uri: anchorUri,
    lines: { start: startLine, end: endLine },
    location: rangeLabel,
    text,
    text_hash: createHash('sha256').update(text).digest('hex'),
    exported_at: new Date().toISOString(),
    ...(metadata ? { metadata } : {}),
    backlinks: backlinks.map(b => ({ from: b.from_note_path, line: b.from_line })),
    forward_links: forwardLinks.map(f => ({ to: f.to_uri, line: f.from_line })),
  };

  writeFileSync(join(agentDir, 'selection.json'), JSON.stringify(jsonContent, null, 2));

  vscode.window.showInformationMessage(
    'Selection exported to .hl/agent/selection.md + .hl/agent/selection.json',
  );
  return true;
}

function getNativeSelectionContext(): SelectionContext | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;

  const selection = editor.selection;
  if (selection.isEmpty) {
    return {
      uri: editor.document.uri,
      text: editor.document.getText(),
      startLine: 1,
      endLine: Math.max(1, editor.document.lineCount),
    };
  }

  return {
    uri: editor.document.uri,
    text: editor.document.getText(selection),
    startLine: selection.start.line + 1,
    endLine: selection.end.line + 1,
  };
}

function fallbackAnchorUri(relPath: string, startLine: number, endLine: number): string {
  if (relPath.toLowerCase().endsWith('.pdf')) {
    return pdfHref(relPath, { page: startLine });
  }
  return `${relPath}#L${startLine}-L${endLine}`;
}
