---
type: "Comparison"
title: "DPO versus on-policy reinforcement learning"
description: "Offline preference-pair optimization compared with Nanochat's reward-driven online sampling loop."
tags: ["alignment", "post-training", "reinforcement-learning"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "dpo-paper", "resource": "../raw/direct-preference-optimization-your-language-model-is-secretly-a-reward-model.md", "title": "Direct Preference Optimization"}, {"id": "deepseekmath", "resource": "https://arxiv.org/abs/2402.03300v3", "title": "DeepSeekMath"}, {"id": "chat-rl", "resource": "../projects/code/nanochat/scripts/chat_rl.py", "title": "Nanochat on-policy reinforcement learning", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}]
---

# DPO versus on-policy reinforcement learning

## Decision frame

The key question is what feedback exists. If the dataset contains preferred and
rejected responses, DPO offers an offline objective. If behavior can be sampled
and scored, an on-policy loop can optimize observed rewards.

## Comparison

| Dimension | DPO | Nanochat optional RL |
| --- | --- | --- |
| Data | Fixed preference pairs | Fresh groups of sampled completions |
| Feedback | Chosen versus rejected response | Exact-answer reward |
| Reference | Reference-policy term in derived objective[^dpo-paper] | No KL/reference-policy penalty in the pinned script |
| Relative signal | Pairwise preference | Reward minus group mean |
| Update constraints | Logistic preference objective | Simplified policy-gradient-like loss |

DeepSeekMath’s GRPO is relevant ancestry for relative group advantages,[^deepseekmath]
but Nanochat explicitly removes several PPO/GRPO stabilizers. Its loop samples
GSM8K answers, grades them, normalizes rewards within the group, and optimizes
generated tokens.[^chat-rl]

## Takeaway

Do not call Nanochat’s stage DPO, and do not infer full GRPO from the phrase
“GRPO-inspired.” Describe the sampled data, reward, normalization, KL term,
clipping, and loss. That is the reproducible algorithm.

## Related pages

- [Preference and policy optimization](../concepts/preference-and-policy-optimization.md)
- [From pretraining to a chat model](../summaries/from-pretraining-to-chat-model.md)
- [Supervised fine-tuning](../concepts/supervised-fine-tuning.md)

[^dpo-paper]: Direct Preference Optimization
[^deepseekmath]: DeepSeekMath
[^chat-rl]: Nanochat on-policy reinforcement learning
