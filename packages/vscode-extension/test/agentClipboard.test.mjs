import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

const clipboard = loadTsModule('src/agentClipboard.ts', {
  './anchorUris': {
    llmWikiOpenAnchorUri: target => `cursor://llm-wiki/open-anchor?target=${encodeURIComponent(target)}`,
  },
});

const {
  createPdfAgentClipboardContext,
  formatMarkdownAgentReference,
  pdfAgentClipboardSelectionKey,
} = clipboard;

test('formats exact Markdown agent references', () => {
  assert.equal(formatMarkdownAgentReference('notes/a.md', 7, 7), '@notes/a.md#7');
  assert.equal(formatMarkdownAgentReference('notes\\a.md', 7, 9), '@notes/a.md#7-9');
});

test('rejects URI schemes and all Windows drive-prefixed Markdown paths', () => {
  for (const relativePath of [
    'file:///tmp/paper.md',
    'https://example.com/paper.md',
    'C:paper.md',
    'C:/paper.md',
    'C:\\paper.md',
  ]) {
    assert.throws(
      () => formatMarkdownAgentReference(relativePath, 1, 1),
      /workspace-relative/,
      relativePath,
    );
  }
});

test('builds single- and multi-page PDF clipboard context', () => {
  const single = createPdfAgentClipboardContext({
    selectionKey: 'single-key',
    relativePath: 'raw/paper.pdf',
    startPage: 3,
    endPage: 3,
    selectedText: 'Exact passage',
    anchorUri: 'raw/paper.pdf#page=3',
  });
  assert.equal(single.sourceLabel, 'raw/paper.pdf (page 3)');
  assert.equal(single.sourceHref, 'cursor://llm-wiki/open-anchor?target=raw%2Fpaper.pdf%23page%3D3');
  assert.equal(
    single.plainText,
    'Source: [raw/paper.pdf (page 3)](<cursor://llm-wiki/open-anchor?target=raw%2Fpaper.pdf%23page%3D3>)\n\n'
      + 'Selected text:\nExact passage',
  );

  const multiple = createPdfAgentClipboardContext({
    selectionKey: 'multi-key',
    relativePath: 'raw\\paper.pdf',
    startPage: 3,
    endPage: 5,
    selectedText: 'Cross page passage',
    anchorUri: 'raw/paper.pdf#page=3',
  });
  assert.equal(multiple.sourceLabel, 'raw/paper.pdf (pages 3–5)');
  assert.match(multiple.plainText, /^Source: \[raw\/paper\.pdf \(pages 3–5\)\]/);
});

test('escapes PDF workspace filenames only in the plain-text Markdown link label', () => {
  const context = createPdfAgentClipboardContext({
    selectionKey: 'metacharacter-key',
    relativePath: 'raw/[draft]*paper*_v1&2.pdf',
    startPage: 3,
    endPage: 3,
    selectedText: 'Exact passage',
    anchorUri: 'raw/[draft]*paper*_v1&2.pdf#page=3',
  });

  assert.equal(context.sourceLabel, 'raw/[draft]*paper*_v1&2.pdf (page 3)');
  assert.equal(
    context.plainText,
    'Source: [raw/\\[draft\\]\\*paper\\*\\_v1\\&2.pdf (page 3)]'
      + '(<cursor://llm-wiki/open-anchor?target=raw%2F%5Bdraft%5D*paper*_v1%262.pdf%23page%3D3>)\n\n'
      + 'Selected text:\nExact passage',
  );
  assert.equal(
    context.sourceHref,
    'cursor://llm-wiki/open-anchor?target=raw%2F%5Bdraft%5D*paper*_v1%262.pdf%23page%3D3',
  );
});

test('rejects malformed clipboard inputs', () => {
  assert.equal(createPdfAgentClipboardContext({
    selectionKey: '',
    relativePath: '/absolute/paper.pdf',
    startPage: 5,
    endPage: 3,
    selectedText: '',
    anchorUri: 'raw/paper.pdf#page=5',
  }), undefined);
  assert.equal(createPdfAgentClipboardContext({
    selectionKey: 'key',
    relativePath: 'raw/paper.pdf',
    startPage: 1,
    endPage: 1,
    selectedText: '   ',
    anchorUri: 'raw/paper.pdf#page=1',
  }), undefined);
  assert.equal(createPdfAgentClipboardContext({
    selectionKey: 'key',
    relativePath: 'raw/paper.pdf',
    startPage: 1,
    endPage: 1,
    selectedText: 'text',
    anchorUri: '',
  }), undefined);
});

test('rejects absolute, URI, and anchor-bridge PDF targets', () => {
  for (const anchorUri of [
    '/tmp/paper.pdf#page=3',
    'C:/tmp/paper.pdf#page=3',
    'file:///tmp/paper.pdf#page=3',
    'raw/source.llm_wiki_anchor',
  ]) {
    assert.equal(createPdfAgentClipboardContext({
      selectionKey: 'key',
      relativePath: 'raw/paper.pdf',
      startPage: 3,
      endPage: 3,
      selectedText: 'Exact passage',
      anchorUri,
    }), undefined, anchorUri);
  }
});

test('uses a stable normalized JSON key for PDF selection geometry', () => {
  const first = pdfAgentClipboardSelectionKey({
    startPage: 2,
    endPage: 3,
    pages: [
      { page: 3, rects: [[2.123456, 3, 5, 9]] },
      { page: 2, rects: [[0, 1, 10, 11]] },
    ],
    selectedText: 'Selected passage',
  });
  const second = pdfAgentClipboardSelectionKey({
    startPage: 2,
    endPage: 3,
    pages: [
      { page: 2, rects: [[0, 1, 10, 11]] },
      { page: 3, rects: [[2.123499, 3, 5, 9]] },
    ],
    selectedText: 'Selected passage',
  });
  assert.equal(first, second);
  assert.equal(pdfAgentClipboardSelectionKey({
    startPage: 3,
    endPage: 2,
    pages: [],
    selectedText: 'Selected passage',
  }), undefined);
});

test('rejects rectangles that become non-finite or zero-area after normalization', () => {
  for (const rect of [
    [Number.MAX_VALUE / 2, 0, Number.MAX_VALUE, 1],
    [0, 0, 0.0004, 1],
  ]) {
    assert.equal(pdfAgentClipboardSelectionKey({
      startPage: 1,
      endPage: 1,
      pages: [{ page: 1, rects: [rect] }],
      selectedText: 'Selected passage',
    }), undefined, JSON.stringify(rect));
  }
});
