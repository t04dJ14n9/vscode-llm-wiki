---
type: "Entity"
title: "SmolLM2 and SmolTalk"
description: "A small-model training recipe and the instruction-data family represented in Nanochat's task mixture."
tags: ["datasets", "post-training", "small-models", "training-systems"]
status: "draft"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-24T20:14:36+08:00"}
sources: [{"id": "smollm2-paper", "resource": "../../raw/smollm2-when-smol-goes-big-data-centric-training-of-a-small-language-model.md", "title": "SmolLM2"}, {"id": "smoltalk-task", "resource": "../../projects/code/nanochat/tasks/smoltalk.py", "title": "Nanochat SmolTalk task adapter", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "tasks/smoltalk.py"}]
created: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
source_state: "awaiting-source"
relations: [{"target": "concepts/supervised-fine-tuning.md", "kind": "references", "caption": "Supervised finetuning"}, {"target": "concepts/chat-formatting.md", "kind": "references", "caption": "Chat formatting"}]
---

# SmolLM2 and SmolTalk

## What it is

SmolLM2 is a family of compact language models whose report emphasizes
data-centric staged pretraining and post-training. SmolTalk is the associated
instruction-data family used to teach conversational and task-following
behavior.[^smollm2-paper]

## Why it matters

Small models expose tradeoffs quickly: weak data mixtures, tokenization, or
post-training cannot be hidden by scale. The report is therefore a useful
companion to Nanochat’s goal of making an end-to-end model affordable enough to
inspect.

## Nanochat relevance

Nanochat includes a SmolTalk task adapter that loads individual configurations,
normalizes message structures, and exposes them to the shared task interface
used by supervised finetuning.[^smoltalk-task] That is a concrete data
integration, not evidence that Nanochat reproduces the complete SmolLM2
training recipe.

## Related pages

- [Supervised finetuning](../concepts/supervised-fine-tuning.md)
- [Chat formatting](../concepts/chat-formatting.md)
- [From pretraining to a chat model](../summaries/from-pretraining-to-chat-model.md)

[^smollm2-paper]: SmolLM2
[^smoltalk-task]: Nanochat SmolTalk task adapter
