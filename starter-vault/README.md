---
type: "Reference"
title: "Empty LLM Wiki vault"
description: "A ready-to-use, source-grounded knowledge vault for LLM Wiki for VS Code."
status: "stable"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-25T00:57:53+08:00"}
---

# Empty LLM Wiki vault

This is a knowledge-empty starter vault. It already contains the operational
files, authoring templates, collection indexes, Git ignore rules, and Git LFS
attributes required by the vault profile. It contains no sample sources,
projects, Queries, or compiled knowledge.

Generic skills are complete under `.agents/skills/`. Physical wrappers for
Claude Code, Cursor, and Codex are installed in their native directories, so a
fresh vault works across all three agents without plugins or symlinks. Run
`.agents/render_agent_adapters.py --write` after changing canonical skills.

Start by reading [AGENTS.md](AGENTS.md), [SCHEMA.md](SCHEMA.md),
[TAGS.md](TAGS.md), [tasks/current.md](tasks/current.md), and [_index.md](_index.md).
Rename this document and update its metadata when giving the vault its real
identity.

## First use

1. Open this directory with LLM Wiki for VS Code.
2. Optionally initialize a Git repository and Git LFS. The included
   `.gitattributes` routes future `assets/` binaries through LFS.
3. Add or refine canonical tags in `TAGS.md` before publishing tagged pages.
4. Put immutable textual evidence in `raw/` and eligible binaries in `assets/`.
5. Create durable knowledge from the files in `templates/`.
6. Register code repositories with portable cards under `projects/`; local
   checkouts or symlinks belong only under ignored `projects/code/`.

For a material collection rather than a single source, follow
[Bulk corpus ingestion](playbooks/bulk-corpus-ingestion.md). It provides a
candidate manifest, a canonicalization checkpoint before prose authoring, a
durable-page admission rubric, and semantic quality gates for answerability,
refusal, recall, citations, and duplicate content.

Knowledge pages remain ordinary Markdown. No database, embeddings service,
submodule, scheduler, or compiler runtime is required.

## Configure the workflow

Set `vault_prose_language` in `AGENTS.md` when naming the vault. New synthesis
uses that language. Agent responses follow the language of the current request,
while source quotes and precise technical terms remain unchanged.

Before migrating legacy raw material, follow
[Source corpus curation](playbooks/source-corpus-curation.md). The workflow
audits secrets, identity, duplicates, frontmatter, and attachment closure, then
freezes one disposition for every source before any destination write.

Keep each Markdown file in `tasks/` focused on one actionable goal. Put
intermediate manifests in `scratch/` and durable reports in `output/`.
Register another vault with a portable `Knowledge Vault` card under `vaults/`;
its device-local directory or symlink belongs under ignored
`vaults/bindings/`.
