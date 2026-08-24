---
type: "Concept"
title: "Low-precision training"
description: "Using compact numerical formats for selected training operations while preserving stable state where needed."
tags: ["numerics", "optimization", "training-systems"]
status: "draft"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-24T20:14:36+08:00"}
sources: [{"id": "fp8-paper", "resource": "../../raw/fp8-formats-for-deep-learning.md", "title": "FP8 Formats for Deep Learning"}, {"id": "fp8-source", "resource": "../../projects/code/nanochat/nanochat/fp8.py", "title": "Nanochat FP8 operations", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "nanochat/fp8.py"}, {"id": "base-train", "resource": "../../projects/code/nanochat/scripts/base_train.py", "title": "Nanochat base training", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/base_train.py"}]
created: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
source_state: "awaiting-source"
relations: [{"target": "comparisons/bf16-vs-fp8.md", "kind": "references", "caption": "BF16 versus FP8"}, {"target": "concepts/flash-attention.md", "kind": "references", "caption": "FlashAttention"}, {"target": "concepts/rms-normalization.md", "kind": "references", "caption": "RMS normalization"}]
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
