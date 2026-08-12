---
type: "Concept"
title: "Low-precision training"
description: "Using compact numerical formats for selected training operations while preserving stable state where needed."
tags: ["numerics", "optimization", "training-systems"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "fp8-paper", "resource": "../raw/fp8-formats-for-deep-learning.md", "title": "FP8 Formats for Deep Learning"}, {"id": "fp8-source", "resource": "../projects/code/nanochat/nanochat/fp8.py", "title": "Nanochat FP8 operations", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}, {"id": "base-train", "resource": "../projects/code/nanochat/scripts/base_train.py", "title": "Nanochat base training", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}]
---

# Low-precision training

## Definition

Low-precision training moves selected tensors or matrix operations from FP32 to
formats such as BF16 or FP8 to reduce memory traffic and increase accelerator
throughput. FP8 is a family of formats with different exponent/mantissa
tradeoffs, so scaling and accumulation policy are essential parts of the
method.[^fp8-paper]

## Mechanism

Stable systems keep sensitive reductions, master values, or optimizer
calculations at higher precision while quantizing eligible operations. Dynamic
range, saturation, and delayed/current scaling affect both speed and training
quality.

## Nanochat connection

Nanochat provides FP8 conversion and matrix-operation helpers rather than
globally changing every tensor’s dtype.[^fp8-source] Base training exposes
`--fp8`, enables it only on supported hardware paths, and still treats other
state according to its own precision rules.[^base-train] The practical choice is
summarized in [BF16 versus FP8](../comparisons/bf16-vs-fp8.md).

## Related pages

- [FlashAttention](flash-attention.md)
- [BF16 versus FP8](../comparisons/bf16-vs-fp8.md)
- [RMS normalization](rms-normalization.md)

[^fp8-paper]: FP8 Formats for Deep Learning
[^fp8-source]: Nanochat FP8 operations
[^base-train]: Nanochat base training
