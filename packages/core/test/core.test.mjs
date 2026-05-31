import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import core from '../dist/index.js';

const {
  initVault,
  openDatabase,
  runMigrations,
  closeDatabase,
  registerSource,
  ingestFile,
  rebuildAllLinks,
  getBacklinks,
  getForwardLinks,
  checkLinks,
  parseMarkdownLinks,
  refreshEmbeddings,
  getEmbeddingStatus,
  searchLexical,
  searchSemantic,
  searchHybrid,
  createPdfAnchorFromQuote,
  createPdfAnchorFromSelection,
  resolveAnchor,
  exportSourceContext,
} = core;

function makeVault() {
  const root = mkdtempSync(join(tmpdir(), 'hl-core-'));
  initVault(root, 'Core Test Vault');
  mkdirSync(join(root, 'notes', 'Concepts'), { recursive: true });
  mkdirSync(join(root, 'notes', 'Daily Notes'), { recursive: true });
  mkdirSync(join(root, 'raw', 'pdf'), { recursive: true });
  mkdirSync(join(root, 'raw', 'text'), { recursive: true });
  return root;
}

async function withDb(root, fn) {
  const db = await openDatabase(root);
  runMigrations(db);
  try {
    return await fn(db);
  } finally {
    closeDatabase(db);
  }
}

test('ingests markdown links and returns backlinks', async () => {
  const root = makeVault();
  writeFileSync(
    join(root, 'notes', 'Concepts', 'Online Softmax.md'),
    '# Online Softmax\n\nA numerically stable streaming softmax.\n',
  );
  writeFileSync(
    join(root, 'notes', 'Concepts', 'FlashAttention.md'),
    '# FlashAttention\n\nUses [[Online Softmax]] and cites [the paper](hl://pdf/raw/pdf/fa.txt?anchor=anc_missing).\n',
  );

  await withDb(root, async (db) => {
    for (const rel of [
      'notes/Concepts/Online Softmax.md',
      'notes/Concepts/FlashAttention.md',
    ]) {
      const source = registerSource(db, root, rel);
      ingestFile(db, root, rel, source.id);
    }
    const result = rebuildAllLinks(db, root);
    assert.equal(result.notes, 2);
    assert.equal(result.total_inserted, 2);

    const backlinks = getBacklinks(db, 'hl://note/notes/Concepts/Online%20Softmax.md');
    assert.equal(backlinks.length, 1);
    assert.equal(backlinks[0].from_note_path, 'notes/Concepts/FlashAttention.md');

    const issues = checkLinks(db);
    assert.ok(issues.length >= 1);
    assert.ok(issues.some(issue => /anchor|source|Target/i.test(issue.message)));
  });
});

test('link checks persist broken and resolved status transitions', async () => {
  const root = makeVault();
  writeFileSync(
    join(root, 'notes', 'Concepts', 'Source.md'),
    '# Source\n\nReferences [[Target Note]].\n',
  );

  await withDb(root, async (db) => {
    const source = registerSource(db, root, 'notes/Concepts/Source.md');
    ingestFile(db, root, 'notes/Concepts/Source.md', source.id);
    rebuildAllLinks(db, root);

    const firstIssues = checkLinks(db);
    assert.equal(firstIssues.length, 1);
    assert.equal(
      db.prepare('SELECT status FROM links').get().status,
      'broken',
    );

    writeFileSync(
      join(root, 'notes', 'Concepts', 'Target Note.md'),
      '# Target Note\n\nNow present.\n',
    );
    const target = registerSource(db, root, 'notes/Concepts/Target Note.md');
    ingestFile(db, root, 'notes/Concepts/Target Note.md', target.id);

    const secondIssues = checkLinks(db);
    assert.equal(secondIssues.length, 0);
    assert.equal(
      db.prepare('SELECT status FROM links').get().status,
      'resolved',
    );
  });
});

test('link rebuild skips registered markdown sources that no longer exist', async () => {
  const root = makeVault();
  writeFileSync(
    join(root, 'notes', 'Concepts', 'Source.md'),
    '# Source\n\nReferences [[Target Note]].\n',
  );
  writeFileSync(
    join(root, 'notes', 'Concepts', 'Missing.md'),
    '# Missing\n\nThis source was deleted after registration.\n',
  );

  await withDb(root, async (db) => {
    registerSource(db, root, 'notes/Concepts/Source.md');
    registerSource(db, root, 'notes/Concepts/Missing.md');
    unlinkSync(join(root, 'notes', 'Concepts', 'Missing.md'));

    const result = rebuildAllLinks(db, root);

    assert.equal(result.notes, 1);
    assert.equal(result.total_inserted, 1);
    assert.equal(getForwardLinks(db, 'notes/Concepts/Source.md').length, 1);
  });
});

test('ingests folder-qualified Obsidian wikilinks without flattening paths', async () => {
  const root = makeVault();
  writeFileSync(
    join(root, 'notes', 'Daily Notes', '2026-05-25.md'),
    '# 2026-05-25\n\nDaily note target.\n',
  );
  writeFileSync(
    join(root, 'notes', 'Concepts', 'Source.md'),
    '# Source\n\nReviewed [[Daily Notes/2026-05-25|today]].\n',
  );

  await withDb(root, async (db) => {
    for (const rel of [
      'notes/Daily Notes/2026-05-25.md',
      'notes/Concepts/Source.md',
    ]) {
      const source = registerSource(db, root, rel);
      ingestFile(db, root, rel, source.id);
    }
    rebuildAllLinks(db, root);

    const backlinks = getBacklinks(db, 'hl://note/notes/Daily%20Notes/2026-05-25.md');
    assert.equal(backlinks.length, 1);
    assert.equal(backlinks[0].from_note_path, 'notes/Concepts/Source.md');
    assert.equal(checkLinks(db).length, 0);
  });
});

test('link rebuild resolves unqualified Obsidian wikilinks by registered note basename', async () => {
  const root = makeVault();
  mkdirSync(join(root, 'notes', 'Papers'), { recursive: true });
  writeFileSync(
    join(root, 'notes', 'Papers', 'FlashAttention Paper.md'),
    '# FlashAttention Paper Notes\n\nPaper target.\n',
  );
  writeFileSync(
    join(root, 'notes', 'Daily Notes', '2026-05-25.md'),
    '# 2026-05-25\n\nReread [[FlashAttention Paper]] sections 2-3.\n',
  );

  await withDb(root, async (db) => {
    for (const rel of [
      'notes/Papers/FlashAttention Paper.md',
      'notes/Daily Notes/2026-05-25.md',
    ]) {
      const source = registerSource(db, root, rel);
      ingestFile(db, root, rel, source.id);
    }

    rebuildAllLinks(db, root);

    const forward = getForwardLinks(db, 'notes/Daily Notes/2026-05-25.md');
    assert.equal(forward.length, 1);
    assert.equal(forward[0].to_uri, 'hl://note/notes/Papers/FlashAttention%20Paper.md');
    assert.equal(forward[0].label, 'FlashAttention Paper');
    assert.equal(checkLinks(db).length, 0);
  });
});

test('parses folder-qualified Obsidian wikilinks with basename display labels', () => {
  const links = parseMarkdownLinks(
    [
      'See [[Concepts/FlashAttention]], [[notes/Projects/Roadmap.md#Milestones]], and [[Daily Notes/2026-05-25|today]].',
    ].join('\n'),
    'notes/Concepts/Source.md',
  );

  assert.equal(links.length, 3);
  assert.deepEqual(
    links.map(link => link.label),
    ['FlashAttention', 'Roadmap > Milestones', 'today'],
  );
  assert.deepEqual(
    links.map(link => link.uri),
    [
      'hl://note/notes/Concepts/FlashAttention.md',
      'hl://note/notes/Projects/Roadmap.md#Milestones',
      'hl://note/notes/Daily%20Notes/2026-05-25.md',
    ],
  );
});

test('parses same-note Obsidian heading wikilinks against the source note path', () => {
  const links = parseMarkdownLinks(
    '# Source\n\nSee [[#Local Section|local section]].\n\n## Local Section\n',
    'notes/Concepts/Source.md',
  );

  assert.equal(links.length, 1);
  assert.equal(links[0].uri, 'hl://note/notes/Concepts/Source.md#Local%20Section');
  assert.equal(links[0].label, 'local section');
  assert.equal(links[0].kind, 'heading_wikilink');
});

test('refreshes deterministic embeddings and supports semantic and hybrid search', async () => {
  const root = makeVault();
  writeFileSync(
    join(root, 'notes', 'Concepts', 'FlashAttention.md'),
    '# FlashAttention\n\nFlashAttention tiles queries and keys to reduce memory traffic in attention.\n',
  );
  writeFileSync(
    join(root, 'notes', 'Concepts', 'CUDA Shared Memory.md'),
    '# CUDA Shared Memory\n\nShared memory stores tiles close to CUDA thread blocks.\n',
  );

  await withDb(root, async (db) => {
    for (const rel of [
      'notes/Concepts/FlashAttention.md',
      'notes/Concepts/CUDA Shared Memory.md',
    ]) {
      const source = registerSource(db, root, rel);
      ingestFile(db, root, rel, source.id);
    }

    const refreshed = refreshEmbeddings(db, { changedOnly: true });
    assert.equal(refreshed.model_id, 'hl-local-hash-v1');
    assert.equal(refreshed.embedded, 2);

    const status = getEmbeddingStatus(db);
    assert.equal(status.embedded_chunks, 2);
    assert.equal(status.missing_chunks, 0);

    const lexical = searchLexical(db, 'attention memory', 5);
    const semantic = searchSemantic(db, 'memory traffic attention', 5);
    const hybrid = searchHybrid(db, 'memory traffic attention', 5);
    const sharedMemory = searchLexical(db, 'shared memory', 5)
      .find(result => result.source_path === 'notes/Concepts/CUDA Shared Memory.md');

    assert.ok(lexical.length >= 1);
    assert.equal(
      sharedMemory?.anchor_uri,
      'hl://note/notes/Concepts/CUDA%20Shared%20Memory.md',
    );
    assert.ok(semantic.length >= 1);
    assert.ok(hybrid.length >= 1);
    assert.equal(hybrid[0].source_kind, 'markdown');
  });
});

test('creates a quote-based PDF anchor and exports source context files', async () => {
  const root = makeVault();
  writeFileSync(
    join(root, 'raw', 'pdf', 'fa.txt'),
    'Page 1\nFlashAttention uses tiling to reduce HBM reads and writes.\n',
  );
  writeFileSync(
    join(root, 'notes', 'Concepts', 'FlashAttention.md'),
    '# FlashAttention\n\nA source-grounded note.\n',
  );

  await withDb(root, async (db) => {
    const pdf = registerSource(db, root, 'raw/pdf/fa.txt', 'pdf');
    ingestFile(db, root, 'raw/pdf/fa.txt', pdf.id);
    const note = registerSource(db, root, 'notes/Concepts/FlashAttention.md');
    ingestFile(db, root, 'notes/Concepts/FlashAttention.md', note.id);

    const anchor = createPdfAnchorFromQuote(db, root, 'raw/pdf/fa.txt', {
      quote: 'FlashAttention uses tiling',
      createdBy: 'user',
    });
    assert.match(anchor.id, /^anc_pdf_/);
    assert.equal(anchor.status, 'resolved');
    assert.match(anchor.uri, /^hl:\/\/pdf\/raw\/pdf\/fa.txt\?anchor=anc_pdf_/);

    const resolved = resolveAnchor(db, anchor.id);
    assert.equal(resolved?.text_quote, 'FlashAttention uses tiling');

    const context = exportSourceContext(db, root, {
      sourcePath: 'notes/Concepts/FlashAttention.md',
    });
    assert.equal(context.source, 'notes/Concepts/FlashAttention.md');
    assert.match(context.markdown, /# Source Context/);
    assert.ok(readFileSync(join(root, '.hl', 'agent', 'context.md'), 'utf8').includes('FlashAttention'));
    assert.ok(readFileSync(join(root, '.hl', 'agent', 'context.json'), 'utf8').includes('FlashAttention.md'));
  });
});

test('creates resolved PDF anchors from trusted webview selections', async () => {
  const root = makeVault();
  writeFileSync(
    join(root, 'raw', 'pdf', 'paper.pdf'),
    Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff]),
  );

  await withDb(root, async (db) => {
    const anchor = createPdfAnchorFromSelection(db, root, 'raw/pdf/paper.pdf', {
      quote: 'Attention is all you need',
      page: 3,
      textItemIndex: 12,
      charOffset: 4,
      endTextItemIndex: 14,
      endCharOffset: 9,
      createdBy: 'user',
    });

    assert.equal(anchor.status, 'resolved');
    assert.equal(anchor.confidence, 1);
    assert.match(anchor.uri, /^hl:\/\/pdf\/raw\/pdf\/paper.pdf\?anchor=anc_pdf_/);

    const locator = JSON.parse(anchor.locator_json);
    assert.equal(locator.strategy, 'webview-selection');
    assert.equal(locator.page, 3);
    assert.equal(locator.textItemIndex, 12);
    assert.equal(locator.charOffset, 4);
    assert.equal(locator.endTextItemIndex, 14);
    assert.equal(locator.endCharOffset, 9);
    assert.equal(locator.quote_length, 'Attention is all you need'.length);
    assert.equal(locator.quote_offset, null);
  });
});
