# Portable PDF Text Fragments Design

## Goal

PDF links must work from a standalone Markdown file and a standalone PDF editor without a Human Learning database. A link identifies a PDF selection with the Chrome/WICG text-fragment syntax plus an explicit PDF page:

```text
raw/pdf/paper.pdf#page=7:~:text=prefix-,selected%20text,-suffix
```

The current `anchor=anc_pdf_*` and `chunk=chk_pdf_*` URL parameters are removed from the PDF-link contract. This is a clean pre-release cutover; no compatibility resolver or migration path is required.

## URL Contract

Core exposes a `PdfTextFragment` value with `textStart`, optional `textEnd`, optional `prefix`, and optional `suffix`. `pdfHref` serializes that value using the WICG grammar:

```text
text=[prefix-,]textStart[,textEnd][,-suffix]
```

Each text term is percent encoded independently, including the grammar characters `-`, `,`, and `&`. `classifyReferenceTarget` parses the page portion before `:~:` and the first valid `text=` directive after it. Malformed directives are ignored while the file and page remain usable.

New selection links use the complete normalized selected text as `textStart`, with short page-local prefix and suffix context when available. The parser accepts `textEnd` so links copied by Chrome can also be opened.

## Editor Data Flow

1. The PDF webview converts a native single-page selection into renderer coordinates, normalized text, and short prefix/suffix context derived from the page text index.
2. Copy-link, quote-link, insert-link, and agent-context actions call `pdfHref` directly. They do not open the database, create an anchor row, or create `.hl`.
3. The URI dispatcher passes `{ pdfPath, page, textFragment }` to the `human-learning.openPdfTarget` command.
4. The provider opens the PDF and posts `{ page, textFragment }` to the webview.
5. The webview searches only the requested page, applies prefix/suffix disambiguation, scrolls to the match, and flashes the matched text. If matching fails, it still opens the requested page.

The combined extension, standalone PDF extension, and standalone Markdown extension share the same command argument shape.

The standalone PDF extension activates even when no `.hl` directory exists, using the open workspace as its file root. In that mode it skips annotation/highlight database reads during load and view changes. The standalone Markdown dispatcher can still route a relative PDF text-fragment link to the PDF extension (or the default PDF editor when the PDF command is unavailable).

## Persisted Highlights

Direct highlight remains an annotation feature and may persist an internal anchor record in `.hl`. Its row ID is internal database identity only. The row's `uri` uses the same portable page-plus-text-fragment URL; it never exposes the row ID in a Markdown link. Prefix and suffix are stored with the locator when supplied so annotation metadata and portable links describe the same selection.

When the standalone PDF extension has no initialized vault, explicit highlight creation reports that annotations require a vault; it does not create `.hl` implicitly.

Rectangle embeds and page-only links keep their existing PDF++-compatible formats because they do not depend on `.hl`.

## Matching Rules

- Scope matching to the explicit page when present.
- Collapse whitespace and compare case-insensitively, while preserving diacritics.
- Match `textStart` exactly in normalized page text.
- If `textEnd` exists and no suffix is present, extend through the first matching
  end term after the start. With a suffix, continue through later end-term
  candidates until the first end-plus-adjacent-suffix pair matches, as required
  by the WICG range-finding algorithm.
- If prefix or suffix exists, require normalized adjacent context to end or begin with that term.
- Convert the matched normalized index range back to PDF text-item segments and render the same transient highlight used by current anchor navigation.
- If no candidate satisfies the selector, navigate to the page without a text highlight.

## Scope and Non-goals

- No legacy `anchor=` or `chunk=` PDF navigation.
- No `openPdfAtAnchor` command or method alias; internal navigation is renamed to `openPdfTarget`/`openPdfAtTarget`.
- No `.hl` requirement for link generation or navigation.
- No automatic repair of a selector after PDF text changes.
- No implementation of Chrome's link-generation heuristics; the link grammar and navigation semantics are compatible, while Human Learning emits the full selected text.
- No change to rectangular PDF++ embeds or page-only links.

## Verification

- Core unit tests cover serialization, parsing, reserved characters, Chrome range selectors, malformed selectors, and the removal of anchor/chunk fields.
- Provider tests prove selection context and copied links are portable and database-free, while direct highlight still persists.
- Dispatcher tests prove the text-fragment payload reaches the PDF command and the default-editor fallback still works.
- Browser tests prove selection context is emitted and page-scoped text-fragment navigation highlights the intended text, with page-only fallback on a miss.
- Build and type-check both the combined and standalone packages.
