---
type: "Playbook"
title: "Bulk corpus ingestion"
description: "Canonicalize evidence-bound candidates before authoring durable pages, then evaluate coverage and grounded answerability."
tags: ["operations", "provenance"]
status: "stable"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-25T00:57:53+08:00"}
---

# Bulk corpus ingestion

## Purpose

Use this workflow when ingesting enough related sources that independently
drafting pages would risk duplicate concepts, inconsistent names, weak
provenance, or silent coverage gaps. For one source or a few clearly distinct
pages, the ordinary read-search-write workflow is sufficient.

This playbook adapts the canonicalization barrier, frozen page manifest,
notability triage, and semantic evaluation ideas documented in the Cole Medin
AI Knowledge Base at revision
[`eba5e31bc628280c546d4828491051c308d550dc`](https://github.com/coleam00/cole-medin-knowledge-base/blob/eba5e31bc628280c546d4828491051c308d550dc/docs/MAKING-OF.md#L15-L123).
It does not copy that repository's schema, graph conventions, prose, or tools.
This vault's `AGENTS.md`, `SCHEMA.md`, templates, explicit `relations`, and
provenance rules remain authoritative.

## Preconditions

- Define the corpus boundary, inclusion and exclusion rules, expected source
  count, and the questions the corpus should support.
- Archive or identify every source according to its license and the vault's
  provenance rules. Raw textual evidence remains flat under `raw/`; eligible
  binaries remain flat under `assets/` and use Git LFS.
- Search existing durable pages before proposing new targets.
- Copy `templates/bulk-ingestion-manifest.json.tmpl` into `tasks` or `scratch`,
  replace every placeholder, and keep it outside the knowledge graph.

## Procedure

### 1. Extract evidence-bound candidates

Read each source independently and emit structured candidates rather than
finished prose. Each candidate records a proposed type, title, description,
aliases, source IDs, exact evidence locations, possible tags, possible
relations, and the source-scoped claim it could support.

Extraction may run in batches, but it must not create durable pages. Preserve
source wording and locations closely enough that a later reviewer can verify
every candidate without trusting the extraction agent.

### 2. Canonicalize once

Review the complete candidate set against the existing vault in one coherent
canonicalization pass:

1. Merge aliases and semantically equivalent candidates.
2. Prefer an existing durable page when its scope can absorb the evidence
   without changing meaning.
3. Apply the admission rubric in `AGENTS.md` to every proposed new page.
4. Record rejected candidates and direct reasons; rejection is a coverage
   decision, not discarded history.
5. Resolve final target paths, tags, source IDs, and proposed relations.
6. Set the manifest status to `frozen` before prose authoring starts.

Reopen canonicalization explicitly if new evidence invalidates the frozen
structure. Do not let independent writers rename targets, split pages, or add
unreviewed graph nodes opportunistically.

### 3. Author synthesis

Create or extend pages from the frozen manifest. Synthesize across sources
rather than mirroring one page per source. Use the nearest template, preserve
source-ID-to-footnote joins, present limitations and real conflicts, and add
only explicit directed relations that satisfy the vault schema.

A source-oriented Summary may provide corpus or source navigation, but it does
not replace concept-oriented synthesis. Published pages and immutable sources
become authoritative; the manifest remains process evidence in the workbench.

### 4. Build and validate

Rebuild `_index.md` files and run the deterministic vault validator. Fix
placement, metadata, source, anchor, relation, tag, conflict, project-binding,
daily-note, and index failures before semantic evaluation.

### 5. Evaluate semantics

Record the evaluation set, method, results, and unresolved failures in `tasks`
or a polished report under `output`. Complete all five gates:

- **Answerability:** representative in-scope questions are answerable by
  navigating the vault, and the answer cites the supporting pages and sources.
- **Refusal:** deliberately out-of-scope, unsupported, and falsely premised
  questions are declined or qualified rather than answered from model memory.
- **Recall coverage:** sampled sources' important durable ideas map to existing
  pages, approved new pages, or recorded rejection decisions.
- **Citation integrity:** load-bearing quotations and paraphrases still match
  their declared sources and locations at the evaluated revision.
- **Duplicate content:** title, alias, tag, relation, and body review finds no
  competing pages for the same durable idea.

Agent-assisted judgment and optional local similarity models are allowed for
one-off evaluation. Preserve the evaluation inputs and disclose the method;
neither embeddings nor any other model service becomes a vault runtime
dependency. A semantic score does not create a `verified` event unless the
check independently compared the current page content with its evidence.

## Completion criteria

- Every manifest target is published, intentionally deferred, or rejected with
  a reason.
- Every published page passes the deterministic validator and has direct
  evidence for its load-bearing claims.
- All five semantic gates pass, or the remaining failures are explicit in the
  task and affected pages remain draft.
- Generated indexes are current and the material ingestion event is appended
  to `_log.md` without rewriting earlier history.

## Limits

Recurrence and link counts are useful curation signals, not truth metrics. A
single primary paper can justify a durable page, while a frequently mentioned
term can remain too shallow or promotional to keep. Semantic evaluations are
sampled evidence about retrieval behavior, not proof that every future question
will be answered correctly.

## Artifact placement override

Keep the frozen ingestion manifest and intermediate machine output under
`scratch/`, not `tasks/`. Publish evaluation and migration reports under
`output/`. A one-goal task may link to those artifacts when work remains, but
it does not become their storage directory.
