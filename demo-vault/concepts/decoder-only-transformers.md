---
type: "Concept"
title: "Decoder-only transformers"
description: "Causal transformer stacks that learn next-token distributions and generate autoregressively."
tags: ["architecture", "attention", "language-models", "project-nanochat"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "gpt-source", "resource": "../projects/code/nanochat/nanochat/gpt.py", "title": "Nanochat GPT implementation", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}]
---

# Decoder-only transformers

## Definition

A decoder-only transformer maps a prefix of tokens to a distribution for the
next token. Causal attention prevents position *t* from reading future
positions, so the same network supports parallel training over known sequences
and serial autoregressive generation.

## Mechanism

Tokens become vectors, pass through repeated attention and feed-forward blocks,
and are projected to vocabulary logits. Residual connections preserve a shared
stream across blocks. Normalization, positional treatment, attention head
layout, and MLP design are architectural choices within this general pattern.

## Nanochat connection

Nanochat’s GPT uses token and selected value embeddings, RMS-style
normalization, rotary positions, causal attention, ReLU-squared MLPs, and
configurable sliding/full windows.[^gpt-source] Follow
[grouped-query attention](grouped-query-attention.md) and
[KV caching](kv-caching.md) for the memory behavior of this concrete model.

## Related pages

- [Rotary position embeddings](rotary-position-embeddings.md)
- [Grouped-query attention](grouped-query-attention.md)
- [Nanochat model family](../entities/nanochat-model-family.md)

[^gpt-source]: Nanochat GPT implementation
