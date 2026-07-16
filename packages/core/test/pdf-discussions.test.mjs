import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

import core from '../dist/index.js';

const {
  computePdfSha256,
  createPdfDiscussionSelectionKey,
  importGlobalPdfDiscussions,
  InvalidPdfDiscussionSidecarError,
  PdfDiscussionAnnotationV1Schema,
  PdfDiscussionDocumentV1Schema,
  PdfDiscussionStore,
} = core;

const NOW = '2026-07-15T00:00:00.000Z';

function makeAnnotation(overrides = {}) {
  return {
    id: 'annotation-1',
    kind: 'agent_discussion',
    selectionKey: 'selection-key-1',
    anchorId: 'anchor-1',
    anchor: {
      uri: 'file:///vault/paper.pdf',
      page: 3,
      quote: 'Canonical selected text',
      prefix: 'before',
      suffix: 'after',
      rects: [[10, 20, 30, 40]],
      textItemIndex: 4,
      charOffset: 2,
      endTextItemIndex: 5,
      endCharOffset: 7,
      portableUrl: 'file:///vault/paper.pdf#page=3:~:text=Canonical%20selected%20text',
    },
    snapshot: {
      file: 'assets/annotation-1/selection.png',
      sha256: '1'.repeat(64),
      width: 320,
      height: 180,
      mimeType: 'image/png',
    },
    messages: [
      {
        id: 'message-1',
        role: 'user',
        markdown: 'Explain this selection.',
        createdAt: NOW,
        codexTurnId: 'turn-1',
      },
    ],
    summaryMarkdown: 'A short explanation.',
    lastTurn: {
      status: 'idle',
      questionMessageId: 'message-1',
    },
    promotion: {
      threadId: 'thread-1',
      promotedAt: NOW,
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function symlinkOrSkip(t, target, path, type) {
  try {
    symlinkSync(target, path, type);
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) {
      t.skip(`Symbolic links are unavailable on this platform: ${error.code}`);
      return false;
    }
    throw error;
  }
}

test('validates the approved version-1 PDF discussion document shape', () => {
  assert.equal(typeof PdfDiscussionAnnotationV1Schema?.parse, 'function');
  assert.equal(typeof PdfDiscussionDocumentV1Schema?.parse, 'function');

  const annotation = makeAnnotation();
  const document = {
    version: 1,
    source: {
      uri: 'file:///vault/paper.pdf',
      sha256: 'a'.repeat(64),
    },
    annotations: [annotation],
  };

  assert.deepEqual(PdfDiscussionAnnotationV1Schema.parse(annotation), annotation);
  assert.deepEqual(PdfDiscussionDocumentV1Schema.parse(document), document);
  assert.throws(
    () => PdfDiscussionDocumentV1Schema.parse({ ...document, version: 2 }),
    /Invalid literal value|Invalid input/,
  );
});

test('round-trips internal lifecycle ownership and promotion-attempt state', () => {
  const annotation = makeAnnotation({
    promotion: undefined,
    lastTurn: {
      status: 'running',
      questionMessageId: 'message-1',
      ownerId: 'controller-owner-1',
      ownerPid: process.pid,
      startedAt: NOW,
    },
    promotionAttempt: {
      id: 'promotion-attempt-1',
      status: 'seeding',
      ownerId: 'controller-owner-1',
      ownerPid: process.pid,
      startedAt: NOW,
      threadId: 'thread-pending-1',
    },
  });

  assert.deepEqual(PdfDiscussionAnnotationV1Schema.parse(annotation), annotation);
});

test('computes the full PDF hash and routes missing documents for both layouts', () => {
  const root = mkdtempSync(join(tmpdir(), 'hl-pdf-discussions-'));
  const vaultRoot = join(root, 'vault');
  const storageRoot = join(root, 'global');
  const pdfPath = join(root, 'paper.pdf');
  const pdfBytes = Buffer.from('%PDF-1.7\nfull-byte-hash\n', 'utf8');
  mkdirSync(vaultRoot, { recursive: true });
  writeFileSync(pdfPath, pdfBytes);

  const expectedHash = createHash('sha256').update(pdfBytes).digest('hex');
  assert.equal(computePdfSha256(pdfBytes), expectedHash);
  assert.equal(computePdfSha256(pathToFileURL(pdfPath)), expectedHash);

  const vaultStore = new PdfDiscussionStore({
    layout: 'vault',
    rootPath: vaultRoot,
    pdfPath: pathToFileURL(pdfPath),
    sourceUri: 'raw/pdf/paper.pdf',
  });
  assert.equal(
    vaultStore.sidecarPath,
    join(vaultRoot, '.hl', 'annotations', 'pdf', `${expectedHash}.json`),
  );
  assert.equal(
    vaultStore.assetsPath,
    join(vaultRoot, '.hl', 'annotations', 'pdf', 'assets'),
  );
  assert.deepEqual(vaultStore.load(), {
    version: 1,
    source: { uri: 'raw/pdf/paper.pdf', sha256: expectedHash },
    annotations: [],
  });

  const globalStore = new PdfDiscussionStore({
    layout: 'global',
    rootPath: storageRoot,
    pdfPath,
  });
  assert.equal(
    globalStore.sidecarPath,
    join(storageRoot, 'pdf-annotations', expectedHash, 'annotations.json'),
  );
  assert.equal(
    globalStore.assetsPath,
    join(storageRoot, 'pdf-annotations', expectedHash, 'assets'),
  );
  assert.deepEqual(globalStore.load(), {
    version: 1,
    source: { uri: pdfPath, sha256: expectedHash },
    annotations: [],
  });
});

test('does not reuse a cached PDF hash after a same-size, same-mtime path replacement', () => {
  const root = mkdtempSync(join(tmpdir(), 'hl-pdf-discussions-hash-cache-'));
  const pdfPath = join(root, 'paper.pdf');
  const pdfUri = pathToFileURL(pdfPath);
  const firstBytes = Buffer.from('%PDF-1.7\ncache-one\n', 'utf8');
  const secondBytes = Buffer.from('%PDF-1.7\ncache-two\n', 'utf8');
  const fixedTime = new Date('2026-01-02T03:04:05.000Z');
  const changedTime = new Date('2026-01-02T03:04:06.000Z');
  assert.equal(firstBytes.byteLength, secondBytes.byteLength);

  writeFileSync(pdfPath, firstBytes);
  utimesSync(pdfPath, fixedTime, fixedTime);
  const firstHash = computePdfSha256(pdfUri);

  const replacementPath = join(root, 'replacement.pdf');
  writeFileSync(replacementPath, secondBytes);
  utimesSync(replacementPath, fixedTime, fixedTime);
  renameSync(replacementPath, pdfPath);
  const replacementStat = statSync(pdfPath);
  assert.equal(replacementStat.size, firstBytes.byteLength);
  assert.equal(replacementStat.mtimeMs, fixedTime.getTime());
  assert.notEqual(computePdfSha256(pdfUri), firstHash);
  assert.equal(
    computePdfSha256(pdfUri),
    createHash('sha256').update(secondBytes).digest('hex'),
  );

  utimesSync(pdfPath, changedTime, changedTime);
  assert.equal(
    computePdfSha256(pdfUri),
    createHash('sha256').update(secondBytes).digest('hex'),
  );

  const longerBytes = Buffer.concat([secondBytes, Buffer.from('x')]);
  writeFileSync(pdfPath, longerBytes);
  utimesSync(pdfPath, changedTime, changedTime);
  assert.equal(
    computePdfSha256(pdfUri),
    createHash('sha256').update(longerBytes).digest('hex'),
  );
});

test('builds selection keys from page and complete canonical text offsets', () => {
  const offsets = {
    page: 3,
    quote: 'First rendering',
    rects: [[10, 20, 30, 40]],
    textItemIndex: 4,
    charOffset: 2,
    endTextItemIndex: 5,
    endCharOffset: 7,
  };
  const first = createPdfDiscussionSelectionKey(offsets);
  const rerendered = createPdfDiscussionSelectionKey({
    ...offsets,
    quote: 'A different rendering does not matter when offsets are complete',
    rects: [[110, 120, 130, 140]],
  });

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(rerendered, first);
  assert.notEqual(
    createPdfDiscussionSelectionKey({ ...offsets, page: 4 }),
    first,
  );
  assert.notEqual(
    createPdfDiscussionSelectionKey({ ...offsets, endCharOffset: 8 }),
    first,
  );
});

test('falls back to quote and PDF rectangles rounded to 0.01 points', () => {
  const first = createPdfDiscussionSelectionKey({
    page: 8,
    quote: 'Fallback selection',
    rects: [
      [50.004, 60.004, 70.004, 80.004],
      [10.004, 20.004, 30.004, 40.004],
    ],
    textItemIndex: 2,
    charOffset: 4,
  });
  const sameRoundedGeometry = createPdfDiscussionSelectionKey({
    page: 8,
    quote: 'Fallback selection',
    rects: [
      [10.003, 20.003, 30.003, 40.003],
      [50.003, 60.003, 70.003, 80.003],
    ],
  });

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(sameRoundedGeometry, first);
  assert.notEqual(
    createPdfDiscussionSelectionKey({
      page: 8,
      quote: 'Fallback selection',
      rects: [[10.006, 20.003, 30.003, 40.003], [50.003, 60.003, 70.003, 80.003]],
    }),
    first,
  );
  assert.notEqual(
    createPdfDiscussionSelectionKey({
      page: 8,
      quote: 'Different quote',
      rects: [[10.003, 20.003, 30.003, 40.003], [50.003, 60.003, 70.003, 80.003]],
    }),
    first,
  );
});

test('atomically saves and reloads a PDF discussion document', () => {
  const root = mkdtempSync(join(tmpdir(), 'hl-pdf-discussions-save-'));
  const pdfPath = join(root, 'paper.pdf');
  writeFileSync(pdfPath, Buffer.from('%PDF-1.7\natomic-save\n', 'utf8'));
  const options = {
    layout: 'global',
    rootPath: join(root, 'storage'),
    pdfPath,
  };
  const store = new PdfDiscussionStore(options);
  const document = {
    ...store.load(),
    annotations: [makeAnnotation()],
  };

  assert.deepEqual(store.save(document), document);
  assert.deepEqual(JSON.parse(readFileSync(store.sidecarPath, 'utf8')), document);
  assert.equal(
    readdirSync(dirname(store.sidecarPath)).some(name => name.endsWith('.tmp')),
    false,
  );

  const reopened = new PdfDiscussionStore(options);
  assert.deepEqual(reopened.load(), document);
});

test('rejects a stale save instead of silently losing another store update', () => {
  const root = mkdtempSync(join(tmpdir(), 'hl-pdf-discussions-conflict-'));
  const pdfPath = join(root, 'paper.pdf');
  writeFileSync(pdfPath, Buffer.from('%PDF-1.7\nconflicting-save\n', 'utf8'));
  const options = {
    layout: 'global',
    rootPath: join(root, 'storage'),
    pdfPath,
  };
  const firstStore = new PdfDiscussionStore(options);
  const secondStore = new PdfDiscussionStore(options);
  const firstBase = firstStore.load();
  const secondBase = secondStore.load();
  const firstAnnotation = makeAnnotation({ id: 'first-writer', snapshot: undefined });
  const secondAnnotation = makeAnnotation({ id: 'second-writer', snapshot: undefined });

  firstStore.save({ ...firstBase, annotations: [firstAnnotation] });
  assert.throws(
    () => secondStore.save({ ...secondBase, annotations: [secondAnnotation] }),
    error => {
      assert.equal(error?.name, 'ConflictingPdfDiscussionWriteError');
      assert.equal(error.code, 'CONFLICTING_PDF_DISCUSSION_WRITE');
      assert.equal(error.sidecarPath, firstStore.sidecarPath);
      assert.match(error.message, /changed.*load|reload.*retry/i);
      return true;
    },
  );
  assert.deepEqual(
    new PdfDiscussionStore(options).load().annotations.map(annotation => annotation.id),
    ['first-writer'],
  );
});

test('serializes update mutators across independent Node processes without losing annotations', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hl-pdf-discussions-process-update-'));
  const pdfPath = join(root, 'paper.pdf');
  writeFileSync(pdfPath, Buffer.from('%PDF-1.7\nprocess-update\n', 'utf8'));
  const options = {
    layout: 'global',
    rootPath: join(root, 'storage'),
    pdfPath,
  };
  const store = new PdfDiscussionStore(options);
  store.save(store.load());

  const childProgram = `
    const core = require(process.argv[1]);
    const options = JSON.parse(process.argv[2]);
    const annotation = JSON.parse(process.argv[3]);
    const delay = Number(process.argv[4]);
    const store = new core.PdfDiscussionStore(options);
    store.update(document => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
      return { ...document, annotations: [...document.annotations, annotation] };
    });
  `;
  const coreEntry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');
  const runChild = (annotation, delay) => new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      ['-e', childProgram, coreEntry, JSON.stringify(options), JSON.stringify(annotation), String(delay)],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', rejectPromise);
    child.on('close', code => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`PDF discussion update child exited ${code}: ${stderr}`));
    });
  });

  await Promise.all([
    runChild(makeAnnotation({ id: 'process-a', snapshot: undefined }), 150),
    runChild(makeAnnotation({ id: 'process-b', snapshot: undefined }), 10),
  ]);

  assert.deepEqual(
    new PdfDiscussionStore(options).load().annotations
      .map(annotation => annotation.id)
      .sort(),
    ['process-a', 'process-b'],
  );
});

test('protects an invalid sidecar from overwrite through the poisoned store instance', () => {
  const root = mkdtempSync(join(tmpdir(), 'hl-pdf-discussions-invalid-'));
  const pdfPath = join(root, 'paper.pdf');
  writeFileSync(pdfPath, Buffer.from('%PDF-1.7\ninvalid-sidecar\n', 'utf8'));
  const store = new PdfDiscussionStore({
    layout: 'vault',
    rootPath: join(root, 'vault'),
    pdfPath,
  });
  const replacement = {
    ...store.load(),
    annotations: [makeAnnotation()],
  };
  mkdirSync(dirname(store.sidecarPath), { recursive: true });
  const invalidJson = '{"version":1,"annotations":';
  writeFileSync(store.sidecarPath, invalidJson);

  assert.throws(
    () => store.load(),
    error => {
      assert.equal(error instanceof InvalidPdfDiscussionSidecarError, true);
      assert.equal(error.code, 'INVALID_PDF_DISCUSSION_SIDECAR');
      assert.equal(error.recoverable, true);
      assert.equal(error.sidecarPath, store.sidecarPath);
      assert.match(error.message, /not modified.*repair|repair.*retry/i);
      return true;
    },
  );
  assert.throws(
    () => store.save(replacement),
    error => error instanceof InvalidPdfDiscussionSidecarError,
  );
  assert.equal(readFileSync(store.sidecarPath, 'utf8'), invalidJson);
});

test('revalidates an existing sidecar immediately before saving', () => {
  const root = mkdtempSync(join(tmpdir(), 'hl-pdf-discussions-save-guard-'));
  const pdfPath = join(root, 'paper.pdf');
  writeFileSync(pdfPath, Buffer.from('%PDF-1.7\nsave-guard\n', 'utf8'));
  const store = new PdfDiscussionStore({
    layout: 'global',
    rootPath: join(root, 'storage'),
    pdfPath,
  });
  const replacement = {
    ...store.load(),
    annotations: [makeAnnotation()],
  };
  mkdirSync(dirname(store.sidecarPath), { recursive: true });
  const invalidJson = '{"version":1,"source":null}';
  writeFileSync(store.sidecarPath, invalidJson);

  assert.throws(
    () => store.save(replacement),
    error => error instanceof InvalidPdfDiscussionSidecarError,
  );
  assert.equal(readFileSync(store.sidecarPath, 'utf8'), invalidJson);
});

test('preserves running turns for the controller to recover using owner liveness', () => {
  const root = mkdtempSync(join(tmpdir(), 'hl-pdf-discussions-recovery-'));
  const pdfPath = join(root, 'paper.pdf');
  writeFileSync(pdfPath, Buffer.from('%PDF-1.7\nstale-running\n', 'utf8'));
  const options = {
    layout: 'global',
    rootPath: join(root, 'storage'),
    pdfPath,
  };
  const store = new PdfDiscussionStore(options);
  store.save({
    ...store.load(),
    annotations: [
      makeAnnotation({
        lastTurn: {
          status: 'running',
          questionMessageId: 'message-1',
        },
      }),
      makeAnnotation({ id: 'annotation-2', snapshot: undefined }),
    ],
  });

  const recovered = new PdfDiscussionStore(options).load();
  assert.equal(recovered.annotations[0].lastTurn.status, 'running');
  assert.equal(recovered.annotations[0].lastTurn.error, undefined);
  assert.equal(recovered.annotations[0].lastTurn.questionMessageId, 'message-1');
  assert.equal(recovered.annotations[1].lastTurn.status, 'idle');

  const persisted = JSON.parse(readFileSync(store.sidecarPath, 'utf8'));
  assert.equal(persisted.annotations[0].lastTurn.status, 'running');
  assert.equal(persisted.annotations[0].lastTurn.error, undefined);
});

test('writes and reads relative PNG snapshot assets in both layouts', () => {
  const root = mkdtempSync(join(tmpdir(), 'hl-pdf-discussions-snapshot-'));
  const pdfPath = join(root, 'paper.pdf');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  writeFileSync(pdfPath, Buffer.from('%PDF-1.7\nsnapshot-assets\n', 'utf8'));

  for (const layout of ['vault', 'global']) {
    const store = new PdfDiscussionStore({
      layout,
      rootPath: join(root, layout),
      pdfPath,
    });
    const snapshot = store.writeSnapshot('annotation-snapshot', png);

    assert.deepEqual(snapshot, {
      file: 'assets/annotation-snapshot/selection.png',
      sha256: createHash('sha256').update(png).digest('hex'),
      width: 1,
      height: 1,
      mimeType: 'image/png',
    });
    assert.equal(isAbsolute(snapshot.file), false);
    assert.deepEqual(store.readSnapshot(snapshot.file), png);
    assert.deepEqual(
      readFileSync(join(store.assetsPath, 'annotation-snapshot', 'selection.png')),
      png,
    );
    assert.throws(() => store.readSnapshot('/tmp/selection.png'), /relative/i);
  }
});

test('reads only bounded snapshots whose bytes, PNG metadata, and digest match', () => {
  const maximumSnapshotBytes = 5 * 1024 * 1024;
  const root = mkdtempSync(join(tmpdir(), 'hl-pdf-discussions-verified-snapshot-'));
  const pdfPath = join(root, 'paper.pdf');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  writeFileSync(pdfPath, Buffer.from('%PDF-1.7\nverified-snapshot\n', 'utf8'));
  const store = new PdfDiscussionStore({
    layout: 'global',
    rootPath: join(root, 'storage'),
    pdfPath,
  });
  const snapshot = store.writeSnapshot('verified-snapshot', png);

  assert.deepEqual(store.readVerifiedSnapshot(snapshot), png);
  assert.equal(
    store.readVerifiedSnapshot({
      ...snapshot,
      file: 'assets/missing-snapshot/selection.png',
    }),
    undefined,
  );

  assert.throws(
    () => store.readVerifiedSnapshot({ ...snapshot, sha256: '0'.repeat(64) }),
    error => {
      assert.equal(error?.name, 'InvalidPdfDiscussionSnapshotError');
      assert.equal(error.code, 'INVALID_PDF_DISCUSSION_SNAPSHOT');
      assert.match(error.message, /sha-?256|digest|integrity/i);
      return true;
    },
  );
  assert.throws(
    () => store.readVerifiedSnapshot({ ...snapshot, width: 2 }),
    error => error?.name === 'InvalidPdfDiscussionSnapshotError'
      && /dimensions|width/i.test(error.message),
  );
  assert.throws(
    () => store.readVerifiedSnapshot({ ...snapshot, mimeType: 'image/jpeg' }),
    error => error?.name === 'InvalidPdfDiscussionSnapshotError'
      && /metadata|mime|image\/png/i.test(error.message),
  );

  truncateSync(
    join(dirname(store.sidecarPath), ...snapshot.file.split('/')),
    maximumSnapshotBytes + 1,
  );
  assert.throws(
    () => store.readVerifiedSnapshot(snapshot),
    error => error?.name === 'InvalidPdfDiscussionSnapshotError'
      && /5 MiB|too large|size limit/i.test(error.message),
  );
});

test('rejects symlinked snapshot files and ancestor directories for reads and writes', t => {
  const root = mkdtempSync(join(tmpdir(), 'hl-pdf-discussions-snapshot-symlink-'));
  const pdfPath = join(root, 'paper.pdf');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  writeFileSync(pdfPath, Buffer.from('%PDF-1.7\nsymlinked-snapshot\n', 'utf8'));
  const store = new PdfDiscussionStore({
    layout: 'global',
    rootPath: join(root, 'storage'),
    pdfPath,
  });

  const finalSnapshot = store.writeSnapshot('final-link', png);
  const finalPath = join(dirname(store.sidecarPath), ...finalSnapshot.file.split('/'));
  const outsideFile = join(root, 'outside.png');
  writeFileSync(outsideFile, png);
  rmSync(finalPath);
  if (!symlinkOrSkip(t, outsideFile, finalPath, 'file')) return;

  assert.throws(
    () => store.readSnapshot(finalSnapshot.file),
    /symbolic link|symlink|outside/i,
  );
  assert.throws(
    () => store.readVerifiedSnapshot(finalSnapshot),
    error => error?.name === 'InvalidPdfDiscussionSnapshotError'
      && /symbolic link|symlink|outside/i.test(error.message),
  );
  assert.throws(
    () => store.writeSnapshot('final-link', png),
    /symbolic link|symlink|outside/i,
  );
  assert.deepEqual(readFileSync(outsideFile), png);

  const ancestorSnapshot = store.writeSnapshot('ancestor-link', png);
  const ancestorDirectory = dirname(
    join(dirname(store.sidecarPath), ...ancestorSnapshot.file.split('/')),
  );
  const outsideDirectory = join(root, 'outside-assets');
  mkdirSync(outsideDirectory);
  writeFileSync(join(outsideDirectory, 'selection.png'), png);
  rmSync(ancestorDirectory, { recursive: true });
  if (!symlinkOrSkip(t, outsideDirectory, ancestorDirectory, 'dir')) return;

  assert.throws(
    () => store.readSnapshot(ancestorSnapshot.file),
    /symbolic link|symlink|outside/i,
  );
  assert.throws(
    () => store.writeSnapshot('ancestor-link', png),
    /symbolic link|symlink|outside/i,
  );
  assert.deepEqual(readFileSync(join(outsideDirectory, 'selection.png')), png);
});

test('rejects symlinked source and target snapshot assets during import', t => {
  const root = mkdtempSync(join(tmpdir(), 'hl-pdf-discussions-import-symlink-'));
  const pdfPath = join(root, 'paper.pdf');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  writeFileSync(pdfPath, Buffer.from('%PDF-1.7\nimport-symlink\n', 'utf8'));
  const globalStore = new PdfDiscussionStore({
    layout: 'global',
    rootPath: join(root, 'storage'),
    pdfPath,
  });
  const vaultStore = new PdfDiscussionStore({
    layout: 'vault',
    rootPath: join(root, 'vault'),
    pdfPath,
  });
  const snapshot = globalStore.writeSnapshot('imported-link', png);
  globalStore.save({
    ...globalStore.load(),
    annotations: [makeAnnotation({ id: 'imported-link', snapshot })],
  });

  const sourcePath = join(dirname(globalStore.sidecarPath), ...snapshot.file.split('/'));
  const outsideFile = join(root, 'outside-import.png');
  writeFileSync(outsideFile, png);
  rmSync(sourcePath);
  if (!symlinkOrSkip(t, outsideFile, sourcePath, 'file')) return;
  const vaultBeforeSourceFailure = vaultStore.load();
  assert.throws(
    () => importGlobalPdfDiscussions(globalStore, vaultStore),
    /symbolic link|symlink|outside/i,
  );
  assert.deepEqual(vaultStore.load(), vaultBeforeSourceFailure);

  rmSync(sourcePath);
  writeFileSync(sourcePath, png);
  const targetDirectory = join(vaultStore.assetsPath, 'imported-link');
  const outsideDirectory = join(root, 'outside-import-assets');
  mkdirSync(outsideDirectory);
  mkdirSync(dirname(targetDirectory), { recursive: true });
  if (!symlinkOrSkip(t, outsideDirectory, targetDirectory, 'dir')) return;
  assert.throws(
    () => importGlobalPdfDiscussions(globalStore, vaultStore),
    /symbolic link|symlink|outside/i,
  );
  assert.deepEqual(readdirSync(outsideDirectory), []);
  assert.deepEqual(vaultStore.load(), vaultBeforeSourceFailure);
});

test('rejects absolute persisted snapshot paths without overwriting the sidecar', () => {
  const root = mkdtempSync(join(tmpdir(), 'hl-pdf-discussions-relative-'));
  const pdfPath = join(root, 'paper.pdf');
  writeFileSync(pdfPath, Buffer.from('%PDF-1.7\nrelative-snapshot\n', 'utf8'));
  const store = new PdfDiscussionStore({
    layout: 'vault',
    rootPath: join(root, 'vault'),
    pdfPath,
  });
  const original = store.save(store.load());
  const before = readFileSync(store.sidecarPath);
  const absoluteSnapshot = {
    ...makeAnnotation().snapshot,
    file: join(root, 'selection.png'),
  };

  assert.throws(
    () => store.save({
      ...original,
      annotations: [makeAnnotation({ snapshot: absoluteSnapshot })],
    }),
    /relative path/i,
  );
  assert.deepEqual(readFileSync(store.sidecarPath), before);
});

test('imports global discussions into a vault without changing conflicts or the source', () => {
  const root = mkdtempSync(join(tmpdir(), 'hl-pdf-discussions-import-'));
  const pdfPath = join(root, 'paper.pdf');
  const basePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const globalPng = Buffer.concat([basePng, Buffer.from([0x01])]);
  const vaultPng = Buffer.concat([basePng, Buffer.from([0x02])]);
  writeFileSync(pdfPath, Buffer.from('%PDF-1.7\nimport-discussions\n', 'utf8'));

  const globalStore = new PdfDiscussionStore({
    layout: 'global',
    rootPath: join(root, 'storage'),
    pdfPath,
    sourceUri: 'file:///outside/paper.pdf',
  });
  const vaultStore = new PdfDiscussionStore({
    layout: 'vault',
    rootPath: join(root, 'vault'),
    pdfPath,
    sourceUri: 'raw/pdf/paper.pdf',
  });
  const globalConflictSnapshot = globalStore.writeSnapshot('shared-id', globalPng);
  const globalOnlySnapshot = globalStore.writeSnapshot('global-only', globalPng);
  const vaultConflictSnapshot = vaultStore.writeSnapshot('shared-id', vaultPng);

  globalStore.save({
    ...globalStore.load(),
    annotations: [
      makeAnnotation({
        id: 'shared-id',
        snapshot: globalConflictSnapshot,
        summaryMarkdown: 'global conflict must lose',
      }),
      makeAnnotation({
        id: 'global-only',
        snapshot: globalOnlySnapshot,
        summaryMarkdown: 'import me',
      }),
    ],
  });
  vaultStore.save({
    ...vaultStore.load(),
    annotations: [
      makeAnnotation({
        id: 'shared-id',
        snapshot: vaultConflictSnapshot,
        summaryMarkdown: 'vault conflict must win',
      }),
      makeAnnotation({ id: 'vault-only', snapshot: undefined }),
    ],
  });

  const globalSidecarBefore = readFileSync(globalStore.sidecarPath);
  const globalAssetBefore = globalStore.readSnapshot(globalOnlySnapshot.file);
  const imported = importGlobalPdfDiscussions(globalStore, vaultStore);

  assert.equal(imported.imported, 1);
  assert.equal(imported.skipped, 1);
  assert.deepEqual(
    imported.document.annotations.map(annotation => annotation.id),
    ['shared-id', 'vault-only', 'global-only'],
  );
  assert.equal(
    imported.document.annotations[0].summaryMarkdown,
    'vault conflict must win',
  );
  assert.equal(imported.document.source.uri, 'raw/pdf/paper.pdf');
  const importedOnly = imported.document.annotations.find(annotation => annotation.id === 'global-only');
  assert.equal(importedOnly.anchor.uri, 'raw/pdf/paper.pdf');
  assert.equal(
    importedOnly.anchor.portableUrl,
    'raw/pdf/paper.pdf#page=3:~:text=Canonical%20selected%20text',
  );
  assert.deepEqual(vaultStore.readSnapshot(globalOnlySnapshot.file), globalPng);
  assert.deepEqual(vaultStore.readSnapshot(vaultConflictSnapshot.file), vaultPng);
  assert.deepEqual(readFileSync(globalStore.sidecarPath), globalSidecarBefore);
  assert.deepEqual(globalStore.readSnapshot(globalOnlySnapshot.file), globalAssetBefore);

  const repeated = importGlobalPdfDiscussions(globalStore, vaultStore);
  assert.equal(repeated.imported, 0);
  assert.equal(repeated.skipped, 2);
  assert.equal(repeated.document.annotations.length, 3);
});

test('does not let a unique global annotation overwrite a retained vault snapshot path', () => {
  const root = mkdtempSync(join(tmpdir(), 'hl-pdf-discussions-import-alias-'));
  const pdfPath = join(root, 'paper.pdf');
  const basePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const globalPng = Buffer.concat([basePng, Buffer.from([0x11])]);
  const vaultPng = Buffer.concat([basePng, Buffer.from([0x22])]);
  writeFileSync(pdfPath, Buffer.from('%PDF-1.7\nimport-asset-alias\n', 'utf8'));

  const globalStore = new PdfDiscussionStore({
    layout: 'global',
    rootPath: join(root, 'storage'),
    pdfPath,
  });
  const vaultStore = new PdfDiscussionStore({
    layout: 'vault',
    rootPath: join(root, 'vault'),
    pdfPath,
  });
  const aliasedGlobalSnapshot = globalStore.writeSnapshot('retained-id', globalPng);
  const retainedVaultSnapshot = vaultStore.writeSnapshot('retained-id', vaultPng);

  vaultStore.save({
    ...vaultStore.load(),
    annotations: [
      makeAnnotation({
        id: 'retained-id',
        snapshot: retainedVaultSnapshot,
        summaryMarkdown: 'retain this annotation and asset',
      }),
    ],
  });
  const maliciousGlobalDocument = {
    ...globalStore.load(),
    annotations: [
      makeAnnotation({
        id: 'unique-global-id',
        snapshot: aliasedGlobalSnapshot,
        summaryMarkdown: 'must not overwrite the retained asset',
      }),
    ],
  };
  writeFileSync(
    globalStore.sidecarPath,
    `${JSON.stringify(maliciousGlobalDocument, null, 2)}\n`,
  );
  const vaultSidecarBefore = readFileSync(vaultStore.sidecarPath);

  assert.throws(
    () => importGlobalPdfDiscussions(globalStore, vaultStore),
    error => (
      error instanceof InvalidPdfDiscussionSidecarError
      || /snapshot|asset|canonical/i.test(error.message)
    ),
  );
  assert.deepEqual(vaultStore.readSnapshot(retainedVaultSnapshot.file), vaultPng);
  assert.deepEqual(readFileSync(vaultStore.sidecarPath), vaultSidecarBefore);
});

test('treats case-only snapshot paths as collisions during import', () => {
  const root = mkdtempSync(join(tmpdir(), 'hl-pdf-discussions-import-case-alias-'));
  const pdfPath = join(root, 'paper.pdf');
  const basePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const globalPng = Buffer.concat([basePng, Buffer.from([0x33])]);
  const vaultPng = Buffer.concat([basePng, Buffer.from([0x44])]);
  writeFileSync(pdfPath, Buffer.from('%PDF-1.7\nimport-case-asset-alias\n', 'utf8'));

  const globalStore = new PdfDiscussionStore({
    layout: 'global',
    rootPath: join(root, 'storage'),
    pdfPath,
  });
  const vaultStore = new PdfDiscussionStore({
    layout: 'vault',
    rootPath: join(root, 'vault'),
    pdfPath,
  });
  const globalSnapshot = globalStore.writeSnapshot('RETAINED-ID', globalPng);
  const retainedVaultSnapshot = vaultStore.writeSnapshot('retained-id', vaultPng);

  globalStore.save({
    ...globalStore.load(),
    annotations: [
      makeAnnotation({
        id: 'RETAINED-ID',
        snapshot: globalSnapshot,
        summaryMarkdown: 'case-only global asset alias',
      }),
    ],
  });
  vaultStore.save({
    ...vaultStore.load(),
    annotations: [
      makeAnnotation({
        id: 'retained-id',
        snapshot: retainedVaultSnapshot,
        summaryMarkdown: 'retain lowercase asset',
      }),
    ],
  });
  const vaultSidecarBefore = readFileSync(vaultStore.sidecarPath);

  assert.throws(
    () => importGlobalPdfDiscussions(globalStore, vaultStore),
    /cannot overwrite an existing snapshot asset/i,
  );
  assert.deepEqual(vaultStore.readSnapshot(retainedVaultSnapshot.file), vaultPng);
  assert.deepEqual(readFileSync(vaultStore.sidecarPath), vaultSidecarBefore);
});
