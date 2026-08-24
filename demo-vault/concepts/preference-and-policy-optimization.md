---
type: "Concept"
title: "Preference and policy optimization"
description: "Post-training objectives that alter a model using preference pairs or rewards from sampled behavior."
tags: ["alignment", "post-training", "reinforcement-learning"]
status: "draft"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "dpo-paper", "resource": "../raw/direct-preference-optimization-your-language-model-is-secretly-a-reward-model.md", "title": "Direct Preference Optimization"}, {"id": "deepseekmath", "resource": "https://arxiv.org/abs/2402.03300v3", "title": "DeepSeekMath"}, {"id": "chat-rl", "resource": "../projects/code/nanochat/scripts/chat_rl.py", "title": "Nanochat on-policy reinforcement learning", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/chat_rl.py"}]
created: {"by": "process:project-scope-migration", "at": "2026-08-23T00:00:00Z"}
source_state: "awaiting-source"
---

# Preference and policy optimization

## Definition

Preference optimization learns from relative judgments between responses;
online policy optimization samples behavior, scores it with a reward, and
updates the policy from those samples. DPO derives a classification-style
objective over preferred/rejected pairs relative to a reference policy.[^dpo-paper]
DeepSeekMath introduces GRPO, which estimates relative advantages within sampled
groups while avoiding a learned value model.[^deepseekmath]

## Mechanism

The methods require different evidence. DPO needs preference pairs and reference
log-probabilities. On-policy methods need a sampler, reward function, and a
careful definition of advantage and update constraints. Labels such as “RLHF”
or “GRPO” are too broad to identify the actual objective.

## Nanochat connection

Nanochat samples groups of GSM8K completions, rewards exact answers, subtracts
the group mean, and applies a token-normalized policy-gradient-style loss. Its
comments explicitly omit KL regularization and PPO ratio clipping.[^chat-rl]
The precise distinction is captured in
[DPO versus on-policy RL](../comparisons/dpo-vs-on-policy-reinforcement-learning.md).

## Related pages

- [From pretraining to a chat model](../summaries/from-pretraining-to-chat-model.md)
- [Supervised fine-tuning](supervised-fine-tuning.md)
- [DPO versus on-policy reinforcement learning](../comparisons/dpo-vs-on-policy-reinforcement-learning.md)

[^dpo-paper]: Direct Preference Optimization
[^deepseekmath]: DeepSeekMath
[^chat-rl]: Nanochat on-policy reinforcement learning
