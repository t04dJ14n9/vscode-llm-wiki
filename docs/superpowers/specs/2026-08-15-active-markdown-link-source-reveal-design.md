# Active Markdown Link Source Reveal

## Problem

The hybrid Markdown editor keeps a Markdown link compact when an empty caret is
inside the visible link label. For example, placing the caret in `code index`
continues to display only the rendered label for:

```markdown
[code index](code/index.md)
```

This differs from Obsidian live preview, where the link containing the caret
reveals its complete Markdown source so the label and destination can be edited
directly.

The regression was introduced by the compact-link-label exception in
`activeInlineRevealSpans`. That exception deliberately suppresses the source
span when the caret is between `labelFrom` and `labelTo`.

## Desired Behavior

When an empty caret is anywhere inside the source span of a non-image Markdown
link, the editor reveals that link's complete source:

```markdown
[code index](code/index.md)
```

The reveal is scoped to the link containing the caret:

- Other links on the same line remain rendered and compact.
- Moving the caret outside the link restores its rendered form.
- Ordinary inline links, reference links, and links whose labels contain inline
  code use the same caret-scoped reveal behavior.
- Images retain their current preview behavior.
- Non-empty selections retain rendered links instead of exposing destinations.
- Links outside the active line are unchanged.

## Design

`activeInlineRevealSpans` remains the single decision point for revealing
inline Markdown source on an active line. For each empty selection range, it
will return the complete span of a non-image Markdown or reference link when
the caret is inside that span, including when the caret is inside the label.

The existing compact-label suppression will no longer apply to an empty caret.
No new editor state, widget, event handler, or document mutation is required.
The existing decoration filter will remove rendered decorations that overlap
the revealed span, allowing the source text and the current active-link styling
for its label, punctuation, and destination to remain visible.

The existing exclusions remain responsible for keeping image previews mounted
and for ignoring non-empty selections.

## Interaction Flow

1. CodeMirror reports an empty selection on an active line.
2. `activeInlineRevealSpans` compares the caret position with inline source
   spans.
3. If the caret is inside a non-image link, the function returns that link's
   complete source span.
4. Rendered decorations overlapping that span are filtered out.
5. Other rendered decorations, including other links on the line, remain.
6. A later selection update recomputes decorations and restores compact
   rendering after the caret leaves the link.

## Testing

Add focused browser regression coverage that verifies:

1. A caret inside the label of `[code index](code/index.md)` exposes the entire
   source.
2. A second link on the same line remains rendered.
3. Moving the caret outside the first link restores its compact rendering.
4. A caret inside an inline-code label reveals the complete enclosing link
   rather than leaving a partial combination of rendered and raw syntax.
5. Existing image and non-empty-selection tests continue to pass unchanged.

Verification will include the focused Playwright tests, the relevant Markdown
editor suite, the extension build/typecheck, and a Cursor Extension Development
Host smoke test using the demo-vault `code index` link.

## Scope

This change is limited to caret-driven source reveal for Markdown links. It does
not alter link resolution, navigation, link appearance while inactive, image
rendering, selection copy behavior, document persistence, or the separate
cursor-position preservation regression.
