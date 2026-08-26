---
type: "Playbook"
title: "Vault agent handbook"
description: "Normative workflow for maintaining this graph-ready LLM Wiki vault."
status: "stable"
scope: "vault"
vault_timezone: "Asia/Shanghai"
vault_prose_language: "en"
response_language: "match-request"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-25T00:57:53+08:00"}
---

# Vault agent handbook

This file is the complete normative workflow. No LLM Wiki skill is required.

Use focused skills when available and their trigger applies:
`grounded-citations` for claim-level evidence,
`research-paper-writing` for academic manuscripts, `pdf` for exact PDF regions,
and `humanizer` for requested prose polish. The vault workflow in this file
remains authoritative for placement, metadata, validation, and logging.

## Start every study or maintenance session

1. Read `SCHEMA.md`, `TAGS.md`, `_index.md`, `tasks/current.md`, and the newest `_log.md` entry when one exists.
2. Use the `Asia/Shanghai` calendar date. Create or refresh `wiki/daily/YYYY-MM-DD.md` from `templates/daily.md.tmpl` if this is the first session that day.
3. Preserve every human-owned Goals, review-answer, and Notes marker verbatim.
4. Search titles, tags, bodies, and Query selection IDs before writing.

Daily generation is lazy and filesystem-only: no scheduler or extension command is required. Pull linked `**Learned**` entries from today's log into the cohort. Review older cohorts at +1, +3, +7, +14, +30, +60, and +90 days. Repeat Query titles with blank human answer blocks; use “I can explain…” checkboxes for Concepts, Comparisons, and Entities. Include at most ten unresolved reviews, oldest first and Queries first. Incomplete reviews roll forward; outcomes do not alter the fixed schedule.

## Outline navigation

Generated `_index.md` files must remain navigable in VS Code Outline. Content
domains and semantic subtopics are headings; document forms such as `Paper`
and numeric ranges are not topics. Linked documents are compact list leaves
with meaningful one-line descriptions. `_log.md` uses year, month, and day
headings, with individual events as parseable list leaves. Rebuild both formats
with the canonical tools. Validation warns, without blocking, when a section
exceeds 20 direct leaves and should gain a meaningful child topic.

## Place knowledge

- `wiki/summaries`, `wiki/concepts`, `wiki/comparisons`, `wiki/entities`, and `wiki/queries` contain durable graph-ready knowledge.
- `wiki/daily` contains daily goals and review cohorts.
- `playbooks` remains outside the graph as operational guidance.
- `raw` is flat immutable textual evidence; `assets` is flat binary evidence through Git LFS.
- `inbox`, `tasks`, and `scratch` are non-durable workbench state.
- `templates` is opaque. Copy the closest `.md.tmpl` and replace every required placeholder. Reader-facing headings and order are reference-only; rename, merge, reorder, or omit them without weakening metadata, provenance, citations, or relations.

Capture an admitted textual source as a Markdown snapshot in `raw/` before
using it for synthesis. Preserve native Markdown and plain text verbatim. For
HTML, PDF, meeting, or document exports, preserve visible wording, order,
headings, lists, tables, code, and speaker labels as closely as the format
allows. Do not summarize, translate, silently correct, or invent missing text.
Record provenance, retrieval time, revision, capture method, body hash, and any
omission; retain an available non-Markdown original in `assets/` when needed
for audit. New upstream content gets a new immutable snapshot.

Use the Python `pdfplumber` library as the default path for extracting text
from PDFs. Extract page by page, preserve page boundaries and reading order,
and treat the original PDF as authoritative for layout, figures, tables, and
mathematical notation. Record extraction failures and every fallback in
`snapshot.omissions`; never silently repair columns, equations, or OCR output.

Durable-page templates show one complete JSON-flow `sources` item and one
`relations` item. Replace each sample with real entries, or replace the entire
array with `[]` when the field is genuinely empty. Never publish template
placeholders. Source IDs are stable footnote join keys; relation targets are
relative to `wiki/`, use an allowed kind, and carry a direct caption.

`TAGS.md` is the vault-local canonical tag registry. Reuse its headings; add a
direct description before establishing a new stable category. Unknown tags are
advisory validation warnings rather than OKF conformance failures.

Require canonical tags on substantive content pages. Do not tag root
operational or navigation documents (`AGENTS.md`, `README.md`, `SCHEMA.md`,
`TAGS.md`, `_index.md`, `_log.md`) or operational templates. Skills follow their
own native metadata schema and may declare tags when useful; their tags are not
validated against the vault registry or included in the knowledge graph.

Use OKF actor identities accurately. Agent-authored changes use
`<producer>/<version>` such as `codex/gpt-5.6`; human-authored or
human-confirmed events use `human:<id>`; `process:<id>` is reserved for a
named automated process such as a deterministic importer or index builder.
Never use a workflow label as a substitute for the agent that authored prose.

Record `verified` only after checking the current page against its sources or
resource. Agent, tool, and `process:<id>` events are machine confirmation;
`human:<id>` records an explicit human review. Preserve independent events from
both, but do not carry a verification event across a meaningful rewrite it did
not review.

Operational prompts, installed skills, binary assets, and `.md.tmpl` files are
outside the OKF concept-document set and may follow their native formats. Do
not treat them as knowledge pages or require OKF `type` metadata from them.

Every graph-visible page has `relations: []` or explicit relations. A relation target is relative to `wiki/`, contained, existing, non-self, and unique by target/kind. Allowed kinds are `references`, `depends-on`, `supported-by`, `contrasts-with`, `extends`, `supersedes`, `applies-to`, and `example-of`; captions are direct and at most 160 code points. Body links do not create graph edges.

## Admit durable pages

Search existing titles, tags, bodies, and relations before creating a Concept,
Comparison, Entity, or Summary. A new page normally needs at least one of these
admission signals:

- the idea recurs across two or more independent sources;
- two or more durable pages need to reuse it as a relation target;
- one primary source gives it a substantial treatment that would be expensive
  to reconstruct; or
- the user explicitly defines it as part of the vault's durable scope.

These signals are a curation rubric, not a mechanical quota. A single-source
page is valid when its durable value and limitations are explicit. Otherwise,
keep the material in its source Summary or in `inbox`, `tasks`, or `scratch`
until it clears the bar. Record the admission basis in the active task or bulk
ingestion manifest; do not add new graph nodes merely to eliminate an orphan or
increase link density.

## Ingest a corpus

For a material batch of sources, use
`playbooks/bulk-corpus-ingestion.md` and
`templates/bulk-ingestion-manifest.json.tmpl`. The workflow separates
evidence extraction, canonicalization, and prose authoring: candidate structure
is reviewed and frozen before pages are written. Candidate manifests belong in
the workbench and never become graph-visible knowledge or a second source of
truth after publication.

## Operate and maintain the vault

Follow `playbooks/vault-operations.md` for the normal evidence-first loop,
daily-note creation, page updates, renames, merges, supersession, and task
closure. Before changing a path or page identity, search both `relations`
targets and ordinary Markdown links. Update every affected source path,
incoming edge, outgoing edge, daily reference, and body link in the same
change; rebuild navigation before recording the result. Do not defer broken
cross-references to a cleanup task.

After deterministic validation, test whether representative in-scope questions
are answerable with citations, out-of-scope questions are declined, important
source ideas are covered or deliberately rejected, cited evidence still
supports the claims, and near-duplicate pages were not introduced. These checks
may use agents or optional local models, but the vault must not require an
embeddings service, database, or compiler at runtime.

## Register code projects

Use one portable `projects/<id>.md` card. Its ID implies the only canonical
local binding: ignored `projects/code/<id>`. When adding a project, ask the user
for its existing local working-copy location or let them explicitly say it is
unavailable. If the resolved location is already the canonical binding, keep it
in place. Otherwise, verify that the supplied directory is the expected Git,
P4, or SVN working copy, then create an absolute symlink at the canonical
binding. Never overwrite an existing path or symlink; stop and report a broken
or mismatched binding. A reference-only card may have no local binding.

Store no local path, workspace alias, YAML registry, submodule, or paired
project vault in Git. Do not create a separate `workspace/` binding directory,
search the filesystem for candidates, clone, or sync automatically.
Repository-specific knowledge belongs in the repository's `docs/llm-wiki/`.
Do not add sample or reference projects unless the user asks for them.

## File Queries

File a Query only when the answer is substantial, grounded, durable, novel, scoped, complete about limits, and safe. Use `templates/query.md.tmpl` as a composition reference; preserve synthesis rather than transcripts. Every Query needs `condensed_summary`, `conversation.selection_id`, unique sources, exact source-ID-bound anchors, answer, evidence, limitations, related-page context, and relations, but no fixed body headings or order. Reuse exact exported Markdown/PDF source URIs.

Valid exported `open_uri` values begin with
`cursor://llm-wiki.llm-wiki-vscode/open-anchor` or
`vscode://llm-wiki.llm-wiki-vscode/open-anchor`. Never manufacture an
`.llm_wiki_anchor`/`chat_uri` payload; persisted pages use relative Markdown
links or wikilinks.

## Finish

From the vault root, run `python3 tools/llm-wiki/vault.py rebuild --check` and
`python3 tools/llm-wiki/vault.py validate`. Validation includes
repository-pinned markdownlint. Errors block completion; warnings are advisory
and may be deferred when the reason is disclosed. Do not add agent Stop hooks.
Rebuild indexes, validate placement/relations/daily notes/provenance/bindings,
inspect LFS when Git is initialized, run `git diff --check`, and refresh Query
annotations. Material corpus ingests also complete every semantic gate in the
bulk-ingestion playbook and retain their report in `tasks` or `output`. Append
material events to `_log.md`, then run `vault.py rebuild`; the log is oldest-first and
append-only, so never insert, reorder, condense, or rewrite an earlier event.
Use `learned`, `changed`, or `maintained` as the event kind and follow the log
template exactly. Never commit, push, sync a code binding, or write externally
without explicit authority.

## Vault-specific language and prose

`vault_prose_language` sets the default language for new reader-facing vault
prose. Change it when naming the vault. Preserve source quotes, identifiers,
commands, paths, schema keys, and established technical terms when translation
would reduce precision. `response_language: "match-request"` means answer in
the language used by the user's current request unless the user explicitly
chooses another language.

Use `humanizer` when the user asks for prose polish or a reader-facing batch
rewrite. Keep concrete subjects and direct verbs, and remove migration
boilerplate that belongs in this handbook. Never humanize `raw/`, quotations,
generated indexes, `_log.md`, or human-owned markers.

## Task and artifact hygiene

Each `tasks/*.md` file owns one actionable goal. A checklist may break that
goal into steps, but one page must not combine unrelated work. Keep idea pools
in `inbox/`, intermediate manifests and machine output in `scratch/`, and
durable migration, audit, or evaluation reports in `output/`. A task may link
to those artifacts; it does not absorb them.

For legacy raw material, wiki exports, meeting archives, and other large
evidence collections, use `playbooks/source-corpus-curation.md` before bulk
knowledge ingestion. Apply its security hard gate and freeze exactly one
disposition per source before writing any destination.

## Federated knowledge vaults

Use one portable `vaults/<id>.md` card with `type: "Knowledge Vault"`. Its ID
implies ignored binding `vaults/bindings/<id>`. Ask for the existing local
vault location, verify its identity, and create an absolute symlink unless it
already occupies the canonical binding. Never store a local path, use a Git
submodule, scan for candidate vaults, clone, sync, or overwrite a binding.

Search only roots declared by active cards. Before using a result, read the
child vault's `AGENTS.md`, entrypoint, and observation metadata. Search access
does not grant write ownership: update the vault that owns the subject. Body
links may cross vaults, but graph `relations` never leave the current `wiki/`
root.

## Direct skill discovery

`.agents/skills/<skill>` is the only complete skill package. This initialized
vault also carries physical wrappers for Claude Code, Cursor, and
Codex, plus Cursor commands and its always-applied rule, so every supported
agent can use the skills without a plugin or symlink. Adapter rendering belongs
to the upstream initializer and is not a vault command. Tokens,
cookies, MCP configuration, CLI state, and other credentials stay in the local
environment or secret manager and never enter the vault.
