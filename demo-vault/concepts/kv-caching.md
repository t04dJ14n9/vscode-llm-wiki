---
type: "Concept"
title: "KV caching"
description: "Reuse of attention keys and values from earlier tokens during autoregressive decoding."
tags: ["attention", "inference", "training-systems"]
status: "draft"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "engine", "resource": "../projects/code/nanochat/nanochat/engine.py", "title": "Nanochat generation engine", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "nanochat/engine.py"}, {"id": "gpt-source", "resource": "../projects/code/nanochat/nanochat/gpt.py", "title": "Nanochat GPT implementation", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "nanochat/gpt.py"}]
created: {"by": "process:project-scope-migration", "at": "2026-08-23T00:00:00Z"}
source_state: "awaiting-source"
---

# KV caching

## Definition

During autoregressive generation, earlier tokens’ attention keys and values do
not need to be recomputed at every decode step. A KV cache stores them by layer
and appends the new token’s projections.

## Mechanism

Generation begins with prompt prefill, then switches to single-token decode.
The cache must track sequence position, batch shape, dtype, and any windowing
policy. Its memory grows with layers, cached positions, key/value heads, and
head dimension. Nanochat implements separate prefill/decode cache handling and
supports cache reordering for active rows.[^engine]

## Nanochat connection

Nanochat offsets rotary positions by cache length and exposes helpers for
estimating allocated and actively read KV bytes under sliding windows.[^gpt-source]
This connects [grouped-query attention](grouped-query-attention.md) directly to
[inference and sampling](inference-and-sampling.md): fewer key/value heads
reduce cache traffic even if query head count stays high.

## Related pages

- [Rotary position embeddings](rotary-position-embeddings.md)
- [Grouped-query attention](grouped-query-attention.md)
- [Inference and sampling](inference-and-sampling.md)

[^engine]: Nanochat generation engine
[^gpt-source]: Nanochat GPT implementation
