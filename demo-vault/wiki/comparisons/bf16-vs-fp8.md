---
type: "Comparison"
title: "BF16 versus FP8"
description: "A practical comparison of robust mixed-precision defaults and more aggressive low-precision acceleration."
tags: ["numerics", "optimization", "training-systems"]
status: "draft"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "fp8-paper", "resource": "../../raw/fp8-formats-for-deep-learning.md", "title": "FP8 Formats for Deep Learning"}, {"id": "base-train", "resource": "../../projects/code/nanochat/scripts/base_train.py", "title": "Nanochat base training", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/base_train.py"}, {"id": "fp8-source", "resource": "../../projects/code/nanochat/nanochat/fp8.py", "title": "Nanochat FP8 operations", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "nanochat/fp8.py"}]
source_state: "awaiting-source"
relations: [{"target": "concepts/low-precision-training.md", "kind": "references", "caption": "Low-precision training"}, {"target": "concepts/flash-attention.md", "kind": "references", "caption": "FlashAttention"}]
---

# BF16 versus FP8

## Decision frame

Choose the precision path per operation and hardware, not by changing a model
label. BF16 is a broadly supported training representation with an FP32-like
exponent range; FP8 offers smaller operands and higher eligible matrix
throughput but needs explicit format and scale management.

## Comparison

| Dimension | BF16 | FP8 |
| --- | --- | --- |
| Width | 16 bits | 8 bits |
| Dynamic range | Large exponent, reduced precision | Depends on E4M3/E5M2-like format |
| Scaling burden | Usually lower | Central to avoiding saturation/underflow[^fp8-paper] |
| Hardware sensitivity | Mature on modern accelerators | Fast path depends on newer accelerator support |
| Typical role | Activations/weights in mixed precision | Selected high-throughput matrix operations |

Nanochat keeps FP8 in explicit helper operations rather than treating every
tensor identically.[^fp8-source] Base training exposes an `--fp8` switch and
retains other calculations under their own dtype policy.[^base-train]

## Takeaway

Use BF16 as the simpler compatibility baseline. Enable FP8 only when the
hardware path, scaling behavior, convergence, and end metric are verified. A
speedup without an equivalent-quality checkpoint is not a successful
comparison.

## Related pages

- [Low-precision training](../concepts/low-precision-training.md)
- [FlashAttention](../concepts/flash-attention.md)

[^fp8-paper]: FP8 Formats for Deep Learning
[^base-train]: Nanochat base training
[^fp8-source]: Nanochat FP8 operations
