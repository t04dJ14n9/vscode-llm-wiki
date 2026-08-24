# LLM Wiki for VS Code agent instructions

These instructions apply to the extension, producer tools, and demo vault.
Preserve user changes and keep implementation work off `main` unless the user
explicitly requests otherwise.

## Product boundaries

- Product name: **LLM Wiki for VS Code**.
- Preserve package `llm-wiki-vscode`, publisher, `llm-wiki.*` command IDs,
  view types, `.llm_wiki` storage, and versioned source URI payloads.
- The extension exports immutable selection artifacts and indexes local Query
  pages. It never submits or scrapes an external conversation.
- Do not restore the removed PDF discussion/Ask PDF backend.
- Do not add a database, mandatory embeddings, `llm-wiki-compiler`, or a
  `revisions/` collection.

## Vault orientation

Before ingest, query, code study, promotion, or maintenance:

1. Read the applicable vault `SCHEMA.md` and `AGENTS.md`.
2. Read root `_index.md`, the flat `projects/<id>.md` repository card, the
   paired project-vault index, and `tasks/current.md`.
3. Read the newest `_log.md` entry.
4. Search indexes and full text using terms, aliases, abbreviations, and
   language variants. Do not claim coverage is absent until both are empty.

Canonical OKF navigation uses `_index.md` only. The outer catalog and each
registered code vault carry `okf_version: "0.2"` on their own root `_index.md`;
generated indexes below either root are frontmatter-free. `_log.md` is the only
log filename. Both are regular files; unprefixed variants and aliases are
forbidden.

## Project placement

A code-vault claim describes one repository's implementation, configuration,
protocol, build/run behavior, code history, or generated repository
documentation. Keep it under `projects/<id>/`. Put higher-level learning,
papers, reusable mechanisms, datasets, comparisons, and synthesis in the outer
vault with explicit `scope: vault` or `scope: cross-project`.
Compiled code-vault pages declare `code_scope: true`.

Resolve code working copies only through `projects/repositories.yaml`. Each
card `projects/<id>.md` is paired with a self-contained `projects/<id>/` vault,
while its ignored checkout lives at `projects/code/<id>/` and is synchronized
in place by Git, P4, or SVN.
Never automatically clone, sync, switch, reset, or bulk-update working copies.
Never create `.gitmodules` or a submodule gitlink for project code.
Prefer immutable revision reads for
evidence. Stable claims require repository, revision, path, and verified hash;
dirty or unavailable evidence remains draft. A newer checkout creates
currentness debt without falsifying a matching historical claim.

Repository documentation is code-vault material. A committed document supports
what it says at its exact revision. DeepWiki and other generated repository
documentation enter `projects/<id>/summaries/` as unverified generated summaries;
claims about code behavior also need primary code, tests, configuration, or
protocol evidence.

## Authority boundaries

- outer `raw/`: append immutable higher-level textual evidence such as papers.
- outer `assets/`: append flat higher-level binaries through Git LFS; no
  Markdown or source code. Distinguish original from derived attachments.
- project `raw/` and `assets/`: reserve for immutable code/repository evidence
  and code-oriented binary attachments.
- `projects/code/<id>/`: ignored in-place VCS working copy; read-only unless the user
  assigned code work.
- `inbox/`: unprocessed candidates, never durable evidence.
- `tasks/`: thorough operational state; exactly one `current.md` pointer.
- `scratch/`: immature hypotheses, never durable evidence.
- compiled collections: grounded agent-maintained knowledge.
- `output/`: polished reports/designs; source-backed claims use provenance.
- `examples/`: stable runnable illustrative code with tests. Exploratory demo
  code belongs in scratch or the current task.
- tools, hidden runtime directories, skills, assets, and code are opaque to
  OKF concept traversal.

## Viewer conversations and Queries

File a viewer conversation automatically only when it is substantial,
grounded, supported, durable or expensive to reconstruct, novel, clearly
scoped, complete about limitations, and safe. Ask for borderline cases; keep
trivial lookups read-only. Persist synthesis, not transcripts.

A Query requires a direct answer, evidence, limitations, related durable
pages, a one- or two-sentence `condensed_summary` of at most 360 Unicode code
points, `conversation.selection_id`, `sources[]`, and exact `anchors[]`.
Every anchor has a unique `source_id` bound to one source. Repeated work on a
selection updates its draft; a materially different later answer creates a
successor with `supersedes`. Do not silently rewrite stable history.

Markdown anchors use hash, quote, prefix/suffix, offsets, and lines. Resolve an
exact hash/range first, then only a unique contextual relocation. PDF anchors
use PDF hash, page, and exact point rectangles; suppress geometry after a hash
mismatch. Reuse the exact exported `open_uri`; never manufacture its payload
or expose `chat_uri` as a user-facing source link.

After filing a meaningful Query, update the living project repository guide
when understanding materially improved, apply the page gates below, rebuild,
validate, log, and refresh annotations.

## Entity and Concept gates

Enrich existing pages automatically. Create an Entity only when there is no
duplicate and the durable named thing is authoritative, independently
searchable, clearly scoped, and supports meaningful identity/ownership/
relationship prose. Never create an Entity for a function, file, RPC, passing
mention, or temporary object.

Create a Concept only when there is no duplicate and the evidence supports a
reusable mechanism, invariant, pattern, workflow, failure mode, or process
that remains valuable outside the conversation. Ask on ambiguous identity or
scope. Ask before fan-out touching ten or more pages.

## Completion

For material vault changes run:

```bash
python3 tools/llm-wiki/rebuild_indexes.py --vault demo-vault
python3 tools/llm-wiki/rebuild_indexes.py --vault demo-vault --check
python3 tools/llm-wiki/validate_vault.py --vault demo-vault
git lfs ls-files
git diff --check
git status --short
```

For extension behavior also run focused tests, typecheck, build, and the
appropriate browser/VS Code E2E path. Never claim human verification from
automated checks. Never stage, commit, push, publish, or write back externally
unless the user explicitly requests it. Never expose secrets, credentials,
private identifiers, or redacted values.
