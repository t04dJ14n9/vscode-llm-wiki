---
type: "Comparison"
title: "Pre-norm versus post-norm transformers"
description: "How placing normalization before or after a transformer sublayer changes optimization and residual-stream behavior."
tags: ["architecture", "optimization", "training-systems"]
status: "stable"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-24T21:02:36+08:00"}
verified: [{"by": "codex/gpt-5.6", "at": "2026-08-24T21:02:36+08:00"}]
sources: [{"id": "xiong-layernorm", "resource": "https://arxiv.org/abs/2002.04745", "title": "On Layer Normalization in the Transformer Architecture", "author": "Ruibin Xiong et al."}, {"id": "deepnet", "resource": "https://arxiv.org/abs/2203.00555", "title": "DeepNet: Scaling Transformers to 1,000 Layers", "author": "Hongyu Wang et al."}]
relations: [{"target": "concepts/rms-normalization.md", "kind": "depends-on", "caption": "Compares where normalization is applied around each sublayer"}, {"target": "concepts/decoder-only-transformers.md", "kind": "applies-to", "caption": "Applies the normalization choice to decoder-only transformer blocks"}, {"target": "concepts/gradient-accumulation-and-distributed-training.md", "kind": "references", "caption": "Connects normalization placement to training stability"}]
---

# Pre-norm versus post-norm transformers

## Decision

Pre-norm applies normalization before the attention or feed-forward sublayer,
then adds the result to the residual stream. Post-norm applies the sublayer to
the current representation, adds the residual, and normalizes the combined
result.[^xiong-layernorm] Conventional Pre-LN is the safer baseline when
initial optimization stability matters, but modified Post-LN designs remain a
real alternative: DeepNorm combines a changed residual connection with derived
initialization to bound updates in very deep Transformers.[^deepnet]

## Trade-offs

- **Gradient path:** pre-norm leaves a more direct identity path through the
  residual stream. Xiong et al. show well-behaved initialization gradients for
  Pre-LN, whereas original Post-LN has large expected gradients near the output
  and benefits from learning-rate warmup.[^xiong-layernorm]
- **Representation:** post-norm guarantees that every completed block emits a
  normalized representation. Pre-norm lets the residual stream accumulate
  updates without a normalization step after every addition.
- **Compatibility:** changing placement is an architectural change, not a local
  refactor. Checkpoint shapes may match while their learned computation and
  training dynamics do not.
- **Diagnosis:** apparent normalization benefits can depend on depth, optimizer,
  initialization, precision, and residual scaling, so comparisons need a
  controlled training recipe. DeepNorm demonstrates that residual scaling and
  initialization can change the conclusion for Post-LN variants.[^deepnet]

## Limits

The papers support the optimization distinction, not a universal winner for
every architecture, scale, optimizer, or dataset. A repository-specific choice
still needs evidence from that implementation and its training recipe.

## Related pages

- [RMS normalization](../concepts/rms-normalization.md)
- [Decoder-only transformers](../concepts/decoder-only-transformers.md)
- [Gradient accumulation and distributed training](../concepts/gradient-accumulation-and-distributed-training.md)

[^xiong-layernorm]: On Layer Normalization in the Transformer Architecture
[^deepnet]: DeepNet: Scaling Transformers to 1,000 Layers
