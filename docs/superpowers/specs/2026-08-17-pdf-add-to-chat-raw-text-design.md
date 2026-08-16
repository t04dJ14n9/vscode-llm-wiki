# PDF Add to Chat Raw Text Design

Date: 2026-08-17

## Status

Approved for implementation by the user's request to stop attaching
`selection.md` and retain the selected passage as raw text.

## Goal

Keep Cursor's direct **Add to Chat** action for PDF selections while removing
the durable `selection.md` export from that interaction.

## Behavior

- The exact PDF source link and selected passage are passed to Cursor as an
  in-memory code-selection payload whose `rawText` contains the agent-ready
  context.
- The original PDF URI identifies the source; no synthetic Markdown document
  is created or attached.
- A successfully captured crop is persisted in the bounded
  `.llm_wiki/agent/clipboard/` image cache and attached as the only file.
- If image persistence or attachment fails, the raw-text selection remains in
  the composer and an actionable warning is shown.
- The action reuses the active Cursor composer and never submits a message.
- Markdown **Add to Chat**, **Copy for Agent**, durable export commands, and
  browser handoff behavior remain unchanged.

## Data Flow

1. The PDF webview sends the single-page selection and optional PNG crop.
2. The extension host validates the selection and formats the same source/text
   context used by **Copy for Agent**.
3. The host persists only the optional PNG in the bounded clipboard image
   cache.
4. The Cursor adapter invokes `composer.addsymbolstocomposer` with the original
   PDF URI and exact raw text, then invokes `composer.addfilestocomposer` only
   for the PNG.

## Acceptance Criteria

- PDF **Add to Chat** does not call `addSelectionToContext`,
  `syncSelectionExportAttachment`, or attach `selection.md`.
- Cursor receives the exact formatted source and selected passage as
  `rawText`.
- The optional PNG remains attached after the raw-text context.
- The active composer is reused and no send/submit command runs.
- Focused tests, the extension suite, lint, typecheck, and build pass.
