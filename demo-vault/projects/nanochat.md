---
type: "Software Project"
title: "Nanochat"
description: "An exact-commit snapshot of Karpathy's compact end-to-end language-model training and inference harness."
resource: "https://github.com/karpathy/nanochat"
tags: ["language-models", "project-nanochat", "reproducibility", "training-systems"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "nanochat-repository", "resource": "https://github.com/karpathy/nanochat", "title": "Nanochat repository"}]
repository_url: "https://github.com/karpathy/nanochat.git"
default_branch: "master"
pinned_commit: "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"
commit_date: "2026-07-03T22:54:57Z"
license: "MIT"
source_path: "code/nanochat"
---

# Nanochat

Nanochat is the implementation anchor for this wiki: a deliberately compact
PyTorch repository that spans tokenizer training, base-model pretraining,
evaluation, supervised chat finetuning, optional on-policy reinforcement
learning, inference, and an interactive CLI.[^nanochat-repository]

![[projects/code/nanochat/dev/nanochat.png|Nanochat logo]]

## Pinned revision

This bundle indexes commit
`92d63d4e8bb4df75c3b71618f31ddde2378b2bcd` (`clean up fragile code`),
committed on 2026-07-03. The submodule is evidence, not a fork: do not edit its
files to satisfy the outer OKF profile.

- Repository: [karpathy/nanochat](https://github.com/karpathy/nanochat)
- Local source: [upstream README](code/nanochat/README.md)
- License: [MIT](code/nanochat/LICENSE)

Initialize it after cloning:

```bash
git submodule update --init --recursive
```

## Start with the pipeline

[`runs/speedrun.sh`](code/nanochat/runs/speedrun.sh) is the shortest executable
tour. At this revision it downloads the current pretraining shards, trains and
evaluates a 32,768-token BPE tokenizer, pretrains and evaluates a depth-24 base
model across eight GPUs, then performs supervised chat finetuning and chat
evaluation.

The script intentionally does not run every optional stage. In particular,
[`scripts/chat_rl.py`](code/nanochat/scripts/chat_rl.py) provides a separate
on-policy GSM8K reinforcement-learning stage, and
[`scripts/chat_cli.py`](code/nanochat/scripts/chat_cli.py) loads either an SFT
or RL checkpoint for conversation.

## Source map

| Question | Primary source |
| --- | --- |
| How is the tokenizer trained and conversations rendered? | [`nanochat/tokenizer.py`](code/nanochat/nanochat/tokenizer.py), [`scripts/tok_train.py`](code/nanochat/scripts/tok_train.py) |
| Where do pretraining documents come from? | [`nanochat/dataset.py`](code/nanochat/nanochat/dataset.py) |
| How are documents packed across ranks? | [`nanochat/dataloader.py`](code/nanochat/nanochat/dataloader.py) |
| What is the transformer architecture? | [`nanochat/gpt.py`](code/nanochat/nanochat/gpt.py) |
| How are attention kernels selected? | [`nanochat/flash_attention.py`](code/nanochat/nanochat/flash_attention.py) |
| How are AdamW and Muon combined? | [`nanochat/optim.py`](code/nanochat/nanochat/optim.py) |
| How is base training configured? | [`scripts/base_train.py`](code/nanochat/scripts/base_train.py) |
| How are compression and capability measured? | [`nanochat/loss_eval.py`](code/nanochat/nanochat/loss_eval.py), [`nanochat/core_eval.py`](code/nanochat/nanochat/core_eval.py) |
| How does supervised chat training work? | [`scripts/chat_sft.py`](code/nanochat/scripts/chat_sft.py) |
| How does optional RL work? | [`scripts/chat_rl.py`](code/nanochat/scripts/chat_rl.py) |
| How does cached autoregressive generation work? | [`nanochat/engine.py`](code/nanochat/nanochat/engine.py) |
| What tasks evaluate the chat model? | [`scripts/chat_eval.py`](code/nanochat/scripts/chat_eval.py), [`tasks/`](code/nanochat/tasks/) |

## Wiki orientation

Read the [end-to-end training summary](/summaries/nanochat-end-to-end-training-pipeline)
for a narrative, then use [where the paper ideas appear in Nanochat](../queries/where-do-the-paper-ideas-appear-in-nanochat.md)
to jump between research evidence and exact implementation files.
The [code index](code/index.md) is the progressive-disclosure entry point into
the pinned submodule.

The project is a moving experimental baseline. This wiki describes only the
pinned revision; later upstream behavior is not silently projected backward
onto this source snapshot.

[^nanochat-repository]: Nanochat repository
