---
type: "Reference"
title: "LLM Wiki demo vault"
description: "A working example of source-backed reading, durable Queries, repository references, and active recall in LLM Wiki for VS Code."
status: "stable"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-25T00:32:09+08:00"}
---

# LLM Wiki demo vault

This vault shows the complete learning loop supported by LLM Wiki for VS Code:
read a source, ask a grounded question, preserve the useful answer as ordinary
Markdown, and review it later without losing the path back to the evidence.

It is deliberately small enough to inspect by hand. The current corpus contains
eight version-pinned papers with matching PDFs, 18 Concepts, six Comparisons,
three Entities, two narrative Summaries, one source-anchored Query, and daily
active-recall notes. Nanochat appears as a pinned repository reference rather
than a copied code wiki.

## Start here

- Open [_index.md](_index.md) for the hierarchical catalog.
- Read [Research corpus overview](wiki/summaries/research-corpus-overview.md)
  for the papers, topics, and evidence boundaries.
- Open [Why does grouped-query attention reduce KV-cache cost?](wiki/queries/why-does-grouped-query-attention-reduce-kv-cache-cost.md)
  to see a durable Query with a condensed answer and source anchor.
- Open the [2026-08-25 daily note](wiki/daily/2026-08-25.md) to see active
  recall generated from prior learning.
- Read the [Nanochat project card](projects/nanochat.md) for a high-level
  repository overview and the exact revision tracked by this vault.

Maintainers should read [AGENTS.md](AGENTS.md), [SCHEMA.md](SCHEMA.md),
[TAGS.md](TAGS.md), [tasks/current.md](tasks/current.md), and the latest event in
[_log.md](_log.md) before editing durable knowledge.

## What belongs where

```text
wiki/          durable summaries, concepts, entities, comparisons, Queries,
               and daily review notes
raw/           immutable, searchable Markdown source records
assets/        original PDFs tracked through Git LFS
projects/      portable repository cards
projects/code/ ignored local checkouts or symlinks
templates/     opaque authoring templates, not knowledge pages
inbox/         unprocessed material
tasks/         current and historical work state
scratch/       temporary hypotheses
output/        polished reports and designs
```

Every durable wiki page uses canonical tags from [TAGS.md](TAGS.md). Directed
knowledge-graph edges come from explicit `relations` metadata, not from every
body link. Sources identify evidence; relations identify durable knowledge
connections.

## Evidence and trust

Files in `raw/` preserve extracted source text and hashes. Their matching binary
attachments live in `assets/`. Compiled pages cite those records or canonical
external sources with stable source IDs, and load-bearing claims use matching
footnotes.

`generated` records who last changed a page. Optional `verified` events record
independent machine or human checks. Lifecycle status is separate: a page can
be stable without being human-reviewed, and unresolved conflicting evidence
keeps a page draft.

## Try the viewer workflow

1. Open a Markdown source or PDF in LLM Wiki for VS Code.
2. Select a passage and use **Copy for Agent** or **Add to Chat**.
3. Discuss the passage without changing the source artifact.
4. File a substantial, evidence-backed answer under `wiki/queries/`.
5. Return to the source. Its Query marker exposes the title and condensed
   answer and can reopen the durable page.

Trivial lookups do not become Queries. The extension exports source selections
and indexes local Query pages; it does not submit or scrape conversations.

## Repository boundary

The [Nanochat card](projects/nanochat.md) records repository identity, tracked
branch, observed revision, and study status. An optional working copy may exist
at `projects/code/nanochat`, either in place or as a symlink to a user-supplied
checkout. The outer vault ignores that path and never clones or updates it
automatically.

Implementation-specific knowledge belongs in a writable code repository at
`docs/llm-wiki/`, where it follows branches and commits. This demo keeps
higher-level paper-backed learning in the outer vault.

## Validate the demo

Run these commands from the repository root:

```bash
python3 tools/llm-wiki/rebuild_indexes.py --vault demo-vault --check
python3 tools/llm-wiki/validate_vault.py --vault demo-vault
git lfs ls-files
git diff --check
```

The demo requires no database, embeddings service, submodule, scheduled task,
or `llm-wiki-compiler` runtime. Its durable state is Markdown, Git history, and
Git LFS assets. Its installed operational skills cover PDF regions, prose
polish, version-pinned arXiv discovery, grounded citations, and research-paper
workflows; skill packages remain opaque to the knowledge graph.
