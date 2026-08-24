---
type: "Playbook"
title: "LLM Wiki operator handbook"
description: "Project-scoped workflows for orienting, ingesting, compiling, querying, and validating this bundle."
tags: ["operations", "open-knowledge-format", "reproducibility"]
status: "stable"
generated: {"by": "process:project-scope-migration", "at": "2026-08-23T13:38:07Z"}
scope: "cross-project"
---

# LLM Wiki operator handbook

Run commands from this vault root. Producer tools live in `../tools/llm-wiki/`;
the reusable workflow lives in `../.agents/skills/llm-wiki/`.

## Orient before editing

1. Read [the schema](SCHEMA.md), [the root index](_index.md), the target
   [project card](projects/nanochat.md), and the newest [log](_log.md)
   entry.
2. Search existing pages before creating a new durable page.
3. Read `projects/repositories.yaml`. A registered `projects/code/<id>/` working copy may be
   absent and is always synchronized in place by its declared VCS. Never sync
   it as part of validation.
4. Keep repository implementation, code Queries, and generated repository
   documentation below `projects/<id>/`. Keep papers and higher-level learning
   at the root with `scope: vault` or `scope: cross-project`.

## Ingest an arXiv snapshot

Use an exact version and an explicit project:

```bash
python3 ../tools/llm-wiki/ingest_arxiv.py \
  --vault . \
  --id 1508.07909v5
```

The producer writes a flat companion to outer `raw/` and its original PDF to
outer `assets/`. Use `--project <id>` only for evidence whose authority is the
repository itself. Do not overwrite immutable evidence. Collision names use
the first twelve characters of the asset digest.

## Compile knowledge

- Put codebase architecture, implementation behavior, repository playbooks,
  code Queries, and imported DeepWiki summaries inside the code vault.
- Put higher-level concepts, entities, comparisons, paper summaries, and
  synthesis at the root with `scope: vault` or `scope: cross-project`.
- Give every Entity and Concept explicit `created.by` and `created.at` values.
- Join sourced claims to `sources[].id` with footnotes.
- Code sources record repository ID, full revision, repository-relative path,
  and a verified SHA-256 before a page can be stable. If source is missing,
  keep the page `draft` with `source_state: awaiting-source`.
- Keep exactly one `tasks/current.md` per project.

Refresh every Nanochat DeepWiki page as draft code-vault Summaries with:

```bash
python3 ../tools/llm-wiki/import_deepwiki.py \
  --vault . \
  --project nanochat
```

The importer refuses a DeepWiki revision that does not match the project card,
preserves source-page metadata, and rewrites navigational/source links without
marking generated claims verified.

## File a Query

A durable Query stores a direct answer, evidence, limitations, related pages,
a one- or two-sentence `condensed_summary` of at most 360 Unicode code points,
the originating `conversation.selection_id`, and exact Markdown/PDF/code
anchors. Every anchor carries a `source_id` matching one unique `sources[]`
entry and a kind-specific exact location. It stores synthesis, not a transcript.

For a Markdown or PDF viewer conversation, file automatically only when the
answer is substantial, grounded, supported, durable, novel, clearly scoped,
complete about limits, and safe. Ask for borderline cases; keep trivial
lookups read-only. Reuse `conversation.selection_id`, update the living project
guide when understanding materially improves, and refresh source annotations.

Create or enrich Entities and Concepts only under the repository-root gates.
Functions, files, RPCs, passing mentions, and temporary objects do not become
Entities. Ask before a change fans out to ten or more pages.

## Rebuild and validate

```bash
python3 ../tools/llm-wiki/rebuild_indexes.py --vault .
python3 ../tools/llm-wiki/rebuild_indexes.py --vault . --check
python3 ../tools/llm-wiki/validate_vault.py --vault .
python3 -m unittest discover -s ../tools/llm-wiki/tests -v
git lfs ls-files
```

The outer catalog and each registered code vault put `okf_version: "0.2"` on
their own regular root `_index.md`; indexes below either root are generated and
frontmatter-free. `assets/`, `projects/code/`, `.llm_wiki/`, hidden runtime directories,
and `.agents/skills/` are opaque. `_index.md` and `_log.md` are the only
accepted navigation and log filenames.

## Finish a material mutation

Rebuild, run check mode, validate, inspect hashes and the diff, then add a
newest-first log entry. Never claim source verification when the registered
checkout is absent.
