# Session functionality inventory — 2026-08-14

This document records the functionality requested during the Markdown-editor
and agent-handoff work in this session. It separates shipped behavior from
roadmap work so an unfinished integration is not mistaken for a verified one.

## Status key

- **Shipped** — implemented in the repository and covered by an automated
  check; a live note is included where Computer Use was run in this session.
- **Partial** — the reusable foundation exists, but the user-visible feature
  still needs implementation or broader host validation.
- **Roadmap** — captured as a detailed design/TODO item but intentionally not
  implemented yet.

## Requested functionality

| Status | Request | Implementation / evidence |
| --- | --- | --- |
| **Shipped** | Render frontmatter attributes that contain lists using a GitHub-like presentation instead of a plain string. | String lists render as chips; maps and list-of-maps (including `generated` and `sources`) render as structured tables. See `packages/vscode-extension/webview-src/extensions/hybridFrontmatter.ts`, `hybridTables.ts`, and the Markdown rendering tests. The live Cursor smoke also showed chips and structured `generated`/`sources` tables. |
| **Shipped** | Keep an image's raw Markdown line visible with its rendered image, like old Obsidian, preserve image copy/paste behavior, and expand from the inline location. | Image widgets now retain the raw source line in both active and inactive states; single-click still activates that source, double-click opens the focused full-pane dialog, and the clipboard adapter preserves Markdown image syntax. See `hybridImages.ts`, `hybridRendering.ts`, and `markdownClipboard.ts`. The image-focused Playwright set passed 22/22; live Cursor verification showed the inactive source line, then opened and closed the dialog from the inline image. |
| **Roadmap** | Give the custom Markdown editor Git diff parity with the built-in editor. | Detailed design and acceptance criteria are in [TODO.md](TODO.md) under “Git-aware diff mode”. No diff UI is claimed as shipped. |
| **Partial** | Reuse David Anson's `markdownlint` and provide diagnostics plus an explicit lint action. | `markdownlint@^0.40.0` is declared and `src/markdownLint.ts` provides the host-side content adapter; its delegation test passes. Diagnostics, configuration discovery, range mapping, and `Lint Markdown` commands remain in [TODO.md](TODO.md). |
| **Shipped** | Maintain a detailed project TODO/roadmap. | [TODO.md](TODO.md) is the source of truth and includes outcomes, integration points, edge cases, and verification criteria. |
| **Shipped** | Do not attach the whole Markdown file when a selection is requested; attach the exact selected lines. | Markdown handoffs use the original URI and inclusive line range. Cursor uses a selection pill; Codex/Claude adapters receive the same range or an exact source mention. Covered by `agentHandoff` and activation tests. |
| **Shipped** | Make the code text and selection overlay slightly dimmer without turning it into unreadable gray. | Theme tokens use the editor's inactive-selection and code-token colors in `markdown-editor.ts` and `hybridStyles.ts`; inline-code link labels blend the link tint with the editor foreground and use the same subtle opacity as active code. E2E coverage guards both the active code token and the `runs/speedrun.sh` link rendering. |
| **Shipped** | Put “Add to Chat” above the selected line block so it does not cover the line-number selection area. | Selection actions are rendered in the host selection toolbar and the current Cursor smoke showed the toolbar above the selected block (lines 22–24). |
| **Shipped** | Keep `source` and `generated` structured values usable in the property view. | Structured cells expose labeled edit controls and commit back to the original frontmatter shape. The active input now hides the old display button, preventing duplicate/overlapping long URLs; Enter/blur commits and Escape cancels. The regression test covers `sources[0].resource`. If a future product decision makes either field strictly read-only, that should be a separate explicit change. |
| **Shipped** | Fix the `speedrun.sh` rendering regression. | The link/rendering path now keeps the source link as one rendered link rather than duplicating the source text; the full extension test/build gate is green. |
| **Shipped** | Preserve the cursor and scroll position across Vim `y`/`p` operations and host shortcut focus restoration. | The editor sends selection-preserving `restoreFocus` messages and provider tests cover the focus path; the full extension suite is green. |
| **Shipped** | Restore Add to Codex using the generated file/range attachment path where the provider requires it. | Codex handoff tests cover exact range selection, immutable fallback exports, attachment failure, and editor restoration. |
| **Shipped** | Send Add to Claude into the existing Claude surface instead of opening an extra editor window when the sidebar insertion command is available. | Cursor now reveals `claude-vscode.sidebar.open` before the temporary native selection handoff, so Claude's `editor.openLast` fallback is not triggered. Handoff tests cover reuse of the existing sidebar and exact source mentions; the fallback editor path is only used when no stable sidebar surface exists. A live Cursor smoke attached `@projects/nanochat.md#20-23` to the existing Claude composer without creating a second editor tab. |
| **Shipped** | Make Add to Chat attach the exact selected lines to Cursor. | The new activation test covers the handoff context state. In the live Cursor smoke, `⌘L` added `nanochat.md (22–24)` to the existing composer without submitting or opening a second editor group. |
| **Shipped** | Add `Ctrl/Cmd+L` for the Cursor Agent composer and `Esc` to return to the Markdown editor. | `llm-wiki.addSelectionToChat` already handled the Cursor host; this change adds `llmWikiAgentHandoffActive`, registers `llm-wiki.focusMarkdownEditor`, and contributes a guarded `Escape` binding. Live Computer Use confirmed the exact range pill remained in the existing composer after `⌘L`; `Esc` returned the selection to the Markdown editor while leaving the composer open. |
| **Intentional scope boundary** | Add direct keyboard shortcuts for Codex and Claude as well. | Not added in this iteration. The agreed target is the Cursor Agent composer first; Codex/Claude remain available from the selection toolbar and explicit provider commands. Their shortcuts can be designed separately without changing the Cursor `⌘L` contract. |

## Verification record

Automated verification completed during this session:

- `pnpm check` — lint, typecheck, core tests, and **486** VS Code-extension
  tests passed.
- Focused activation/manifest tests passed, including the new Cursor handoff
  context and guarded Escape command tests.
- Production webpack build completed successfully as part of the extension
  test gate.
- `git diff --check` passed before the live smoke.
- The structured-property regression test passed after reproducing the overlap:
  the hidden display button has no layout box while `sources[0].resource` is
  edited, and the replacement URL is persisted after Enter.

Live Computer Use verification in Cursor's Extension Development Host:

1. Reloaded the host after the production build.
2. Selected Markdown lines 22–24 in `projects/nanochat.md`.
3. Pressed `⌘L`; the existing Cursor composer received the pill
   `nanochat.md (22–24)` and no extra editor group was opened.
4. Pressed `Esc`; the selection remained in the Markdown editor and the agent
   composer stayed open.
5. The same view showed the image source line next to the rendered image even
   while the image line was inactive,
   metadata chips/tables, and the selection toolbar above the selected block.
6. After the structured-property fix, opened `sources[0].resource` in the live
   Cursor host; the input occupied the cell without a duplicate URL underneath,
   then pressed `Esc` and confirmed the editor closed without changing the note.
7. Selected lines 20–23 and used **Send to Claude Code**; the existing Claude
   sidebar received `@projects/nanochat.md#20-23`, with no extra Claude editor
   tab left open after the handoff.

The live check intentionally did not submit a message to an external agent.
