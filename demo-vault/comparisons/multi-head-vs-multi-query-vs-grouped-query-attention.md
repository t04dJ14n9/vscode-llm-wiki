---
type: "Comparison"
title: "Multi-head versus multi-query versus grouped-query attention"
description: "The quality and cache-bandwidth tradeoff created by sharing key/value heads."
tags: ["architecture", "attention", "inference"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "gqa-paper", "resource": "../raw/gqa-training-generalized-multi-query-transformer-models-from-multi-head-checkpoints.md", "title": "GQA"}, {"id": "gpt-source", "resource": "../projects/code/nanochat/nanochat/gpt.py", "title": "Nanochat GPT implementation", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}]
---

# Multi-head versus multi-query versus grouped-query attention

## Decision frame

The choice matters most during autoregressive inference, where keys and values
for earlier positions are repeatedly read. It controls key/value parameter
count and cache bandwidth without requiring the query-head count to change.

## Comparison

| Layout | Query heads | Key/value heads | Expected cache tradeoff |
| --- | ---: | ---: | --- |
| Multi-head (MHA) | *h* | *h* | Largest KV cache, maximum per-head specialization |
| Grouped-query (GQA) | *h* | between 1 and *h* | Tunable middle ground |
| Multi-query (MQA) | *h* | 1 | Smallest KV cache, most sharing |

The GQA paper finds that a small number of key/value groups can approach
multi-head quality while retaining much of multi-query inference speed, and it
describes converting existing multi-head checkpoints with brief
uptraining.[^gqa-paper]

## Takeaway

GQA is the practical knob when decode memory traffic matters but one shared
key/value head is too restrictive. Nanochat supports separate counts and
estimates KV memory from `n_kv_head`; its current base-training defaults set
query and key/value head counts equal.[^gpt-source] Inspect configuration rather
than assuming the architecture capability is active.

## Related pages

- [Grouped-query attention](../concepts/grouped-query-attention.md)
- [KV caching](../concepts/kv-caching.md)
- [Inference and sampling](../concepts/inference-and-sampling.md)

[^gqa-paper]: GQA
[^gpt-source]: Nanochat GPT implementation
