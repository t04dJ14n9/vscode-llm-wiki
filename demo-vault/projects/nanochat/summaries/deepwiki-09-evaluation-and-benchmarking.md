---
type: "Summary"
title: "DeepWiki: Evaluation and Benchmarking"
description: "Imported DeepWiki page 9 about Evaluation and Benchmarking."
tags: ["project-nanochat", "repository-documentation", "provenance"]
status: "draft"
code_scope: true
generated: {"by": "process:deepwiki-import", "at": "2026-08-07T09:40:41.303058Z"}
project: "nanochat"
provenance_state: "unverified"
repository: "nanochat"
revision: "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"
retrieved_at: "2026-08-24"
deepwiki: {"page_id": "9", "source_url": "https://deepwiki.com/karpathy/nanochat/9-evaluation-and-benchmarking", "indexed_revision": "92d63d4e", "content_sha256": "5b9d90fad2b20dcce81242f1f67a748d86764cfbd09c697d68142ea8a1f69aa7"}
sources: [{"id": "deepwiki-page", "resource": "https://deepwiki.com/karpathy/nanochat/9-evaluation-and-benchmarking", "title": "DeepWiki: Evaluation and Benchmarking", "last_modified": "2026-08-07T09:40:41.303058"}]
---

> [!WARNING]
> Imported from DeepWiki as generated, unverified repository documentation. Verify code-behavior claims against the revision below before stabilization.

# Evaluation and Benchmarking

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [scripts/base_eval.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_eval.py)
- [scripts/chat_eval.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_eval.py)

</details>



This page documents the evaluation and benchmarking systems used to measure model quality and training efficiency in nanochat. It covers validation metrics during training, the CORE score for base model capability assessment, the Time-to-GPT-2 leaderboard for measuring training speed, and performance metrics like Model FLOPs Utilization (MFU). For information about supervised fine-tuning evaluation with ChatCORE, see [ChatCORE Evaluation](deepwiki-07-03-chatcore-evaluation.md).

---

## Evaluation Metrics Overview

nanochat employs multiple evaluation metrics at different stages of the training pipeline:

| Metric | Purpose | Frequency | Target |
|--------|---------|-----------|--------|
| **Validation BPB** | Measure base model loss in vocab-size-invariant units | Every 250 steps (default) | Lower is better |
| **CORE Score** | 22-task ensemble for base model capability | Every 2000 steps (default) | ≥ 0.256525 (GPT-2 grade) |
| **Text Sampling** | Qualitative assessment of model behavior | Every 2000 steps (default) | Human evaluation |
| **MFU** | Hardware utilization efficiency | Every step | > 40% is good |
| **Tokens/sec** | Training throughput | Every step | Higher is better |

**Sources:** [scripts/base_train.py:72-78](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L72-L78), [nanochat/loss_eval.py:9-26](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/loss_eval.py#L9-L26)

---

## Evaluation Integration in Training Loop

The following diagram shows how different evaluation types are integrated into the base training loop, specifically showing the interaction between the training script `base_train.py` and evaluation modules.

```mermaid
flowchart TB
    subgraph "Training Loop (scripts/base_train.py)"
        [START_STEP] --> [FORWARD_BACKWARD]
        [FORWARD_BACKWARD] --> [OPTIMIZER_STEP]
        [OPTIMIZER_STEP] --> [LOG_METRICS]
    end
    
    subgraph "Evaluation Modules"
        [VAL_CHECK] -- "Yes" --> [evaluate_bpb]
        [CORE_CHECK] -- "Yes" --> [evaluate_core]
        [SAMPLE_CHECK] -- "Yes" --> [Engine_generate_batch]
    end
    
    [LOG_METRICS] --> [VAL_CHECK]
    [VAL_CHECK] -- "No" --> [CORE_CHECK]
    [evaluate_bpb] --> [CORE_CHECK]
    
    [CORE_CHECK] -- "No" --> [SAMPLE_CHECK]
    [evaluate_core] --> [SAMPLE_CHECK]
    
    [SAMPLE_CHECK] -- "No" --> [NEXT_STEP]
    [Engine_generate_batch] --> [NEXT_STEP]
```

**Sources:** [scripts/base_train.py:399-565](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L399-L565), [nanochat/loss_eval.py:31-33](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/loss_eval.py#L31-L33), [scripts/base_eval.py:57-123](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_eval.py#L57-L123)

---

## CORE Score and Validation Metrics

### Validation Bits Per Byte (BPB)

Validation BPB measures the model's compression efficiency on held-out data. It is calculated by converting the cross-entropy loss to bits and normalizing by the UTF-8 byte length of tokens. This metric is vocab-size-invariant, making it useful for comparing models with different tokenizers [nanochat/loss_eval.py:11-16](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/loss_eval.py#L11-L16).

**Implementation:**
- Evaluation occurs at intervals specified by `--eval-every` (default: 250 steps) [scripts/base_train.py:72](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L72).
- Uses `args.eval_tokens` worth of validation data (default: 20,971,520 tokens) [scripts/base_train.py:73](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L73).
- All DDP ranks participate, aggregating `total_nats` and `total_bytes` across the cluster using `dist.all_reduce` [nanochat/loss_eval.py:54-58](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/loss_eval.py#L54-L58).
- The `token_bytes` tensor is used to mask out special tokens (length 0) and ignore padded/masked targets [nanochat/loss_eval.py:23-26](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/loss_eval.py#L23-L26), [nanochat/loss_eval.py:42-53](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/loss_eval.py#L42-L53).

For details, see [CORE Score and Validation Metrics](deepwiki-09-01-core-score-and-validation-metrics.md).

**Sources:** [scripts/base_train.py:404-419](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L404-L419), [nanochat/loss_eval.py:9-65](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/loss_eval.py#L9-L65)

### CORE Score: 22-Task Ensemble

The CORE score is a capability metric that aggregates performance across 22 diverse NLP tasks including knowledge, reasoning, and language understanding. It uses the `evaluate_task` function to handle different task types like Multiple Choice (MC), Schema, and Language Modeling (LM) [nanochat/core_eval.py:168-173](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/core_eval.py#L168-L173).

**GPT-2 Threshold**: The benchmark target is to exceed `0.256525`, the CORE score achieved by the OpenAI GPT-2 (1.6B) checkpoint [scripts/base_eval.py:14-17](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_eval.py#L14-L17).

**Calculation Process:**

```mermaid
flowchart LR
    [load_model] --> [evaluate_core]
    
    subgraph "Task Types (nanochat/core_eval.py)"
        [batch_sequences_mc]
        [batch_sequences_schema]
        [batch_sequences_lm]
    end
    
    [evaluate_core] --> [batch_sequences_mc]
    [evaluate_core] --> [batch_sequences_schema]
    [evaluate_core] --> [batch_sequences_lm]
    
    [batch_sequences_mc] --> [evaluate_task]
    [batch_sequences_schema] --> [evaluate_task]
    [batch_sequences_lm] --> [evaluate_task]
    
    [evaluate_task] --> [centered_result]
    [centered_result] --> [core_metric]
```

**Implementation Details:**
- Evaluation triggered by `--core-metric-every` (default: 2000 steps) [scripts/base_train.py:74](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L74).
- `--max-per-task` in `scripts/base_eval.py` limits examples per task for faster estimation [scripts/base_eval.py:133](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_eval.py#L133).
- Random baselines for centering are loaded from `eval_meta_data.csv` [scripts/base_eval.py:78-83](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_eval.py#L78-L83).
- Prompt rendering utilizes Jinja2 templates for different task formats [nanochat/core_eval.py:17-83](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/core_eval.py#L17-L83).

For details, see [CORE Score and Validation Metrics](deepwiki-09-01-core-score-and-validation-metrics.md).

**Sources:** [scripts/base_eval.py:57-123](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_eval.py#L57-L123), [nanochat/core_eval.py:113-142](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/core_eval.py#L113-L142)

---

## Time-to-GPT-2 Leaderboard

The Time-to-GPT-2 leaderboard measures wall-clock time to train a model that exceeds GPT-2's CORE score on a standard 8×H100 GPU node.

### Leaderboard Concept

```mermaid
graph TB
    subgraph "Required Metrics"
        [total_training_time]
        [core_metric_threshold]
        [val_bpb]
    end
    
    subgraph "Submission Validation"
        [Codebase_Bloat_Check]
        [Miniseries_Generalization]
        [Wandb_Run_Link]
    end
    
    subgraph "Hardware Baseline"
        [H100_8x_Node]
        [Peak_BF16_TFLOPS]
    end
    
    [total_training_time] --> [core_metric_threshold]
    [core_metric_threshold] --> [Miniseries_Generalization]
    [H100_8x_Node] --> [total_training_time]
```

**Submission Requirements:**
- Must exceed the CORE threshold of 0.256525 [scripts/base_eval.py:14-17](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_eval.py#L14-L17).
- `total_training_time` is the primary ranking metric.
- Changes must be "miniseries" compatible, meaning they generalize across different `--depth` settings.

For details, see [Time-to-GPT-2 Leaderboard](deepwiki-09-02-time-to-gpt-2-leaderboard.md).

---

## Performance Metrics: MFU and Throughput

### Model FLOPs Utilization (MFU)

MFU measures the percentage of theoretical peak hardware performance achieved during training.

```
MFU = (actual_flops_per_sec) / (peak_flops_per_sec × num_gpus) × 100
```

**Calculation Details:**
1. **FLOP Estimation**: Calculated via `model.estimate_flops()` based on parameter count and sequence length [scripts/base_train.py:92-96](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L92-L96).
2. **Peak FLOPS**: Detected via `get_peak_flops(device_name)` in `nanochat/common.py` [nanochat/common.py:34](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L34).
3. **Throughput**: Calculated as `total_batch_size / dt` where `dt` is the step time [scripts/base_train.py:522-524](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L522-L524).

### Performance Optimization
The codebase includes several optimizations to maximize MFU:
- **Flash Attention 3**: Integrated for H100 GPUs [nanochat/gpt.py:25-30](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L25-L30).
- **FP8 Training**: Tensorwise and rowwise scaling using `torchao` [scripts/base_train.py:116-120](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L116-L120).
- **Distributed Muon**: Efficient large-matrix optimization with reduced communication overhead [nanochat/distributed_muon.py:10-15](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/distributed_muon.py#L10-L15).

For details, see [Performance Metrics: MFU and Throughput](deepwiki-09-03-performance-metrics-mfu-and-throughput.md).

**Sources:** [scripts/base_train.py:522-550](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L522-L550), [nanochat/common.py:34-56](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L34-L56), [nanochat/gpt.py:541-570](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L541-L570)

---

## Chat Model Evaluation

Supervised Fine-Tuned (SFT) models are evaluated using `scripts/chat_eval.py`. This script supports two primary evaluation modes:

1.  **Generative Evaluation**: Used for tasks like `GSM8K` and `HumanEval`. The `Engine` generates completions, which are then parsed and checked for correctness [scripts/chat_eval.py:28-80](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_eval.py#L28-L80).
2.  **Categorical Evaluation**: Used for tasks like `MMLU` and `ARC`. Instead of full generation, the script checks the model's logits at the answer position for the highest probability choice (e.g., A, B, C, D) [scripts/chat_eval.py:87-152](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_eval.py#L87-L152).

**Sources:** [scripts/chat_eval.py:1-152](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_eval.py#L1-L152)

---

## Command-Line Configuration

| Argument | Default | Purpose |
|----------|---------|---------|
| `--eval-every` | 250 | Steps between validation BPB [scripts/base_train.py:72](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L72) |
| `--eval-tokens` | 20,971,520 | Validation dataset size [scripts/base_train.py:73](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L73) |
| `--core-metric-every` | 2000 | Steps between CORE eval [scripts/base_train.py:74](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L74) |
| `--core-metric-max-per-task` | 500 | Max examples per task [scripts/base_train.py:75](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L75) |
| `--sample-every` | 2000 | Steps between text sampling [scripts/base_train.py:76](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L76) |

**Sources:** [scripts/base_train.py:72-81](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L72-L81)
