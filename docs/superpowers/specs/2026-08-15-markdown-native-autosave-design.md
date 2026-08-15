# Markdown Native Autosave Design

## Problem

The Markdown custom editor calls `TextDocument.save()` 150 milliseconds after
every webview edit. Saving invokes VS Code save participants such as
`editor.formatOnSave`. With Prettier configured for Markdown, Vim normal-mode
`O` briefly inserts an empty line, then the forced save formats that line away
and the extension sends the formatted document back to the webview.

The trace confirms this sequence: the webview document grows from 5,712 to
5,713 bytes, then the host sends the previous 5,712-byte document back about
187 milliseconds later.

## Design

The custom editor will update the backing `TextDocument` through its existing
queued `WorkspaceEdit` path, but it will not initiate its own delayed save.
VS Code remains the authority for persistence:

- `files.autoSave` controls automatic saving.
- Explicit save commands flush queued webview edits before saving.
- Close commands flush queued webview edits and retain native dirty-file
  prompts.
- Save participants still run when VS Code actually saves the document.

This matches normal text-editor behavior and prevents the extension from
silently overriding the user's autosave preference.

## Alternatives Rejected

- Reapply the webview text after formatting: this would fight configured save
  participants and introduce another asynchronous edit loop.
- Bypass formatting during extension saves: VS Code does not expose a clean
  per-save bypass, and it would make custom-editor saves differ from normal
  editor saves.
- Reimplement `files.autoSave` inside the extension: this would duplicate host
  behavior and retain the race that caused the bug.

## Testing

Add a VS Code-hosted integration test that:

1. Opens a sandbox Markdown document with Vim mode enabled.
2. Executes normal-mode `O`.
3. Waits longer than the former 150-millisecond timer.
4. Confirms the inserted line remains in the webview.
5. Confirms the backing editor stays dirty while native autosave is disabled.

After automated verification, rebuild the latest extension and reproduce the
same sequence in `demo-vault` with Markdown format-on-save enabled.
