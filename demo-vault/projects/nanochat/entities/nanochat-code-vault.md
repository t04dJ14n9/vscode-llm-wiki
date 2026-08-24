---
type: "Entity"
title: "Nanochat code vault"
description: "The self-contained OKF and Karpathy-style knowledge bundle paired with the Nanochat repository card."
tags: ["project-nanochat", "knowledge-vault", "open-knowledge-format"]
status: "stable"
code_scope: true
generated: {"by": "process:project-vault-migration", "at": "2026-08-24T00:00:00+08:00"}
created: {"by": "process:project-vault-migration", "at": "2026-08-24T00:00:00+08:00"}
sources: [{"id": "orientation", "resource": "../README.md", "title": "Nanochat code vault orientation"}, {"id": "schema", "resource": "../SCHEMA.md", "title": "Nanochat code-vault schema"}]
---

# Nanochat code vault

## Identity

The Nanochat code vault is the project-local OKF bundle rooted at this
directory. It owns Nanochat evidence, work state, compiled knowledge, examples,
and output, while the sibling flat card supplies catalog-level repository
identity and status.[^orientation]

## Ownership and relationships

- The outer LLM Wiki catalog registers and links the vault.
- The Nanochat repository is an evidence source, not a child knowledge tree.
- `../code/nanochat/` is the ignored, developer-managed working copy.
- `raw/` and `assets/` preserve immutable source material.
- `tasks/` and `scratch/` contain operational or immature work.
- summaries, concepts, entities, comparisons, playbooks, and Queries contain
  compiled project knowledge.

The vault can be indexed and validated independently. Stable code-backed pages
still require immutable revision and content provenance, regardless of where
the working copy currently points.[^schema]

## Why it is an Entity

This is a durable named bundle with a clear identity, ownership boundary, and
relationships to the outer catalog and Nanochat repository. It is not merely a
file or incidental implementation detail.

## Related pages

- [In-place code study workflow](../summaries/in-place-code-workflow.md)
- [Nanochat code-vault schema](../SCHEMA.md)
- [Current Nanochat study task](../tasks/current.md)

[^orientation]: Nanochat code vault orientation
[^schema]: Nanochat code-vault schema
