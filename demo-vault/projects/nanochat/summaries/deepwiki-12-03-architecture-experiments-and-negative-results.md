---
type: "Summary"
title: "DeepWiki: Architecture Experiments and Negative Results"
description: "Imported DeepWiki page 12.3 about Architecture Experiments and Negative Results."
tags: ["project-nanochat", "repository-documentation", "provenance"]
status: "draft"
code_scope: true
generated: {"by": "process:deepwiki-import", "at": "2026-08-07T09:40:41.303058Z"}
project: "nanochat"
provenance_state: "unverified"
repository: "nanochat"
revision: "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"
retrieved_at: "2026-08-24"
deepwiki: {"page_id": "12.3", "source_url": "https://deepwiki.com/karpathy/nanochat/12.3-architecture-experiments-and-negative-results", "indexed_revision": "92d63d4e", "content_sha256": "01ca8876c263712b4471cb3646196e4f4e55a98b6d9c5360bfb9bdae83b116ae"}
sources: [{"id": "deepwiki-page", "resource": "https://deepwiki.com/karpathy/nanochat/12.3-architecture-experiments-and-negative-results", "title": "DeepWiki: Architecture Experiments and Negative Results", "last_modified": "2026-08-07T09:40:41.303058"}]
---

> [!WARNING]
> Imported from DeepWiki as generated, unverified repository documentation. Verify code-behavior claims against the revision below before stabilization.

# Architecture Experiments and Negative Results

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [dev/LOG.md](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md)

</details>



## Purpose and Scope

This page documents architectural features, optimizations, and training techniques that were implemented and tested but ultimately **not adopted** into nanochat. Each experiment includes motivation, implementation details, results, and lessons learned. Understanding these negative results is crucial for avoiding redundant work and appreciating the design decisions that shaped the current architecture.

For experiments that **succeeded** and were integrated, see the Optimization System and Model Architecture sections. For the overall development history, see the Experiment Log and Design History.

---

## DyT Normalization (May 2026)

### Motivation
Following industry discussion regarding Dynamic Tanh (DyT) normalization, an experiment was conducted to replace standard `F.rms_norm` [nanochat/gpt.py:43](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L43) with DyT for d12-scale pretraining [dev/LOG.md:7-9](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L7-L9).

### Implementation
DyT was implemented using the formula `gamma * tanh(alpha * x) + beta`, featuring a learnable scalar `alpha` and per-channel `gamma`/`beta` [dev/LOG.md:11](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L11). The experiment included:
- Separate `alpha` initializers for attention versus other normalization sites [dev/LOG.md:12](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L12).
- Optional embedding DyT [dev/LOG.md:13](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L13).
- Integration of the LLM-specific `sqrt(d_model)` embedding scale [dev/LOG.md:13](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L13).

### Results
Despite parameter tuning, no variation of the idea outperformed the baseline d12 model [dev/LOG.md:15](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L15). Furthermore, the implementation resulted in a **~10% reduction in throughput** (tokens per second) [dev/LOG.md:15](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L15).

**Sources:** [dev/LOG.md:7-17](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L7-L17), [nanochat/gpt.py:42-43](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L42-L43)

---

## Parameter-Golf Ideas Sweep (March 2026)

### Motivation
A review of the `openai/parameter-golf` repository was conducted to identify small, simple architectural tweaks that might transfer to nanochat pretraining without bloating the codebase [dev/LOG.md:19-21](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L19-L21).

### Ideas Tried and Results

| Experiment | Implementation | Result | Source |
| :--- | :--- | :--- | :--- |
| **LeakyReLU(0.5)²** | Replaced `relu^2` in `MLP` [nanochat/gpt.py:137](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L137) with `leaky_relu(x, 0.5)^2` | Slightly better per-step quality, but slower. Net worse on wall clock. | [dev/LOG.md:41-43](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L41-L43) |
| **Partial RoPE** | Applied rotary embeddings [nanochat/gpt.py:57-63](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L57-L63) to only the first quarter of head dimension | Slightly worse. | [dev/LOG.md:45-47](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L45-L47) |
| **LN Scale** | Multiplied block normalized input by `1/sqrt(layer_idx+1)` | Did not help. | [dev/LOG.md:49-51](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L49-L51) |
| **Orthogonal Init** | Switched non-zero matrices to orthogonal initialization | Did not help. | [dev/LOG.md:53-55](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L53-L55) |
| **Exclusive Self Attention (XSA)** | Projected against plain `v` path rather than `v + VE` on deep layers | Better step quality, worse wall-clock. Not worth compute. | [dev/LOG.md:57-59](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L57-L59) |

**Sources:** [dev/LOG.md:19-69](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L19-L69), [nanochat/gpt.py:57-137](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L57-L137)

---

## Multi-Token Prediction

### Motivation
Multi-token prediction (MTP) predicts not just the next token but the next `n` tokens at each position. The hypothesis was that this additional training signal would improve learning efficiency.

### Implementation

Title: Multi-Token Prediction Architecture
```mermaid
graph TB
    subgraph "Standard Next-Token Prediction"
        "INPUT1"["Input Sequence<br/>[t₁, t₂, ..., tₙ]"]
        "LOGITS1"["Logits<br/>[L₁, L₂, ..., Lₙ]"]
        "TARGET1"["Targets<br/>[t₂, t₃, ..., tₙ₊₁]"]
        "LOSS1"["Loss = CE(Lᵢ, tᵢ₊₁)"]
        
        "INPUT1" --> "LOGITS1"
        "LOGITS1" --> "LOSS1"
        "TARGET1" --> "LOSS1"
    end
    
    subgraph "Multi-Token Prediction (n=3)"
        "INPUT2"["Input Sequence<br/>[t₁, t₂, ..., tₙ]"]
        "LOGITS2"["Logits<br/>[L₁, L₂, ..., Lₙ]"]
        "TARGET2A"["Targets +1<br/>[t₂, t₃, ..., tₙ₊₁]"]
        "TARGET2B"["Targets +2<br/>[t₃, t₄, ..., tₙ₊₂]"]
        "TARGET2C"["Targets +3<br/>[t₄, t₅, ..., tₙ₊₃]"]
        "LOSS2"["Loss = w₁·CE(Lᵢ, tᵢ₊₁) +<br/>w₂·CE(Lᵢ, tᵢ₊₂) +<br/>w₃·CE(Lᵢ, tᵢ₊₃)"]
        
        "INPUT2" --> "LOGITS2"
        "LOGITS2" --> "LOSS2"
        "TARGET2A" --> "LOSS2"
        "TARGET2B" --> "LOSS2"
        "TARGET2C" --> "LOSS2"
    end
    
    subgraph "Annealing Schedule"
        "PHASE1"["0-33%: w=[1.0, 0.5, 0.25→0]"]
        "PHASE2"["33-67%: w=[1.0, 0.5→0]"]
        "PHASE3"["67-100%: w=[1.0]"]
        
        "PHASE1" --> "PHASE2" --> "PHASE3"
    end
```

The implementation used batched computation with `unfold` operations to avoid multiple loss function calls.

**Sources:** [dev/LOG.md:19-69](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L19-L69) (General reference to architectural sweeps)

### Results

| Metric | Baseline | MTP (n=3) |
| :--- | :--- | :--- |
| GPU Memory | 34 GB | 47 GB (+38%) |
| MFU | 41% | 40% |
| val/bpb (wall clock) | baseline | **noticeably worse** |

**Verdict**: The 13GB memory overhead and reduced MFU made this approach strictly worse on wall-clock time.

---

## Activation Functions: SwiGLU

### Motivation
SwiGLU (Swish-Gated Linear Unit) is used in modern LLMs like LLaMA. It was tested against the `relu^2` activation currently used in `nanochat/gpt.py` [nanochat/gpt.py:137](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L137).

### Implementation

Title: MLP Activation Function Comparison
```mermaid
graph LR
    subgraph "ReLU² MLP (nanochat/gpt.py:129-139)"
        "X1"["x<br/>(n_embd)"]
        "FC1"["c_fc<br/>Linear(n, 4n)"]
        "RELU"["ReLU²"]
        "PROJ1"["c_proj<br/>Linear(4n, n)"]
        
        "X1" --> "FC1" --> "RELU" --> "PROJ1"
    end
    
    subgraph "SwiGLU MLP (Experimental)"
        "X2"["x<br/>(n_embd)"]
        "W1"["w1 (gate)<br/>Linear(n, 8n/3)"]
        "W2"["w2 (up)<br/>Linear(n, 8n/3)"]
        "W3"["w3 (down)<br/>Linear(8n/3, n)"]
        "SILU"["SiLU"]
        "MUL"["×"]
        
        "X2" --> "W1" --> "SILU" --> "MUL"
        "X2" --> "W2" --> "MUL"
        "MUL" --> "W3"
    end
```

**Sources:** [nanochat/gpt.py:129-139](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L129-L139), [dev/LOG.md:41-43](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L41-L43)

### Results
SwiGLU underperformed `relu^2` on step efficiency and wall-clock time at the GPT-2 scale. **ReLU² remains the choice for this architecture** [nanochat/gpt.py:7](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L7).

---

## Mixture of Experts (MoE)

### Motivation
MoE provides conditional computation. A DeepSeekV3-style MoE was implemented as a drop-in replacement for the dense `MLP` class [nanochat/gpt.py:129](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L129).

### Implementation

Title: Mixture of Experts Architecture
```mermaid
graph TB
    subgraph "Dense MLP (nanochat/gpt.py:129-139)"
        "X1"["Tokens<br/>(B×T, n_embd)"]
        "MLP1"["MLP<br/>(4× expansion)"]
        "OUT1"["Output<br/>(B×T, n_embd)"]
        
        "X1" --> "MLP1" --> "OUT1"
    end
    
    subgraph "MoE Layer (DeepSeekV3-style Experiment)"
        "X2"["Tokens<br/>(B×T, n_embd)"]
        
        subgraph "Routing Logic"
            "ROUTER"["Router<br/>Linear(n, num_experts)"]
            "TOPK"["Sigmoid + Top-2"]
            "SORT"["Sort by expert"]
        end
        
        subgraph "Expert Computation"
            "E0"["Expert 0"]
            "E1"["Expert 1"]
            "EDOT"["..."]
            "E7"["Expert 7"]
            "SHARED"["Shared Expert"]
            "GROUPED"["torch._grouped_mm"]
        end
        
        "SCATTER"["Scatter back"]
        "COMBINE"["Weighted combine"]
        "OUT2"["Output<br/>(B×T, n_embd)"]
        
        "X2" --> "ROUTER" --> "TOPK" --> "SORT"
        "SORT" --> "GROUPED"
        "E0" -.-> "GROUPED"
        "E1" -.-> "GROUPED"
        "EDOT" -.-> "GROUPED"
        "E7" -.-> "GROUPED"
        "X2" --> "SHARED"
        "GROUPED" --> "SCATTER" --> "COMBINE"
        "SHARED" --> "COMBINE"
        "COMBINE" --> "OUT2"
    end
```

**Key findings**:
- Grouped matmul dispatch overhead plus token sorting exceeded FLOP savings at this scale.
- Maintenance complexity did not justify the marginal gains in specific narrow regimes.

**Sources:** [dev/LOG.md:19-69](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L19-L69), [nanochat/gpt.py:129-139](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L129-L139)

---

## Attention Mechanism Experiments

### Varlen Attention
**Motivation**: Use `flash_attn_varlen_func` to prevent attention leakage across document boundaries in packed sequences.
**Result**: The improvement in validation metrics was negligible and did not justify the code complexity. The current implementation uses `flash_attn_func` which handles causal masking and sliding windows efficiently [nanochat/gpt.py:108](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L108).

### Attention Gates and Smear Gates
**Motivation**: Learnable gates on attention output or token blending.
**Result**: No significant improvement; increased memory usage and parameter count. The current architecture uses a `ve_gate` for Value Residuals [nanochat/gpt.py:80](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L80), which was found to be more effective than general attention gating.

**Sources:** [nanochat/gpt.py:80-126](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L80-L126), [dev/LOG.md:57-59](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L57-L59)

---

## Optimizer Experiments

### Hyperball (MuonH)
**Motivation**: Constrain weights to a sphere of initial radius.
**Result**: Could not outperform the baseline `MuonAdamW` [nanochat/gpt.py:23](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L23) despite LR sweeps and scaling tweaks.

### Gradient Clipping
**Motivation**: Standard practice in LLM training to prevent instability.
**Result**: Gradient norms in nanochat naturally stay below 1.0. Clipping added overhead due to the required `all_reduce` for global norm calculation. The codebase currently relies on stable initialization and `Muon`'s inherent stability [nanochat/gpt.py:23](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L23).

**Sources:** [nanochat/gpt.py:22-24](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L22-L24), [dev/LOG.md:53-55](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L53-L55)

---

## Key Lessons Learned

1. **Complexity Tax**: Features must provide substantial improvements to justify maintenance.
2. **Dataset Quality Dominates**: The switch to **ClimbMix 400B** [dev/LOG.md:107-109](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L107-L109) provided a 27% speedup, far exceeding any architectural tweak.
3. **Wall Clock is the Metric**: Step-wise improvements (like LeakyReLU² or XSA) are discarded if they increase training time per token [dev/LOG.md:43-59](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L43-L59).
4. **Precision Matters**: Explicit dtype management and removing `autocast` in favor of custom `Linear` layers [nanochat/gpt.py:45-51](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L45-L51) provided better control and eliminated "magic" behavior [dev/LOG.md:72-79](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L72-L79).

**Sources:** [dev/LOG.md:1-125](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L1-L125), [nanochat/gpt.py:45-51](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L45-L51)
