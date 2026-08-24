---
type: "Playbook"
title: "Nanochat project-vault agent guidance"
description: "Operational rules for studying Nanochat and maintaining its project-local knowledge vault."
tags: ["project-nanochat", "operations", "provenance"]
status: "stable"
generated: {"by": "process:project-vault-migration", "at": "2026-08-24T00:00:00+08:00"}
---

# Nanochat project-vault agent guidance

Read `SCHEMA.md`, `_index.md`, `README.md`, `tasks/current.md`, and the newest
`_log.md` entry before work. When embedded, also read the outer
`projects/nanochat.md` card. Search existing
code summaries, entities, Queries, and imported candidates before creating pages.

The sibling `../code/nanochat/` directory is the ignored in-place VCS working copy. Never clone,
sync, switch, reset, submit, or modify it without explicit authority. Prefer
immutable revision reads; dirty findings stay draft. The card records catalog
status while task detail remains in `tasks/`.

Route DeepWiki and other generated code documentation into `summaries/` with
an indexed revision and unverified provenance. Verify it against code before
stabilization. Route papers and higher-level learning to the outer vault. Preserve
raw/assets, file substantial code answers as Queries, rebuild indexes, validate
both this code vault and its outer catalog, then update the project log.
