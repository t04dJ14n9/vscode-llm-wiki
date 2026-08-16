# Inferred PDF Outline and Dockable Toolbar Design

Date: 2026-08-16

## Status

Approved in conversation. This written specification is awaiting the required
user review before implementation planning begins.

## Goal

Improve PDF navigation in two independent ways:

1. When a PDF contains no embedded bookmark tree, derive a conservative,
   explicitly labelled, nested outline from its extractable text and layout.
2. Let readers dock the PDF toolbar horizontally at the top or vertically at
   the left, hide it, and restore it without losing access to navigation.

Embedded bookmarks remain authoritative. The fallback must prefer an incomplete
outline over a misleading one, and toolbar customization must never cover the
document or make its controls unreachable.

## Scope Decomposition

The inferred outline and dockable toolbar are separate product units. They share
the PDF viewer but have independent state, algorithms, failure modes, and
acceptance tests. Implementation planning therefore uses two plans:

- inferred PDF outline;
- dockable and hideable PDF toolbar.

Either feature can ship or be reverted without disabling the other.

## Inferred PDF Outline

### Activation and precedence

The viewer first requests the bookmark tree already embedded in the PDF.

- A non-empty valid bookmark tree is rendered unchanged and sent to the
  extension host. No inference runs.
- An empty bookmark tree starts local inference in the background.
- A bookmark-loading error may use the same fallback, because it has no
  authoritative entries to replace.
- If inference returns too little high-confidence structure, the viewer keeps
  the existing empty state rather than showing speculative entries.

The internal PDF sidebar and the Explorer **PDF Outline** view use the same
result. An inferred result is visibly labelled **Inferred outline** in both
surfaces. Embedded outlines are not labelled inferred.

### Input data

Inference reuses the existing PDF text extraction pipeline. Each normalized run
provides:

- text content;
- zero-based page index;
- bounding rectangle;
- source order;
- font family;
- font size;
- numeric font weight when available;
- italic state.

Inference does not inspect rendered pixels, call an external model, access the
network, or modify the PDF. Image-only pages without an extractable text layer
do not receive inferred entries. OCR is outside this design.

### Line reconstruction

Text runs are grouped into visual lines using their baseline, vertical overlap,
horizontal order, and compatible typography. Fragmented section numbers and
titles on the same baseline are joined, so runs such as `4` and `Evaluation`
become one candidate line.

Line reconstruction must preserve multi-column reading order and the existing
selection/search ordering behavior. The inference module consumes normalized
runs but does not change `orderPdfTextItems` or the selectable text layer.

Each reconstructed line retains its page, union rectangle, constituent font
styles, and normalized text.

### Document profile

The detector learns the document's ordinary body style rather than relying on
absolute font sizes. It computes:

- a character-weighted median body font size;
- common font families and weights;
- recurring font-size and weight combinations;
- typical line height and paragraph spacing;
- repeated text near consistent top and bottom page bands.

Repeated top/bottom-band text is classified as a likely running header or
footer. Page numbers are classified separately. The title page may contribute
to the profile, but unusually large title and author typography does not define
the body baseline.

### Candidate evidence

The detector combines independent signals. No single unnumbered signal is
enough.

Strong positive signals are:

- a section-number prefix such as `2`, `2.1`, or `2.1.1` followed by title
  text;
- font size materially larger than the learned body size;
- bold or otherwise consistently distinct weight;
- additional vertical whitespace above or below the line;
- a short, title-like grammatical shape;
- recurrence of the same visual heading style on other pages;
- a conventional section label such as `Abstract`, `Introduction`,
  `Conclusion`, or `References`, used only as a confidence boost.

Numbered headings receive the strongest structural evidence. Roman-numeral and
appendix forms are accepted only when their typography and neighboring
headings establish a consistent sequence.

### Conservative rejection

Candidates are rejected when they resemble:

- repeated headers or footers;
- page numbers;
- document titles, authors, affiliations, email addresses, or dates;
- figure, table, listing, or algorithm captions;
- equations, code lines, bullets, or list items;
- individual bibliography entries;
- long prose sentences;
- isolated large text whose style does not recur and whose numbering does not
  establish section structure.

The detector emits an unnumbered heading only when several independent
typographic and spacing signals agree. A document with only weak candidates
continues to show `(no PDF outline)`.

### Confidence policy

The inference API returns only accepted entries, not low-confidence suggestions.
Its scoring weights and threshold are deterministic and covered by fixtures.
The conservative policy has these observable consequences:

- obvious numbered sections are retained even when their size is close to body
  text, provided their weight or spacing supports them;
- unnumbered sections require recurring typography plus whitespace or another
  independent signal;
- ambiguous hierarchy is flattened rather than guessed;
- a few false negatives are acceptable; false positive navigation entries are
  not.

### Nesting

Numbering determines hierarchy first:

- `2` is a root;
- `2.1` is a child of the nearest preceding `2`;
- `2.1.1` is a child of the nearest preceding `2.1`.

Typography tiers determine hierarchy only for high-confidence unnumbered
headings. Tiers are derived from recurring size/weight styles, not from a
one-off line. When a tier cannot be mapped unambiguously, the entry becomes a
sibling at the shallowest defensible level.

Malformed jumps such as `2` directly to `2.1.1` never create invisible parents.
The child attaches to the nearest compatible visible ancestor or is flattened.
Existing outline depth, title-length, cycle, and entry-count bounds apply to
inferred entries.

### Destinations and navigation

Every inferred entry has an internal destination containing the heading's page
index and vertical coordinate. Activating it navigates to the page and positions
the heading near the top of the viewport while preserving the current zoom
unless the existing destination API requires an explicit compatible mode.

The same bounded outline payload is posted to the extension host, so the
Explorer **PDF Outline** view navigates to the identical destination.

### Loading, cancellation, and caching

Inference runs after the embedded outline request reports no entries. Page text
is extracted with bounded concurrency without rendering every page. The
operation is cancellable when the document closes or is replaced.

While inference is active, the outline surface reports that an inferred outline
is being prepared. Partial candidate trees are not displayed. The completed
result is cached for the loaded document fingerprint and reused by both outline
surfaces. The cache is invalidated when the PDF bytes change.

Extraction or inference failure is non-fatal: the document remains readable and
the outline returns to its empty state.

## Dockable PDF Toolbar

### Layout states

The toolbar has exactly two visible dock states:

- `top`: horizontal, occupying a row above the PDF viewport;
- `left`: vertical, occupying a column to the left of the PDF viewport.

There is no free-floating state. Both dock positions participate in layout and
must not cover the PDF page, text layer, selection toolbar, internal sidebar,
or Ask PDF surfaces.

The internal PDF sidebar remains adjacent to the document area. When the
toolbar is docked left, the toolbar column is outermost and the sidebar/content
layout shifts to the right.

### Drag interaction

A dedicated grip is the only drag initiator. Dragging buttons, number inputs,
menus, or blank group spacing does not move the toolbar.

During a drag:

- pointer capture keeps the gesture active outside the grip;
- top and left docking regions show a clear preview;
- releasing over a valid region commits that position;
- releasing elsewhere restores the previous position;
- `Escape` cancels the drag;
- ordinary page scrolling, text selection, and toolbar actions are suppressed
  only for the active drag gesture.

Dragging the current dock toward its own region is a no-op. Touch, pen, and
mouse pointer events use the same state machine.

### Orientation

The top toolbar retains its current grouped horizontal layout.

The left toolbar arranges the same controls vertically in logical groups:

- sidebar and search;
- zoom out, zoom value, zoom in, and display options;
- previous page, page value, and next page;
- remaining document actions.

Inputs remain readable and operable. Menus open into available viewport space,
not outside the window. Control labels, tooltips, focus rings, and accessible
names remain identical across orientations.

### Non-drag controls

The existing display menu adds:

- **Move toolbar to top**;
- **Move toolbar to left**;
- **Hide toolbar**.

The item for the active position is disabled or checked. These actions provide
keyboard and assistive-technology parity with dragging.

### Hidden state and restoration

Hiding removes the toolbar from layout but does not change zoom, page, sidebar,
search, selection, or document history state.

The extension contributes **LLM Wiki: Toggle PDF Toolbar**. `Shift+T` invokes
the same behavior when the PDF viewer has focus, except while focus is inside an
input, textarea, select, or content-editable control.

- From visible, toggle hides the toolbar.
- From hidden, toggle restores the last visible dock position.
- If no prior position exists, restore to `top`.

The command remains available from the Command Palette while the custom PDF
editor is active, so the toolbar can always be recovered.

### Persistence

Persist two values across PDFs and application restarts:

- last visible dock position: `top` or `left`;
- hidden state: `true` or `false`.

The state is user-level for this extension, not stored in the PDF or workspace
files. Invalid or missing persisted values fall back to visible `top`.

Opening another PDF immediately uses the persisted state. Multiple open PDF
webviews receive updates when the command or a drag changes the preference, so
their next activation does not disagree with the active document.

### Failure handling

Persistence failure does not block interaction; the current webview applies the
requested state for its lifetime. Malformed host messages are ignored and leave
the last valid layout intact.

If the toolbar is hidden and the webview shortcut cannot receive focus, the
Command Palette action remains the recovery path.

## Security and Performance

- Outline inference is local and deterministic.
- No PDF text, metadata, or inferred structure leaves the extension.
- Existing message-boundary validation and outline size limits remain in
  force.
- Page extraction uses bounded concurrency and cancellation.
- Toolbar messages accept only the enumerated dock positions and boolean hidden
  value.
- Neither feature writes into the vault or changes PDF bytes.

## Testing

### Inferred outline

- Reconstruct fragmented numbered headings.
- Detect nested `2`, `2.1`, and `2.1.1` structures.
- Detect high-confidence recurring unnumbered headings.
- Reject headers, footers, page numbers, titles, authors, captions, bullets,
  equations, and bibliography entries.
- Flatten ambiguous or malformed hierarchy.
- Preserve embedded-outline precedence and skip inference.
- Produce exact page-and-coordinate destinations.
- Bound title length, depth, and entry count.
- Cancel cleanly when a document closes or changes.
- Fail closed for image-only, empty-text, and low-confidence documents.
- Exercise the affected real PDF without embedded bookmarks and at least one
  PDF with embedded bookmarks.

### Toolbar

- Render equivalent controls in top and left orientations.
- Commit only valid grip drags and cancel invalid or escaped drags.
- Keep PDF, sidebar, selection, and Ask PDF content unobscured.
- Move the toolbar through the display menu without dragging.
- Persist position and hidden state across webview recreation.
- Restore the last position through `Shift+T` and the Command Palette.
- Ignore `Shift+T` in editable controls.
- Synchronize a changed preference to other open PDF webviews.
- Preserve zoom, page, search, sidebar, selection, and history state when
  docking or hiding.
- Validate keyboard order, accessible names, focus visibility, and menus in both
  orientations.

### Regression verification

- Existing PDF bookmark navigation remains unchanged.
- Existing text extraction, graph selection, search, links, previews, Copy for
  Agent, Add to Chat, annotations, and Ask PDF tests remain green.
- Extension build, lint, typecheck, unit tests, and relevant browser tests pass.

## Acceptance Criteria

- A text-layer PDF with no embedded bookmarks can display a conservative,
  nested **Inferred outline** whose entries navigate to the correct headings.
- A PDF with embedded bookmarks displays only its authored outline.
- Weak or image-only documents do not receive fabricated outline entries.
- The toolbar docks only at the top or left and never overlays document
  content.
- Readers can hide it and recover it with `Shift+T` or **LLM Wiki: Toggle PDF
  Toolbar**.
- Dock position and hidden state persist across PDFs and restarts.
- All behavior is local, bounded, cross-platform, and does not modify vault
  content.
