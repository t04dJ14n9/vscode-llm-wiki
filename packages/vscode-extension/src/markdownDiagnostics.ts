import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  markdownLinkSourceSpans,
  markdownReferenceDefinitionSourceSpans,
  parseMarkdownLinkDestination,
} from './markdownLinkDiagnostics';
import type { Configuration } from 'markdownlint/promise';
import {
  lintMarkdownContent,
  mapMarkdownLintResults,
  type MarkdownDiagnostic,
} from './markdownLint';

export interface MarkdownDiagnosticsFileSystem {
  exists(filePath: string): boolean;
  isDirectory(filePath: string): boolean;
  readText?(filePath: string): Promise<string>;
}

export interface MarkdownDiagnosticsInput {
  content: string;
  filePath: string;
  workspaceRoot?: string;
  config?: Configuration;
  fileSystem?: MarkdownDiagnosticsFileSystem;
}

const nodeFileSystem: MarkdownDiagnosticsFileSystem = {
  exists: filePath => fs.existsSync(filePath),
  isDirectory: filePath => {
    try {
      return fs.statSync(filePath).isDirectory();
    } catch {
      return false;
    }
  },
};

/**
 * Run style linting and resolve ordinary local Markdown destinations in one
 * content-only operation. External URLs, mail links, and fragment-only links
 * are deliberately left to their respective providers.
 */
export async function collectMarkdownDiagnostics(
  input: MarkdownDiagnosticsInput,
): Promise<MarkdownDiagnostic[]> {
  const fileSystem = input.fileSystem ?? nodeFileSystem;
  const lintResults = await lintMarkdownContent({
    filePath: input.filePath,
    content: input.content,
    config: input.config,
  });
  const diagnostics = mapMarkdownLintResults(input.filePath, input.content, lintResults);
  diagnostics.push(
    ...collectBrokenLinkDiagnostics(input, fileSystem),
  );
  return diagnostics.sort((left, right) => (
    left.from - right.from
    || left.to - right.to
    || left.code.localeCompare(right.code)
  ));
}

export function collectBrokenLinkDiagnostics(
  input: MarkdownDiagnosticsInput,
  fileSystem: MarkdownDiagnosticsFileSystem = nodeFileSystem,
): MarkdownDiagnostic[] {
  const diagnostics: MarkdownDiagnostic[] = [];
  const seen = new Set<string>();
  const lines = sourceLines(input.content);

  for (const line of lines) {
    if (line.text.trimStart().startsWith('```')) continue;
    for (const span of markdownLinkSourceSpans(line.from, line.text)) {
      if (span.image) continue;
      const rawDestination = input.content.slice(span.destinationFrom, span.destinationTo);
      const destination = parseMarkdownLinkDestination(rawDestination);
      if (!destination) continue;
  const diagnostic = brokenDestinationDiagnostic(
    input,
    fileSystem,
        destination,
        span.destinationFrom + Math.max(0, rawDestination.indexOf(destination)),
        span.destinationFrom + Math.max(0, rawDestination.indexOf(destination)) + destination.length,
        line.number,
        seen,
      );
      if (diagnostic) diagnostics.push(diagnostic);
    }
  }

  for (const definition of markdownReferenceDefinitionSourceSpans(input.content)) {
    const rawDestination = input.content.slice(
      definition.destinationFrom,
      definition.destinationTo,
    );
    const destination = parseMarkdownLinkDestination(rawDestination);
    if (!destination) continue;
    const diagnostic = brokenDestinationDiagnostic(
      input,
      fileSystem,
      destination,
      definition.destinationFrom + Math.max(0, rawDestination.indexOf(destination)),
      definition.destinationFrom + Math.max(0, rawDestination.indexOf(destination)) + destination.length,
      lineNumberAt(lines, definition.from),
      seen,
    );
    if (diagnostic) diagnostics.push(diagnostic);
  }

  return diagnostics;
}

interface SourceLine {
  from: number;
  to: number;
  text: string;
  number: number;
}

function sourceLines(content: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let from = 0;
  let number = 1;
  while (from <= content.length) {
    const newline = content.indexOf('\n', from);
    const to = newline < 0 ? content.length : newline;
    lines.push({
      from,
      to,
      text: content.slice(from, to),
      number,
    });
    if (newline < 0) break;
    from = newline + 1;
    number++;
  }
  return lines;
}

function lineNumberAt(lines: SourceLine[], offset: number): number {
  return lines.find(line => offset >= line.from && offset <= line.to)?.number
    ?? lines.at(-1)?.number
    ?? 1;
}

function brokenDestinationDiagnostic(
  input: MarkdownDiagnosticsInput,
  fileSystem: MarkdownDiagnosticsFileSystem,
  destination: string,
  from: number,
  to: number,
  line: number,
  seen: Set<string>,
): MarkdownDiagnostic | undefined {
  const target = localTarget({ ...input, fileSystem }, destination);
  if (!target || target.ok) return undefined;

  const key = `${from}:${to}:${destination}`;
  if (seen.has(key)) return undefined;
  seen.add(key);

  return {
    from,
    to: Math.max(from + 1, to),
    line,
    message: `Cannot find linked file "${destination}".`,
    source: 'markdown-link',
    code: 'MD-LINK',
    severity: 'error',
  };
}

function localTarget(
  input: MarkdownDiagnosticsInput,
  destination: string,
): { ok: true } | { ok: false } | undefined {
  const { rawPath } = splitDestination(destination);
  if (!rawPath || rawPath.startsWith('#') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(rawPath)) {
    return undefined;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return { ok: false };
  }
  if (!decodedPath || decodedPath.includes('\0')) return undefined;

  const root = input.workspaceRoot
    ? path.resolve(input.workspaceRoot)
    : undefined;
  const base = decodedPath.startsWith('/')
    ? root
    : path.dirname(path.resolve(input.filePath));
  if (!base) return undefined;

  const candidate = path.resolve(base, decodedPath.replace(/^[/\\]+/, ''));
  if (root && !isContained(root, candidate)) return { ok: false };

  const fileSystem = input.fileSystem ?? nodeFileSystem;
  if (fileSystem.exists(candidate) && !fileSystem.isDirectory(candidate)) {
    return { ok: true };
  }

  if (!path.extname(candidate) && fileSystem.exists(`${candidate}.md`)) {
    return { ok: true };
  }

  if (fileSystem.isDirectory(candidate)) {
    for (const indexName of ['_index.md']) {
      if (fileSystem.exists(path.join(candidate, indexName))) return { ok: true };
    }
  }

  return { ok: false };
}

function splitDestination(destination: string): { rawPath: string; fragment: string } {
  const index = destination.search(/[?#]/);
  return index < 0
    ? { rawPath: destination, fragment: '' }
    : { rawPath: destination.slice(0, index), fragment: destination.slice(index) };
}

function isContained(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate);
  return relativePath === ''
    || (
      relativePath !== '..'
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath)
    );
}
