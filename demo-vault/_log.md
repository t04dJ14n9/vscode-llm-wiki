---
type: "Log"
title: "LLM Wiki demo history"
---

# Bundle history

## 2026-08-24

- **Changed**: Removed the dedicated `examples/` collection; polished illustrative artifacts belong in `output/`, while repository-specific demonstration code stays with its code repository.
- **Maintained**: Corrected the Nanochat card's OKF generator identity from a workflow-like process label to the authoring agent actor `codex/gpt-5.6`, and documented actor selection for future pages.
- **Changed**: Reworked the [Nanochat project card](projects/nanochat.md) as a source-free high-level overview of the project's goals, system scope, design philosophy, research use, constraints, and studied baseline.
- **Learned**: [Why grouped-query attention reduces KV-cache cost](wiki/queries/why-does-grouped-query-attention-reduce-kv-cache-cost.md) — Sharing key/value heads reduces cache memory and bandwidth while retaining more capacity than one shared head.
- **Changed**: Adopted graph-ready `wiki/` collections, strict `relations` metadata, opaque templates, and AGENTS-only daily active recall.
- **Changed**: Replaced registry and nested project-vault metadata with one portable project card and an implicit ignored checkout-or-symlink binding.
- **Maintained**: Kept Nanochat as a reference-only project; writable code repositories own branch-local knowledge under `docs/llm-wiki/`.

## 2026-08-23

- **Changed**: Added local Query discovery and exact Markdown/PDF source annotations with condensed summaries, selection identity, relocation, and PDF hash-staleness suppression.
- **Maintained**: Consolidated deterministic source ingestion, index production, and layered validation under `tools/llm-wiki`.

## 2026-08-17

- **Changed**: Added a focused PDF selection workflow that verifies source hashes and extracts portable page regions.
- **Changed**: Made `_index.md` and `_log.md` the canonical navigation and history filenames.

## 2026-08-13

- **Learned**: [Research corpus overview](summaries/research-corpus-overview.md) — The demo corpus connects source-backed language-model architecture, training, data, post-training, evaluation, and inference knowledge.
- **Changed**: Archived exact-version CC BY 4.0 papers as Markdown/PDF evidence pairs and established the demo as an OKF v0.2 vault.
