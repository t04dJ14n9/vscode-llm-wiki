---
type: "Reference"
title: "Graph-ready LLM Wiki schema"
description: "OKF v0.2 placement, project cards, relations, Queries, templates, and daily-review rules."
tags: ["open-knowledge-format", "provenance", "reproducibility"]
status: "stable"
scope: "vault"
generated: {"by": "process:vault-format-v2", "at": "2026-08-24T00:00:00+08:00"}
---

# Graph-ready LLM Wiki schema

The root `_index.md` has only `okf_version: "0.2"` frontmatter. Nested `_index.md` files are frontmatter-free immediate-child navigation; `_log.md` is the only log. Assets, templates, `projects/code`, hidden runtime state, and skills are opaque.

Graph-visible Markdown is limited to `wiki/**` except `_index.md`. Node properties are `title`, `type`, `status`, and `tags`. Directed edges come only from JSON-flow `relations`, whose targets are relative to `wiki/` and use the kinds documented in AGENTS.md. Body links remain navigation and provenance.

Concept and Entity pages require creation metadata. Query pages require a concise answer, immutable selection identity, provenance, exact anchors, standard answer/evidence/limitations/related sections, and relations. Daily notes use `Asia/Shanghai`, fixed review dates, required human/agent markers, unique occurrence IDs, at most ten review prompts, and at most one selected outcome per prompt.

Each `projects/<id>.md` card stores only portable VCS identity and observation fields. The optional local checkout or symlink is derived as `projects/code/<id>`; repository-owned knowledge lives at `docs/llm-wiki/` and is versioned with that repository.
