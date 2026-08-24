import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Module from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import YAML from 'yaml';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadIndexModule() {
  const filename = join(packageRoot, 'src', 'queryAnnotationIndex.ts');
  const source = existsSync(filename) ? readFileSync(filename, 'utf8') : '';
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

const indexModule = loadIndexModule();
const QueryAnnotationIndex = indexModule.QueryAnnotationIndex ?? class {
  async refresh() {}
  invalidate() {}
  async listAnnotationsForSource() { return []; }
  async loadNavigationTarget() { return undefined; }
  onDidChange() { return { dispose() {} }; }
  dispose() {}
  get diagnostics() { return []; }
};
const resolveMarkdownAnchor = indexModule.resolveMarkdownAnchor ?? (() => ({
  diagnostic: { code: 'missing-implementation', message: 'not implemented' },
}));
const resolvePdfAnchor = indexModule.resolvePdfAnchor ?? (() => ({
  diagnostic: { code: 'missing-implementation', message: 'not implemented' },
}));
const registerQueryAnnotationWatchers = indexModule.registerQueryAnnotationWatchers
  ?? (() => ({ dispose() {} }));

const sha256 = value => createHash('sha256').update(value).digest('hex');

async function withWorkspace(run) {
  const root = await mkdtemp(join(tmpdir(), 'llm-wiki-query-index-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeWorkspaceFile(root, relativePath, value) {
  const absolutePath = join(root, ...relativePath.split('/'));
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, value);
  return absolutePath;
}

function queryPage({
  title = 'How does the source behave?',
  description = 'A grounded question about the selected source.',
  condensedSummary = 'The source behaves deterministically.',
  status = 'stable',
  generatedAt = '2026-08-20T03:04:05Z',
  updated = '2026-08-21T03:04:05Z',
  project,
  selectionId = 'selection-123',
  sources,
  anchors,
  extra = {},
} = {}) {
  const metadata = {
    type: 'Query',
    title,
    description,
    condensed_summary: condensedSummary,
    status,
    generated: { by: 'codex/gpt-5.6', at: generatedAt },
    updated,
    ...(project ? { project } : {}),
    conversation: { selection_id: selectionId },
    sources,
    anchors,
    ...extra,
  };
  return `---\n${YAML.stringify(metadata)}---\n\n# ${title}\n\n## Answer\n\nAnswer.\n`;
}

function markdownFixture(resource, text, overrides = {}) {
  const quote = 'selected source';
  const from = text.indexOf(quote);
  return {
    sources: [{ id: 'source', resource, title: 'Source document' }],
    anchors: [{
      source_id: 'source',
      kind: 'markdown',
      resource,
      sha256: sha256(text),
      quote,
      prefix: text.slice(Math.max(0, from - 7), from),
      suffix: text.slice(from + quote.length, from + quote.length + 7),
      from,
      to: from + quote.length,
      start_line: 2,
      end_line: 2,
      ...overrides,
    }],
  };
}

test('resolves an exact Markdown hash and offsets before relocation', () => {
  const text = 'first line\nThe selected source is exact.\nlast line\n';
  const fixture = markdownFixture('../notes/source.md', text);

  assert.deepEqual(resolveMarkdownAnchor(fixture.anchors[0], text), {
    range: {
      from: 15,
      to: 30,
      startLine: 2,
      endLine: 2,
    },
    relocated: false,
  });
});

test('relocates a changed Markdown document only for one quote with matching context', () => {
  const original = 'before selected source after';
  const exact = markdownFixture('../notes/source.md', original).anchors[0];
  const relocated = 'intro\nbefore selected source after\noutro';
  const unique = resolveMarkdownAnchor(exact, relocated);

  assert.equal(unique.relocated, true);
  assert.deepEqual(unique.range, {
    from: 13,
    to: 28,
    startLine: 2,
    endLine: 2,
  });
  assert.equal(unique.diagnostic, undefined);

  const ambiguousAnchor = { ...exact, prefix: undefined, suffix: undefined };
  assert.equal(
    resolveMarkdownAnchor(ambiguousAnchor, 'selected source + selected source').diagnostic.code,
    'markdown-relocation-ambiguous',
  );
  assert.equal(
    resolveMarkdownAnchor(exact, 'the quote disappeared').diagnostic.code,
    'markdown-relocation-missing',
  );
});

test('returns PDF geometry only for an exact current hash and rejects stale or malformed regions', () => {
  const bytes = Buffer.from('%PDF-1.7\nfixture');
  const anchor = {
    source_id: 'paper',
    kind: 'pdf',
    resource: '../assets/paper.pdf',
    sha256: sha256(bytes),
    page: 2,
    viewrect: [10, 20, 300, 40],
    quote: 'A selected PDF passage.',
  };

  assert.deepEqual(resolvePdfAnchor(anchor, bytes), {
    geometry: { page: 2, rects: [[10, 20, 300, 40]] },
  });
  assert.equal(
    resolvePdfAnchor(anchor, Buffer.from('%PDF-1.7\nchanged')).diagnostic.code,
    'pdf-stale',
  );
  assert.equal(
    resolvePdfAnchor({ ...anchor, viewrect: [10, 20, 0, 40] }, bytes).diagnostic.code,
    'pdf-geometry-invalid',
  );
  assert.equal(
    resolvePdfAnchor({ ...anchor, viewrect: [10, 20, Number.POSITIVE_INFINITY, 40] }, bytes)
      .diagnostic.code,
    'pdf-geometry-invalid',
  );
});

test('discovers canonical and legacy Queries, normalizes source paths, and sorts status/update/path', async () => {
  await withWorkspace(async (root) => {
    const rootText = 'first line\nThe selected source is exact.\nlast line\n';
    const projectText = 'first line\nThe selected source is exact.\nlast line\n';
    await writeWorkspaceFile(root, 'notes/source.md', rootText);
    await writeWorkspaceFile(root, 'projects/alpha/raw/source.md', projectText);
    const rootFixture = markdownFixture('../../notes/source.md', rootText);
    const legacyRootFixture = markdownFixture('../notes/source.md', rootText);
    const projectFixture = markdownFixture('../raw/source.md', projectText);
    await writeWorkspaceFile(root, 'wiki/queries/draft.md', queryPage({
      ...rootFixture,
      title: 'Draft query',
      status: 'draft',
      updated: '2026-08-22T00:00:00Z',
      selectionId: 'draft-id',
      extra: { extension_field: { tolerated: true } },
    }));
    await writeWorkspaceFile(root, 'wiki/queries/stable-old.md', queryPage({
      ...rootFixture,
      title: 'Stable old',
      status: 'stable',
      updated: '2026-08-20T00:00:00Z',
      selectionId: 'stable-old-id',
    }));
    await writeWorkspaceFile(root, 'projects/alpha/queries/stable-new.md', queryPage({
      ...projectFixture,
      title: 'Stable new',
      status: 'stable',
      updated: '2026-08-21T00:00:00Z',
      project: 'alpha',
      selectionId: 'stable-new-id',
    }));
    await writeWorkspaceFile(root, 'queries/deprecated.md', queryPage({
      ...legacyRootFixture,
      title: 'Deprecated query',
      status: 'deprecated',
      updated: '2026-08-23T00:00:00Z',
      selectionId: 'deprecated-id',
    }));

    const index = new QueryAnnotationIndex(root);
    const rootAnnotations = await index.listAnnotationsForSource('./notes/../notes/source.md');
    assert.deepEqual(
      rootAnnotations.map(annotation => annotation.title),
      ['Stable old', 'Draft query', 'Deprecated query'],
    );
    assert.deepEqual(
      rootAnnotations.map(annotation => annotation.status),
      ['stable', 'draft', 'deprecated'],
    );
    assert.equal(rootAnnotations[0].queryPath, 'wiki/queries/stable-old.md');
    assert.equal(rootAnnotations[0].sourcePath, 'notes/source.md');
    assert.equal(rootAnnotations[0].navigationTarget.selectionId, 'stable-old-id');

    const [projectAnnotation] = await index.listAnnotationsForSource(
      'projects\\alpha\\raw\\source.md',
    );
    assert.equal(projectAnnotation.project, 'alpha');
    assert.equal(projectAnnotation.sourcePath, 'projects/alpha/raw/source.md');
  });
});

test('loads navigation targets by query path or immutable selection id without duplicating refreshes', async () => {
  await withWorkspace(async (root) => {
    const text = 'first line\nThe selected source is exact.\nlast line\n';
    await writeWorkspaceFile(root, 'notes/source.md', text);
    await writeWorkspaceFile(root, 'queries/target.md', queryPage({
      ...markdownFixture('../notes/source.md', text),
      selectionId: 'immutable-selection-id',
    }));
    const index = new QueryAnnotationIndex(root);

    await index.refresh();
    await index.refresh();
    assert.equal((await index.listAnnotationsForSource('notes/source.md')).length, 1);
    assert.deepEqual(
      await index.loadNavigationTarget({ selectionId: 'immutable-selection-id' }),
      {
        kind: 'query',
        queryPath: 'queries/target.md',
        selectionId: 'immutable-selection-id',
      },
    );
    assert.deepEqual(
      await index.loadNavigationTarget({ queryPath: 'queries/target.md' }),
      {
        kind: 'query',
        queryPath: 'queries/target.md',
        selectionId: 'immutable-selection-id',
      },
    );
  });
});

test('skips malformed, oversized, misplaced, traversing, absolute, and symlinked Query inputs', async () => {
  await withWorkspace(async (root) => {
    const text = 'first line\nThe selected source is exact.\nlast line\n';
    await writeWorkspaceFile(root, 'notes/source.md', text);
    const fixture = markdownFixture('../notes/source.md', text);
    await writeWorkspaceFile(root, 'queries/valid.md', queryPage({
      ...fixture,
      selectionId: 'valid-id',
    }));
    await writeWorkspaceFile(root, 'queries/bad-hash.md', queryPage({
      sources: fixture.sources,
      anchors: [{ ...fixture.anchors[0], sha256: 'ABC' }],
      selectionId: 'bad-hash-id',
    }));
    await writeWorkspaceFile(root, 'queries/traversal.md', queryPage({
      ...markdownFixture('../../outside.md', text),
      selectionId: 'traversal-id',
    }));
    await writeWorkspaceFile(root, 'queries/absolute.md', queryPage({
      ...markdownFixture('/tmp/outside.md', text),
      selectionId: 'absolute-id',
    }));
    await writeWorkspaceFile(root, 'queries/oversized.md', `${queryPage({
      ...fixture,
      selectionId: 'oversized-id',
    })}${'x'.repeat(8_000)}`);
    await writeWorkspaceFile(root, 'notes/nested/ignored.md', queryPage({
      ...fixture,
      selectionId: 'misplaced-id',
    }));
    await writeWorkspaceFile(root, 'outside-query.md', queryPage({
      ...fixture,
      selectionId: 'outside-id',
    }));
    await mkdir(join(root, 'projects', 'evil'), { recursive: true });
    await symlink(join(root, 'queries'), join(root, 'projects', 'evil', 'queries'));

    const index = new QueryAnnotationIndex(root, { maxFileBytes: 4_000 });
    const annotations = await index.listAnnotationsForSource('notes/source.md');
    assert.deepEqual(annotations.map(annotation => annotation.title), [
      'How does the source behave?',
    ]);
    assert.deepEqual(
      new Set(index.diagnostics.map(diagnostic => diagnostic.code)),
      new Set(['query-anchor', 'query-size']),
    );
  });
});

test('bounds scanned file count and rejects duplicate source ids and invalid Query fields', async () => {
  await withWorkspace(async (root) => {
    const text = 'first line\nThe selected source is exact.\nlast line\n';
    await writeWorkspaceFile(root, 'notes/source.md', text);
    const fixture = markdownFixture('../notes/source.md', text);
    await writeWorkspaceFile(root, 'queries/one.md', queryPage({
      ...fixture,
      selectionId: 'one',
    }));
    await writeWorkspaceFile(root, 'queries/two.md', queryPage({
      ...fixture,
      selectionId: 'two',
    }));
    await writeWorkspaceFile(root, 'queries/duplicate-source.md', queryPage({
      sources: [fixture.sources[0], fixture.sources[0]],
      anchors: fixture.anchors,
      selectionId: 'duplicate',
    }));
    await writeWorkspaceFile(root, 'queries/bad-summary.md', queryPage({
      ...fixture,
      condensedSummary: 'x'.repeat(361),
      selectionId: 'bad-summary',
    }));

    const index = new QueryAnnotationIndex(root, { maxFiles: 2 });
    await index.refresh();
    assert.equal(index.diagnostics.some(entry => entry.code === 'query-file-limit'), true);
    assert.equal((await index.listAnnotationsForSource('notes/source.md')).length <= 2, true);
  });
});

test('maps the legacy LearningNoteStore as read-only compatibility annotations and navigation', async () => {
  await withWorkspace(async (root) => {
    const calls = [];
    const legacyStore = {
      async listAnnotationsForSource(sourcePath) {
        calls.push(['list', sourcePath]);
        return [{
          discussionId: 'legacy-discussion',
          notePath: 'wiki/learning/legacy.md',
          quote: 'Legacy selected passage.',
          question: 'Why was this saved?',
          questionCount: 2,
          summary: 'Because the answer remains durable.',
          startLine: 5,
          endLine: 6,
          from: 40,
          to: 76,
        }];
      },
      async loadDiscussion(discussionId, notePath) {
        calls.push(['load', discussionId, notePath]);
        return {
          note: {
            absolutePath: join(root, 'wiki', 'learning', 'legacy.md'),
            relativePath: notePath,
            markdown: '# Legacy',
          },
        };
      },
    };
    const index = new QueryAnnotationIndex(root, { legacyStore });

    const [annotation] = await index.listAnnotationsForSource('notes/source.md');
    assert.equal(annotation.compatibility, 'legacy-learning-note');
    assert.equal(annotation.title, 'Why was this saved?');
    assert.equal(annotation.condensedSummary, 'Because the answer remains durable.');
    assert.equal(annotation.anchor.kind, 'markdown');
    assert.deepEqual(annotation.navigationTarget, {
      kind: 'legacy',
      discussionId: 'legacy-discussion',
      notePath: 'wiki/learning/legacy.md',
    });

    assert.deepEqual(
      await index.loadNavigationTarget(annotation.navigationTarget),
      {
        kind: 'legacy',
        discussionId: 'legacy-discussion',
        notePath: 'wiki/learning/legacy.md',
        absolutePath: join(root, 'wiki', 'learning', 'legacy.md'),
      },
    );
    assert.deepEqual(calls, [
      ['list', 'notes/source.md'],
      ['load', 'legacy-discussion', 'wiki/learning/legacy.md'],
    ]);
    assert.equal('upsertDiscussion' in legacyStore, false);
  });
});

test('debounces Query and legacy watcher invalidation and disposes timers/watchers/events', async () => {
  const registrations = [];
  const disposed = [];
  const host = {
    createFileSystemWatcher(pattern) {
      const listeners = { change: [], create: [], delete: [] };
      const watcher = {
        onDidChange(listener) { listeners.change.push(listener); },
        onDidCreate(listener) { listeners.create.push(listener); },
        onDidDelete(listener) { listeners.delete.push(listener); },
        dispose() { disposed.push(pattern); },
        listeners,
      };
      registrations.push({ pattern, watcher });
      return watcher;
    },
  };
  const context = { subscriptions: [] };
  let invalidations = 0;
  const index = {
    invalidate() { invalidations += 1; },
  };
  const controller = registerQueryAnnotationWatchers(context, host, index, { debounceMs: 10 });

  assert.deepEqual(registrations.map(entry => entry.pattern), [
    'wiki/queries/*.md',
    'docs/llm-wiki/queries/*.md',
    'queries/*.md',
    'projects/*/queries/*.md',
    'wiki/learning/*.md',
  ]);
  registrations[0].watcher.listeners.create[0]();
  registrations[1].watcher.listeners.change[0]();
  registrations[2].watcher.listeners.delete[0]();
  await new Promise(resolvePromise => setTimeout(resolvePromise, 30));
  assert.equal(invalidations, 1);

  controller.dispose();
  registrations[0].watcher.listeners.change[0]();
  await new Promise(resolvePromise => setTimeout(resolvePromise, 30));
  assert.equal(invalidations, 1);
  for (const subscription of context.subscriptions) subscription.dispose();
  assert.deepEqual(disposed.sort(), [
    'docs/llm-wiki/queries/*.md',
    'projects/*/queries/*.md',
    'queries/*.md',
    'wiki/learning/*.md',
    'wiki/queries/*.md',
  ]);
});

test('read-only discovery never persists transcripts or selection artifacts', async () => {
  await withWorkspace(async (root) => {
    const text = 'first line\nThe selected source is exact.\nlast line\n';
    await writeWorkspaceFile(root, 'notes/source.md', text);
    await writeWorkspaceFile(root, 'queries/query.md', queryPage({
      ...markdownFixture('../notes/source.md', text),
    }));
    const before = await readFile(join(root, 'queries/query.md'), 'utf8');

    const index = new QueryAnnotationIndex(root);
    await index.listAnnotationsForSource('notes/source.md', { refresh: true });

    assert.equal(await readFile(join(root, 'queries/query.md'), 'utf8'), before);
    assert.equal(existsSync(join(root, '.llm_wiki')), false);
    assert.equal(existsSync(join(root, 'wiki', 'learning')), false);
  });
});
