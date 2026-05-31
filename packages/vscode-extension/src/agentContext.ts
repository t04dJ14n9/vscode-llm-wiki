import * as vscode from 'vscode';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'node:crypto';
import { openDatabase, closeDatabase, getBacklinks, getForwardLinks, runMigrations, generateAgentInstructions as generateInstructions } from '@human-learning/core';
import type { SelectionContext } from './selectionContext';
import { notePathToUri } from './wikiLinks';

// Re-export for extension.ts
export { generateInstructions as generateAgentInstructions };

export interface AddSelectionToContextOptions {
  getActiveSelectionContext?: () => SelectionContext | undefined;
}

export class AgentContextProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private vaultRoot: string) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const agentDir = join(this.vaultRoot, '.hl', 'agent');
    const items: vscode.TreeItem[] = [];

    if (existsSync(join(agentDir, 'selection.md'))) {
      const item = new vscode.TreeItem('Current Selection', vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('selection');
      item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(join(agentDir, 'selection.md'))] };
      items.push(item);
    } else {
      items.push(new vscode.TreeItem('(no selection exported)'));
    }

    if (existsSync(join(agentDir, 'today.md'))) {
      const item = new vscode.TreeItem('Today Summary');
      item.iconPath = new vscode.ThemeIcon('calendar');
      item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(join(agentDir, 'today.md'))] };
      items.push(item);
    }

    return items;
  }
}

export async function addSelectionToContext(
  vaultRoot: string,
  options: AddSelectionToContextOptions = {},
): Promise<boolean> {
  const activeSelection = options.getActiveSelectionContext?.() ?? getNativeSelectionContext();
  if (!activeSelection) {
    vscode.window.showErrorMessage('No active editor');
    return false;
  }

  const { uri, text, startLine, endLine } = activeSelection;
  const relPath = vscode.workspace.asRelativePath(uri);

  if (!text.trim()) {
    vscode.window.showErrorMessage('No text selected');
    return false;
  }

  const agentDir = join(vaultRoot, '.hl', 'agent');
  if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true });

  // Write selection.md
  const anchorUri = `${notePathToUri(relPath)}#L${startLine}-L${endLine}`;
  const mdContent = `# Current Selection

**Source**: ${relPath} (lines ${startLine}–${endLine})
**Anchor**: ${anchorUri}

\`\`\`
${text}
\`\`\`
`;

  writeFileSync(join(agentDir, 'selection.md'), mdContent);

  // Write selection.json
  const db = await openDatabase(vaultRoot);
  runMigrations(db);
  const backlinks = getBacklinks(db, anchorUri);
  const forwardLinks = getForwardLinks(db, relPath);
  closeDatabase(db);

  const jsonContent = {
    source: relPath,
    anchor_uri: anchorUri,
    lines: { start: startLine, end: endLine },
    text: text,
    text_hash: createHash('sha256').update(text).digest('hex'),
    exported_at: new Date().toISOString(),
    backlinks: backlinks.map(b => ({ from: b.from_note_path, line: b.from_line })),
    forward_links: forwardLinks.map(f => ({ to: f.to_uri, line: f.from_line })),
  };

  writeFileSync(join(agentDir, 'selection.json'), JSON.stringify(jsonContent, null, 2));

  vscode.window.showInformationMessage(
    `Selection exported to .hl/agent/selection.md + .hl/agent/selection.json`
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
