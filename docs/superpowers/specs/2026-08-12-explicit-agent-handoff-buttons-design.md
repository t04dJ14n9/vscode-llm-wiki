# Explicit Agent Handoff Buttons

**Date:** 2026-08-12

## Summary

LLM Wiki will replace ambiguous PDF-to-agent routing with explicit,
capability-driven provider actions. VS Code will show one action for each
supported installed agent extension. Cursor will show the same provider actions
and retain its generic **Add to Chat** action as a direct handoff to Cursor
Agent.

The provider controls must work when the target extension is installed but has
not activated yet. Clicking a provider action activates that extension,
validates its handoff command, attaches the exported selection through the
provider's supported command contract, and never submits the draft.

## Goals

- Make every PDF-to-agent destination explicit and deterministic.
- Show provider actions only for supported installed extensions.
- Keep Cursor's generic **Add to Chat** action and make it target Cursor Agent
  directly.
- Show **Send to Codex**, **Send to Claude Code**, and **Send to CodeBuddy** in
  both VS Code and Cursor when the corresponding extension is installed.
- Activate a cold provider extension on demand before invoking its handoff.
- Export the same immutable `selection.md` and optional `selection.png` for all
  providers.
- Preserve draft-only behavior: attach context but never submit a prompt.
- Give Claude Code explicit access to the sibling selection image through the
  exported Markdown because its extension does not expose an image-attachment
  command.

## Non-goals

- Inferring which third-party sidebar or subpanel was focused most recently.
- Depending on undocumented VS Code or Cursor context-key getters.
- Automating another extension's private webview, drag-and-drop surface, or
  clipboard paste behavior.
- Adding provider SDKs or direct model/API integrations.
- Automatically installing, authenticating, opening, or submitting to an
  external provider. Cursor's user-invoked generic **Add to Chat** action may
  reveal its built-in composer when none exists.
- Removing the command-palette provider picker used outside explicit PDF
  actions.

## Product Behavior

### PDF selection toolbar

The floating toolbar begins with **Copy Link**, followed by product and
capability-specific actions.

In stock VS Code:

1. **Copy Link**
2. **Send to Codex**, when `openai.chatgpt` is installed and its handoff command
   is contributed
3. **Send to Claude Code**, when `Anthropic.claude-code` is installed and its
   handoff command is contributed
4. **Send to CodeBuddy**, when `Tencent-Cloud.coding-copilot` is installed and
   its handoff command is contributed

In Cursor:

1. **Copy Link**
2. **Add to Chat**, targeting Cursor Agent directly
3. The same installed-provider actions listed for VS Code

The generic **Add to Chat** action does not select Codex, Claude Code, or
CodeBuddy. Those destinations are always chosen through their explicit actions.
The generic command, editor-title action, editor context item, and Cmd/Ctrl+L
keybinding are enabled only in Cursor. Stock VS Code retains the provider picker
under **Send Selection to Agent…**, but exposes no ambiguous generic **Add to
Chat** UI.

### PDF selection context menu

The right-click menu mirrors the same destination rules:

- Look up
- **Add to Chat** in Cursor only
- One **Send to …** item for each supported installed provider
- Copy link to selection
- Copy selected text

Provider actions use the same ordering in the toolbar and context menu:
Codex, Claude Code, then CodeBuddy.

### Provider availability

An action is available when:

1. The expected extension identifier is present in `vscode.extensions`.
2. The extension manifest or VS Code command registry exposes a supported
   data-handoff command. A focus/open-only command is not sufficient.

`Extension.isActive` is not an availability requirement. An installed inactive
extension must still produce a button.

Open PDF webviews receive an updated capability payload when
`vscode.extensions.onDidChange` fires. Reloading the editor is not required
after an install, uninstall, enable, or disable event when VS Code exposes the
change to the running extension host.

### Handoff execution

Every explicit provider click carries a provider identifier in the webview
message. The extension host:

1. Exports the selected passage to the normal immutable `selection.md`.
2. Creates or refreshes `selection.png` when a valid PDF crop is available.
3. Resolves the exact selected provider; it never runs the general target
   selector.
4. Calls `Extension.activate()` when the provider is inactive.
5. Refreshes the command registry and validates the expected command.
6. Executes the provider adapter.
7. Reports success or a provider-specific failure without rerouting.

No external-provider adapter executes a submit, send-message, open-provider, or
new-conversation action. Cursor's direct adapter may invoke its existing
composer-open command only after the user explicitly clicks **Add to Chat** and
Cursor reports that no composer exists; it still never submits.

### Provider contracts

#### Cursor Agent

Cursor's **Add to Chat** uses `composer.addfilestocomposer` for the exported
Markdown and optional PNG. It may open Cursor Chat only when no composer exists,
using the existing behavior. This action exists only in Cursor.

#### Codex

**Send to Codex** uses `chatgpt.addFileToThread` once per unique local
attachment:

- `selection.md`
- `selection.png`, when present

The command prepares context in Codex but does not submit it.

#### CodeBuddy

**Send to CodeBuddy** uses `tencentcloud.codingcopilot.addToChat` with
`selection.md` as the primary resource and the unique Markdown/PNG paths as its
attachment list. It does not submit the draft.

#### Claude Code

Claude Code 2.1.227 exposes `claude-vscode.insertAtMention`, which reads the
active native text-editor selection and inserts an `@file#line` reference. It
does not accept attachment paths and exposes no command for adding an image
file. Its terminal-mode `claude-code.insertAtMentioned` command has the same
active-editor reference contract and is also supported when that is the
contributed insertion command.

**Send to Claude Code** therefore:

1. Opens `selection.md` in a native text editor.
2. Selects its complete content.
3. Invokes the available Claude insertion command:
   `claude-vscode.insertAtMention` or `claude-code.insertAtMentioned`.
4. Ensures `selection.md` contains the portable line
   `**Visual evidence**: [selection.png](./selection.png) when present`, so the
   sibling crop can be opened without relying on an alias or absolute path.

The PNG remains durable visual evidence Claude can open from the referenced
Markdown. The UI and documentation must not claim that Claude receives a
native image attachment chip.

## Architecture

### Capability service

Agent metadata and availability detection remain centralized in
`agentHandoff.ts`. The module exposes:

- A serializable provider-capability list for webviews.
- An explicit provider handoff function accepting an `AgentId`.
- The existing picker-based handoff for command-palette and non-PDF flows.
- The direct Cursor handoff used by Cursor's generic action.

Provider identifiers, extension identifiers, supported data-handoff commands,
labels, and attachment behavior have a single source of truth. Focus-only
commands such as `claude-vscode.focus` are never treated as handoff
capabilities.

### PDF host-to-webview protocol

The PDF provider sends an initial agent-surface configuration after the webview
reports ready and whenever extension availability changes. The payload contains:

- Whether the host product is Cursor.
- The ordered explicit providers currently available.

The webview treats this host payload as authoritative. It does not inspect the
host product or installed extensions itself.

### PDF webview-to-host protocol

The text-selection action union gains an explicit provider action carrying:

- `agentId`
- The selected PDF anchor
- The optional crop data already used by Add to Chat

Cursor's generic action remains a distinct direct-Cursor action. Copy Link and
rectangle selection actions remain unchanged.

### Selection export

One export pipeline serves all destinations. Provider selection happens only
after the Markdown and optional crop are prepared. Claude's linked-image
metadata is produced by that same export pipeline so it cannot diverge from the
actual `selection.png` lifecycle.

## Error Handling

- If a listed extension disappears before click, report that the selected
  provider is no longer available and refresh the capability payload.
- If activation rejects, identify the selected provider and do not invoke or
  select another provider.
- If the expected command is still absent after activation, report a
  compatibility error containing the provider name, not an internal command
  identifier.
- Failure to create the optional image preserves the existing text-only
  fallback and warning.
- Failure of an optional image attachment after Markdown succeeds is reported
  as partial success for providers that support images.
- Claude's missing image-attachment API is not an error because its linked-image
  behavior is the designed contract.
- Authentication and onboarding remain the provider's responsibility; Human
  Learning may surface the provider and invoke it but never bypasses its UI.

## Testing

### Unit and integration tests

- Assert the VS Code capability matrix has no generic **Add to Chat** action.
- Assert the Cursor matrix retains generic **Add to Chat** and adds installed
  provider actions.
- Assert absent, disabled, or command-incompatible providers are omitted.
- Assert an installed provider with `isActive === false` is visible.
- Assert clicking a cold provider calls `activate()` before command execution.
- Assert commands are refreshed after activation.
- Assert activation failure produces a provider-specific warning and no
  fallback command.
- Assert each explicit action invokes only its selected provider.
- Assert the picker-based command remains available outside explicit actions.
- Assert Codex and CodeBuddy receive unique Markdown and PNG attachments.
- Assert Cursor's generic action uses only Cursor commands.
- Assert Claude receives a full-document mention and the exported Markdown
  contains exactly
  `**Visual evidence**: [selection.png](./selection.png) when present`.
- Assert an export without a PNG does not leave a stale `selection.png` alias
  and the Markdown wording remains conditional rather than claiming an image
  exists.
- Assert no handoff path invokes a submit/send command.

### PDF webview tests

- Render every VS Code and Cursor capability combination.
- Verify toolbar and context-menu labels, ordering, and absence rules.
- Verify provider clicks post the selected provider ID and crop data.
- Verify capability updates change an already-open PDF without rebuilding it.
- Verify narrow layouts keep all actions usable without covering the selection
  or escaping the viewport.
- Verify keyboard focus, accessible names, and theme-derived colors for every
  added action.

### Cold-start live verification

Run isolated Cursor and VS Code hosts with the production LLM Wiki build
and the normal installed provider directories.

For every installed provider in each host:

1. Start LLM Wiki and open the PDF before opening the provider.
2. Record that the provider extension exists and `isActive === false`.
3. Select a real PDF passage and confirm its provider action is visible.
4. Click the LLM Wiki provider action.
5. Record that the provider becomes active.
6. Verify the provider draft contains the exported `selection.md` and, where
   supported, `selection.png`. Provider-owned logs may corroborate the draft
   but cannot replace draft inspection.
7. Confirm no prompt was submitted.

Claude verification records the inserted Markdown mention and the linked sibling
image rather than claiming a native PNG attachment. Authentication, onboarding,
or an opaque proprietary draft may block inspection, but that row must remain
**unverified** even when activation and command invocation are proven. It cannot
be counted as passing or as evidence that context reached the draft.

## Rollback

The explicit provider protocol and UI can be removed without changing selection
exports or provider adapters. Cursor's direct handoff and the command-palette
picker remain independent fallback surfaces.
