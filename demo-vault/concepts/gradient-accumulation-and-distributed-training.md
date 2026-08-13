---
type: "Concept"
title: "Gradient accumulation and distributed training"
description: "Building a large token batch from microbatches spread across devices and optimizer steps."
tags: ["distributed-training", "pretraining", "training-systems"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "base-train", "resource": "../projects/code/nanochat/scripts/base_train.py", "title": "Nanochat base training", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}, {"id": "dataloader", "resource": "../projects/code/nanochat/nanochat/dataloader.py", "title": "Nanochat distributed data loader", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}, {"id": "optimizer", "resource": "../projects/code/nanochat/nanochat/optim.py", "title": "Nanochat distributed optimizer", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}]
---

# Gradient accumulation and distributed training

## Definition

Data-parallel training gives each rank a different microbatch, computes local
gradients, and combines them before a shared optimizer update. Gradient
accumulation repeats forward/backward microsteps before that update, allowing a
larger effective token batch than device memory can hold at once.

## Mechanism

If the target batch is *B* tokens and each of *R* ranks processes *b* tokens per
microstep, accumulation needs `B / (R × b)` microsteps. Losses must be scaled so
the accumulated gradient matches the intended average. Nanochat computes this
integer relationship explicitly and divides each microstep loss before
backpropagation.[^base-train]

## Nanochat connection

The data loader assigns nonoverlapping packed sequence positions to ranks and
advances deterministically.[^dataloader] The mixed optimizer overlaps
reduce-scatter/all-gather communication with parameter-specific update work.[^optimizer]
These mechanics explain why the
[training bottleneck query](../queries/what-dominates-a-nanochat-training-run.md)
must consider communication and input readiness as well as transformer FLOPs.

## Related pages

- [Compute-optimal training](compute-optimal-training.md)
- [AdamW and Muon optimization](adamw-and-muon-optimization.md)
- [Nanochat end-to-end training pipeline](../summaries/nanochat-end-to-end-training-pipeline.md)

[^base-train]: Nanochat base training
[^dataloader]: Nanochat distributed data loader
[^optimizer]: Nanochat distributed optimizer
