---
type: "Comparison"
title: "AdamW versus Muon"
description: "Why Nanochat assigns adaptive and orthogonalized updates to different parameter shapes."
tags: ["distributed-training", "optimization"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "muon-paper", "resource": "https://arxiv.org/abs/2502.16982v1", "title": "Muon is Scalable for LLM Training"}, {"id": "optimizer", "resource": "../projects/code/nanochat/nanochat/optim.py", "title": "Nanochat mixed optimizer", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}]
---

# AdamW versus Muon

## Decision frame

This is not necessarily an either/or choice for a transformer. AdamW naturally
handles arbitrary parameter shapes with adaptive coordinate-wise state; Muon’s
orthogonalization is designed for two-dimensional hidden matrices.

## Comparison

| Dimension | AdamW | Muon |
| --- | --- | --- |
| Update state | First and second moments | Momentum plus matrix orthogonalization/rescaling |
| Natural targets | Embeddings, heads, scalars, matrices | Primarily hidden weight matrices |
| State/compute profile | Extra adaptive moment state | Iterative matrix update transform |
| Scaling evidence | Long-established baseline | Recent LLM scaling results emphasize weight decay and update scale[^muon-paper] |
| Nanochat role | Non-matrix and selected table parameters | Grouped transformer matrices |

Nanochat fuses both into one distributed optimizer and gives each group its own
hyperparameters and communication path.[^optimizer]

## Takeaway

Treat parameter routing as part of the optimizer definition. Comparing “AdamW”
to “Muon” while moving different parameter sets, schedules, or batch scaling
rules confounds the result. Nanochat’s mixed design is an explicit engineering
choice, not a claim that one optimizer dominates every shape.

## Related pages

- [AdamW and Muon optimization](../concepts/adamw-and-muon-optimization.md)
- [Gradient accumulation and distributed training](../concepts/gradient-accumulation-and-distributed-training.md)
- [Compute-optimal training](../concepts/compute-optimal-training.md)

[^muon-paper]: Muon is Scalable for LLM Training
[^optimizer]: Nanochat mixed optimizer
