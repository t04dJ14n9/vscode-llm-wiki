export interface TextRange {
  from: number;
  to: number;
}

export interface InsertTextResult {
  text: string;
  cursorPositions: number[];
}

export function applyInsertText(
  text: string,
  ranges: TextRange[],
  insertText: string,
): InsertTextResult {
  if (ranges.length === 0) {
    return {
      text: text + insertText,
      cursorPositions: [text.length + insertText.length],
    };
  }

  const sorted = ranges
    .map((range, index) => ({
      from: clamp(range.from, 0, text.length),
      to: clamp(range.to, 0, text.length),
      index,
    }))
    .map(range => ({
      ...range,
      from: Math.min(range.from, range.to),
      to: Math.max(range.from, range.to),
    }))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  let output = '';
  let cursorShift = 0;
  let previousEnd = 0;
  const cursorPositions = Array.from({ length: sorted.length }, () => 0);

  for (const range of sorted) {
    const from = Math.max(range.from, previousEnd);
    const to = Math.max(range.to, from);
    output += text.slice(previousEnd, from);
    output += insertText;
    cursorShift += insertText.length - (to - from);
    cursorPositions[range.index] = to + cursorShift;
    previousEnd = to;
  }

  output += text.slice(previousEnd);
  return { text: output, cursorPositions };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
