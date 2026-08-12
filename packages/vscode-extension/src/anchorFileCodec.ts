import { createHash } from 'node:crypto';
import {
  isAbsolute,
  relative,
  resolve,
  sep,
  win32,
} from 'node:path';
import { classifyReferenceTarget } from '@llm-wiki/core';

export const ANCHOR_FILE_VERSION = 1;
export const ANCHOR_FILE_MAX_BYTES = 16 * 1024;
export const ANCHOR_FILE_MAX_TARGET_CHARS = 8 * 1024;

export interface AnchorFilePayload {
  readonly version: typeof ANCHOR_FILE_VERSION;
  readonly target: string;
}

export interface EncodedAnchorFile {
  readonly fileName: string;
  readonly text: string;
  readonly payload: AnchorFilePayload;
}

const localReferenceKinds = new Set([
  'note',
  'pdf',
  'code',
  'image',
  'text',
]);

export function encodeAnchorFile(
  target: string,
  vaultRoot: string,
): EncodedAnchorFile | undefined {
  const boundedTarget = boundedAnchorTarget(target);
  const candidate = boundedTarget ?? pageOnlyPdfTarget(target);
  if (!candidate) return undefined;

  const payload = validateAnchorPayload({
    version: ANCHOR_FILE_VERSION,
    target: candidate,
  }, vaultRoot);
  const text = JSON.stringify(payload, null, 2);
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.byteLength > ANCHOR_FILE_MAX_BYTES) return undefined;
  const hash = createHash('sha256').update(bytes).digest('hex');
  return Object.freeze({
    fileName: `source-${hash}.llm_wiki_anchor`,
    text,
    payload,
  });
}

export function parseAnchorFilePayload(
  text: string,
  vaultRoot: string,
): AnchorFilePayload {
  if (Buffer.byteLength(text, 'utf8') > ANCHOR_FILE_MAX_BYTES) {
    throw new Error('Anchor bridge file is too large.');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Anchor bridge JSON is malformed.');
  }
  return validateAnchorPayload(value, vaultRoot);
}

function validateAnchorPayload(
  value: unknown,
  vaultRoot: string,
): AnchorFilePayload {
  if (!isPlainRecord(value)) {
    throw new Error('Anchor bridge JSON must be an object.');
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'target' || keys[1] !== 'version') {
    throw new Error('Anchor bridge JSON has unsupported fields.');
  }
  if (value.version !== ANCHOR_FILE_VERSION) {
    throw new Error('Anchor bridge version is unsupported.');
  }
  if (typeof value.target !== 'string') {
    throw new Error('Anchor bridge target must be a string.');
  }
  validateAnchorTarget(value.target, vaultRoot);
  return Object.freeze({
    version: ANCHOR_FILE_VERSION,
    target: value.target,
  });
}

function boundedAnchorTarget(target: string): string | undefined {
  if (
    target.length > ANCHOR_FILE_MAX_TARGET_CHARS
    || Buffer.byteLength(target, 'utf8') > ANCHOR_FILE_MAX_BYTES
  ) return undefined;
  return target;
}

function pageOnlyPdfTarget(target: string): string | undefined {
  const reference = classifyReferenceTarget(target);
  if (
    reference.kind !== 'pdf'
    || !reference.path
    || !reference.page
  ) return undefined;
  return `${reference.path}#page=${reference.page}`;
}

function validateAnchorTarget(target: string, vaultRoot: string): void {
  if (!target || target.trim() !== target) {
    throw new Error('Anchor bridge target is empty or padded.');
  }
  if (target.length > ANCHOR_FILE_MAX_TARGET_CHARS) {
    throw new Error('Anchor bridge target is too long.');
  }
  if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(target) || hasLoneSurrogate(target)) {
    throw new Error('Anchor bridge target contains control characters.');
  }

  const reference = classifyReferenceTarget(target);
  if (!localReferenceKinds.has(reference.kind) || !reference.path) {
    throw new Error('Anchor bridge target must be a supported local file.');
  }
  if (
    isAbsolute(reference.path)
    || win32.isAbsolute(reference.path)
    || reference.path.includes('\\')
  ) {
    throw new Error('Anchor bridge target must be workspace-relative.');
  }
  const root = resolve(vaultRoot);
  const candidate = resolve(root, reference.path);
  const fromRoot = relative(root, candidate);
  if (
    fromRoot === '..'
    || fromRoot.startsWith(`..${sep}`)
    || isAbsolute(fromRoot)
  ) {
    throw new Error('Anchor bridge target must stay inside the workspace.');
  }
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
