---
type: "Concept"
title: "Grouped-query attention"
description: "Attention with many query heads sharing a smaller set of key/value heads."
tags: ["architecture", "attention", "inference"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "gqa-paper", "resource": "../raw/gqa-training-generalized-multi-query-transformer-models-from-multi-head-checkpoints.md", "title": "GQA"}, {"id": "gpt-source", "resource": "../projects/code/nanochat/nanochat/gpt.py", "title": "Nanochat GPT implementation", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}]
---

# Grouped-query attention

## Definition

Grouped-query attention (GQA) retains multiple query heads but shares each
key/value head across a group of query heads. It occupies the design space
between multi-head attention, where head counts match, and multi-query
attention, where all queries share one key/value pair.[^gqa-paper]

## Mechanism

The number of query heads must be divisible by the number of key/value heads.
Fewer key/value heads reduce the tensors stored and read during autoregressive
decoding. The tradeoff is possible loss of key/value specialization, which the
GQA paper studies through checkpoint conversion and continued training.

## Nanochat connection

Nanochat parameterizes query and key/value head counts independently, asserts
the grouping relationship, and computes cache memory from the key/value count.
Its base-training defaults currently set those counts equal, while the
architecture and inference tools support GQA configurations.[^gpt-source]

## Related pages

- [Multi-head versus multi-query versus grouped-query attention](../comparisons/multi-head-vs-multi-query-vs-grouped-query-attention.md)
- [KV caching](kv-caching.md)
- [Decoder-only transformers](decoder-only-transformers.md)

[^gqa-paper]: GQA
[^gpt-source]: Nanochat GPT implementation
