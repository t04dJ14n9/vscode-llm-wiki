---
type: "Playbook"
title: "Nanochat wiki operator handbook"
description: "Executable workflows for orienting, ingesting, compiling, querying, linting, and maintaining this bundle."
tags: ["operations", "project-nanochat", "reproducibility"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
---

# Nanochat wiki operator handbook

Run commands from this bundle root unless a command says otherwise. Producer
tools live in `tools/okf/`; the reusable workflow is in
`.agents/skills/llm-wiki/`.

## Initialize or audit a vault

For an existing vault, preserve content and establish its current state before
editing:

```bash
git status --short
git submodule status -- projects/code/nanochat
git lfs ls-files
python3 tools/okf/rebuild_indexes.py --vault . --check
python3 tools/okf/validate_vault.py --vault .
```

For a new vault, establish the root, reserved files, evidence/project layers,
compiled categories, and one local index per visible directory. Keep skills
and producer tools outside the bundle.

## Orientation

1. Read [the schema](SCHEMA.md).
2. Read the [root index](index.md), [project index](projects/index.md), and
   [raw index](raw/index.md).
3. Read the newest date group in [the log](log.md).
4. Search existing titles, aliases, tags, and bodies before creating a page.
5. Run `git submodule update --init --recursive` before relying on code.

## Ingest a source

For arXiv, use an exact version and the canonical ingester:

```bash
python3 tools/okf/ingest_arxiv.py \
  --vault . \
  --id 1508.07909v5
```

Confirm the exact arXiv record grants the accepted redistribution license.
Verify title, authors, version dates, local attachment, extraction notice, byte
size, and hashes. Never hand-edit or overwrite an existing raw snapshot.

For a web clip, save the canonical URL, retrieval time, page title, author when
known, license/usage boundary, content hash, and mechanically captured body in
a typed raw companion. Store large local media in `raw/assets/`.

For a user-supplied file, preserve its original bytes, record origin and
receipt time, hash the asset, and state whether text extraction was lossy.
Never claim a license that the supplied material does not provide.

After capture, compile durable takeaways into a substantive page; do not put
synthesis in raw evidence.

## Compile and update knowledge

1. Search for existing coverage.
2. Choose the smallest durable role: summary, entity, concept, comparison, or
   saved query.
3. Add source entries before writing sourced claims.
4. Join each claim to `sources[].id` with a nearby footnote.
5. Link to exact Nanochat files and record the pinned commit for code claims.
6. Distinguish source facts, synthesis, uncertainty, and further reading.
7. Add at least two useful related compiled links without manufacturing links
   solely to satisfy the validator.
8. Rebuild, validate, inspect the diff, and update the log.

Do not duplicate project orientation as an entity. Update
`projects/nanochat.md` when project-level orientation changes.

## Answer and file a query

Read compiled pages first. Follow provenance into raw companions, PDFs, or
project source only as needed. State the direct answer, evidence trail, and
limits.

File under `queries/` only when the answer is recurring, substantial, and
expensive to reconstruct. Keep reusable mechanisms in concepts and link to
them instead of duplicating their prose.

## Lint and rebuild

Check without mutation:

```bash
python3 tools/okf/rebuild_indexes.py --vault . --check
python3 tools/okf/validate_vault.py --vault .
python3 -m unittest discover -s tools/okf/tests -v
```

Intentionally regenerate:

```bash
python3 tools/okf/rebuild_indexes.py --vault .
python3 tools/okf/rebuild_indexes.py --vault . --check
python3 tools/okf/validate_vault.py --vault .
```

A base-OKF parse is not the complete gate; this repository's validator also
checks evidence integrity, project pins, LFS, links, and editorial profile.

## Handle conflicts

Keep both sourced positions and their dates. Mark affected compiled pages
`status: draft`; add structured conflict entries with `resource`, `observed`,
and `reason`; make counterpart links symmetric.

Do not invent `status: contested`, silently choose a winner, or claim human
review. Ask for human direction when policy or ambiguous evidence cannot
resolve the disagreement.

## Maintain the Nanochat submodule

Inspect agreement:

```bash
git ls-files --stage projects/code/nanochat
git -C projects/code/nanochat rev-parse HEAD
git config -f .gitmodules --get-regexp \
  '^submodule\..*\.\(path\|url\)$'
```

An intentional advance requires reviewing the upstream diff, checking out one
exact commit, updating `projects/nanochat.md`, rechecking all code citations,
rebuilding indexes, validating, and logging the change. Never copy the source
tree into `raw/`.

## Finish a material mutation

Run:

```bash
python3 tools/okf/rebuild_indexes.py --vault .
python3 tools/okf/rebuild_indexes.py --vault . --check
python3 tools/okf/validate_vault.py --vault .
git diff --check
git status --short
```

Add a newest-first log entry only after the mutation and its validation are
understood.
