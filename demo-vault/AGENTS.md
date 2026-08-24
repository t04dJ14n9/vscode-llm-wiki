---
type: "Playbook"
title: "LLM Wiki operator handbook"
description: "Normative AGENTS-only workflow for the graph-ready demo vault."
tags: ["operations", "open-knowledge-format", "reproducibility"]
status: "stable"
scope: "vault"
vault_timezone: "Asia/Shanghai"
generated: {"by": "process:vault-format-v2", "at": "2026-08-24T00:00:00+08:00"}
---

# LLM Wiki operator handbook

This file is the complete normative workflow. No LLM Wiki skill is required.

## Start every study or maintenance session

1. Read `SCHEMA.md`, `_index.md`, `tasks/current.md`, and the newest `_log.md` entry.
2. Use the `Asia/Shanghai` calendar date. Create or refresh `wiki/daily/YYYY-MM-DD.md` from `templates/daily.md.tmpl` if this is the first session that day.
3. Preserve every human-owned Goals, review-answer, and Notes marker verbatim.
4. Search titles, tags, bodies, and Query selection IDs before writing.

Daily generation is lazy and filesystem-only: no scheduler or extension command is required. Pull linked `**Learned**` entries from today's log into the cohort. Review older cohorts at +1, +3, +7, +14, +30, +60, and +90 days. Repeat Query titles with blank human answer blocks; use “I can explain…” checkboxes for Concepts, Comparisons, and Entities. Include at most ten unresolved reviews, oldest first and Queries first. Incomplete reviews roll forward; outcomes do not alter the fixed schedule.

## Place knowledge

- `wiki/concepts`, `wiki/comparisons`, `wiki/entities`, and `wiki/queries` contain durable graph-ready knowledge.
- `wiki/daily` contains daily goals and review cohorts.
- `summaries` and `playbooks` remain narrative and operational entry points.
- `raw` is flat immutable textual evidence; `assets` is flat binary evidence through Git LFS.
- `inbox`, `tasks`, and `scratch` are non-durable workbench state.
- `templates` is opaque. Copy the closest `.md.tmpl` and replace every required placeholder.

Use OKF actor identities accurately. Agent-authored changes use
`<producer>/<version>` such as `codex/gpt-5.6`; human-authored or
human-confirmed events use `human:<id>`; `process:<id>` is reserved for a
named automated process such as a deterministic importer or index builder.
Never use a workflow label as a substitute for the agent that authored prose.

Every graph-visible page has `relations: []` or explicit relations. A relation target is relative to `wiki/`, contained, existing, non-self, and unique by target/kind. Allowed kinds are `references`, `depends-on`, `supported-by`, `contrasts-with`, `extends`, `supersedes`, `applies-to`, and `example-of`; captions are direct and at most 160 code points. Body links do not create graph edges.

## Register code projects

Use one portable `projects/<id>.md` card. Its ID implies ignored binding `projects/code/<id>`, which may be a checkout or exact symlink. Store no local path, YAML registry, submodule, or paired project vault. Verify only that binding's Git remote, P4 mapping, or SVN URL; never search for another checkout or sync it automatically. Repository-specific knowledge belongs in the repository's `docs/llm-wiki/`. Nanochat is reference-only in this demo.

## File Queries

File a Query only when the answer is substantial, grounded, durable, novel, scoped, complete about limits, and safe. Use `templates/query.md.tmpl`; preserve synthesis rather than transcripts. Every Query needs `condensed_summary`, `conversation.selection_id`, unique sources, exact source-ID-bound anchors, answer, evidence, limitations, related pages, and relations. Reuse exact exported Markdown/PDF source URIs.

Valid exported `open_uri` values begin with
`cursor://llm-wiki.llm-wiki-vscode/open-anchor` or
`vscode://llm-wiki.llm-wiki-vscode/open-anchor`. Never manufacture an
`.llm_wiki_anchor`/`chat_uri` payload; persisted pages use relative Markdown
links or wikilinks.

## Finish

Rebuild indexes, validate placement/relations/daily notes/provenance/bindings, inspect LFS, run `git diff --check`, refresh Query annotations, and add newest-first log entries using `**Learned**`, `**Changed**`, or `**Maintained**`. Never commit, push, sync a code binding, or write externally without explicit authority.
