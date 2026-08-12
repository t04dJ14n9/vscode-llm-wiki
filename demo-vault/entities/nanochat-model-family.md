---
type: "Entity"
title: "Nanochat model family"
description: "The base, SFT, and optional RL checkpoints produced by the pinned Nanochat repository."
tags: ["language-models", "post-training", "pretraining", "project-nanochat", "small-models"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "readme", "resource": "../projects/code/nanochat/README.md", "title": "Nanochat README", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}, {"id": "checkpoint", "resource": "../projects/code/nanochat/nanochat/checkpoint_manager.py", "title": "Nanochat checkpoint manager", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}]
---

# Nanochat model family

## What it is

“Nanochat” names a training system and a sequence of artifacts rather than one
fixed set of weights. The repository describes a base model trained from
scratch, an SFT chat checkpoint, and an optional reinforcement-learned
checkpoint, with scripts for evaluating and chatting with each relevant
stage.[^readme]

## Why it matters

Keeping the stages separate prevents ambiguous model claims. Compression loss
belongs to the base model; conversation and tool formatting belong to SFT;
reward-driven changes belong to the optional RL stage. A result should always
identify its checkpoint and evaluation protocol.

## Nanochat relevance

The checkpoint manager stores and reloads model configuration alongside weights
and handles backward-compatible configuration defaults.[^checkpoint] The
[pipeline summary](../summaries/nanochat-end-to-end-training-pipeline.md)
explains how those checkpoints are produced, while
[inference and sampling](../concepts/inference-and-sampling.md) explains how a
chosen checkpoint becomes generated text.

## Related pages

- [From pretraining to a chat model](../summaries/from-pretraining-to-chat-model.md)
- [Language-model evaluation](../concepts/language-model-evaluation.md)
- [How Nanochat turns text into a chat model](../queries/how-does-nanochat-turn-text-into-a-chat-model.md)

[^readme]: Nanochat README
[^checkpoint]: Nanochat checkpoint manager
