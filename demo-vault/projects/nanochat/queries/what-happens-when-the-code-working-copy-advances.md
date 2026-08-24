---
type: "Query"
title: "What happens when the code working copy advances?"
description: "How to interpret existing knowledge after the ignored Nanochat working copy is synchronized to a newer revision."
tags: ["project-nanochat", "provenance", "repository-workflow"]
status: "stable"
code_scope: true
generated: {"by": "process:project-vault-migration", "at": "2026-08-24T00:00:00+08:00"}
sources: [{"id": "orientation", "resource": "../README.md", "title": "Nanochat code vault orientation"}, {"id": "workflow", "resource": "../summaries/in-place-code-workflow.md", "title": "In-place code study workflow"}, {"id": "schema", "resource": "../SCHEMA.md", "title": "Nanochat code-vault schema"}]
condensed_summary: "Advancing the in-place code working copy creates review debt; it does not invalidate claims bound to an older immutable revision and verified content hash."
project: "nanochat"
conversation: {"selection_id": "sample-nanochat-code-working-copy-advancement-v1"}
anchors: [{"source_id": "orientation", "kind": "markdown", "resource": "../README.md", "sha256": "96ed1e7a888b00915198d1b0442f6f6a1ada00e1fc4c1514d269dfae066f9394", "quote": "This directory is the Nanochat code-oriented project vault. When embedded in the outer\ncatalog, repository identity and current status also appear in the sibling\n`projects/nanochat.md` card. The ignored sibling `../code/nanochat/` directory\nis its in-place Git working copy when present.", "prefix": ":00+08:00\"}\n---\n\n# Nanochat code vault\n\n", "suffix": "\n\nKeep implementation guides, code Queries, repository tasks", "from": 330, "to": 617, "start_line": 12, "end_line": 15}]
---

# What happens when the code working copy advances?

## Answer

Existing knowledge does not become false merely because the ignored
`projects/code/nanochat/` working copy advances. A claim bound to an immutable repository revision,
repository-relative path, and verified content hash remains historically
supported. The newer working copy creates currentness debt: the studied
baseline and affected pages should be reviewed before claiming they describe
the new revision.[^workflow]

## Evidence

The project vault treats `projects/code/nanochat/` as an in-place,
developer-managed working copy rather than content owned by the vault.[^orientation] Its provenance contract
binds stable code claims to immutable revisions and hashes, so working-copy
location and current checkout state are not substitutes for evidence.[^schema]

A maintenance pass should compare the new revision with the card's studied
baseline, identify affected pages, update claims that changed, and only then
advance the baseline. Dirty or unavailable evidence remains draft.

## Limitations

The vault does not automatically synchronize Git, P4, or SVN, and it cannot
infer semantic impact from a changed revision alone. Repository-specific diff
and verification work still belongs in a task. Claims that were never bound to
an immutable revision or verified hash do not receive the same historical
guarantee.

## Related durable pages

- [In-place code study workflow](../summaries/in-place-code-workflow.md)
- [Nanochat code vault](../entities/nanochat-code-vault.md)
- [Nanochat code-vault schema](../SCHEMA.md)

[^orientation]: Nanochat code vault orientation
[^workflow]: In-place code study workflow
[^schema]: Nanochat code-vault schema
