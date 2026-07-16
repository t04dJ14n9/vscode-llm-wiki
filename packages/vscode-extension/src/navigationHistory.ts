import * as vscode from 'vscode';
import type { PdfTextFragment } from '@human-learning/core';

export type NavigationKind = 'markdown' | 'pdf' | 'web' | 'code' | 'file' | 'outline' | 'uri';

export type RevealSelection = {
  from: number;
  to: number;
};

export type NavigationTarget =
  | {
      kind: 'markdown';
      uri: string;
      selection?: RevealSelection;
    }
  | {
      kind: 'pdf';
      pdfPath: string;
      page?: number;
      textFragment?: PdfTextFragment;
    }
  | {
      kind: 'web';
      url: string;
    }
  | {
      kind: 'file';
      uri: string;
    }
  | {
      kind: 'uri';
      uri: string;
    };

export interface NavigationEntryInput {
  kind: NavigationKind;
  label: string;
  description?: string;
  target: NavigationTarget;
}

export interface NavigationHistoryEntry extends NavigationEntryInput {
  id: string;
  createdAt: number;
  key: string;
}

type NavigationOpener = (target: NavigationTarget) => Promise<void> | void;

class NavigationHistoryItem extends vscode.TreeItem {
  constructor(entry: NavigationHistoryEntry, isCurrent: boolean) {
    super(entry.label, vscode.TreeItemCollapsibleState.None);
    this.id = entry.id;
    this.description = isCurrent ? 'current' : entry.description;
    this.tooltip = entry.description ? `${entry.label}\n${entry.description}` : entry.label;
    this.iconPath = new vscode.ThemeIcon(iconForKind(entry.kind));
    this.command = {
      command: 'human-learning.retractToJump',
      title: 'Retract to Jump',
      arguments: [entry.id],
    };
  }
}

export class NavigationHistoryProvider implements vscode.TreeDataProvider<NavigationHistoryItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<NavigationHistoryItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly items: NavigationHistoryEntry[] = [];
  private nextId = 1;
  private suppressDepth = 0;

  get entries(): readonly NavigationHistoryEntry[] {
    return this.items;
  }

  record(input: NavigationEntryInput): NavigationHistoryEntry | undefined {
    if (this.suppressDepth > 0) return undefined;

    const key = navigationEntryKey(input);
    const previous = this.items[this.items.length - 1];
    if (previous?.key === key) {
      return previous;
    }

    const entry: NavigationHistoryEntry = {
      ...input,
      id: `jump-${this.nextId++}`,
      createdAt: Date.now(),
      key,
    };
    this.items.push(entry);
    if (this.items.length > 100) {
      this.items.splice(0, this.items.length - 100);
    }
    this.refresh();
    return entry;
  }

  async back(open: NavigationOpener): Promise<boolean> {
    if (this.items.length < 2) return false;

    const targetEntry = this.items[this.items.length - 2];
    if (!targetEntry) return false;

    await this.withoutRecording(() => open(targetEntry.target));
    this.items.splice(this.items.length - 1, 1);
    this.refresh();
    return true;
  }

  async retractTo(entryId: string, open: NavigationOpener): Promise<boolean> {
    const index = this.items.findIndex(entry => entry.id === entryId);
    if (index < 0) return false;

    const targetEntry = this.items[index];
    if (!targetEntry) return false;

    await this.withoutRecording(() => open(targetEntry.target));
    this.items.splice(index + 1);
    this.refresh();
    return true;
  }

  clear(): void {
    if (this.items.length === 0) return;
    this.items.splice(0);
    this.refresh();
  }

  async withoutRecording<T>(operation: () => Promise<T> | T): Promise<T> {
    this.suppressDepth += 1;
    try {
      return await operation();
    } finally {
      this.suppressDepth -= 1;
    }
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: NavigationHistoryItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: NavigationHistoryItem): Promise<NavigationHistoryItem[]> {
    if (element) return [];
    return this.items
      .slice()
      .reverse()
      .map((entry, index) => new NavigationHistoryItem(entry, index === 0));
  }
}

function navigationEntryKey(input: NavigationEntryInput): string {
  return JSON.stringify({
    kind: input.kind,
    target: input.target,
  });
}

function iconForKind(kind: NavigationKind): string {
  switch (kind) {
    case 'markdown':
    case 'outline':
      return 'markdown';
    case 'pdf':
      return 'file-pdf';
    case 'web':
      return 'globe';
    case 'code':
      return 'symbol-method';
    case 'file':
      return 'file';
    case 'uri':
      return 'link';
  }
}
