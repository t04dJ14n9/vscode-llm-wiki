import type * as vscode from 'vscode';

export interface SourceLineRange {
  /** One-based, inclusive source line numbers. */
  startLine: number;
  endLine: number;
}

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
