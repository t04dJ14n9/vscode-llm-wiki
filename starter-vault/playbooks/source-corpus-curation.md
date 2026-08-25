---
type: "Playbook"
title: "Source corpus curation"
description: "Audit a legacy evidence corpus, freeze one disposition per source, and migrate without leaking secrets or losing attachments."
tags: ["operations", "provenance"]
status: "stable"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-25T00:57:53+08:00"}
---

# Source corpus curation

Use this workflow when a source collection is too large to migrate safely by
hand. It decides which immutable evidence belongs in which vault. The separate
bulk-ingestion workflow decides what durable synthesis to write from evidence
that has already been admitted.

## Invariants

- Leave the source worktree unchanged.
- Give every source record exactly one disposition.
- Compare canonical source URLs first and exact content hashes second; filenames alone do not establish identity.
- Apply the security gate before judging usefulness.
- Preserve admitted raw evidence as immutable bytes.
- Put implementation evidence in the repository that owns the code.
- Copy only genuine referenced attachments, not generated archive companions.
- Make migration resumable without overwriting unrelated files or duplicating output.

## Define and audit the boundary

Record the source root and revision or export time, every candidate
destination, inclusion and exclusion rules, and the responsible actor before
copying anything. Candidate destinations may include the current vault, a code
repository's `docs/llm-wiki/raw/`, or a registered child vault.

Run the deterministic auditor from this repository:

```bash
python3 tools/llm-wiki/audit_source_corpus.py \
  --source /path/to/legacy/raw \
  --asset-root /path/to/legacy/assets \
  --existing /path/to/current-vault/raw \
  --output /path/to/current-vault/scratch/source-curation/audit.jsonl \
  --fail-on-blocked
```

The auditor is read-only except for its declared output. It records source
metadata, canonical URLs, byte count, SHA-256, exact duplicates, credential
categories and line numbers, attachment closure, frontmatter errors, and a
conservative proposed disposition. It never records a detected secret value.

## Apply security, identity, and ownership gates

Do not migrate a page containing a live credential, private key, bearer
header, token assignment, password assignment, or comparable secret. Record
only the finding category and line number. Treat large server inventories and
environment connection tables as sensitive even when pattern matching finds
no credential.

An existing canonical source URL or exact file hash means the evidence is
already represented. A matching basename is only a collision for human
review. Similar titles and topics remain independent until evidence proves
otherwise.

The outer vault owns cross-system architecture, reusable operations, platform
dependencies, onboarding, and long-lived synthesis. A code repository owns
file and symbol behavior, protocol contracts, service internals,
release-specific implementation, and local development procedures.

## Close attachment provenance

Normalize URL-encoded names and remove rendering suffixes such as
`?download=1` or `&primitive=1`. Resolve every declared attachment and local
image, copy only referenced files into the destination's flat `assets/`
directory, and preserve media type, byte count, and SHA-256. Stop on a missing
file or a same-name/different-hash collision. Localize links, then calculate
the admitted raw page's final hash.

## Freeze one disposition per record

Copy `templates/source-curation-manifest.json.tmpl` into
`scratch/source-curation/`. Before any destination write, set its status to
`frozen` and assign one direct, reasoned disposition to every record:

- `selected-current-vault`
- `selected-code-repository`
- `selected-child-vault`
- `already-represented`
- `rejected-sensitive`
- `rejected-invalid-source`
- `rejected-missing-attachment`
- `rejected-obsolete`
- `rejected-low-reuse`
- `rejected-out-of-scope`
- `deferred-review`

Complete all decision and collision preflight before the first write. Create
new files only. Accept existing output only when its identity and expected hash
match the frozen decision. Append the vault log only after every page and
attachment succeeds. Recompute expected output when resuming a partial run.

## Finish

Rebuild destination indexes, append material events to each changed vault log,
and publish a concise report under `output/source-curation/`. Keep the audit
JSONL and frozen manifest under `scratch/`. If the evidence will produce
durable pages, continue with the bulk-ingestion semantic gates.
