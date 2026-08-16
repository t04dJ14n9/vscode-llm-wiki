# LLM Wiki — TODO and Roadmap

This is the maintained backlog for the combined VS Code/Cursor extension. It
is intentionally implementation-oriented: each item states the user-visible
outcome, the likely integration point, and the verification expected before
the item is considered complete.

Status markers:

- `[x]` shipped and covered by automated checks;
- `[~]` partially shipped, experimental, or awaiting host-specific validation;
- `[ ]` planned work.

The historical timelines under `docs/superpowers/` are design records, not the
source of truth for this list.

## Near-term release hardening

### [~] Complete real-host verification

- Verify Markdown editing, save, undo, close, and dirty-file prompts in both
  Cursor and stock VS Code.
- Verify Cmd/Ctrl+W in Vim normal and insert modes for saved, dirty, and
  untitled documents. Electron may consume this accelerator before a webview
  receives it; document the observed host behavior and avoid silently closing
  two editors.
- Verify the secondary Codex and Claude Code panels with the versions that are
  actually available in the host. Treat failures inside an external provider
  extension as provider compatibility findings, not as successful LLM Wiki
  handoffs.
- Repeat the smoke matrix after every extension packaging change and record
  the host version, extension versions, workspace path, and result.

### [~] Marketplace and distribution readiness

- Decide the supported VS Code engine range and pin it in the extension
  manifest.
- Produce a clean VSIX from a fresh checkout and inspect its contents for
  source maps, webview bundles, PDFium/WASM assets, and accidental vault
  files.
- Add a release checklist covering version bump, changelog, README, icons,
  license, repository URL, extension categories, screenshots, and rollback.
- Publish first to an internal/unlisted channel, then to the VS Code
  Marketplace after the real-host smoke matrix passes.
- Document Cursor installation/update behavior separately; marketplace
  availability does not guarantee provider API compatibility in Cursor.

## Markdown editor

### [x] Hybrid live-preview foundations

- CodeMirror-backed editing with VS Code `TextDocument` persistence.
- Rendered headings, links, images, tables, callouts, tasks, comments, tags,
  footnotes, reference links, math, Mermaid, and fenced code.
- Active source lines remain editable while inactive lines render as widgets.
- Raw Markdown copy and HTML-to-Markdown paste are preserved.
- Vim mode, theme-aware caret/selection colors, line-number selection, and
  host shortcut pass-through are covered by browser tests.

### [x] Metadata and image usability

- Render scalar frontmatter as editable values and string lists as chips.
- Render map and list-of-map frontmatter values (for example `generated` and
  `sources`) as readable GitHub-style tables with headers and cells.
- Keep the previous structured-cell display hidden while its editor is open so
  long values such as source URLs are not painted twice or stretched outside
  the table; commit with Enter/blur and cancel with Escape.
- Keep the raw Markdown image line visible beside its preview in both active and
  inactive states, so the source can be copied and edited without losing visual
  context.
- Allow a double-click on the inline preview to open a focused full-pane image
  dialog at the current source location; keep a single click source-selecting
  and retain the explicit keyboard-accessible Expand image button.
- Preserve raw Markdown image syntax when copying a rendered image and when
  pasting rendered image content back into the editor.

### [ ] Git-aware diff mode for the custom Markdown editor

Goal: the custom editor should provide the same practical review workflow as
the built-in VS Code text editor without abandoning the hybrid preview.

- Add a `Compare with HEAD` / `Open File Changes` command for the active note.
- Read the repository's Git index and working-tree version through the trusted
  extension host; never invoke Git from the webview.
- Reuse VS Code's native diff editor where possible, with the custom Markdown
  editor available on either side of the comparison.
- Add an inline diff presentation for hybrid preview mode, including inserted,
  deleted, and modified source lines while keeping widgets aligned.
- Support comparisons against `HEAD`, the index, an arbitrary revision, and a
  selected working-tree file.
- Preserve line/range anchors when navigating from a diff hunk to the source
  editor.
- Handle untracked, renamed, deleted, binary, detached-HEAD, and dirty-index
  states with explicit messages.
- Add tests for Git errors, missing repositories, CRLF/LF differences, and
  edits that change frontmatter or rendered widget height.
- Document limitations where the host's native diff editor cannot embed a
  custom webview on both sides.

### [ ] Markdown lint diagnostics and an explicit lint action

Goal: make Markdown quality feedback available without forcing users to leave
the editor, while keeping the lint configuration inspectable and opt-in where
appropriate.

- Reuse the maintained
  [`markdownlint`](https://github.com/DavidAnson/markdownlint) engine rather
  than implementing a second Markdown rule system.
- Dependency groundwork is in place: the VS Code extension declares
  `markdownlint@^0.40.0`, the latest line compatible with the repository's
  Node 20 floor, and `src/markdownLint.ts` exposes a content-only host seam;
  diagnostics, configuration discovery, and range mapping remain planned.
- Add a workspace setting for enabling lint diagnostics and selecting the
  configuration file (`.markdownlint.json`, `.markdownlint.yaml`, or an
  explicit path).
- Resolve configuration from the workspace root, with documented precedence
  for nested repositories and per-file frontmatter overrides if supported by
  the chosen markdownlint API.
- Run linting in the extension host or a worker, never directly in the
  webview; debounce edits and cancel stale runs.
- Convert rule results to a VS Code `DiagnosticCollection` with source,
  severity, line/column range, rule code, and a concise message.
- Show rule documentation or a quick-fix explanation from the Problems panel
  and the Markdown editor hover where practical.
- Provide `LLM Wiki: Lint Markdown` for the current file and
  `LLM Wiki: Lint Workspace Markdown` for an explicit workspace scan.
- Add a status-bar/editor action that reports the last lint time and count.
- Support a safe “fix selected rule” path only when markdownlint exposes a
  deterministic fix; otherwise provide a copyable explanation instead of
  rewriting user files.
- Respect ignored files, generated directories, vault raw evidence, and
  `.gitignore` without silently linting large binary or generated trees.
- Add focused unit tests for config discovery, path filtering, rule-to-range
  conversion, debounce/cancellation, and malformed configuration.
- Add E2E coverage for diagnostics, disabled linting, a custom config, and the
  explicit lint command. Include a fixture with frontmatter, tables, images,
  footnotes, and fenced code.
- Record the exact markdownlint version and rule compatibility policy in the
  extension changelog.

## Agent context and provider integrations

### [x] Selection handoff contract

- Markdown selections attach the original file plus an inclusive line range;
  PDFs and other sources retain immutable exports.
- Cursor/VS Code host links use the generated `open_uri`; internal anchor files
  never appear as user-facing chat links.
- Claude keeps a sibling image link; Codex, Cursor Agent, and CodeBuddy use
  their provider-specific attachment capabilities without submitting drafts.
- Optional crop failures preserve verified text-only context and report the
  degraded result.

### [x] Cursor Agent keyboard handoff

- `Ctrl/Cmd+L` adds the active Markdown selection to the existing Cursor Agent
  composer as an exact inclusive source-range pill without submitting it or
  opening a duplicate editor group.
- `Esc` returns focus to the Markdown editor while leaving the composer and
  its attached range open; the binding is guarded by a transient handoff
  context key so ordinary editor/Vim Escape behavior remains untouched.
- Activation and manifest regression tests cover successful/failed handoffs,
  context transitions, and the guarded keybinding. The Extension Development
  Host smoke test is recorded in
  [`docs/session-functionality-2026-08-14.md`](session-functionality-2026-08-14.md).

### [ ] Provider compatibility matrix

- Maintain a small table of tested provider extension IDs and versions for
  Cursor and stock VS Code.
- Detect unsupported provider APIs at activation and explain the exact
  limitation in the UI.
- Add a diagnostic command that reports provider capability state without
  reading provider conversations or sending content.
- Keep provider adapters isolated so a broken external Codex/Claude update
  cannot prevent Markdown/PDF editing.

## PDF and source navigation

### [x] Current PDF selection workflow

- Text selection, page/range links, selection crop, Ask PDF, explicit provider
  buttons, and correlated concurrent capture requests.
- Text-only fallback for crop failures and immutable export files.

### [ ] Diff and annotation parity

- Add Git revision links for Markdown notes that cite PDF pages.
- Show changed/removed source-note links when a cited file moves or is deleted.
- Provide a read-only annotation diff for PDF sidecars so reviewers can see
  changed geometry, quote, and answer text across revisions.
- Add a repair flow for annotations whose source hash changed, with an
  explicit preview before rewriting sidecars.

## Vault, graph, and authoring workflow

### [x] Filesystem-first vault behavior

- Ordinary Markdown and Git remain the source of truth.
- `.llm_wiki/agent` stores latest aliases and immutable exports.
- Frontmatter concepts/entities feed the graph; links, backlinks, outlines,
  daily notes, and safe fast-forward updates are available.

### [ ] Authoring quality and navigation

- Add a query capture command that creates a durable note under `queries/`
  from a selected Markdown paragraph, preserving source path and line range.
- Add frontmatter schema hints and completion for common LLM Wiki fields while
  preserving unknown user-defined fields.
- Add a graph view filter for source type, lifecycle, tag, and unresolved link.
- Add a workspace-wide broken-link repair preview with exact-match and
  ambiguous-match modes.
- Add an index freshness indicator and an explicit rebuild/check command for
  large vaults.
- Keep generated indexes deterministic and add a CI check that rejects stale
  indexes or missing immediate-child `_index.md` files.

## Testing, CI, and observability

### [x] Current gates

- TypeScript build/typecheck, ESLint, Node tests, Markdown Playwright tests,
  PDF tests, and demo-vault validation are part of the repository checks.
- Demo-vault contents are kept under a dedicated `demo-vault/` directory and
  validated independently from the product source.

### [ ] Stronger regression and release gates

- Add a single documented `pnpm verify:release` command that builds, runs all
  unit/browser/host suites, validates the demo vault, checks generated
  artifacts, and emits a concise machine-readable summary.
- Add a clean-checkout CI job so local build products and dirty vault files
  cannot mask missing inputs.
- Add a matrix for Linux, macOS, and Windows shortcut/line-ending behavior.
- Add accessibility checks for properties tables, chips, image widgets,
  dialogs, diff hunks, diagnostics, and keyboard-only navigation.
- Capture bounded performance budgets for large Markdown files, large tables,
  many images, and long PDFs; fail CI only on sustained regressions.
- Add opt-in crash/error telemetry only after a documented privacy review;
  default behavior must remain local-first and inspectable.

## Documentation and project hygiene

### [ ] Keep documentation executable

- Update `README.md` and the current feature list whenever a roadmap item
  ships or changes scope.
- Add screenshots and short GIFs for the Markdown editor, diff mode,
  properties tables, lint diagnostics, and agent handoff flows.
- Keep the architecture document aligned with the actual combined extension;
  clearly mark historical SQLite/CLI/MCP designs as historical.
- Add contributor guidance for adding a renderer: source preservation,
  active-line behavior, copy/paste, theme tokens, accessibility, and E2E
  coverage are required before merge.
- Maintain a changelog with host compatibility notes, migration behavior, and
  known provider limitations.

## Definition of done for future editor features

Before calling a Markdown-editor feature complete, verify all of the
following:

1. Raw Markdown remains the persisted source of truth.
2. Active-line editing and inactive rendering behave consistently in Vim and
   non-Vim modes.
3. Copy, paste, undo, redo, save, reload, and dirty-close behavior are tested.
4. Light/dark theme tokens, keyboard navigation, focus restoration, and
   accessible names are covered.
5. The feature works with frontmatter, tables, images, footnotes, links, and
   fenced code where those constructs overlap.
6. Unit tests, focused browser tests, the full Markdown suite, `pnpm check`,
   and `git diff --check` are green.
7. Any host-specific limitation is documented instead of being treated as a
   silent success.
