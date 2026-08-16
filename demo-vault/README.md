---
type: "Reference"
title: "Nanochat LLM Wiki"
description: "Reader orientation for a source-backed guide to building a small language model with Nanochat."
tags: ["language-models", "open-knowledge-format", "project-nanochat"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
---

# Nanochat LLM Wiki

This vault connects archived research papers and one exact Nanochat source
revision to a compact explanation of how text becomes a chat model. It is an
Open Knowledge Format (OKF) v0.2 bundle: Markdown stays readable without a
special service, while frontmatter, links, indexes, provenance, and hashes make
the collection inspectable by tools and agents.

## Start reading

- Open the [bundle index](_index.md) for one-level navigation.
- Follow a narrative through [summaries](summaries/_index.md).
- Start from a concrete question in [queries](queries/_index.md).
- Inspect the pinned [Nanochat project](projects/_index.md).
- Trace a claim into [raw research evidence](raw/_index.md) and its local PDF.

The best first page is the end-to-end Nanochat training summary. From there,
follow focused concepts only when you need mechanism-level detail.

## Repository prerequisites

Clone with Git LFS and initialize the project source:

```bash
git lfs install
git submodule update --init --recursive
git lfs pull
```

The Markdown companions remain readable when large assets have not yet been
pulled, but opening an archived paper requires its LFS object.

## Layers

`raw/` contains immutable source companions and local assets. `projects/`
contains project cards and opaque exact-commit source repositories. The
remaining top-level directories contain editable, source-backed compiled
knowledge.

Indexes show one directory level at a time. Ordinary Markdown links form the
richer graph across categories and evidence.

## Maintaining the vault

Read [the schema](SCHEMA.md) before changing structure and
[the operator handbook](AGENTS.md) before ingesting or compiling content.
Material mutations finish with deterministic index rebuilding, full
validation, and a newest-first entry in [the bundle log](log.md).
