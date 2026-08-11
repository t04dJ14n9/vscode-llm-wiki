import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositorySync = loadTsModule('src/repositorySync.ts');

test('inspectRepository reports non-repositories without changing them', async () => {
  const calls = [];
  const state = await repositorySync.inspectRepository('/notes', {
    runner: async args => {
      calls.push([...args]);
      throw new Error('not a repository');
    },
  });

  assert.deepEqual(state, {
    isRepository: false,
    root: '/notes',
    dirty: false,
    ahead: 0,
    behind: 0,
  });
  assert.deepEqual(calls, [['rev-parse', '--is-inside-work-tree']]);
});

test('inspectRepository reports upstream, dirty state, and ahead/behind counts', async () => {
  const runner = stateRunner({
    root: '/repo',
    branch: 'main',
    upstream: 'origin/main',
    dirty: true,
    ahead: 2,
    behind: 3,
  });

  const state = await repositorySync.inspectRepository('/repo/notes', { runner });

  assert.deepEqual(state, {
    isRepository: true,
    root: '/repo',
    branch: 'main',
    upstream: 'origin/main',
    dirty: true,
    ahead: 2,
    behind: 3,
  });
});

test('syncRepository fetches and fast-forwards a clean, behind-only branch', async () => {
  let phase = 'before';
  const calls = [];
  const runner = async (args, cwd) => {
    calls.push({ args: [...args], cwd });
    const command = args.join(' ');
    if (command === 'fetch --all --prune') {
      phase = 'fetched';
      return '';
    }
    if (command === 'merge --ff-only @{upstream}') {
      phase = 'merged';
      return 'Updating';
    }
    return stateRunner({
      root: '/repo',
      branch: 'main',
      upstream: 'origin/main',
      ahead: 0,
      behind: phase === 'fetched' ? 2 : 0,
    })(args, cwd);
  };

  const result = await repositorySync.syncRepository('/repo', { runner });

  assert.equal(result.status, 'fast-forwarded');
  assert.equal(result.changed, true);
  assert.equal(result.after.behind, 0);
  assert.ok(calls.some(call => call.args.join(' ') === 'fetch --all --prune'));
  assert.ok(calls.some(call => call.args.join(' ') === 'merge --ff-only @{upstream}'));
  assert.ok(!calls.some(call => call.args.includes('--no-edit')));
});

test('syncRepository requires confirmation for divergence and only merges when allowed', async () => {
  const withoutApproval = mutableDivergedRunner();
  const proposed = await repositorySync.syncRepository('/repo', {
    runner: withoutApproval.runner,
  });

  assert.equal(proposed.status, 'merge-required');
  assert.equal(proposed.requiresConfirmation, true);
  assert.ok(!withoutApproval.calls.some(call => call.join(' ') === 'merge --no-edit @{upstream}'));

  const approved = mutableDivergedRunner();
  const merged = await repositorySync.syncRepository('/repo', {
    runner: approved.runner,
    allowMerge: true,
  });

  assert.equal(merged.status, 'merged');
  assert.equal(merged.requiresConfirmation, false);
  assert.ok(approved.calls.some(call => call.join(' ') === 'merge --no-edit @{upstream}'));
  assert.ok(!approved.calls.some(call =>
    ['push', 'reset', 'stash', 'clean', 'commit'].includes(call[0])
  ));
});

test('syncRepository fetches but leaves dirty worktrees untouched', async () => {
  const calls = [];
  const base = stateRunner({
    root: '/repo',
    branch: 'main',
    upstream: 'origin/main',
    dirty: true,
    behind: 4,
  });
  const runner = async (args, cwd) => {
    calls.push([...args]);
    if (args[0] === 'fetch') return '';
    return base(args, cwd);
  };

  const result = await repositorySync.syncRepository('/repo', { runner });

  assert.equal(result.status, 'dirty');
  assert.ok(calls.some(call => call.join(' ') === 'fetch --all --prune'));
  assert.ok(!calls.some(call => call[0] === 'merge'));
});

function mutableDivergedRunner() {
  let merged = false;
  const calls = [];
  const runner = async (args, cwd) => {
    calls.push([...args]);
    const command = args.join(' ');
    if (command === 'fetch --all --prune') return '';
    if (command === 'merge --no-edit @{upstream}') {
      merged = true;
      return 'Merge made';
    }
    return stateRunner({
      root: '/repo',
      branch: 'main',
      upstream: 'origin/main',
      ahead: merged ? 1 : 2,
      behind: merged ? 0 : 3,
    })(args, cwd);
  };
  return { calls, runner };
}

function stateRunner(state) {
  return async args => {
    switch (args.join(' ')) {
      case 'rev-parse --is-inside-work-tree':
        return 'true\n';
      case 'rev-parse --show-toplevel':
        return `${state.root}\n`;
      case 'branch --show-current':
        return `${state.branch ?? ''}\n`;
      case 'status --porcelain=v1':
        return state.dirty ? ' M notes/Changed.md\n' : '';
      case 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}':
        if (!state.upstream) throw new Error('no upstream');
        return `${state.upstream}\n`;
      case 'rev-list --left-right --count HEAD...@{upstream}':
        return `${state.ahead ?? 0}\t${state.behind ?? 0}\n`;
      default:
        throw new Error(`Unexpected git command: ${args.join(' ')}`);
    }
  };
}

function loadTsModule(relativePath) {
  const filename = join(packageRoot, relativePath);
  const source = readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(dirname(filename));
  mod._compile(outputText, filename);
  return mod.exports;
}
