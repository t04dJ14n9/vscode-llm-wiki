# Disable Ask PDF and Simplify PDF Selection Actions

**Date:** 2026-08-12

## Summary

Human Learning will temporarily remove Ask PDF from the active product while preserving its implementation and stored discussion data for a future provider-neutral “More detail” workflow. At the same time, the PDF selection toolbar will be reduced to the two actions that have a clear current purpose: **Copy Link** and **Add to Chat**.

The demo vault instructions will be refreshed to describe the current agent handoff and editor behavior, and the Markdown editor caret will be explicitly verified against the active VS Code color theme.

## Goals

- Make Ask PDF completely inactive and invisible.
- Prevent extension activation from starting the Codex app server solely for Ask PDF.
- Preserve Ask PDF source modules and existing `.hl/annotations/pdf` data.
- Reduce the PDF text-selection toolbar to **Copy Link** and **Add to Chat**.
- Remove the obsolete quote/insert selection-action protocol paths.
- Keep provider-neutral Add to Chat behavior unchanged.
- Synchronize the demo vault rules with the current implementation.
- Ensure the Markdown editor caret uses the same theme token as the built-in VS Code editor.

## Non-goals

- Designing or implementing the future “More detail” workflow.
- Migrating or deleting existing Ask PDF discussions, snapshots, or generated notes.
- Removing the Codex integration modules that Ask PDF may reuse later.
- Changing portable PDF link generation or Add to Chat payloads.
- Removing rectangle-selection embeds or the ordinary “Copy selected text” context-menu action.
- Adding a user-visible Ask PDF feature flag.

## Product Behavior

### Ask PDF

Ask PDF will have no active entry point:

- No toolbar/history button.
- No “Ask about selection…” context-menu item.
- No Ask PDF panel, discussion marker, consent prompt, command-palette command, or shortcut.
- No Ask PDF message handling in an active PDF editor.
- No automatic Codex app-server client or discussion-controller startup during extension activation.

Existing Ask PDF implementation files and stored data remain untouched. A single deferred-feature marker will be placed at the extension composition boundary:

`TODO(ask-pdf): Re-enable after the provider-neutral “More detail” workflow and backend policy are specified.`

This is an intentional product deferral marker, not an unresolved implementation requirement.

### PDF text-selection actions

The floating selection toolbar will contain, in order:

1. **Copy Link**
2. **Add to Chat**, when agent handoff is available

The following controls will be removed:

- **Insert Link**
- **Copy Quote and Link**
- **Insert Quote and Link**
- **More**
- The toolbar-level “Copy link format” selector, because only the normal portable Markdown link remains.

The right-click selection menu will retain:

- Look up
- Add to Chat, when available
- Copy link to selection
- Copy selected text

It will remove Ask PDF and all quote/insert link variants.

The PDF selection-action protocol will retain only actions still used by a live UI, including Add to Chat, Copy Link, and rectangle embed copying. Host-side insertion and quote-composition branches dedicated to the removed actions will be deleted. Shared portable-link generation remains the source for both Copy Link and Add to Chat.

### Add to Chat

Add to Chat remains provider-neutral and draft-only:

- It may target supported Cursor, Codex, or Claude surfaces through the existing handoff resolver.
- It prepares the selected text, exact generated Source link, and optional screenshot.
- It never submits a prompt automatically.
- A failure to locate a compatible chat surface produces the existing user-facing fallback/error behavior; it does not fall back to Ask PDF.

### Markdown caret theming

All Markdown-editor caret surfaces will use:

`var(--vscode-editorCursor-foreground, var(--vscode-editor-foreground))`

This applies to:

- The CodeMirror text cursor.
- The CodeMirror drop cursor.
- Native caret rendering inside the editor.
- Vim/search panel input carets.

The fallback is the active editor foreground, not a fixed color. The implementation will not introduce a Human Learning caret preference.

## Architecture

### Extension composition boundary

Ask PDF will be disabled at the point where extension services are assembled. The extension will not construct the Codex app-server client, output channel, or PDF discussion controller while the feature is deferred. The PDF editor provider will therefore receive no active discussion service.

This boundary is preferred over deleting the implementation because it:

- Prevents background work and consent prompts.
- Keeps the preserved modules buildable and testable.
- Makes later reintroduction an explicit composition decision.
- Avoids coupling the current PDF viewer to a specific agent SDK.

### PDF webview capability

The host-generated webview configuration will explicitly omit or disable Ask PDF. With the capability disabled, the webview will not construct the Ask panel, bind Ask PDF actions, request discussion history, or render discussion markers.

The disabled state is authoritative. Unexpected legacy Ask PDF messages are ignored without starting services, mutating data, or surfacing a misleading error.

### Selection action cleanup

The webview and extension-host action unions will be narrowed together. UI creation, message validation, host dispatch, CSS for the removed menu, and tests for the removed actions will be deleted as one change so no dead protocol branch remains.

The portable selection anchor and link-formatting functions remain because Copy Link and Add to Chat depend on them.

### Dormant implementation and data

The following remain in the repository:

- Ask PDF panel, controller, protocol, persistence, and Codex client modules.
- Focused tests for those isolated modules.
- Existing discussion and snapshot data under `.hl/annotations/pdf`.

No migration runs and no stored record is rewritten.

## Demo Vault Documentation Refresh

The following files will be synchronized where their audiences overlap:

- `demo-vault/AGENTS.md`
- `demo-vault/CLAUDE.md`
- `demo-vault/.agents/skills/human-learning/SKILL.md`
- `demo-vault/.claude/commands/hl-explain-selection.md`

The refreshed rules will document:

- Human Learning’s custom Markdown and PDF editors.
- Markdown and PDF outline behavior.
- Vim starting in normal mode when Vim mode is enabled.
- Theme-derived editor colors.
- Provider-neutral, draft-only Add to Chat behavior.
- `.hl/agent/selection.md` as the current selection handoff.
- `.hl/agent/selection.png` as optional visual evidence.
- Immutable exported Source links under `.hl/agent/exports/...`.
- The requirement to reuse the exact generated Source link rather than inventing, rewriting, or approximating a PDF URL.
- The rule not to edit `raw/` source material unless explicitly requested.
- Internal `.hlanchor` files as generated bridge artifacts whose identifiers must not be invented.

Stale “Add to Cursor Chat” wording and instructions to construct direct PDF text-fragment URLs will be removed. The pending alternative that deletes the selection-handoff rules is not part of this design.

## Error Handling

- Disabling Ask PDF must not affect PDF rendering, selection, copying, or Add to Chat.
- A stale Ask PDF message cannot lazily start Codex or mutate discussion storage.
- Copy Link continues to report clipboard success through the existing notification.
- Add to Chat retains its existing compatible-surface detection and failure reporting.
- Theme-token absence falls back to the editor foreground.

## Testing

### Automated tests

- Assert the extension manifest no longer contributes Ask PDF commands or Ask PDF trust messaging.
- Assert extension activation does not create or start the Codex app-server client for Ask PDF.
- Assert the PDF toolbar, selection context menu, and selection toolbar expose no Ask PDF controls.
- Assert no Ask PDF panel or discussion markers are initialized in the active PDF webview.
- Assert the selection toolbar contains only Copy Link and, when enabled, Add to Chat.
- Assert Insert Link, both quote actions, More, and Copy Link Format are absent.
- Assert removed selection-action message variants are rejected by validation.
- Retain passing coverage for Copy Link, Add to Chat, and rectangle embeds.
- Assert a supplied `--vscode-editorCursor-foreground` value becomes the computed CodeMirror cursor border and native input caret color.
- Assert the fallback caret color derives from the editor foreground.
- Assert the synchronized vault rules contain the exact-source-link requirement and no stale direct-fragment or Cursor-only handoff guidance.

### Manual verification

After rebuilding and reloading the Extension Development Host:

1. Open a PDF and confirm no Ask PDF control, panel, marker, command, consent prompt, or Codex startup appears.
2. Select PDF text and confirm the floating toolbar contains only Copy Link and Add to Chat.
3. Right-click selected text and confirm only the retained actions appear.
4. Verify Copy Link opens the exact selection after navigation.
5. Verify Add to Chat prepares text, generated Source link, and screenshot for a compatible agent without submitting.
6. Open Markdown under at least one dark and one light theme and compare its caret with the built-in editor caret.
7. Confirm existing `.hl/annotations/pdf` data is unchanged.

## Rollback and Future Reintroduction

Reintroducing Ask PDF requires a new approved design for the provider-neutral “More detail” workflow and its backend-selection policy. That work should reactivate the preserved modules through the composition boundary rather than silently restoring the current Codex-specific startup.
