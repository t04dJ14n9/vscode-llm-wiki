---
type: "Query"
title: "Why does grouped-query attention reduce KV-cache cost?"
description: "How sharing key/value heads reduces autoregressive cache bandwidth and memory while retaining more capacity than one shared head."
tags: ["architecture", "attention", "inference"]
status: "draft"
scope: "vault"
generated: {"by": "process:vault-format-v2", "at": "2026-08-23T00:00:00+08:00"}
condensed_summary: "Grouped-query attention stores fewer distinct key/value heads than multi-head attention, reducing cache memory and bandwidth while preserving more representation capacity than multi-query attention."
conversation: {"selection_id": "demo-gqa-kv-cache-review"}
sources: [{"id": "gqa-paper", "resource": "../../raw/gqa-training-generalized-multi-query-transformer-models-from-multi-head-checkpoints.md", "title": "GQA paper snapshot"}]
anchors: [{"source_id": "gqa-paper", "kind": "markdown", "resource": "../../raw/gqa-training-generalized-multi-query-transformer-models-from-multi-head-checkpoints.md", "start_line": 1, "end_line": 1}]
relations: [{"target": "concepts/grouped-query-attention.md", "kind": "depends-on", "caption": "Uses the grouped-query attention mechanism"}, {"target": "concepts/kv-caching.md", "kind": "applies-to", "caption": "Explains the resulting KV-cache reduction"}, {"target": "comparisons/multi-head-vs-multi-query-vs-grouped-query-attention.md", "kind": "supported-by", "caption": "Uses the attention-head trade-off comparison"}, {"target": "concepts/grouped-query-attention.md", "kind": "references", "caption": "Grouped-query attention"}, {"target": "concepts/kv-caching.md", "kind": "references", "caption": "KV caching"}, {"target": "comparisons/multi-head-vs-multi-query-vs-grouped-query-attention.md", "kind": "references", "caption": "Attention-head comparison"}]
---

# Why does grouped-query attention reduce KV-cache cost?

## Answer

Autoregressive decoding retains keys and values from prior tokens. Multi-head
attention stores a separate key/value stream for every query head; grouped-query
attention lets several query heads share each key/value head, so fewer streams
must be stored and read. It preserves more distinct key/value groups than
multi-query attention, offering a middle point between cache efficiency and
model capacity.

## Evidence

The archived GQA paper describes grouped-query attention as an interpolation
between multi-head and multi-query attention and evaluates the quality/speed
trade-off.[^gqa-paper] The related Concept and Comparison pages preserve the
mechanism and decision boundary.

## Limitations

The realized speedup depends on model shape, sequence length, kernel support,
batching, and whether memory bandwidth is the active bottleneck.

## Related durable pages

- [Grouped-query attention](../concepts/grouped-query-attention.md)
- [KV caching](../concepts/kv-caching.md)
- [Attention-head comparison](../comparisons/multi-head-vs-multi-query-vs-grouped-query-attention.md)

[^gqa-paper]: GQA paper snapshot
