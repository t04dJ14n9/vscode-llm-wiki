# Copy Selection for Agent Design

Date: 2026-08-15

## Status

Approved for implementation.

This design supersedes provider-specific Codex and Claude handoff for Markdown
and PDF selections. The unmerged `codex/claude-sidebar-only-handoff` branch is
historical implementation evidence and must not be merged as the final product
behavior.

## Goal

Copy agent-ready selection context without opening, focusing, or submitting to
Codex, Claude Code, or another provider. Markdown selections become portable
file-and-line mentions. PDF selections become one rich clipboard item that
contains a cropped PNG, selected text, and an exact clickable source link.

The action must not create `selection.md`, `selection.json`, `selection.png`,
anchor bridge files, or temporary editor tabs.

## Product Behavior

### Cursor

Selection surfaces expose two independent actions:

- **Add to Chat** keeps the existing direct Cursor handoff and `Cmd/Ctrl+L`
  shortcut.
- **Copy for Agent** writes provider-neutral context to the system clipboard.

### Stock VS Code

Selection surfaces expose only **Copy for Agent**. Provider discovery, the
provider picker, and explicit **Send to Codex**, **Send to Claude Code**, and
**Send to CodeBuddy** actions are not shown.

### Shared behavior

Copying never opens or focuses a chat, creates a conversation, or submits a
message. A successful action reports:

> Selection copied for agent.

## Command and UI Contract

Add a public command:

```text
llm-wiki.copySelectionForAgent
```

Expose it in the Markdown and PDF editor title actions, native Markdown editor
context menu, custom Markdown selection toolbar, and PDF selection toolbar and
context menu.

The existing `llm-wiki.addSelectionToChat` command and its Cursor-only
visibility remain unchanged. The old selection-to-provider command
contributions and provider-specific selection controls are removed from
Markdown and PDF surfaces. Legacy export helpers may remain for unrelated
durable-export or browser workflows, but **Copy for Agent** must not call them.

## Markdown Clipboard Contract

For a saved Markdown selection, copy exactly one plain-text reference with no
trailing space:

```text
@projects/nanochat.md#66
```

For a multi-line selection:

```text
@projects/nanochat.md#66-72
```

Paths are workspace-relative POSIX paths. Line numbers are one-based and
inclusive.

If the note is dirty, save it and recapture the selection before formatting the
reference so the copied range matches the file on disk. If save or recapture
fails, leave the clipboard unchanged and show an actionable warning. Untitled
Markdown must be saved before copying. An empty selection does nothing except
show the existing select-text warning.

Markdown copying uses `vscode.env.clipboard.writeText`; it does not reveal a
native editor or invoke an agent extension.

## PDF Clipboard Contract

### Plain text

The `text/plain` representation is Markdown-friendly:

```text
Source: [raw/assets/paper.pdf (page 3)](<cursor-or-vscode-open-anchor-uri>)

Selected text:
Exact selected text…
```

For a cross-page selection, the label is `pages N–M`. The host URI uses the
active product scheme and opens the first selected page. The selected text
still covers the complete range.

### HTML

The `text/html` representation contains:

- a linked source label;
- the selected text;
- the same cropped PNG as an inline image.

All text and attribute values are escaped. No script, style, or untrusted raw
HTML is copied.

### PNG

The `image/png` representation contains the selected PDF region with the
existing white background, padding, and selection outlines.

For a multi-page selection:

1. Collect the selected rectangles for every page from the canonical PDF
   caret range.
2. Crop the selected region from each page canvas.
3. Stitch the page crops vertically in page order with a small white gutter.
4. Downscale the combined canvas as needed to respect the existing crop edge
   and 5 MiB PNG limits.

The clipboard receives one `ClipboardItem` with `image/png`, `text/plain`, and
`text/html`. A single paste therefore gives supporting chat surfaces access to
both the image attachment and textual context.

## PDF Data Flow

The final rich clipboard write must occur inside the PDF webview's user click
handler so Chromium retains clipboard permission.

1. A PDF selection change sends its canonical anchor to the extension host.
2. The host validates the anchor and precomputes the source label, selected
   text, exact product deep link, and a stable selection key.
3. The host posts that clipboard context back to the originating webview.
4. The PDF selection UI enables **Copy for Agent** only when the cached context
   key matches the current selection key.
5. On click, the webview crops the current single- or multi-page selection and
   calls `navigator.clipboard.write()` with the rich `ClipboardItem`.
6. The webview reports success or a typed failure to the host for user
   notification.

No click-time host round trip is required before `navigator.clipboard.write()`.
This prevents loss of transient user activation and prevents stale context from
being paired with a newer crop.

## Multi-Page Selection Model

The current PDF reader can represent a cross-page caret range but marks it only
as `multiPage` and deliberately rejects it in the host anchor normalizer. Extend
the clipboard-only selection shape with:

- `startPage`;
- `endPage`;
- selected rectangles grouped by page;
- complete normalized selected text;
- a stable key covering the page range, text, and geometry.

Portable annotations and Ask PDF remain single-page unless separately changed.
The richer cross-page shape is accepted only by the clipboard pipeline, so this
feature does not silently broaden persistence schemas.

## Failure Handling

- No or empty selection: leave the clipboard unchanged and prompt the user to
  select text.
- Dirty or untitled Markdown that cannot be saved: leave the clipboard
  unchanged and explain that the note must be saved.
- Stale PDF context key: do not copy; wait for the matching host context or ask
  the user to retry.
- Crop generation or rich Clipboard API failure: copy the validated plain text
  through the host clipboard API and warn:

  > Selection text copied, but the image could not be copied.

- A failed fallback leaves the clipboard unchanged and reports that copying
  failed.
- Never fall back to provider commands, temporary native editors, keyboard
  simulation, or platform-specific clipboard executables.

## Security and Limits

- Use the existing PDF selection normalization and PNG size limits.
- Reject malformed geometry, non-finite coordinates, invalid page ranges,
  oversized clipboard text, and stale selection keys.
- Encode the product deep link with the existing anchor URI codec; never
  construct or decode the payload by hand in the webview.
- Escape all HTML clipboard content.
- Do not expose anchor bridge paths, absolute local filesystem paths, or
  provider-internal identifiers.

## Compatibility and Scope

The implementation is cross-platform and uses only VS Code clipboard text APIs
plus the web-standard Async Clipboard API available in the PDF webview.

In scope:

- Markdown custom and native editor selections;
- single- and multi-page PDF text selections;
- Cursor-versus-VS Code action visibility;
- removal of provider-specific Markdown/PDF selection actions.

Out of scope:

- changing Cursor's direct **Add to Chat** behavior;
- changing Cursor Browser selection capture;
- removing explicit durable selection-export utilities used by other
  workflows;
- changing Ask PDF or persisted annotation schemas;
- directly controlling Codex, Claude Code, or CodeBuddy webviews.

## Testing

### Automated

- Exact single- and multi-line Markdown reference formatting.
- Dirty Markdown save and post-save recapture.
- Untitled, empty, and failed-save clipboard preservation.
- Cursor shows **Add to Chat** plus **Copy for Agent**.
- Stock VS Code shows only **Copy for Agent**.
- Provider-specific selection actions and provider picker are absent.
- PDF context is precomputed and correlated to the exact selection key.
- Single-page crop produces PNG, plain text, and sanitized HTML types.
- Multi-page crops are ordered, stitched, bounded, and include full selected
  text.
- Stale context and malformed geometry fail closed.
- Rich-copy failure performs text-only fallback with the precise warning.
- Copy paths do not call selection export functions, provider commands, or
  temporary editor APIs.
- Existing Cursor **Add to Chat**, Ask PDF, annotations, and durable export
  tests remain green.

### Cursor Extension Development Host

1. In Markdown, copy single- and multi-line selections and paste into Cursor,
   Codex, and Claude drafts.
2. Confirm the exact `@path#line[-line]` text appears and no panel flashes.
3. In a PDF, copy a single-page selection and paste into each draft.
4. Confirm the draft receives the PNG attachment, selected text, and clickable
   source link without creating export files.
5. Repeat with a selection spanning two or more pages and confirm one stitched
   PNG in page order.
6. Repeat in stock VS Code and confirm only **Copy for Agent** is visible.
7. Deny or simulate rich clipboard failure and confirm text-only fallback.

## Acceptance Criteria

- Markdown and PDF **Copy for Agent** produce the specified clipboard payload
  without writing selection export files.
- Copying does not open, focus, create, or submit to any agent surface.
- PDF single- and multi-page image evidence pastes alongside textual context in
  Cursor, Codex, and Claude during live validation.
- Cursor retains its direct **Add to Chat** action; stock VS Code does not show
  it.
- Automated tests, lint, typecheck, package checks, and live validation pass.
