# Code Block Copy Tooltip Design

## Summary

The Markdown editor's fenced-code copy button currently writes the code to
the clipboard but provides no visible confirmation. After a successful copy,
the button will show a compact, theme-aware `Copied` tooltip above the button.
The copy icon and code-block layout will remain unchanged.

## Interaction

- Clicking the copy button continues to copy the code block's exact source
  text through the existing native-clipboard or host-fallback path.
- After the native clipboard write resolves, or after the host fallback event
  is dispatched, the tooltip enters over 120 ms by fading in and moving upward
  4 px.
- The tooltip remains visible for 1 second, then exits over 120 ms.
- Clicking again while it is visible restarts the visibility timer and the
  entrance animation.
- The tooltip must sit above the copy button without changing the header's
  dimensions or moving the language label, icon, or code content.

## Visual Design

The tooltip uses VS Code semantic theme variables:

- background: `--vscode-editorHoverWidget-background`
- foreground: `--vscode-editorHoverWidget-foreground`
- border: `--vscode-editorHoverWidget-border`

Fallbacks use the editor background, foreground, and contrast-border tokens.
The tooltip has a small radius, compact horizontal padding, and a subtle
theme-derived shadow. It must remain legible in dark, light, and high-contrast
themes.

The code-block surface may allow the tooltip to overflow above the header, but
the existing rounded code-block background and one-line header layout must not
change.

## Accessibility and Motion

- The feedback element uses `role="status"`, `aria-live="polite"`, and
  `aria-atomic="true"`.
- Its text changes to `Copied` only after the copy path succeeds and resets
  after the exit completes.
- The button keeps its existing `Copy code` accessible name and tooltip.
- When `prefers-reduced-motion: reduce` is active, the tooltip appears and
  disappears without translation or fading while keeping the same dwell time.

## Error Handling

The feedback is shown only after `writeTextToClipboard` completes. Native
clipboard rejection continues to use the existing host fallback. No new error
surface or clipboard protocol is introduced.

## Testing

Browser tests will verify:

1. Clicking copies the exact code and exposes a visible `Copied` status.
2. The tooltip is geometrically above the button and does not change header
   layout.
3. It uses the configured semantic theme colors.
4. It resets after the defined duration.
5. Repeated clicks restart the visible interval.
6. Reduced-motion mode removes the transition and translation.
7. The existing host fallback still copies and triggers the same feedback.

The final build will also be checked in the Cursor Extension Development Host
by clicking the copy button in the provided `selection.md` code block.

## Non-Goals

- Changing the copy icon.
- Expanding the button with text.
- Adding a global toast or notification.
- Changing code-block syntax highlighting or clipboard contents.
