import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { dirname, join, resolve } from 'node:path';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const filesystemWiki = loadTsModule('src/filesystemWiki.ts');

test('filesystem wiki reads inline and block concept/entity frontmatter lists', () => {
  const wiki = filesystemWiki.createFilesystemWiki([
    {
      path: 'Memory.md',
      text: [
        '\uFEFF---',
        'concepts: [Spaced repetition, "Memory, consolidation", SPACED REPETITION]',
        'entities:',
        '  - Hermann Ebbinghaus # researcher',
        "  - 'VS Code'",
        '  - "C#"',
        '---',
        '# Memory',
        '',
        '[Review](Review.md)',
      ].join('\n'),
    },
    {
      path: 'Review.md',
      text: [
        '---',
        'concepts:',
        '  - Forgetting curve',
        '  - spaced repetition',
        'entities: [Hermann Ebbinghaus, SuperMemo]',
        '---',
        '# Review',
      ].join('\n'),
    },
  ]);

  const memory = wiki.documents.find(document => document.path === 'Memory.md');
  const review = wiki.documents.find(document => document.path === 'Review.md');
  assert.deepEqual(memory.concepts, ['Spaced repetition', 'Memory, consolidation']);
  assert.deepEqual(memory.entities, ['Hermann Ebbinghaus', 'VS Code', 'C#']);
  assert.deepEqual(review.concepts, ['Forgetting curve', 'spaced repetition']);
  assert.deepEqual(review.entities, ['Hermann Ebbinghaus', 'SuperMemo']);
});

test('concept graph keeps note links and adds deduplicated typed metadata relationships', () => {
  const wiki = filesystemWiki.createFilesystemWiki([
    {
      path: 'Memory.md',
      text: [
        '---',
        'concepts: [Spaced repetition]',
        'entities: [Hermann Ebbinghaus]',
        '---',
        '# Memory',
        '[Review](Review.md)',
      ].join('\n'),
    },
    {
      path: 'Review.md',
      text: [
        '---',
        'concepts: [spaced repetition, Forgetting curve]',
        'entities: [Hermann Ebbinghaus]',
        '---',
        '# Review',
      ].join('\n'),
    },
  ]);

  const graph = filesystemWiki.getConceptGraph(wiki);
  assert.deepEqual(
    graph.nodes.filter(node => node.kind === 'note'),
    [
      { id: 'Memory.md', label: 'Memory', path: 'Memory.md', kind: 'note' },
      { id: 'Review.md', label: 'Review', path: 'Review.md', kind: 'note' },
    ],
  );
  assert.deepEqual(
    graph.nodes.filter(node => node.kind !== 'note'),
    [
      {
        id: 'concept:forgetting curve',
        label: 'Forgetting curve',
        kind: 'concept',
      },
      {
        id: 'concept:spaced repetition',
        label: 'Spaced repetition',
        kind: 'concept',
      },
      {
        id: 'entity:hermann ebbinghaus',
        label: 'Hermann Ebbinghaus',
        kind: 'entity',
      },
    ],
  );

  assert.deepEqual(
    graph.edges.find(edge => edge.id === 'Memory.md->Review.md'),
    {
      id: 'Memory.md->Review.md',
      source: 'Memory.md',
      target: 'Review.md',
      count: 1,
      labels: ['Review'],
    },
  );
  assert.deepEqual(
    graph.edges.filter(edge => edge.kind === 'concept'),
    [
      {
        id: 'Memory.md->concept:spaced repetition',
        source: 'Memory.md',
        target: 'concept:spaced repetition',
        count: 1,
        labels: [],
        kind: 'concept',
      },
      {
        id: 'Review.md->concept:forgetting curve',
        source: 'Review.md',
        target: 'concept:forgetting curve',
        count: 1,
        labels: [],
        kind: 'concept',
      },
      {
        id: 'Review.md->concept:spaced repetition',
        source: 'Review.md',
        target: 'concept:spaced repetition',
        count: 1,
        labels: [],
        kind: 'concept',
      },
    ],
  );
  assert.equal(
    graph.edges.filter(edge => edge.target === 'entity:hermann ebbinghaus').length,
    2,
  );
});

test('filesystem wiki ignores scalar, body, and unterminated metadata lookalikes', () => {
  const wiki = filesystemWiki.createFilesystemWiki([
    {
      path: 'Scalar.md',
      text: [
        '---',
        'concepts: This is not a YAML list',
        'entities:',
        '  name: Not a sequence',
        '---',
        '# Scalar',
        'concepts: [Body text is not metadata]',
      ].join('\n'),
    },
    {
      path: 'Unterminated.md',
      text: [
        '---',
        'concepts: [Should be ignored]',
        '# No closing delimiter',
      ].join('\n'),
    },
  ]);

  assert.deepEqual(
    wiki.documents.map(document => [document.path, document.concepts, document.entities]),
    [
      ['Scalar.md', [], []],
      ['Unterminated.md', [], []],
    ],
  );
  assert.deepEqual(
    filesystemWiki.getConceptGraph(wiki).nodes.map(node => node.kind),
    ['note', 'note'],
  );
});

test('filesystem wiki bounds Markdown file count and bytes before building the index', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hl-filesystem-wiki-limits-'));
  try {
    mkdirSync(join(root, 'notes'), { recursive: true });
    writeFileSync(join(root, 'notes', 'One.md'), '# One');
    writeFileSync(join(root, 'notes', 'Two.md'), '# Two');

    await assert.rejects(
      filesystemWiki.loadFilesystemWiki(root, { maxFiles: 1 }),
      /Filesystem wiki scan limit exceeded: Markdown file count exceeds 1/,
    );
    await assert.rejects(
      filesystemWiki.loadFilesystemWiki(root, { maxFileBytes: 3 }),
      /Filesystem wiki scan limit exceeded: notes\/One\.md exceeds 3 bytes/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
