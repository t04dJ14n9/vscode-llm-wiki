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

test('builds portable single- and multi-page PDF text context', () => {
  const sourceSha256 = 'a'.repeat(64);
  const single = createPdfAgentClipboardContext({
    selectionKey: 'single-key',
    relativePath: 'raw/paper.pdf',
    sourceSha256,
    selection: {
      kind: 'text',
      startPage: 3,
      endPage: 3,
      pages: [{ page: 3, rects: [[90, 45, 522, 185]] }],
      selectedText: 'Exact passage',
    },
  });
  assert.ok(single);
  assert.equal(single.sourceLabel, 'raw/paper.pdf (page 3)');
  assert.equal(single.sourceHref, 'raw/paper.pdf#page=3&viewrect=90%2C45%2C432%2C140');
  assert.equal(
    single.plainText,
    'Source: [raw/paper.pdf (page 3)](<raw/paper.pdf#page=3&viewrect=90%2C45%2C432%2C140>)\n'
      + `PDF source SHA-256: \`${sourceSha256}\`\n\n`
      + 'Selected text:\nExact passage',
  );

  const multiple = createPdfAgentClipboardContext({
    selectionKey: 'multi-key',
    relativePath: 'raw\\paper.pdf',
    sourceSha256,
    selection: {
      kind: 'text',
      startPage: 3,
      endPage: 5,
      pages: [
        { page: 3, rects: [[10, 20, 110, 36]] },
        { page: 4, rects: [[12, 18, 140, 54]] },
        { page: 5, rects: [[8, 16, 96, 32]] },
      ],
      selectedText: 'Cross page passage',
    },
  });
  assert.ok(multiple);
  assert.equal(multiple.sourceLabel, 'raw/paper.pdf (pages 3–5)');
  assert.equal(multiple.plainText, [
    'Sources:',
    '- [raw/paper.pdf (page 3)](<raw/paper.pdf#page=3&viewrect=10%2C20%2C100%2C16>)',
    '- [raw/paper.pdf (page 4)](<raw/paper.pdf#page=4&viewrect=12%2C18%2C128%2C36>)',
    '- [raw/paper.pdf (page 5)](<raw/paper.pdf#page=5&viewrect=8%2C16%2C88%2C16>)',
    `PDF source SHA-256: \`${sourceSha256}\``,
    '',
    'Selected text:',
    'Cross page passage',
  ].join('\n'));
});

test('builds portable area context without inventing selected text', () => {
  const sourceSha256 = 'b'.repeat(64);
  const context = createPdfAgentClipboardContext({
    selectionKey: 'area-key',
    relativePath: 'raw/paper.pdf',
    sourceSha256,
    selection: {
      kind: 'area',
      startPage: 2,
      endPage: 2,
      pages: [{ page: 2, rects: [[90, 45, 522, 185]] }],
    },
  });
  assert.ok(context);
  assert.equal(context.selectedText, undefined);
  assert.equal(context.plainText, [
    'Source: [raw/paper.pdf (page 2 region)](<raw/paper.pdf#page=2&viewrect=90%2C45%2C432%2C140>)',
    `PDF source SHA-256: \`${sourceSha256}\``,
    '',
    'Selected PDF region. Use the vault PDF skill to extract its text and inspect its visual content.',
  ].join('\n'));
});

test('builds portable multi-page PDF area context with ordered source links', () => {
  const sourceSha256 = 'd'.repeat(64);
  const context = createPdfAgentClipboardContext({
    selectionKey: 'multi-area-key',
    relativePath: 'raw/paper.pdf',
    sourceSha256,
    selection: {
      kind: 'area',
      startPage: 2,
      endPage: 3,
      pages: [
        { page: 3, rects: [[90, 0, 522, 120]] },
        { page: 2, rects: [[90, 700, 522, 792]] },
      ],
    },
  });

  assert.ok(context);
  assert.equal(context.selectedText, undefined);
  assert.equal(context.plainText, [
    'Sources:',
    '- [raw/paper.pdf (page 2 region)](<raw/paper.pdf#page=2&viewrect=90%2C700%2C432%2C92>)',
    '- [raw/paper.pdf (page 3 region)](<raw/paper.pdf#page=3&viewrect=90%2C0%2C432%2C120>)',
    `PDF source SHA-256: \`${sourceSha256}\``,
    '',
    'Selected PDF region. Use the vault PDF skill to extract its text and inspect its visual content.',
  ].join('\n'));
});

test('escapes PDF workspace filenames only in the plain-text Markdown link label', () => {
  const sourceSha256 = 'c'.repeat(64);
  const context = createPdfAgentClipboardContext({
    selectionKey: 'metacharacter-key',
    relativePath: 'raw/[draft]*paper*_v1&2.pdf',
    sourceSha256,
    selection: {
      kind: 'text',
      startPage: 3,
      endPage: 3,
      pages: [{ page: 3, rects: [[10, 20, 110, 36]] }],
      selectedText: 'Exact passage',
    },
  });
  assert.ok(context);

  assert.equal(context.sourceLabel, 'raw/[draft]*paper*_v1&2.pdf (page 3)');
  assert.equal(
    context.plainText,
    'Source: [raw/\\[draft\\]\\*paper\\*\\_v1\\&2.pdf (page 3)]'
      + '(<raw/[draft]*paper*_v1&2.pdf#page=3&viewrect=10%2C20%2C100%2C16>)\n'
      + `PDF source SHA-256: \`${sourceSha256}\`\n\n`
      + 'Selected text:\nExact passage',
  );
  assert.equal(
    context.sourceHref,
    'raw/[draft]*paper*_v1&2.pdf#page=3&viewrect=10%2C20%2C100%2C16',
  );
});

test('rejects malformed clipboard inputs', () => {
  assert.equal(createPdfAgentClipboardContext({
    selectionKey: '',
    relativePath: '/absolute/paper.pdf',
    sourceSha256: 'x',
    selection: {},
  }), undefined);
  assert.equal(createPdfAgentClipboardContext({
    selectionKey: 'key',
    relativePath: 'raw/paper.pdf',
    sourceSha256: 'a'.repeat(64),
    selection: {
      kind: 'text',
      startPage: 1,
      endPage: 1,
      pages: [{ page: 1, rects: [[0, 0, 10, 10]] }],
      selectedText: '   ',
    },
  }), undefined);
  for (const selection of [
    {
      kind: 'area',
      startPage: 1,
      endPage: 2,
      pages: [
        { page: 1, rects: [[0, 0, 10, 10]] },
        { page: 1, rects: [[0, 0, 10, 10]] },
        { page: 2, rects: [[0, 0, 10, 10]] },
      ],
    },
    {
      kind: 'area',
      startPage: 1,
      endPage: 3,
      pages: [
        { page: 1, rects: [[0, 0, 10, 10]] },
        { page: 2, rects: [[0, 0, 10, 10]] },
      ],
    },
    {
      kind: 'area',
      startPage: 1,
      endPage: 2,
      pages: [
        { page: 1, rects: [[0, 0, 10, 10]] },
        { page: 2, rects: [[0, 0, 10, 10]] },
      ],
      selectedText: 'not allowed',
    },
    {
      kind: 'area',
      startPage: 1,
      endPage: 2,
      pages: [
        { page: 1, rects: [[0, 0, 10, 10]] },
        { page: 2, rects: [[0, 0, 0, 10]] },
      ],
    },
  ]) {
    assert.equal(createPdfAgentClipboardContext({
      selectionKey: 'key',
      relativePath: 'raw/paper.pdf',
      sourceSha256: 'a'.repeat(64),
      selection,
    }), undefined);
  }
});

test('rejects absolute and URI PDF source paths', () => {
  for (const relativePath of [
    '/tmp/paper.pdf#page=3',
    'C:/tmp/paper.pdf#page=3',
    'file:///tmp/paper.pdf#page=3',
  ]) {
    assert.equal(createPdfAgentClipboardContext({
      selectionKey: 'key',
      relativePath,
      sourceSha256: 'a'.repeat(64),
      selection: {
        kind: 'text',
        startPage: 3,
        endPage: 3,
        pages: [{ page: 3, rects: [[0, 0, 10, 10]] }],
        selectedText: 'Exact passage',
      },
    }), undefined, relativePath);
  }
});

test('uses a stable normalized JSON key for PDF selection geometry', () => {
  const first = pdfAgentClipboardSelectionKey({
    kind: 'text',
    startPage: 2,
    endPage: 3,
    pages: [
      { page: 3, rects: [[2.123456, 3, 5, 9]] },
      { page: 2, rects: [[0, 1, 10, 11]] },
    ],
    selectedText: 'Selected passage',
  });
  const second = pdfAgentClipboardSelectionKey({
    kind: 'text',
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
    kind: 'text',
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
      kind: 'text',
      startPage: 1,
      endPage: 1,
      pages: [{ page: 1, rects: [rect] }],
      selectedText: 'Selected passage',
    }), undefined, JSON.stringify(rect));
  }
});
