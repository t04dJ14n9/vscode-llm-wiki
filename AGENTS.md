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
  LLM Wiki skill. Retain the focused PDF selection skill and installer.

## Canonical vault workflow

Before study or maintenance, read the nearest `AGENTS.md`, `SCHEMA.md`, root
`_index.md`, `tasks/current.md`, and newest `_log.md` entry, then search before
writing. Canonical navigation and history filenames are `_index.md` and
`_log.md` only.

A knowledge vault stores graph-visible durable pages under
`wiki/{concepts,comparisons,entities,queries,daily}`. Summaries and playbooks
remain outside `wiki/`. Raw textual evidence is flat under `raw/`; binary
evidence is flat under optional `assets/` and uses Git LFS. Workbench material
belongs in `inbox/`, `tasks/`, or `scratch/`. `templates/`, `projects/code/`,
assets, hidden runtime directories, and skill packages are opaque to indexing
and validation.

Use the nearest `templates/*.md.tmpl` and replace every required
`{{placeholder}}`. Every graph-visible page except generated `_index.md` has a
JSON-flow `relations` array. Targets are existing contained `.md` paths
relative to that wiki root. Direction is current page to target; body links do
not create edges. Allowed kinds are `references`, `depends-on`, `supported-by`,
`contrasts-with`, `extends`, `supersedes`, `applies-to`, and `example-of`.
Captions are required, direct, and at most 160 Unicode code points. No self or
duplicate target/kind edge is allowed.

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
exact symlink. Validate only that binding and its Git remote, P4 mapping, or SVN
URL. Never automatically clone, sync, switch, reset, or bulk-update it.

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
git lfs ls-files
git diff --check
git status --short
```

For extension behavior also run focused tests, lint, typecheck, build, and the
appropriate browser/VS Code E2E path. Log material vault changes newest-first as
`**Learned**`, `**Changed**`, or `**Maintained**`. Never claim human verification
from automated checks. Never commit, push, publish, sync code, or write back
externally without authority. Never expose secrets or private identifiers.
