---
type: "Summary"
title: "DeepWiki: Performance Metrics: MFU and Throughput"
description: "Imported DeepWiki page 9.3 about Performance Metrics: MFU and Throughput."
tags: ["project-nanochat", "repository-documentation", "provenance"]
status: "draft"
code_scope: true
generated: {"by": "process:deepwiki-import", "at": "2026-08-07T09:40:41.303058Z"}
project: "nanochat"
provenance_state: "unverified"
repository: "nanochat"
revision: "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"
retrieved_at: "2026-08-24"
deepwiki: {"page_id": "9.3", "source_url": "https://deepwiki.com/karpathy/nanochat/9.3-performance-metrics:-mfu-and-throughput", "indexed_revision": "92d63d4e", "content_sha256": "3e9850ae47d9394791085a0433b6b2c23e5a3e1dceb916759496ab48ef077ec2"}
sources: [{"id": "deepwiki-page", "resource": "https://deepwiki.com/karpathy/nanochat/9.3-performance-metrics:-mfu-and-throughput", "title": "DeepWiki: Performance Metrics: MFU and Throughput", "last_modified": "2026-08-07T09:40:41.303058"}]
---

> [!WARNING]
> Imported from DeepWiki as generated, unverified repository documentation. Verify code-behavior claims against the revision below before stabilization.

# Performance Metrics: MFU and Throughput

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [nanochat/common.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py)
- [scripts/infer_bench.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/infer_bench.py)

</details>



## Purpose and Scope

This page documents the performance metrics used to measure training efficiency and inference speed in `nanochat`: **Model FLOPs Utilization (MFU)**, **Model Bandwidth Utilization (MBU)**, and **tokens per second (throughput)**. These metrics quantify how efficiently the training and inference processes utilize available GPU compute and memory resources. For evaluation of model quality, see 9.1 CORE Score and Validation Metrics. For wall-clock time measurements in the leaderboard context, see 9.2 Time-to-GPT-2 Leaderboard.

---

## Overview

Training and inference efficiency are measured through several complementary metrics:

| Metric | Symbol | Unit | Context | What It Measures |
|--------|--------|------|---------|------------------|
| **Throughput** | `tok_per_sec` | tokens/sec | Training/Inference | Raw data processing speed |
| **Model FLOPs Utilization** | `mfu` | percentage | Training | Hardware efficiency (actual vs theoretical peak FLOPS) |
| **Model Bandwidth Utilization** | `mbu` | percentage | Inference | Memory efficiency (actual vs theoretical peak GB/s) |
| **Time to First Token** | `ttft` | seconds | Inference | Prefill latency for the initial prompt |

These metrics are calculated during each training step and logged to both console output and `wandb`. In inference, they are used to trace the trade-off curve between latency and throughput.

**Sources:** [scripts/base_train.py:547-562](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L547-L562), [scripts/infer_bench.py:9-17](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/infer_bench.py#L9-L17), [nanochat/common.py:118-121](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L118-L121)

---

## Training Step Performance Calculation

The core performance measurement happens within the training loop after each optimization step in `scripts/base_train.py`.

### Performance Calculation Data Flow

```mermaid
flowchart TB
    [Start] --> [Sync0]
    [Sync0] --> [T0]

    subgraph "Optimization Step"
        [Forward]
        [Backward]
        [Opt]
    end

    [T0] --> [Forward]
    [Forward] --> [Backward]
    [Backward] --> [Opt]
    [Opt] --> [Sync1]

    [Sync1] --> [T1]
    [T1] --> [Measure]

    [Measure] --> [CalcTok]
    [Measure] --> [CalcFlops]
    [CalcFlops] --> [CalcMFU]

    [CalcTok] --> [Log]
    [CalcMFU] --> [Log]

    [Sync0]["torch.cuda.synchronize()"]
    [T0]["t0 = time.time()"]
    [Forward]["model.forward()"]
    [Backward]["loss.backward()"]
    [Opt]["optimizer.step()"]
    [Sync1]["torch.cuda.synchronize()"]
    [T1]["t1 = time.time()"]
    [Measure]["dt = t1 - t0"]
    [CalcTok]["tok_per_sec = total_batch_size / dt"]
    [CalcFlops]["flops_per_sec = num_flops_per_token * total_batch_size / dt"]
    [CalcMFU]["mfu = 100 * flops_per_sec / (gpu_peak_flops * ddp_world_size)"]
    [Log]["Log to Console & Wandb"]
```

**Timing Methodology:**
- [scripts/base_train.py:503-504](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L503-L504): The timer starts with `torch.cuda.synchronize()` before the forward pass to ensure the GPU is ready.
- [scripts/base_train.py:536-539](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L536-L539): The timer ends with `torch.cuda.synchronize()` after the `optimizer.step()` to wait for all asynchronous GPU kernels to finish.
- The `dt` (delta time) represents the full wall-clock duration of one optimization step, including gradient accumulation if applicable [scripts/base_train.py:540](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L540).

**Sources:** [scripts/base_train.py:503-540](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L503-L540)

---

## Model FLOPs Utilization (MFU)

### Definition

MFU measures what percentage of the GPU's theoretical peak FLOPS are actually being utilized during training:

```
MFU = (Actual FLOPS per second / Theoretical Peak FLOPS) × 100%
```

### Calculation Formula

In `scripts/base_train.py`, MFU is calculated as:

```python
flops_per_sec = num_flops_per_token * total_batch_size / dt
mfu = 100 * flops_per_sec / (gpu_peak_flops * ddp_world_size)
```

**Components:**
1. **`num_flops_per_token`**: Estimated FLOPs per token from `model.estimate_flops()` [scripts/base_train.py:259](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L259).
2. **`total_batch_size`**: Tokens processed per step [scripts/base_train.py:402](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L402).
3. **`dt`**: Time per step in seconds [scripts/base_train.py:540](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L540).
4. **`gpu_peak_flops`**: Theoretical peak FLOPS for the specific GPU detected by `get_peak_flops()` [nanochat/common.py:224](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L224).
5. **`ddp_world_size`**: Number of GPUs in the distributed group [scripts/base_train.py:86](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L86).

**Sources:** [scripts/base_train.py:548-549](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L548-L549), [nanochat/common.py:224-278](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L224-L278)

---

## FLOP Estimation: `estimate_flops` Method

The `estimate_flops()` method in `nanochat/gpt.py` calculates the number of floating-point operations required to process a single token through the model architecture.

### Components of FLOP Calculation

```mermaid
graph TB
    [EstFlops] --> [Embed]
    [EstFlops] --> [Attn]
    [EstFlops] --> [MLP]
    [EstFlops] --> [Unembed]
    [EstFlops] --> [Scores]
    [Scores] --> [Window]

    [EstFlops]["GPT.estimate_flops()"]
    subgraph "Linear Operations (6N)"
        [Embed]["Token Embeddings (vocab_size * n_embd)"]
        [Attn]["Attention Projections (c_q, c_k, c_v, c_proj)"]
        [MLP]["MLP Projections (c_fc, c_proj)"]
        [Unembed]["Unembedding Head (n_embd * vocab_size)"]
    end
    subgraph "Attention Mechanism"
        [Scores]["Attention Scores (2 * n_layer * n_head * head_dim * seq_len)"]
        [Window]["Window Pattern Adjustment"]
    end
```

### Sliding Window Correction

The `estimate_flops` method accounts for sliding window attention patterns specified by `window_pattern` in `GPTConfig` [nanochat/gpt.py:29-39](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L29-L39).
- **"L"** (Long/Full): Standard $O(T^2)$ attention.
- **"S"** (Short/Sliding): Attention limited to a quarter window, reducing FLOPs for those layers [nanochat/gpt.py:330-334](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L330-L334).
The pattern is tiled across the model depth to provide an accurate estimate of total operations [nanochat/gpt.py:330-336](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L330-L336).

**Sources:** [nanochat/gpt.py:29-39](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L29-L39), [nanochat/gpt.py:314-345](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L314-L345)

---

## Peak FLOPS Lookup: `get_peak_flops`

The `get_peak_flops()` function in `nanochat/common.py` provides theoretical peak BF16 FLOPS for various GPU architectures by parsing the device name.

### Implementation Logic

```mermaid
flowchart LR
    [Input] --> [Parse]
    [Parse] --> [H100]
    [Parse] --> [A100]
    [Parse] --> [L40S]
    [Parse] --> [AMD]
    [Parse] --> [RTX]

    [H100] --> [Output]
    [A100] --> [Output]
    [L40S] --> [Output]
    [AMD] --> [Output]
    [RTX] --> [Output]

    [Parse] -.->|"No Match"| [Fallback]
    [Fallback] --> [Output]

    [Input]["torch.cuda.get_device_name(0)"]
    [Parse]["Pattern Match Name"]
    [H100]["H100 (SXM/PCIe)"]
    [A100]["A100 (SXM/PCIe)"]
    [L40S]["L40S / L4"]
    [AMD]["MI300X / MI250X"]
    [RTX]["RTX 4090 / 3090"]
    [Output]["Peak FLOPS (float)"]
    [Fallback]["Unknown GPU -> inf"]
```

### Peak FLOPS Table (Selected)

| GPU | BF16 Peak FLOPS | Reference |
|-----|-----------------|-----------|
| **NVIDIA H100 SXM5** | 989 TFLOPS | [nanochat/common.py:233](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L233) |
| **NVIDIA H100 PCIe** | 756 TFLOPS | [nanochat/common.py:235](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L235) |
| **NVIDIA A100 SXM4** | 312 TFLOPS | [nanochat/common.py:240](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L240) |
| **AMD MI300X** | 1,307 TFLOPS | [nanochat/common.py:255](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L255) |
| **RTX 4090** | 165 TFLOPS | [nanochat/common.py:263](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L263) |

The function returns `float('inf')` for unknown GPUs to prevent misleading MFU calculations [nanochat/common.py:277](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L277).

**Sources:** [nanochat/common.py:224-278](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L224-L278)

---

## Inference Benchmarking (MBU and Throughput)

Inference performance is measured in `scripts/infer_bench.py` across two regimes: **Prefill** (compute-bound) and **Decode** (memory-bandwidth-bound) [scripts/infer_bench.py:9-13](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/infer_bench.py#L9-L13).

### Model Bandwidth Utilization (MBU)

MBU is the decode counterpart of training MFU. It measures achieved bytes/sec over the peak bandwidth of the GPU [scripts/infer_bench.py:15-17](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/infer_bench.py#L15-L17).

**Calculation:**
In `scripts/infer_bench.py`, the calculation involves comparing weight and KV cache reads against the peak bandwidth [scripts/infer_bench.py:132-136](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/infer_bench.py#L132-L136).
```python
# Every decode step reads all weights + KV cache
bytes_per_step = weight_bytes + kv_read_bytes
mbu = (bytes_per_step / step_time) / peak_bandwidth
```

### Inference Metrics

| Metric | Calculation / Definition | Code Reference |
|--------|--------------------------|----------------|
| **Weight Bytes** | `sum(p.numel() * p.element_size())` | [scripts/infer_bench.py:51-53](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/infer_bench.py#L51-L53) |
| **KV Cache Size** | Bytes per token based on `n_layer`, `n_kv_head`, and `head_dim` | [nanochat/gpt.py:347-350](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L347-L350) |
| **TTFT** | Time to First Token (Prefill + first sample) | [scripts/infer_bench.py:61-68](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/infer_bench.py#L61-L68) |
| **TPOT** | Time Per Output Token (Average decode step time) | [scripts/infer_bench.py:71-79](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/infer_bench.py#L71-L79) |

**Sources:** [scripts/infer_bench.py:9-17](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/infer_bench.py#L9-L17), [scripts/infer_bench.py:51-82](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/infer_bench.py#L51-L82), [nanochat/gpt.py:347-360](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L347-L360)

---

## Real-Time Monitoring and Logging

### Console Output

Performance metrics appear in the training loop's console output via `print0` every step [scripts/base_train.py:562](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L562):

```
step 01234/20000 (6.17%) | loss: 2.3456 | lrm: 1.00 | dt: 180.23ms | tok/sec: 2,912,711 | bf16_mfu: 52.34 | ...
```

### Wandb Logging

Metrics are logged to `wandb` with the following keys [scripts/base_train.py:563-575](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L563-L575):

| Wandb Key | Description |
|-----------|-------------|
| `train/tok_per_sec` | Tokens processed per second |
| `train/mfu` | Model FLOPs Utilization (%) |
| `train/dt` | Wall-clock duration of the optimization step (seconds) |
| `total_training_time` | Cumulative time spent in optimization (excluding first 10 steps) |

**Warmup Exclusion:** The first 10 training steps are excluded from `total_training_time` to avoid skewing the average with JIT compilation or initialization overhead [scripts/base_train.py:550-551](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L550-L551).

**Sources:** [scripts/base_train.py:550-575](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L550-L575)

---

## Optimization and Hardware Efficiency

### Efficiency Checklist

1. **Flash Attention 3 (FA3):** Integrated via `nanochat/flash_attention.py`. FA3 is significantly more efficient on Hopper GPUs. If unavailable, the system falls back to PyTorch SDPA [nanochat/flash_attention.py:11-20](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/flash_attention.py#L11-L20).
2. **FP8 Training:** Enabled with `--fp8` [scripts/base_train.py:47](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L47). This uses `torchao` to perform linear operations in 8-bit, typically increasing throughput on H100s.
3. **Sliding Window Attention:** Controlled by `window_pattern` [nanochat/gpt.py:39](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L39). Patterns like "SSSL" reduce total FLOPs and memory pressure during inference.
4. **Compute Dtype:** Automatically detected via `_detect_compute_dtype()` [nanochat/common.py:17](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L17). `bfloat16` is preferred for hardware acceleration on Ampere+ GPUs [nanochat/common.py:25](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L25).

**Sources:** [nanochat/flash_attention.py:11-20](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/flash_attention.py#L11-L20), [nanochat/gpt.py:39](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py#L39), [nanochat/common.py:17-31](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L17-L31), [scripts/base_train.py:47](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py#L47)
