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

interface PdfTextBandSegment {
  candidates: PdfTextBandCandidate[];
  left: number;
  right: number;
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
 * line centers prevents those runs from becoming nested sub-boxes. Each
 * disjoint horizontal segment is normalized independently. Midpoints with
 * the nearest horizontally overlapping segments then cap its vertical extent,
 * so tightly-spaced lines cannot overlap and a staggered neighboring column
 * cannot shrink or shift the band.
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

  const segments: PdfTextBandSegment[] = [];
  for (const candidate of candidates) {
    let match: PdfTextBandSegment | undefined;
    let matchDistance = Number.POSITIVE_INFINITY;
    let matchGap = Number.POSITIVE_INFINITY;
    for (const segment of segments) {
      const distance = Math.abs(candidate.center - segment.center);
      const tolerance = Math.max(
        0.75,
        Math.min(candidate.height, segment.height) * PDF_TEXT_BAND_CENTER_TOLERANCE,
      );
      const horizontalGap = candidate.left > segment.right
        ? candidate.left - segment.right
        : segment.left > candidate.right
          ? segment.left - candidate.right
          : 0;
      const mergeThreshold = Math.max(4, segment.height * 1.2);
      if (
        distance <= tolerance
        && horizontalGap <= mergeThreshold
        && (distance < matchDistance || (distance === matchDistance && horizontalGap < matchGap))
      ) {
        match = segment;
        matchDistance = distance;
        matchGap = horizontalGap;
      }
    }
    if (!match) {
      segments.push({
        candidates: [candidate],
        left: candidate.left,
        right: candidate.right,
        center: candidate.center,
        height: candidate.height,
      });
      continue;
    }
    match.candidates.push(candidate);
    match.left = Math.min(match.left, candidate.left);
    match.right = Math.max(match.right, candidate.right);
    match.center = weightedMedian(match.candidates, entry => entry.center);
    match.height = weightedMedian(match.candidates, entry => entry.height);
  }

  segments.sort((left, right) => (
    left.center - right.center || left.left - right.left || left.right - right.right
  ));

  const output: PdfRect[] = [];
  for (const segment of segments) {
    const previous = nearestOverlappingPdfTextBandSegment(segments, segment, -1);
    const next = nearestOverlappingPdfTextBandSegment(segments, segment, 1);
    const halfGap = PDF_TEXT_BAND_MIN_GAP / 2;
    let top = segment.center - segment.height / 2;
    let bottom = segment.center + segment.height / 2;
    if (previous) top = Math.max(top, (previous.center + segment.center) / 2 + halfGap);
    if (next) bottom = Math.min(bottom, (segment.center + next.center) / 2 - halfGap);
    if (bottom <= top) {
      top = segment.center - 0.125;
      bottom = segment.center + 0.125;
    }
    output.push(roundPdfTextBandRect([segment.left, top, segment.right, bottom]));
  }
  return output;
}

function nearestOverlappingPdfTextBandSegment(
  segments: PdfTextBandSegment[],
  target: PdfTextBandSegment,
  direction: -1 | 1,
): PdfTextBandSegment | undefined {
  let nearest: PdfTextBandSegment | undefined;
  for (const candidate of segments) {
    if (candidate === target) continue;
    const centerDelta = candidate.center - target.center;
    if ((direction < 0 && centerDelta >= 0) || (direction > 0 && centerDelta <= 0)) continue;
    const horizontalOverlap = Math.min(candidate.right, target.right)
      - Math.max(candidate.left, target.left);
    if (horizontalOverlap <= 0) continue;
    if (!nearest || Math.abs(centerDelta) < Math.abs(nearest.center - target.center)) {
      nearest = candidate;
    }
  }
  return nearest;
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
