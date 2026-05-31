import * as vscode from 'vscode';
import { parseHlUri, openDatabase, closeDatabase, runMigrations } from '@human-learning/core';
import { existsSync } from 'fs';
import { join } from 'path';

interface AnchorRow {
  uri?: unknown;
}

export async function dispatchUri(vaultRoot: string, uri: string): Promise<void> {
  const parsed = parseHlUri(uri);
  if (!parsed) {
    vscode.window.showErrorMessage(`Invalid hl:// URI: ${uri}`);
    return;
  }

  switch (parsed.kind) {
    case 'note': {
      if (!parsed.path) break;
      const filePath = join(vaultRoot, decodePath(parsed.path));
      const fileUri = vscode.Uri.file(filePath);
      await vscode.commands.executeCommand(
        'vscode.openWith',
        fileUri,
        'human-learning.markdownEditor',
      );
      const selection = await resolveNoteSelection(fileUri, parsed.heading, parsed.lines);
      if (selection) {
        await vscode.commands.executeCommand('human-learning.revealInMarkdownEditor', {
          uri: fileUri,
          selection,
        });
      }
      break;
    }

    case 'code': {
      if (!parsed.path) break;
      const decoded = decodePath(parsed.path);
      const direct = join(vaultRoot, decoded);
      const fallback = join(vaultRoot, 'raw', 'code', decoded.split('/').pop() || decoded);
      const filePath = existsSync(direct) ? direct : fallback;
      try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(doc);
        if (parsed.lines) {
          const range = new vscode.Range(
            parsed.lines.start - 1, 0,
            parsed.lines.end - 1, 0,
          );
          editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
        }
      } catch {
        vscode.window.showErrorMessage(`Code file not found: ${parsed.path}`);
      }
      break;
    }

    case 'pdf': {
      if (!parsed.path) break;
      await vscode.commands.executeCommand('human-learning.openPdfAtAnchor', {
        pdfPath: decodePath(parsed.path),
        anchorId: parsed.anchorId,
        page: parsed.page,
      });
      break;
    }

    case 'anchor': {
      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const anchorId = parsed.anchorId ?? parsed.path;
      const anchor = db.prepare(
        'SELECT uri, source_id FROM anchors WHERE id = ?',
      ).get(anchorId) as AnchorRow | undefined;
      closeDatabase(db);

      if (typeof anchor?.uri === 'string') {
        await dispatchUri(vaultRoot, anchor.uri);
      } else {
        vscode.window.showErrorMessage(`Anchor not found: ${anchorId}`);
      }
      break;
    }
  }
}

function decodePath(input: string): string {
  return input.split('/').map(segment => decodeURIComponent(segment)).join('/');
}

async function resolveNoteSelection(
  fileUri: vscode.Uri,
  heading: string | undefined,
  lines: { start: number; end: number } | undefined,
): Promise<{ from: number; to: number } | undefined> {
  if (!heading && !lines) return undefined;
  const doc = await vscode.workspace.openTextDocument(fileUri);

  if (heading) {
    const text = doc.getText();
    if (heading.startsWith('^')) {
      const blockOffset = findBlockReferenceOffset(text, heading.slice(1));
      if (blockOffset !== undefined) {
        return { from: blockOffset, to: blockOffset };
      }
    }
    const headingRegex = new RegExp(`^#{1,6}\\s+${escapeRegex(heading)}`, 'im');
    const match = headingRegex.exec(text);
    if (match) {
      return { from: match.index, to: match.index };
    }
  }

  if (lines) {
    const startLine = Math.max(1, lines.start);
    const endLine = Math.max(startLine, lines.end);
    const from = doc.offsetAt(new vscode.Position(startLine - 1, 0));
    const to = doc.offsetAt(new vscode.Position(endLine - 1, 0));
    return { from, to };
  }

  return undefined;
}

function findBlockReferenceOffset(text: string, blockId: string): number | undefined {
  if (!blockId) return undefined;
  const blockRegex = new RegExp(`(?:^|\\s)\\^${escapeRegex(blockId)}(?=$|\\s)`, 'm');
  const match = blockRegex.exec(text);
  if (!match) return undefined;
  return lineStartAt(text, match.index);
}

function lineStartAt(text: string, offset: number): number {
  const previousNewline = text.lastIndexOf('\n', offset);
  return previousNewline < 0 ? 0 : previousNewline + 1;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
