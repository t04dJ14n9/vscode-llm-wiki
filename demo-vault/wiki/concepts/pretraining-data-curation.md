---
type: "Concept"
title: "Pretraining data curation"
description: "Selecting, cleaning, deduplicating, mixing, and validating documents before language-model training."
tags: ["data", "data-curation", "datasets", "pretraining"]
status: "draft"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "fineweb-paper", "resource": "../../raw/the-fineweb-datasets-decanting-the-web-for-the-finest-text-data-at-scale.md", "title": "The FineWeb Datasets"}, {"id": "dclm-paper", "resource": "../../raw/datacomp-lm-in-search-of-the-next-generation-of-training-sets-for-language-models.md", "title": "DataComp-LM"}, {"id": "dataset-source", "resource": "../../projects/code/nanochat/nanochat/dataset.py", "title": "Nanochat dataset loader", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "nanochat/dataset.py"}]
created: {"by": "process:project-scope-migration", "at": "2026-08-23T00:00:00Z"}
source_state: "awaiting-source"
relations: [{"target": "entities/fineweb.md", "kind": "references", "caption": "FineWeb"}, {"target": "entities/datacomp-lm.md", "kind": "references", "caption": "DataComp-LM"}, {"target": "comparisons/fineweb-vs-datacomp-lm.md", "kind": "references", "caption": "FineWeb versus DataComp-LM"}, {"target": "concepts/compute-optimal-training.md", "kind": "references", "caption": "Compute-optimal training"}]
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

[^fineweb-paper]: The FineWeb Datasets
[^dclm-paper]: DataComp-LM
[^dataset-source]: Nanochat dataset loader
