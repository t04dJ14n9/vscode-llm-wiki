# Nanochat LLM Wiki Demo Vault Design

## Status

Approved for implementation.

## Objective

Replace the ignored, stateful `demo-vault/` with a tracked, distributable
Open Knowledge Format (OKF) v0.2 bundle about building a small language model.
The bundle uses Andrej Karpathy's Nanochat repository and a curated,
redistributable arXiv corpus to demonstrate:

- immutable local evidence;
- a pinned source-code project;
- meaningful, interlinked compiled knowledge;
- hierarchical progressive disclosure;
- human- and agent-readable provenance;
- normal ingest, compile, query, lint, and maintenance workflows; and
- a smooth reading experience through this repository's extension in both
  VS Code and Cursor.

The finished artifact is a real sample wiki, not a fixture made only to satisfy
tests. A reader should be able to start at `demo-vault/index.md`, understand
Nanochat's end-to-end training path, follow a claim into a source paper or
pinned code file, and read the archived PDF without leaving the editor.

## Standards

The design combines:

- Google Open Knowledge Format v0.2;
- Karpathy's flat, plain-file LLM wiki approach;
- the Hermes research workflow's separation of source capture and compiled
  knowledge;
- the DeltaForceVault separation of raw evidence, projects, and durable
  knowledge;
- Git and Git LFS for durable distribution;
- a Git submodule for upstream project source; and
- ordinary Markdown links rather than a required database or vector index.

OKF is the interoperability floor. The repository adds a stricter
`nanochat-wiki` profile for deterministic indexes, immutable paper snapshots,
attachment integrity, project pinning, and editorial link quality. Consumers
must still tolerate unknown OKF types and extension fields.

## Bundle Boundary

`demo-vault/` itself is the OKF bundle root and the unit of distribution.
There is no nested `wiki/` bundle.

Every non-reserved Markdown file anywhere below `demo-vault/` is therefore an
OKF concept document and must contain parseable YAML frontmatter with a
non-empty `type`. `index.md` and `log.md` retain their reserved OKF meanings.

Reusable agent skills, producer scripts, and their tests live outside the
bundle. This prevents implementation documentation such as `SKILL.md` from
being misclassified as bundle concepts and keeps the distributable bundle
focused on knowledge and evidence.

## Repository Layout

```text
human-learning/
├── .gitmodules
├── .agents/
│   └── skills/
│       └── llm-wiki/
│           ├── SKILL.md
│           └── references/
│               ├── arxiv-ingestion.md
│               ├── authoring-workflow.md
│               └── okf-profile.md
├── tools/
│   └── demo-vault/
│       ├── __init__.py
│       ├── vaultlib.py
│       ├── ingest_arxiv.py
│       ├── rebuild_indexes.py
│       ├── validate_vault.py
│       └── tests/
└── demo-vault/
    ├── index.md
    ├── log.md
    ├── README.md
    ├── SCHEMA.md
    ├── AGENTS.md
    ├── .gitattributes
    ├── .gitignore
    ├── raw/
    │   ├── index.md
    │   ├── <canonical-paper-title>.md
    │   └── assets/
    │       ├── index.md
    │       └── <canonical-paper-title>.pdf
    ├── projects/
    │   ├── index.md
    │   ├── nanochat.md
    │   └── code/
    │       ├── index.md
    │       └── nanochat/                 # exact-commit Git submodule
    ├── summaries/
    │   ├── index.md
    │   └── *.md
    ├── entities/
    │   ├── index.md
    │   └── *.md
    ├── concepts/
    │   ├── index.md
    │   └── *.md
    ├── comparisons/
    │   ├── index.md
    │   └── *.md
    └── queries/
        ├── index.md
        └── *.md
```

There is no committed SQLite database, embedding index, extracted cache,
editor state, copied Nanochat snapshot, or duplicate source tree.

## Hierarchical Index Contract

Every visible directory owned by the bundle has an `index.md`, including
`raw/`, `raw/assets/`, `projects/`, and `projects/code/`.

The only exceptions are:

- hidden or ignored runtime directories;
- version-control internals; and
- `projects/code/nanochat/`, which is an opaque upstream Git submodule and is
  indexed by its parent without being modified.

Indexes implement progressive disclosure:

1. An index lists only immediate child concepts, resources, and directories.
2. A directory entry links to `child/`; the consumer opens that child's
   `index.md`.
3. Concept entries are grouped under their exact `type`.
4. Resource entries such as PDFs and the Nanochat gitlink have descriptive
   sections.
5. Entries use relative Markdown links.
6. Titles and descriptions come from concept metadata or a deterministic
   resource record; the generator never invents them with an LLM.
7. Entries are sorted case-insensitively by display title.
8. Regeneration is byte-for-byte deterministic.

The root index begins with the only index frontmatter allowed by this profile:

```yaml
---
okf_version: "0.2"
---
```

All other indexes contain no frontmatter. The root index links every
top-level knowledge/evidence directory and the root concepts. It does not
flatten the whole bundle.

Directory size does not trigger automatic repartitioning. Paths are concept
IDs, so automatic moves would destabilize links and history. A future
human-reviewed taxonomy migration may introduce subdirectories and update all
references atomically.

## Concept Documents

The bundle uses descriptive, open OKF types:

| Location | Type |
| --- | --- |
| `README.md`, `SCHEMA.md` | `Reference` |
| `AGENTS.md` | `Playbook` |
| `raw/*.md` | `Paper` |
| `projects/*.md` | `Software Project` |
| `summaries/*.md` | `Summary` |
| `entities/*.md` | `Entity` |
| `concepts/*.md` | `Concept` |
| `comparisons/*.md` | `Comparison` |
| `queries/*.md` | `Query` |

All concept documents carry:

```yaml
---
type: Concept
title: Human-readable title
description: A single-sentence orientation.
tags: [registered, taxonomy, values]
status: draft
generated:
  by: codex/gpt-5
  at: 2026-08-13T00:00:00Z
sources:
  - id: stable-source-id
    resource: ../raw/source-title.md
    title: Source title
---
```

`type` is the only field required by base OKF. The stricter profile requires
`title`, `description`, `tags`, `status`, `generated.by`, `generated.at`, and
at least one source for substantive compiled pages. Root operator references
may cite the OKF specification and repository sources instead.

Lifecycle values are only `draft`, `stable`, and `deprecated`. A genuine
disagreement is represented with extension metadata and symmetric concept
links, not a non-standard lifecycle status.

Specific externally sourced claims use Markdown footnotes whose labels match
`sources[].id`. Links between bundle concepts remain ordinary Markdown links.
Relative links are preferred in bodies for editor portability; all OKF
path-valued fields may also contain external URLs or bundle-relative paths.
A consumer accepts both explicit `path/to/concept.md` targets and OKF concept
IDs with the suffix omitted, such as `/path/to/concept`. Obsidian image embeds
resolve from the bundle root, while ordinary Markdown image paths resolve from
the containing document.

`generated` records authorship, not verification. `verified` is added only
after an actual process or human has checked content against its sources.
Machine validation uses a `process:` actor and never masquerades as human
review.

## Raw Paper Evidence

Raw paper companions are flat under `raw/`. Each has a matching PDF under
`raw/assets/` with the same basename:

```text
raw/neural-machine-translation-of-rare-words-with-subword-units.md
raw/assets/neural-machine-translation-of-rare-words-with-subword-units.pdf
```

### Filename normalization

The canonical arXiv title becomes the basename:

1. Unicode NFKD normalization.
2. Remove combining marks.
3. Lowercase.
4. Retain ASCII letters and digits.
5. Replace every other run with one hyphen.
6. Trim leading and trailing hyphens.
7. Add `.md` or `.pdf`.

ArXiv IDs and versions remain metadata, not ordinary filenames. A true
basename collision appends `-arxiv-<id>-v<version>` to the newcomer. Existing
snapshots are never renamed or overwritten.

### Companion contract

Each paper companion is an OKF `Paper` with:

- exact title and authors;
- exact versioned arXiv resource;
- abstract and submission/version metadata;
- accepted redistribution license and license URL;
- immutable arXiv ID and version;
- local PDF path, media type, byte size, and SHA-256;
- Markdown-body SHA-256;
- extraction tool and version;
- a local attachment link;
- an extraction-lossiness notice; and
- mechanically extracted full text.

The body contains no agent-authored summary or interpretation. Durable
interpretation belongs in compiled pages.

The ingester accepts only an exact `<id>v<version>`, verifies metadata and
license, downloads the exact PDF, extracts text, calculates hashes, and
publishes the pair atomically. Re-ingesting identical bytes is a no-op. Any
different bytes or newer version become a separate snapshot requiring review.

The initial corpus contains at least the following license-verified papers,
plus additional papers selected after inspecting Nanochat's pinned
implementation:

- Neural Machine Translation of Rare Words with Subword Units;
- The FineWeb Datasets;
- DataComp-LM;
- SmolLM2;
- GQA;
- FlashAttention-3;
- FP8 Formats for Deep Learning; and
- Direct Preference Optimization.

Only papers whose exact arXiv version permits repository redistribution are
archived. Other important work may appear as external further reading, but a
non-redistributable PDF is never committed.

PDFs and common binary image formats are tracked by extension-specific Git LFS
rules. Markdown indexes under `raw/assets/` remain normal Git files.

## Nanochat Project

`projects/code/nanochat/` is a Git submodule of:

```text
https://github.com/karpathy/nanochat.git
```

The gitlink is pinned to an exact reviewed commit. `projects/nanochat.md`
records the repository URL, default branch, commit, license, purpose, major
entry points, and related compiled pages.

`projects/code/index.md` records the gitlink as an indexed code resource and
links to useful upstream files. The validator checks agreement among:

- `.gitmodules`;
- the repository gitlink;
- the initialized submodule `HEAD`; and
- `projects/nanochat.md`.

The OKF validator treats the submodule as an opaque nested repository. It does
not require upstream Nanochat Markdown files to carry OKF frontmatter.

## Compiled Knowledge

The initial wiki contains substantial, source-grounded pages rather than
empty category scaffolds.

### Summaries

- `nanochat-end-to-end-training-pipeline.md`
- `research-corpus-overview.md`
- `from-pretraining-to-chat-model.md`

### Entities

- `fineweb.md`
- `datacomp-lm.md`
- `smollm2-and-smoltalk.md`
- `nanochat-model-family.md`

### Concepts

- `byte-pair-encoding.md`
- `bits-per-byte.md`
- `decoder-only-transformers.md`
- `rotary-position-embeddings.md`
- `rms-normalization.md`
- `grouped-query-attention.md`
- `flash-attention.md`
- `kv-caching.md`
- `low-precision-training.md`
- `pretraining-data-curation.md`
- `compute-optimal-training.md`
- `gradient-accumulation-and-distributed-training.md`
- `adamw-and-muon-optimization.md`
- `supervised-fine-tuning.md`
- `chat-formatting.md`
- `preference-and-policy-optimization.md`
- `inference-and-sampling.md`
- `language-model-evaluation.md`

### Comparisons

- `fineweb-vs-datacomp-lm.md`
- `multi-head-vs-multi-query-vs-grouped-query-attention.md`
- `bf16-vs-fp8.md`
- `adamw-vs-muon.md`
- `dpo-vs-on-policy-reinforcement-learning.md`

### Queries

- `how-does-nanochat-turn-text-into-a-chat-model.md`
- `where-do-the-paper-ideas-appear-in-nanochat.md`
- `why-does-nanochat-use-bits-per-byte.md`
- `what-dominates-a-nanochat-training-run.md`
- `how-can-a-reader-reproduce-the-pipeline.md`

Inventory may grow when the pinned source reveals a central concept that the
listed pages cannot accurately cover. It must not shrink below a coherent
end-to-end explanation.

Each substantive page:

- answers one durable question;
- cites raw papers and/or exact Nanochat files;
- contains nearby claim-level attribution;
- links to at least two related compiled pages where editorially meaningful;
- distinguishes source facts from synthesis;
- avoids duplicating raw full text; and
- is concise enough to load independently.

## Knowledge Flow

The primary paper-backed path is:

```text
index.md
  -> summaries/index.md
  -> nanochat-end-to-end-training-pipeline.md
  -> concepts/<focused-concept>.md
  -> raw/<paper>.md
  -> raw/assets/<paper>.pdf
```

The primary code-backed path is:

```text
index.md
  -> projects/index.md
  -> nanochat.md
  -> projects/code/index.md
  -> projects/code/nanochat/<exact-file>
```

Queries provide task-oriented entry points, while summaries provide narrative
entry points. Indexes expose only the next level; cross-links form the richer
graph.

## Operator Workflows

`demo-vault/AGENTS.md` is both an OKF `Playbook` and the canonical operator
handbook. It documents executable, repository-relative workflows for:

- orientation;
- versioned arXiv ingestion;
- local-file and web-clip capture;
- compiling or updating concepts;
- answering and optionally filing queries;
- conflict handling;
- rebuilding indexes;
- full lint and integrity validation;
- Nanochat submodule initialization and advancement;
- Git LFS checks; and
- reproducing VS Code and Cursor reading acceptance.

Commands invoke scripts outside the bundle, for example:

```bash
python3 ../tools/demo-vault/ingest_arxiv.py \
  --vault . \
  --id 1508.07909v5

python3 ../tools/demo-vault/rebuild_indexes.py --vault . --check
python3 ../tools/demo-vault/validate_vault.py --vault .
python3 -m unittest discover -s ../tools/demo-vault/tests
```

The handbook requires reading `SCHEMA.md`, `index.md`, and the newest entries
in `log.md` before mutation. Raw snapshots are never hand-edited.

`log.md` is a newest-first, ISO-date-grouped bundle history. It records
material ingest, compilation, migration, project-pin, and deprecation events.

## Reusable Skill and Tooling

`.agents/skills/llm-wiki/SKILL.md` packages setup and maintenance for another
repository. It:

- discovers whether a vault is new or existing;
- preserves existing content unless replacement is explicit;
- establishes an OKF root and hierarchical indexes;
- configures LFS patterns without capturing Markdown;
- installs or points to deterministic producer tools;
- distinguishes immutable evidence from compiled knowledge;
- orients before mutation;
- enforces source-backed writing and conflict escalation; and
- finishes by rebuilding, validating, and reporting evidence.

The scripts have focused responsibilities:

- `vaultlib.py`: shared parsing, paths, hashing, title normalization, link
  resolution, and typed data structures;
- `ingest_arxiv.py`: exact-version, license-gated, atomic paper capture;
- `rebuild_indexes.py`: bottom-up deterministic indexes for every owned
  directory;
- `validate_vault.py`: base OKF conformance plus the stricter profile; and
- `tests/`: behavior-level unit and integration tests using local fixtures.

## Validation

Validation proves:

- every non-reserved Markdown file is a valid OKF concept;
- root and nested reserved files follow their contracts;
- every owned bundle directory has a current index;
- every index entry resolves and every immediate visible child is indexed;
- paper filenames derive from canonical titles;
- paper metadata, body hashes, attachments, and PDF hashes agree;
- accepted license metadata exists;
- compiled sources resolve or are valid external URLs;
- footnote/source IDs agree;
- internal Markdown links resolve, except explicitly allowed future links;
- lifecycle, actor, timestamp, and tag fields follow the profile;
- conflict metadata is symmetric;
- `.gitattributes` sends binary assets, not Markdown, to LFS;
- no forbidden caches or databases are committed;
- Nanochat project metadata and gitlink agree; and
- generated indexes are reproducible with no diff.

Base OKF compatibility remains permissive: unknown types and extension keys
are preserved rather than rejected. Profile validation is explicitly labeled
as stricter than generic OKF consumption.

## Extension Acceptance

Automated extension coverage uses the real `demo-vault/` as a reading fixture
or a copied sandbox of it. Tests prove:

- root and nested index pages render;
- relative Markdown links navigate correctly;
- `child/`, `/bundle-relative`, and extensionless concept-ID targets navigate
  to the intended Markdown document;
- Obsidian-compatible image embeds resolve and render real bundle images;
- headings and outline remain usable on long raw companions;
- backlinks connect compiled and evidence pages;
- search finds canonical paper titles and core concepts;
- a concept can open its raw companion and local PDF;
- a code-backed concept can open the project card and a file in the submodule;
- local PDFs render and supported internal PDF links navigate; and
- runtime state is created only in ignored locations.

Final manual acceptance opens the same bundle in:

1. a VS Code Extension Development Host; and
2. Cursor with the built extension installed or loaded.

The documented reading paths are exercised with screenshots and concise
notes. If acceptance exposes a concrete extension defect that blocks or
roughens these paths, the defect is reproduced by a failing test and fixed in
scope.

## Completion Evidence

The implementation is complete only when:

1. all producer-tool tests pass;
2. profile validation passes;
3. index regeneration in check mode passes;
4. the planned raw Markdown/PDF pairs exist and hashes match;
5. Git LFS identifies every archived binary and no Markdown index;
6. the Nanochat gitlink resolves to the project card's exact commit;
7. all substantive compiled pages exist, are grounded, and are cross-linked;
8. extension unit, build, and focused end-to-end checks pass;
9. the bundle is read successfully in both VS Code and Cursor; and
10. screenshots and acceptance notes demonstrate both evidence paths.

## Non-goals

- No iWiki integration.
- No mandatory database, vector store, embeddings, or hosted service.
- No Nanochat fork or copied source snapshot.
- No automatic path migration based on directory size.
- No mirroring of papers without redistribution permission.
- No unsupported claim of human verification.
- No broad extension redesign unrelated to the demonstrated reading paths.
