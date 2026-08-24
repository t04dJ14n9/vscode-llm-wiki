# LLM Wiki for VS Code

LLM Wiki for VS Code is a local-first, source-grounded workbench for Markdown,
PDFs, and code repositories. Knowledge remains ordinary Git-backed Markdown;
source passages can link back to durable Query answers without a required web
service, account, database, vector store, or `llm-wiki-compiler` runtime.

## Learning loop

1. Open Markdown or PDF and select an exact passage.
2. Use **Add to Chat** or **Copy for Agent**. The extension exports immutable
   `.llm_wiki/agent/exports/<selection-id>/selection.{md,json,png}` artifacts
   and never presses Send.
3. Discuss the source. The extension neither scrapes nor submits conversation
   content.
4. The agent follows the vault's `AGENTS.md`. A substantial grounded answer may
   become an ordinary Query; trivial lookups remain read-only.
5. The original source shows `✦ Query` or `✦ N Queries`; hover or focus reveals
   condensed answers and navigation to the Query page.

Queries preserve synthesis and provenance, not transcripts. Markdown anchors
use hashes, quotes, context, offsets, and unique relocation. PDF geometry is
shown only when the current byte hash matches.

## Agent handoff

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

Reuse the exact `open_uri` emitted by `selection.json`:

```text
cursor://llm-wiki.llm-wiki-vscode/open-anchor?target=v1.<generated-payload>
vscode://llm-wiki.llm-wiki-vscode/open-anchor?target=v1.<generated-payload>
```

Never manufacture that payload or expose `.llm_wiki_anchor` or `chat_uri` as a
user-facing source link. Persisted pages use relative Markdown links or
wikilinks.

## Vault format

```text
vault/
├── _index.md
├── _log.md
├── AGENTS.md
├── SCHEMA.md
├── TAGS.md                       # vault-local canonical tag registry
├── templates/                     # opaque .md.tmpl authoring formats
├── wiki/
│   ├── daily/
│   ├── concepts/
│   ├── comparisons/
│   ├── entities/
│   ├── summaries/
│   └── queries/
├── playbooks/
├── projects/
│   ├── <id>.md                    # portable VCS reference card
│   └── code/<id>                  # ignored checkout or symlink
├── raw/
└── inbox|tasks|scratch|output/
```

`projects/<id>.md` stores repository identity, tracked ref, observation, status,
and ongoing change—never a local path, registry entry, submodule, or paired
project vault. Repository-specific knowledge belongs in the writable code
repository's `docs/llm-wiki/`; outer-vault knowledge stays higher-level.

Every durable `wiki/**/*.md` page except generated `_index.md` has explicit
validated `relations` metadata. This is the stable data contract for a future
directed graph view; the current graph UI is intentionally unchanged. Daily
active recall is generated lazily by agents from templates and categorized log
entries, not by an extension command or platform scheduler.

Canonical Query inputs are `wiki/queries/*.md` and, for directly opened code
repositories, `docs/llm-wiki/queries/*.md`. Legacy root/project Query paths and
`wiki/learning` remain one-release read-only inputs.

## Start an empty vault

The extension package includes
`resources/llm-wiki-empty-vault.zip`. Extract its contents directly into a new
directory to get a knowledge-empty vault that already follows this layout:

```bash
mkdir MyVault
unzip packages/vscode-extension/resources/llm-wiki-empty-vault.zip -d MyVault
```

The archive includes the complete AGENTS workflow, schema, tag registry,
authoring templates, generated indexes, workbench directories, ignored
`projects/code/` binding directory, and an empty Git-LFS-ready `assets/`
directory. It contains no sample knowledge, nested Git repository, or code
checkout.

## Repository packages

```text
packages/
├── vscode-extension/              # extension host and Markdown webview
├── pdf-editor/                    # shared PDF viewer and selection model
└── core/                          # portable reference primitives
tools/llm-wiki/                    # deterministic producers and validators
starter-vault/                     # canonical source for the empty vault ZIP
.agents/skills/pdf/                # focused PDF selection workflow
.agents/skills/humanizer/          # evidence-preserving prose polish
.agents/skills/arxiv/              # version-pinned paper discovery
.agents/skills/grounded-citations/ # claim-level evidence verification
.agents/skills/research-paper-writing/ # academic research workflow
demo-vault/                        # graph-ready example vault
```

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
python3 tools/llm-wiki/build_starter_bundle.py --check
```

Browser and VS Code-host tests:

```bash
pnpm --filter llm-wiki-vscode test:e2e
pnpm --filter llm-wiki-vscode test:playwright
pnpm --filter llm-wiki-vscode test:vscode-e2e
```

## License

MIT. See `LICENSE`.
