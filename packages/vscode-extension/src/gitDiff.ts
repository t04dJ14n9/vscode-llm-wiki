import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type GitCommandRunner = (
  args: readonly string[],
  cwd: string,
) => Promise<string>;

export type GitDiffLineKind = 'added' | 'modified' | 'deleted';

export interface GitDiffLine {
  line: number;
  kind: GitDiffLineKind;
  before?: string;
  after?: string;
}

export interface GitDiffResult {
  available: boolean;
  lines: GitDiffLine[];
}

export interface GitDiffOptions {
  runner?: GitCommandRunner;
}

/**
 * Return current-file line markers for the working tree compared with HEAD.
 * The command uses zero-context hunks so the result is compact enough to send
 * to the Markdown webview after each edit.
 */
export async function getGitDiffForFile(
  filePath: string,
  workspaceRoot: string | undefined,
  options: GitDiffOptions = {},
): Promise<GitDiffResult> {
  if (!workspaceRoot) return unavailable();

  const run = options.runner ?? runGit;
  try {
    const repositoryRoot = (await run(
      ['rev-parse', '--show-toplevel'],
      workspaceRoot,
    )).trim();
    if (!repositoryRoot) return unavailable();

    const resolvedRoot = path.resolve(repositoryRoot);
    const resolvedFile = path.resolve(filePath);
    const relativeFile = path.relative(resolvedRoot, resolvedFile);
    if (!isContained(resolvedRoot, resolvedFile) || !relativeFile) {
      return unavailable();
    }

    const diff = await run(
      [
        'diff',
        'HEAD',
        '--no-color',
        '--no-ext-diff',
        '--unified=0',
        '--',
        relativeFile.split(path.sep).join('/'),
      ],
      resolvedRoot,
    );
    return {
      available: true,
      lines: parseGitDiffLines(diff),
    };
  } catch {
    return unavailable();
  }
}

export function parseGitDiffLines(diff: string): GitDiffLine[] {
  const markers: GitDiffLine[] = [];
  let hunk: DiffHunk | undefined;
  let deletionBuffer: string[] = [];
  let additionBuffer: string[] = [];

  const flushChange = () => {
    if (!hunk || (deletionBuffer.length === 0 && additionBuffer.length === 0)) return;

    const modifiedCount = Math.min(deletionBuffer.length, additionBuffer.length);
    for (let index = 0; index < modifiedCount; index++) {
      markers.push({
        line: hunk.newStart + index,
        kind: 'modified',
        before: deletionBuffer[index],
        after: additionBuffer[index],
      });
    }
    for (let index = modifiedCount; index < additionBuffer.length; index++) {
      markers.push({
        line: hunk.newStart + index,
        kind: 'added',
        after: additionBuffer[index],
      });
    }
    if (deletionBuffer.length > additionBuffer.length) {
      markers.push({
        line: Math.max(1, hunk.newStart + additionBuffer.length),
        kind: 'deleted',
        before: deletionBuffer.slice(modifiedCount).join('\n'),
      });
    }

    deletionBuffer = [];
    additionBuffer = [];
  };

  for (const line of diff.split(/\r?\n/u)) {
    const parsedHunk = parseDiffHunk(line);
    if (parsedHunk) {
      flushChange();
      hunk = parsedHunk;
      continue;
    }
    if (!hunk || line.startsWith('\\')) continue;

    if (line.startsWith('-') && !line.startsWith('---')) {
      deletionBuffer.push(line.slice(1));
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additionBuffer.push(line.slice(1));
      continue;
    }
    if (line.startsWith(' ')) {
      flushChange();
    }
  }
  flushChange();

  return markers.sort((left, right) => left.line - right.line);
}

interface DiffHunk {
  newStart: number;
  newCount: number;
}

function parseDiffHunk(line: string): DiffHunk | undefined {
  const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u);
  if (!match) return undefined;
  return {
    newStart: Number(match[1]),
    newCount: match[2] === undefined ? 1 : Number(match[2]),
  };
}

async function runGit(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  return String(stdout);
}

function unavailable(): GitDiffResult {
  return { available: false, lines: [] };
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
