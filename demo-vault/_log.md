---
type: "Log"
title: "Nanochat LLM Wiki bundle history"
---

# Bundle history

## 2026-08-24

* **Canonical filenames**: Made `_index.md` and `_log.md` the only navigation
  and log files across the outer and code vaults; removed unprefixed files,
  compatibility aliases, and extension fallback resolution.
* **DeepWiki summaries**: Downloaded all 53 commit-bound Nanochat DeepWiki
  Markdown pages into `projects/nanochat/summaries/` as unverified summaries.
* **Project catalog**: Replaced the nested project-card layout with a flat
  `projects/nanochat.md` repository card paired to a self-contained
  `projects/nanochat/` OKF/Karpathy vault.
* **In-place working copy**: Registered the ignored
  `projects/code/nanochat/` directory as Nanochat's in-place Git working copy
  and generalized repository metadata for Git, P4, and SVN without automatic
  synchronization.
* **Knowledge boundary correction**: Restored papers, PDFs, general LLM
  concepts, dataset Entities, comparisons, high-level summaries, and viewer
  examples to the outer vault. The Nanochat project vault is now code-oriented.
* **Repository documentation import**: Registered the Nanochat DeepWiki index
  at the studied commit as an unverified candidate inside the code vault and
  made its verification the current project task.
* **Evidence tooling**: Made outer `raw/` and `assets/` first-class validated
  evidence stores and routed both outer and project assets through Git LFS.
* **No submodules**: Kept `.gitmodules` and the old Nanochat gitlink removed;
  project code is an ignored, registry-bound in-place working copy.

## 2026-08-23

* **Query annotations**: Added local Query discovery and exact Markdown/PDF
  source annotations with condensed summaries, selection-ID identity, safe
  relocation, and PDF hash-staleness suppression.
* **Agent workflow**: Replaced the active wiki skill with the attributed
  Hermes-derived project-scoped OKF workflow, strict Entity/Concept gates, and
  high-value viewer-conversation filing rules.
* **Compatibility experiment**: Introduced temporary navigation aliases that
  were removed by the canonical underscore-only policy on 2026-08-24.
* **Project scope**: Migrated Nanochat-specific raw evidence, assets, summaries,
  entities, and queries into `projects/nanochat/`; reusable root pages now
  declare cross-project scope.
* **Repository binding**: Replaced the submodule with a versioned repository
  registry and an optional ignored working-copy binding. Code
  pages are draft and awaiting source hashes.
* **OKF tooling**: Generalized producers under `tools/llm-wiki` and added
  layered project-policy validation.

## 2026-08-17

* **Portable PDF selections**: Added a vault-local PDF skill that verifies
  source hashes and extracts exact page regions from portable `page` and
  `viewrect` links; agent handoff no longer needs retained screenshots.
* **Index experiment**: Changed hierarchical index conventions; this was
  superseded by the canonical underscore-only policy on 2026-08-24.
* **Markdown rendering**: Footnote definitions no longer enter the collapsed
  reference-link index, so long inactive references remain visible in active
  tables.

## 2026-08-14

* **Editor fix**: Structured frontmatter property editors now hide their
  display button while editing, preventing duplicate/overlapping values for
  long URLs such as `sources[0].resource`; Enter/blur commits and Escape
  cancels. The focused browser regression covers the edit and persistence
  path.
* **Claude handoff**: Cursor reveals the existing Claude sidebar before running
  insert-at-mention, preventing Claude's transient `editor.openLast` fallback
  window when a selected Markdown range is handed off.
* **Markdown rendering**: Inline-code link labels such as `runs/speedrun.sh`
  now retain a subdued link tint instead of inheriting a bright blue or becoming
  fully gray; the focused browser coverage and live Cursor smoke both pass.
* **Image rendering**: Markdown image source lines now remain visible beside
  their previews even when inactive; the inline Expand image dialog and
  copy/paste behavior remain intact.

## 2026-08-13

* **Verification**: Read the bundle in VS Code and Cursor Extension Development Hosts, including hierarchical `child/` indexes, an extensionless bundle-relative concept ID, a real Obsidian image embed, a long raw paper companion, and its local 11-page PDF.
* **Compatibility**: Added consumer support and regression coverage for OKF concept IDs without `.md`, `/bundle-relative` targets, and directory targets that open the local `_index.md`.
* **Compilation**: Added 35 source-backed summaries, entities, concepts, comparisons, and durable queries spanning the Nanochat lifecycle.
* **Ingestion**: Archived eight exact-version CC BY 4.0 arXiv papers as canonical-title Markdown/PDF pairs with extraction and integrity metadata.
* **Project pin**: Added the Nanochat repository as a submodule at commit `92d63d4e8bb4df75c3b71618f31ddde2378b2bcd` and mapped the executable pipeline.
* **Migration**: Established `demo-vault/` itself as the OKF v0.2 bundle root and adopted hierarchical indexes for every visible bundle-owned directory.
* **Tooling**: Moved deterministic ingestion, index, and validation tools outside the distributable bundle.
