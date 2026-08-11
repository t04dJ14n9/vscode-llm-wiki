# Markdown Vim Startup and Theme Colors Design

## Goal

The Human Learning Markdown editor should feel native to the selected Cursor or
VS Code color theme and predictable to Vim users.

When Markdown Vim mode is enabled, a newly initialized Markdown editor starts in
Vim Normal mode. Markdown links use the approved minimal inline treatment from
Option A, and all user-facing Markdown editor font colors come from semantic
VS Code theme variables rather than fixed light-theme colors.

The approved visual reference is:

```text
/Users/t04dj14n9/.codex/generated_images/019fe660-3c41-7d43-9a0c-cd2b224cd5ed/exec-e49ac957-770a-482e-9adb-185d948c6c3e.png
```

## Vim Startup Behavior

- If persisted Markdown Vim mode is enabled when a Markdown webview is created,
  CodeMirror Vim starts in Normal mode.
- Enabling Vim mode in an already-open Markdown editor also enters Normal mode.
- Normal Vim commands such as `i`, `a`, and `o` enter Insert mode normally.
- Returning focus to an existing editor preserves its current Vim state. Focus
  restoration must not force Insert mode or reset every visit to Normal mode.
- Disabling Vim mode preserves the existing non-Vim editing behavior.
- The Preview/Markdown surface toggle is unchanged. "Normal mode" refers to the
  Vim state inside the Markdown editor, not to Preview mode.

The current `ensureVimInsertMode` startup and focus paths deliberately force
Insert mode. Those calls are removed or replaced with initialization that lets
the Vim extension retain its native Normal-mode default.

## Link Treatment

Markdown links keep their editable inline source form on the active line. The
design does not introduce a pill or metadata card.

The rendered and active-line states use the following semantic roles:

- Link label and its underline:
  `var(--vscode-textLink-foreground)`
- Hovered or actively invoked link:
  `var(--vscode-textLink-activeForeground,
  var(--vscode-textLink-foreground))`
- Raw link destination:
  `var(--vscode-descriptionForeground,
  var(--vscode-editor-foreground))`
- Markdown punctuation surrounding the label and destination:
  `var(--vscode-descriptionForeground,
  var(--vscode-editor-foreground))`
- Ordinary Markdown text:
  `var(--vscode-editor-foreground)`
- Keyboard focus indicator:
  `var(--vscode-focusBorder)` with
  `var(--vscode-contrastBorder)` as the high-contrast border source when
  available.

The theme remains the authority for the actual hue. Human Learning does not
replace a theme's link palette. Readability improves because only the
human-readable label receives the link color; the long destination and
punctuation no longer inherit a saturated URL color. The underline and external
arrow preserve link recognition even when a theme uses a subtle link hue.

Inactive-line hybrid rendering continues to collapse the raw destination into
the existing clickable label. Hover and focus still reveal the destination
through the existing title or editing interaction.

## Markdown Font-Color Audit

The CodeMirror `defaultHighlightStyle` is not suitable for this webview. It
contains fixed colors documented as working well with light themes, including
fixed colors for URLs, metadata, keywords, strings, variables, comments, and
invalid syntax. It is replaced by a Human Learning `HighlightStyle` whose text
colors use VS Code semantic variables.

The mapping is:

| Markdown or syntax role | Theme source |
| --- | --- |
| Plain text and headings | `editor.foreground` |
| Metadata, punctuation, comments | `descriptionForeground` |
| Links | `textLink.foreground` |
| Link hover/active state | `textLink.activeForeground` |
| Raw URL destinations | `descriptionForeground` |
| Inline and fenced code text | `textPreformat.foreground` |
| Vim caret | `editorCursor.foreground` |
| Line numbers and gutters | `editorLineNumber.foreground` / `editorGutter.foreground` |
| Invalid syntax | `errorForeground` |
| Math operators and variables | `symbolIcon.operatorForeground` / `symbolIcon.variableForeground` |
| Tags and footnotes | `textLink.foreground` |
| Widget, input, and popover text | their matching `editorWidget`, `input`, or hover-widget foreground token |

Font-color declarations in the Markdown editor are audited under these rules:

1. Prefer the most specific semantic VS Code variable.
2. Fall back to `editor.foreground` or `descriptionForeground`.
3. Do not use fixed hexadecimal or RGB values as a text-color fallback.
4. Fixed values may remain as last-resort fallbacks for non-text surfaces such
   as shadows, selection fills, and translucent highlights when VS Code does
   not expose a suitable token.
5. Font weight, italics, underline, opacity, and text decoration may continue to
   convey structure without inventing a new color palette.

## Theme Data Flow

Cursor and VS Code inject active theme colors into the webview as
`--vscode-*` CSS variables. The Markdown editor reads those variables directly
in its CodeMirror base theme and highlight style.

No theme name is stored, no dark/light branching is added, and no reload is
required when the theme changes. A theme switch updates the CSS variables and
the editor follows automatically.

## Accessibility

- Links retain a visible underline instead of relying on color alone.
- Keyboard focus uses the host focus or contrast border.
- Raw destinations remain readable but visually secondary.
- High-contrast themes remain authoritative; Human Learning does not blend or
  reduce their supplied foreground colors.
- The implementation must be visually checked in at least one dark theme, one
  light theme, and a high-contrast theme or a test fixture with equivalent
  semantic variables.

Screenshot inspection can confirm visual hierarchy and obvious contrast
failures, but it is not a complete accessibility-conformance test.

## Testing

- A webview test initializes a fresh editor with Vim enabled and asserts that
  the Vim state is Normal, not Insert.
- A focus-restoration test proves revisiting an existing editor does not change
  its current Vim mode.
- A toggle test proves enabling Vim mode enters Normal and disabling it restores
  non-Vim behavior.
- Markdown rendering tests prove the active link label, destination, and
  punctuation receive distinct semantic classes or decorations.
- Theme tests set dark, light, and high-contrast CSS-variable fixtures and
  assert computed link, destination, caret, and representative syntax colors
  follow those variables.
- A source audit step rejects `defaultHighlightStyle` and fixed font colors in
  the Markdown editor while permitting bounded non-text fallback colors.
- The full extension build, type-check, unit suite, and relevant browser tests
  must pass.
- Final Computer Use verification checks the real Markdown editor in Cursor
  with Vim enabled and at least dark and light themes.

## Scope and Non-goals

- No change to the PDF viewer's colors.
- No change to Cursor Chat link rendering.
- No custom theme picker or Human Learning palette.
- No pill, chip, or metadata-card link design.
- No change to Markdown document content or exported source links.
- No reset of Vim mode on every tab focus.
- No broad typography or layout redesign beyond the approved Option A link
  treatment and theme-color audit.
