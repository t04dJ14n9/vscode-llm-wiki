export interface CodeFenceOpening {
  marker: string;
  language: string;
}

export function parseCodeFenceOpening(text: string): CodeFenceOpening | null {
  const match = text.match(/^ {0,3}(```+|~~~+)(.*)$/);
  if (!match) return null;

  const marker = match[1]!;
  const info = (match[2] ?? '').trim();
  if (marker[0] === '`' && info.includes('`')) return null;

  return {
    marker,
    language: firstInfoStringToken(info),
  };
}

export function isCodeFenceClosing(text: string, openingMarker: string): boolean {
  const fenceChar = openingMarker[0];
  if (fenceChar !== '`' && fenceChar !== '~') return false;

  const match = text.match(/^ {0,3}([`~]+)\s*$/);
  if (!match) return false;

  const trimmed = match[1]!;
  if (trimmed.length < openingMarker.length) return false;
  if (![...trimmed].every(char => char === fenceChar)) return false;
  return true;
}

function firstInfoStringToken(info: string): string {
  if (!info) return '';
  return info.split(/\s+/, 1)[0] ?? '';
}
