---
type: "Concept"
title: "Inference and sampling"
description: "Turning a checkpoint and prompt into tokens through prefill, cached decoding, and a sampling policy."
tags: ["inference", "sampling", "project-nanochat"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "engine", "resource": "../projects/code/nanochat/nanochat/engine.py", "title": "Nanochat generation engine", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}, {"id": "chat-cli", "resource": "../projects/code/nanochat/scripts/chat_cli.py", "title": "Nanochat chat CLI", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}]
---

# Inference and sampling

## Definition

Inference applies a trained checkpoint to a prompt. Autoregressive sampling
repeatedly converts logits into a probability distribution, chooses the next
token, appends it, and stops at a limit or designated token.

## Mechanism

Prompt prefill processes the known sequence in parallel; decode then handles one
new position at a time with a [KV cache](kv-caching.md). Temperature changes
distribution sharpness, top-k limits candidates, and random seeds control
reproducibility. These choices can change observed behavior without changing
weights.

## Nanochat connection

Nanochat’s engine manages prefill/decode caches, active sequences, token
sampling, and stop conditions.[^engine] The CLI selects SFT or RL checkpoints,
renders the conversation with the tokenizer, and exposes interactive or
single-prompt use.[^chat-cli] Evaluation should therefore record both
checkpoint stage and decode policy.

## Related pages

- [KV caching](kv-caching.md)
- [Chat formatting](chat-formatting.md)
- [Language-model evaluation](language-model-evaluation.md)

[^engine]: Nanochat generation engine
[^chat-cli]: Nanochat chat CLI
