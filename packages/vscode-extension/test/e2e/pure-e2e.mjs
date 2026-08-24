/** Pure filesystem E2E for Query discovery and source-anchor resolution. */
import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadQueryIndex() {
  const filename = join(packageRoot, 'src', 'queryAnnotationIndex.ts');
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

const queryIndex = loadQueryIndex();
const sha256 = value => createHash('sha256').update(value).digest('hex');

function makeVault() {
  const root = mkdtempSync(join(tmpdir(), 'llm-wiki-query-e2e-'));
  for (const path of [
    'queries',
    'projects/demo/queries',
    'projects/demo/raw',
    'projects/demo/assets',
  ]) mkdirSync(join(root, path), { recursive: true });
  return root;
}

test('E2E: Markdown selection → Query page → source annotation → navigation', async () => {
  const root = makeVault();
  const sourcePath = 'projects/demo/raw/source.md';
  const source = '# Source\n\nAlpha selected passage Omega\n';
  const quote = 'selected passage';
  const from = source.indexOf(quote);
  writeFileSync(join(root, sourcePath), source);
  writeFileSync(join(root, 'projects/demo/queries/meaning.md'), `---
type: Query
title: Why does this passage matter?
description: A durable explanation of the selected invariant.
condensed_summary: The passage names the invariant preserved by the update.
status: stable
generated: {by: process:test, at: 2026-08-23T00:00:00Z}
project: demo
conversation: {selection_id: selection-markdown-1}
sources: [{id: source, resource: ../raw/source.md, title: Source}]
anchors: [{source_id: source, kind: markdown, resource: ../raw/source.md, sha256: ${sha256(source)}, quote: selected passage, from: ${from}, to: ${from + quote.length}, start_line: 3, end_line: 3}]
---

# Why does this passage matter?

## Answer

The passage names the invariant preserved by the update.
`);

  const index = new queryIndex.QueryAnnotationIndex(root);
  const annotations = await index.listAnnotationsForSource(sourcePath);
  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].condensedSummary, 'The passage names the invariant preserved by the update.');
  assert.deepEqual(
    queryIndex.resolveMarkdownAnchor(annotations[0].anchor, source).range,
    { from, to: from + quote.length, startLine: 3, endLine: 3 },
  );
  assert.deepEqual(
    await index.loadNavigationTarget({ selectionId: 'selection-markdown-1' }),
    {
      kind: 'query',
      queryPath: 'projects/demo/queries/meaning.md',
      selectionId: 'selection-markdown-1',
    },
  );
});

test('E2E: PDF Query geometry is available only for the exact binary hash', async () => {
  const root = makeVault();
  const pdfPath = 'projects/demo/assets/paper.pdf';
  const pdf = Buffer.from('%PDF-1.7\nquery fixture\n');
  writeFileSync(join(root, pdfPath), pdf);
  writeFileSync(join(root, 'projects/demo/queries/pdf.md'), `---
type: Query
title: What does the figure show?
description: A durable answer tied to an exact PDF region.
condensed_summary: The region shows the measured pipeline boundary.
status: stable
generated: {by: process:test, at: 2026-08-23T00:00:00Z}
project: demo
conversation: {selection_id: selection-pdf-1}
sources: [{id: paper, resource: ../assets/paper.pdf, title: Paper}]
anchors: [{source_id: paper, kind: pdf, resource: ../assets/paper.pdf, sha256: ${sha256(pdf)}, quote: measured boundary, page: 1, rects: [[20, 30, 120, 48]]}]
---

# What does the figure show?
`);

  const index = new queryIndex.QueryAnnotationIndex(root);
  const [annotation] = await index.listAnnotationsForSource(pdfPath);
  assert.ok(annotation);
  assert.deepEqual(
    queryIndex.resolvePdfAnchor(annotation.anchor, pdf).geometry,
    { page: 1, rects: [[20, 30, 120, 48]] },
  );
  assert.equal(
    queryIndex.resolvePdfAnchor(annotation.anchor, Buffer.from('%PDF changed')).geometry,
    undefined,
  );
});
