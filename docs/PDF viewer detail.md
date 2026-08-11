# Human Learning: PDF Viewer and Portable Annotations

> Current behavior of the combined desktop extension in VS Code and Cursor.
> For the full system, see
> [Architecture and VS Code Integration](architecture-and-vscode-integration.md).

## 1. Current boundary

The combined extension is the product. It reads PDF bytes through the VS Code
extension host and renders them locally with the bundled EmbedPDF/PDFium
webview. The renderer does not upload the document.

The reader supports local search, page and outline navigation, zoom and fit
modes, continuous or paginated navigation, one- or two-page layouts, and exact
text selection. PDF text and glyph geometry come from PDFium, so a selection
can survive zoom and layout changes without relying on stretched browser text.

The active PDF workflow is filesystem-first:

- the PDF stays unchanged;
- learning answers are readable Markdown;
- annotation geometry and viewer state are inspectable JSON;
- Git can diff, merge, and restore those files;
- the combined extension does not require SQLite, a CLI, or an MCP server.

## 2. What a PDF anchor is

An anchor is the durable description of the selected source passage. It is not
a screenshot, a search chunk, or a database row.

Each asked annotation records complementary selectors:

| Selector | Stored value | Purpose |
| --- | --- | --- |
| Exact quote | Selected text, with optional prefix and suffix | Lets any scanner recover and verify the original passage |
| Page | One-based PDF page | Gives a portable page-level fallback |
| Geometry | Every selection rectangle | Restores the precise visual highlight |
| Text position | Optional start/end text-item and character offsets | Qualifies the selection when PDFium exposes stable offsets |

Rectangles use `[left, top, right, bottom]` in PDF points (`pt`, 1/72 inch),
measured right and down from the page's top-left origin. A multi-line selection
has multiple rectangles. These are page coordinates, not viewport pixels, so
they do not change with zoom.

The portable JSON-LD mirror represents these as:

- a W3C `TextQuoteSelector`;
- an RFC 8118 `FragmentSelector` with `page=N`;
- a Human Learning `hl:PdfRectSelector`;
- an optional `hl:PdfTextItemSelector`.

The canonical extracted quote, page, and rectangles are deliberately
redundant. Consumers that do not understand the optional text offsets can
still locate the original text, and the current viewer can draw the original
highlight.

Learning notes use an ordinary repository-relative PDF link such as:

```markdown
[Open source](../../papers/paper.pdf#page=7)
```

The anchor keeps the canonical quote and geometry even when the visible link
uses only its portable page fragment.

## 3. Ask PDF flow

1. Select a passage on a PDF page.
2. Open **Ask about selection…** from the selection UI or context menu.
3. Enter a question in the floating Ask PDF inspector.
4. On the first submission, the webview automatically attempts a screenshot
   crop around the selection.
5. After first-use consent, the extension sends the source packet and question
   to the local Codex app-server and streams the answer.
6. A completed answer is written to the learning repository. Cancellation or
   failure never commits a partial assistant answer.

The source packet contains the canonical extracted quote, nearby text context,
page/link, anchor geometry, the question and prior turns, and the crop when
capture succeeded. Agent threads use a read-only sandbox with no approval
capability; the extension host performs the explicit repository writes.

The inspector belongs to the annotation. It can be moved, resized, minimized
to its numbered marker, reopened, and used for follow-up questions. Opening and
closing an empty inspector does not create an annotation; the first submitted
question does.

## 4. What is persisted

For a repository-managed PDF, the full PDF SHA-256 identifies its annotation
set. A newly asked annotation produces three records with distinct roles:

| Record | Path | Authority and runtime role |
| --- | --- | --- |
| Learning Markdown | `wiki/learning/*.md` | Human-readable authority for the canonical extracted quote, source link, summary, full Q&A, and review dates |
| v1 runtime sidecar | `.hl/annotations/pdf/<pdf-sha256>.json` | Current viewer state: anchor geometry, transcript, turn status, and inspector state |
| Portable JSON-LD mirror | `.hl/annotations/pdf/<pdf-sha256>/<annotation-id>.jsonld` | One annotation per file for migration, scanning, and interchange |

The current viewer still reads and updates the v1 sidecar. The JSON-LD mirror
is not yet its interactive read path; the core
`scanPortablePdfAnnotations()` API reads that mirror independently. The
Markdown note remains the authority for what the learner asked and what the
agent answered.

### Screenshot evidence

Every newly asked annotation attempts a PNG crop. This is automatic rather than
a per-annotation user choice.

The crop is the union of all selection rectangles plus 24 PDF points of
surrounding context on every side, clamped to the page. A successful capture is
stored at:

```text
.hl/annotations/pdf/assets/<annotation-id>/selection.png
```

Its metadata includes the crop rectangle, `padding: 24`, `unit: "pt"`, image
dimensions, and SHA-256. The crop is supporting visual evidence, not part of
anchor identity. If rendering or capture fails, the question continues with
text-only context and the quote/page/multi-rectangle anchor remains valid.

## 5. Reload and round trip

Reopening the same PDF loads the v1 sidecar, restores numbered markers and
precise highlights, and makes each saved transcript available in its Ask PDF
inspector. **Open learning note** opens the matching durable Markdown file.
Follow-up questions append to the same discussion and update the same learning
note.

The JSON-LD mirror preserves the same source identity for other tools and a
future viewer migration. The PNG remains linked evidence. None of these files
modifies or embeds data into the original PDF.

If the PDF bytes change, its SHA-256 changes and it receives a different
content-addressed annotation set instead of silently attaching old geometry to
a new document.

## 6. Local agent handoff

**Human Learning: Send Selection to Agent…** is a separate, lightweight path.
For the active Markdown or PDF selection it writes an immutable snapshot and
refreshes stable latest-export aliases:

```text
.hl/agent/exports/<id>/selection.md
.hl/agent/exports/<id>/selection.json
.hl/agent/selection.md                  # latest alias
.hl/agent/selection.json                # latest alias
```

The extension then attaches the immutable snapshot's `selection.md` to an
installed Codex, Claude, Cursor Agent, or CodeBuddy panel. The Markdown file
contains the canonical extracted passage and portable source anchor; the JSON
file preserves structured context. PDFium line-wrap hyphens may be normalized
out of that quote, while rectangle geometry and the crop preserve the visual
source. A later export can refresh the aliases without changing a file already
attached to a composer.

For a selected PDF passage, **Add to Chat** is available in the
right-click selection menu, floating selection toolbar, and editor title
toolbar. It routes through the same export instead of maintaining a separate
context format. The chosen supported agent receives:

- `.hl/agent/exports/<id>/selection.md`, containing the canonical extracted quote and
  portable page/text-fragment anchor;
- `.hl/agent/exports/<id>/selection.png`, when the best-effort crop is a valid,
  bounded PNG that can be saved and attached.

The structured `.hl/agent/selection.json` remains available as the latest
repository alias but is not attached. The optional latest crop alias is
`.hl/agent/selection.png`. If saving or attaching the crop fails, the extension
warns and continues with the Markdown attachment only. The extension updates
the chosen draft with the available attachments and never submits it. If no
supported provider is available, the export
is retained and an availability warning is shown.

This handoff does not submit the external provider's prompt, read its
transcript, or auto-persist its answer. Built-in Ask PDF is the supported path
for streamed multi-turn answers that automatically become learning notes.

## 7. Security and path constraints

- Webviews run under a restrictive content-security policy and send typed,
  validated messages to the extension host.
- Portable paths must be repository-relative. Absolute paths, URI schemes,
  `..` traversal, and malformed percent encoding are rejected.
- The portable scanner accepts only the content-addressed
  `.hl/annotations/pdf/<64-hex-sha256>/*.jsonld` layout and strictly validates
  selectors, source hashes, learning-note links, and canonical snapshot paths.
- Scanner and snapshot reads reject symbolic links, confine real paths to their
  storage root, use no-follow file opens where supported, and check that a file
  did not change while being opened.
- Snapshot bytes are bounded and verified as PNG data; stored hashes and pixel
  dimensions must match.
- A PDF outside the repository uses extension-controlled global runtime
  storage rather than writing beside an unrelated file. Portable JSON-LD
  mirrors are emitted only for repository-managed PDFs.
- Without an open folder, repository and agent features remain disabled; the
  Markdown and PDF viewers remain available without writing to the process
  working directory.
- The raw PDF is never modified, and read-only agent threads cannot silently
  edit the repository.

## 8. Verification

Run the current combined extension checks from the repository root:

```bash
pnpm --filter human-learning-vscode exec tsc --noEmit
pnpm --filter @human-learning/core test
pnpm --filter human-learning-vscode test
pnpm exec playwright test --config playwright.config.ts
```

The final desktop smoke test should be repeated in both VS Code and Cursor:

1. select a multi-line PDF passage and open Ask PDF;
2. after approving transmission, ask one question and wait for completion;
3. inspect the learning note, v1 sidecar, JSON-LD mirror, and PNG (or the
   documented text-only fallback);
4. reload the window and reopen the PDF;
5. verify the marker, exact highlight, transcript, learning-note link, and a
   follow-up question.
