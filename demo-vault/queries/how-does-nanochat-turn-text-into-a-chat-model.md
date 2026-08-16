---
type: "Query"
title: "How does Nanochat turn text into a chat model?"
description: "A concise answer that follows artifacts and objectives from documents to an assistant checkpoint."
tags: ["language-models", "post-training", "pretraining", "project-nanochat"]
status: "stable"
generated: { "by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z" }
sources: [{"id":"dataset","resource":"../projects/code/nanochat/nanochat/dataset.py","title":"Nanochat dataset loader","commit":"92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"},{"id":"tokenizer","resource":"../projects/code/nanochat/nanochat/tokenizer.py","title":"Nanochat tokenizer","commit":"92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"},{"id":"base","resource":"../projects/code/nanochat/scripts/base_train.py","title":"Nanochat base training","commit":"92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"},{"id":"sft","resource":"../projects/code/nanochat/scripts/chat_sft.py","title":"Nanochat supervised finetuning","commit":"92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}]
---

# How does Nanochat turn text into a chat model?

## Answer

Nanochat first turns a versioned document corpus into token sequences, trains a
causal base model to predict the next token, then continues training from that
checkpoint on conversation-shaped examples whose assistant tokens are selected
by a completion mask. The chat model is therefore a new checkpoint produced by
an additional objective and data mixture, not a UI wrapper around unchanged
base weights.

## Evidence trail

1. The dataset loader downloads and validates ClimbMix shards and reserves
   separate validation data.[^dataset]
2. The tokenizer learns BPE merges and defines stable chat/tool special
   tokens.[^tokenizer]
3. Base training packs token sequences, accumulates distributed gradients, and
   optimizes next-token loss for a configured token budget.[^base]
4. SFT normalizes multiple task datasets into conversations, renders them with
   the tokenizer, masks the target completions, and saves an SFT checkpoint.[^sft]
5. Chat evaluation and the CLI load that named stage. Optional online RL can
   create another checkpoint, but it is not part of the default speedrun.

The longer narrative is the
[end-to-end pipeline](../summaries/nanochat-end-to-end-training-pipeline.md);
the objective transition is covered by
[from pretraining to a chat model](../summaries/from-pretraining-to-chat-model.md).

## Limits

This answer describes the pinned commit and its default path. It does not imply
that the corpus is sufficient for a production assistant, that every downloaded
example receives equal weight, or that optional RL is required for chat.
Hardware-dependent kernels and evaluation settings also affect results.

## Related pages

- [Chat formatting](../concepts/chat-formatting.md)
- [Supervised fine-tuning](../concepts/supervised-fine-tuning.md)
- [Nanochat model family](../entities/nanochat-model-family.md)

[^dataset]: Nanochat dataset loader

[^tokenizer]: Nanochat tokenizer

[^base]: Nanochat base training

[^sft]: Nanochat supervised finetuning
