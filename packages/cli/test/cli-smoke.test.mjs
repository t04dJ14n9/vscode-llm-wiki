import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(packageRoot, 'dist', 'main.js');

function run(args, cwd) {
  const output = execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}

function runAsync(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`hl ${args.join(' ')} failed with ${code}: ${stderr}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

test('hl smoke flow initializes, ingests, embeds, searches, links, anchors, and exports context', () => {
  const root = mkdtempSync(join(tmpdir(), 'hl-cli-'));
  const init = run(['init', '.', '--name', 'CLI Smoke'], root);
  assert.equal(init.status, 'ok');
  const status = run(['status'], root);
  assert.equal(status.config.name, 'CLI Smoke');

  mkdirSync(join(root, 'notes', 'Concepts'), { recursive: true });
  mkdirSync(join(root, 'raw', 'pdf'), { recursive: true });
  writeFileSync(
    join(root, 'notes', 'Concepts', 'Online Softmax.md'),
    '# Online Softmax\n\nStreaming softmax keeps running maxima and denominators.\n',
  );
  writeFileSync(
    join(root, 'notes', 'Concepts', 'FlashAttention.md'),
    '# FlashAttention\n\nUses [[Online Softmax]] to reduce memory traffic.\n',
  );
  writeFileSync(
    join(root, 'raw', 'pdf', 'fa.txt'),
    'FlashAttention uses tiling to reduce HBM reads and writes.\n',
  );

  const ingestNotes = run(['ingest', 'notes', '--recursive', '--json'], root);
  assert.equal(ingestNotes.status, 'ok');
  assert.equal(ingestNotes.ingested, 2);

  const ingestPdf = run(['ingest', 'raw/pdf/fa.txt', '--json'], root);
  assert.equal(ingestPdf.status, 'ok');

  const embeddings = run(['embeddings', 'refresh', '--changed', '--json'], root);
  assert.equal(embeddings.status, 'ok');
  assert.ok(embeddings.embedded >= 3);

  const search = run(['search', 'memory traffic attention', '--mode', 'hybrid', '--json'], root);
  assert.equal(search.query, 'memory traffic attention');
  assert.ok(search.count >= 1);

  const links = run(['links', 'rebuild', '--json'], root);
  assert.equal(links.status, 'ok');
  assert.equal(links.inserted, 1);

  const anchor = run([
    'anchor',
    'create-pdf',
    'raw/pdf/fa.txt',
    '--quote',
    'FlashAttention uses tiling',
    '--json',
  ], root);
  assert.equal(anchor.status, 'ok');
  assert.match(anchor.anchor.uri, /^raw\/pdf\/fa.txt#page=\d+&anchor=anc_pdf_/);

  const context = run([
    'context',
    'export',
    '--source',
    'notes/Concepts/FlashAttention.md',
    '--json',
  ], root);
  assert.equal(context.status, 'ok');
  assert.equal(context.context.source, 'notes/Concepts/FlashAttention.md');
  assert.ok(readFileSync(join(root, '.hl', 'agent', 'context.md'), 'utf8').includes('FlashAttention'));
});

test('hl serializes concurrent writes to the vault database', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hl-cli-concurrent-'));
  run(['init', '.', '--name', 'Concurrent Smoke'], root);

  const firstDir = join(root, 'notes', 'First');
  const secondDir = join(root, 'notes', 'Second');
  mkdirSync(firstDir, { recursive: true });
  mkdirSync(secondDir, { recursive: true });

  for (let i = 0; i < 40; i++) {
    writeFileSync(join(firstDir, `First ${i}.md`), `# First ${i}\n\nAlpha concurrent write ${i}.\n`);
    writeFileSync(join(secondDir, `Second ${i}.md`), `# Second ${i}\n\nBeta concurrent write ${i}.\n`);
  }

  const [first, second] = await Promise.all([
    runAsync(['ingest', 'notes/First', '--recursive', '--json'], root),
    runAsync(['ingest', 'notes/Second', '--recursive', '--json'], root),
  ]);

  assert.equal(first.ingested, 40);
  assert.equal(second.ingested, 40);

  const status = run(['status'], root);
  assert.equal(status.counts.sources, 80);
  assert.equal(status.counts.chunks, 80);
});
