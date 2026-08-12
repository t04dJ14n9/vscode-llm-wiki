---
type: "Query"
title: "What dominates a Nanochat training run?"
description: "A bottleneck-oriented answer spanning token budget, transformer math, kernels, communication, and data readiness."
tags: ["distributed-training", "optimization", "pretraining", "training-systems"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "base", "resource": "../projects/code/nanochat/scripts/base_train.py", "title": "Nanochat base training", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}, {"id": "gpt", "resource": "../projects/code/nanochat/nanochat/gpt.py", "title": "Nanochat GPT implementation", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}, {"id": "attention", "resource": "../projects/code/nanochat/nanochat/flash_attention.py", "title": "Nanochat attention backend", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}, {"id": "optimizer", "resource": "../projects/code/nanochat/nanochat/optim.py", "title": "Nanochat distributed optimizer", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}]
---

# What dominates a Nanochat training run?

## Answer

At the speedrun scale, the base pretraining stage dominates wall time because it
executes the largest token budget through the full transformer. Within that
stage, the bottleneck can move among matrix throughput, attention, distributed
communication, data availability, and checkpoint/evaluation pauses. There is no
single answer independent of depth, sequence length, precision, GPU, and
backend.

## Evidence trail

Base training derives a fixed number of optimizer steps from model parameters,
target data ratio, global token batch, and gradient accumulation.[^base] The GPT
implementation reports parameter and FLOP estimates and accounts for
layer-specific sliding windows in attention cost.[^gpt]

The attention wrapper uses FA3 where available and otherwise falls back to SDPA;
the fallback can remain correct while changing utilization dramatically.[^attention]
The mixed optimizer overlaps distributed reduce/gather work with AdamW and Muon
updates, making interconnect and parameter grouping part of throughput.[^optimizer]

Use [compute-optimal training](../concepts/compute-optimal-training.md) for the
budget choice and
[gradient accumulation and distributed training](../concepts/gradient-accumulation-and-distributed-training.md)
for the batch/communication path.

## Limits

The repository’s “approximately 1.5 hours” speedrun estimate targets an
eight-H100 node. It is not a portable benchmark. Dataset cache state, compiler
warmup, kernel installation, networking, logging, and evaluation frequency all
change wall time.

## Related pages

- [FlashAttention](../concepts/flash-attention.md)
- [BF16 versus FP8](../comparisons/bf16-vs-fp8.md)
- [Nanochat end-to-end training pipeline](../summaries/nanochat-end-to-end-training-pipeline.md)

[^base]: Nanochat base training
[^gpt]: Nanochat GPT implementation
[^attention]: Nanochat attention backend
[^optimizer]: Nanochat distributed optimizer
