---
type: "Summary"
title: "In-place code study workflow"
description: "How the Nanochat repository card, code vault, ignored working copy, and study baseline fit together."
tags: ["project-nanochat", "provenance", "repository-workflow"]
status: "stable"
code_scope: true
generated: {"by": "process:project-vault-migration", "at": "2026-08-24T00:00:00+08:00"}
sources: [{"id": "orientation", "resource": "../README.md", "title": "Nanochat code vault"}, {"id": "schema", "resource": "../SCHEMA.md", "title": "Nanochat code-vault schema"}, {"id": "current-task", "resource": "../tasks/current.md", "title": "Current Nanochat study task"}]
---

# In-place code study workflow

## Overview

The Nanochat entry has two complementary surfaces. The outer catalog provides
a flat repository card for identity and current status, while this directory
is the self-contained code vault. Its ignored sibling `../code/nanochat/` is
the optional working copy used for source inspection.[^orientation]

The working copy is deliberately not evidence by location alone. Durable code
claims identify repository, immutable revision, repository-relative path, and
a verified content hash. This keeps a historically supported claim meaningful
even after Git, P4, or SVN advances the local working copy.[^schema]

## Working loop

1. Read the project card, project-vault index, current task, and newest log.
2. Inspect the registered in-place working copy without synchronizing or
   changing it automatically.
3. Bind durable code claims to the reviewed revision and content hash.
4. Keep findings draft when the working copy is missing, dirty, or not yet
   verified.
5. Put unresolved investigation in `tasks/` or `scratch/`; promote only
   supported conclusions into compiled pages.
6. Rebuild indexes, validate the project and outer catalog, and log material
   changes.

The current task remains the detailed operational record. A short status and
studied baseline are enough on the repository card.[^current-task]

## Why this split is useful

The outer catalog can compare and locate many repositories without absorbing
their full code trees. Each code vault can also be copied or validated
on its own, while its ignored working copy remains controlled by the developer
and the repository's native version-control system.

## Related pages

- [Nanochat code vault](../README.md)
- [Nanochat code-vault schema](../SCHEMA.md)
- [Current Nanochat study task](../tasks/current.md)

[^orientation]: Nanochat code vault
[^schema]: Nanochat code-vault schema
[^current-task]: Current Nanochat study task
