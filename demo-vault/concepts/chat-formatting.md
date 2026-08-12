---
type: "Concept"
title: "Chat formatting"
description: "The deterministic mapping between structured conversation messages and model tokens."
tags: ["post-training", "tokenization", "project-nanochat"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "tokenizer", "resource": "../projects/code/nanochat/nanochat/tokenizer.py", "title": "Nanochat tokenizer and conversation rendering", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}, {"id": "chat-sft", "resource": "../projects/code/nanochat/scripts/chat_sft.py", "title": "Nanochat supervised finetuning", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}]
---

# Chat formatting

## Definition

Chat formatting serializes structured messages—roles, content, tool calls, and
boundaries—into a token sequence. It also defines which subsequences are prompt
context and which are supervised completions.

## Mechanism

Special tokens mark message starts/ends and distinguish roles without relying
on fragile natural-language separators. A renderer should be deterministic and
shared by training and inference. Completion masks prevent system/user content
from receiving the same training objective as assistant responses.

## Nanochat connection

Nanochat’s tokenizer owns special-token IDs, conversation rendering, and
assistant completion masks.[^tokenizer] The SFT script consumes those masks
when computing loss across its task mixture.[^chat-sft] This makes
[byte-pair encoding](byte-pair-encoding.md) part of the model interface, while
[supervised fine-tuning](supervised-fine-tuning.md) supplies the behavioral
examples.

## Related pages

- [Byte-pair encoding](byte-pair-encoding.md)
- [Supervised fine-tuning](supervised-fine-tuning.md)
- [How Nanochat turns text into a chat model](../queries/how-does-nanochat-turn-text-into-a-chat-model.md)

[^tokenizer]: Nanochat tokenizer and conversation rendering
[^chat-sft]: Nanochat supervised finetuning
