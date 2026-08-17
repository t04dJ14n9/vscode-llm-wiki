import test from 'node:test';
import assert from 'node:assert/strict';

import core from '../dist/index.js';

const { classifyReferenceTarget, pdfHref } = core;

test('serializes portable PDF destinations with page and text fragments', () => {
  assert.equal(
    pdfHref('raw/pdf/paper.pdf', {
      page: 7,
      textFragment: { textStart: 'selected text' },
    }),
    'raw/pdf/paper.pdf#page=7:~:text=selected%20text',
  );

  assert.equal(
    pdfHref('raw/pdf/paper.pdf', {
      page: 7,
      textFragment: {
        prefix: 'prefix-, & context',
        textStart: 'selected-, & text',
        textEnd: 'through-, & end',
        suffix: 'suffix-, & context',
      },
    }),
    'raw/pdf/paper.pdf#page=7:~:text=prefix%2D%2C%20%26%20context-,selected%2D%2C%20%26%20text,through%2D%2C%20%26%20end,-suffix%2D%2C%20%26%20context',
  );

  assert.equal(
    pdfHref('/Users/reader/Outside Workspace/paper.pdf', {
      page: 7,
      textFragment: { textStart: 'standalone selection' },
    }),
    '/Users/reader/Outside Workspace/paper.pdf#page=7:~:text=standalone%20selection',
  );
});

test('serializes and parses RFC 8118 PDF view rectangles', () => {
  const uri = pdfHref('raw/assets/paper.pdf', {
    page: 2,
    viewRect: { left: 90, top: 45, width: 432, height: 140 },
  });
  assert.equal(
    uri,
    'raw/assets/paper.pdf#page=2&viewrect=90%2C45%2C432%2C140',
  );
  assert.deepEqual(classifyReferenceTarget(uri), {
    kind: 'pdf',
    uri,
    path: 'raw/assets/paper.pdf',
    page: 2,
    viewRect: { left: 90, top: 45, width: 432, height: 140 },
  });
});

test('rejects invalid PDF view rectangles instead of emitting empty regions', () => {
  assert.throws(
    () => pdfHref('raw/assets/paper.pdf', {
      page: 2,
      viewRect: { left: 90, top: 45, width: 0, height: 140 },
    }),
    /view rectangle/i,
  );
});

test('parses page-scoped Chrome range selectors and reserved characters', () => {
  const uri = 'raw/pdf/paper.pdf#page=7:~:text=prefix%2D%2C%20%26%20context-,selected%2D%2C%20%26%20text,through%2D%2C%20%26%20end,-suffix%2D%2C%20%26%20context';
  assert.deepEqual(classifyReferenceTarget(uri), {
    kind: 'pdf',
    uri,
    path: 'raw/pdf/paper.pdf',
    page: 7,
    textFragment: {
      prefix: 'prefix-, & context',
      textStart: 'selected-, & text',
      textEnd: 'through-, & end',
      suffix: 'suffix-, & context',
    },
  });
});

test('uses the first valid text directive and ignores malformed selectors', () => {
  const firstValid = 'raw/pdf/paper.pdf#page=9:~:text=bad-term&unknown=value&text=left-,first,last,-right&text=ignored';
  assert.deepEqual(classifyReferenceTarget(firstValid), {
    kind: 'pdf',
    uri: firstValid,
    path: 'raw/pdf/paper.pdf',
    page: 9,
    textFragment: {
      prefix: 'left',
      textStart: 'first',
      textEnd: 'last',
      suffix: 'right',
    },
  });

  for (const directive of [
    'text=',
    'text=one,two,three,four,five',
    'text=%E0%A4%A',
    'text=unencoded-hyphen',
    'text=-,start',
    'text=start,-',
  ]) {
    const uri = `raw/pdf/paper.pdf#page=4:~:${directive}`;
    assert.deepEqual(classifyReferenceTarget(uri), {
      kind: 'pdf',
      uri,
      path: 'raw/pdf/paper.pdf',
      page: 4,
    });
  }
});

test('classifies native note, code, PDF, and web reference targets', () => {
  assert.deepEqual(classifyReferenceTarget('raw/code/attention.cu#L42-L57'), {
    kind: 'code',
    uri: 'raw/code/attention.cu#L42-L57',
    path: 'raw/code/attention.cu',
    lines: { start: 42, end: 57 },
  });
  assert.deepEqual(classifyReferenceTarget('notes/Concepts/Attention.md#L4-L5'), {
    kind: 'note',
    uri: 'notes/Concepts/Attention.md#L4-L5',
    path: 'notes/Concepts/Attention.md',
    lines: { start: 4, end: 5 },
  });

  const selectionUri = 'raw/pdf/flash-attention.pdf#page=7:~:text=before-,selected%20text,-after';
  assert.deepEqual(classifyReferenceTarget(selectionUri), {
    kind: 'pdf',
    uri: selectionUri,
    path: 'raw/pdf/flash-attention.pdf',
    page: 7,
    textFragment: {
      prefix: 'before',
      textStart: 'selected text',
      suffix: 'after',
    },
  });
  assert.deepEqual(classifyReferenceTarget('https://example.com/article#llm-wiki-web=web_abc123'), {
    kind: 'web',
    uri: 'https://example.com/article#llm-wiki-web=web_abc123',
    url: 'https://example.com/article#llm-wiki-web=web_abc123',
    webTargetId: 'web_abc123',
  });
});

test('parses angle-wrapped absolute and relative PDF destinations', () => {
  const relative = 'raw/pdf/Round Trip Live.pdf#page=1:~:text=before-,Round%20trip%20anchor%20text,-after';
  assert.deepEqual(classifyReferenceTarget(`<${relative}>`), {
    kind: 'pdf',
    uri: relative,
    path: 'raw/pdf/Round Trip Live.pdf',
    page: 1,
    textFragment: {
      prefix: 'before',
      textStart: 'Round trip anchor text',
      suffix: 'after',
    },
  });

  const absolute = '/Users/reader/Outside Workspace/paper.pdf#page=7:~:text=standalone%20selection';
  assert.deepEqual(classifyReferenceTarget(`<${absolute}>`), {
    kind: 'pdf',
    uri: absolute,
    path: '/Users/reader/Outside Workspace/paper.pdf',
    page: 7,
    textFragment: { textStart: 'standalone selection' },
  });
});
