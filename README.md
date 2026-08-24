# LLM Wiki for VS Code

LLM Wiki for VS Code is a local-first, source-grounded knowledge workbench for
Markdown, PDFs, and code repositories. The combined VS Code/Cursor extension
keeps knowledge as ordinary Git-backed Markdown while giving source passages
precise links back to durable Query answers.

There is no required web service, account, database, vector store, or
`llm-wiki-compiler` runtime.

## Learning loop

1. Open a Markdown file or PDF and select an exact passage.
2. Use **Add to Chat** or **Copy for Agent**. The extension creates an immutable
   `.llm_wiki/agent/exports/<selection-id>/selection.{md,json,png}` snapshot and
   adds it to a supported agent draft without pressing Send.
3. Discuss the source in the agent session. The extension never scrapes or
   submits the conversation.
4. The repository `llm-wiki` skill files a substantial grounded answer as an
   ordinary OKF Query; trivial questions remain read-only and borderline cases
   ask first.
5. The original Markdown range or PDF rectangles show `✦ Query` or
   `✦ N Queries`. Hover/focus displays every condensed answer and opens its
   Markdown Query page.

Queries store synthesis and provenance, not transcripts. Markdown anchors use
hashes, quotes, context, and offsets with unique relocation after edits. PDF
geometry is shown only when the current PDF hash matches the stored anchor.

## Agent handoff

The immutable export is the handoff contract:

```text
.llm_wiki/agent/
├── selection.md
├── selection.json
├── selection.png                  # optional latest crop
└── exports/<selection-id>/
    ├── selection.md
    ├── selection.json
    └── selection.png              # optional immutable crop
```

Codex, Claude Code, Cursor Agent, and CodeBuddy integrations add context to a
draft using the capabilities their installed extensions expose. Optional crop
failure never discards verified text context.

For chat navigation, reuse the exact `open_uri` emitted by `selection.json`:

```text
cursor://llm-wiki.llm-wiki-vscode/open-anchor?target=v1.<generated-payload>
vscode://llm-wiki.llm-wiki-vscode/open-anchor?target=v1.<generated-payload>
```

Never manufacture the payload or expose the internal `.llm_wiki_anchor` or
`chat_uri` bridge as a user-facing source link. Persisted vault pages use
portable relative Markdown links and wikilinks.

## Project-scoped vault

```text
vault/
├── _index.md
├── _log.md
├── AGENTS.md
├── SCHEMA.md
├── projects/
│   ├── repositories.yaml
│   ├── code/                       # ignored in-place working copies
│   │   └── <project-id>/           # Git/P4/SVN checkout, never vault-owned
│   ├── <project-id>.md             # flat repository overview and status
│   └── <project-id>/               # self-contained project OKF vault
│       ├── _index.md
│       ├── AGENTS.md
│       ├── SCHEMA.md
│       ├── _log.md
│       ├── inbox/
│       ├── raw/                    # flat immutable Markdown evidence
│       ├── assets/                 # flat binary Git LFS evidence
│       ├── tasks/current.md
│       ├── scratch/
│       ├── summaries/
│       ├── concepts/
│       ├── entities/
│       ├── playbooks/
│       ├── comparisons/
│       ├── queries/
│       ├── output/
│       └── examples/
├── raw/                            # higher-level immutable Markdown evidence
├── assets/                         # higher-level flat binary evidence, Git LFS
├── examples/
└── concepts|entities|summaries|playbooks|comparisons|queries/... # vault-level learning
```

The outer catalog and each registered code vault carry `okf_version: "0.2"` on
their own regular `_index.md`; indexes below either root are generated and
frontmatter-free. `_index.md` and `_log.md` are the only accepted navigation
and log names. Assets, registered code working copies, hidden runtime state,
and skill packages are opaque to OKF traversal.

`projects/repositories.yaml` records VCS identity and pairs each flat card with
its project vault and canonical ignored `projects/code/<id>/` working copy. Code is always
synchronized in place by Git, P4, or SVN; the vault never automatically clones
or syncs it. Project code is never represented by `.gitmodules` or a Git
submodule gitlink.
Stable code claims bind to repository, immutable revision, path, and verified
content hash; a newer checkout creates currentness debt without invalidating a
matching historical claim.

The project vault is code-oriented: implementation guides, code Queries,
repository tasks, and imported DeepWiki-style documentation belong there.
Papers and higher-level concepts, entities, comparisons, and synthesis belong
to the outer vault.

The reusable DeepWiki importer downloads every embedded page as a separate
draft Summary:

```bash
python3 tools/llm-wiki/import_deepwiki.py --vault demo-vault --project nanochat
```

## Query contract

An OKF Query contains:

- a direct answer, evidence, limitations, and related durable pages;
- `condensed_summary` of one or two sentences and at most 360 Unicode code
  points;
- lifecycle and generated metadata;
- optional project ID;
- immutable `conversation.selection_id`;
- provenance `sources[]`;
- exact `anchors[]`, each bound to a unique source through `source_id`.

The local `QueryAnnotationIndex` scans root/project Query directories and a
one-release read-only `wiki/learning` compatibility directory. It refreshes on
file changes and performs no network or model calls.

## Raw evidence, assets, and workbench

- `raw/` stores flat immutable Markdown source records.
- `assets/` stores flat immutable PDFs/images/audio/video/archives/datasets and
  derived renders through Git LFS. Attachments record role, media type, bytes,
  and SHA-256.
- `inbox/` is unprocessed material; `scratch/` is immature reasoning;
  `tasks/` is thorough operational state; none is durable evidence.
- `output/` is polished deliverables. `examples/` is stable runnable teaching
  code; exploratory demo code stays in scratch/tasks.
- There is no `revisions/` directory in v1.

## Repository packages

```text
packages/
├── vscode-extension/              # extension host and Markdown webview
├── pdf-editor/                    # shared PDF viewer and selection model
└── core/                          # portable reference primitives
tools/llm-wiki/                    # deterministic producers and validators
.agents/skills/llm-wiki/           # Hermes-derived vault workflow
demo-vault/                        # project-scoped example vault
```

The active skill is derived from NousResearch Hermes Agent's MIT-licensed
`llm-wiki` skill at the pinned commit recorded in
`.agents/skills/THIRD_PARTY_NOTICES.md`. The upstream snapshot is retained as a
read-only reference; the active workflow is adapted for OKF, registered code,
Git LFS, workbench state, and Markdown/PDF Query annotations.

## Development

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build

python3 -m unittest discover -s tools/llm-wiki/tests -v
python3 tools/llm-wiki/rebuild_indexes.py --vault demo-vault --check
python3 tools/llm-wiki/validate_vault.py --vault demo-vault
```

Browser and VS Code-host tests are available through the extension package:

```bash
pnpm --filter llm-wiki-vscode test:e2e
pnpm --filter llm-wiki-vscode test:playwright
pnpm --filter llm-wiki-vscode test:vscode-e2e
```

The extension resolves directory navigation through `_index.md` only and reads
legacy `wiki/learning` notes without creating new ones.

## License

MIT. See `LICENSE` and `.agents/skills/THIRD_PARTY_NOTICES.md`.
