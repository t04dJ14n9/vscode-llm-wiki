# LLM Wiki for VS Code agent instructions

These instructions govern the extension, reusable vault tools, and demo vault.
Preserve user changes and keep implementation work off `main` unless explicitly
requested otherwise.

## Product boundaries

- Product name: **LLM Wiki for VS Code**. Preserve package
  `llm-wiki-vscode`, publisher, `llm-wiki.*` identifiers, `.llm_wiki`
  storage, view types, and versioned source URI payloads.
- The extension exports immutable Markdown/PDF selections and indexes local
  Query pages. It never submits, monitors, or scrapes agent conversations.
- Do not restore the removed PDF discussion backend, add a database or required
  embeddings, integrate `llm-wiki-compiler`, or implement the deferred graph UI.
- Vault behavior is specified by the nearest `AGENTS.md`; there is no general
  LLM Wiki skill. Retain the focused PDF selection, humanizer, arXiv,
  grounded-citations, and research-paper-writing skills and their installer.

## Canonical vault workflow

Before study or maintenance, read the nearest `AGENTS.md`, `SCHEMA.md`, `TAGS.md`, root
`_index.md`, `tasks/current.md`, and newest `_log.md` entry, then search before
writing. Canonical navigation and history filenames are `_index.md` and
`_log.md` only.

A knowledge vault stores graph-visible durable pages under
`wiki/{summaries,concepts,comparisons,entities,queries,daily}`. Playbooks remain
outside `wiki/`. Raw textual evidence is flat under `raw/`; binary
evidence is flat under optional `assets/` and uses Git LFS. Workbench material
belongs in `inbox/`, `tasks/`, or `scratch/`. `templates/`, `projects/code/`,
assets, hidden runtime directories, and skill packages are opaque to indexing
and validation.

`starter-vault/` is the canonical knowledge-empty vault source. Keep
`packages/vscode-extension/resources/llm-wiki-empty-vault.zip` byte-for-byte
current with `tools/llm-wiki/build_starter_bundle.py`; the unpacked archive
must pass the same index and vault validation as the source.

Operational prompts and skills, assets, and `.md.tmpl` templates are outside
the OKF concept-document set and follow their native formats.

Use the nearest `templates/*.md.tmpl` and replace every required
`{{placeholder}}`. Every graph-visible page except generated `_index.md` has a
JSON-flow `relations` array. Targets are existing contained `.md` paths
relative to that wiki root. Direction is current page to target; body links do
not create edges. Allowed kinds are `references`, `depends-on`, `supported-by`,
`contrasts-with`, `extends`, `supersedes`, `applies-to`, and `example-of`.
Captions are required, direct, and at most 160 Unicode code points. No self or
duplicate target/kind edge is allowed.
Durable templates include complete sample `sources` and `relations` items;
replace them with real JSON-flow entries or `[]`, and never publish unresolved
placeholders.

Admit a new Concept, Comparison, Entity, or Summary only after searching for an
existing durable page and establishing that the candidate is distinct and
reusable. Normal admission evidence is recurrence across at least two
independent sources, reuse by at least two durable pages, a substantial primary
source treatment, or an explicit user-defined durable scope. Otherwise keep the
material in its source Summary or the workbench. Treat these signals as a
curation rubric rather than a mechanical count; record the basis for any
single-source exception in the working task or ingestion manifest.

For a material multi-source ingest, follow the nearest vault's
`playbooks/bulk-corpus-ingestion.md`.
Extract evidence-bound candidates before drafting prose, canonicalize aliases
and page targets in one review step, freeze a workbench manifest, then create or
extend pages against that manifest. Finish with deterministic validation plus
answerability, out-of-scope refusal, recall-coverage, citation-integrity, and
duplicate-content checks. Semantic checks may use agents or optional local
models, but they must not become a required embeddings or database runtime.

Each vault owns one `TAGS.md` registry. Use its canonical tag headings. Unknown
tags are advisory warnings, not base OKF failures. `verified` may record
independent machine and `human:<id>` review
events; never add either without checking the current content against evidence.
Substantive content pages require tags. Root operational/navigation documents
(`AGENTS.md`, `README.md`, `SCHEMA.md`, `TAGS.md`, `_index.md`, `_log.md`),
and operational templates are tagless. Skills follow their own native metadata
schema and may declare tags when useful; skill tags are outside the vault tag
registry, indexing, validation, and graph.

## Daily active recall

Vault time is `Asia/Shanghai`. On the first study or maintenance session on
local date `D`, lazily create or refresh `wiki/daily/D.md` from the daily
template. Do not create empty notes on inactive days and do not add a log entry
for routine daily-note creation.

Preserve every human-owned Goals, review-answer, and Notes marker verbatim.
Only linked `**Learned**` log bullets enter a cohort. Repeat an exact Query title
as an active-recall question with a blank human answer, an attempted-before-
source checkbox, and at most one selected Again/Hard/Good/Easy outcome. Use an
“I can explain…” checkbox for learned Concepts, Comparisons, and Entities.
Schedule fixed occurrences at +1/+3/+7/+14/+30/+60/+90 days; outcomes never
change the schedule. Roll incomplete reviews forward without erasing completed
occurrences. Show at most ten unresolved prompts ordered by oldest due date,
then Query, Concept, Comparison, Entity, and statement fallback.

## Repository cards and code-owned knowledge

`projects/<id>.md` is the sole portable project record. It stores VCS identity,
tracked ref, observed revision/time, status, and ongoing change, but no local
path, YAML registry, submodule, or paired outer-vault project directory. Its ID
implies ignored binding `projects/code/<id>`, which may be a checkout or an
exact symlink. When registering a repository, ask the user for its existing
local working-copy location or whether it is unavailable. Keep an in-place copy
already at the canonical binding; otherwise verify the supplied directory's VCS
identity and create an absolute symlink at `projects/code/<id>`. Never overwrite
an existing binding, discover candidates elsewhere, store the local path in the
card, or create a separate `workspace/` namespace. Validate only that binding
and its Git remote, P4 mapping, or SVN URL. Never automatically clone, sync,
switch, reset, or bulk-update it.

Repository-specific implementation knowledge and Queries live with writable
code under `docs/llm-wiki/` so they follow repository branches and commits.
Stable code claims bind to VCS identity, immutable revision, path, and verified
content hash. Dirty or unavailable evidence remains draft. Higher-level papers,
reusable mechanisms, and cross-repository synthesis stay in the outer vault.

## Viewer conversations and Queries

Canonical Query discovery is `wiki/queries/*.md` for a knowledge vault and
`docs/llm-wiki/queries/*.md` for a directly opened code repository. For one
release, read but do not write legacy `queries/*.md`,
`projects/*/queries/*.md`, and `wiki/learning/*.md`.

File a Query only when the answer is substantial, selection-grounded,
evidence-supported, durable or expensive to reconstruct, novel, clearly
scoped, complete about limitations, and safe. Borderline cases require
confirmation; trivial lookups are read-only. Persist synthesis, not transcripts.
Queries require a direct answer, evidence, limitations, related pages, a
one-or-two-sentence `condensed_summary` of at most 360 Unicode code points,
immutable `conversation.selection_id`, sources, exact source-ID-bound anchors,
and relations.

Markdown anchors use hash, quote, context, offsets, and lines. PDF anchors use
PDF hash, page, and exact point rectangles; suppress geometry after a hash
mismatch. Reuse the exact exported `open_uri`; never manufacture its payload or
expose `.llm_wiki_anchor`/`chat_uri` as a user-facing link. Persisted vault pages
use relative Markdown links or wikilinks.

Valid generated host links begin with either:

```text
cursor://llm-wiki.llm-wiki-vscode/open-anchor?target=v1.<generated-payload>
vscode://llm-wiki.llm-wiki-vscode/open-anchor?target=v1.<generated-payload>
```

## Completion

For material demo-vault changes run:

```bash
python3 tools/llm-wiki/rebuild_indexes.py --vault demo-vault
python3 tools/llm-wiki/rebuild_indexes.py --vault demo-vault --check
python3 tools/llm-wiki/validate_vault.py --vault demo-vault
python3 tools/llm-wiki/build_starter_bundle.py --check
git lfs ls-files
git diff --check
git status --short
```

For extension behavior also run focused tests, lint, typecheck, build, and the
appropriate browser/VS Code E2E path. Append material vault events with
`tools/llm-wiki/append_log.py`; never rewrite earlier log bytes. Never claim human verification
from automated checks. Never commit, push, publish, sync code, or write back
externally without authority. Never expose secrets or private identifiers.
