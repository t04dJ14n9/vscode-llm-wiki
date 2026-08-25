---
type: "Playbook"
title: "LLM Wiki operator handbook"
description: "Normative AGENTS-only workflow for the graph-ready demo vault."
status: "stable"
scope: "vault"
vault_timezone: "Asia/Shanghai"
content_language: "en"
response_language_policy: "match-user"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-25T00:57:53+08:00"}
---

# LLM Wiki operator handbook

This file is the complete normative workflow. No LLM Wiki skill is required.

Use installed focused skills when their trigger applies: `arxiv` for
version-pinned paper discovery, `grounded-citations` for claim-level evidence,
`research-paper-writing` for academic manuscripts, `pdf` for exact PDF regions,
and `humanizer` for requested prose polish. The vault workflow in this file
remains authoritative for placement, metadata, validation, and logging.

`.agents/skills/` contains the complete canonical packages. Generated physical
wrappers under `.claude/skills/`, `.cursor/skills/`, and `.codex/skills/` make
them available immediately without plugins or symlinks; Cursor also receives
physical commands and an always-applied rule. Regenerate only those wrappers
with `.agents/render_agent_adapters.py`.

## Start every study or maintenance session

1. Read `SCHEMA.md`, `TAGS.md`, `_index.md`, `tasks/current.md`, and the newest `_log.md` entry.
2. Use the `Asia/Shanghai` calendar date. Create or refresh `wiki/daily/YYYY-MM-DD.md` from `templates/daily.md.tmpl` if this is the first session that day.
3. Preserve every human-owned Goals, review-answer, and Notes marker verbatim.
4. Search titles, tags, bodies, and Query selection IDs before writing.

## Language and voice

Write durable prose in the vault's `content_language`, which is English in
this demo. Keep established technical terms in their conventional form rather
than translating them mechanically. When speaking with a user, answer in the
language used in the request unless the user asks for another language; this
conversation rule does not silently change the vault's content language.

Use the `humanizer` skill for reader-facing synthesis. Prefer a concrete
subject, a direct verb, and a thesis in the opening paragraph. Preserve facts,
citations, source IDs, relations, selection identities, quotations, and
human-owned review markers exactly. Do not humanize immutable evidence,
generated navigation, logs, or code.

Daily generation is lazy and filesystem-only: no scheduler or extension command is required. Pull linked `**Learned**` entries from today's log into the cohort. Review older cohorts at +1, +3, +7, +14, +30, +60, and +90 days. Repeat Query titles with blank human answer blocks; use “I can explain…” checkboxes for Concepts, Comparisons, and Entities. Include at most ten unresolved reviews, oldest first and Queries first. Incomplete reviews roll forward; outcomes do not alter the fixed schedule.

## Place knowledge

- `wiki/summaries`, `wiki/concepts`, `wiki/comparisons`, `wiki/entities`, and `wiki/queries` contain durable graph-ready knowledge.
- `wiki/daily` contains daily goals and review cohorts.
- `playbooks` remains outside the graph as operational guidance.
- `raw` is flat immutable textual evidence; `assets` is flat binary evidence through Git LFS.
- `inbox`, `tasks`, and `scratch` are non-durable workbench state.
- `tasks` contains one Markdown file per actionable outcome. Checklists may
  describe steps toward that outcome, but status reports, audit output, and
  manifests belong in `output` once complete.
- `templates` is opaque. Copy the closest `.md.tmpl` and replace every required placeholder.

Capture every admitted textual source as a Markdown snapshot under `raw/`
before synthesis. Preserve native text verbatim; conservatively transcribe
HTML, PDF, meeting, and document exports without summarizing, translating,
correcting, reordering, or hiding gaps. Record source identity, retrieval time,
revision, capture method, body hash, and omissions. Keep available original
non-Markdown bytes under `assets/` when needed for audit, and create a new
snapshot for a new upstream revision.

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

## Curate source corpora

Before copying a legacy export or other large evidence set, follow
`playbooks/source-corpus-curation.md`. Audit for secrets and malformed records,
deduplicate by canonical source identity or exact hash, route implementation
evidence to its owning repository, and freeze one disposition per source.
Move the completed manifest and report to `output`; they are process evidence,
not tasks or graph nodes.

## Ingest a corpus

For a material batch of sources, use
`playbooks/bulk-corpus-ingestion.md` and
`templates/bulk-ingestion-manifest.json.tmpl`. The workflow separates
evidence extraction, canonicalization, and prose authoring: candidate structure
is reviewed and frozen before pages are written. Candidate manifests belong in
the workbench and never become graph-visible knowledge or a second source of
truth after publication.

## Operate and maintain the vault

Follow `playbooks/vault-operations.md` for normal capture, synthesis,
daily-note creation, page updates, renames, merges, supersession, and task
closure. Structural changes are atomic graph edits: search incoming and
outgoing `relations`, sources, daily references, and body links; repair them in
the same change; rebuild navigation; then record the material event.

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
Nanochat is reference-only in this demo.

## Register child vaults

Use one portable `vaults/<vault-id>.md` card for each independently maintained
knowledge vault. A card records Git identity, tracked ref, observed revision,
profile, entrypoint, search roots, and active/reference status. Its optional
local binding is derived as ignored `vaults/bindings/<vault-id>`; never store a
machine-local path or use a Git submodule. Treat child content as opaque, obey
the child's own instructions when editing it, and use pinned URLs rather than
cross-vault `relations` for attribution.

## File Queries

File a Query only when the answer is substantial, grounded, durable, novel, scoped, complete about limits, and safe. Use `templates/query.md.tmpl`; preserve synthesis rather than transcripts. Every Query needs `condensed_summary`, `conversation.selection_id`, unique sources, exact source-ID-bound anchors, answer, evidence, limitations, related pages, and relations. Reuse exact exported Markdown/PDF source URIs.

Valid exported `open_uri` values begin with
`cursor://llm-wiki.llm-wiki-vscode/open-anchor` or
`vscode://llm-wiki.llm-wiki-vscode/open-anchor`. Never manufacture an
`.llm_wiki_anchor`/`chat_uri` payload; persisted pages use relative Markdown
links or wikilinks.

## Finish

Rebuild indexes, validate placement/relations/daily notes/provenance/bindings,
inspect LFS, run `git diff --check`, and refresh Query annotations. Material
corpus ingests also complete every semantic gate in the bulk-ingestion playbook
and retain their report in `output`. Record each
material event with `tools/llm-wiki/append_log.py`; `_log.md` is oldest-first
and append-only, so never insert, reorder, condense, or rewrite an earlier
event. Use `learned`, `changed`, or `maintained` as the event kind. Never commit,
push, sync a code binding, or write externally without explicit authority.
