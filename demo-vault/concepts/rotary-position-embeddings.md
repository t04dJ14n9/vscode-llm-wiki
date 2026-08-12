---
type: "Concept"
title: "Rotary position embeddings"
description: "Position-dependent rotations applied to attention queries and keys."
tags: ["architecture", "attention", "language-models"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "roformer", "resource": "https://arxiv.org/abs/2104.09864v5", "title": "RoFormer: Enhanced Transformer with Rotary Position Embedding"}, {"id": "gpt-source", "resource": "../projects/code/nanochat/nanochat/gpt.py", "title": "Nanochat GPT implementation", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}]
---

# Rotary position embeddings

## Definition

Rotary position embedding (RoPE) rotates pairs of query and key coordinates by
position-dependent angles. Their dot product then contains relative-position
structure while the rotations themselves are deterministic.[^roformer]

## Mechanism

Implementations precompute sine and cosine tables by position and frequency.
Queries and keys receive the corresponding rotation before attention scores are
formed. During cached decoding, the table slice must be offset by the number of
positions already stored; using position zero again would corrupt the geometry.

## Nanochat connection

Nanochat precomputes a rotary cache, applies it to queries and keys, and offsets
the slice when a KV cache is active.[^gpt-source] RoPE is therefore coupled to
[KV caching](kv-caching.md), while its output still feeds the kernel described
under [FlashAttention](flash-attention.md).

## Related pages

- [Decoder-only transformers](decoder-only-transformers.md)
- [KV caching](kv-caching.md)
- [Inference and sampling](inference-and-sampling.md)

[^roformer]: RoFormer: Enhanced Transformer with Rotary Position Embedding
[^gpt-source]: Nanochat GPT implementation
