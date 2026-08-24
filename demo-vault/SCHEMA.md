---
type: "Reference"
title: "Project-scoped LLM Wiki schema"
description: "The OKF v0.2 base, Karpathy vault profile, and project policy enforced by this bundle."
tags: ["open-knowledge-format", "provenance", "reproducibility"]
status: "stable"
generated: {"by": "process:project-scope-migration", "at": "2026-08-23T13:38:07Z"}
scope: "cross-project"
---

# Project-scoped LLM Wiki schema

## Layers

Validation reports every issue as `okf-base`, `karpathy-vault-v1`, or
`project-policy`. Base OKF requires a nonempty `type` on every ordinary
Markdown document. This profile additionally requires descriptive metadata,
provenance, deterministic navigation, evidence integrity, and project scope.

## Canonical indexes and traversal

The vault root `_index.md` has exactly `okf_version: "0.2"` frontmatter. Every
owned directory has a generated, frontmatter-free `_index.md` listing immediate
children only. The outer and registered code-vault roots use regular `_log.md`
files. Unprefixed variants and navigation/log symlinks are forbidden.

This is an intentional local profile choice favoring the Hermes/Karpathy
underscore convention over OKF v0.2's usual unprefixed entry filename; the
remaining typed-Markdown, provenance, lifecycle, and link rules stay OKF-derived.

Traversal treats `assets`, `projects/code`, `projects/*/assets`, `.llm_wiki`, hidden
runtime directories, and `.agents/skills` as opaque. Assets and code never
have generated indexes.

## Project workbench

Each flat `projects/<id>.md` repository card contains overview, VCS identity,
studied revision, project/code status, ongoing-change summary, and the current
task pointer. It is paired with `projects/<id>/`, a self-contained OKF bundle
containing its own schema, guidance, log, indexes, workbench,
repository documentation, and code-specific compiled knowledge. Outer
`raw/`/`assets/` hold papers and other higher-level evidence; outer compiled
collections hold higher-level learning with `scope: vault` or genuinely
cross-project knowledge with `scope: cross-project`. Compiled pages in a code
vault declare `code_scope: true` so placement drift is machine-detectable.

`projects/repositories.yaml` is version 1 and registers `vcs`, `url`,
`default_ref`, flat `card`, paired `vault`, ignored `projects/code/<id>` path, in-place
workspace mode, review update strategy, and LFS policy. Git, P4, and SVN are
valid synchronizers. A working copy may be missing; validation never syncs it.

## Evidence and provenance

Raw Markdown companions and assets are flat siblings at either evidence scope.
Papers default to outer `raw/` and `assets/`; project evidence is reserved for
repository-specific material. An attachment records
`resource`, `role` (`original` or `derived`), media type, byte size, and
lowercase SHA-256. `/assets/**` and `/projects/*/assets/**` are routed through
Git LFS; Markdown and source are not.

Code sources record `repository`, full `revision`, repository-relative `path`,
and a verified content `sha256` for stable claims. Draft pages may omit the
hash only while marked `source_state: awaiting-source`. Historical revision
provenance is distinct from whatever revision an optional checkout currently
has.

## Durable pages

Entity and Concept pages record `created.by` and `created.at`. Queries follow
the contract in [the operator handbook](AGENTS.md): condensed summary,
selection ID, exact anchors, direct answer, evidence, limitations, and related
durable pages. Each anchor binds by `source_id` to one unique provenance entry
and records a kind-specific Markdown range, PDF region, or code range.
Unresolved conflicts remain draft and explicit.
