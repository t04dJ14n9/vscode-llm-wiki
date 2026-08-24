---
type: "Concept"
title: "Compute-optimal training"
description: "Choosing model size and token budget to use a fixed training-compute envelope effectively."
tags: ["optimization", "pretraining", "small-models", "training-systems"]
status: "draft"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-24T20:14:36+08:00"}
sources: [{"id": "dclm-paper", "resource": "../../raw/datacomp-lm-in-search-of-the-next-generation-of-training-sets-for-language-models.md", "title": "DataComp-LM"}, {"id": "base-train", "resource": "../../projects/code/nanochat/scripts/base_train.py", "title": "Nanochat base training", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/base_train.py"}, {"id": "scaling-run", "resource": "../../projects/code/nanochat/runs/scaling_laws.sh", "title": "Nanochat scaling-law run", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "runs/scaling_laws.sh"}]
created: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
source_state: "awaiting-source"
relations: [{"target": "concepts/gradient-accumulation-and-distributed-training.md", "kind": "references", "caption": "Gradient accumulation and distributed training"}, {"target": "concepts/pretraining-data-curation.md", "kind": "references", "caption": "Pretraining data curation"}]
---

# Compute-optimal training

## Definition

Compute-optimal training asks how to allocate a fixed amount of training
compute between model parameters and data tokens. The answer depends on the
data distribution, architecture, optimizer, and target metric; it is not a
universal constant.

## Mechanism

Controlled suites train multiple model sizes or data budgets, fit a scaling
relationship, then choose the frontier appropriate to the resource constraint.
DataComp-LM reinforces that dataset quality can shift that frontier rather than
merely changing the number of available tokens.[^dclm-paper]

## Nanochat connection

Nanochat’s base trainer derives the training horizon from a target
parameter-to-data ratio and reports estimated FLOPs.[^base-train] A separate
scaling-law run sweeps model depth to collect the evidence needed for a fit.[^scaling-run]
The speedrun deliberately uses a ratio of eight, described as undertraining the
model for its practical target, so “speedrun” and “compute optimal” should not
be used interchangeably.

## Related pages

- [Gradient accumulation and distributed training](gradient-accumulation-and-distributed-training.md)
- [Pretraining data curation](pretraining-data-curation.md)

[^dclm-paper]: DataComp-LM
[^base-train]: Nanochat base training
[^scaling-run]: Nanochat scaling-law run
