---
type: "Reference"
title: "Nanochat code-vault schema"
description: "Project-local OKF, repository evidence, code, workbench, and Query rules for Nanochat."
tags: ["project-nanochat", "open-knowledge-format", "provenance"]
status: "stable"
generated: {"by": "process:project-vault-migration", "at": "2026-08-24T00:00:00+08:00"}
---

# Nanochat code-vault schema

This directory is an OKF v0.2 bundle root. Its `_index.md` owns only this code
vault. The sibling `../code/nanochat/` working copy and local `assets/` are
opaque; all other visible directories
have generated immediate-child indexes.

`raw/` and `assets/` are reserved for immutable repository-specific evidence;
papers and higher-level sources live in the outer vault. `summaries/` accepts
DeepWiki and other generated repository documentation as unverified summaries.
Compiled pages here explain code and need no scope marker. Code evidence uses
`code_scope: true` plus repository `nanochat`, immutable revision,
repository-relative path, and a verified hash before becoming stable.

Queries require a condensed summary, selection ID, provenance sources, and
source-ID-bound Markdown, PDF, or code anchors.
