/**
 * Pure-logic E2E test: full bidirectional link pipeline.
 *
 * Simulates the complete user workflow:
 *   1. Create a vault and ingest a PDF + markdown notes
 *   2. Create PDF anchors (simulating webview selection)
 *   3. Insert PDF anchor links into markdown notes
 *   4. Parse wiki links and PDF links from markdown
 *   5. Rebuild link graph and verify backlinks/forward links
 *   6. Verify anchor resolution across PDF and markdown
 *   7. Export agent context with all references
 *
 * Run: node packages/vscode-extension/test/e2e/pure-e2e.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const cli = join(packageRoot, 'cli', 'dist', 'main.js');
const coreDist = join(packageRoot, 'core', 'dist', 'index.js');

function runCli(args, cwd) {
  const output = execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}

function makeVault(name) {
  const root = mkdtempSync(join(tmpdir(), 'hl-e2e-'));
  runCli(['init', '.', '--name', name], root);
  mkdirSync(join(root, 'notes', 'Concepts'), { recursive: true });
  mkdirSync(join(root, 'raw', 'pdf'), { recursive: true });
  return root;
}

// ─── WIKI LINK + NATIVE MARKDOWN LINK PARSER (mirrors core/src/links/link-parser.ts) ───

function parseWikiLinks(text) {
  const refs = [];
  const regex = /\[\[([^\]#|]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > 0 && text[match.index - 1] === '!') continue;
    refs.push({
      noteName: (match[1] ?? '').trim(),
      heading: match[2]?.trim(),
      alias: match[3]?.trim(),
      raw: match[0],
    });
  }
  return refs;
}

function parseMarkdownLinks(text) {
  const refs = [];
  const regex = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    refs.push({ label: match[1], uri: match[2], raw: match[0] });
  }
  return refs;
}

// ═══════════════════════════════════════════════════════════════════

test('E2E: full bidirectional link pipeline', async (t) => {
  const root = makeVault('Bidirectional E2E');

  // ── 1. Create source files ──

  writeFileSync(
    join(root, 'raw', 'pdf', 'transformer-paper.txt'),
    [
      'Page 1',
      'Abstract',
      'The dominant sequence transduction models are based on complex recurrent',
      'or convolutional neural networks that include an encoder and a decoder.',
      'The best performing models also connect the encoder and decoder through',
      'an attention mechanism.',
      '',
      'Page 2',
      'Introduction',
      'We propose a new simple network architecture, the Transformer, based',
      'solely on attention mechanisms, dispensing with recurrence and convolutions',
      'entirely.',
    ].join('\n'),
  );

  // ── 2. Ingest PDF source first (needed for anchor creation) ──

  const ingestPdf = runCli(['ingest', 'raw/pdf/transformer-paper.txt', '--json'], root);
  assert.equal(ingestPdf.status, 'ok', 'PDF ingested');

  // ── 3. Create PDF anchors FIRST, then use real URIs in markdown ──

  const anchor1 = runCli([
    'anchor', 'create-pdf',
    'raw/pdf/transformer-paper.txt',
    '--quote', 'attention mechanism',
    '--json',
  ], root);
  assert.equal(anchor1.status, 'ok');
  assert.match(anchor1.anchor.uri, /^raw\/pdf\/transformer-paper.txt#page=\d+&anchor=anc_pdf_/);

  const anchor2 = runCli([
    'anchor', 'create-pdf',
    'raw/pdf/transformer-paper.txt',
    '--quote', 'new simple network architecture',
    '--json',
  ], root);
  assert.equal(anchor2.status, 'ok');

  // ── 4. Write markdown notes using REAL anchor URIs ──

  writeFileSync(
    join(root, 'notes', 'Concepts', 'Transformers.md'),
    [
      '# Transformers',
      '',
      'The Transformer architecture uses [[Attention Mechanism]] to process sequences.',
      '',
      `As shown in [the paper](${anchor1.anchor.uri}),`,
      'attention replaces recurrence.',
      '',
      'Key insight from the abstract:',
      '> The dominant sequence transduction models are based on complex recurrent',
      '> or convolutional neural networks.',
    ].join('\n'),
  );

  writeFileSync(
    join(root, 'notes', 'Concepts', 'Attention Mechanism.md'),
    [
      '# Attention Mechanism',
      '',
      'Attention allows the model to focus on relevant parts of the input.',
      '',
      'See [[Transformers]] for the full architecture.',
      '',
      `The paper describes it as [a new architecture](${anchor2.anchor.uri}).`,
    ].join('\n'),
  );

  // ── 5. Ingest markdown notes ──

  const ingestNotes = runCli(['ingest', 'notes', '--recursive', '--json'], root);
  assert.equal(ingestNotes.status, 'ok');
  assert.equal(ingestNotes.ingested, 2, '2 markdown notes ingested');

  // ── 6. Rebuild link graph ──

  const links = runCli(['links', 'rebuild', '--json'], root);
  assert.equal(links.status, 'ok');
  assert.ok(links.inserted >= 2, `Expected >=2 links inserted, got ${links.inserted}`);

  // ── 7. Check link health ──

  const linkCheck = runCli(['links', 'check', '--json'], root);
  assert.equal(linkCheck.status, 'clean', `Expected clean links, got: ${JSON.stringify(linkCheck.issues)}`);

  // ── 8. Parse wiki links and native markdown source links ──

  const transformersText = readFileSync(
    join(root, 'notes', 'Concepts', 'Transformers.md'), 'utf8',
  );
  const wikiRefs = parseWikiLinks(transformersText);
  assert.equal(wikiRefs.length, 1, 'Transformers.md has 1 wiki link');
  assert.equal(wikiRefs[0].noteName, 'Attention Mechanism');

  const markdownRefs = parseMarkdownLinks(transformersText);
  assert.ok(markdownRefs.length >= 1, 'Transformers.md has native markdown links');
  assert.ok(markdownRefs.every(link => !link.uri.startsWith('hl://')));

  const attentionText = readFileSync(
    join(root, 'notes', 'Concepts', 'Attention Mechanism.md'), 'utf8',
  );
  const attentionWiki = parseWikiLinks(attentionText);
  assert.equal(attentionWiki.length, 1, 'Attention Mechanism.md has 1 wiki link');
  assert.equal(attentionWiki[0].noteName, 'Transformers');

  // ── 9. Verify bidirectional backlinks ──

  const transformersUri = 'notes/Concepts/Transformers.md';
  const backlinksToTransformers = runCli(['links', 'backlinks', transformersUri, '--json'], root);
  assert.equal(backlinksToTransformers.count, 1, '1 backlink to Transformers');
  assert.equal(
    backlinksToTransformers.backlinks[0].from,
    'notes/Concepts/Attention Mechanism.md',
    'Backlink comes from Attention Mechanism',
  );

  const attentionUri = 'notes/Concepts/Attention Mechanism.md';
  const backlinksToAttention = runCli(['links', 'backlinks', attentionUri, '--json'], root);
  assert.equal(backlinksToAttention.count, 1, '1 backlink to Attention Mechanism');
  assert.equal(
    backlinksToAttention.backlinks[0].from,
    'notes/Concepts/Transformers.md',
    'Backlink comes from Transformers',
  );

  // ── 8. Verify forward links ──

  const forwardFromTransformers = runCli([
    'links', 'forward', 'notes/Concepts/Transformers.md', '--json',
  ], root);
  assert.ok(forwardFromTransformers.count >= 2, 'Transformers has forward links');

  const forwardFromAttention = runCli([
    'links', 'forward', 'notes/Concepts/Attention Mechanism.md', '--json',
  ], root);
  assert.ok(forwardFromAttention.count >= 2, 'Attention Mechanism has forward links');

  // ── 9. Resolve anchors ──

  const resolved1 = runCli(['anchor', 'resolve', anchor1.anchor.id, '--json'], root);
  assert.equal(resolved1.status, 'ok');
  assert.equal(resolved1.anchor.text_quote, 'attention mechanism');

  const resolved2 = runCli(['anchor', 'resolve', anchor2.anchor.id, '--json'], root);
  assert.equal(resolved2.status, 'ok');

  // ── 10. Search finds linked content ──

  const search = runCli(['search', 'attention mechanism transformer', '--mode', 'lexical', '--json'], root);
  assert.ok(search.count >= 2, `Search found ${search.count} results (expected >=2)`);
  const hasTextSource = search.results.some(r => r.source_kind === 'pdf' || r.source_kind === 'text');
  const hasMd = search.results.some(r => r.source_kind === 'markdown');
  assert.ok(hasTextSource, 'Search includes text/PDF source');
  assert.ok(hasMd, 'Search includes markdown source');

  // ── 11. Export agent context ──

  const context = runCli([
    'context', 'export',
    '--source', 'notes/Concepts/Transformers.md',
    '--json',
  ], root);
  assert.equal(context.status, 'ok');
  assert.ok(context.context.markdown.includes('Transformers'));
  assert.ok(context.context.markdown.includes('notes/Concepts/Transformers.md'));
  assert.ok(existsSync(join(root, '.hl', 'agent', 'context.md')));
  assert.ok(existsSync(join(root, '.hl', 'agent', 'context.json')));

  // ── 12. Verify context file has link references ──

  const contextMd = readFileSync(join(root, '.hl', 'agent', 'context.md'), 'utf8');
  assert.ok(!contextMd.includes('hl://'), 'Agent context does not emit hl:// links');
  assert.ok(contextMd.includes('notes/Concepts/Transformers.md'), 'Agent context includes native links');
});

test('E2E: PDF anchor → markdown link → anchor resolution round-trip', async () => {
  const root = makeVault('Anchor Round-Trip');

  writeFileSync(
    join(root, 'raw', 'pdf', 'paper.txt'),
    'Abstract\n\nWe demonstrate that attention mechanisms improve NLP tasks.\n\nIntroduction\n\nRecent advances show promising results.\n',
  );

  writeFileSync(
    join(root, 'notes', 'Concepts', 'NLP Research.md'),
    '# NLP Research\n\nKey finding: attention mechanisms work well.\n',
  );

  // Ingest
  runCli(['ingest', 'notes', '--recursive', '--json'], root);
  runCli(['ingest', 'raw/pdf/paper.txt', '--json'], root);

  // Create PDF anchor from quote
  const anchor = runCli([
    'anchor', 'create-pdf', 'raw/pdf/paper.txt',
    '--quote', 'attention mechanisms improve NLP',
    '--json',
  ], root);
  assert.equal(anchor.status, 'ok');

  // Verify the anchor URI follows the expected format
  const uri = anchor.anchor.uri;
  assert.match(uri, /^raw\/pdf\/paper.txt#page=\d+&anchor=anc_pdf_/);

  // This URI can be embedded in markdown as [label](uri)
  const markdownLink = `[see paper](${uri})`;
  assert.match(markdownLink, /\[see paper\]\(raw\/pdf\/paper.txt#page=\d+&anchor=anc_pdf_/);

  // Resolve anchor from URI
  const resolved = runCli(['anchor', 'resolve', uri, '--json'], root);
  assert.equal(resolved.status, 'ok');
  assert.equal(resolved.anchor.text_quote, 'attention mechanisms improve NLP');

  // The full round-trip: quote → anchor → URI → markdown link → URI → anchor → quote
  const reResolved = runCli(['anchor', 'resolve', resolved.anchor.id, '--json'], root);
  assert.equal(reResolved.anchor.text_quote, 'attention mechanisms improve NLP');
  assert.equal(reResolved.anchor.uri, uri);
});
