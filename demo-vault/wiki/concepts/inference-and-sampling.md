---
type: "Concept"
title: "Inference and sampling"
description: "Turning a checkpoint and prompt into tokens through prefill, cached decoding, and a sampling policy."
tags: ["inference", "sampling", "project-nanochat"]
status: "draft"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "engine", "resource": "../../projects/code/nanochat/nanochat/engine.py", "title": "Nanochat generation engine", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "nanochat/engine.py"}, {"id": "chat-cli", "resource": "../../projects/code/nanochat/scripts/chat_cli.py", "title": "Nanochat chat CLI", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/chat_cli.py"}]
created: {"by": "process:project-scope-migration", "at": "2026-08-23T00:00:00Z"}
source_state: "awaiting-source"
relations: [{"target": "concepts/kv-caching.md", "kind": "references", "caption": "KV cache"}, {"target": "concepts/chat-formatting.md", "kind": "references", "caption": "Chat formatting"}, {"target": "concepts/language-model-evaluation.md", "kind": "references", "caption": "Language-model evaluation"}]
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
