---
type: "Summary"
title: "DeepWiki: Overview"
description: "Imported DeepWiki page 1 about Overview."
tags: ["project-nanochat", "repository-documentation", "provenance"]
status: "draft"
code_scope: true
generated: {"by": "process:deepwiki-import", "at": "2026-08-07T09:40:41.303058Z"}
project: "nanochat"
provenance_state: "unverified"
repository: "nanochat"
revision: "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"
retrieved_at: "2026-08-24"
deepwiki: {"page_id": "1", "source_url": "https://deepwiki.com/karpathy/nanochat/1-overview", "indexed_revision": "92d63d4e", "content_sha256": "fb522168d5300629c013ff94c2b0ba13fbc90bde4e1e55209066a061f4a744db"}
sources: [{"id": "deepwiki-page", "resource": "https://deepwiki.com/karpathy/nanochat/1-overview", "title": "DeepWiki: Overview", "last_modified": "2026-08-07T09:40:41.303058"}]
---

> [!WARNING]
> Imported from DeepWiki as generated, unverified repository documentation. Verify code-behavior claims against the revision below before stabilization.

# Overview

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [README.md](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md)
- [dev/LEADERBOARD.md](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LEADERBOARD.md)
- [nanochat/tokenizer.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/tokenizer.py)

</details>



## Purpose and Scope

This page provides a high-level introduction to nanochat: its purpose as a minimal full-stack LLM training system, the single-complexity-dial design philosophy, and the Time-to-GPT-2 leaderboard concept that drives development. For detailed instructions on installation and running your first training, see [Getting Started](deepwiki-02-getting-started.md). For in-depth documentation of specific subsystems, consult the relevant sections (e.g., [Base Model Pretraining](deepwiki-03-base-model-pretraining.md), [Model Architecture](deepwiki-04-model-architecture.md), [Data Pipeline](deepwiki-06-data-pipeline.md)).

**Sources:** [README.md:1-6](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L1-L6)

## What is nanochat?

nanochat is a minimal experimental harness for training large language models from scratch. It is designed to be:

- **Complete**: Covers the entire LLM lifecycle including tokenization, pretraining, supervised fine-tuning (SFT), reinforcement learning (RL), evaluation, and deployment [README.md:1-6](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L1-L6).
- **Accessible**: Runs on a single GPU node (typically 8xH100 or 8xA100) [README.md:32-35](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L32-L35).
- **Minimal**: The codebase is small, readable, and hackable with no configuration objects or framework abstractions [README.md:1-6](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L1-L6).
- **Cost-effective**: Trains a GPT-2 capability model in ~1.65 - 1.8 hours for approximately $40-$50 (vs. $43,000 in 2019) [README.md:21-24](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L21-L24).

The repository enables you to train your own ChatGPT-like model and interact with it through either a command-line interface ([scripts/chat_cli.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_cli.py)) or web interface ([scripts/chat_web.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_web.py)).

### Key Capabilities

| Stage | Script | Output | Description |
|-------|--------|--------|-------------|
| Tokenization | [scripts/tok_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/tok_train.py) | `tokenizer.pkl` | Trains BPE tokenizer with 32,768 vocab using `rustbpe` [nanochat/tokenizer.py:42-61](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/tokenizer.py#L42-L61) |
| Base Pretraining | [scripts/base_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py) | Base checkpoint | Trains transformer from scratch using scaling laws [README.md:6](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L6) |
| SFT | [scripts/chat_sft.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_sft.py) | Chat checkpoint | Adapts base model for conversation using Task Mixture [nanochat/tokenizer.py:140-146](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/tokenizer.py#L140-L146) |
| RL (Optional) | [scripts/chat_rl.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_rl.py) | Aligned checkpoint | Further aligns model using GRPO/SimPO |
| Evaluation | [scripts/base_eval.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_eval.py), [scripts/chat_eval.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_eval.py) | Metrics | Measures CORE score, val_bpb, task accuracy [README.md:12-24](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L12-L24) |
| Inference | [scripts/chat_cli.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_cli.py), [scripts/chat_web.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_web.py) | Interactive chat | Deploys model for user interaction using `Engine` [nanochat/tokenizer.py:140-146](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/tokenizer.py#L140-L146) |

**Sources:** [README.md:1-6](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L1-L6), [nanochat/tokenizer.py:9-21](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/tokenizer.py#L9-L21), [nanochat/tokenizer.py:42-61](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/tokenizer.py#L42-L61)

## The Single Complexity Dial Philosophy

nanochat's defining design principle is the **single complexity dial**: the `--depth` argument (number of transformer layers) automatically determines all other hyperparameters to produce compute-optimal models [README.md:6-8](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L6-L8). Users specify only the model size they want; the system calculates:

- Model width (`n_embd`), number of attention heads (`n_head`)
- Learning rates (base LR, embedding LR, with `dmodel_lr_scale`)
- Training horizon (total tokens based on scaling laws)
- Batch size (optimal for the given depth)
- Weight decay schedules
- Warmup and warmdown durations

This is implemented through scaling law formulas in `scripts/base_train.py` that map depth to optimal hyperparameters [README.md:6](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L6). The result is that sweeping `--depth` produces a **miniseries** of compute-optimal models at various scales [README.md:88-98](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L88-L98).

### Depth-to-Capability Mapping

| Depth | Approximate Capability | Parameters | Training Time (8xH100) |
|-------|----------------------|------------|----------------------|
| 12 | GPT-1 scale | ~124M | ~5 minutes |
| 16 | Intermediate | ~220M | ~15 minutes |
| 20 | Approaching GPT-2 | ~343M | ~45 minutes |
| 24-26 | **GPT-2** | ~475-600M | **~1.65 - 1.8 hours** |

The philosophy eliminates the need for exhaustive hyperparameter tuning: any improvement to the codebase must work across all depths, ensuring principled changes rather than single-model overfitting [README.md:6](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L6), [dev/LEADERBOARD.md:51-51](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LEADERBOARD.md#L51-L51).

**Sources:** [README.md:6](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L6), [README.md:88-98](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L88-L98), [dev/LEADERBOARD.md:51-51](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LEADERBOARD.md#L51-L51)

## Time-to-GPT-2 Leaderboard

The primary development focus is the **Time-to-GPT-2** leaderboard, which tracks wall-clock time to train a model that exceeds GPT-2's CORE score of **0.256525** on an 8xH100 node [README.md:10-24](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L10-L24).

### Current Leaderboard (Recent Entries)

| # | Time (hours) | val_bpb | CORE | Description | Date | Commit |
|---|--------------|---------|------|-------------|------|--------|
| 0 | 168.00 | - | 0.2565 | Original OpenAI GPT-2 (1.6B) | 2019 | - |
| 4 | 2.02 | 0.71854 | 0.2571 | NVIDIA ClimbMix dataset | Mar 4 2026 | 324e69c |
| 5 | 1.80 | 0.71808 | 0.2690 | Autoresearch round 1 | Mar 9 2026 | 6ed7d1d |
| 6 | **1.65** | 0.71800 | 0.2626 | Autoresearch round 2 | Mar 14 2026 | a825e63 |

### Leaderboard Metrics

- **Time**: Wall-clock training time (`total_training_time`) excluding evaluation/logging [README.md:24](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L24), [dev/LEADERBOARD.md:49-49](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LEADERBOARD.md#L49-L49).
- **val_bpb**: Validation loss in bits-per-byte (vocabulary-size invariant metric) [README.md:100-102](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L100-L102).
- **CORE**: Centered accuracy across 22 ICL tasks from the DCLM paper [README.md:12-24](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L12-L24).

To participate, run [runs/speedrun.sh](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/runs/speedrun.sh) (which implements the current SOTA), verify `core_metric > 0.256525`, and submit a PR with improved training time [README.md:10-26](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L10-L26).

**Sources:** [README.md:10-25](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L10-L25), [dev/LEADERBOARD.md:5-5](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LEADERBOARD.md#L5-L5), [dev/LEADERBOARD.md:49-49](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LEADERBOARD.md#L49-L49)

## System Architecture Overview

The following diagram shows the main entry points and how they orchestrate the core subsystems:

```mermaid
graph TB
    subgraph "EntryPoints"
        ["runs/speedrun.sh"]
        ["runs/runcpu.sh"]
    end
    
    subgraph "TrainingScripts"
        ["scripts.tok_train"]
        ["scripts.base_train"]
        ["scripts.chat_sft"]
        ["scripts.chat_rl"]
    end
    
    subgraph "EvaluationScripts"
        ["scripts.base_eval"]
        ["scripts.chat_eval"]
    end
    
    subgraph "InferenceScripts"
        ["scripts.chat_cli"]
        ["scripts.chat_web"]
    end
    
    subgraph "CoreModules"
        ["nanochat.gpt.GPT"]
        ["nanochat.engine.Engine"]
        ["nanochat.dataloader.make_dataloader"]
        ["nanochat.dataset.Dataset"]
        ["nanochat.tokenizer.RustBPETokenizer"]
        ["nanochat.optim.MuonAdamW"]
        ["nanochat.checkpoint_manager.save_checkpoint"]
        ["nanochat.common.compute_init"]
    end
    
    ["runs/speedrun.sh"] --> ["scripts.tok_train"]
    ["runs/speedrun.sh"] --> ["scripts.base_train"]
    ["runs/speedrun.sh"] --> ["scripts.chat_sft"]
    ["runs/speedrun.sh"] --> ["scripts.base_eval"]
    
    ["runs/runcpu.sh"] --> ["scripts.base_train"]
    
    ["scripts.tok_train"] --> ["nanochat.tokenizer.RustBPETokenizer"]
    
    ["scripts.base_train"] --> ["nanochat.gpt.GPT"]
    ["scripts.base_train"] --> ["nanochat.dataloader.make_dataloader"]
    ["scripts.base_train"] --> ["nanochat.optim.MuonAdamW"]
    ["scripts.base_train"] --> ["nanochat.checkpoint_manager.save_checkpoint"]
    ["scripts.base_train"] --> ["nanochat.common.compute_init"]
    
    ["scripts.chat_sft"] --> ["nanochat.gpt.GPT"]
    ["scripts.chat_sft"] --> ["nanochat.dataloader.make_dataloader"]
    ["scripts.chat_sft"] --> ["nanochat.optim.MuonAdamW"]
    ["scripts.chat_sft"] --> ["nanochat.checkpoint_manager.save_checkpoint"]
    
    ["scripts.chat_rl"] --> ["nanochat.gpt.GPT"]
    
    ["scripts.base_eval"] --> ["nanochat.gpt.GPT"]
    ["scripts.base_eval"] --> ["nanochat.engine.Engine"]
    ["scripts.base_eval"] --> ["nanochat.dataloader.make_dataloader"]
    
    ["scripts.chat_eval"] --> ["nanochat.engine.Engine"]
    
    ["scripts.chat_cli"] --> ["nanochat.engine.Engine"]
    ["scripts.chat_web"] --> ["nanochat.engine.Engine"]
    
    ["nanochat.engine.Engine"] --> ["nanochat.gpt.GPT"]
    ["nanochat.dataloader.make_dataloader"] --> ["nanochat.tokenizer.RustBPETokenizer"]
```

**Entry Points and Scripts Architecture**

**Sources:** [README.md:43-60](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L43-L60), [runs/speedrun.sh:1-80](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/runs/speedrun.sh#L1-L80), [nanochat/tokenizer.py:34-35](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/tokenizer.py#L34-L35)

### Training Pipeline Flow

The complete pipeline from raw data to deployed chat interface follows these stages:

```mermaid
graph LR
    subgraph "DataPreparation"
        ["ClimbMix-400B"]
        ["scripts.tok_train"]
    end
    
    subgraph "BasePretraining"
        ["scripts.base_train"]
        ["base_checkpoints"]
    end
    
    subgraph "SFT"
        ["scripts.chat_sft"]
        ["chatsft_checkpoints"]
    end
    
    subgraph "Deployment"
        ["scripts.chat_cli"]
    end
    
    ["ClimbMix-400B"] --> ["scripts.tok_train"]
    ["scripts.tok_train"] --> ["scripts.base_train"]
    ["ClimbMix-400B"] --> ["scripts.base_train"]
    ["scripts.base_train"] --> ["base_checkpoints"]
    ["base_checkpoints"] --> ["scripts.chat_sft"]
    ["scripts.chat_sft"] --> ["chatsft_checkpoints"]
    ["chatsft_checkpoints"] --> ["scripts.chat_cli"]
```

**Complete Training Pipeline from Data to Deployment**

Each stage is independent: base pretraining checkpoints can be evaluated directly, or used to warm-start SFT.

**Sources:** [runs/speedrun.sh:43-80](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/runs/speedrun.sh#L43-L80), [README.md:20-20](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L20-L20)

### Core Module Responsibilities

The `nanochat/` directory contains the implementation modules:

| Module | Primary Classes/Functions | Responsibility |
|--------|--------------------------|----------------|
| `gpt.py` | `GPT`, `GPTConfig` | Transformer architecture with Flash Attention 3 support. |
| `engine.py` | `Engine` | Inference engine with KV cache and sampling strategies [nanochat/tokenizer.py:140-146](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/tokenizer.py#L140-L146). |
| `dataloader.py` | `make_dataloader` | BOS-aligned packing and distributed data loading. |
| `tokenizer.py` | `RustBPETokenizer` | BPE tokenizer using `rustbpe` for training and `tiktoken` for inference [nanochat/tokenizer.py:34-36](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/tokenizer.py#L34-L36). |
| `optim.py` | `MuonAdamW`, `DistMuonAdamW` | Hybrid optimizer (Muon for matrices, AdamW for rest). |
| `checkpoint_manager.py` | `save_checkpoint`, `load_checkpoint` | Checkpoint I/O with rank-aware saving [dev/LEADERBOARD.md:31-31](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LEADERBOARD.md#L31-L31). |
| `common.py` | `compute_init` | DDP setup and hardware-specific precision selection. |

**Sources:** [README.md:1-60](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L1-L60), [nanochat/tokenizer.py:34-61](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/tokenizer.py#L34-L61), [dev/LEADERBOARD.md:31-31](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LEADERBOARD.md#L31-L31)

## Precision and Hardware Support

nanochat uses an **explicit precision system** rather than PyTorch's `autocast`. The global `COMPUTE_DTYPE` variable is auto-detected based on hardware:

| Hardware | Default `COMPUTE_DTYPE` | Rationale |
|----------|------------------------|-----------|
| CUDA SM 80+ (A100, H100) | `bfloat16` | Native BF16 tensor cores |
| CUDA SM < 80 (V100, T4) | `float32` | No BF16 support; requires manual override for FP16 |
| CPU / MPS | `float32` | No reduced-precision tensor cores |

Optional **FP8 training** is available via the `--fp8` flag on Hopper+ GPUs, using `torchao` for tensorwise scaling [dev/LEADERBOARD.md:24-24](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LEADERBOARD.md#L24-L24), [dev/LEADERBOARD.md:117-117](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LEADERBOARD.md#L117-L117).

**Sources:** [dev/LEADERBOARD.md:24-24](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LEADERBOARD.md#L24-L24), [dev/LEADERBOARD.md:117-117](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LEADERBOARD.md#L117-L117)

## Key Design Decisions

nanochat makes several architectural choices that distinguish it from typical LLM frameworks:

1. **Tiktoken/RustBPE Integration**: Uses `rustbpe` for training the BPE vocabulary and `tiktoken` for high-performance inference [nanochat/tokenizer.py:34-36](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/tokenizer.py#L34-L36).
2. **ClimbMix Dataset**: Uses NVIDIA ClimbMix 400B for pretraining to achieve faster convergence to GPT-2 capability [README.md:20-20](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L20-L20).
3. **Hybrid Optimization**: Employs `Muon` for internal transformer matrices to accelerate training via orthogonalization [dev/LEADERBOARD.md:117-117](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/dev/LEADERBOARD.md#L117-L117).
4. **Special Token Handling**: Includes specific tokens like `<|bos|>`, `<|user_start|>`, and `<|python_start|>` to support chat and tool-use capabilities [nanochat/tokenizer.py:9-21](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/tokenizer.py#L9-L21).
5. **Single Dial**: Depth-based scaling law auto-configures all training parameters [README.md:6](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L6).

**Sources:** [README.md:6](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L6), [README.md:20-20](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/README.md#L20-L20), [nanochat/tokenizer.py:9-61](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/tokenizer.py#L9-L61)
