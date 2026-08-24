import { lint, type Configuration, type LintResults } from 'markdownlint/promise';

export type MarkdownDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface MarkdownDiagnostic {
  from: number;
  to: number;
  line: number;
  message: string;
  source: string;
  code: string;
  severity: MarkdownDiagnosticSeverity;
}

/**
 * The content-only boundary for future Markdown diagnostics.
 *
 * Keeping the markdownlint call in the extension host means the webview can
 * remain focused on editing and rendering. Diagnostics can later map the
 * returned line/range data onto VS Code's DiagnosticCollection without
 * coupling the editor bundle to markdownlint.
 */
export interface MarkdownLintContent {
  filePath: string;
  content: string;
  config?: Configuration;
}

/**
 * Lint one in-memory Markdown document with the repository's markdownlint
 * dependency. This intentionally returns the upstream result shape; rule to
 * VS Code diagnostic mapping belongs to the future diagnostics feature.
 */
export async function lintMarkdownContent(
  input: MarkdownLintContent,
): Promise<LintResults> {
  return lint({
    strings: { [input.filePath]: input.content },
    ...(input.config === undefined ? {} : { config: input.config }),
  });
}

/**
 * Convert markdownlint's line/column result into offsets that can be shared by
 * VS Code diagnostics and the CodeMirror webview.
 *
 * markdownlint's errorRange column is zero-based. A missing range still gets a
 * one-character diagnostic so the editor can render a stable hover target.
 */
export function mapMarkdownLintResults(
  filePath: string,
  content: string,
  results: LintResults,
): MarkdownDiagnostic[] {
  const lines = sourceLines(content);
  const errors = results[filePath] ?? [];

  return errors.flatMap(error => {
    const lineNumber = Number.isInteger(error.lineNumber) ? error.lineNumber : 1;
    const line = lines[Math.max(0, Math.min(lines.length - 1, lineNumber - 1))] ?? {
      from: 0,
      to: content.length,
    };
    const column = error.errorRange?.[0] ?? 0;
    const length = error.errorRange?.[1] ?? 1;
    const from = Math.min(line.to, line.from + Math.max(0, column));
    const to = Math.min(line.to, Math.max(from + 1, from + Math.max(1, length)));
    const rule = error.ruleNames[0] ?? 'markdownlint';
    const detail = error.errorDetail?.trim();

    return [{
      from,
      to,
      line: lineNumber,
      message: detail
        ? `${error.ruleDescription}: ${detail}`
        : error.ruleDescription,
      source: 'markdownlint',
      code: rule,
      severity: error.severity === 'info' ? 'info' : 'warning',
    }];
  });
}

interface SourceLine {
  from: number;
  to: number;
}

function sourceLines(content: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let from = 0;
  while (from <= content.length) {
    const newline = content.indexOf('\n', from);
    const to = newline < 0 ? content.length : newline;
    lines.push({ from, to });
    if (newline < 0) break;
    from = newline + 1;
  }
  return lines;
}
