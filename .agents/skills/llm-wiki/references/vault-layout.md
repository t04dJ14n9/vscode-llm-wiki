# Vault layout

Canonical navigation uses `_index.md` only. The outer catalog and each
registered code vault have `okf_version: "0.2"` on their own regular root
`_index.md`; indexes generated below either root are frontmatter-free.
`_log.md` is the only log name. Unprefixed variants and aliases are forbidden.

Each flat `projects/<id>.md` repository card is paired with a self-contained
`projects/<id>/` code vault and an ignored working copy at
`projects/code/<id>/`. The code vault contains generated repository
documentation candidates in `inbox/`, code-oriented `raw/` and `assets/`,
`tasks/current.md`, `scratch/`, and durable code guides/Queries. The outer vault
owns higher-level papers and binaries in flat `raw/` and `assets/`, plus
concepts, entities, comparisons, summaries, and synthesis. Root pages declare
`scope: vault` or `scope: cross-project`. Assets, ignored `projects/code/`, `.llm_wiki/`,
hidden runtime state, and skills are opaque. Compiled code-vault pages declare
`code_scope: true`. Do not add `revisions/` in v1.
