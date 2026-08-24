---
type: "Summary"
title: "Research corpus overview"
description: "How the mirrored papers support the Nanochat wiki without being mistaken for implementation documentation."
tags: ["paper", "provenance", "project-nanochat", "reproducibility"]
status: "stable"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "bpe", "resource": "../raw/neural-machine-translation-of-rare-words-with-subword-units.md", "title": "Neural Machine Translation of Rare Words with Subword Units"}, {"id": "fineweb", "resource": "../raw/the-fineweb-datasets-decanting-the-web-for-the-finest-text-data-at-scale.md", "title": "The FineWeb Datasets"}, {"id": "dclm", "resource": "../raw/datacomp-lm-in-search-of-the-next-generation-of-training-sets-for-language-models.md", "title": "DataComp-LM"}, {"id": "smollm2", "resource": "../raw/smollm2-when-smol-goes-big-data-centric-training-of-a-small-language-model.md", "title": "SmolLM2"}, {"id": "gqa", "resource": "../raw/gqa-training-generalized-multi-query-transformer-models-from-multi-head-checkpoints.md", "title": "GQA"}, {"id": "fa3", "resource": "../raw/flashattention-3-fast-and-accurate-attention-with-asynchrony-and-low-precision.md", "title": "FlashAttention-3"}, {"id": "fp8", "resource": "../raw/fp8-formats-for-deep-learning.md", "title": "FP8 Formats for Deep Learning"}, {"id": "dpo", "resource": "../raw/direct-preference-optimization-your-language-model-is-secretly-a-reward-model.md", "title": "Direct Preference Optimization"}]
---

# Research corpus overview

## Scope

The raw corpus is a deliberately small reading set organized around decisions a
Nanochat reader can observe: tokenization, data, attention, numerics, and
post-training. Each companion captures one exact arXiv version, its canonical
metadata, a mechanically extracted text layer, and the original PDF.

The BPE paper supplies the historical subword construction behind the
[tokenization concept](../concepts/byte-pair-encoding.md).[^bpe] FineWeb and
DataComp-LM supply contrasting evidence about turning web crawls into training
data.[^fineweb][^dclm] SmolLM2 connects data mixtures and staged training to the
small-model regime.[^smollm2]

## Pipeline

The architecture cluster starts with GQA, which reduces key/value heads while
retaining multiple query heads.[^gqa] FlashAttention-3 studies how attention can
be scheduled efficiently on Hopper-class hardware and how low-precision paths
affect numerical error.[^fa3] The FP8 paper defines the compact formats and
scaling considerations that make an `--fp8` training switch more than a storage
choice.[^fp8]

The post-training cluster currently contains DPO, a preference-learning
objective expressed without an explicit reward-model training loop.[^dpo] It is
included as a comparison point: the pinned Nanochat RL script is on-policy and
rewarded by answer correctness, not a DPO implementation.

The productive reading order is:

1. use a [summary](../projects/nanochat/summaries/nanochat-end-to-end-training-pipeline.md) to frame a stage;
2. open the corresponding concept or comparison;
3. follow its footnote into the immutable raw companion;
4. open the local PDF when equations, figures, or reading order matter;
5. follow the code source to see whether and how the idea appears in Nanochat.

## Evidence boundary

“Relevant to Nanochat” is not the same as “used by Nanochat.” FineWeb is useful
data-curation context even though the pinned dataset loader points to ClimbMix.
DPO is useful post-training context even though Nanochat’s optional RL stage has
a different objective. The wiki preserves those distinctions explicitly.

Only CC BY 4.0 papers are mirrored. Relevant papers under more restrictive or
arXiv-only licenses are cited by URL from compiled pages rather than copied into
the project `assets/` directory. The extracted text is for search and
navigation; the PDF remains the visual authority.

## Related pages

- [Where paper ideas appear in Nanochat](../projects/nanochat/queries/where-do-the-paper-ideas-appear-in-nanochat.md)
- [FineWeb versus DataComp-LM](../comparisons/fineweb-vs-datacomp-lm.md)
- [BF16 versus FP8](../comparisons/bf16-vs-fp8.md)
- [DPO versus on-policy reinforcement learning](../comparisons/dpo-vs-on-policy-reinforcement-learning.md)

[^bpe]: Neural Machine Translation of Rare Words with Subword Units
[^fineweb]: The FineWeb Datasets
[^dclm]: DataComp-LM
[^smollm2]: SmolLM2
[^gqa]: GQA
[^fa3]: FlashAttention-3
[^fp8]: FP8 Formats for Deep Learning
[^dpo]: Direct Preference Optimization
