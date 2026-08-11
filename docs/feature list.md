# Human Learning: Current Feature List

> This document describes the simplified combined desktop extension. For the
> system boundaries and data flows, see
> [Architecture and VS Code Integration](architecture-and-vscode-integration.md).

Human Learning turns an ordinary Git repository into a source-linked learning
workspace in VS Code or Cursor. Repository files, rather than a database, are
the durable source of truth.

## 1. Product boundary

| Capability | Current release |
| --- | --- |
| Desktop host | VS Code and compatible desktop hosts such as Cursor |
| Distribution unit | Combined `human-learning-vscode` extension |
| Markdown and PDF reading | Included |
| Markdown/PDF selection handoff | Active supported agent draft, never submitted automatically |
| Web selection handoff | Cursor Browser capture plus an Experimental Web Reader for stock VS Code |
| Selection-based, multi-turn questions | Included in the separate Ask PDF panel |
| Durable learning records | Markdown under `wiki/learning/` |
| PDF runtime state | v1 JSON sidecar under `.hl/annotations/pdf/` |
| Portable PDF annotation mirror | Per-annotation W3C-shaped JSON-LD |
| Graph, daily review, and safe Git update | Included |
| Built-in agent provider | Local Codex app-server |
| External agent handoff | Codex, Claude Code, Cursor Agent, and CodeBuddy |
| MCP and `hl` CLI | Optional legacy/headless surfaces |
| SQLite | Not used or shipped by the combined extension |
| Standalone Markdown/PDF extensions | Legacy; excluded from the simplified release |
| Web or mobile app | Out of scope |

No vault initialization is required. The extension works from the first
workspace folder that contains the learner's Markdown, PDFs, and Git history.

## 2. Markdown reading and editing

The custom Markdown editor keeps the VS Code `TextDocument` as its backing
document and uses CodeMirror 6 in the webview. This preserves ordinary save,
undo, file-watch, and Git behavior.

Current rendering and interaction include:

- Obsidian-like title and YAML properties;
- headings, emphasis, links, images, task lists, tables, callouts, comments,
  tags, footnotes, and reference links;
- MathJax inline and display math;
- Prism-highlighted fenced code;
- Mermaid diagrams, including horizontally scrollable wide diagrams;
- raw Markdown copy/paste and HTML-to-Markdown paste conversion;
- optional Vim mode and supported host shortcuts;
- VS Code editor typography and theme colors.

Active content remains editable as raw Markdown. Rendering is decoration and
widget state; the repository never receives an alternate rich-text format.

## 3. Add a Markdown selection to Chat

With non-empty text selected, the learner can:

- use the automatic **Cmd+L Add to Chat** selection prompt;
- right-click **Add to Chat**;
- press `Cmd+L` on macOS or `Ctrl+L` elsewhere.

All three surfaces use the same shared handoff. The extension exports:

- the exact selected quote in `selection.md`;
- structured provenance in `selection.json`;
- repository-relative source path;
- line range and character offsets.

Human Learning prefers a visible Codex or Claude editor chat through stable VS
Code APIs, then a selected Cursor composer when that private capability is
available. Ambiguous sidebar-only cases show a picker. The chosen provider
receives the immutable export as draft context; Human Learning never
auto-submits or scrapes the answer. Empty selections do not trigger the
handoff.

### Web selections

In Cursor, **Add Cursor Browser Selection to Chat** uses feature-detected
Browser commands to capture exact selected text, bounded surrounding context,
the active page URL, and a validated selection crop. It verifies that the same
tab, URL, and selection remain active across capture; if Cursor does not expose
the required commands, the capability stays unavailable.

Stock VS Code cannot inspect the built-in Simple Browser's foreign webview.
**Open Experimental Web Reader** therefore provides a separate extension-owned
experiment for public pages. It fetches through a guarded host path, sanitizes
the page into a script-free reader, and can attach selected text plus a
synthetic context image. It intentionally does not support authenticated
sessions, cookies, forms, scripts, or remote media.

## 4. Markdown annotations

Learning notes contain the exact quote plus source line and character offsets.
When the source Markdown file opens, the extension reconstructs annotations
directly from those notes.

The editor highlights the passage and shows a **✦ Note** action. Hovering the
highlight, focusing the action, or moving the caret inside the exact annotation
range shows a floating summary with the latest previous question and concise
answer. Selecting **✦ Note** validates the repository-relative path and opens
the complete human-readable learning note. It does not restore a sidebar
transcript.

If character offsets are stale after an edit, the editor falls back to finding
the stored exact quote.

## 5. PDF reading and discussions

The custom PDF editor renders local files with EmbedPDF/PDFium. Current viewer
features include:

- local, offline rendering;
- page navigation, zoom, fit-width, continuous scroll, and two-page layout;
- selectable text and portable page/text-fragment links;
- PDF and Markdown side-by-side layout;
- selection highlights and an Ask PDF discussion panel;
- multi-turn questions, retry/cancel state, and model selection;
- a best-effort selection screenshot for every newly asked annotation;
- **Add to Chat** in the selection context menu and toolbar, plus the
  `Cmd+L` / `Ctrl+L` shortcut;
- opening the corresponding learning note.

Ask PDF requires a single-page text selection with rectangle geometry. The
selection supplies the canonical extracted quote, page number, context, text offsets when
available, portable source URL, and normalized
`[left, top, right, bottom]` rectangles in PDF points from a top-left origin.
PDFium line-wrap hyphens may be normalized out of the quote; the rectangles
and crop preserve the visual source.

For a PDF inside the repository, three file-backed records cooperate:

| Record | Path | Role |
| --- | --- | --- |
| Learning note | `wiki/learning/*.md` | Human-readable Q&A truth, quote, summary, source link, and review dates |
| v1 runtime sidecar | `.hl/annotations/pdf/<pdf-sha256>.json` | Current viewer geometry, messages, and turn/UI state |
| Portable mirror | `.hl/annotations/pdf/<pdf-sha256>/<annotation-id>.jsonld` | W3C-shaped quote, page, geometry, and available learning-note/snapshot metadata for migration/interchange |

The JSON-LD mirror is not yet the viewer's canonical store. The current viewer
reloads the v1 sidecar. A separate core scanner API can read the mirror's
`TextQuoteSelector.exact`, but the filesystem wiki and graph do not consume
portable annotations yet.

For every newly asked annotation, Ask PDF attempts a PNG screenshot of the
selection union with 24 PDF points of padding, clamped to the page. Successful
snapshot metadata records `[left, top, right, bottom]`, `padding: 24`, and
`unit: "pt"` alongside its PNG reference, hash, and pixel dimensions. A failed
capture is non-fatal: the canonical quote, page, and multi-rectangle anchor remain
valid and the question continues with text-only context.

The PNG lives below `.hl/annotations/pdf/assets/`. The readable source quote,
summary, and full Q&A are written to the matching `wiki/learning/*.md` after an
assistant answer exists. Markdown alone cannot reconstruct PDF geometry, while
the runtime sidecar alone is not the portable interchange representation.

For a PDF outside the workspace, viewer state uses the extension's
host-controlled global storage rather than writing beside an unrelated file;
portable JSON-LD mirrors are emitted only for repository-managed PDFs.

## 6. Portable source links

Learning notes use ordinary Markdown-compatible destinations:

| Source | Example |
| --- | --- |
| Markdown line | `[Open source](../../notes/attention.md#L12)` |
| Markdown line range | `[Open source](../../notes/attention.md#L12-L14)` |
| PDF page | `[Open source](../../papers/paper.pdf#page=7)` |
| PDF text fragment | `[quote](../../papers/paper.pdf#page=7:~:text=selected%20text)` |
| Code line range | `[kernel](../../src/kernel.ts#L42-L57)` |
| Web URL | `[article](https://example.com/article)` |
| Wikilink | `[[Online Softmax#Why it works]]` |

Visible learning-note links are relative to the note itself, so they survive a
clone or repository move. The extension does not persist local `file://` URLs
for workspace sources.

## 7. Filesystem wiki, backlinks, and outline

The extension scans repository Markdown directly. It parses:

- normal Markdown links;
- Obsidian wikilinks, aliases, and heading targets;
- same-note headings and block references;
- image embeds and local asset references.

From those files it derives:

- Backlinks and Forward Links tree views;
- the active-note Outline;
- missing-note and missing-heading diagnostics;
- note-to-note graph edges.

There is no persisted link index. Changes are refreshed through workspace file
events and can always be reconstructed from Markdown.

The core package also exposes a narrow scanner for portable PDF JSON-LD
mirrors. It is currently a migration/interchange API, not an input to the
filesystem wiki, link trees, graph, or PDF viewer.

## 8. Concept and entity graph

**Human Learning: Show Knowledge Graph** opens a CSP-safe SVG graph derived from:

- explicit links between Markdown notes;
- `concepts` and `entities` YAML frontmatter.

Supported metadata forms include inline and block string lists:

```yaml
---
concepts: [Spaced repetition, Retrieval practice]
entities:
  - Hermann Ebbinghaus
  - SuperMemo
---
```

Concepts and entities are normalized and deduplicated case-insensitively while
remaining distinct node types. The visualization uses different shapes/styles,
a legend, and an accessible text fallback. It does not infer relationships
that are absent from Markdown or frontmatter.

## 9. Daily note and review plan

**Human Learning: Open Today's Learning Note** creates or refreshes:

```text
wiki/daily/YYYY-MM-DD.md
```

It contains:

- a manual **Today** area for priorities, TODOs, and reflection;
- due learning-note reviews;
- unchecked ordinary TODOs carried from the latest earlier daily note.

Every learning note receives fixed review dates 1, 3, 7, 14, 30, 60, and 90
days after its local creation day. Due items remain visible until checked.
Later daily notes preserve completed note/date review pairs, while unchecked
overdue items remain due. Generated review checkboxes are not accidentally
carried as ordinary TODOs.

Regeneration updates marked generated regions while preserving manual text and
current checkbox state.

## 10. Safe remote update

**Human Learning: Pull Latest Wiki Content** follows a conservative Git policy:

1. require a Git repository;
2. fetch and prune remote refs without touching working files;
3. require an upstream and refuse any merge with a dirty working tree;
4. report up-to-date or local-ahead state;
5. fast-forward when possible;
6. ask before creating a real merge.

The command never pushes, commits, resets, stashes, or deletes user files.
Learners review generated notes and sidecars with their normal Git workflow.

## 11. Agent and security behavior

Ask PDF starts Codex lazily through `codex app-server --listen stdio://`.
Its question threads run with a read-only sandbox and no approvals. The agent
explains the supplied source; it does not edit the repository. The extension
performs serialized, atomic learning-note writes after Ask PDF answers finish.

External handoff is separate: it updates the chosen agent draft with
`selection.md` and, when supported, an optional validated `selection.png`. It
never auto-submits and external answers remain owned by that provider.

Webviews have restrictive content-security policies and send validated
messages to the extension host. Untrusted agent text is rendered as text rather
than injected HTML. External links use VS Code's external URL API.

**Send Selection to Agent…** writes the exact Markdown selection or canonical
PDF extracted quote and anchor to
an immutable `.hl/agent/exports/<id>/` snapshot and refreshes
`.hl/agent/selection.md` and `.json` as latest-export aliases. It detects
supported commands at runtime, then lets the learner attach the snapshot's
Markdown context file to Codex, Claude Code, Cursor Agent, or CodeBuddy. This
is a local context handoff, not a second question-service implementation: only
Ask PDF streams answers back and persists the resulting Q&A automatically.

**Add to Chat** is the direct version of that shared handoff for an
exact Markdown selection or canonical PDF extracted quote. Markdown exposes an automatic selection
prompt and context-menu action; PDF exposes context-menu and selection-toolbar
actions. Both accept `Cmd+L` / `Ctrl+L` and attach
`.hl/agent/exports/<id>/selection.md` first. A PDF may also attach the immutable
sibling `selection.png` when the best-effort crop passes validation and can be
saved. The stable `.hl/agent/selection.{md,json,png}` paths remain latest-export
aliases. Crop save or attachment failure warns and continues text-only. It
prefers active editor-area agent chats using stable VS Code APIs, uses Cursor's
selected-composer probe only when available, and asks when the target is
ambiguous. It never submits the draft, and external answers are not
automatically persisted.

## 12. Optional and legacy surfaces

MCP can be useful when an external agent host needs discoverable, structured
wiki tools. The `hl` CLI can be useful for scripted migration, linting, imports,
or CI. Neither is required by the combined desktop workflow.

The monorepo still contains database-backed core modules, the CLI, MCP server,
and split Markdown/PDF packages for historical compatibility. The active
combined extension imports the filesystem-only `core/lite` entry and excludes
SQLite, `sql-wasm.wasm`, and `.hl/index.sqlite` from its runtime.

## 13. Verification commands

```bash
pnpm --filter human-learning-vscode exec tsc --noEmit
pnpm --filter @human-learning/core test
pnpm --filter human-learning-vscode test
pnpm exec playwright test --config playwright.config.ts
```

Browser tests cover the Markdown and PDF webviews. A release should also be
smoke-tested in real VS Code and Cursor sessions to prove custom-editor,
selection-prompt, context-menu, shortcut, Ask PDF, and composer behavior.
