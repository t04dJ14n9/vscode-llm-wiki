# Nanochat LLM Wiki Demo Vault Design

## Objective

Replace the ignored, stateful `demo-vault/` with a tracked, self-contained
sample LLM wiki that demonstrates the intended product experience:

- immutable, locally readable source evidence;
- a pinned source-code project;
- meaningful, interlinked compiled knowledge;
- Google Open Knowledge Format (OKF) v0.2 compatibility;
- Karpathy/Hermes-style wiki maintenance;
- normal agent workflows documented in `AGENTS.md`; and
- verified reading, navigation, source tracing, and PDF viewing through the
  repository's VS Code extension.

The sample domain is the end-to-end construction of a small language model,
using Andrej Karpathy's Nanochat repository and a curated arXiv research corpus.

## Replacement Scope

`demo-vault/` is replaced in full. The existing ignored content is development
debris rather than source material for the new sample. The replacement removes
the old `.llm_wiki/` runtime database and caches, debug notes, `.omc/` state,
legacy `notes/`, and the topic-partitioned `raw/` tree.

The root `.gitignore` entry that ignores all of `demo-vault/` is removed so the
sample becomes a reviewed repository artifact. A local
`demo-vault/.gitignore` excludes runtime state such as `.llm_wiki/`,
`.DS_Store`, temporary extraction files, and editor-specific projections.

Production extension behavior is not changed merely to accommodate the sample.
A focused demo-vault reading smoke test is added to the existing extension test
harness to prove the extension can read the resulting vault.

## Standards and Design Principles

The design combines:

- OKF v0.2, with `wiki/` as the conforming bundle root;
- the Hermes LLM Wiki division between immutable raw evidence and agent-owned
  compiled pages;
- the DeltaForceVault separation of `raw/`, `projects/`, and `wiki/`;
- plain Markdown and filesystem navigation, with no database or embeddings;
- stable source paths and explicit provenance; and
- a real Git submodule for project source instead of copied repository files.

`raw/` and `projects/` are outside the OKF bundle. They are evidence layers, not
compiled knowledge pages.

## Target Layout

```text
demo-vault/
├── README.md
├── SCHEMA.md
├── AGENTS.md
├── CLAUDE.md
├── index.md
├── log.md
├── .gitattributes
├── .gitignore
├── .agents/
│   └── skills/
│       └── llm-wiki/
│           ├── SKILL.md
│           └── references/
│               ├── arxiv-ingestion.md
│               └── frontmatter.md
├── scripts/
│   ├── ingest_arxiv.py
│   ├── rebuild_indexes.py
│   ├── validate_vault.py
│   └── tests/
├── raw/
│   ├── <canonical-paper-title>.md
│   └── assets/
│       └── <canonical-paper-title>.pdf
├── projects/
│   ├── index.md
│   ├── nanochat.md
│   └── code/
│       └── nanochat/                 # Git submodule
└── wiki/
    ├── index.md
    ├── summaries/
    │   └── index.md
    ├── entities/
    │   └── index.md
    ├── concepts/
    │   └── index.md
    ├── comparisons/
    │   └── index.md
    └── queries/
        └── index.md
```

There is deliberately no `raw/index.md`, no raw topic hierarchy, no copied
Nanochat source under `raw/assets/`, no SQLite index, and no committed
extension runtime state.

## Raw Research Corpus

The initial corpus contains eight version-pinned arXiv papers whose arXiv
records identify the paper as CC BY 4.0:

| Area | Paper | Pinned source |
| --- | --- | --- |
| Tokenization | Neural Machine Translation of Rare Words with Subword Units | `1508.07909v5` |
| Data curation | The FineWeb Datasets: Decanting the Web for the Finest Text Data at Scale | `2406.17557v2` |
| Data and evaluation | DataComp-LM: In search of the next generation of training sets for language models | `2406.11794v4` |
| Small-model training | SmolLM2: When Smol Goes Big -- Data-Centric Training of a Small Language Model | `2502.02737v1` |
| Architecture | GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints | `2305.13245v3` |
| Attention systems | FlashAttention-3: Fast and Accurate Attention with Asynchrony and Low-precision | `2407.08608v2` |
| Numerical formats | FP8 Formats for Deep Learning | `2209.05433v2` |
| Post-training | Direct Preference Optimization: Your Language Model is Secretly a Reward Model | `2305.18290v3` |

Canonical papers with incompatible or insufficient redistribution rights may
appear as external further-reading links, but their PDFs are not mirrored and
they are not used as the sole evidence for compiled claims.

### Title-derived filenames

The canonical arXiv title is normalized into the companion filename:

1. Apply Unicode NFKD normalization and remove combining marks.
2. Lowercase and retain ASCII letters and digits.
3. Replace every remaining punctuation or whitespace run with one hyphen.
4. Trim leading and trailing hyphens.
5. Add `.md`; use the identical basename for the PDF.

For example:

```text
raw/neural-machine-translation-of-rare-words-with-subword-units.md
raw/assets/neural-machine-translation-of-rare-words-with-subword-units.pdf
```

ArXiv IDs and versions belong in metadata, not the ordinary filename. If a
different source normalizes to an existing basename, append
`-arxiv-<id>-v<version>` only to the colliding newcomer. Existing raw
snapshots are never renamed or overwritten. Re-ingesting the same ID and
version with the same hashes is a no-op; a changed or newer version becomes a
new snapshot and is surfaced for review.

### Raw companion contract

Each raw paper companion contains:

```yaml
---
title: Exact canonical paper title
source_type: paper
source_url: https://arxiv.org/abs/<id>v<version>
ingested: YYYY-MM-DD
sha256: <sha256 of the Markdown body>
arxiv:
  id: "<id>"
  version: <version>
license:
  id: CC-BY-4.0
  url: https://creativecommons.org/licenses/by/4.0/
attachment:
  path: assets/<title-slug>.pdf
  media_type: application/pdf
  sha256: <sha256 of the PDF>
extraction:
  tool: pdftotext
  version: <observed tool version>
---
```

The body includes the exact title, authors, publication/version metadata,
abstract, a local attachment link, an extraction-lossiness notice, and
mechanically extracted full text. It contains no agent-written summary or
interpretation.

PDFs and common binary image assets under `raw/assets/` are declared in
`.gitattributes` for Git LFS. Markdown companions remain ordinary Git files.

## Nanochat Project

`projects/code/nanochat/` is a Git submodule for
`https://github.com/karpathy/nanochat.git`, pinned to:

```text
92d63d4e8bb4df75c3b71618f31ddde2378b2bcd
```

The sample does not copy Nanochat files into `raw/`. `projects/nanochat.md` is
the single project card and records the repository URL, default branch, pinned
commit, MIT license, purpose, and orientation links. `projects/index.md` is a
generated project catalog.

Wiki claims about Nanochat implementation cite both the project card and
specific relative files in the submodule. The pinned commit recorded in the
card must match the repository gitlink. The README and `AGENTS.md` explain
`git submodule update --init --recursive` for fresh clones.

## OKF Wiki Bundle

`wiki/` is the OKF v0.2 bundle root. `wiki/index.md` declares
`okf_version: "0.2"`. Every non-reserved Markdown page below `wiki/` has
parseable YAML frontmatter with:

```yaml
---
title: Human-readable page title
type: summary | entity | concept | comparison | query
description: One-sentence orientation
tags: [registered, taxonomy, values]
sources:
  - id: stable-source-id
    resource: ../../raw/<source-title>.md
    title: Source title
status: draft | stable | deprecated
generated:
  by: codex/<version>
---
```

Code-backed sources may use a relative resource under
`../../projects/code/nanochat/` and include an extension key for the pinned
commit. OKF readers must tolerate extension keys.

Generated index pages are deterministic, clearly marked, and excluded from the
ordinary concept-page frontmatter requirement. The root `index.md` is a thin
navigation hub to `wiki/index.md` and `projects/index.md`. `log.md` is the one
append-only operations log; there is no `wiki/log.md`.

### Initial compiled page inventory

The sample contains the following substantive pages in addition to indexes:

**Summaries**

- `nanochat-end-to-end-training-pipeline.md`
- `research-corpus-overview.md`

**Entities**

- `fineweb.md`
- `datacomp-lm.md`
- `smollm2-and-smoltalk.md`

**Concepts**

- `byte-pair-encoding.md`
- `bits-per-byte.md`
- `decoder-only-transformers.md`
- `grouped-query-attention.md`
- `flash-attention.md`
- `kv-caching.md`
- `low-precision-training.md`
- `pretraining-data-curation.md`
- `compute-optimal-training.md`
- `supervised-fine-tuning.md`
- `preference-and-policy-optimization.md`

**Comparisons**

- `fineweb-vs-datacomp-lm.md`
- `bf16-vs-fp8.md`
- `dpo-vs-on-policy-reinforcement-learning.md`

**Queries**

- `how-does-nanochat-turn-text-into-a-chat-model.md`
- `where-do-the-paper-ideas-appear-in-nanochat.md`
- `why-does-nanochat-use-bits-per-byte.md`

Pages are concise, cross-linked, and grounded. Every substantive page links to
at least two other compiled pages. Multi-source claims carry nearby relative
source links in addition to the frontmatter source list. Project orientation
stays in `projects/nanochat.md`; it is not duplicated as a wiki entity.

## Knowledge Flow

The intended reading path is:

```text
root index
  -> end-to-end summary or filed query
  -> focused concepts/entities/comparisons
  -> raw paper companions and Nanochat project card
  -> local PDFs and pinned source files
```

Raw companions are discoverable through wiki provenance links and repository
search, not through a raw index. Paper companions link to their matching local
PDF. Code-backed pages link through the project card to files in the pinned
submodule. The result should support forward navigation, backlinks, and graph
exploration without a secondary database.

## `AGENTS.md` Operator Workflows

`demo-vault/AGENTS.md` is the canonical operator handbook. It contains
executable, repository-relative workflows rather than only high-level rules.
At minimum it documents:

### Orientation

1. Read `SCHEMA.md`.
2. Read `wiki/index.md` and `projects/index.md`.
3. Read the most recent entries in `log.md`.
4. Search existing pages before creating new ones.
5. Confirm the Nanochat submodule is initialized before making code-backed
   claims.

### Ingest

- Use a versioned arXiv ID.
- Run `python3 scripts/ingest_arxiv.py --id <id>v<version>`.
- Verify title, version, license, attachment, extraction, and hashes.
- Never hand-edit an existing raw snapshot.
- Compile durable takeaways into typed wiki pages rather than into `raw/`.
- Rebuild indexes, lint, and append the ingest operation to `log.md`.

The handbook also describes equivalent handling for a web clip or a
user-supplied local file even though the starter corpus contains papers.

### Compile and update

- Search for existing entity/concept coverage.
- Create a page only when the subject is central or appears in multiple
  sources.
- Preserve source links near claims.
- Add reciprocal cross-links where meaningful.
- Follow the conflict policy instead of silently replacing a contradictory
  claim.
- Rebuild indexes and record the operation.

### Query

- Read compiled pages first.
- Follow provenance into raw or project evidence only as needed.
- Cite the pages and evidence used.
- File only substantial, expensive-to-rederive answers under `queries/` or
  `comparisons/`.
- Rebuild, lint, and log when a query is filed.

### Lint and rebuild

- `python3 scripts/rebuild_indexes.py --check` checks deterministic indexes.
- `python3 scripts/rebuild_indexes.py` intentionally updates them.
- `python3 scripts/validate_vault.py` runs the complete structural and
  provenance validation.
- `python3 -m unittest discover -s scripts/tests` runs the workflow tests.

### Conflict handling

- Record both positions with dates and sources.
- Mark affected pages as contested and add symmetric contradiction links.
- Stop short of resolving a genuine contradiction without human direction.
- Lint treats malformed conflict metadata as an error.

### Project/submodule maintenance

- Confirm the project card, `.gitmodules`, and gitlink agree.
- Record intentional submodule advances in `log.md`.
- Never duplicate project source in `raw/`.
- Keep wiki code citations pinned to a resolvable commit.

### Extension reading smoke test

The handbook includes the exact build/launch steps and the reading path used
for final acceptance so a future agent can reproduce the extension test.

`CLAUDE.md` points agents to `AGENTS.md` and adds only provider-specific
details; it does not maintain a divergent copy of the workflows.

## Bundled Skill and Scripts

`.agents/skills/llm-wiki/SKILL.md` packages the setup and maintenance workflow
for reuse. It instructs an agent to orient before acting, preserve raw
immutability, use the scripts as canonical mechanics, keep page creation
editorial, update indexes and the log, and surface conflicts.

The scripts have narrow responsibilities:

- `ingest_arxiv.py`: fetch one exact paper version, enforce license policy,
  generate the title-derived companion, download the PDF, extract text, and
  calculate hashes without partially committing a failed ingest.
- `rebuild_indexes.py`: deterministically generate the root, project, bundle,
  and per-type indexes; it never creates a raw index.
- `validate_vault.py`: check schema, provenance, links, files, hashes,
  conflicts, submodule metadata, generated indexes, and forbidden state.

The initial corpus is ingested through the same workflow delivered in the
sample rather than by constructing paper files through an unrelated one-off
path.

## Failure and Integrity Policy

- Downloads use exact versioned URLs and fail closed on HTTP, metadata,
  license, PDF, or extraction errors.
- Ingestion stages work in a temporary directory and publish the Markdown/PDF
  pair only after all checks succeed.
- Existing raw files are never silently overwritten.
- Hash mismatches, missing attachments, and title/path disagreements are hard
  validation failures.
- Generators do not guess missing titles, descriptions, or page types.
- A genuine knowledge conflict is recorded and routed to a human.
- Missing submodules produce an actionable orientation error, not fabricated
  code claims.
- Generated indexes are byte-for-byte reproducible.

## Testing and Acceptance

Script tests cover:

- canonical-title slugging and collisions;
- raw companion and attachment hashing;
- rejection of unversioned or incompatible arXiv inputs;
- failed-ingest atomicity;
- OKF page validation and allowed types;
- deterministic index generation with no raw index;
- broken Markdown links and wiki links;
- tag and source validation;
- conflict symmetry;
- submodule/card agreement; and
- rejection of legacy runtime/database artifacts.

Repository verification includes:

1. all script tests pass;
2. `validate_vault.py` passes from `demo-vault/`;
3. index regeneration produces no diff;
4. all eight title-derived Markdown/PDF pairs exist with matching hashes;
5. Git LFS reports the expected PDF objects;
6. the Nanochat gitlink resolves to the pinned commit;
7. the extension's normal checks and production bundle build pass; and
8. the rebuilt vault is opened through the Extension Development Host.

The extension reading test must demonstrate:

- `index.md` opens the compiled knowledge hub;
- wiki links and backlinks navigate among meaningful pages;
- a paper-backed concept opens its raw companion and local PDF;
- a code-backed concept opens `projects/nanochat.md` and a Nanochat source
  file;
- search finds a paper by its canonical title-derived filename;
- outlines and Markdown rendering remain usable; and
- the PDF reader can display the archived arXiv paper and follow a supported
  internal link.

Test output plus screenshots of the root knowledge hub, one paper opened in the
PDF reader, and one code-backed navigation path provide evidence for the final
handoff.

## Non-goals

- No iWiki integration.
- No database, vector store, embeddings, or setup wizard.
- No Nanochat source fork or copied snapshot.
- No raw catalog or automatic raw directory partitioning.
- No exhaustive survey of all LLM literature.
- No production extension feature changes unless the reading test exposes a
  concrete defect that the user separately authorizes fixing.
