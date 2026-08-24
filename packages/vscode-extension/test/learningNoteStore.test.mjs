import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadStoreModule() {
  const filename = join(packageRoot, 'src', 'learningNoteStore.ts');
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

const { LearningNoteStore } = loadStoreModule();

async function withWorkspace(run) {
  const root = await mkdtemp(join(tmpdir(), 'llm-wiki-legacy-learning-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeLegacyNote(root) {
  const discussionId = 'legacy-discussion-123';
  const shortId = createHash('sha256').update(discussionId).digest('hex').slice(0, 10);
  const relativePath = `wiki/learning/2026-01-10-legacy-${shortId}.md`;
  const absolutePath = join(root, ...relativePath.split('/'));
  const messages = [
    { role: 'user', markdown: 'Why does the source matter?', createdAt: '2026-01-10T08:00:00.000Z' },
    { role: 'assistant', markdown: 'It preserves the selected invariant.', createdAt: '2026-01-10T08:01:00.000Z' },
  ];
  const encoded = Buffer.from(JSON.stringify(messages), 'utf8').toString('base64url');
  const markdown = `---
id: "${discussionId}"
type: learning-note
status: draft
source:
  kind: "markdown"
  path: "notes/source.md"
  link: "notes/source.md#L2"
  location: "lines 2-2"
source_start_line: 2
source_end_line: 2
discussion_messages_b64: "${encoded}"
created: "2026-01-10T08:00:00.000Z"
updated: "2026-01-10T08:01:00.000Z"
---

# Why does the source matter?

## Summary

**Question:** Why does the source matter?

**Answer:** It preserves the selected invariant.

## Source

### Quoted passage

\`\`\`text
The exact selected passage.
\`\`\`

## Discussion

## Personal notes
`;
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, markdown);
  return { discussionId, relativePath, absolutePath };
}

test('legacy learning-note adapter exposes no mutation API', async () => {
  await withWorkspace(async root => {
    const store = new LearningNoteStore(root);
    assert.equal(store.upsertDiscussion, undefined);
    assert.deepEqual(await store.listAnnotationsForSource('notes/source.md'), []);
  });
});

test('legacy learning notes remain readable for annotations and navigation', async () => {
  await withWorkspace(async root => {
    const fixture = await writeLegacyNote(root);
    const store = new LearningNoteStore(root);
    const loaded = await store.loadDiscussion(fixture.discussionId, fixture.relativePath);
    assert.equal(loaded?.note.absolutePath, fixture.absolutePath);
    assert.equal(loaded?.messages.length, 2);
    assert.equal(loaded?.source.quote, 'The exact selected passage.');

    const annotations = await store.listAnnotationsForSource('notes/source.md');
    assert.equal(annotations.length, 1);
    assert.equal(annotations[0].question, 'Why does the source matter?');
    assert.equal(annotations[0].summary, 'It preserves the selected invariant.');
    assert.equal(annotations[0].notePath, fixture.relativePath);
  });
});

test('legacy reader rejects traversal and mismatched identities', async () => {
  await withWorkspace(async root => {
    const fixture = await writeLegacyNote(root);
    const store = new LearningNoteStore(root);
    assert.equal(await store.loadDiscussion(fixture.discussionId, '../outside.md'), undefined);
    assert.equal(await store.loadDiscussion('another-id', fixture.relativePath), undefined);
  });
});
