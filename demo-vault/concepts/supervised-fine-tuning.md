---
type: "Concept"
title: "Supervised fine-tuning"
description: "Updating a pretrained model on examples of desired prompts, conversations, and responses."
tags: ["alignment", "post-training", "small-models"]
status: "draft"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "smollm2-paper", "resource": "../raw/smollm2-when-smol-goes-big-data-centric-training-of-a-small-language-model.md", "title": "SmolLM2"}, {"id": "chat-sft", "resource": "../projects/code/nanochat/scripts/chat_sft.py", "title": "Nanochat supervised finetuning", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/chat_sft.py"}]
created: {"by": "process:project-scope-migration", "at": "2026-08-23T00:00:00Z"}
source_state: "awaiting-source"
---

# Supervised fine-tuning

## Definition

Supervised fine-tuning (SFT) continues next-token training on curated examples
that demonstrate a target behavior, such as answering an instruction in a
conversation. Small-model reports such as SmolLM2 emphasize that the
post-training data mixture is a major part of the resulting assistant.[^smollm2-paper]

## Mechanism

Examples from different tasks are normalized into a shared message schema,
rendered into tokens, and paired with a mask identifying which completions
should contribute to loss. Mixing ratios, truncation, masking, and chat
serialization are therefore training choices, not presentation details.

## Nanochat connection

Nanochat’s SFT script builds a multi-task mixture, initializes from the base
checkpoint, computes completion-masked loss, accumulates gradients, evaluates,
and writes a distinct SFT checkpoint.[^chat-sft] The serialization itself is
described under [chat formatting](chat-formatting.md); the optional next stage
is [preference and policy optimization](preference-and-policy-optimization.md).

## Related pages

- [SmolLM2 and SmolTalk](../entities/smollm2-and-smoltalk.md)
- [From pretraining to a chat model](../summaries/from-pretraining-to-chat-model.md)
- [Chat formatting](chat-formatting.md)

[^smollm2-paper]: SmolLM2
[^chat-sft]: Nanochat supervised finetuning
