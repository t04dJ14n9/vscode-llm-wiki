import { lint, type Configuration, type LintResults } from 'markdownlint/promise';

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
