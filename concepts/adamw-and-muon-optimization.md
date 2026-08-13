---
type: "Concept"
title: "AdamW and Muon optimization"
description: "Nanochat's parameter-aware combination of adaptive AdamW updates and orthogonalized Muon matrix updates."
tags: ["distributed-training", "optimization", "project-nanochat"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "muon-paper", "resource": "https://arxiv.org/abs/2502.16982v1", "title": "Muon is Scalable for LLM Training"}, {"id": "optimizer", "resource": "../projects/code/nanochat/nanochat/optim.py", "title": "Nanochat mixed optimizer", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}, {"id": "gpt-source", "resource": "../projects/code/nanochat/nanochat/gpt.py", "title": "Nanochat GPT parameter grouping", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}]
---

# AdamW and Muon optimization

## Definition

AdamW tracks coordinate-wise first and second moments and applies decoupled
weight decay. Muon starts from momentum updates for matrix parameters and
orthogonalizes/rescales those updates. Scaling studies report that weight decay
and parameter-aware update scale are important when Muon moves beyond small
experiments.[^muon-paper]

## Mechanism

The methods suit different shapes. Embeddings, scalar parameters, and output
tables do not naturally fit the same matrix orthogonalization rule as hidden
weight matrices. A mixed optimizer can therefore route parameter groups to
different update kernels while sharing scheduling and distributed
communication.

## Nanochat connection

Nanochat’s `MuonAdamW` implements fused AdamW groups and stacked/chunked Muon
groups, including distributed reduce-scatter and all-gather paths.[^optimizer]
The GPT configuration routes transformer matrices to Muon and embeddings,
selected scalars, value embeddings, and the language-model head to AdamW with
group-specific learning rates.[^gpt-source]

## Related pages

- [AdamW versus Muon](../comparisons/adamw-vs-muon.md)
- [Gradient accumulation and distributed training](gradient-accumulation-and-distributed-training.md)
- [Low-precision training](low-precision-training.md)

[^muon-paper]: Muon is Scalable for LLM Training
[^optimizer]: Nanochat mixed optimizer
[^gpt-source]: Nanochat GPT parameter grouping
