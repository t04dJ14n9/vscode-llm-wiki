---
type: "Concept"
title: "Pretraining data curation"
description: "Selecting, cleaning, deduplicating, mixing, and validating documents before language-model training."
tags: ["data", "data-curation", "datasets", "pretraining"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "fineweb-paper", "resource": "../raw/the-fineweb-datasets-decanting-the-web-for-the-finest-text-data-at-scale.md", "title": "The FineWeb Datasets"}, {"id": "dclm-paper", "resource": "../raw/datacomp-lm-in-search-of-the-next-generation-of-training-sets-for-language-models.md", "title": "DataComp-LM"}, {"id": "dataset-source", "resource": "../projects/code/nanochat/nanochat/dataset.py", "title": "Nanochat dataset loader", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}]
---

# Pretraining data curation

## Definition

Pretraining data curation is the conversion of raw documents into a traceable
training distribution. It includes eligibility rules, quality filtering,
deduplication, safety or policy filtering, mixture weights, shuffling, and
held-out validation.

## Mechanism

FineWeb demonstrates a concrete web-corpus pipeline and evaluates filtering
choices through trained models.[^fineweb-paper] DataComp-LM makes the curation
recipe itself the comparison variable in a controlled benchmark.[^dclm-paper]
Together they show why a dataset name is insufficient provenance: snapshot,
filters, and mixture policy influence what the model learns.

## Nanochat connection

At the pinned commit, Nanochat’s loader points to versioned ClimbMix shards on
Hugging Face, downloads them atomically, and separates train from validation
shards.[^dataset-source] This wiki therefore treats
[FineWeb](../entities/fineweb.md) and [DataComp-LM](../entities/datacomp-lm.md)
as research context rather than claiming either is the active corpus.

## Related pages

- [FineWeb versus DataComp-LM](../comparisons/fineweb-vs-datacomp-lm.md)
- [Compute-optimal training](compute-optimal-training.md)
- [Nanochat end-to-end training pipeline](../summaries/nanochat-end-to-end-training-pipeline.md)

[^fineweb-paper]: The FineWeb Datasets
[^dclm-paper]: DataComp-LM
[^dataset-source]: Nanochat dataset loader
