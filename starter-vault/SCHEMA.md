---
type: "Reference"
title: "Vault schema"
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

The root `_index.md` has only `okf_version: "0.2"` frontmatter. Nested `_index.md` files are frontmatter-free immediate-child navigation; `_log.md` is the only log. Assets, templates, `projects/code`, hidden runtime state, and skills are opaque.

Indexes are heading-based hierarchical immediate-child catalogs organized by
content domain and semantic subtopic, never document form or numeric range.
The hierarchy is vault-owned data in `TAGS.md` frontmatter under
`index_topics`: each registered tag may declare a display `title`, optional
`parent`, and optional `source_roots` rules for deriving deeper headings from a
source path. The shared generator contains no product or domain vocabulary.
`_log.md` is an oldest-first append-only event stream. Year, month, and day use
H2, H3, and H4 headings; each event is a parseable
`- [YYYY-MM-DD] kind | subject - **Kind**: message` list leaf. A day over 20
direct events produces a non-blocking curation warning. New events
are appended at the end using `templates/_log.md.tmpl`; prior bytes are
immutable. Use a deterministic producer when one is available.

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

Every admitted textual source has one immutable Markdown snapshot under
`raw/`. Its frontmatter records source identity, retrieval or export time,
revision when available, capture method, body hash, and documented omissions.
The body is evidence rather than synthesis: native text remains verbatim, and
format conversion preserves wording and reading order without translation or
editorial correction. An available non-Markdown original may be retained in
`assets/` with its own byte hash. Page identity changes are atomic graph
migrations: update incoming and outgoing relations, source resources,
daily-note references, and body links together before rebuilding indexes and
appending the log event.

Durable page admission is a curation rule, not an additional OKF field. Before
creating a Concept, Comparison, Entity, or Summary, maintainers search the
existing graph and establish recurrence, reuse, substantial primary-source
treatment, or explicit user scope. The working task or ingestion manifest
records the basis; published pages continue to use the ordinary type schema.

The frontmatter and machine-readable integrity rules are normative. Durable
templates demonstrate reference compositions: reader-facing headings and order
may be renamed, merged, reordered, or omitted. They also demonstrate the
minimum JSON-flow item shapes:

```yaml
sources: [{"id": "source-id", "resource": "../raw/source.md", "title": "Source title"}]
relations: [{"target": "concepts/target.md", "kind": "references", "caption": "Uses the target definition"}]
```

Replace template samples with real entries or `[]`. A `sources[].id` is the
stable join key for matching body footnotes. Relation targets are relative to
the recognized `wiki/` root, not the current page.

Operational prompts and skills, assets, and `.md.tmpl` templates are outside
the OKF concept-document set. They follow their native schemas and are opaque
to OKF indexing and graph discovery. Template frontmatter examples describe
the normative data contract; reader-facing body composition is advisory.

Conflicts are optional on Summary, Concept, Comparison, Entity, and Query
pages. Omit the metadata when none exists. A real conflict requires a nonempty
unique `conflicts` list, clear prose presenting the disagreement, and
`status: draft` until resolution; no heading name is prescribed. Concept and
Entity pages additionally require creation metadata. Query pages require a
concise answer, immutable selection identity, provenance, exact anchors,
evidence, limitations, related-page context, and relations, but no standard
body headings or order. Daily notes use
`Asia/Shanghai`, fixed review dates, required human/agent markers, unique
occurrence IDs, at most ten review prompts, and at most one selected
Again/Hard/Good/Easy outcome per prompt. Daily notes are chronological entry
nodes and are exempt from inbound-orphan requirements while still relating
outward to learned and reviewed pages.

Optional `verified` metadata accepts one event or a nonempty list of events.
Each event contains an OKF actor in `by` and an ISO datetime in `at`.
Non-human actors provide machine confirmation; any `human:<id>` event records
human review. Verification remains independent of lifecycle `status`.

Bulk-ingestion manifests are opaque workbench artifacts under `inbox`, `tasks`,
or `scratch`. They may freeze candidate aliases, target paths, admission
decisions, source IDs, evidence locations, tags, and relations before prose is
written. They are neither OKF concept documents nor provenance substitutes;
after publication, durable pages and immutable sources are authoritative.

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

## Workflow configuration and non-knowledge artifacts

The nearest `AGENTS.md` configures `vault_prose_language` and
`response_language`. These settings govern new synthesis and agent responses;
they do not alter OKF page types or immutable source text.

Every `tasks/*.md` page represents one actionable goal, even when it contains
several implementation checkboxes. Reports are `output/` artifacts, while
manifests and intermediate machine output are `scratch/` artifacts. Neither is
a task merely because it was produced while completing one. Bulk-ingestion and
source-curation manifests remain opaque and never become graph nodes.

`vaults/<id>.md` is the portable record for another knowledge vault and uses
`type: "Knowledge Vault"`. Its `vault_id` matches the filename and implies the
only local binding, ignored `vaults/bindings/<id>`. The card records canonical
identity, tracked ref, observed revision and time, status, a contained Markdown
entrypoint, contained search roots, and an ownership statement, but never a
local path. `vaults/bindings`, like
`projects/code`, is opaque. Cross-vault body links are navigation only;
`relations[].target` remains inside the current `wiki/` root.
