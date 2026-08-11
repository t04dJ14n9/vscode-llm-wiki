import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type GitCommandRunner = (
  args: readonly string[],
  cwd: string,
) => Promise<string>;

export interface RepositoryState {
  isRepository: boolean;
  root: string;
  branch?: string;
  upstream?: string;
  dirty: boolean;
  ahead: number;
  behind: number;
}

export interface RepositoryOptions {
  runner?: GitCommandRunner;
}

export interface SyncRepositoryOptions extends RepositoryOptions {
  allowMerge?: boolean;
}

export type RepositorySyncStatus =
  | 'no-repository'
  | 'no-upstream'
  | 'dirty'
  | 'up-to-date'
  | 'ahead'
  | 'fast-forwarded'
  | 'merge-required'
  | 'merged';

export interface RepositorySyncResult {
  status: RepositorySyncStatus;
  before: RepositoryState;
  after: RepositoryState;
  changed: boolean;
  requiresConfirmation: boolean;
}

/**
 * Inspect local Git state without changing the repository.
 */
export async function inspectRepository(
  root: string,
  options: RepositoryOptions = {},
): Promise<RepositoryState> {
  const run = options.runner ?? runGit;
  const inside = await tryRun(run, ['rev-parse', '--is-inside-work-tree'], root);
  if (inside?.trim() !== 'true') {
    return {
      isRepository: false,
      root,
      dirty: false,
      ahead: 0,
      behind: 0,
    };
  }

  const repositoryRoot = (
    await run(['rev-parse', '--show-toplevel'], root)
  ).trim() || root;
  const branch = (
    await run(['branch', '--show-current'], repositoryRoot)
  ).trim() || undefined;
  const dirty = (
    await run(['status', '--porcelain=v1'], repositoryRoot)
  ).trim().length > 0;
  const upstream = (
    await tryRun(
      run,
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      repositoryRoot,
    )
  )?.trim() || undefined;

  let ahead = 0;
  let behind = 0;
  if (upstream) {
    const counts = (
      await run(
        ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
        repositoryRoot,
      )
    ).trim().split(/\s+/).map(Number);
    ahead = finiteCount(counts[0]);
    behind = finiteCount(counts[1]);
  }

  return {
    isRepository: true,
    root: repositoryRoot,
    branch,
    upstream,
    dirty,
    ahead,
    behind,
  };
}

/**
 * Fetch remote state, then apply only safe, explicitly permitted updates.
 * This function never pushes, resets, stashes, deletes, or commits.
 */
export async function syncRepository(
  root: string,
  options: SyncRepositoryOptions = {},
): Promise<RepositorySyncResult> {
  const runner = options.runner ?? runGit;
  const before = await inspectRepository(root, { runner });
  if (!before.isRepository) {
    return result('no-repository', before, before);
  }

  await runner(['fetch', '--all', '--prune'], before.root);
  const fetched = await inspectRepository(before.root, { runner });

  if (!fetched.upstream) return result('no-upstream', before, fetched);
  if (fetched.dirty) return result('dirty', before, fetched);
  if (fetched.behind === 0) {
    return result(fetched.ahead > 0 ? 'ahead' : 'up-to-date', before, fetched);
  }

  if (fetched.ahead === 0) {
    await runner(['merge', '--ff-only', '@{upstream}'], fetched.root);
    const after = await inspectRepository(fetched.root, { runner });
    return result('fast-forwarded', before, after, true);
  }

  if (!options.allowMerge) {
    return result('merge-required', before, fetched, false, true);
  }

  await runner(['merge', '--no-edit', '@{upstream}'], fetched.root);
  const after = await inspectRepository(fetched.root, { runner });
  return result('merged', before, after, true);
}

async function runGit(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  return String(stdout);
}

async function tryRun(
  runner: GitCommandRunner,
  args: readonly string[],
  cwd: string,
): Promise<string | undefined> {
  try {
    return await runner(args, cwd);
  } catch {
    return undefined;
  }
}

function finiteCount(value: number | undefined): number {
  return Number.isFinite(value) && value! > 0 ? value! : 0;
}

function result(
  status: RepositorySyncStatus,
  before: RepositoryState,
  after: RepositoryState,
  changed = false,
  requiresConfirmation = false,
): RepositorySyncResult {
  return { status, before, after, changed, requiresConfirmation };
}
