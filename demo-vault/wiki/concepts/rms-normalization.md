---
type: "Concept"
title: "RMS normalization"
description: "Activation normalization by root mean square without subtracting the mean."
tags: ["architecture", "numerics", "optimization"]
status: "draft"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "rmsnorm-paper", "resource": "https://arxiv.org/abs/1910.07467v1", "title": "Root Mean Square Layer Normalization"}, {"id": "gpt-source", "resource": "../../projects/code/nanochat/nanochat/gpt.py", "title": "Nanochat GPT implementation", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "nanochat/gpt.py"}]
created: {"by": "process:project-scope-migration", "at": "2026-08-23T00:00:00Z"}
source_state: "awaiting-source"
relations: [{"target": "concepts/adamw-and-muon-optimization.md", "kind": "references", "caption": "AdamW and Muon"}, {"target": "concepts/low-precision-training.md", "kind": "references", "caption": "low-precision training"}, {"target": "concepts/decoder-only-transformers.md", "kind": "references", "caption": "Decoder-only transformers"}]
---

# RMS normalization

## Definition

RMSNorm scales a vector using the inverse root mean square of its coordinates.
Unlike LayerNorm, it does not subtract the coordinate mean. The original work
argues that re-scaling invariance can provide the useful stabilizing property
without re-centering.[^rmsnorm-paper]

## Mechanism

For activation vector *x*, compute the mean of squared coordinates, add a small
epsilon, take the reciprocal square root, and multiply *x*. Some architectures
add learned per-coordinate scales; the exact parameterization must be checked
in code.

## Nanochat connection

Nanochat defines a compact `norm` operation and applies it before attention and
the MLP, with an additional final normalization before logits.[^gpt-source]
This is one part of the numerical path; optimizer state and FP8 execution are
separate concerns covered by [AdamW and Muon](adamw-and-muon-optimization.md)
and [low-precision training](low-precision-training.md).

## Related pages

- [Decoder-only transformers](decoder-only-transformers.md)
- [Low-precision training](low-precision-training.md)
- [AdamW and Muon optimization](adamw-and-muon-optimization.md)

[^rmsnorm-paper]: Root Mean Square Layer Normalization
[^gpt-source]: Nanochat GPT implementation
