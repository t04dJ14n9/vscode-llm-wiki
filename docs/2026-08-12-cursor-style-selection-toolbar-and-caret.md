# Cursor-style PDF selection toolbar and theme-native Vim caret

Date: 2026-08-12

## Goal

Make LLM Wiki's contextual PDF actions feel native to Cursor while ensuring every Markdown cursor state follows the active VS Code/Cursor color theme.

## Confirmed design

### PDF selection actions

- Replace the bulky wrapped button cluster with a compact Cursor-style floating bar.
- Keep the action order and behavior unchanged:
  1. Copy Link
  2. Add to Chat, when Cursor's built-in agent is available
  3. Installed external providers in the existing deterministic order
- Keep `Copy Link` as the primary blue action.
- Render the remaining actions as quiet, transparent toolbar controls with subtle hover states.
- Show compact visual provider labels (`Codex`, `Claude`, `CodeBuddy`) while preserving full accessible names such as `Send to Claude Code`.
- Keep the Cursor shortcut hint inside `Add to Chat`, but reduce its visual weight.
- Use a thin separator between the primary link action and agent handoff actions.
- Size the floating container to its content so it stays on one line at ordinary editor widths.
- In genuinely narrow panes, keep the bar within the viewport and allow horizontal overflow rather than turning it into the tall two-row box.
- Continue positioning the toolbar above the selection when space allows and below it otherwise.
- Do not change PDF selection semantics, exported artifacts, provider routing, keyboard order, or context-menu actions.

### Markdown caret

- Preserve the existing thin insertion caret.
- Preserve Vim normal mode's block cursor shape and behavior.
- Replace the Vim integration's hard-coded `#ff9696` cursor background and outline with:

  `var(--vscode-editorCursor-foreground, var(--vscode-editor-foreground))`

- Use the editor background for the glyph inside the Vim block so the character remains readable.
- Apply the same token immediately when the active color theme changes; no reload or editor recreation.
- Keep the existing theme-derived behavior for the regular CodeMirror caret, drop cursor, search field, and Vim command-line input.

## Root causes

- The PDF toolbar uses an absolutely positioned wrapping flex container without intrinsic content width. The browser shrink-wraps and wraps the provider actions even when the editor pane has enough room.
- `@replit/codemirror-vim` injects `#ff9696` directly for `.cm-fat-cursor` and its unfocused outline. Existing caret theming covers `.cm-cursor`, `.cm-dropCursor`, search, and command-line inputs, but not the Vim block cursor.

## Verification

- Add a browser regression proving the normal-width provider toolbar is one compact row, uses theme tokens, retains action order, and exposes full accessible names.
- Keep and strengthen the 320px containment test to prove no viewport or selection overlap.
- Add a browser regression that enables Vim normal mode and proves both focused block background and unfocused outline resolve from `editorCursor.foreground`.
- Repeat the Vim test with the cursor token absent and prove fallback to `editor.foreground`.
- Verify the glyph inside the block uses the editor background.
- Run the complete Markdown and PDF viewer browser suites, workspace checks, and a live dark/light theme comparison in Cursor.
