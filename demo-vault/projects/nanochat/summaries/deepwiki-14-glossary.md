---
type: "Summary"
title: "DeepWiki: Glossary"
description: "Imported DeepWiki page 14 about Glossary."
tags: ["project-nanochat", "repository-documentation", "provenance"]
status: "draft"
code_scope: true
generated: {"by": "process:deepwiki-import", "at": "2026-08-07T09:40:41.303058Z"}
project: "nanochat"
provenance_state: "unverified"
repository: "nanochat"
revision: "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"
retrieved_at: "2026-08-24"
deepwiki: {"page_id": "14", "source_url": "https://deepwiki.com/karpathy/nanochat/14-glossary", "indexed_revision": "92d63d4e", "content_sha256": "664f98c9b7be2d0723f6691566c8f7c017b00c3990e6469ec85a0322afec675d"}
sources: [{"id": "deepwiki-page", "resource": "https://deepwiki.com/karpathy/nanochat/14-glossary", "title": "DeepWiki: Glossary", "last_modified": "2026-08-07T09:40:41.303058"}]
---

> [!WARNING]
> Imported from DeepWiki as generated, unverified repository documentation. Verify code-behavior claims against the revision below before stabilization.

# Glossary

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [README.md](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md)
- [dev/LOG.md](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md)
- [nanochat/dataloader.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py)
- [nanochat/dataset.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py)
- [nanochat/engine.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py)
- [nanochat/gpt.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py)
- [nanochat/optim.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py)
- [scripts/base_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py)
- [tests/test_engine.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/tests/test_engine.py)

</details>



This page provides definitions for codebase-specific terminology, architectural components, and domain concepts used throughout the `nanochat` repository. It serves as a technical reference for engineers to understand the specific implementation of optimization algorithms, data structures, and hardware-specific abstractions.

## Core Architectural Concepts

### The Complexity Dial (`--depth`)
The primary hyperparameter in `nanochat`. It is a single integer representing the number of layers in the GPT transformer [README.md:6-7](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L6-L7). Setting this dial triggers an auto-configuration system that scales width, heads, learning rates, and training horizons to maintain compute-optimality [README.md:77-87](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L77-L87).

### CORE Score
A benchmark metric used to evaluate model capability, derived from the DCLM paper [README.md:12](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L12). It aggregates performance across 22 evaluations (e.g., ARC, MMLU). The "GPT-2 threshold" is defined as **0.256525** [README.md:24](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L24).

### BPB (Bits Per Byte)
A vocabulary-size-invariant unit for validation loss [README.md:101-102](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L101-L102). It allows for comparing models trained with different tokenizers or vocabulary sizes by normalizing the negative log-likelihood.

---

## Optimization & Precision

### Muon
A high-performance optimizer for matrix parameters (2D weights). It uses **Polar Express** for orthogonalization and **NorMuon** for variance reduction [nanochat/optim.py:67-87](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py#L67-L87).
*   **Polar Express**: An orthogonalization method using a sign-based iteration to compute the zeroth power of the gradient [nanochat/optim.py:79-82](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py#L79-L82). It uses specific coefficients for quintic iteration [nanochat/optim.py:100-108](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py#L100-L108).
*   **NorMuon**: A variance reduction technique that applies a per-neuron/column adaptive learning rate to normalize update scales [nanochat/optim.py:84-86](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py#L84-L86).
*   **MuonEq**: Row equilibration that rescales each row to the mean row norm to improve the conditioning of the spectrum entering orthogonalization [nanochat/optim.py:89-90](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py#L89-L90).
*   **Cautious Weight Decay**: A mechanism implemented in the fused step that applies updates only when the gradient and parameter signs align [nanochat/optim.py:125-126](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py#L125-L126).

### COMPUTE_DTYPE
A global configuration that manages explicit precision across the model, replacing the "magic" of `torch.amp.autocast` [dev/LOG.md:74-79](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L74-L79). It is auto-detected based on hardware: `bf16` for Ampere+ (SM 80+), `fp16` for pre-Ampere (requiring a `GradScaler`), and `fp32` for CPU/MPS [nanochat/common.py:17-32](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L17-L32).

### Linear (Custom Layer)
A specialized `nn.Linear` subclass that explicitly casts weights to the input's `dtype` during the forward pass [nanochat/gpt.py:45-51](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L45-L51). This ensures matmuls occur in `COMPUTE_DTYPE` while keeping master weights in `fp32` for optimizer precision [nanochat/common.py:13-15](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L13-L15).

### System Flow: Optimizer to Hardware
The following diagram bridges the high-level optimizer logic to the specific code entities that execute the training step.

**Diagram: Optimization and Precision Pipeline**
```mermaid
graph TD
    subgraph "LogicSpace"
        [A_TrainingLoop] --> [B_WeightUpdate]
        [B_WeightUpdate] --> [C_PrecisionManagement]
    end

    subgraph "CodeEntitySpace"
        [B_WeightUpdate] --> [D_MuonAdamW]
        [D_MuonAdamW] --> [F_muon_step_fused]
        [D_MuonAdamW] --> [G_adamw_step_fused]

        [C_PrecisionManagement] --> [H_COMPUTE_DTYPE]
        [C_PrecisionManagement] --> [I_Linear_forward]
    end

    subgraph "Execution"
        [F_muon_step_fused] --> [J_PolarExpressIteration]
        [G_adamw_step_fused] --> [K_FusedAdamWKernel]
        [I_Linear_forward] --> [L_F_linear_cast]
    end
```
**Sources:** [nanochat/optim.py:24-64](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py#L24-L64), [nanochat/optim.py:112-149](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py#L112-L149), [nanochat/gpt.py:45-51](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L45-L51), [nanochat/common.py:13-32](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L13-L32)

---

## Data Pipeline Terms

### ClimbMix-400B
The default pretraining dataset, a 400-billion token mixture of web text, code, and math [dev/LOG.md:107-114](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LOG.md#L107-L114). It is stored as Parquet shards hosted on HuggingFace [nanochat/dataset.py:23-27](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py#L23-L27).

### BOS-Aligned Best-Fit
The data packing strategy used in the `dataloader` [nanochat/dataloader.py:4-8](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L4-L8).
*   **BOS-Aligned**: Every sequence in a batch begins with the `<|bos|>` token [nanochat/dataloader.py:5](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L5).
*   **Best-Fit**: An algorithm that searches a document buffer to find the largest document that fits the remaining space in a sequence, minimizing waste while maintaining 100% token utilization (no padding) [nanochat/dataloader.py:81-94](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L81-L94).

### Row Group (RG)
The unit of sharding within a Parquet file. The dataloader uses `rg_idx` to manage distributed data loading and resumption [nanochat/dataloader.py:29-31](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L29-L31).

---

## RL Training Terms

### GRPO (nanochat variant)
A simplified reinforcement learning approach mentioned in research notes for tasks like GSM8K.
*   **Trust-Region Removal**: Simplification by removing KL regularization to a reference model.
*   **DAPO Normalization**: Usage of token-level normalization instead of sequence-level.
*   **Advantage Calculation**: Usage of simple group-relative rewards (e.g., reward - mean_reward).

---

## Inference & Engine Concepts

### Engine
The inference orchestrator that manages token generation, tool use, and the KV cache [nanochat/engine.py:169-173](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py#L169-L173). It handles the transition from **Prefill** (processing the prompt) to **Decode** (generating new tokens) [nanochat/engine.py:181-205](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py#L181-L205).

### KVCache (FA3 Style)
A Key-Value cache designed for **Flash Attention 3**. Unlike traditional caches, it stores tensors in `(B, T, H, D)` layout and allows for in-place updates via the `flash_attn_with_kvcache` API [nanochat/engine.py:82-90](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py#L82-L90).

### Calculator Tool
A "tool use" mechanism where the model can trigger Python execution by generating specific tokens (e.g., `<|python_start|>`). The `Engine` intercepts these, evaluates the expression safely with a timeout, and injects the result back into the generation stream [nanochat/engine.py:46-80](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py#L46-L80).

### System Flow: Inference Request to Hardware
The following diagram maps the inference lifecycle from natural language prompt to code-level cache management.

**Diagram: Inference Engine Architecture**
```mermaid
graph LR
    subgraph "NaturalLanguageSpace"
        [P_UserPrompt] --> [G_GeneratedResponse]
    end

    subgraph "CodeEntitySpace"
        [P_UserPrompt] --> [E_Engine_generate]
        [E_Engine_generate] --> [PRE_Engine_prefill]
        [PRE_Engine_prefill] --> [KVC_P_KVCache_prefill]
        [E_Engine_generate] --> [LOOP_GenerationLoop]
        [LOOP_GenerationLoop] --> [SNT_sample_next_token]
        [LOOP_GenerationLoop] --> [TOOL_use_calculator]
        [LOOP_GenerationLoop] --> [ADV_KVCache_advance]
    end

    subgraph "HardwareSpace"
        [LOOP_GenerationLoop] --> [FA3_CausalSelfAttention_forward]
        [FA3_CausalSelfAttention_forward] --> [KVC_L_KVCache_get_layer_cache]
        [FA3_CausalSelfAttention_forward] --> [KERNEL_flash_attn_with_kvcache]
    end
```
**Sources:** [nanochat/engine.py:82-138](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py#L82-L138), [nanochat/engine.py:141-156](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py#L141-L156), [nanochat/engine.py:169-220](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py#L169-L220), [nanochat/gpt.py:106-122](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L106-L122)

---

## Table of Code Pointers

| Term | File Reference | Primary Role |
| :--- | :--- | :--- |
| `GPTConfig` | [nanochat/gpt.py:29-40](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L29-L40) | Defines model dimensions and sliding window patterns. |
| `MuonAdamW` | [nanochat/optim.py:23-24](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py#L23-L24) | Hybrid optimizer combining AdamW and Muon. |
| `list_parquet_files` | [nanochat/dataset.py:32-65](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py#L32-L65) | Discovers data shards and handles legacy path fallbacks. |
| `apply_rotary_emb` | [nanochat/gpt.py:57-65](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L57-L65) | Implements RoPE (Rotary Positional Embeddings). |
| `ve_gate` | [nanochat/gpt.py:81-82](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L81-L82) | Gating mechanism for ResFormer-style Value Embeddings. |
| `RowState` | [nanochat/engine.py:160-168](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py#L160-L168) | Tracks per-sequence state (Python blocks, forced tokens) during batch inference. |
| `KVCache` | [nanochat/engine.py:82-105](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py#L82-L105) | Manages memory for KV pairs during inference. |
| `muon_step_fused` | [nanochat/optim.py:112-149](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py#L112-L149) | Compiled kernel for the Muon optimization step. |
| `adamw_step_fused` | [nanochat/optim.py:24-64](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py#L24-L64) | Compiled kernel for the AdamW optimization step. |

**Sources:** [nanochat/gpt.py:29-82](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L29-L82), [nanochat/optim.py:23-149](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py#L23-L149), [nanochat/dataset.py:32-65](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py#L32-L65), [nanochat/engine.py:82-168](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py#L82-L168)
