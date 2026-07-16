import type * as vscode from 'vscode';

export interface SelectionContext {
  uri: vscode.Uri;
  text: string;
  startLine: number;
  endLine: number;
  sourceLabel?: string;
  rangeLabel?: string;
  anchorUri?: string;
  metadata?: Record<string, unknown>;
}
