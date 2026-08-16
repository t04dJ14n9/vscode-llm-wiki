# Cursor Agent keyboard handoff design

## Goal

Make the custom Markdown editor feel continuous with the Cursor Agent
composer: `Ctrl/Cmd+L` sends the current Markdown selection to Cursor Agent,
and `Esc` returns focus to the Markdown editor.

This iteration is intentionally Cursor-specific. Codex and Claude keep their
existing explicit toolbar/context-menu actions and are not assigned a new
shortcut here.

## Behavior

1. With a non-empty selection in the custom Markdown editor, `Ctrl+L` on
   Windows/Linux and `Cmd+L` on macOS invoke the existing Cursor handoff
   command.
2. The handoff keeps the exact source URI and inclusive line range. It adds a
   selection pill to the current Cursor Agent composer without submitting a
   message and without opening a second Markdown editor.
3. The host records a transient `llmWikiAgentHandoffActive` context key after a
   successful handoff. `Esc` is enabled only while that key is true and the
   custom Markdown editor remains the source editor.
4. `Esc` invokes a dedicated focus command. The extension host reveals the
   original Markdown webview, restores CodeMirror focus, clears the transient
   context key, and leaves the Cursor composer open.
5. If there is no selection, `Ctrl/Cmd+L` retains the editor's existing
   checklist-toggle fallback rather than opening an empty agent handoff.
6. `Esc` when no handoff is active remains available to the editor/Vim keymap
   and does not change focus unexpectedly.

## Implementation

- Keep the existing webview `Mod-l` path as the fast path so selection capture
  happens before focus changes. Have it report whether the host handoff
  succeeded so the host can set the transient context key.
- Add `llm-wiki.focusMarkdownEditor` and a small handoff-state helper in the
  extension host. The helper delegates to `MarkdownEditorProvider.focusActiveEditor()`
  and clears `llmWikiAgentHandoffActive` after focus restoration is requested.
- Add a host keybinding for `escape` guarded by
  `llmWikiAgentHandoffActive && activeCustomEditorId ==
  'llm-wiki.markdownEditor'`. Keep `Ctrl/Cmd+L` scoped to a non-empty Markdown
  selection and Cursor host as it is today.
- Avoid provider-specific commands or agent conversation APIs in the
  keyboard path. The existing `composer.addsymbolstocomposer` adapter remains
  responsible for the exact-range Cursor attachment.

## Error and focus handling

- A failed or unavailable Cursor handoff does not set the active context key;
  `Esc` therefore remains owned by the editor.
- Focus restoration is idempotent. Repeated `Esc` presses do not close tabs,
  submit the agent composer, or create a new editor.
- The original custom Markdown tab is never replaced by a native text tab as a
  side effect of the shortcut.

## Tests and live acceptance

- Unit tests cover the focus command, context-key transitions, and the
  no-selection checklist fallback.
- Manifest tests cover the command contribution and guarded Escape shortcut.
- Cursor live verification in the Extension Development Host checks:
  - selected lines become an exact Cursor selection pill after `Cmd+L`;
  - no duplicate editor group or native Markdown tab appears;
  - `Esc` returns the focused element to the Markdown editor;
  - a second `Esc` does not alter the agent composer or editor contents.

