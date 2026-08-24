---
type: "Entity"
title: "FineWeb"
description: "A family of large, openly documented Common Crawl text datasets and filtering recipes."
tags: ["data", "data-curation", "datasets", "pretraining"]
status: "stable"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "fineweb-paper", "resource": "../../raw/the-fineweb-datasets-decanting-the-web-for-the-finest-text-data-at-scale.md", "title": "The FineWeb Datasets"}]
created: {"by": "process:project-scope-migration", "at": "2026-08-23T00:00:00Z"}
relations: [{"target": "entities/datacomp-lm.md", "kind": "references", "caption": "DataComp-LM"}, {"target": "concepts/pretraining-data-curation.md", "kind": "references", "caption": "Pretraining data curation"}, {"target": "comparisons/fineweb-vs-datacomp-lm.md", "kind": "references", "caption": "FineWeb versus DataComp-LM"}]
---

# FineWeb

## What it is

FineWeb is a family of cleaned English web-text datasets built from Common
Crawl. The paper presents the filtering pipeline, ablations, and FineWeb-Edu, a
subset selected for educational quality.[^fineweb-paper]

## Why it matters

The work makes data curation inspectable as a sequence of choices—URL and
document filtering, deduplication, quality signals, and evaluation—rather than
treating “web data” as a single source. That makes it a useful counterpoint to
[DataComp-LM](datacomp-lm.md), which frames dataset construction as a benchmark
and competition over candidate filtering strategies.

## Nanochat relevance

FineWeb is background evidence, not the active dataset at the pinned Nanochat
commit. The current loader points to ClimbMix. Readers should use FineWeb to
understand web-data design dimensions, then use the
to verify the actual source.

## Related pages

- [Pretraining data curation](../concepts/pretraining-data-curation.md)
- [FineWeb versus DataComp-LM](../comparisons/fineweb-vs-datacomp-lm.md)
- [Research corpus overview](../../summaries/research-corpus-overview.md)

[^fineweb-paper]: The FineWeb Datasets
