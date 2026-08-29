function errorRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function structuredErrorCodeInner(value: unknown, seen: Set<object>): string | number | undefined {
  const record = errorRecord(value);
  if (!record || seen.has(record)) return undefined;
  seen.add(record);
  const code = record.code;
  if (typeof code === 'string' || typeof code === 'number') return code;
  for (const candidate of [record.reason, record.error, record.detail]) {
    const nested = structuredErrorCodeInner(candidate, seen);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function structuredErrorCode(value: unknown): string | number | undefined {
  return structuredErrorCodeInner(value, new Set());
}

function formatUnknownErrorInner(
  value: unknown,
  fallback: string,
  seen: Set<object>,
): string {
  if (typeof value === 'string') return value.trim() || fallback;
  if (value instanceof Error) return value.message.trim() || value.name || fallback;
  if (Array.isArray(value)) {
    if (seen.has(value)) return fallback;
    seen.add(value);
    const details = value
      .map(candidate => formatUnknownErrorInner(candidate, '', seen))
      .filter(Boolean);
    return details.length ? details.join('; ') : fallback;
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return `${value}`;
  }
  if (typeof value === 'symbol') return value.description ?? fallback;
  if (typeof value === 'function') return value.name || fallback;
  if (value === undefined || value === null) return fallback;

  const record = errorRecord(value);
  if (!record) return fallback;
  if (seen.has(record)) return fallback;
  seen.add(record);

  const detail = [record.message, record.detail, record.reason, record.error]
    .map(candidate => candidate === undefined ? undefined : formatUnknownErrorInner(candidate, '', seen))
    .find(candidate => candidate?.trim());
  const code = structuredErrorCode(value);
  if (detail) {
    return code === undefined || detail.includes(String(code))
      ? detail
      : `${detail} (code ${code})`;
  }

  try {
    const serialized = JSON.stringify(record);
    return serialized && serialized !== '{}' ? serialized : fallback;
  } catch {
    return fallback;
  }
}

export function formatUnknownError(value: unknown, fallback = 'Unknown error'): string {
  return formatUnknownErrorInner(value, fallback, new Set());
}
