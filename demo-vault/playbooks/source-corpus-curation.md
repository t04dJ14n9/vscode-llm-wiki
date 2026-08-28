---
type: "Playbook"
title: "Source corpus curation"
description: "Audit, deduplicate, route, and preserve a large evidence set before it enters a vault."
tags: ["operations", "provenance"]
status: "stable"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-25T16:30:00+08:00"}
---

# Source corpus curation

A source migration is complete only when every candidate has one explicit
disposition. Copying the most obvious files is not enough: the migration must
also explain duplicates, sensitive records, implementation-owned material, and
evidence that was deliberately left behind.

This playbook decides which immutable evidence belongs in which vault. The
[bulk-ingestion playbook](bulk-corpus-ingestion.md) begins afterward and decides
which durable graph pages should be synthesized from the accepted evidence.

## 1. Freeze the boundary before copying

Record the source root and revision or export time, candidate destinations,
included subjects, excluded subjects, and responsible actor. Keep the source
worktree unchanged. For each candidate, capture its canonical source URL when
available, exact SHA-256, attachment references, and proposed owner.

Every selected textual record also receives a Markdown snapshot. Freeze its
destination basename, retrieval time, source revision, capture method, body
hash, original-asset hash when applicable, and omissions. Format conversion
may normalize presentation, but it must not paraphrase, translate, correct,
reorder, or silently drop wording. Mark unreadable spans and missing
attachments explicitly.

Use `templates/source-curation-manifest.json.tmpl` in `scratch` while decisions
are active. A small completed example lives at
`output/source-curation-manifest.example.json`.

## 2. Block unsafe or incomplete records

Scan before any destination write. A live credential, private key, bearer
header, password assignment, malformed metadata, or missing required
attachment blocks that record. The manifest records the category and location,
never the secret value. Large endpoint or environment inventories also require
explicit review even when a token scanner finds nothing.

## 3. Deduplicate by identity

Use a canonical source URL first and an exact content hash second. A matching
filename is only a collision signal; it does not justify overwriting a file.
Near-duplicate titles and similar topics still require human or agent review.

## 4. Route evidence to its owner

- Cross-project architecture, reusable operations, platform behavior,
  onboarding, and research evidence may belong in the outer vault.
- File, symbol, protocol, service-internal, and branch-specific evidence belongs
  in the owning repository's `docs/llm-wiki/raw/`.
- Evidence governed by another knowledge vault stays there and is discovered
  through its `vaults/<vault-id>.md` card.
- Thin placeholders, expired status reports, generated archives, and material
  with no durable reuse value are rejected with a direct reason.

Every source receives exactly one disposition: `selected-outer-vault`,
`selected-code-repository`, `selected-child-vault`, `already-represented`,
`rejected-sensitive`, `rejected-invalid`, `rejected-missing-attachment`,
`rejected-obsolete`, `rejected-low-reuse`, `rejected-out-of-scope`, or
`deferred-review`.

## 5. Preserve real attachments

Resolve URL-encoded names and remove download-only query suffixes before
matching attachments. Copy only files actually referenced by accepted records,
preserve their bytes, media type, size, and SHA-256, and keep destination
attachments flat. A missing file or same-name/different-hash collision stops
the migration. Do not manufacture ZIP companions for Markdown text.

## 6. Make the migration resumable

Complete security and disposition preflight before the first write. Never
overwrite an unrelated destination. An existing output counts as complete only
when its source identity and expected hash match the frozen decision. Append a
log event only after all pages and attachments succeed, and keep partial-run
state outside the source worktree.

## 7. Close the work

Move the frozen manifest and final report to `output`; neither is a task or a
graph page. Rebuild indexes, validate every modified vault, and leave only
specific unresolved actions in `tasks`, one Markdown file per outcome. If the
accepted evidence produces durable pages, continue through all semantic gates
in the bulk-ingestion playbook.
