---
type: "Query"
title: "Where do the paper ideas appear in Nanochat?"
description: "A claim-safe map from the mirrored research corpus to concrete code or explicit non-use."
tags: ["paper", "project-nanochat", "provenance", "reproducibility"]
status: "stable"
code_scope: true
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "bpe", "resource": "../../../raw/neural-machine-translation-of-rare-words-with-subword-units.md", "title": "Neural Machine Translation of Rare Words with Subword Units"}, {"id": "fineweb", "resource": "../../../raw/the-fineweb-datasets-decanting-the-web-for-the-finest-text-data-at-scale.md", "title": "The FineWeb Datasets"}, {"id": "dclm", "resource": "../../../raw/datacomp-lm-in-search-of-the-next-generation-of-training-sets-for-language-models.md", "title": "DataComp-LM"}, {"id": "smollm2", "resource": "../../../raw/smollm2-when-smol-goes-big-data-centric-training-of-a-small-language-model.md", "title": "SmolLM2"}, {"id": "gqa", "resource": "../../../raw/gqa-training-generalized-multi-query-transformer-models-from-multi-head-checkpoints.md", "title": "GQA"}, {"id": "fa3", "resource": "../../../raw/flashattention-3-fast-and-accurate-attention-with-asynchrony-and-low-precision.md", "title": "FlashAttention-3"}, {"id": "fp8", "resource": "../../../raw/fp8-formats-for-deep-learning.md", "title": "FP8 Formats for Deep Learning"}, {"id": "dpo", "resource": "../../../raw/direct-preference-optimization-your-language-model-is-secretly-a-reward-model.md", "title": "Direct Preference Optimization"}, {"id": "project", "resource": "../README.md", "title": "Nanochat project-vault overview"}]
condensed_summary: "A claim-safe map from the mirrored research corpus to concrete code or explicit non-use."
project: "nanochat"
conversation: {"selection_id": "migration-2026-08-23-where-do-the-paper-ideas-appear-in-nanochat"}
anchors: [{"source_id": "bpe", "kind": "markdown", "resource": "../../../raw/neural-machine-translation-of-rare-words-with-subword-units.md", "start_line": 1, "end_line": 1}, {"source_id": "fineweb", "kind": "markdown", "resource": "../../../raw/the-fineweb-datasets-decanting-the-web-for-the-finest-text-data-at-scale.md", "start_line": 1, "end_line": 1}, {"source_id": "dclm", "kind": "markdown", "resource": "../../../raw/datacomp-lm-in-search-of-the-next-generation-of-training-sets-for-language-models.md", "start_line": 1, "end_line": 1}, {"source_id": "smollm2", "kind": "markdown", "resource": "../../../raw/smollm2-when-smol-goes-big-data-centric-training-of-a-small-language-model.md", "start_line": 1, "end_line": 1}, {"source_id": "gqa", "kind": "markdown", "resource": "../../../raw/gqa-training-generalized-multi-query-transformer-models-from-multi-head-checkpoints.md", "start_line": 1, "end_line": 1}, {"source_id": "fa3", "kind": "markdown", "resource": "../../../raw/flashattention-3-fast-and-accurate-attention-with-asynchrony-and-low-precision.md", "start_line": 1, "end_line": 1}, {"source_id": "fp8", "kind": "markdown", "resource": "../../../raw/fp8-formats-for-deep-learning.md", "start_line": 1, "end_line": 1}, {"source_id": "dpo", "kind": "markdown", "resource": "../../../raw/direct-preference-optimization-your-language-model-is-secretly-a-reward-model.md", "start_line": 1, "end_line": 1}, {"source_id": "project", "kind": "markdown", "resource": "../README.md", "start_line": 1, "end_line": 1}]
---

# Where do the paper ideas appear in Nanochat?

## Answer

Some ideas map directly to code, some are configurable but inactive in the
default base run, and some are comparison-only context:

| Research source | Nanochat location or status |
| --- | --- |
| BPE[^bpe] | `nanochat/tokenizer.py`, `scripts/tok_train.py` |
| FineWeb[^fineweb] | Context only; pinned loader uses ClimbMix |
| DataComp-LM[^dclm] | Curation/scaling context only |
| SmolLM2/SmolTalk[^smollm2] | `tasks/smoltalk.py` supplies SFT data adapters |
| GQA[^gqa] | `GPTConfig.n_kv_head`; supported, while base defaults currently use equal Q/KV counts |
| FlashAttention-3[^fa3] | `nanochat/flash_attention.py` tries FA3 and has an SDPA fallback |
| FP8 formats[^fp8] | `nanochat/fp8.py` and `base_train.py --fp8` |
| DPO[^dpo] | Not implemented; contrast with `scripts/chat_rl.py` |

The [Nanochat project-vault overview](../README.md) is the authoritative
pinned source map for those paths.[^project]

## Evidence trail

The map starts with the exact-version paper, follows a concept page that
explains the mechanism, and ends at a file under the pinned gitlink. “Context
only” is intentional: a relevant paper does not become implementation evidence
merely because it discusses the same stage.

For guided reading, start with
[the research corpus overview](../../../summaries/research-corpus-overview.md), then
open [the end-to-end pipeline](../summaries/nanochat-end-to-end-training-pipeline.md)
to place each idea in execution order.

## Limits

File presence does not prove that a path executes under every configuration.
GQA head counts, FP8, FA3 availability, and optional RL all depend on flags,
hardware, or selected scripts. The map is limited to commit
`92d63d4e8bb4df75c3b71618f31ddde2378b2bcd`.

## Related pages

- [Research corpus overview](../../../summaries/research-corpus-overview.md)
- [Low-precision training](../../../concepts/low-precision-training.md)
- [DPO versus on-policy reinforcement learning](../../../comparisons/dpo-vs-on-policy-reinforcement-learning.md)

[^bpe]: Neural Machine Translation of Rare Words with Subword Units
[^fineweb]: The FineWeb Datasets
[^dclm]: DataComp-LM
[^smollm2]: SmolLM2
[^gqa]: GQA
[^fa3]: FlashAttention-3
[^fp8]: FP8 Formats for Deep Learning
[^dpo]: Direct Preference Optimization
[^project]: Nanochat project-vault overview
