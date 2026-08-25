---
type: "Reference"
title: "Graph-ready LLM Wiki schema"
description: "OKF v0.2 placement, project cards, relations, Queries, templates, and daily-review rules."
status: "stable"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-25T00:57:53+08:00"}
---

# Vault schema

## Asset synchronization invariant

Every file under `assets/**` must be version-controlled through Git LFS so the
vault can reproduce its binary evidence on every device. An asset that is
untracked, ignored, stored as a plain Git blob, or backed by an LFS object that
has not been pushed is a completion blocker. Markdown and code do not belong in
`assets/` and must never be routed through Git LFS.

This demo declares `content_language: "en"` and
`response_language_policy: "match-user"` in `AGENTS.md`. The first controls
durable prose; the second controls conversation. Technical terms may retain
their conventional spelling in either language. These are vault workflow
settings, not OKF graph properties.

The root `_index.md` has only `okf_version: "0.2"` frontmatter. Nested `_index.md` files are frontmatter-free immediate-child navigation; `_log.md` is the only log. Assets, templates, `projects/code`, hidden runtime state, and skills are opaque.

Indexes are heading-based hierarchical immediate-child catalogs organized by
content domain and semantic subtopic, never document form or numeric range.
The hierarchy is vault-owned data in `TAGS.md` frontmatter under
`index_topics`: each registered tag may declare a display `title`, optional
`parent`, and optional `source_roots` rules for deriving deeper headings from a
source path. The shared generator contains no product or domain vocabulary.
`_log.md` is an oldest-first append-only event stream: each event has a
parseable `##### [YYYY-MM-DD] kind | subject` heading and one categorized bullet
under year/month/day parents. Sections over 20 direct entries produce a
non-blocking curation warning. New events
are appended with `tools/llm-wiki/append_log.py`; prior bytes are immutable.

`TAGS.md` is the vault-local central tag registry. Its level-two headings are
canonical lowercase kebab-case tags and the following prose defines when to use
each one. Page tags remain valid OKF metadata when unregistered, but the local
validator emits an advisory warning until the vocabulary is registered.

Substantive concept documents require canonical tags. Root operational and
navigation files (`AGENTS.md`, `README.md`, `SCHEMA.md`, `TAGS.md`, `_index.md`,
and `_log.md`) and operational templates are intentionally tagless. Skills are
opaque packages governed by their native schema; they may carry skill-specific
tags without entering the vault taxonomy or graph.

Graph-visible Markdown is limited to `wiki/**` except `_index.md`, including narrative Summaries. Node properties are `title`, `type`, `status`, and `tags`. Directed edges come only from JSON-flow `relations`, whose targets are relative to `wiki/` and use the kinds documented in AGENTS.md. Body links remain navigation and provenance.

Every admitted textual source has an immutable Markdown snapshot under `raw/`.
Metadata records source identity, retrieval or export time, revision, capture
method, body hash, and omissions. Snapshot bodies preserve original wording and
order without synthesis; available non-Markdown originals remain auditable in
`assets/` with a separate byte hash. Renames, moves, merges, supersession, and
deletion repair incoming and outgoing relations, source resources, daily
references, and body links before indexes and the append-only log are updated.

Durable page admission is a curation rule, not an additional OKF field. Before
creating a Concept, Comparison, Entity, or Summary, maintainers search the
existing graph and establish recurrence, reuse, substantial primary-source
treatment, or explicit user scope. The working task or ingestion manifest
records the basis; published pages continue to use the ordinary type schema.

Durable templates demonstrate the minimum JSON-flow item shapes:

```yaml
sources: [{"id": "source-id", "resource": "../raw/source.md", "title": "Source title"}]
relations: [{"target": "concepts/target.md", "kind": "references", "caption": "Uses the target definition"}]
```

Replace template samples with real entries or `[]`. A `sources[].id` is the
stable join key for matching body footnotes. Relation targets are relative to
the recognized `wiki/` root, not the current page.

Operational prompts and skills, assets, and `.md.tmpl` templates are outside
the OKF concept-document set. They follow their native schemas and are opaque
to OKF validation, indexing, and graph discovery.

Conflicts are optional on Summary, Concept, Comparison, Entity, and Query
pages. Omit both metadata and prose when none exists. A real conflict requires a
nonempty unique `conflicts` list, a `Contradictions` section presenting the
disagreement, and `status: draft` until resolution. Concept and Entity pages
additionally require creation metadata. Query pages require a concise answer,
immutable selection identity, provenance, exact anchors, standard
answer/evidence/limitations/related sections, and relations. Daily notes use
`Asia/Shanghai`, fixed review dates, required human/agent markers, unique
occurrence IDs, at most ten review prompts, and at most one selected
Again/Hard/Good/Easy outcome per prompt. Daily notes are chronological entry
nodes and are exempt from inbound-orphan requirements while still relating
outward to learned and reviewed pages.

Optional `verified` metadata accepts one event or a nonempty list of events.
Each event contains an OKF actor in `by` and an ISO datetime in `at`.
Non-human actors provide machine confirmation; any `human:<id>` event records
human review. Verification remains independent of lifecycle `status`.

Active bulk-ingestion manifests are opaque workbench artifacts under `inbox`
or `scratch`. They may freeze candidate aliases, target paths, admission
decisions, source IDs, evidence locations, tags, and relations before prose is
written. They are neither OKF concept documents nor provenance substitutes;
after publication, durable pages and immutable sources are authoritative.
Completed manifests and audit reports move to `output`, not `tasks`.

Every `tasks/*.md` file represents one actionable outcome. A task may contain
several implementation steps, but it must not double as a migration archive,
manifest collection, status digest, or unrelated backlog. Completed reports
and machine-readable evidence belong under `output`.

Deterministic validation establishes structural conformance. A material corpus
ingest additionally records semantic evaluation for answerability,
out-of-scope refusal, recall coverage, citation integrity, and duplicate
content. Those evaluations may be agent-assisted or use optional local models,
but no embeddings service or database is part of the vault runtime contract.

Each `projects/<id>.md` card stores only portable VCS identity and observation
fields. The optional local binding is derived exclusively as
`projects/code/<id>`: an in-place checkout when already there, otherwise an
absolute symlink to a user-supplied and VCS-verified working copy. A missing
binding is allowed for reference-only projects. Local paths are never stored in
the card, and no parallel `workspace/` binding namespace exists.
Repository-owned knowledge lives at `docs/llm-wiki/` and is versioned with that
repository.

Each `vaults/<vault-id>.md` card registers one independently maintained child
vault with producer extension `type: "Knowledge Vault"`. It stores `vault_id`,
Git identity, tracked ref, observed revision and time, profile, entrypoint,
nonempty search roots, and active/reference status. The optional local binding
is derived as ignored `vaults/bindings/<vault-id>`; cards never store local
paths, and child vaults are not Git submodules. Parent indexing treats child
content as opaque. Relations remain inside one graph, so cross-vault evidence
uses pinned repository URLs rather than relation targets.
