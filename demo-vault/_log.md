---
type: "Log"
title: "LLM Wiki demo history"
description: "Oldest-first append-only record of material demo-vault changes."
---

# Bundle history

## [2026-08-13] learned | research corpus overview

- **Learned**: [Research corpus overview](wiki/summaries/research-corpus-overview.md) — The demo corpus connects source-backed language-model architecture, training, data, post-training, evaluation, and inference knowledge.

## [2026-08-13] changed | source-backed demo

- **Changed**: Archived exact-version CC BY 4.0 papers as Markdown/PDF evidence pairs and established the demo as an OKF v0.2 vault.

## [2026-08-17] changed | portable PDF selections

- **Changed**: Added a focused PDF selection workflow that verifies source hashes and extracts portable page regions.

## [2026-08-17] changed | canonical navigation names

- **Changed**: Made `_index.md` and `_log.md` the canonical navigation and history filenames.

## [2026-08-23] changed | Query annotations

- **Changed**: Added local Query discovery and exact Markdown/PDF source annotations with condensed summaries, selection identity, relocation, and PDF hash-staleness suppression.

## [2026-08-23] maintained | deterministic tooling

- **Maintained**: Consolidated deterministic source ingestion, index production, and layered validation under `tools/llm-wiki`.

## [2026-08-24] learned | grouped-query attention and KV-cache cost

- **Learned**: [Why grouped-query attention reduces KV-cache cost](wiki/queries/why-does-grouped-query-attention-reduce-kv-cache-cost.md) — Sharing key/value heads reduces cache memory and bandwidth while retaining more capacity than one shared head.

## [2026-08-24] changed | graph-ready vault layout

- **Changed**: Adopted graph-ready `wiki/` collections, strict `relations` metadata, opaque templates, and AGENTS-only daily active recall.

## [2026-08-24] changed | portable project cards

- **Changed**: Replaced registry and nested project-vault metadata with one portable project card and an implicit ignored checkout-or-symlink binding.

## [2026-08-24] maintained | Nanochat reference boundary

- **Maintained**: Kept Nanochat as a reference-only project; writable code repositories own branch-local knowledge under `docs/llm-wiki/`.

## [2026-08-24] changed | Nanochat project overview

- **Changed**: Reworked the [Nanochat project card](projects/nanochat.md) as a source-free high-level overview of the project's goals, system scope, design philosophy, research use, constraints, and studied baseline.

## [2026-08-24] maintained | OKF actor identities

- **Maintained**: Replaced workflow-like actor labels with the authoring agent identity `codex/gpt-5.6`; deterministic importers retain `process:<id>` identities.

## [2026-08-24] changed | illustrative output placement

- **Changed**: Removed the dedicated `examples/` collection; polished illustrative artifacts belong in `output/`, while repository-specific demonstration code stays with its code repository.

## [2026-08-24] changed | graph-visible summaries

- **Changed**: Moved narrative summaries under `wiki/summaries/` so synthesis participates in the same validated relation graph as Concepts, Comparisons, Entities, and Queries.

## [2026-08-24] changed | contradiction records

- **Changed**: Added `conflicts` metadata and a Contradictions section to every durable knowledge page and authoring template.

## [2026-08-24] learned | rotary position embeddings

- **Learned**: [Rotary position embeddings](wiki/concepts/rotary-position-embeddings.md) — Position-dependent rotations make attention scores depend on relative token offsets while preserving a compact implementation.

## [2026-08-24] learned | pre-norm versus post-norm

- **Learned**: [Pre-norm versus post-norm transformers](wiki/comparisons/pre-norm-vs-post-norm.md) — Pre-norm usually offers a more direct residual gradient path, while post-norm normalizes each completed residual update.

## [2026-08-24] maintained | operational OKF boundary

- **Maintained**: Declared prompts, skills, binary assets, and `.md.tmpl` templates operational rather than OKF concept documents, while keeping them opaque to knowledge traversal.

## [2026-08-24] maintained | append-only log policy

- **Maintained**: Migrated history once to oldest-first canonical events; future material events append through the log producer without rewriting prior bytes.

## [2026-08-24] changed | tag registry and verification policy

- **Changed**: Added the vault-local TAGS.md registry with canonical tags, aliases, and parents; validation now accepts independent machine and human OKF verification events, and the pre-norm/Post-LN comparison is machine-confirmed against two primary papers.

## [2026-08-24] changed | content tag and repository binding rules

- **Changed**: Restricted tags to substantive content pages and kept root operational/navigation files tagless; repository registration now asks for a local working copy and binds it only through projects/code/<id>.

## [2026-08-24] maintained | skill metadata boundary

- **Maintained**: Allowed skills to use native skill-schema tags when useful while keeping skill packages opaque to the vault taxonomy, indexes, validation, and graph.

## [2026-08-24] changed | humanizer skill

- **Changed**: Added an evidence-preserving humanizer skill for natural prose editing, with native writing tags, upstream MIT attribution, and explicit protections for immutable sources, citations, metadata, generated navigation, and human-owned regions.

## [2026-08-25] changed | optional conflict records

- **Changed**: Removed empty conflict metadata and empty Contradictions sections; a real conflict now requires nonempty metadata, explanatory prose, and draft status.

## [2026-08-25] changed | template source and relation shapes

- **Changed**: Durable-page templates now demonstrate complete JSON-flow source and relation items and require replacement with real entries or empty arrays before publication.

## [2026-08-25] changed | simplified tags and demo guide

- **Changed**: Reduced TAGS.md to canonical headings with direct descriptions, removed unused alias and parent metadata, and rewrote README.md as a practical guide to the corpus, learning loop, evidence boundaries, viewer workflow, and validation.

## [2026-08-25] changed | research workflow skills

- **Changed**: Added framework-neutral arXiv discovery, grounded-citation, and research-paper-writing skills with upstream MIT attribution and installed copies.
