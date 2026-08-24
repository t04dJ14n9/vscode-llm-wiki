# LLM Wiki for VS Code: current implementation

## Extension activation

Activation registers the Markdown/PDF/anchor custom editors, URI dispatcher,
backlinks/forward links, outlines, selection handoff, and optional browser
reader. With an open workspace it also creates `QueryAnnotationIndex`, its
bounded filesystem watchers, legacy read adapter, and project features. Without
a workspace the viewers remain read-only.

## Query model

`queryAnnotationIndex.ts` exports the lifecycle, Markdown/PDF/code anchor union,
navigation targets, annotation model, resolvers, deterministic ordering, bounded
scanner, legacy adapter, and debounced watcher registration.

Valid Queries carry `condensed_summary`, generated/lifecycle metadata,
`conversation.selection_id`, provenance sources, and source-ID-bound anchors.
The index keeps in-memory maps by normalized source path, Query path, and
selection ID. It writes nothing.

## Markdown integration

`MarkdownEditorProvider` asks the index for the current workspace-relative
source, resolves Markdown anchors against the in-memory document text, and sends
only safe ranges to the webview. The webview groups identical ranges, preserves
legacy note compatibility, displays ordered condensed answers, supports hover,
focus, caret, pin/Escape/outside-click behavior, and posts a validated
`openQuery` navigation target.

## PDF integration

`PdfEditorProvider` hashes the exact PDF bytes, requests annotations for the
source, resolves only PDF anchors whose stored hash matches, and sends page/
rectangle geometry to the viewer. The viewer draws a dedicated Query layer
after each page render, groups identical regions, repaints through zoom/lazy
rendering, and retains normal selection/search/link layers. Query strings are
rendered with DOM text nodes.

## Vault tooling

`tools/llm-wiki` builds immediate-child `_index.md` files and validates three
explicit layers: `okf-base`, `karpathy-vault-v1`, and `project-policy`. Checks
cover project placement, repository bindings, historical Git hashes,
currentness, raw immutability, binary/LFS attachments, workbench roles, Query
anchors, Entity/Concept creation metadata, links, and runtime state.

`_index.md` and `_log.md` are canonical regular files. Unprefixed variants and
navigation/log symlinks fail validation.

## Removed architecture

New conversations are not stored by `LearningNoteStore`, PDF discussion
sidecars, JSON-LD mirrors, screenshots, or an app-server controller. The old
`wiki/learning` parser and open command remain read-only for one compatibility
release. The removed Ask PDF panel/backend is not part of the build.

## Verification

Run Python producer tests and demo validation, then TypeScript lint/typecheck,
unit tests, production build, focused browser tests, and VS Code-host E2E. Git
LFS inspection must use working-tree attributes for unstaged migrations because
`git lfs ls-files` reports index paths until changes are staged.
