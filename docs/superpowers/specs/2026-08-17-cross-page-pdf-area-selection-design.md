# Cross-Page PDF Area Selection Design

## Goal

Allow one PDF area-selection gesture to cross page boundaries without adding a separate cursor mode. Preserve the existing automatic text-versus-area intent, `Alt` force-area override, portable `viewrect` links, and screenshot-free agent handoff.

## Root Cause

The current drag stores its start and current points in the coordinate system of the starting page wrapper. Pointer movement is clamped to that wrapper, the committed selection is one `{ page, rect }`, and area payload validation requires `startPage === endPage`. The restriction is therefore structural rather than a PDF extraction limitation.

## Considered Approaches

### 1. Page-intersection marquee with additive regions — selected

Store the drag endpoints in `#page-container` document coordinates. Intersect the resulting marquee with every rendered page wrapper and convert each non-empty intersection to that page's PDF coordinates. `Shift` preserves existing area regions and adds the new intersections.

This works for vertical continuous pages, horizontal layouts, wrapped pages, and two-page spreads because it uses actual wrapper geometry. It also maps directly to the existing ordered `pages[]` clipboard schema.

### 2. Sequential page-only selections

Keep every drag page-local and require `Shift`-drag on each additional page. This is simpler but does not satisfy direct cross-boundary dragging and is tedious for adjacent pages.

### 3. Synthetic concatenated PDF surface

Map every page into a virtual strip and drag in that coordinate system. This adds layout-specific transformations and duplicates information already available from DOM page bounds.

## Interaction

- Pointer intent remains automatic: near a glyph selects text; elsewhere selects an area.
- `Alt` at pointer-down forces area selection and locks that intent for the gesture.
- A normal area drag replaces the previous text or area selection.
- `Shift` at pointer-down adds the new page intersections to the current area selection. Regions on the same page are retained as separate rectangles unless they overlap or touch, in which case they are unioned.
- Dragging near the scroll viewport edge auto-scrolls and recomputes intersections from the latest pointer position.
- `Escape` cancels an active drag; after commit it clears the complete area selection.
- Cross-page area dragging is naturally available whenever multiple page wrappers are laid out in one scroll surface. In paginated mode, `Shift`-drag after navigating adds a region on another page.

## Geometry and State

`PdfAreaDrag` records the pointer id, container-space origin/current points, pointer client position, and temporary overlays. A pure geometry function receives the marquee and page bounds and returns ordered page-local CSS rectangles.

Committed state becomes:

```ts
interface PdfAreaSelection {
  pages: Array<{
    page: number;
    rects: PdfRect[];
  }>;
}
```

Page order is ascending. Rectangle coordinates remain `[left, top, right, bottom]` in PDF points, rounded to three decimals. Empty intersections and rectangles smaller than four CSS pixels in both dimensions are discarded.

Temporary drag overlays are drawn per intersected page. Committed overlays continue to live in each page's highlight layer so rerender and zoom restoration use the same canonical PDF geometry.

## Agent Payload

Area clipboard selections use the existing discriminated shape with `kind: "area"`, but may span multiple pages:

```ts
{
  kind: "area",
  startPage: 2,
  endPage: 3,
  pages: [
    { page: 2, rects: [[...]] },
    { page: 3, rects: [[...]] }
  ]
}
```

Formatting emits ordered `Sources:` links, one per selected page, with a union `viewrect` for that page. The PDF source SHA-256 appears once. The vault-local PDF skill already accepts multiple ordered `--link` arguments, so it requires no interface change.

The active selection context uses the first selected page as its editor anchor and carries the complete preformatted agent text. Cursor receives `Add to Chat`; stock VS Code exposes only `Copy for Agent`, matching existing behavior.

## Error Handling

- Pages without rendered geometry are skipped during a live drag and included once rendered and intersected on a subsequent update.
- A gesture with no valid page intersections leaves the prior selection unchanged for `Shift`-add and clears it for a replacing drag.
- Mixed text and area state is never committed: starting text clears area state, and starting a replacing area drag clears text state.
- Multi-page area validation rejects duplicate pages, unordered pages, invalid rectangles, and inconsistent start/end page values.

## Testing

- Pure geometry tests cover forward and reverse cross-page marquees, page gaps, horizontal/two-page layouts, clipping, ordering, and rectangle union.
- Payload tests cover multi-page area normalization and ordered portable source links.
- Browser tests drag from page 1 into page 2 with auto-scroll, verify one overlay on each page, and assert a two-page `selectionChanged` payload.
- Browser tests navigate in paginated mode and use `Shift`-drag to add a second page.
- Existing text-selection, single-page area, `Alt` override, reduced-action, zoom/rerender, and screenshot-free handoff tests remain green.
