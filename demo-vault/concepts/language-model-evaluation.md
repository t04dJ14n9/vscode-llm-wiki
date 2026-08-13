---
type: "Concept"
title: "Language-model evaluation"
description: "Separating predictive compression, benchmark capability, chat behavior, and generation inspection."
tags: ["evaluation", "language-models", "reproducibility"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "loss-eval", "resource": "../projects/code/nanochat/nanochat/loss_eval.py", "title": "Nanochat loss evaluation", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}, {"id": "core-eval", "resource": "../projects/code/nanochat/nanochat/core_eval.py", "title": "Nanochat CORE evaluation", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}, {"id": "chat-eval", "resource": "../projects/code/nanochat/scripts/chat_eval.py", "title": "Nanochat chat evaluation", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}]
---

# Language-model evaluation

## Definition

Language-model evaluation is a portfolio of measurements, not one score.
Predictive loss measures compression of held-out text; benchmarks probe selected
capabilities; chat suites test formatted behavior; samples help inspect failure
modes.

## Mechanism

Metrics must bind to a dataset snapshot, prompt/format, checkpoint, and decoding
policy. Nanochat’s distributed loss path aggregates negative log-likelihood and
byte counts for BPB.[^loss-eval] CORE evaluation standardizes a collection of
multiple-choice tasks for base checkpoints.[^core-eval]

## Nanochat connection

Chat evaluation loads a named SFT or RL checkpoint and runs task-specific
generators and graders.[^chat-eval] These layers should not be collapsed: a
change can improve [bits per byte](bits-per-byte.md) while leaving instruction
following unchanged, or change sampling behavior without improving the base
model.

## Related pages

- [Bits per byte](bits-per-byte.md)
- [Nanochat model family](../entities/nanochat-model-family.md)
- [How a reader can reproduce the pipeline](../queries/how-can-a-reader-reproduce-the-pipeline.md)

[^loss-eval]: Nanochat loss evaluation
[^core-eval]: Nanochat CORE evaluation
[^chat-eval]: Nanochat chat evaluation
