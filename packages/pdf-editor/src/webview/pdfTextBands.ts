// Pure text-band normalization used by selection and discussion capture.
export type PdfRect = [number, number, number, number];

interface PdfTextBandCandidate {
  rect: PdfRect;
  left: number;
  right: number;
  top: number;
  bottom: number;
  center: number;
  height: number;
  weight: number;
}

interface PdfTextBand {
  candidates: PdfTextBandCandidate[];
  center: number;
  height: number;
}

const PDF_TEXT_BAND_MIN_GAP = 0.5;
const PDF_TEXT_BAND_CENTER_TOLERANCE = 0.68;

/**
 * Turns loose PDF glyph/run boxes into Preview-like text selection bands.
 *
 * PDF font metrics can move or resize loose boxes for bold glyphs even when
 * those glyphs share a baseline with surrounding text. Grouping by robust
 * line centers prevents those runs from becoming nested sub-boxes. Neighbor
 * midpoints then cap the vertical extent so tightly-spaced lines never paint
 * on top of each other.
 */
export function normalizePdfTextBands(value: unknown): PdfRect[] {
  const candidates = validPdfTextBandRects(value).map(rect => {
    const [left, top, right, bottom] = rect;
    const height = bottom - top;
    return {
      rect,
      left,
      right,
      top,
      bottom,
      center: (top + bottom) / 2,
      height,
      weight: Math.max(0.25, right - left),
    } satisfies PdfTextBandCandidate;
  });
  if (candidates.length <= 1) {
    return candidates.map(candidate => roundPdfTextBandRect(candidate.rect));
  }

  candidates.sort((left, right) => (
    left.center - right.center
    || left.left - right.left
    || left.right - right.right
  ));

  const bands: PdfTextBand[] = [];
  for (const candidate of candidates) {
    let match: PdfTextBand | undefined;
    let matchDistance = Number.POSITIVE_INFINITY;
    for (const band of bands) {
      const distance = Math.abs(candidate.center - band.center);
      const tolerance = Math.max(
        0.75,
        Math.min(candidate.height, band.height) * PDF_TEXT_BAND_CENTER_TOLERANCE,
      );
      if (distance <= tolerance && distance < matchDistance) {
        match = band;
        matchDistance = distance;
      }
    }
    if (!match) {
      bands.push({
        candidates: [candidate],
        center: candidate.center,
        height: candidate.height,
      });
      continue;
    }
    match.candidates.push(candidate);
    match.center = weightedMedian(match.candidates, entry => entry.center);
    match.height = weightedMedian(match.candidates, entry => entry.height);
  }

  bands.sort((left, right) => left.center - right.center);
  const output: PdfRect[] = [];
  for (let bandIndex = 0; bandIndex < bands.length; bandIndex++) {
    const band = bands[bandIndex]!;
    const previous = bands[bandIndex - 1];
    const next = bands[bandIndex + 1];
    const halfGap = PDF_TEXT_BAND_MIN_GAP / 2;
    let top = band.center - band.height / 2;
    let bottom = band.center + band.height / 2;
    if (previous) top = Math.max(top, (previous.center + band.center) / 2 + halfGap);
    if (next) bottom = Math.min(bottom, (band.center + next.center) / 2 - halfGap);
    if (bottom <= top) {
      top = band.center - 0.125;
      bottom = band.center + 0.125;
    }

    const horizontallySorted = [...band.candidates].sort((left, right) => (
      left.left - right.left || left.right - right.right
    ));
    const segments: Array<[number, number]> = [];
    for (const candidate of horizontallySorted) {
      const previousSegment = segments[segments.length - 1];
      if (!previousSegment) {
        segments.push([candidate.left, candidate.right]);
        continue;
      }
      const gap = candidate.left - previousSegment[1];
      const mergeThreshold = Math.max(4, band.height * 1.2);
      if (gap <= mergeThreshold) {
        previousSegment[0] = Math.min(previousSegment[0], candidate.left);
        previousSegment[1] = Math.max(previousSegment[1], candidate.right);
      } else {
        segments.push([candidate.left, candidate.right]);
      }
    }
    for (const [left, right] of segments) {
      output.push(roundPdfTextBandRect([left, top, right, bottom]));
    }
  }
  return output;
}

function weightedMedian(
  candidates: PdfTextBandCandidate[],
  value: (candidate: PdfTextBandCandidate) => number,
): number {
  const ordered = [...candidates].sort((left, right) => value(left) - value(right));
  const totalWeight = ordered.reduce((sum, candidate) => sum + candidate.weight, 0);
  const midpoint = totalWeight / 2;
  let accumulated = 0;
  for (const candidate of ordered) {
    accumulated += candidate.weight;
    if (accumulated >= midpoint) return value(candidate);
  }
  return value(ordered[ordered.length - 1]!);
}

function validPdfTextBandRects(value: unknown): PdfRect[] {
  if (!Array.isArray(value)) return [];
  return value.filter((rect): rect is PdfRect => (
    Array.isArray(rect)
    && rect.length === 4
    && rect.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate))
    && rect[2]! > rect[0]!
    && rect[3]! > rect[1]!
  )).map(rect => [...rect] as PdfRect);
}

function roundPdfTextBandRect(rect: PdfRect): PdfRect {
  return rect.map(value => Math.round(value * 1000) / 1000) as PdfRect;
}
