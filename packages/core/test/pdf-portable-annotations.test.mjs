import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import portable from '../dist/pdf-discussions/portable.js';
import storeModule from '../dist/pdf-discussions/store.js';

const {
  LLM_WIKI_CONTEXT,
  PDF_FRAGMENT_CONFORMS_TO,
  scanPortablePdfAnnotations,
  toPortablePdfAnnotation,
} = portable;
const { PdfDiscussionStore } = storeModule;

const PDF_SHA256 = 'a'.repeat(64);
const SNAPSHOT_SHA256 = 'b'.repeat(64);
const CREATED_AT = '2026-08-10T01:02:03.000Z';
const UPDATED_AT = '2026-08-10T04:05:06.000Z';

function annotation(overrides = {}) {
  return {
    id: 'discussion-1',
    kind: 'agent_discussion',
    selectionKey: 'selection-1',
    anchor: {
      uri: 'file:///private/vault/papers/Paper.pdf',
      page: 7,
      quote: 'The  exact\nsource text.',
      prefix: 'Context before.',
      suffix: 'Context after.',
      rects: [
        [10, 20, 110, 36],
        [10, 38, 80, 54],
      ],
      textItemIndex: 4,
      charOffset: 2,
      endTextItemIndex: 5,
      endCharOffset: 9,
      portableUrl: 'papers/Paper.pdf#page=7',
    },
    snapshot: {
      file: 'assets/discussion-1/selection.png',
      sha256: SNAPSHOT_SHA256,
      width: 640,
      height: 240,
      mimeType: 'image/png',
      cropRect: [8, 18, 112, 56],
      padding: 2,
      unit: 'pt',
    },
    messages: [],
    lastTurn: { status: 'idle' },
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function mappingInput(overrides = {}) {
  return {
    annotation: annotation(),
    pdfSha256: PDF_SHA256,
    sourcePath: 'papers/Paper.pdf',
    annotationPath:
      `.llm_wiki/annotations/pdf/${PDF_SHA256}/discussion-1.jsonld`,
    ...overrides,
  };
}

test('maps a PDF discussion to portable W3C Web Annotation JSON-LD', () => {
  const internal = annotation();
  const before = structuredClone(internal);
  const result = toPortablePdfAnnotation(mappingInput({ annotation: internal }));

  assert.deepEqual(result['@context'], [
    'http://www.w3.org/ns/anno.jsonld',
    { llm_wiki: LLM_WIKI_CONTEXT },
  ]);
  assert.equal(result.type, 'Annotation');
  assert.equal(result.motivation, 'commenting');
  assert.equal(result['llm_wiki:discussionId'], 'discussion-1');
  assert.equal(result.id, 'urn:llm_wiki:annotation:discussion-1');
  assert.deepEqual(result.target.source, {
    id: '../../../../papers/Paper.pdf',
    type: 'Document',
    format: 'application/pdf',
    'llm_wiki:sha256': PDF_SHA256,
  });
  assert.deepEqual(result.target.selector, [
    {
      type: 'TextQuoteSelector',
      exact: 'The  exact\nsource text.',
      prefix: 'Context before.',
      suffix: 'Context after.',
    },
    {
      type: 'FragmentSelector',
      conformsTo: PDF_FRAGMENT_CONFORMS_TO,
      value: 'page=7',
    },
    {
      type: 'llm_wiki:PdfRectSelector',
      'llm_wiki:page': 7,
      'llm_wiki:unit': 'pt',
      'llm_wiki:origin': 'top-left',
      'llm_wiki:coordinates': 'left,top,right,bottom',
      'llm_wiki:rects': [
        [10, 20, 110, 36],
        [10, 38, 80, 54],
      ],
    },
    {
      type: 'llm_wiki:PdfTextItemSelector',
      'llm_wiki:start': { 'llm_wiki:textItemIndex': 4, 'llm_wiki:charOffset': 2 },
      'llm_wiki:end': { 'llm_wiki:textItemIndex': 5, 'llm_wiki:charOffset': 9 },
    },
  ]);
  assert.deepEqual(result['llm_wiki:snapshot'], {
    id: '../assets/discussion-1/selection.png',
    type: 'Image',
    format: 'image/png',
    'llm_wiki:sha256': SNAPSHOT_SHA256,
    'llm_wiki:width': 640,
    'llm_wiki:height': 240,
    'llm_wiki:page': 7,
    'llm_wiki:cropRect': [8, 18, 112, 56],
    'llm_wiki:padding': 2,
    'llm_wiki:unit': 'pt',
  });
  assert.equal('body' in result, false);
  assert.deepEqual(internal, before, 'the pure mapper mutated its input');
});

test('normalizes every repository IRI to a relative POSIX path', () => {
  const result = toPortablePdfAnnotation(mappingInput({
    sourcePath: 'papers\\Source Paper.pdf',
    annotationPath:
      `.llm_wiki\\annotations\\pdf\\${PDF_SHA256}\\discussion-1.jsonld`,
    learningNotePath: 'wiki\\learning\\Source explanation.md',
    annotation: annotation({
      snapshot: {
        ...annotation().snapshot,
        file: 'assets\\discussion-1\\selection.png',
      },
    }),
  }));

  assert.equal(result.id, 'urn:llm_wiki:annotation:discussion-1');
  assert.equal(result.target.source.id, '../../../../papers/Source%20Paper.pdf');
  assert.equal(result.body?.id, '../../../../wiki/learning/Source%20explanation.md');
  assert.equal(
    result['llm_wiki:snapshot']?.id,
    '../assets/discussion-1/selection.png',
  );
  assert.doesNotMatch(JSON.stringify(result), /file:\/\/|\\\\/u);

  assert.throws(
    () => toPortablePdfAnnotation(mappingInput({ sourcePath: '../outside.pdf' })),
    /stay inside the repository/u,
  );
  assert.throws(
    () => toPortablePdfAnnotation(mappingInput({ learningNotePath: '/tmp/note.md' })),
    /stay inside the repository/u,
  );
});

test('scans portable annotations and preserves the original exact quote', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'llm-wiki-portable-pdf-scan-'));
  try {
    const input = mappingInput({
      learningNotePath: 'wiki/learning/Explanation.md',
    });
    const document = toPortablePdfAnnotation(input);
    const absolutePath = join(
      workspaceRoot,
      ...input.annotationPath.split('/'),
    );
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify(document, null, 2)}\n`);

    assert.deepEqual(
      await scanPortablePdfAnnotations(workspaceRoot),
      [{
        annotationId: 'discussion-1',
        annotationPath: input.annotationPath,
        pdfSha256: PDF_SHA256,
        sourcePath: 'papers/Paper.pdf',
        page: 7,
        exactText: 'The  exact\nsource text.',
        prefix: 'Context before.',
        suffix: 'Context after.',
        rects: [
          [10, 20, 110, 36],
          [10, 38, 80, 54],
        ],
        learningNotePath: 'wiki/learning/Explanation.md',
        snapshotPath: '.llm_wiki/annotations/pdf/assets/discussion-1/selection.png',
      }],
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('scanner skips malformed documents, wrong hashes, and symbolic links', async t => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'llm-wiki-portable-pdf-invalid-'));
  try {
    const directory = join(
      workspaceRoot,
      '.llm_wiki',
      'annotations',
      'pdf',
      PDF_SHA256,
    );
    mkdirSync(directory, { recursive: true });
    const valid = toPortablePdfAnnotation(mappingInput());
    writeFileSync(join(directory, 'discussion-1.jsonld'), JSON.stringify(valid));
    writeFileSync(join(directory, 'invalid-json.jsonld'), '{');
    writeFileSync(
      join(directory, 'wrong-hash.jsonld'),
      JSON.stringify({
        ...valid,
        target: {
          ...valid.target,
          source: {
            ...valid.target.source,
            'llm_wiki:sha256': 'c'.repeat(64),
          },
        },
      }),
    );
    writeFileSync(
      join(directory, 'missing-quote.jsonld'),
      JSON.stringify({ ...valid, target: { ...valid.target, selector: [] } }),
    );

    const outsideFile = join(workspaceRoot, 'outside.jsonld');
    writeFileSync(outsideFile, JSON.stringify(valid));
    try {
      symlinkSync(outsideFile, join(directory, 'linked.jsonld'));
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) {
        t.diagnostic(`symbolic-link assertion skipped: ${error.code}`);
      } else {
        throw error;
      }
    }

    assert.deepEqual(
      (await scanPortablePdfAnnotations(workspaceRoot))
        .map(record => record.annotationPath),
      [`.llm_wiki/annotations/pdf/${PDF_SHA256}/discussion-1.jsonld`],
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('scanner rejects malformed JSON-LD claims', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'llm-wiki-portable-pdf-claims-'));
  try {
    const directory = join(
      workspaceRoot,
      '.llm_wiki',
      'annotations',
      'pdf',
      PDF_SHA256,
    );
    mkdirSync(directory, { recursive: true });
    const baseline = toPortablePdfAnnotation(mappingInput({
      learningNotePath: 'wiki/learning/Explanation.md',
    }));
    const selector = (record, type) =>
      record.target.selector.find(candidate => candidate.type === type);
    const invalid = [
      ['context', record => {
        record['@context'] = ['http://www.w3.org/ns/anno.jsonld', { llm_wiki: 'urn:other:' }];
      }],
      ['annotation-id', record => {
        record.id = 'urn:llm_wiki:annotation:someone-else';
      }],
      ['source-format', record => {
        record.target.source.format = 'text/plain';
      }],
      ['body-format', record => {
        record.body.format = 'text/plain';
      }],
      ['snapshot-format', record => {
        record['llm_wiki:snapshot'].format = 'image/jpeg';
      }],
      ['page', record => {
        selector(record, 'FragmentSelector').value = 'page=0';
      }],
      ['page-mismatch', record => {
        selector(record, 'llm_wiki:PdfRectSelector')['llm_wiki:page'] = 8;
      }],
      ['snapshot-page-mismatch', record => {
        record['llm_wiki:snapshot']['llm_wiki:page'] = 8;
      }],
      ['unit', record => {
        selector(record, 'llm_wiki:PdfRectSelector')['llm_wiki:unit'] = 'px';
      }],
      ['origin', record => {
        selector(record, 'llm_wiki:PdfRectSelector')['llm_wiki:origin'] = 'bottom-left';
      }],
      ['coordinates', record => {
        selector(record, 'llm_wiki:PdfRectSelector')['llm_wiki:coordinates'] = 'x,y,width,height';
      }],
      ['source-path', record => {
        record.target.source.id = '../../../../../outside.pdf';
      }],
      ['body-path', record => {
        record.body.id = 'file:///tmp/Explanation.md';
      }],
      ['snapshot-path', record => {
        record['llm_wiki:snapshot'].id = '../../../../../outside.png';
      }],
      ['unqualified-text-items', record => {
        const text = selector(record, 'llm_wiki:PdfTextItemSelector');
        text['llm_wiki:start'] = { textItemIndex: 4, charOffset: 2 };
        text['llm_wiki:end'] = { textItemIndex: 5, charOffset: 9 };
      }],
    ];

    writeFileSync(join(directory, 'discussion-1.jsonld'), JSON.stringify(baseline));
    for (const [name, mutate] of invalid) {
      const record = structuredClone(baseline);
      mutate(record);
      writeFileSync(join(directory, `${name}.jsonld`), JSON.stringify(record));
    }

    assert.deepEqual(
      (await scanPortablePdfAnnotations(workspaceRoot))
        .map(record => record.annotationPath),
      [`.llm_wiki/annotations/pdf/${PDF_SHA256}/discussion-1.jsonld`],
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('scanner rejects symlinked metadata ancestors', async t => {
  const parts = ['.llm_wiki', 'annotations', 'pdf'];
  for (let linkIndex = 0; linkIndex < parts.length; linkIndex += 1) {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'llm-wiki-portable-pdf-link-root-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'llm-wiki-portable-pdf-link-target-'));
    try {
      const linkPath = join(workspaceRoot, ...parts.slice(0, linkIndex + 1));
      const targetDirectory = join(
        outsideRoot,
        ...parts.slice(linkIndex + 1),
        PDF_SHA256,
      );
      mkdirSync(dirname(linkPath), { recursive: true });
      mkdirSync(targetDirectory, { recursive: true });
      writeFileSync(
        join(targetDirectory, 'linked.jsonld'),
        JSON.stringify(toPortablePdfAnnotation(mappingInput())),
      );
      try {
        symlinkSync(outsideRoot, linkPath, 'dir');
      } catch (error) {
        if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) {
          t.diagnostic(`symbolic-link assertion skipped: ${error.code}`);
          continue;
        }
        throw error;
      }
      assert.deepEqual(
        await scanPortablePdfAnnotations(workspaceRoot),
        [],
        `accepted symlinked ancestor ${parts.slice(0, linkIndex + 1).join('/')}`,
      );
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  }
});

test('portable mirror writes never follow a symlinked metadata ancestor', t => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'llm-wiki-portable-pdf-write-root-'));
  const outsideRoot = mkdtempSync(join(tmpdir(), 'llm-wiki-portable-pdf-write-target-'));
  try {
    const pdfPath = join(workspaceRoot, 'papers', 'Paper.pdf');
    mkdirSync(dirname(pdfPath), { recursive: true });
    writeFileSync(pdfPath, '%PDF-1.7\nportable-write\n');
    try {
      symlinkSync(outsideRoot, join(workspaceRoot, '.llm_wiki'), 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) {
        t.diagnostic(`symbolic-link assertion skipped: ${error.code}`);
        return;
      }
      throw error;
    }
    const store = new PdfDiscussionStore({
      layout: 'vault',
      rootPath: workspaceRoot,
      pdfPath,
    });
    assert.throws(
      () => store.writePortableAnnotation(annotation({ snapshot: undefined })),
      /symbolic link/u,
    );
    assert.equal(existsSync(join(outsideRoot, 'annotations')), false);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('canonical sidecar updates survive a failed portable mirror and backfill later', t => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'llm-wiki-portable-pdf-best-effort-root-'));
  const outsideRoot = mkdtempSync(join(tmpdir(), 'llm-wiki-portable-pdf-best-effort-target-'));
  try {
    const pdfPath = join(workspaceRoot, 'papers', 'Paper.pdf');
    mkdirSync(dirname(pdfPath), { recursive: true });
    writeFileSync(pdfPath, '%PDF-1.7\nportable-best-effort\n');
    const store = new PdfDiscussionStore({
      layout: 'vault',
      rootPath: workspaceRoot,
      pdfPath,
      portableSourceUrl: 'papers/Paper.pdf',
    });
    const mirrorRoot = store.portableAnnotationsPath;
    assert.equal(typeof mirrorRoot, 'string');
    mkdirSync(dirname(mirrorRoot), { recursive: true });
    try {
      symlinkSync(outsideRoot, mirrorRoot, 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) {
        t.diagnostic(`symbolic-link assertion skipped: ${error.code}`);
        return;
      }
      throw error;
    }

    const saved = annotation({
      snapshot: undefined,
      lastTurn: {
        status: 'running',
        questionMessageId: 'question-1',
        ownerId: 'controller-owner-1',
        ownerPid: process.pid,
        startedAt: CREATED_AT,
      },
      anchor: {
        ...annotation().anchor,
        uri: pdfPath,
        portableUrl: 'papers/Paper.pdf#page=7',
      },
    });
    const document = store.update(current => ({
      ...current,
      annotations: [saved],
    }));

    assert.deepEqual(
      JSON.parse(readFileSync(store.sidecarPath, 'utf8')),
      JSON.parse(JSON.stringify(document)),
    );
    assert.equal(document.annotations[0].lastTurn.status, 'running');
    assert.equal(existsSync(join(outsideRoot, 'discussion-1.jsonld')), false);
    assert.doesNotThrow(() => store.save(document));

    unlinkSync(mirrorRoot);
    assert.equal(store.load().annotations.length, 1);
    const mirrorPath = join(mirrorRoot, 'discussion-1.jsonld');
    assert.equal(existsSync(mirrorPath), true);
    assert.equal(
      JSON.parse(readFileSync(mirrorPath, 'utf8'))
        .target.selector.find(candidate => candidate.type === 'TextQuoteSelector').exact,
      saved.anchor.quote,
    );
    assert.equal(existsSync(join(outsideRoot, 'discussion-1.jsonld')), false);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('vault persistence creates the portable mirror and later links its Markdown note', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'llm-wiki-portable-pdf-store-'));
  try {
    const pdfPath = join(workspaceRoot, 'papers', 'Paper.pdf');
    mkdirSync(dirname(pdfPath), { recursive: true });
    writeFileSync(pdfPath, '%PDF-1.7\nportable-mirror\n');
    const store = new PdfDiscussionStore({
      layout: 'vault',
      rootPath: workspaceRoot,
      pdfPath,
      portableSourceUrl: 'papers/Paper.pdf',
    });
    const saved = annotation({
      snapshot: undefined,
      anchor: {
        ...annotation().anchor,
        uri: pdfPath,
        portableUrl: 'papers/Paper.pdf#page=7',
      },
    });
    store.save({ ...store.load(), source: { uri: pdfPath, sha256: store.pdfSha256 }, annotations: [saved] });

    const mirrorPath = join(
      workspaceRoot,
      '.llm_wiki',
      'annotations',
      'pdf',
      store.pdfSha256,
      'discussion-1.jsonld',
    );
    assert.equal(existsSync(mirrorPath), true);
    assert.equal(JSON.parse(readFileSync(mirrorPath, 'utf8')).body, undefined);

    store.writePortableAnnotation(saved, 'wiki/learning/Explanation.md');
    const [scanned] = await scanPortablePdfAnnotations(workspaceRoot);
    assert.equal(scanned.exactText, saved.anchor.quote);
    assert.equal(scanned.learningNotePath, 'wiki/learning/Explanation.md');
    assert.deepEqual(scanned.rects, saved.anchor.rects);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('loading a legacy vault sidecar backfills missing portable mirrors', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'llm-wiki-portable-pdf-backfill-'));
  try {
    const pdfPath = join(workspaceRoot, 'papers', 'Paper.pdf');
    mkdirSync(dirname(pdfPath), { recursive: true });
    writeFileSync(pdfPath, '%PDF-1.7\nlegacy-sidecar\n');
    const store = new PdfDiscussionStore({
      layout: 'vault',
      rootPath: workspaceRoot,
      pdfPath,
      portableSourceUrl: 'papers/Paper.pdf',
    });
    const saved = annotation({
      snapshot: undefined,
      anchor: {
        ...annotation().anchor,
        uri: pdfPath,
        portableUrl: 'papers/Paper.pdf#page=7',
      },
    });
    const sidecar = `${JSON.stringify({
      version: 1,
      source: { uri: pdfPath, sha256: store.pdfSha256 },
      annotations: [saved],
    }, null, 2)}\n`;
    mkdirSync(dirname(store.sidecarPath), { recursive: true });
    writeFileSync(store.sidecarPath, sidecar);
    const mirrorPath = join(
      workspaceRoot,
      '.llm_wiki',
      'annotations',
      'pdf',
      store.pdfSha256,
      'discussion-1.jsonld',
    );

    assert.equal(existsSync(mirrorPath), false);
    assert.equal(store.load().annotations.length, 1);
    assert.equal(existsSync(mirrorPath), true);
    assert.equal(readFileSync(store.sidecarPath, 'utf8'), sidecar);
    assert.equal(
      JSON.parse(readFileSync(mirrorPath, 'utf8'))
        .target.selector.find(candidate => candidate.type === 'TextQuoteSelector').exact,
      saved.anchor.quote,
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
