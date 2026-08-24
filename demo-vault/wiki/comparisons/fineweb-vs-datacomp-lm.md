---
type: "Comparison"
title: "FineWeb versus DataComp-LM"
description: "Two complementary ways to reason about web-scale language-model data curation."
tags: ["data-curation", "datasets", "evaluation"]
status: "stable"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-24T20:14:36+08:00"}
sources: [{"id": "fineweb-paper", "resource": "../../raw/the-fineweb-datasets-decanting-the-web-for-the-finest-text-data-at-scale.md", "title": "The FineWeb Datasets"}, {"id": "dclm-paper", "resource": "../../raw/datacomp-lm-in-search-of-the-next-generation-of-training-sets-for-language-models.md", "title": "DataComp-LM"}]
relations: [{"target": "entities/fineweb.md", "kind": "references", "caption": "FineWeb"}, {"target": "entities/datacomp-lm.md", "kind": "references", "caption": "DataComp-LM"}, {"target": "concepts/pretraining-data-curation.md", "kind": "references", "caption": "Pretraining data curation"}, {"target": "concepts/compute-optimal-training.md", "kind": "references", "caption": "Compute-optimal training"}]
---

# FineWeb versus DataComp-LM

## Decision frame

Use this comparison when choosing evidence for a curation decision. FineWeb is
most useful as a documented corpus-building recipe with detailed ablations;
DataComp-LM is most useful as a controlled framework for comparing candidate
recipes.

## Comparison

| Dimension | FineWeb | DataComp-LM |
| --- | --- | --- |
| Primary artifact | Large cleaned web-text datasets, including FineWeb-Edu | Benchmark, candidate pools, baselines, and DCLM datasets |
| Central question | Which filters and processing steps yield a strong open corpus? | Which curation strategy wins when model training and evaluation are controlled? |
| Evidence style | Pipeline ablations and downstream model evaluations[^fineweb-paper] | Standardized competition-style comparison across dataset scales[^dclm-paper] |
| Reader value | Reproduce or critique a concrete web pipeline | Compare a new filter or mixture under controlled conditions |
| Nanochat status | Research context, not the pinned active dataset | Research context, not the pinned active dataset |

The projects are complements, not interchangeable leaderboards. Their reported
scores inherit different candidate pools, training settings, and evaluation
suites.

## Takeaway

For a new vault source, record both the corpus recipe and the evaluation frame.
Use [FineWeb](../entities/fineweb.md) to inspect pipeline decisions and
[DataComp-LM](../entities/datacomp-lm.md) to reason about controlled comparison.
Verify Nanochat’s actual loader before attributing either dataset to it.

## Related pages

- [Pretraining data curation](../concepts/pretraining-data-curation.md)
- [Compute-optimal training](../concepts/compute-optimal-training.md)
- [Research corpus overview](../summaries/research-corpus-overview.md)

[^fineweb-paper]: The FineWeb Datasets
[^dclm-paper]: DataComp-LM
