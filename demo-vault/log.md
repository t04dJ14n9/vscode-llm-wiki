---
type: "Log"
title: "Nanochat LLM Wiki bundle history"
---

# Bundle history

## 2026-08-17

* **Index migration**: Renamed every hierarchical index to `_index.md`; the
  producer, validator, extension, skill, and operator documentation no longer
  recognize `index.md` as an index.
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
