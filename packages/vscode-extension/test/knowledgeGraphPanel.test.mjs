import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { renderKnowledgeGraphHtml } = loadTsModule('src/knowledgeGraphPanel.ts', {
  vscode: {},
});

test('graph renderer produces a dependency-free SVG and accessible text fallback', () => {
  const html = renderKnowledgeGraphHtml({
    nodes: [
      { id: 'Attention.md', label: 'Attention', path: 'Attention.md', kind: 'note' },
      { id: 'Softmax.md', label: 'Softmax', path: 'Softmax.md', kind: 'note' },
    ],
    edges: [{
      id: 'Attention.md->Softmax.md',
      source: 'Attention.md',
      target: 'Softmax.md',
      count: 2,
      labels: ['normalizes'],
    }],
  }, 'fixed-nonce');

  assert.match(html, /default-src 'none'; style-src 'nonce-fixed-nonce'/);
  assert.match(html, /<svg[^>]+role="img"/);
  assert.match(html, /Attention → Softmax: 2 references/);
  assert.match(html, />×2<\/text>/);
  assert.match(html, /<summary>Accessible graph list<\/summary>/);
  assert.match(html, /Attention → Softmax \(2 references\)/);
  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /mermaid/i);
});

test('graph renderer escapes untrusted note labels, paths, and nonce text', () => {
  const html = renderKnowledgeGraphHtml({
    nodes: [{
      id: 'unsafe',
      label: '<img src=x onerror=alert(1)>',
      path: 'A&B.md',
      kind: 'note',
    }],
    edges: [],
  }, 'nonce"><script>alert(1)</script>');

  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /<script\b/i);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /A&amp;B\.md/);
  assert.match(html, /nonce&quot;&gt;&lt;script&gt;/);
});

test('graph renderer keeps an empty graph understandable', () => {
  const html = renderKnowledgeGraphHtml({ nodes: [], edges: [] }, 'nonce');

  assert.match(html, /No Markdown notes or frontmatter metadata yet/);
  assert.match(html, /<li>No nodes<\/li>/);
  assert.match(html, /<li>No relationships<\/li>/);
});

test('graph renderer distinguishes explicit note, concept, and entity data', () => {
  const html = renderKnowledgeGraphHtml({
    nodes: [
      { id: 'Memory.md', label: 'Memory', path: 'Memory.md', kind: 'note' },
      { id: 'concept:spaced repetition', label: 'Spaced repetition', kind: 'concept' },
      { id: 'entity:hermann ebbinghaus', label: 'Hermann Ebbinghaus', kind: 'entity' },
    ],
    edges: [
      {
        id: 'Memory.md->concept:spaced repetition',
        source: 'Memory.md',
        target: 'concept:spaced repetition',
        count: 1,
        labels: [],
        kind: 'concept',
      },
      {
        id: 'Memory.md->entity:hermann ebbinghaus',
        source: 'Memory.md',
        target: 'entity:hermann ebbinghaus',
        count: 1,
        labels: [],
        kind: 'entity',
      },
    ],
  }, 'nonce');

  assert.match(html, /<h1>Markdown knowledge graph<\/h1>/);
  assert.match(html, /1 notes · 1 concepts · 1 entities · 2 relationships/);
  assert.match(html, /It does not infer missing relationships/);
  assert.match(html, /Concept from frontmatter/);
  assert.match(html, /Entity from frontmatter/);
  assert.match(html, /<ellipse class="node concept"/);
  assert.match(html, /<rect class="node entity"/);
  assert.match(html, /<line class="edge concept"/);
  assert.match(html, /<line class="edge entity"/);
  assert.match(html, /Memory → concept: Spaced repetition/);
  assert.match(html, /Memory → entity: Hermann Ebbinghaus/);
  assert.match(html, /Concept: Spaced repetition/);
  assert.match(html, /Entity: Hermann Ebbinghaus/);
});

function loadTsModule(relativePath, mocks = {}) {
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
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    mod._compile(outputText, filename);
    return mod.exports;
  } finally {
    Module._load = originalLoad;
  }
}
