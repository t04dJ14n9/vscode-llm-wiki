---
type: "Software Project"
title: "Nanochat"
description: "A minimal, hackable PyTorch system for training, evaluating, and chatting with small language models end to end."
resource: "https://github.com/karpathy/nanochat"
tags: ["language-models", "project-nanochat", "reference"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-24T19:54:04+08:00"}
project_id: "nanochat"
vcs: "git"
repository_url: "https://github.com/karpathy/nanochat.git"
tracked_ref: "master"
observed_revision: "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"
observed_at: "2026-08-24T00:00:00+08:00"
project_status: "reference"
ongoing_change: "Reference baseline for the complete training pipeline; advance the observed revision only after explicit review"
---

# Nanochat

Nanochat is Andrej Karpathy's compact, end-to-end experimental harness for
training small language models. It covers tokenizer training, base-model
pretraining, supervised fine-tuning, reinforcement learning, evaluation, and
KV-cached inference in a deliberately small and hackable PyTorch codebase. Its
goal is to make the complete path from raw text to a chat model understandable,
modifiable, and affordable on a single GPU node.

## Project goals

- Make the complete language-model lifecycle small enough for one person to
  read, run, modify, and reason about.
- Provide a strong experimental baseline for improving small-model capability,
  training efficiency, and inference performance.
- Keep experiments comparable across model scales through a single primary
  complexity dial based on transformer depth.
- Produce an actual conversational model rather than stopping at pretraining.

## System scope

Nanochat treats model development as one connected system:

- **Data and tokenization:** prepare a text corpus, learn a compact vocabulary,
  and convert examples into model-ready sequences.
- **Base-model training:** train a decoder-only transformer from scratch with
  distributed execution and compute-aware model sizing.
- **Post-training:** teach conversation and task formats through supervised
  learning, with optional reinforcement learning for selected abilities.
- **Evaluation:** measure language-model compression, broad capability,
  throughput, memory use, and chat-task performance.
- **Inference:** load a trained checkpoint, reuse attention state during
  generation, sample tokens, and expose the result through interactive chat.

These stages can be studied independently, but the repository's main value is
that they remain mutually compatible and executable as a complete pipeline.

## Design philosophy

Nanochat favors cognitive accessibility over framework generality. Model shape,
optimization, data flow, evaluation, and generation remain explicit rather than
being hidden behind large configuration systems or interchangeable factories.
The codebase is intended to be forked and changed as an experiment, while still
providing a coherent baseline that works from beginning to end.

Model scale is expressed primarily through transformer depth, with related
dimensions and training choices derived consistently. This supports families
of compute-scaled experiments and discourages one-off configurations that only
work at a single size.

## Research use

The central benchmark is time-to-GPT-2: how quickly a newly trained model can
reach or exceed GPT-2-level broad capability. This turns system improvements
across architecture, data, optimization, numerical precision, and hardware use
into a shared measurable objective. Smaller runs support rapid iteration, while
larger runs test whether improvements remain principled across scale.

## Intended environment and limits

The reference workflow targets a single multi-GPU node with modern accelerator
hardware. Single-GPU and CPU or Apple Silicon execution are useful for learning,
debugging, and small experiments, but require lower model scale and longer
runtimes. Nanochat is not intended to be a production serving platform, a
general distributed-training framework, or a catalog of interchangeable model
families.

## Studied baseline

- **Repository:** `https://github.com/karpathy/nanochat.git`
- **Tracked ref:** `master`
- **Observed revision:** `92d63d4e8bb4df75c3b71618f31ddde2378b2bcd`
- **Role in this vault:** a pinned implementation reference for connecting
  higher-level language-model ideas to a complete executable system
- **Update policy:** advancing the checkout does not silently advance this
  card; review the new revision and refresh affected claims first

An ignored checkout or symlink may be bound at `projects/code/nanochat` for
local study. Detailed branch-specific implementation knowledge should live in
a writable repository's `docs/llm-wiki/`; this portable card remains a concise
description of what the repository is, how it is organized, and which exact
revision the vault has studied.
