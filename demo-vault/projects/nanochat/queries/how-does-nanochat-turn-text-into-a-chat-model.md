---
type: "Query"
title: "How does Nanochat turn text into a chat model?"
description: "A concise answer that follows artifacts and objectives from documents to an assistant checkpoint."
tags: ["language-models", "post-training", "pretraining", "project-nanochat"]
status: "draft"
code_scope: true
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "dataset", "resource": "../../code/nanochat/nanochat/dataset.py", "title": "Nanochat dataset loader", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "nanochat/dataset.py"}, {"id": "tokenizer", "resource": "../../code/nanochat/nanochat/tokenizer.py", "title": "Nanochat tokenizer", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "nanochat/tokenizer.py"}, {"id": "base", "resource": "../../code/nanochat/scripts/base_train.py", "title": "Nanochat base training", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/base_train.py"}, {"id": "sft", "resource": "../../code/nanochat/scripts/chat_sft.py", "title": "Nanochat supervised finetuning", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/chat_sft.py"}]
source_state: "awaiting-source"
condensed_summary: "A concise answer that follows artifacts and objectives from documents to an assistant checkpoint."
project: "nanochat"
conversation: {"selection_id": "migration-2026-08-23-how-does-nanochat-turn-text-into-a-chat-model"}
anchors: [{"source_id": "dataset", "kind": "code", "resource": "../../code/nanochat/nanochat/dataset.py", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "nanochat/dataset.py", "start_line": 1, "end_line": 1}, {"source_id": "tokenizer", "kind": "code", "resource": "../../code/nanochat/nanochat/tokenizer.py", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "nanochat/tokenizer.py", "start_line": 1, "end_line": 1}, {"source_id": "base", "kind": "code", "resource": "../../code/nanochat/scripts/base_train.py", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/base_train.py", "start_line": 1, "end_line": 1}, {"source_id": "sft", "kind": "code", "resource": "../../code/nanochat/scripts/chat_sft.py", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/chat_sft.py", "start_line": 1, "end_line": 1}]
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
[from pretraining to a chat model](../../../summaries/from-pretraining-to-chat-model.md).

## Limits

This answer describes the pinned commit and its default path. It does not imply
that the corpus is sufficient for a production assistant, that every downloaded
example receives equal weight, or that optional RL is required for chat.
Hardware-dependent kernels and evaluation settings also affect results.

## Related pages

- [Chat formatting](../../../concepts/chat-formatting.md)
- [Supervised fine-tuning](../../../concepts/supervised-fine-tuning.md)
- [Nanochat model family](../entities/nanochat-model-family.md)

[^dataset]: Nanochat dataset loader

[^tokenizer]: Nanochat tokenizer

[^base]: Nanochat base training

[^sft]: Nanochat supervised finetuning
