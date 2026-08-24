---
type: "Summary"
title: "From pretraining to a chat model"
description: "The behavioral transition from next-token prediction through supervised chat training and optional online reinforcement learning."
tags: ["alignment", "post-training", "pretraining", "project-nanochat", "reinforcement-learning"]
status: "draft"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "base", "resource": "../projects/code/nanochat/scripts/base_train.py", "title": "Nanochat base training", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/base_train.py"}, {"id": "sft", "resource": "../projects/code/nanochat/scripts/chat_sft.py", "title": "Nanochat supervised finetuning", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/chat_sft.py"}, {"id": "rl", "resource": "../projects/code/nanochat/scripts/chat_rl.py", "title": "Nanochat on-policy reinforcement learning", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/chat_rl.py"}, {"id": "engine", "resource": "../projects/code/nanochat/nanochat/engine.py", "title": "Nanochat generation engine", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "nanochat/engine.py"}]
source_state: "awaiting-source"
---

# From pretraining to a chat model

## Scope

Pretraining makes a model predict continuation tokens across packed documents;
it does not by itself define roles, decide which tokens should contribute to a
conversation loss, or guarantee instruction-following behavior. Nanochat keeps
those responsibilities in distinct scripts and checkpoints.

## Pipeline

Base training optimizes next-token cross-entropy over pretraining sequences. Its
batch is expressed in tokens, accumulated across devices and microsteps, and the
run duration is derived from a target parameter-to-data ratio.[^base] The
resulting checkpoint is evaluated as a language model before any chat-specific
claims are made.

Supervised finetuning then renders heterogeneous tasks into a common
conversation format. Its completion mask excludes prompt/system tokens from the
training objective where appropriate, so the model is trained on the response
behavior rather than simply copying the entire serialized dialogue.[^sft] This
is the main transition from a base checkpoint to the default chat checkpoint.

The optional RL script samples multiple answers to GSM8K-style problems,
extracts final answers, assigns correctness rewards, subtracts the group mean,
and updates the policy from those on-policy samples.[^rl] It calls itself
GRPO-inspired but deliberately omits a reference-policy KL term and PPO-style
ratio clipping. That makes the
[DPO/on-policy comparison](../wiki/comparisons/dpo-vs-on-policy-reinforcement-learning.md)
especially important.

Finally, the generation engine separates prompt prefill from token-by-token
decode, maintains KV caches, applies sampling controls, and stops on configured
tokens.[^engine] Chat behavior is therefore the product of data formatting,
training objectives, checkpoint choice, and inference policy.

## Evidence boundary

This staged account does not imply that SFT always precedes every possible RL
method, nor that Nanochat’s simplified math-reward loop is a general alignment
recipe. It describes the pinned repository. Evaluation results must name the
checkpoint stage and decoding setup; otherwise base, SFT, and RL behavior are
easy to conflate.

## Related pages

- [Supervised finetuning](../wiki/concepts/supervised-fine-tuning.md)
- [Chat formatting](../wiki/concepts/chat-formatting.md)
- [Preference and policy optimization](../wiki/concepts/preference-and-policy-optimization.md)
- [Inference and sampling](../wiki/concepts/inference-and-sampling.md)

[^base]: Nanochat base training
[^sft]: Nanochat supervised finetuning
[^rl]: Nanochat on-policy reinforcement learning
[^engine]: Nanochat generation engine
