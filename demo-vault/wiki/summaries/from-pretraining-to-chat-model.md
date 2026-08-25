---
type: "Summary"
title: "From pretraining to a chat model"
description: "The behavioral transition from next-token prediction through supervised chat training and optional online reinforcement learning."
tags: ["alignment", "post-training", "pretraining", "project-nanochat", "reinforcement-learning"]
status: "draft"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-24T20:14:36+08:00"}
sources: [{"id": "base", "resource": "../../projects/code/nanochat/scripts/base_train.py", "title": "Nanochat base training", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/base_train.py"}, {"id": "sft", "resource": "../../projects/code/nanochat/scripts/chat_sft.py", "title": "Nanochat supervised finetuning", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/chat_sft.py"}, {"id": "rl", "resource": "../../projects/code/nanochat/scripts/chat_rl.py", "title": "Nanochat on-policy reinforcement learning", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/chat_rl.py"}, {"id": "engine", "resource": "../../projects/code/nanochat/nanochat/engine.py", "title": "Nanochat generation engine", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "nanochat/engine.py"}]
source_state: "awaiting-source"
relations: [{"target": "comparisons/dpo-vs-on-policy-reinforcement-learning.md", "kind": "references", "caption": "Links to DPO versus on-policy reinforcement learning"}, {"target": "concepts/supervised-fine-tuning.md", "kind": "references", "caption": "Links to Supervised fine-tuning"}, {"target": "concepts/chat-formatting.md", "kind": "references", "caption": "Links to Chat formatting"}, {"target": "concepts/preference-and-policy-optimization.md", "kind": "references", "caption": "Links to Preference and policy optimization"}, {"target": "concepts/inference-and-sampling.md", "kind": "references", "caption": "Links to Inference and sampling"}]
---

# From pretraining to a chat model

Nanochat does not turn a base model into a chat model with one training switch.
Chat behavior emerges from four separate contracts: pretraining learns token
continuation, SFT teaches conversational responses, optional on-policy RL
rewards a narrow behavior, and inference decides how the trained checkpoint is
actually sampled. Keeping these stages separate makes it possible to say what
changed, which checkpoint is being evaluated, and where a behavior came from.

## Four stages, four responsibilities

Base training optimizes next-token cross-entropy over pretraining sequences. Its
batch is expressed in tokens, accumulated across devices and microsteps, and the
run duration is derived from a target parameter-to-data ratio.[^base] The
resulting checkpoint is still a language model, not yet evidence of
instruction-following behavior.

Supervised finetuning then renders heterogeneous tasks into a common
conversation format. Its completion mask excludes prompt/system tokens from the
training objective where appropriate, so the model is trained on the response
behavior rather than simply copying the entire serialized dialogue.[^sft] This
is Nanochat's main transition from a base checkpoint to its default chat
checkpoint.

The optional RL script samples multiple answers to GSM8K-style problems,
extracts final answers, assigns correctness rewards, subtracts the group mean,
and updates the policy from those on-policy samples.[^rl] It calls itself
GRPO-inspired but deliberately omits a reference-policy KL term and PPO-style
ratio clipping. That makes the
[DPO/on-policy comparison](../comparisons/dpo-vs-on-policy-reinforcement-learning.md)
especially important.

Finally, the generation engine separates prompt prefill from token-by-token
decode, maintains KV caches, applies sampling controls, and stops on configured
tokens.[^engine] Chat behavior is therefore the product of data formatting,
training objectives, checkpoint choice, and inference policy.

## What this account does not claim

This staged account does not imply that SFT always precedes every possible RL
method, nor that Nanochat’s simplified math-reward loop is a general alignment
recipe. It describes the pinned repository. Evaluation results must name the
checkpoint stage and decoding setup; otherwise base, SFT, and RL behavior are
easy to conflate.

## Related pages

- [Supervised finetuning](../concepts/supervised-fine-tuning.md)
- [Chat formatting](../concepts/chat-formatting.md)
- [Preference and policy optimization](../concepts/preference-and-policy-optimization.md)
- [Inference and sampling](../concepts/inference-and-sampling.md)

[^base]: Nanochat base training
[^sft]: Nanochat supervised finetuning
[^rl]: Nanochat on-policy reinforcement learning
[^engine]: Nanochat generation engine
