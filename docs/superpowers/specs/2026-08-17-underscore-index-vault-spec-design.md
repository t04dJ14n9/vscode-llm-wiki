# Canonical `_index.md` Vault Index Design

**Date:** 2026-08-17

## Goal

Change the LLM Wiki / strict OKF vault contract so every hierarchical index is
named `_index.md`. The leading underscore keeps the navigation entry above
ordinary alphabetic files in directory listings.

This is a hard format cutover. `index.md` is not a legacy alias and consumers
must not fall back to it.

## Format contract

- `_index.md` and `log.md` are reserved at every vault level.
- Every visible bundle-owned directory contains an immediate-child
  `_index.md`.
- Only the bundle-root `_index.md` has frontmatter, containing exactly
  `okf_version: "0.2"`.
- Nested `_index.md` files have no frontmatter.
- Directory links continue to use the portable `child/` form. Consumers
  resolve such a target exclusively to `child/_index.md`.
- `index.md` has no special meaning. If present, it is an ordinary concept
  document and must satisfy the same frontmatter and editorial rules as any
  other non-reserved Markdown file.

## Producer and migration behavior

`tools/demo-vault/rebuild_indexes.py` will use one canonical index filename
constant, `_index.md`, for discovery, rendering, check mode, and writes.

The repository demo vault and test fixtures will be migrated atomically:

1. Rename the root and every generated nested `index.md` to `_index.md`.
2. Update explicit Markdown references to those files.
3. Rebuild all generated index contents with the updated producer.
4. Leave portable directory links such as `concepts/` unchanged.

The producer will not silently preserve or generate `index.md`. A stale
generated `index.md` left after an incomplete migration is treated as an
ordinary untyped Markdown document and validation fails. This makes partial
migrations visible instead of masking them.

## Validation

The strict validator will:

- reserve `_index.md` instead of `index.md`;
- require `_index.md` in every visible owned directory;
- apply the root-index frontmatter rule only to the root `_index.md`;
- forbid frontmatter in nested `_index.md` files;
- exclude `_index.md` from concept/frontmatter and concept-ID checks;
- apply normal concept rules to any file still named `index.md`.

Diagnostics and operator documentation will name the exact missing or invalid
`_index.md` path.

## Extension navigation

Both navigation paths in the VS Code extension will adopt the same exclusive
resolution rule:

- the filesystem-wiki graph resolves a directory target to
  `<directory>/_index.md`;
- URI dispatch resolves an existing directory to its `_index.md`;
- extensionless concept-ID resolution remains unchanged;
- a directory containing only `index.md` is unresolved and is never opened as
  an index.

The root `_index.md` and nested `_index.md` files remain ordinary Markdown
editor documents for display, outline, backlinks, and previews.

## Inactive footnote visibility

Footnote references must remain visibly identifiable in hybrid Markdown
rendering when the caret is elsewhere, including while a Markdown table is in
source-edit mode. Moving the caret into the reference may reveal the raw
`[^id]` syntax, but moving it away must restore a visible interactive
superscript label.

The confirmed root cause is parser overlap: a footnote definition such as
`[^smollm2]: SmolLM2` currently also satisfies the collapsed reference-link
definition parser. In an active table, the reference-link path can therefore
replace inactive `[^smollm2]` syntax with an ordinary link widget instead of
leaving it to the dedicated footnote renderer.

Reference-link definition parsing will explicitly exclude labels beginning
with `^`. Footnote definitions and references then remain owned by the
footnote index and renderer in prose, rendered table widgets, and active table
source rows. This changes parser classification only; footnote navigation,
definition previews, copying raw Markdown, and ordinary reference links remain
unchanged.

## Documentation and reusable skill

Update the repository-owned LLM Wiki skill, OKF profile, demo-vault schema,
operator handbook, README guidance, examples, and current acceptance tests to
describe `_index.md` consistently. Historical design and plan documents remain
historical records unless an executable documentation contract explicitly
checks them.

## Error handling

- Check mode reports missing or stale `_index.md` outputs without mutation.
- Write mode creates only `_index.md` outputs.
- Validation reports incomplete migrations; it does not reinterpret
  `index.md` as an index.
- Directory navigation fails normally when `_index.md` is absent rather than
  guessing another target.

## Test strategy

Follow test-driven development:

1. Add producer tests expecting `_index.md` outputs and no generated
   `index.md`.
2. Add validator tests for required/root/nested `_index.md` behavior and prove
   that `index.md` is validated as a concept.
3. Add filesystem-wiki and URI-dispatch regressions that resolve only
   `_index.md` and reject an `index.md`-only directory.
4. Add a parser regression proving footnote definitions are not reference-link
   definitions, plus browser coverage for a long inactive footnote in an
   active table and the caret reveal/restore cycle.
5. Update fixture and demo-vault E2E expectations.
6. Migrate and rebuild the demo vault.
7. Run producer unit tests, index check mode, strict vault validation, the full
   repository test suite, lint, typecheck, build, and diff checks.

## Non-goals

- No compatibility flag or fallback for legacy `index.md`.
- No custom Explorer sorting or editor-specific filesystem decoration.
- No change to concept-ID syntax, directory-link syntax, OKF version, or
  automatic directory repartitioning.
