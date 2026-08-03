import { createHash, randomBytes } from 'crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  win32,
} from 'path';
import { fileURLToPath } from 'url';
import {
  PdfDiscussionDocumentV1Schema,
  type PdfDiscussionDocumentV1,
  PdfDiscussionSnapshotV1Schema,
  type PdfDiscussionSnapshotV1,
  pdfDiscussionSnapshotFile,
} from './schema';

export type PdfDiscussionLayout = 'vault' | 'global';
export type PdfPathLike = string | URL;

const PDF_HASH_CACHE_MAX_ENTRIES = 256;
const PDF_HASH_MAX_ATTEMPTS = 3;
const SIDECAR_ABSENT_STATE = 'absent';
const SIDECAR_LOCK_TIMEOUT_MS = 10_000;
const SIDECAR_LOCK_RETRY_MS = 20;
const MALFORMED_LOCK_STALE_MS = 30_000;
const LOCK_WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4));

export const PDF_DISCUSSION_SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024;

interface PdfFileIdentity {
  dev: string;
  ino: string;
  size: string;
  mtimeNs: string;
  ctimeNs: string;
  birthtimeNs: string;
}

interface CachedPdfHash {
  identity: PdfFileIdentity;
  sha256: string;
}

const pdfHashCache = new Map<string, CachedPdfHash>();

export interface PdfDiscussionStoreOptions {
  layout: PdfDiscussionLayout;
  rootPath: PdfPathLike;
  pdfPath: PdfPathLike;
  sourceUri?: string;
  portableSourceUrl?: string;
}

export interface PdfDiscussionSelectionKeyInput {
  page: number;
  quote: string;
  rects: ReadonlyArray<readonly [number, number, number, number]>;
  textItemIndex?: number;
  charOffset?: number;
  endTextItemIndex?: number;
  endCharOffset?: number;
}

export class InvalidPdfDiscussionSidecarError extends Error {
  readonly code = 'INVALID_PDF_DISCUSSION_SIDECAR';
  readonly recoverable = true;
  readonly sidecarPath: string;
  override readonly cause: unknown;

  constructor(sidecarPath: string, cause: unknown) {
    super(
      `Invalid PDF discussion sidecar: ${sidecarPath}. It was not modified; repair or move it, then retry.`,
    );
    this.name = 'InvalidPdfDiscussionSidecarError';
    this.sidecarPath = sidecarPath;
    this.cause = cause;
  }
}

export class ConflictingPdfDiscussionWriteError extends Error {
  readonly code = 'CONFLICTING_PDF_DISCUSSION_WRITE';
  readonly recoverable = true;
  readonly sidecarPath: string;

  constructor(sidecarPath: string) {
    super(
      `PDF discussion sidecar changed since it was loaded: ${sidecarPath}. Reload it and retry the update.`,
    );
    this.name = 'ConflictingPdfDiscussionWriteError';
    this.sidecarPath = sidecarPath;
  }
}

export class PdfDiscussionLockError extends Error {
  readonly code = 'PDF_DISCUSSION_LOCK_TIMEOUT';
  readonly recoverable = true;
  readonly sidecarPath: string;

  constructor(sidecarPath: string) {
    super(
      `Timed out waiting to update PDF discussions at ${sidecarPath}. Close another writer or retry.`,
    );
    this.name = 'PdfDiscussionLockError';
    this.sidecarPath = sidecarPath;
  }
}

export class InvalidPdfDiscussionSnapshotError extends Error {
  readonly code = 'INVALID_PDF_DISCUSSION_SNAPSHOT';
  readonly recoverable = true;
  readonly file: string;
  override readonly cause: unknown;

  constructor(file: string, reason: string, cause?: unknown) {
    super(`Invalid PDF discussion snapshot ${file}: ${reason}`);
    this.name = 'InvalidPdfDiscussionSnapshotError';
    this.file = file;
    this.cause = cause;
  }
}

export interface PdfDiscussionImportResult {
  document: PdfDiscussionDocumentV1;
  imported: number;
  skipped: number;
}

export type PdfDiscussionUpdate = (
  document: PdfDiscussionDocumentV1,
) => PdfDiscussionDocumentV1;

function filesystemPath(value: PdfPathLike): string {
  if (value instanceof URL) {
    if (value.protocol !== 'file:') throw new Error(`Expected a file URI, received ${value.protocol}`);
    return fileURLToPath(value);
  }
  if (/^file:/i.test(value)) return fileURLToPath(new URL(value));
  return value;
}

function defaultSourceUri(value: PdfPathLike): string {
  return value instanceof URL ? value.href : value;
}

function withoutFragment(value: string): string {
  const fragment = value.indexOf('#');
  return fragment < 0 ? value : value.slice(0, fragment);
}

function rebasePortableUrl(baseUrl: string, previousUrl: string): string {
  const fragment = previousUrl.indexOf('#');
  return fragment < 0 ? baseUrl : `${baseUrl}${previousUrl.slice(fragment)}`;
}

function pdfFileIdentity(path: string): PdfFileIdentity {
  const stat = statSync(path, { bigint: true });
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
    birthtimeNs: stat.birthtimeNs.toString(),
  };
}

function descriptorFileIdentity(descriptor: number): PdfFileIdentity {
  const stat = fstatSync(descriptor, { bigint: true });
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
    birthtimeNs: stat.birthtimeNs.toString(),
  };
}

function pathEntryIdentity(path: string): PdfFileIdentity {
  const stat = lstatSync(path, { bigint: true });
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
    birthtimeNs: stat.birthtimeNs.toString(),
  };
}

function samePdfFileIdentity(left: PdfFileIdentity, right: PdfFileIdentity): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
    && left.birthtimeNs === right.birthtimeNs;
}

function cachePdfHash(path: string, identity: PdfFileIdentity, sha256: string): void {
  pdfHashCache.delete(path);
  pdfHashCache.set(path, { identity, sha256 });
  while (pdfHashCache.size > PDF_HASH_CACHE_MAX_ENTRIES) {
    const oldest = pdfHashCache.keys().next().value;
    if (oldest === undefined) break;
    pdfHashCache.delete(oldest);
  }
}

export function computePdfSha256(input: Uint8Array | PdfPathLike): string {
  if (typeof input !== 'string' && !(input instanceof URL)) {
    return createHash('sha256').update(input).digest('hex');
  }

  const path = resolve(filesystemPath(input));
  for (let attempt = 1; attempt <= PDF_HASH_MAX_ATTEMPTS; attempt += 1) {
    const before = pdfFileIdentity(path);
    const cached = pdfHashCache.get(path);
    if (cached && samePdfFileIdentity(cached.identity, before)) {
      cachePdfHash(path, cached.identity, cached.sha256);
      return cached.sha256;
    }

    const bytes = readFileSync(path);
    const after = pdfFileIdentity(path);
    if (
      samePdfFileIdentity(before, after)
      && BigInt(bytes.byteLength) === BigInt(after.size)
    ) {
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      cachePdfHash(path, after, sha256);
      return sha256;
    }
  }

  throw new Error(
    `PDF changed repeatedly while computing its SHA-256: ${path}. Wait for the file to finish updating and retry.`,
  );
}

function isNonNegativeInteger(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function hasCompleteTextOffsets(
  input: PdfDiscussionSelectionKeyInput,
): input is PdfDiscussionSelectionKeyInput & Required<Pick<
  PdfDiscussionSelectionKeyInput,
  'textItemIndex' | 'charOffset' | 'endTextItemIndex' | 'endCharOffset'
>> {
  if (
    !isNonNegativeInteger(input.textItemIndex)
    || !isNonNegativeInteger(input.charOffset)
    || !isNonNegativeInteger(input.endTextItemIndex)
    || !isNonNegativeInteger(input.endCharOffset)
  ) {
    return false;
  }
  return input.endTextItemIndex > input.textItemIndex
    || (
      input.endTextItemIndex === input.textItemIndex
      && input.endCharOffset >= input.charOffset
    );
}

export function createPdfDiscussionSelectionKey(input: PdfDiscussionSelectionKeyInput): string {
  if (!Number.isInteger(input.page) || input.page < 1) {
    throw new Error('PDF discussion selections require a positive integer page');
  }
  if (!hasCompleteTextOffsets(input)) {
    const rects = input.rects.map(rect => rect.map(coordinate => {
      if (!Number.isFinite(coordinate)) {
        throw new Error('PDF discussion selection rectangles require finite coordinates');
      }
      const rounded = Math.round(coordinate * 100) / 100;
      return (Object.is(rounded, -0) ? 0 : rounded).toFixed(2);
    }).join(',')).sort();
    const canonical = JSON.stringify([
      'quote-rects',
      input.page,
      input.quote,
      rects,
    ]);
    return createHash('sha256').update(canonical).digest('hex');
  }
  const canonical = JSON.stringify([
    'text-offsets',
    input.page,
    input.textItemIndex,
    input.charOffset,
    input.endTextItemIndex,
    input.endCharOffset,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

function atomicWriteFile(path: string, contents: string | Uint8Array): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temporaryPath = join(
    directory,
    `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, contents, { flag: 'wx' });
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
}

function sidecarState(contents: string): string {
  return `sha256:${createHash('sha256').update(contents).digest('hex')}`;
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errnoCode(error) !== 'ESRCH';
  }
}

function removeAbandonedLock(lockPath: string): boolean {
  try {
    const raw = readFileSync(lockPath, 'utf8');
    try {
      const owner = JSON.parse(raw) as { pid?: unknown };
      if (typeof owner.pid === 'number' && processIsAlive(owner.pid)) return false;
      if (typeof owner.pid === 'number') {
        unlinkSync(lockPath);
        return true;
      }
    } catch {
      // A competing process can briefly expose the lock before writing its owner data.
    }
    const age = Date.now() - statSync(lockPath).mtimeMs;
    if (age < MALFORMED_LOCK_STALE_MS) return false;
    unlinkSync(lockPath);
    return true;
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return true;
    return false;
  }
}

function withSynchronousFileLock<T>(
  lockPath: string,
  sidecarPath: string,
  callback: () => T,
): T {
  mkdirSync(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + SIDECAR_LOCK_TIMEOUT_MS;
  const token = randomBytes(16).toString('hex');
  let descriptor: number | undefined;

  while (descriptor === undefined) {
    try {
      descriptor = openSync(lockPath, 'wx', 0o600);
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }));
    } catch (error) {
      if (descriptor !== undefined) {
        closeSync(descriptor);
        descriptor = undefined;
        rmSync(lockPath, { force: true });
      }
      if (errnoCode(error) !== 'EEXIST') throw error;
      if (removeAbandonedLock(lockPath)) continue;
      if (Date.now() >= deadline) throw new PdfDiscussionLockError(sidecarPath);
      Atomics.wait(LOCK_WAIT_BUFFER, 0, 0, SIDECAR_LOCK_RETRY_MS);
    }
  }

  try {
    return callback();
  } finally {
    closeSync(descriptor);
    try {
      const owner = JSON.parse(readFileSync(lockPath, 'utf8')) as { token?: unknown };
      if (owner.token === token) unlinkSync(lockPath);
    } catch (error) {
      if (errnoCode(error) !== 'ENOENT') {
        // Leave an unexpected lock replacement intact; its owner can release it safely.
      }
    }
  }
}

function relativeAssetParts(file: string): string[] {
  if (isAbsolute(file) || win32.isAbsolute(file)) {
    throw new Error('PDF discussion snapshot paths must be relative');
  }
  const parts = file.replace(/\\/g, '/').split('/');
  if (parts.length === 0 || parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new Error('PDF discussion snapshot paths must be relative and cannot traverse directories');
  }
  return parts;
}

function portableAssetPathKey(file: string): string {
  return file.replace(/\\/g, '/').toLowerCase();
}

function pathIsWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === ''
    || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
}

function pngDimensions(input: Uint8Array): { width: number; height: number } {
  const bytes = Buffer.from(input);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (
    bytes.length < 24
    || !bytes.subarray(0, signature.length).equals(signature)
    || bytes.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('PDF discussion snapshots must be valid PNG data');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1) {
    throw new Error('PDF discussion snapshot PNG dimensions must be positive');
  }
  return { width, height };
}

interface PdfDiscussionSidecarRead {
  document: PdfDiscussionDocumentV1;
  state: string;
}

export class PdfDiscussionStore {
  readonly layout: PdfDiscussionLayout;
  readonly rootPath: string;
  readonly pdfPath: string;
  readonly sourceUri: string;
  readonly portableSourceUrl: string;
  readonly pdfSha256: string;
  readonly sidecarPath: string;
  readonly assetsPath: string;
  private invalidSidecarError: InvalidPdfDiscussionSidecarError | undefined;
  private observedSidecarState: string | undefined;

  constructor(options: PdfDiscussionStoreOptions) {
    this.layout = options.layout;
    this.rootPath = resolve(filesystemPath(options.rootPath));
    this.pdfPath = resolve(filesystemPath(options.pdfPath));
    this.sourceUri = options.sourceUri ?? defaultSourceUri(options.pdfPath);
    this.portableSourceUrl = withoutFragment(options.portableSourceUrl ?? this.sourceUri);
    this.pdfSha256 = computePdfSha256(this.pdfPath);

    if (this.layout === 'vault') {
      const discussionRoot = join(this.rootPath, '.hl', 'annotations', 'pdf');
      this.sidecarPath = join(discussionRoot, `${this.pdfSha256}.json`);
      this.assetsPath = join(discussionRoot, 'assets');
    } else if (this.layout === 'global') {
      const discussionRoot = join(this.rootPath, 'pdf-annotations', this.pdfSha256);
      this.sidecarPath = join(discussionRoot, 'annotations.json');
      this.assetsPath = join(discussionRoot, 'assets');
    } else {
      throw new Error(`Unsupported PDF discussion layout: ${String(this.layout)}`);
    }
  }

  load(): PdfDiscussionDocumentV1 {
    const loaded = this.readDocumentUnlocked();
    this.observedSidecarState = loaded.state;
    return loaded.document;
  }

  save(document: PdfDiscussionDocumentV1): PdfDiscussionDocumentV1 {
    return this.withLock(() => {
      const current = this.readDocumentUnlocked();
      if (
        (this.observedSidecarState === undefined && current.state !== SIDECAR_ABSENT_STATE)
        || (
          this.observedSidecarState !== undefined
          && this.observedSidecarState !== current.state
        )
      ) {
        throw new ConflictingPdfDiscussionWriteError(this.sidecarPath);
      }
      return this.writeDocumentUnlocked(document);
    });
  }

  update(mutator: PdfDiscussionUpdate): PdfDiscussionDocumentV1 {
    if (typeof mutator !== 'function') {
      throw new TypeError('PDF discussion updates require a synchronous mutator function');
    }
    return this.withLock(() => {
      const current = this.readDocumentUnlocked().document;
      const updated = mutator(current);
      if (updated === undefined || updated === null) {
        throw new TypeError('PDF discussion update mutators must return the next document');
      }
      return this.writeDocumentUnlocked(updated);
    });
  }

  writeSnapshot(annotationId: string, png: Uint8Array): PdfDiscussionSnapshotV1 {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(annotationId)) {
      throw new Error('PDF discussion annotation IDs must be safe path segments');
    }
    if (png.byteLength > PDF_DISCUSSION_SNAPSHOT_MAX_BYTES) {
      throw new InvalidPdfDiscussionSnapshotError(
        pdfDiscussionSnapshotFile(annotationId),
        'snapshot exceeds the 5 MiB size limit',
      );
    }
    const { width, height } = pngDimensions(png);
    const file = pdfDiscussionSnapshotFile(annotationId);
    const snapshot = PdfDiscussionSnapshotV1Schema.parse({
      file,
      sha256: createHash('sha256').update(png).digest('hex'),
      width,
      height,
      mimeType: 'image/png',
    });
    this.withLock(() => this.writeSnapshotBytes(snapshot.file, png));
    return snapshot;
  }

  readSnapshot(file: string): Buffer {
    const descriptor = this.openSnapshotDescriptor(file);
    try {
      return readFileSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }

  readVerifiedSnapshot(snapshot: PdfDiscussionSnapshotV1): Buffer | undefined {
    return this.readVerifiedSnapshotUnlocked(snapshot);
  }

  importFromGlobal(globalStore: PdfDiscussionStore): PdfDiscussionImportResult {
    if (this.layout !== 'vault' || globalStore.layout !== 'global') {
      throw new Error('PDF discussion import requires a global source and vault target');
    }
    if (this.pdfSha256 !== globalStore.pdfSha256) {
      throw new Error('PDF discussion import requires matching PDF hashes');
    }

    return this.withLock(() => globalStore.withLock(() => {
      const source = globalStore.readDocumentUnlocked().document;
      const target = this.readDocumentUnlocked().document;
      const targetIds = new Set(target.annotations.map(annotation => annotation.id));
      const claimedAssetFiles = new Set(
        target.annotations.flatMap(annotation => (
          annotation.snapshot ? [portableAssetPathKey(annotation.snapshot.file)] : []
        )),
      );
      const importedAnnotations: typeof source.annotations = [];
      const assets: Array<{ file: string; bytes: Buffer }> = [];
      let skipped = 0;

      for (const annotation of source.annotations) {
        if (targetIds.has(annotation.id)) {
          skipped += 1;
          continue;
        }
        if (annotation.snapshot) {
          const assetPathKey = portableAssetPathKey(annotation.snapshot.file);
          if (claimedAssetFiles.has(assetPathKey)) {
            throw new Error(
              `PDF discussion import cannot overwrite an existing snapshot asset: ${annotation.snapshot.file}`,
            );
          }
          claimedAssetFiles.add(assetPathKey);
          const bytes = globalStore.readVerifiedSnapshotUnlocked(annotation.snapshot);
          if (!bytes) {
            throw new InvalidPdfDiscussionSnapshotError(
              annotation.snapshot.file,
              'snapshot file is missing; recreate the source capture and retry the import',
            );
          }
          assets.push({ file: annotation.snapshot.file, bytes });
        }
        importedAnnotations.push({
          ...annotation,
          anchor: {
            ...annotation.anchor,
            uri: this.sourceUri,
            portableUrl: rebasePortableUrl(
              this.portableSourceUrl,
              annotation.anchor.portableUrl,
            ),
          },
        });
        targetIds.add(annotation.id);
      }

      for (const asset of assets) {
        this.writeSnapshotBytes(asset.file, asset.bytes);
      }
      const document = this.writeDocumentUnlocked({
        ...target,
        annotations: [...target.annotations, ...importedAnnotations],
      });
      return {
        document,
        imported: importedAnnotations.length,
        skipped,
      };
    }));
  }

  private withLock<T>(callback: () => T): T {
    return withSynchronousFileLock(
      `${this.sidecarPath}.lock`,
      this.sidecarPath,
      callback,
    );
  }

  private readDocumentUnlocked(): PdfDiscussionSidecarRead {
    if (this.invalidSidecarError) throw this.invalidSidecarError;
    let raw: string;
    try {
      raw = readFileSync(this.sidecarPath, 'utf8');
    } catch (error) {
      if (errnoCode(error) !== 'ENOENT') throw error;
      return {
        state: SIDECAR_ABSENT_STATE,
        document: {
          version: 1,
          source: {
            uri: this.sourceUri,
            sha256: this.pdfSha256,
          },
          annotations: [],
        },
      };
    }

    try {
      const parsed = PdfDiscussionDocumentV1Schema.parse(JSON.parse(raw));
      if (parsed.source.sha256 !== this.pdfSha256) {
        throw new Error('PDF discussion sidecar hash does not match the PDF');
      }
      return {
        document: parsed,
        state: sidecarState(raw),
      };
    } catch (cause) {
      const error = new InvalidPdfDiscussionSidecarError(this.sidecarPath, cause);
      this.invalidSidecarError = error;
      throw error;
    }
  }

  private writeDocumentUnlocked(document: PdfDiscussionDocumentV1): PdfDiscussionDocumentV1 {
    const parsed = PdfDiscussionDocumentV1Schema.parse(document);
    if (parsed.source.sha256 !== this.pdfSha256) {
      throw new Error('PDF discussion document hash does not match the PDF');
    }
    const serialized = `${JSON.stringify(parsed, null, 2)}\n`;
    atomicWriteFile(this.sidecarPath, serialized);
    this.observedSidecarState = sidecarState(serialized);
    return parsed;
  }

  private readVerifiedSnapshotUnlocked(
    snapshotInput: PdfDiscussionSnapshotV1,
  ): Buffer | undefined {
    let snapshot: PdfDiscussionSnapshotV1;
    let path: string;
    try {
      snapshot = PdfDiscussionSnapshotV1Schema.parse(snapshotInput);
      path = this.snapshotPath(snapshot.file);
      this.assertSnapshotPathSafe(snapshot.file, path);
    } catch (cause) {
      if (cause instanceof InvalidPdfDiscussionSnapshotError) throw cause;
      const file = typeof snapshotInput?.file === 'string' ? snapshotInput.file : '<unknown>';
      throw new InvalidPdfDiscussionSnapshotError(
        file,
        'snapshot metadata or path is invalid',
        cause,
      );
    }

    let descriptor: number;
    try {
      descriptor = this.openSnapshotDescriptor(snapshot.file, path);
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') return undefined;
      throw new InvalidPdfDiscussionSnapshotError(
        snapshot.file,
        'snapshot could not be opened',
        error,
      );
    }

    try {
      const before = descriptorFileIdentity(descriptor);
      const size = BigInt(before.size);
      if (size > BigInt(PDF_DISCUSSION_SNAPSHOT_MAX_BYTES)) {
        throw new InvalidPdfDiscussionSnapshotError(
          snapshot.file,
          'snapshot exceeds the 5 MiB size limit',
        );
      }

      const expectedBytes = Number(size);
      const bytes = Buffer.alloc(expectedBytes);
      let bytesRead = 0;
      while (bytesRead < expectedBytes) {
        const count = readSync(
          descriptor,
          bytes,
          bytesRead,
          expectedBytes - bytesRead,
          bytesRead,
        );
        if (count === 0) break;
        bytesRead += count;
      }
      const extra = Buffer.alloc(1);
      const extraBytes = readSync(descriptor, extra, 0, 1, expectedBytes);
      const after = descriptorFileIdentity(descriptor);
      if (
        bytesRead !== expectedBytes
        || extraBytes !== 0
        || !samePdfFileIdentity(before, after)
      ) {
        throw new InvalidPdfDiscussionSnapshotError(
          snapshot.file,
          'snapshot changed while it was being read; retry the operation',
        );
      }

      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== snapshot.sha256) {
        throw new InvalidPdfDiscussionSnapshotError(
          snapshot.file,
          'SHA-256 digest does not match the stored metadata',
        );
      }
      let dimensions: { width: number; height: number };
      try {
        dimensions = pngDimensions(bytes);
      } catch (cause) {
        throw new InvalidPdfDiscussionSnapshotError(
          snapshot.file,
          'bytes are not a valid image/png snapshot',
          cause,
        );
      }
      if (dimensions.width !== snapshot.width || dimensions.height !== snapshot.height) {
        throw new InvalidPdfDiscussionSnapshotError(
          snapshot.file,
          `PNG dimensions ${dimensions.width}x${dimensions.height} do not match metadata ${snapshot.width}x${snapshot.height}`,
        );
      }
      return bytes;
    } catch (error) {
      if (error instanceof InvalidPdfDiscussionSnapshotError) throw error;
      throw new InvalidPdfDiscussionSnapshotError(
        snapshot.file,
        'snapshot failed bounded integrity verification',
        error,
      );
    } finally {
      closeSync(descriptor);
    }
  }

  private snapshotPath(file: string): string {
    const sidecarDirectory = dirname(this.sidecarPath);
    const path = resolve(sidecarDirectory, ...relativeAssetParts(file));
    const fromSidecar = relative(sidecarDirectory, path);
    if (fromSidecar.startsWith('..') || isAbsolute(fromSidecar)) {
      throw new Error('PDF discussion snapshot paths must be relative');
    }
    return path;
  }

  private openSnapshotDescriptor(file: string, knownPath?: string): number {
    const path = knownPath ?? this.snapshotPath(file);
    this.assertSnapshotPathSafe(file, path);
    let descriptor: number;
    try {
      descriptor = openSync(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
    } catch (cause) {
      if (errnoCode(cause) === 'ENOENT') throw cause;
      throw new InvalidPdfDiscussionSnapshotError(
        file,
        'snapshot could not be opened without following symbolic links',
        cause,
      );
    }
    try {
      this.assertSnapshotPathSafe(file, path);
      if (!samePdfFileIdentity(descriptorFileIdentity(descriptor), pathEntryIdentity(path))) {
        throw new InvalidPdfDiscussionSnapshotError(
          file,
          'snapshot path changed while it was being opened',
        );
      }
      return descriptor;
    } catch (cause) {
      closeSync(descriptor);
      if (cause instanceof InvalidPdfDiscussionSnapshotError) throw cause;
      throw new InvalidPdfDiscussionSnapshotError(
        file,
        'snapshot path could not be verified safely',
        cause,
      );
    }
  }

  private writeSnapshotBytes(file: string, bytes: Uint8Array): void {
    const path = this.snapshotPath(file);
    this.assertSnapshotPathSafe(file, path);
    mkdirSync(dirname(path), { recursive: true });
    this.assertSnapshotPathSafe(file, path);
    atomicWriteFile(path, bytes);
    this.assertSnapshotPathSafe(file, path);
  }

  private assertSnapshotPathSafe(file: string, path: string): void {
    const storageRoot = this.rootPath;
    if (!pathIsWithin(storageRoot, path)) {
      throw new InvalidPdfDiscussionSnapshotError(
        file,
        'snapshot path resolves outside its storage root',
      );
    }

    const fromRoot = relative(storageRoot, path);
    const parts = fromRoot === '' ? [] : fromRoot.split(sep);
    let current = storageRoot;
    let canonicalRoot: string | undefined;
    for (let index = -1; index < parts.length; index += 1) {
      if (index >= 0) current = join(current, parts[index]!);
      let entry;
      try {
        entry = lstatSync(current);
      } catch (cause) {
        if (errnoCode(cause) === 'ENOENT') break;
        throw new InvalidPdfDiscussionSnapshotError(
          file,
          'snapshot path metadata could not be inspected safely',
          cause,
        );
      }
      if (entry.isSymbolicLink()) {
        throw new InvalidPdfDiscussionSnapshotError(
          file,
          'snapshot path contains a symbolic link',
        );
      }
      if (index < parts.length - 1 && !entry.isDirectory()) {
        throw new InvalidPdfDiscussionSnapshotError(
          file,
          'snapshot path contains a non-directory ancestor',
        );
      }

      try {
        canonicalRoot ??= realpathSync(storageRoot);
        const canonicalCurrent = realpathSync(current);
        if (!pathIsWithin(canonicalRoot, canonicalCurrent)) {
          throw new InvalidPdfDiscussionSnapshotError(
            file,
            'snapshot path resolves outside its storage root',
          );
        }
      } catch (cause) {
        if (cause instanceof InvalidPdfDiscussionSnapshotError) throw cause;
        if (errnoCode(cause) !== 'ENOENT') {
          throw new InvalidPdfDiscussionSnapshotError(
            file,
            'snapshot path could not be resolved safely',
            cause,
          );
        }
      }
    }
  }
}

export function importGlobalPdfDiscussions(
  globalStore: PdfDiscussionStore,
  vaultStore: PdfDiscussionStore,
): PdfDiscussionImportResult {
  return vaultStore.importFromGlobal(globalStore);
}
