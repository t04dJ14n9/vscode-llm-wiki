import * as vscode from 'vscode';
import { execFile } from 'child_process';
import {
  classifyReferenceTarget,
  closeDatabase,
  openDatabase,
  resolveWebTarget,
  runMigrations,
} from '@human-learning/core';
import { existsSync } from 'fs';
import { join } from 'path';

interface AnchorRow {
  uri?: unknown;
}

export async function dispatchUri(vaultRoot: string, uri: string): Promise<void> {
  if (uri.startsWith('anc_')) {
    await dispatchAnchorId(vaultRoot, uri);
    return;
  }

  const target = classifyReferenceTarget(uri);

  switch (target.kind) {
    case 'note': {
      if (!target.path) break;
      const fileUri = vscode.Uri.file(join(vaultRoot, target.path));
      await vscode.commands.executeCommand(
        'vscode.openWith',
        fileUri,
        'human-learning.markdownEditor',
      );
      const selection = await resolveNoteSelection(fileUri, target.heading, target.lines);
      if (selection) {
        await vscode.commands.executeCommand('human-learning.revealInMarkdownEditor', {
          uri: fileUri,
          selection,
        });
      }
      return;
    }

    case 'code': {
      if (!target.path) break;
      const direct = join(vaultRoot, target.path);
      const fallback = join(vaultRoot, 'raw', 'code', target.path.split('/').pop() || target.path);
      const filePath = existsSync(direct) ? direct : fallback;
      try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(doc);
        if (target.lines) {
          const range = new vscode.Range(
            target.lines.start - 1, 0,
            target.lines.end - 1, 0,
          );
          editor.selection = new vscode.Selection(range.start, range.end);
          editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
        }
      } catch {
        vscode.window.showErrorMessage(`Code file not found: ${target.path}`);
      }
      return;
    }

    case 'pdf': {
      if (!target.path) break;
      const args: { pdfPath: string; anchorId?: string; chunkId?: string; page?: number } = {
        pdfPath: target.path,
      };
      if (target.anchorId) args.anchorId = target.anchorId;
      if (target.chunkId) args.chunkId = target.chunkId;
      if (target.page) args.page = target.page;
      await vscode.commands.executeCommand('human-learning.openPdfAtAnchor', args);
      return;
    }

    case 'web': {
      await openWebTarget(vaultRoot, target.url ?? uri, target.webTargetId);
      return;
    }

    case 'image':
    case 'text':
    case 'unknown': {
      if (target.path) {
        const filePath = join(vaultRoot, target.path);
        if (existsSync(filePath)) {
          await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
          return;
        }
      }
      if (/^https?:\/\//i.test(uri)) {
        await openWebTarget(vaultRoot, uri);
        return;
      }
      vscode.window.showErrorMessage(`Cannot open link target: ${uri}`);
      return;
    }
  }

  vscode.window.showErrorMessage(`Cannot open link target: ${uri}`);
}

async function dispatchAnchorId(vaultRoot: string, anchorId: string): Promise<void> {
  const db = await openDatabase(vaultRoot);
  runMigrations(db);
  const anchor = db.prepare(
    'SELECT uri, source_id FROM anchors WHERE id = ?',
  ).get(anchorId) as AnchorRow | undefined;
  closeDatabase(db);

  if (typeof anchor?.uri === 'string') {
    await dispatchUri(vaultRoot, anchor.uri);
  } else {
    vscode.window.showErrorMessage(`Anchor not found: ${anchorId}`);
  }
}

async function openWebTarget(vaultRoot: string, url: string, webTargetId?: string): Promise<void> {
  let targetUrl = url;
  if (webTargetId) {
    const db = await openDatabase(vaultRoot);
    try {
      runMigrations(db);
      const target = resolveWebTarget(db, webTargetId);
      if (target?.text_fragment) {
        targetUrl = target.text_fragment;
      } else if (target?.url) {
        targetUrl = target.url;
      }
    } finally {
      closeDatabase(db);
    }
  }

  if (await openInChrome(targetUrl)) return;
  await vscode.env.openExternal(vscode.Uri.parse(targetUrl));
}

function openInChrome(url: string): Promise<boolean> {
  return new Promise(resolve => {
    execFile('open', ['-a', 'Google Chrome', url], error => {
      resolve(!error);
    });
  });
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
