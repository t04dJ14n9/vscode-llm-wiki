---
name: llm-wiki
description: Use when initializing, migrating, ingesting, studying, querying, or maintaining a Git-backed project-scoped LLM Wiki or Open Knowledge Format vault, including Markdown/PDF selections and registered code repositories.
---

# LLM Wiki

Maintain durable understanding as ordinary Markdown while keeping raw evidence,
project source, working state, and compiled knowledge visibly separate.

## Orient

1. Find the nearest vault root containing `_index.md` with `okf_version`.
   Refuse to initialize a nested vault when an ancestor already qualifies.
2. Read the applicable `AGENTS.md`, `SCHEMA.md`, root and project indexes,
   the flat `projects/<id>.md` card, the paired project-vault index,
   `tasks/current.md`, and newest log entry.
3. Resolve the project before searching or writing. Search titles, aliases,
   tags, bodies, and existing Query selection IDs before creating a page.

## Route the operation

- Layout or migration: read [vault layout](references/vault-layout.md).
- Raw files, PDFs, or assets: read [source ingestion](references/source-ingestion.md).
- Code or repository documents: read [project repositories](references/project-repositories.md).
- A Markdown/PDF conversation: read [viewer conversations](references/viewer-conversations.md) and [Query annotations](references/query-annotations.md).
- Compiled knowledge: read [authoring and queries](references/authoring-and-queries.md) and [Entity/Concept gates](references/entity-concept-gates.md).
- Inbox/tasks/scratch/output/examples: read [workbench and promotion](references/workbench-and-promotion.md).
- Rebuild, lint, or audit: read [maintenance](references/maintenance.md).
- Repository-specific connectors: read [source routing](references/source-routing.md).

For a PDF selection, also use the available `pdf` skill. Reuse the exact
`open_uri` emitted in `.llm_wiki/agent/selection.json`; never manufacture its
payload or expose an internal `.llm_wiki_anchor`/`chat_uri` bridge as a source
link. The emitted host link has one of these shapes:

```text
cursor://llm-wiki.llm-wiki-vscode/open-anchor?target=v1.<generated-payload>
vscode://llm-wiki.llm-wiki-vscode/open-anchor?target=v1.<generated-payload>
```

Persisted pages use relative Markdown links or wikilinks.

## Boundaries

- Raw Markdown and assets are immutable evidence; synthesis belongs elsewhere.
- `projects/code/<id>/` is an ignored in-place VCS working copy and is read-only unless the
  user explicitly assigned code changes.
- Resolve code through `projects/repositories.yaml`; never bulk-clone, sync,
  switch, or reset a working copy.
- Stable code claims require repository, revision, path, and verified hash.
  Dirty or unavailable evidence stays draft.
- Repository-implementation knowledge and generated code documentation stay in
  the project code vault. Higher-level papers, concepts, entities, comparisons,
  summaries, and synthesis stay in the outer vault with `scope: vault` or
  `scope: cross-project`.
- Never persist secrets or full conversation transcripts.
- Never stage, commit, push, submit, or write externally without an explicit
  request for that separate action.

## Finish mutations

Use repository-local producers. Rebuild `_index.md`, run check mode and layered
validation, verify Git LFS, inspect the diff, add a newest-first log entry, and
refresh Query annotations. `_index.md` and `_log.md` are canonical regular
files; never create unprefixed variants or aliases.
