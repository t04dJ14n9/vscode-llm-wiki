---
type: "Entity"
title: "DataComp-LM"
description: "A benchmark and experimental framework for comparing language-model dataset curation recipes."
tags: ["data", "data-curation", "datasets", "evaluation", "pretraining"]
status: "stable"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "dclm-paper", "resource": "../raw/datacomp-lm-in-search-of-the-next-generation-of-training-sets-for-language-models.md", "title": "DataComp-LM"}]
created: {"by": "process:project-scope-migration", "at": "2026-08-23T00:00:00Z"}
---

# DataComp-LM

## What it is

DataComp-LM is a controlled benchmark for language-model data selection. It
holds parts of training and evaluation fixed so that filtering, deduplication,
and mixing strategies can be compared through models trained on the resulting
datasets. The paper also introduces DCLM-Baseline and the higher-quality
DCLM-CORE dataset.[^dclm-paper]

## Why it matters

Model quality depends on more than token count. By making the dataset recipe the
experimental variable, DataComp-LM provides stronger evidence about curation
choices than unrelated end-model comparisons. It complements
[FineWeb](fineweb.md), whose paper provides a detailed web-corpus pipeline and
ablations.

## Nanochat relevance

Nanochat’s pinned loader uses ClimbMix rather than DCLM-CORE, so this page does
not label DataComp-LM as an implementation dependency. It supplies concepts and
measurement language for reading Nanochat’s data and
[compute-budget choices](../concepts/compute-optimal-training.md).

## Related pages

- [FineWeb versus DataComp-LM](../comparisons/fineweb-vs-datacomp-lm.md)
- [Pretraining data curation](../concepts/pretraining-data-curation.md)
- [What dominates a Nanochat training run](../projects/nanochat/queries/what-dominates-a-nanochat-training-run.md)

[^dclm-paper]: DataComp-LM
