# Image Live Preview Cleanup

## Problem

The hybrid Markdown editor currently keeps image embed source visible beside
the rendered preview even when the caret is on another line. For example:

```markdown
![[projects/code/nanochat/dev/nanochat.png|Nanochat logo]]
```

is shown above the image in `demo-vault/projects/nanochat.md`. This differs
from Obsidian live preview, where inactive image source is replaced by the
rendered image.

The regression comes from the inactive-line rendering branch passing
`renderActiveImages: true`. That option creates an additive block widget after
the source instead of replacing the source range.

The image's `Expand image` button is also laid out below the preview, adding
visual height and separating the control from the content it affects.

## Desired Behavior

- When the caret is not on an image line, the image source is hidden and the
  rendered preview remains visible.
- When the caret is on the image line, the complete source is visible for
  editing and the preview remains visible.
- Moving the caret away hides the source again without changing the document.
- Clicking the rendered image still places the caret on its source line.
- Markdown images, reference images, and Obsidian image embeds follow the same
  inactive/active rule.
- The `Expand image` button is overlaid at the top-right of the rendered image
  and does not add height below it.
- Image load failures continue to remove the expand control and show the
  existing fallback.

## Design

### Source replacement

`buildHybridDecorations` remains the single decision point for active versus
inactive line rendering.

For inactive lines, call `decorateRenderedLine` without
`renderActiveImages`. `replaceImages` will then use its normal replacement
decoration, replacing the image source span with `ImageWidget`.

For active image lines, retain the current additive image widget. The raw
source remains in the CodeMirror document view for direct editing, while the
preview stays mounted after it.

No CSS-based source hiding, synthetic document edit, or new editor state is
needed. Copy and persistence continue to operate on the unchanged Markdown
document.

### Expand control

Keep the existing semantic `button` and its `Expand image` accessible name.
The image container remains `position: relative`; the button becomes
`position: absolute` with a small top/right inset and a z-index above the
image. A compact translucent editor-widget background and existing focus
outline keep it legible over light or dark images.

The control remains keyboard focusable and keeps its current click, dialog,
focus-return, and image-error behavior.

## Interaction Flow

1. The caret rests outside the image line.
2. Hybrid decorations replace the full image source range with `ImageWidget`.
3. The preview displays with the expand control in its top-right corner.
4. Clicking the image moves the caret to the image source.
5. Decorations recompute: the source is revealed and an additive preview
   remains visible.
6. Moving the caret to another line recomputes decorations and restores the
   replacement preview.

## Testing

Browser regression coverage will verify:

1. An inactive Markdown image source is absent from visible editor text while
   its preview is visible.
2. An inactive Obsidian image embed source is absent from visible editor text.
3. Clicking the preview reveals the source and preserves the preview.
4. Moving the caret away hides the source again.
5. The expand button's bounding box is inside the image container and aligned
   with its top-right corner without adding a row below the image.
6. Existing image dialog, dimension, error fallback, callout, table, copy, and
   navigation tests remain green.

Verification will include focused Playwright tests, the complete Markdown
editor browser suite, extension typecheck/build checks, and a Cursor Extension
Development Host smoke test using `demo-vault/projects/nanochat.md`.

## Scope

This change is limited to image live-preview source visibility and the expand
control's placement. It does not alter image resolution, syntax parsing,
dimensions, modal behavior, document content, autosave, Vim commands, or the
separate cursor-return regression.
