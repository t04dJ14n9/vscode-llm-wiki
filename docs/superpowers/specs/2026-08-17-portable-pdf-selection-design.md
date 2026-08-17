# Portable PDF Selection Design

Date: 2026-08-17

## Status

Approved for implementation. The user approved context-sensitive text and
area selection, one agent-oriented copy action, portable PDF locators, and a
vault-local PDF skill backed by `pdfplumber`.

## Goal

Let a reader select either exact PDF text or an arbitrary page region and hand
that selection to an agent without persisting a screenshot. The handoff must
remain human-readable, traceable to the source PDF, reproducible across agent
providers, and correct across page boundaries.

## Interaction

The PDF viewer uses one context-sensitive selection gesture:

- A pointer over an actual selectable text glyph uses the text-selection
  cursor. A drag beginning there creates the existing character-accurate text
  selection and may cross page boundaries.
- A pointer elsewhere on a PDF page uses a crosshair cursor. A drag beginning
  there creates a rectangular area selection constrained to that page.
- The selection kind is fixed at pointer-down and never changes during a drag.
- Links keep their normal pointer and navigation behavior.
- Holding `Option` on macOS or `Alt` elsewhere forces area selection when an
  OCR text layer or ambiguous page content overlaps a desired visual region.
- `Escape` cancels the active drag or selection.

Text hit testing must use a bounded tolerance. The current behavior that snaps
any page point to the nearest glyph is removed; a point outside the tolerance
starts an area selection instead. This prevents a drag across a figure from
accidentally selecting the preceding footer and following caption.

After either selection kind, the floating actions contain only:

- **Add to Chat** when the host exposes the supported Cursor composer commands.
- **Copy for Agent** on all supported hosts.

The existing **Copy link** action is removed. **Copy for Agent** includes the
portable source link, so a separate link-only action is redundant.

## Portable Handoff

Every handoff is plain Markdown that remains useful without a skill. Text
selections include the exact normalized selected text; area selections include
a short statement that a PDF region was selected. Both include one portable
source link per selected page region.

Single-page text example:

```markdown
Source: [raw/assets/paper.pdf (page 2)](<raw/assets/paper.pdf#page=2&viewrect=108,158,396,72>)
PDF source SHA-256: `0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`

Selected text:
Figure 1: DPO optimizes for human preferences while avoiding reinforcement learning.
```

Single-page area example:

```markdown
Source: [raw/assets/paper.pdf (page 2 region)](<raw/assets/paper.pdf#page=2&viewrect=90,45,432,140>)
PDF source SHA-256: `0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`

Selected PDF region. Use the vault PDF skill to extract its text and inspect its visual content.
```

Cross-page text selections emit ordered source links for each page followed by
one combined raw passage. They are never represented as a stitched image.

The fragment parameters follow RFC 8118:

- `page` is one-based.
- `viewrect` is `left,top,width,height`.
- Coordinates use PDF default user-space points, 1/72 inch, measured from the
  upper-left of the current page.

The extension may retain its product-specific `cursor://` or `vscode://` open
URI for direct in-editor navigation, but the copied agent payload must contain
the relative RFC 8118 PDF link so a non-Cursor agent can resolve it.

## Selection Model

The provider-neutral selection value has these logical fields:

```text
version: 1
kind: text | area
source: workspace-relative PDF path
sourceHash: SHA-256 of the source PDF
targets[]:
  page: one-based page number
  viewRect: left, top, width, height in RFC 8118 PDF points
  rects: optional exact text rectangles in top-left PDF points
text: exact normalized selected text for text selections only
prefix: optional bounded text context
suffix: optional bounded text context
```

The copied Markdown is the public interchange format. The structured value is
used internally for validation, stable keys, host handoff, and tests; the
source hash is serialized as the human-readable `PDF source SHA-256` line so
the vault skill can detect source drift. Agents do not need a binary attachment
or a vault-persisted selection file.

For text selections, each page target's `viewRect` is the union of the exact
selected glyph rectangles on that page. The exact rectangles remain available
internally for host validation and stable keys. The copied raw text is the
authoritative quote; the vault skill extracts the union region and verifies
that quote within the normalized result instead of trusting broader neighboring
text from the crop. For area selections, `viewRect` is the user-drawn
rectangle.

## Vault-Local PDF Skill

New vaults contain a project-level Agent Skill at:

```text
.agents/skills/pdf/
├── SKILL.md
└── scripts/
    └── extract_selection.py
```

`.agents/skills/` follows the cross-client Agent Skills convention. The hidden
directory is reserved operational metadata and is excluded from OKF indexes,
source documents, link graphs, and content validation.

The vault does not vendor or fork `pdfplumber`. The helper script is a small
adapter that imports an installed `pdfplumber` and performs deterministic,
vault-specific work:

1. Parse one or more relative RFC 8118 PDF links from copied Markdown or
   explicit command arguments.
2. Resolve the source strictly within the vault root and reject symlink or
   traversal escapes.
3. Verify the optional source SHA-256 when a structured locator supplies it.
4. Validate page numbers and clamp no coordinates silently.
5. Convert each `viewrect` to `pdfplumber`'s `(x0, top, x1, bottom)` bounding
   box and extract page-local text.
6. Order cross-page results by page, vertical position, and horizontal
   position, then normalize and join them.
7. Compare extracted text with the copied raw text or text quote when present;
   report a mismatch instead of silently replacing either value.
8. When visual inspection is required, render each page region separately to
   an operating-system temporary directory through `pdfplumber` and its
   `pypdfium2` renderer.
9. Print machine-readable JSON containing extracted text, verification status,
   and temporary image paths.
10. Require the agent to inspect any temporary images and delete them before
    completing the task.

The skill first uses an environment where `pdfplumber` is already installed.
If it is unavailable, it reports an actionable `uv` or Python installation
command. It does not silently mutate the vault or install packages.

## Host Data Flow

### Copy for Agent

1. The viewer finalizes a text or area selection.
2. The extension host validates the source, page targets, coordinates, text,
   and source hash.
3. The host formats the portable Markdown payload.
4. The host writes only that Markdown to the system clipboard.
5. No PNG, selection export directory, or clipboard-cache file is created.

### Add to Chat

1. The viewer and host build the same validated portable Markdown payload.
2. Cursor receives the raw Markdown in the active composer with the source PDF
   URI as its identity.
3. No file attachment or message submission occurs.
4. Other hosts continue to hide the action when equivalent composer commands
   are unavailable.

## Error Handling

- A text drag with no glyph inside the hit tolerance becomes an area drag; it
  must not snap to distant text.
- An area smaller than four CSS pixels in either dimension is discarded.
- A page or rectangle outside the source page is rejected before handoff.
- A missing, changed, or hash-mismatched PDF produces a clear extraction error.
- Missing `pdfplumber` produces dependency instructions without changing the
  vault.
- A text verification mismatch returns both the copied raw text and extracted
  text with a warning.
- Temporary render failures do not discard successfully extracted text.
- Cleanup failures are reported with the remaining temporary path.

## Compatibility and Migration

- Existing character, word, line, reverse, cross-page, zoom-restored, and
  autoscrolling text selections remain supported.
- Existing portable text-fragment navigation remains supported.
- The rectangle toolbar control that immediately copied PDF++ coordinates is
  removed from the primary workflow; automatic area selection supersedes it.
- PDF++ coordinate-link generation may remain as an internal formatter only if
  an existing non-agent consumer still requires it; it is not shown as a
  selection action.
- Existing cached `.llm_wiki/agent/clipboard/pdf-selection-*.png` files are not
  deleted automatically. New selections stop creating them, and normal cache
  cleanup may remove them later.
- New-vault scaffolding installs the PDF skill. Existing vaults gain it through
  an explicit setup or upgrade operation so user-owned hidden configuration is
  never overwritten silently.

## Testing

Focused unit tests cover:

- Text hit tolerance versus distant-glyph snapping.
- Automatic selection-kind choice and `Alt`/`Option` override.
- RFC 8118 link formatting and parsing.
- Single-page and cross-page payload ordering.
- Text and area locator validation.
- Removal of PNG persistence and attachment paths.
- Vault-relative path confinement and hash mismatch handling.
- `pdfplumber` extraction, text verification, temporary rendering, and cleanup.
- Default-vault skill scaffolding and preservation of existing user skills.

Browser tests cover:

- An ordinary text drag retains the I-beam workflow and exact selected text.
- A drag beginning on the DPO-style figure area uses the crosshair workflow,
  selects the complete rectangle, and never highlights neighboring text.
- Cross-page text selection copies ordered page links and correct raw text.
- Both selection kinds expose only **Add to Chat** and **Copy for Agent** where
  Cursor capabilities are present, and only **Copy for Agent** otherwise.

Repository verification includes focused tests, the extension test suite,
lint, typecheck, build, and diff hygiene.

## Non-Goals

- Automatic semantic figure, table, or equation detection.
- OCR of scanned PDFs without an existing text layer.
- Multi-page area rectangles or stitched screenshots.
- Persisting rendered selection images in the vault.
- Vendoring, patching, or forking `pdfplumber` or `pypdfium2`.
