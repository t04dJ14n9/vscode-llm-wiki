---
type: "Concept"
title: "FlashAttention"
description: "Exact attention kernels organized to reduce expensive memory traffic."
tags: ["attention", "numerics", "training-systems"]
status: "draft"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-24T20:14:36+08:00"}
sources: [{"id": "fa3-paper", "resource": "../../raw/flashattention-3-fast-and-accurate-attention-with-asynchrony-and-low-precision.md", "title": "FlashAttention-3"}, {"id": "attention-source", "resource": "../../projects/code/nanochat/nanochat/flash_attention.py", "title": "Nanochat attention backend", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "nanochat/flash_attention.py"}]
created: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
source_state: "awaiting-source"
relations: [{"target": "concepts/grouped-query-attention.md", "kind": "references", "caption": "Grouped-query attention"}, {"target": "concepts/low-precision-training.md", "kind": "references", "caption": "Low-precision training"}]
---

# FlashAttention

## Definition

FlashAttention is a family of exact attention algorithms that tile computation
to limit reads and writes of large intermediate matrices. FlashAttention-3
targets Hopper GPUs with asynchronous execution and low-precision support; the
paper distinguishes speed from the numerical error introduced by particular
precision paths.[^fa3-paper]

## Mechanism

Rather than materializing the complete score and probability matrices in high
bandwidth memory, tiled kernels maintain online softmax statistics and
accumulate output blocks. Hardware, dtype, causality, and window configuration
determine which backend is applicable.

## Nanochat connection

Nanochat attempts to use the FA3 interface and supplies a PyTorch SDPA fallback.
The wrapper supports causal and sliding-window masks and explicitly handles
GQA-compatible tensor layouts.[^attention-source] A fallback preserves
correctness but not necessarily the performance assumed by the

## Related pages

- [Grouped-query attention](grouped-query-attention.md)
- [Low-precision training](low-precision-training.md)

[^fa3-paper]: FlashAttention-3
[^attention-source]: Nanochat attention backend
