---
type: "Query"
title: "Why does Nanochat use bits per byte?"
description: "Why byte-normalized compression is more comparable than token loss when tokenization can change."
tags: ["evaluation", "language-models", "tokenization"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "loss-eval", "resource": "../projects/code/nanochat/nanochat/loss_eval.py", "title": "Nanochat loss evaluation", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}, {"id": "tok-eval", "resource": "../projects/code/nanochat/scripts/tok_eval.py", "title": "Nanochat tokenizer evaluation", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}]
---

# Why does Nanochat use bits per byte?

## Answer

Because average loss per token changes when the tokenizer changes. One
tokenizer may split the same sentence into many short tokens and another into
fewer long tokens; their token-level losses are not directly comparable. Bits
per byte normalizes predictive information by the UTF-8 content underneath the
tokens.

## Evidence trail

Nanochat’s evaluator computes token negative log-likelihood while tracking the
number of bytes represented, then aggregates both quantities across distributed
ranks.[^loss-eval] Tokenizer evaluation separately reports compression behavior
on training, validation, and reference text.[^tok-eval] Together they answer two
different questions:

- How compactly does the tokenizer represent text?
- How well does the model predict that text after normalizing away segmentation?

See [bits per byte](../concepts/bits-per-byte.md) for the formula and
[byte-pair encoding](../concepts/byte-pair-encoding.md) for why segmentation
varies.

## Limits

BPB still depends on the evaluated text distribution and byte encoding. It does
not measure factuality, reasoning, helpfulness, or chat-format compliance. A
complete report needs [capability and chat evaluation](../concepts/language-model-evaluation.md)
as well.

## Related pages

- [Bits per byte](../concepts/bits-per-byte.md)
- [Byte-pair encoding](../concepts/byte-pair-encoding.md)
- [Language-model evaluation](../concepts/language-model-evaluation.md)

[^loss-eval]: Nanochat loss evaluation
[^tok-eval]: Nanochat tokenizer evaluation
