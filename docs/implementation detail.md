# Human Learning: Current Implementation Detail

> This document describes the simplified combined desktop implementation. The
> architectural rationale and user-facing flow are in
> [Architecture and VS Code Integration](architecture-and-vscode-integration.md).

## 1. Active package boundary

The release artifact is `packages/vscode-extension`. It contains both custom
editors, repository services, shared agent handoff, and command orchestration.

```text
packages/vscode-extension
  src/                    extension-host code
  webview-src/            Markdown editor and experimental web-reader webviews
  dist/                   combined release bundle

packages/pdf-editor
  src/webview/            PDF viewer and Ask PDF user interface

packages/core
  src/lite.ts             filesystem-only types/store used by the extension
  src/pdf-discussions/    v1 sidecar, portable JSON-LD mirror, and scan API
  src/...                 legacy database/search modules, not in the release bundle
```

The extension build compiles core first, then its Webpack configuration aliases
`@human-learning/core` to `packages/core/dist/lite.js`, generated solely from
`src/lite.ts`. That entry exports portable-link classification, the file-backed
PDF discussion store, and the portable annotation mapper/scanner API. It
deliberately excludes database, ingestion, search, embeddings, activity, and
legacy review imports.

The following monorepo packages remain for historical or optional workflows but
are not shipped in the simplified release:

```text
packages/cli
packages/mcp-server
packages/vscode-markdown-extension
packages/vscode-pdf-extension
```

## 2. Combined extension output

`pnpm --filter human-learning-vscode build` emits:

| Artifact | Purpose |
| --- | --- |
| `dist/extension.js` | Node/Electron extension host |
| `dist/markdown-editor.js` | CodeMirror Markdown webview |
| `dist/pdf-viewer.js` | EmbedPDF/PDFium webview |
| `dist/experimental-owned-browser.js` | Sanitized experimental web-reader webview |
| `dist/pdfium.wasm` | Local PDF renderer |

The combined output does not include `sql.js`, `sql-wasm.wasm`, a SQLite
binding, or a required `.hl/index.sqlite`.

The split-package build scripts still exist for compatibility testing. They are
not the simplified product or its packaging path.

## 3. Activation and host integration

[`src/extension.ts`](../packages/vscode-extension/src/extension.ts) is the one
entry point for VS Code and Cursor. It registers:

- `human-learning.markdownEditor`;
- `human-learning.pdfViewer`;
- Backlinks and Forward Links in the Human Learning activity view;
- context-aware Markdown Outline and PDF Outline panels in the main Explorer
  sidebar;
- source navigation, selection, daily-note, graph, Git-sync, Markdown, and PDF
  commands;
- Cursor Browser capture and the extension-owned Experimental Web Reader
  commands;
- a debounced Markdown watcher that refreshes file-derived views and source
  annotations.

The implementation currently uses the first workspace folder as its repository
root. Without an open folder, the Markdown and PDF viewers still register, but
learning notes, graph, daily review, and Git commands display a workspace
requirement instead of creating hidden state.

The same manifest and JavaScript bundle run in Cursor through its VS Code
extension API. There is no Cursor-specific persistence layer or UI fork.

## 4. Durable file model

The active runtime has no opaque knowledge database. Durable state is:

| Path | Responsibility |
| --- | --- |
| user-chosen `*.md` | authored notes and source material |
| user-chosen `*.pdf` | original PDF sources |
| `wiki/learning/*.md` | readable source quote, summary, full Q&A, and review dates |
| `wiki/daily/*.md` | manual daily plan, carried TODOs, and due reviews |
| `.hl/annotations/pdf/<sha256>.json` | current v1 PDF discussion/viewer state |
| `.hl/annotations/pdf/<sha256>/<annotation-id>.jsonld` | portable per-annotation mirror |
| `.hl/annotations/pdf/assets/…` | best-effort bounded PNG selection screenshots |
| `.hl/agent/selection.{md,json,png}` | latest handoff aliases; PNG exists only for a validated PDF crop |

These are ordinary files. Git provides diff, history, merge, remote update, and
recovery. There is no required ingest step: commands retaining the old
“refresh/ingest” wording simply rescan filesystem content.

### Three coordinated PDF records

The current migration state deliberately writes three representations:

1. `wiki/learning/*.md` is the Q&A authority. It contains the exact Markdown
   quote or canonical PDF extracted quote, portable source link, concise
   answer, full transcript, and review schedule.
2. `.hl/annotations/pdf/<pdf-sha256>.json` is the v1 runtime sidecar used by
   the PDF UI. It contains geometry, text offsets, selection identity,
   transcript/turn state, summary state, and snapshot metadata.
3. `.hl/annotations/pdf/<pdf-sha256>/<annotation-id>.jsonld` is the portable
   W3C-shaped mirror. It stores relative repository IRIs, quote/page/geometry
   selectors, the learning-note body link when available, and snapshot
   metadata.

The v1 sidecar remains the viewer/controller compatibility store; JSON-LD is
not yet its replacement. `scanPortablePdfAnnotations()` is a core
migration/interchange API that reads `TextQuoteSelector.exact`, page, and
geometry from mirrors. `filesystemWiki`, `KnowledgeGraphPanel`, and
`PdfEditorProvider` do not consume that scan result.

The overlap keeps the learning record readable, the current viewer stable, and
the source anchor portable. All three are filesystem/Git state rather than a
database or generated SQLite index.

[`portable.ts`](../packages/core/src/pdf-discussions/portable.ts) serializes
the mirror with:

- `TextQuoteSelector.exact` plus prefix/suffix when available;
- an RFC 8118 `FragmentSelector` whose value is `page=N`;
- `hl:PdfRectSelector` rectangles in `pt`, top-left origin, with
  `left,top,right,bottom` coordinates;
- optional PDF text-item offsets and `hl:snapshot` metadata.

For a PDF outside the repository, v1 runtime state is stored below the
extension's host-controlled global storage. If that PDF later opens inside a
repository, the store can import matching content-addressed state; portable
JSON-LD mirrors are emitted only for repository-managed PDFs.

## 5. Markdown custom editor

[`src/markdownEditorProvider.ts`](../packages/vscode-extension/src/markdownEditorProvider.ts)
owns host synchronization. Each open webview panel has its own handle, even if
the same document is visible in another group. The provider:

- keeps VS Code's `TextDocument` as canonical content;
- applies webview edits with `WorkspaceEdit`;
- mirrors external document changes back to the webview;
- requests the current live selection from the active panel before handoff;
- passes exact offsets and source context to the host;
- loads learning annotations for the active source file.

[`webview-src/markdown-editor.ts`](../packages/vscode-extension/webview-src/markdown-editor.ts)
owns CodeMirror interaction and rendering. Its `requestSelection` response
prevents a menu or keyboard handoff from using a stale host-side selection. A
non-empty selection reveals a compact **Cmd+L Add to Chat** prompt;
`Cmd+L` on macOS and `Ctrl+L` elsewhere invoke the same action as the context
menu.

Learning-note annotations arrive as quote/offset records. The webview highlights
the stored range and renders **✦ Note**. The same resolved range drives a
floating previous-question/answer summary on hover, marker focus, or a collapsed
caret inside `[from, to)`. If offsets no longer match, exact-quote search
provides a conservative fallback rather than guessing a fuzzy location.

## 6. Markdown agent handoff

```text
selection
  -> exact source packet
  -> immutable .hl/agent/exports/<id>/selection.md
  -> active supported agent draft
  -> learner reviews and submits
```

The automatic selection prompt, context menu, and `Cmd+L` / `Ctrl+L` shortcut
all dispatch the provider-neutral `human-learning.addSelectionToChat` command.
The legacy `human-learning.addSelectionToCursorChat` ID remains an internal
compatibility alias for older webview bundles. The shared `agentHandoff.ts`
router prefers stable editor-tab evidence, uses feature-detected Cursor support
only as a fallback, asks when ambiguous, never submits, and does not read the
resulting external conversation.

### Web selection capture

Cursor hosts expose private, feature-detected Browser commands that let the
extension read the active selection, collect bounded surrounding text, verify
the active tab and URL before and after capture, and request a validated PNG
crop. Stock VS Code does not expose another extension's Simple Browser DOM or
pixels, so Human Learning does not attempt to inspect it.

For stock VS Code and portable testing, **Open Experimental Web Reader** opens
an extension-owned, script-free reading surface. The host fetches only
revalidated public HTTP(S) addresses with redirect, timeout, and size limits;
the webview sanitizes the response and strips scripts, forms, credentials,
remote media, and active page behavior. Its Add to Chat action attaches exact
selected text, bounded before/after context, portable URL metadata, and an
optional synthetic context image. Both browser paths use the same provider
router and never submit the draft.

Clicking a saved Markdown annotation invokes
`human-learning.openLearningDiscussion` for compatibility. The host confines
the requested path to `wiki/learning/`, checks that its frontmatter ID matches,
and opens the durable Markdown note. It does not restore a Learning Chat
sidebar or start an agent thread.

## 7. Learning-note store

[`src/learningNoteStore.ts`](../packages/vscode-extension/src/learningNoteStore.ts)
uses the discussion ID as identity. A short deterministic hash appears in the
filename, allowing a restart to find the same note by scanning
`wiki/learning/` rather than querying an index.

Each file contains:

- validated frontmatter;
- workspace-relative POSIX source path and portable link;
- Markdown line/character offsets when available;
- exact Markdown text or canonical PDF extracted quote;
- latest question and first-paragraph answer summary;
- complete ordered Q&A;
- hidden per-message markers used for lossless transcript recovery;
- fixed review dates;
- a marked manual-notes region.

Writes for the same discussion are serialized. The replacement is written to a
temporary file and atomically renamed. Existing manual-note content is
preserved during regeneration. Local `file://` URIs are removed from persisted
workspace links.

## 8. PDF viewer and discussion path

[`src/pdfEditorProvider.ts`](../packages/vscode-extension/src/pdfEditorProvider.ts)
reads bytes with `vscode.workspace.fs` and sends them to the PDF webview.
EmbedPDF/PDFium renders locally.

Ask PDF uses a single-page text selection with non-empty rectangle geometry.
The webview supplies:

- page and quote;
- prefix/suffix context;
- normalized `[left, top, right, bottom]` rectangles in PDF points from a
  top-left origin;
- start/end text-item and character offsets when available;
- a portable page/text-fragment URL;
- a best-effort, size-limited PNG screenshot for a new asked annotation.

The screenshot attempt covers the union of the selection rectangles with 24
PDF points of padding, clamped to the page. A successful snapshot stores
`cropRect: [left, top, right, bottom]`, `padding: 24`, and `unit: "pt"` together
with its repository-relative file, SHA-256, MIME type, and pixel dimensions.
Capture failure leaves the text/page/rectangle anchor valid and submits
text-only context.

[`src/pdfDiscussionController.ts`](../packages/vscode-extension/src/pdfDiscussionController.ts)
validates input, manages Codex turns, streams deltas, and updates the sidecar.
The underlying
[`PdfDiscussionStore`](../packages/core/src/pdf-discussions/store.ts):

- validates a versioned schema;
- keys repository sidecars by PDF SHA-256;
- uses a lock and conflict checks for concurrent writers;
- writes atomically;
- verifies snapshot path, hash, size, dimensions, and all-or-none crop
  metadata;
- writes or refreshes the per-annotation JSON-LD mirror for repository PDFs;
- leaves malformed sidecars untouched and reports an error.

After an assistant message exists, `PdfEditorProvider` also upserts the
corresponding `wiki/learning/*.md` and refreshes the mirror with its relative
body link. Opening the PDF later still reloads the v1 JSON rectangles and
discussion state, reconstructs page highlights, and exposes the learning-note
link. Follow-ups in the PDF Ask panel coordinate the Markdown note, v1
sidecar, and portable mirror.

## 9. Agent transport

[`src/codexAppServerClient.ts`](../packages/vscode-extension/src/codexAppServerClient.ts)
starts `codex app-server --listen stdio://` lazily for Ask PDF and communicates
through JSON-RPC.

Ask PDF uses:

- a read-only sandbox;
- no approval requests;
- explicit source/context prompts;
- incremental answer deltas;
- bounded input validation and cancellation/error handling.

The extension, not the agent, owns Ask PDF's durable file writes. A separate
[`agentHandoff.ts`](../packages/vscode-extension/src/agentHandoff.ts) path
exports exact Markdown text or the canonical PDF extracted quote to
`.hl/agent/selection.*` and attaches the immutable Markdown export to an
available Codex, Claude Code, Cursor Agent, or CodeBuddy sidebar.

**Add to Chat** exposes that shared path in both custom editors; the PDF path
may attach a validated crop PNG beside `selection.md`. The router updates the
chosen provider's draft and never submits it. External answers remain owned by
the provider and are not automatically written into Human Learning notes.

## 10. Filesystem wiki and graph

[`src/filesystemWiki.ts`](../packages/vscode-extension/src/filesystemWiki.ts)
recursively reads Markdown while excluding internal/build paths. It derives
notes, headings, Markdown links, wikilinks, backlinks, forward links, broken
targets, and graph edges in memory.

YAML `concepts` and `entities` accept inline or block string lists. Values are
normalized and deduplicated case-insensitively. Invalid or ambiguous metadata
is ignored instead of inferred.

[`src/backlinksProvider.ts`](../packages/vscode-extension/src/backlinksProvider.ts)
feeds the link trees.
[`src/knowledgeGraphPanel.ts`](../packages/vscode-extension/src/knowledgeGraphPanel.ts)
renders a CSP-safe SVG with distinct note, concept, and entity nodes, an honest
legend, and accessible text fallback. The graph contains only explicit
Markdown/frontmatter relationships.

The separate core `scanPortablePdfAnnotations()` API walks only
`.hl/annotations/pdf/<sha256>/*.jsonld`. It is tested as a migration and
interchange surface but is not wired into this Markdown wiki or graph path.

## 11. Daily notes

[`src/dailyNotes.ts`](../packages/vscode-extension/src/dailyNotes.ts) creates or
refreshes `wiki/daily/YYYY-MM-DD.md` using the desktop's local calendar date.

It scans learning-note frontmatter for reviews due on or before the requested
date. The fixed offsets are 1, 3, 7, 14, 30, 60, and 90 days. Completed
note/date review pairs are found in earlier generated review regions and
suppressed; overdue unchecked reviews remain visible.

Unchecked ordinary TODOs are carried from the latest prior daily note. Review
checkboxes are excluded from that TODO carry. Marker-delimited generated
sections can be updated without replacing manual prose or current checkbox
state.

## 12. Git synchronization

[`src/repositorySync.ts`](../packages/vscode-extension/src/repositorySync.ts)
uses Git as a conservative transport:

1. validate the repository;
2. fetch and prune remote refs without touching working files;
3. validate the upstream and refuse any merge for a dirty worktree;
4. compare local and upstream ancestry;
5. fast-forward when possible;
6. return `merge-required` for divergence;
7. merge only after the command obtains explicit confirmation.

The implementation does not push, commit, reset, stash, delete, or resolve
conflicts on the user's behalf.

## 13. URI dispatch

[`src/uriDispatcher.ts`](../packages/vscode-extension/src/uriDispatcher.ts)
classifies ordinary destinations:

| Kind | Behavior |
| --- | --- |
| Markdown/note | Open custom Markdown editor and reveal heading/block/line |
| Code | Open native text editor and reveal `#Lx-Ly` |
| PDF | Open custom PDF viewer at page/text fragment |
| Web | Use `vscode.env.openExternal` |
| Image/text | Open the local file |
| Unknown | Report an error |

Relative destinations in generated learning notes resolve against the
containing note. Workspace-root-style destinations remain supported. This
keeps source links portable after clone or repository relocation.

## 14. Security and reliability

- Webviews use content-security policies and validated host messages.
- Agent output is inserted with text-safe rendering, not arbitrary HTML.
- Opening a Markdown annotation confines its note path to `wiki/learning/` and
  verifies the stored ID.
- PDF sidecars use schema validation, lock files, atomic writes, and
  content-addressed routing.
- Portable annotation paths remain repository-relative; the scanner ignores
  damaged records and symbolic-link escapes.
- Screenshot capture failure is non-fatal and never erases the source anchor.
- Agent threads cannot modify the repository.
- Git sync refuses dirty state and requires consent for divergence.
- Exact quotes and complete transcripts keep summaries auditable.

## 15. MCP, CLI, and SQLite status

MCP is useful as an optional structured tool boundary for external agents. The
CLI is useful for headless migration, linting, import, diagnostics, or CI.
Neither is called by the interactive extension.

Database-backed core and old split-extension code remain only as legacy
surfaces. They should not gain new product dependencies. Once concrete
migration/compatibility consumers are retired, they can be deleted without
changing the filesystem-first desktop architecture.

## 16. Verification

Use scoped commands for the simplified product:

```bash
pnpm --filter human-learning-vscode exec tsc --noEmit
pnpm --filter @human-learning/core test
pnpm --filter human-learning-vscode test
pnpm exec playwright test --config playwright.config.ts
```

The build should contain only the combined host/webview artifacts and
`pdfium.wasm`. Unit tests cover filesystem parsing, learning-note persistence,
annotation opening, daily regeneration, Git decisions, graph rendering, Codex transport,
PDF sidecars, portable annotation mapping/scanning, crop metadata, and
host/webview messages. Playwright covers the rendered Markdown and PDF
interactions.

The final release gate is a real-host smoke test in both VS Code and Cursor,
because browser fixtures alone cannot prove custom-editor, command, selection
prompt, context-menu, shortcut, and composer behavior.
