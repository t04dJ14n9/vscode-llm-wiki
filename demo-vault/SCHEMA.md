---
type: "Reference"
title: "Graph-ready LLM Wiki schema"
description: "OKF v0.2 placement, project cards, relations, Queries, templates, and daily-review rules."
status: "stable"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-25T00:20:05+08:00"}
---

# Graph-ready LLM Wiki schema

The root `_index.md` has only `okf_version: "0.2"` frontmatter. Nested `_index.md` files are frontmatter-free immediate-child navigation; `_log.md` is the only log. Assets, templates, `projects/code`, hidden runtime state, and skills are opaque.

Indexes are hierarchical immediate-child catalogs. `_log.md` is an
oldest-first append-only event stream: each event has a parseable
`## [YYYY-MM-DD] kind | subject` heading and one categorized bullet. New events
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

Each `projects/<id>.md` card stores only portable VCS identity and observation
fields. The optional local binding is derived exclusively as
`projects/code/<id>`: an in-place checkout when already there, otherwise an
absolute symlink to a user-supplied and VCS-verified working copy. A missing
binding is allowed for reference-only projects. Local paths are never stored in
the card, and no parallel `workspace/` binding namespace exists.
Repository-owned knowledge lives at `docs/llm-wiki/` and is versioned with that
repository.
