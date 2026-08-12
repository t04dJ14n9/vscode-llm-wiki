---
type: "Reference"
title: "Nanochat wiki schema"
description: "The strict OKF v0.2 profile, evidence boundaries, and integrity rules used by this bundle."
tags: ["open-knowledge-format", "provenance", "reproducibility"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
---

# Nanochat wiki schema

## Bundle boundary

This directory is the OKF v0.2 bundle root and unit of distribution. Every
non-reserved Markdown file below it is a concept document. `index.md` and
`log.md` are reserved at every level.

The reusable skill and producer scripts live in the parent repository, outside
this bundle. `projects/code/nanochat/` is an opaque nested Git repository and
is not parsed as OKF.

## Directory roles

| Directory | Content | Ordinary type |
| --- | --- | --- |
| `raw/` | Immutable paper companions | `Paper` |
| `raw/assets/` | Archived PDFs and source media | binary resources |
| `projects/` | Pinned project orientation | `Software Project` |
| `summaries/` | Narrative entry points | `Summary` |
| `entities/` | Named datasets, models, and artifacts | `Entity` |
| `concepts/` | Focused mechanisms and ideas | `Concept` |
| `comparisons/` | Decision-oriented contrasts | `Comparison` |
| `queries/` | Durable answers | `Query` |

Root `README.md` and this file are `Reference` concepts. `AGENTS.md` is a
`Playbook`.

## Concept frontmatter

Base OKF requires only `type`. This bundle's maintained profile also requires
`title`, `description`, nonempty registered `tags`, `status`, and
`generated.by` plus `generated.at`.

Substantive compiled pages carry a nonempty `sources` list:

```yaml
---
type: "Concept"
title: "Byte-pair encoding"
description: "Subword tokenization learned by iterative pair merges."
tags: ["tokenization", "project-nanochat"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources:
  - {"id": "bpe-paper", "resource": "../raw/paper.md", "title": "Paper title"}
---
```

Allowed lifecycle values are `draft`, `stable`, and `deprecated`. Unknown
types and extension keys remain valid base OKF and must survive round trips.

Actors use `human:<id>`, `process:<id>`, or `<producer>/<version>`.
`generated` records authorship. `verified` records an actual check and is
never inferred from authorship or linting.

## Claim attribution

A source ID joins frontmatter provenance to a body claim:

```markdown
The tokenizer learns a finite merge table.[^bpe-paper]

[^bpe-paper]: Paper title
```

Every referenced footnote has a matching `sources[].id` and definition.
Compiled pages use every listed source. Links to other concepts do not replace
claim attribution.

## Hierarchical indexes

Every visible bundle-owned directory has an `index.md`. Each index lists only
immediate children, groups concepts by exact type, links subdirectories to
their own indexes, and includes descriptions. Indexes are generated
deterministically.

Only the root index has frontmatter, containing exactly:

```yaml
---
okf_version: "0.2"
---
```

Paths are concept IDs. Directory size never triggers an automatic move.

## Raw paper contract

A paper companion and PDF use the same canonical-title-derived basename. The
companion records exact arXiv version, redistribution license, authors,
version dates, generated time, body SHA-256, PDF resource, media type, byte
size, PDF SHA-256, and extraction tool/version.

Its body contains source metadata, abstract, a local PDF link, an extraction
lossiness notice, and mechanically extracted full text. It contains no
agent-written interpretation. Existing snapshots are immutable.

Binary assets use extension-specific Git LFS patterns. Markdown under
`raw/assets/` must remain ordinary Git text.

## Project contract

`projects/nanochat.md`, `.gitmodules`, the repository gitlink, and initialized
submodule `HEAD` record the same repository and full commit. Compiled code
sources include the pinned commit in their source entry.

The outer validator does not descend into the upstream project or rewrite its
Markdown.

## Conflicts and history

Unresolved knowledge stays `draft`. Structured conflict entries contain a
counterpart resource, observation date, and reason; counterpart pages link
back. `log.md` groups material operations by ISO date, newest first.

Caches, SQLite databases, embeddings, temporary ingest directories, editor
state, and duplicate project source are outside the bundle.
