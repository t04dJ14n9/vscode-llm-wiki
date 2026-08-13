---
name: llm-wiki
description: "Use when setting up, converting, ingesting, compiling, querying, linting, or maintaining a Git-backed LLM wiki or Open Knowledge Format vault with raw papers, PDFs, web clips, project source, or hierarchical indexes."
---

# LLM Wiki

## Overview

Maintain one inspectable knowledge graph in ordinary files: preserve source
evidence, compile durable understanding separately, and make every navigation
step explicit through generated indexes and links.

## Workflow

1. Locate the intended bundle root. A strict OKF bundle has a root `index.md`;
   it may be a repository or a subdirectory.
2. Preserve existing content unless the user explicitly requests replacement.
   Never silently turn an existing vault into a new scaffold.
3. Read the bundle's `AGENTS.md`, `SCHEMA.md`, root `index.md`, and newest
   `log.md` entry before mutation.
4. Read the reference for the operation:

   - Structure, conversion, or validation: [OKF profile](references/okf-profile.md)
   - Paper capture: [arXiv ingestion](references/arxiv-ingestion.md)
   - Compilation, queries, and conflicts: [authoring workflow](references/authoring-workflow.md)

5. Use repository-local producer scripts when present. Inspect `--help`; do
   not reproduce fragile download, hash, index, or validation logic by hand.
6. Finish every mutation by rebuilding indexes, running check mode and full
   validation, then adding a newest-first log entry for material changes.

## Invariants

- Keep the reusable skill and producer tooling outside a strict bundle.
- Give every non-reserved Markdown document a nonempty OKF `type`.
- Give every visible bundle-owned directory an immediate-child `index.md`.
- Treat raw snapshots as immutable evidence; write synthesis elsewhere.
- Store large binary evidence through Git LFS without routing Markdown to LFS.
- Store upstream projects as exact-commit submodules or external resources,
  never as unexplained copied trees.
- Attribute sourced claims with footnotes keyed to `sources[].id`.
- Use only `draft`, `stable`, or `deprecated` lifecycle values.
- Record unresolved disagreement explicitly; do not manufacture consensus.

## Quick Reference

| Situation | Action |
| --- | --- |
| Existing vault | Orient, validate, and preserve before editing |
| New source | Capture immutable evidence, then rebuild and validate |
| New explanation | Search first; enrich an existing concept when possible |
| New directory | Add or generate its local `index.md` |
| Conflicting sources | Keep `status: draft`, record both positions, escalate |
| Completion | Rebuild, check, validate, inspect diff, update log |

## Example

From a bundle root whose producer tools live in the parent repository:

```bash
python3 ../tools/demo-vault/ingest_arxiv.py --vault . --id 1508.07909v5
python3 ../tools/demo-vault/rebuild_indexes.py --vault .
python3 ../tools/demo-vault/rebuild_indexes.py --vault . --check
python3 ../tools/demo-vault/validate_vault.py --vault .
```

## Common Mistakes

- Treating `index.md` as a global dump instead of one navigation level.
- Putting summaries into raw companions.
- Using arXiv IDs instead of canonical titles as ordinary filenames.
- Claiming human verification after only automated linting.
- Editing a submodule's upstream files to satisfy the outer bundle profile.
- Stopping after generation without check-mode and integrity validation.
