# PDF Text Selection as Geometry, Ordering, and Carets

## Purpose

Normal PDF text selection is not rectangular marquee selection. A drag chooses
two character positions, then selects the interval between them in document
reading order. This distinction matters because PDF files usually contain
positioned glyphs and drawing commands, not explicit paragraphs or columns.

The viewer must therefore solve two coupled inference problems:

1. infer a stable reading order over extracted text runs; and
2. map each pointer location to the intended character in that order.

If either inference is wrong, a drag confined to one visual column can include
text from another column.

## Input model

For a page with coordinate domain `P`, PDFium provides an ordered collection of
text runs:

```text
R = (r_0, r_1, ..., r_n)
```

Each run has:

```text
r_i = (text_i, box_i, font_i, sourceRange_i, glyphs_i)
```

where `box_i = (left, top, right, bottom)` and each glyph has its own character
offset and hit rectangle. A run is an extraction unit produced by PDF drawing
and formatting structure. It may be a line, a styled fragment of a line, a
word, or an artifact. It is not reliably a sentence or paragraph.

The PDFium source order is evidence, but it is not authoritative reading order.
Multi-column PDFs may emit runs in column-major, row-major, or mixed order.

## Derived structures

### Visual line

A visual line groups glyphs whose vertical centers and heights indicate a
shared baseline. A line may contain multiple runs, such as regular and italic
fragments.

### Reading lane

A reading lane is an inferred sequence of runs that should normally be read
top-to-bottom before moving to a neighboring sequence. A lane often represents
a column, but it can also represent a caption, sidebar, footnote block, or
figure label.

Lane membership is geometric rather than semantic. A lane may contain several
paragraphs, and a paragraph may be split into several runs.

Compact aligned grids are an exception to lane-major reading. When two or more
adjacent rows contain several widely separated cells, or repeated inline font
transitions reveal fragmented cells, and their PDF source runs form one
contiguous block, the viewer preserves row-major source order. This covers
author matrices and numeric tables without treating ordinary prose columns or
interleaved figure labels as a table.

### Reading order

Let `lane(r)` be the inferred lane for run `r`. The viewer constructs a total
order `≺` over selectable characters by ordering:

1. vertically separated page regions;
2. lanes within an overlapping region; and
3. runs and glyphs within each lane.

For two neighboring columns, the desired lane-major order is:

```text
left_1 ≺ left_2 ≺ left_3 ≺ right_1 ≺ right_2 ≺ right_3
```

not the row-major order:

```text
left_1 ≺ right_1 ≺ left_2 ≺ right_2 ≺ left_3 ≺ right_3
```

## Carets and drag selection

A selection caret is:

```text
c = (page, runIndex, characterOffset)
```

The hit-test function maps a pointer point to a caret:

```text
H : (x, y, page glyph geometry) -> caret
```

For a drag start `p_a` and current pointer `p_f`:

```text
c_a = H(p_a)
c_f = H(p_f)
selection = [min_≺(c_a, c_f), max_≺(c_a, c_f)]
```

Interior text is determined by the reading-order interval. It is not determined
by whether glyph rectangles intersect the pointer path. Rectangle selection is
a different operation and is exposed separately by the viewer.

## Required invariants

### Endpoint locality

When two visual lines overlap vertically, hit testing must prefer the line with
glyphs horizontally closest to the pointer before using baseline-center distance
as a tie-breaker. Otherwise a pointer near the edge of the left column can jump
to a slightly closer baseline in the right column.

### Lane contiguity

Runs assigned to the same body column should occupy one contiguous interval in
`≺`. A neighboring column must not appear between two runs from that lane.

### Same-row separation

Two source-adjacent runs on the same visual row must not enter the same lane
when an established run in that lane is horizontally disjoint beyond the
inline-fragment tolerance. Bounded reverse-x continuations remain eligible,
and source-adjacent forward fragments with a distinct font style may remain in
the lane, but neither exception should override stronger aligned-lane evidence.

### Masthead non-bridging

Full-width titles, authors, and affiliations may overlap both column ranges.
They must not provide enough horizontal-support evidence to merge the body
columns into one page-wide lane.

### Styled-fragment continuity

Touching or near-touching fragments on one visual line should remain together.
Relaxed support for generators that emit styled fragments in reverse x order
may make a lane eligible, but it must not outrank a geometrically aligned,
multi-row lane.

### Stable total order

The same extracted geometry must produce the same reading order regardless of
zoom, device pixel ratio, or rendering scale. Ordering operates in PDF page
coordinates before DOM scaling.

### Preview-compatible semantic inclusion

Selection membership follows the caret interval in inferred reading order,
not font family, font size, or a semantic guess about body text. Consequently,
a cross-column interval may include a smaller footnote between its endpoints,
matching Apple Preview/PDFKit. That footnote also remains independently
selectable and copyable. Small caps, captions, equations, superscripts, and
subscripts are not filtered merely because their typography differs from the
first selected run.

### Segment-local highlight clipping

Selection painting starts with the selected text items and glyph endpoints.
A wholly selected item contributes its complete text-layer rectangle; a
partially selected first or last item contributes glyph-width horizontal
endpoints. Selected fragments on one visual line are unioned into horizontal
segments, including the full vertical coverage of baseline text and attached
scripts.

For a segment `s`, vertical clipping may consult only the nearest segment above
and below whose horizontal interval has positive overlap with `s`. The existing
0.5-PDF-point midpoint gap is applied against those neighbors. A disjoint
segment in another column must never reduce, shift, or collapse `s`, even when
the two columns have baselines staggered by a few points.

## Current heuristic

`normalizePdfTextRuns` converts PDFium runs and glyphs into selectable items.
`orderPdfTextItems` then:

1. estimates typical text height;
2. builds candidate lanes using left-edge and horizontal-coverage indexes;
3. scores lane membership from alignment, repeated supporting rows, and inline
   continuation evidence;
4. rejects horizontally disjoint same-row candidates;
5. preserves disjoint, vertically overlapping multi-row lanes;
6. splits isolated vertical regions and merges compatible adjacent fragments;
7. restores row-major order for compact, source-contiguous grid blocks;
8. emits lane-major order for the remaining regions; and
9. renders DOM spans in that order so browser ranges and copied text agree.

`hitTestSelectionGlyph` separately maps pointer coordinates to the nearest
glyph. It first minimizes vertical distance to a visual line. For equal vertical
distance, it minimizes horizontal glyph distance, then baseline-center distance.

`selectionRectsForState` constructs full text bands from the selected runs,
using complete item width for wholly selected items and glyph bounds for
partial endpoints. `normalizePdfTextBands` forms disjoint horizontal segments,
normalizes each segment independently, and clips it only against vertically
adjacent segments with positive horizontal overlap. Live painting, exported
anchor rectangles, portable `viewrect` links, and anchor flashing all consume
this normalized geometry.

## Failure analyzed in August 2026

The Sennrich, Haddow, and Birch subword-NMT paper exposed three interacting
failure modes:

1. a relaxed reverse-x inline-fragment match received a dominant score and
   could capture a run aligned with the other column;
2. several full-width masthead rows supplied repeated horizontal support for
   both body columns, creating one page-wide lane; and
3. endpoint hit testing broke equal-vertical-distance ties by baseline center
   before horizontal glyph distance, allowing a caret to jump columns.

The corrected behavior keeps relaxed reverse fragments eligible without making
them dominant, rejects disjoint same-row membership, and uses horizontal glyph
distance before baseline center when line boxes overlap.

The same paper exposed a separate painting defect: slightly staggered right-
column baselines were treated as the previous or next line for left-column
highlight bands. Global midpoint clipping made the blue overlay shorter or
vertically displaced even though native selection and copied text were correct.
Segment-local, horizontal-overlap-aware clipping preserves each column's full
text-layer height while retaining the non-overlap gap for genuinely adjacent
lines in the same column.

A follow-up regression showed why segmentation must happen during visual-band
formation rather than afterward. Several staggered cross-column rows could form
one transitive center cluster; once candidates were sorted horizontally, two
different rows from the same column collapsed into a single segment and one of
their overlays disappeared. Horizontal proximity is now required before a run
can join a band, so a disjoint column cannot bridge neighboring local rows.

A later regression appeared in the DPO paper's three-column author matrix. The
body-column rule treated each author column as a reading lane, so a selection
from the first author to the shared email skipped the middle and right authors.
The compact-grid restoration now preserves the PDF's contiguous row-major run
order for that masthead while leaving long prose columns lane-major.

The FP8 paper exposed a second compact-grid shape. Each numeric table row was
split into regular, italic-decimal, and bold runs whose boxes touch, so the
large-cell-gap test did not recognize the table. Lane inference consequently
moved the first two BERT value triplets after the GPT rows, outside a drag that
visually ended at the bottom of the table. Repeated adjacent font transitions
now count as compact-row evidence. Run count alone is insufficient, which
prevents a four-column prose region from being reclassified as a table.

## Regression criteria

Automated coverage protects two levels:

- extraction tests require lane-major order for alternating source runs,
  reverse-x transitions, forward styled fragments, large text, narrow gutters,
  captions, multi-row mastheads, and interleaved figure labels, while requiring
  row-major order for the raw fragmented DPO author-grid and FP8 numeric-table
  fixtures; and
- selection tests require pointer hit testing to stay in the horizontally
  nearby column when neighboring baselines overlap; and
- Playwright regressions perform real mouse drags over generated PDFs for the
  two-column prose, author-grid, fragmented numeric-table, formula, and Preview-
  compatible footnote cases, then assert both the viewer selection payload and
  `window.getSelection()` text.

Pure geometry regressions require staggered disjoint columns to retain their
own complete heights, tightly spaced overlapping lines to keep the configured
midpoint gap, and disjoint segments on one visual row to preserve independent
centers and heights. Browser regressions additionally verify partial glyph
endpoints, mixed bold/italic and small-cap fragments, scripts and arrows,
stacked equations, and full text-layer top/bottom alignment within one CSS
pixel at 100%, 144%, and 200% zoom.

The real two-column paper remains a manual smoke criterion: a drag through the
left Introduction column must produce a highlight and copied text containing no
right-column sentences. A generated two-column PDF now automates the same
selection invariant without depending on the external paper asset.

For the Sennrich page's exact body-to-right-column drag, Apple PDFKit includes
the three smaller footnote lines in the caret interval. The viewer must preserve
that copied-text behavior while keeping every blue band centered on, and at
the full height of, its own text-layer run except for the configured same-column
midpoint gap. A disjoint column must never shorten it. Starting and ending
inside the footnote must still select only the requested footnote range.

The DPO paper remains a manual smoke criterion: dragging from the first author
to the shared email must include all six authors before the email, rather than
only the left author column. A generated author matrix automates that pointer
drag and endpoint behavior.

The FP8 paper provides a table smoke criterion: dragging from the Inference
paragraph through Table 5 must keep each BERT and GPT value triplet beside its
row label, including `88.19 76.89 88.09` and `90.87 89.65 90.94`. A generated
multi-font table automates the same fragmented-cell selection path.

## Source locations

- Run normalization and lane inference:
  `packages/pdf-editor/src/webview/domain/pdfTextExtraction.ts`
- Caret comparison and visual-line construction:
  `packages/pdf-editor/src/webview/domain/pdfSelection.ts`
- Pointer hit testing, range painting, and selection extraction:
  `packages/pdf-editor/src/webview/pdf-viewer.ts`
- Shared selection-band normalization:
  `packages/pdf-editor/src/webview/pdfTextBands.ts`
- Extraction regressions:
  `packages/vscode-extension/test/pdfTextExtraction.test.mjs`
- Selection regressions:
  `packages/vscode-extension/test/pdfSelectionDomain.test.mjs`
- Selection-band geometry regressions:
  `packages/vscode-extension/test/pdfTextBands.test.mjs`
- Generated-PDF browser regressions:
  `packages/vscode-extension/test/e2e/pdf-preview-selection.spec.ts`
