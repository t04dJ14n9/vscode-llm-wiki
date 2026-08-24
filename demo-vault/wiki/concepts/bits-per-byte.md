---
type: "Concept"
title: "Bits per byte"
description: "A tokenizer-aware language-model compression metric normalized by underlying UTF-8 bytes."
tags: ["evaluation", "language-models", "tokenization"]
status: "draft"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-24T20:14:36+08:00"}
sources: [{"id": "loss-eval", "resource": "../../projects/code/nanochat/nanochat/loss_eval.py", "title": "Nanochat loss evaluation", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "nanochat/loss_eval.py"}, {"id": "tok-eval", "resource": "../../projects/code/nanochat/scripts/tok_eval.py", "title": "Nanochat tokenizer evaluation", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "scripts/tok_eval.py"}]
created: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
source_state: "awaiting-source"
relations: [{"target": "concepts/language-model-evaluation.md", "kind": "references", "caption": "evaluation layer"}, {"target": "concepts/byte-pair-encoding.md", "kind": "references", "caption": "Byte-pair encoding"}]
---

# Bits per byte

## Definition

Bits per byte (BPB) expresses predictive cross-entropy as the average number of
bits needed per byte of original text. Normalizing by UTF-8 bytes makes results
less sensitive to how a tokenizer segments the same content.

## Mechanism

Token loss is accumulated over predictions, converted from natural-log units to
bits, and divided by the bytes represented by the evaluated tokens. Nanochat’s
loss evaluator carries byte counts alongside tokens so distributed evaluation
can aggregate the correct numerator and denominator.[^loss-eval]

## Nanochat connection

Tokenizer evaluation separately reports compression characteristics over
ClimbMix and reference text.[^tok-eval] BPB then lets base-model evaluation
compare runs even when tokenization changes. It does not replace capability
benchmarks; it complements the task-oriented
[evaluation layer](language-model-evaluation.md).

## Related pages

- [Byte-pair encoding](byte-pair-encoding.md)
- [Language-model evaluation](language-model-evaluation.md)

[^loss-eval]: Nanochat loss evaluation
[^tok-eval]: Nanochat tokenizer evaluation
