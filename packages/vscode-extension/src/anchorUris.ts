import * as vscode from 'vscode';

const EXTENSION_ID = 'llm-wiki.llm-wiki-vscode';
const OPEN_ANCHOR_PATH = '/open-anchor';
const TARGET_QUERY_KEY = 'target';
const TARGET_ENCODING_PREFIX = 'v1.';
const MAX_TARGET_LENGTH = 32 * 1024;
const MAX_ENCODED_TARGET_LENGTH = MAX_TARGET_LENGTH * 4;

export function llmWikiOpenAnchorUri(target: string): string | undefined {
  const normalized = normalizeTarget(target);
  if (!normalized) return undefined;
  const encoded = Buffer.from(normalized, 'utf8').toString('base64url');
  return `${vscode.env.uriScheme}://${EXTENSION_ID}${OPEN_ANCHOR_PATH}`
    + `?${TARGET_QUERY_KEY}=${TARGET_ENCODING_PREFIX}${encoded}`;
}

export function llmWikiAnchorTarget(
  uri: Pick<vscode.Uri, 'scheme' | 'authority' | 'path' | 'query'>,
): string | undefined {
  if (
    uri.scheme !== vscode.env.uriScheme
    || uri.authority !== EXTENSION_ID
    || uri.path !== OPEN_ANCHOR_PATH
  ) return undefined;
  const params = new URLSearchParams(uri.query);
  if (
    [...params.keys()].some(key => key !== TARGET_QUERY_KEY)
    || params.getAll(TARGET_QUERY_KEY).length !== 1
  ) return undefined;
  const encoded = params.get(TARGET_QUERY_KEY) ?? '';
  if (!encoded.startsWith(TARGET_ENCODING_PREFIX)) return undefined;
  const payload = encoded.slice(TARGET_ENCODING_PREFIX.length);
  if (
    !payload
    || payload.length > MAX_ENCODED_TARGET_LENGTH
    || !/^[A-Za-z0-9_-]+$/.test(payload)
  ) return undefined;
  const decoded = Buffer.from(payload, 'base64url').toString('utf8');
  if (Buffer.from(decoded, 'utf8').toString('base64url') !== payload) return undefined;
  return normalizeTarget(decoded);
}

export function llmWikiAnchorTargetFromString(value: string): string | undefined {
  try {
    return llmWikiAnchorTarget(vscode.Uri.parse(value));
  } catch {
    return undefined;
  }
}

function normalizeTarget(target: string): string | undefined {
  const normalized = target.trim();
  return (
    normalized
    && normalized.length <= MAX_TARGET_LENGTH
    && !hasControlCharacters(normalized)
  )
    ? normalized
    : undefined;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || codePoint === 0x7f;
  });
}
