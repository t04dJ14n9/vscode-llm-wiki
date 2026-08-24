---
type: "Summary"
title: "Nanochat end-to-end training pipeline"
description: "A reader-first tour from raw text and tokenizer training to a conversational Nanochat checkpoint."
tags: ["language-models", "pretraining", "post-training", "project-nanochat", "training-systems"]
status: "draft"
code_scope: true
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "speedrun", "resource": "../../code/nanochat/runs/speedrun.sh", "title": "Nanochat speedrun", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "runs/speedrun.sh"}, {"id": "tokenizer", "resource": "../../code/nanochat/nanochat/tokenizer.py", "title": "Nanochat tokenizer implementation", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "nanochat/tokenizer.py"}, {"id": "base-train", "resource": "../../code/nanochat/scripts/base_train.py", "title": "Nanochat base training script", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/base_train.py"}, {"id": "chat-sft", "resource": "../../code/nanochat/scripts/chat_sft.py", "title": "Nanochat supervised finetuning script", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/chat_sft.py"}]
source_state: "awaiting-source"
---

# Nanochat end-to-end training pipeline

## Scope

Nanochat is useful because it keeps an entire small-language-model lifecycle in
one inspectable repository. Its speedrun is an executable map, not merely an
installation example: obtain pretraining shards, train and evaluate a tokenizer,
pretrain a base model, evaluate it, supervised-finetune it for conversation, and
evaluate the resulting chat model.[^speedrun]

This page explains the default path at the pinned commit. Optional scaling-law,
reinforcement-learning, and inference experiments are covered by
[from pretraining to a chat model](../../../summaries/from-pretraining-to-chat-model.md) and the
[reproducibility query](../queries/how-can-a-reader-reproduce-the-pipeline.md).

## Pipeline

1. `nanochat.dataset` downloads ClimbMix shards. The speedrun starts with eight
   shards for tokenizer work while a larger download continues in the
   background.
2. `scripts.tok_train` learns a 32,768-token byte-pair vocabulary. Nanochat uses
   RustBPE for training and a tiktoken-compatible representation for fast
   encoding; it also reserves tokens used to delimit conversations and tool
   interactions.[^tokenizer]
3. `scripts.base_train` derives model width, head count, batch accumulation, and
   a token budget from its configuration. The default training implementation
   combines distributed data loading, mixed Muon/AdamW optimization, learning
   rate schedules, periodic validation, and checkpointing.[^base-train]
4. `scripts.base_eval` reports validation compression, CORE task results, and
   sample generations. This deliberately separates next-token-model quality
   from chat behavior.
5. `scripts.chat_sft` mixes conversation-shaped tasks, masks non-assistant
   portions of examples, restores the pretrained optimizer configuration, and
   trains the model to respond in the chat format.[^chat-sft]
6. `scripts.chat_eval` evaluates the SFT checkpoint. The optional RL stage and
   interactive CLI are separate, so a reader can compare base, SFT, and RL
   artifacts rather than treating “the model” as a single undifferentiated file.

## Evidence boundary

The pipeline above describes commit
`92d63d4e8bb4df75c3b71618f31ddde2378b2bcd`. It does not claim that the
speedrun is compute-optimal, that its optional kernels work on every GPU, or that
the resulting model matches current hosted systems. The shell script targets an
eight-H100 environment and intentionally omits the optional RL step.

Paper pages in `raw/` explain individual ideas, while the pinned code is the
authority for what Nanochat actually does. In particular, a paper’s technique
should not be projected onto Nanochat unless the source map in
[where paper ideas appear](../queries/where-do-the-paper-ideas-appear-in-nanochat.md)
identifies a concrete implementation.

## Related pages

- [How Nanochat turns text into a chat model](../queries/how-does-nanochat-turn-text-into-a-chat-model.md)
- [Byte-pair encoding](../../../concepts/byte-pair-encoding.md)
- [Pretraining data curation](../../../concepts/pretraining-data-curation.md)
- [Gradient accumulation and distributed training](../../../concepts/gradient-accumulation-and-distributed-training.md)
- [Language-model evaluation](../../../concepts/language-model-evaluation.md)

[^speedrun]: Nanochat speedrun
[^tokenizer]: Nanochat tokenizer implementation
[^base-train]: Nanochat base training script
[^chat-sft]: Nanochat supervised finetuning script
