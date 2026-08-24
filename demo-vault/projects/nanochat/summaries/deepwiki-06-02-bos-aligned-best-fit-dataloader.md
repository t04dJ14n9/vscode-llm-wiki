---
type: "Summary"
title: "DeepWiki: BOS-Aligned Best-Fit DataLoader"
description: "Imported DeepWiki page 6.2 about BOS-Aligned Best-Fit DataLoader."
tags: ["project-nanochat", "repository-documentation", "provenance"]
status: "draft"
code_scope: true
generated: {"by": "process:deepwiki-import", "at": "2026-08-07T09:40:41.303058Z"}
project: "nanochat"
provenance_state: "unverified"
repository: "nanochat"
revision: "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"
retrieved_at: "2026-08-24"
deepwiki: {"page_id": "6.2", "source_url": "https://deepwiki.com/karpathy/nanochat/6.2-bos-aligned-best-fit-dataloader", "indexed_revision": "92d63d4e", "content_sha256": "07b5e43dcec0fc5c0bf4b7513c8c54ea024506b2ddd37066dac16802bd0dcad6"}
sources: [{"id": "deepwiki-page", "resource": "https://deepwiki.com/karpathy/nanochat/6.2-bos-aligned-best-fit-dataloader", "title": "DeepWiki: BOS-Aligned Best-Fit DataLoader", "last_modified": "2026-08-07T09:40:41.303058"}]
---

> [!WARNING]
> Imported from DeepWiki as generated, unverified repository documentation. Verify code-behavior claims against the revision below before stabilization.

# BOS-Aligned Best-Fit DataLoader

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [nanochat/dataloader.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py)
- [nanochat/dataset.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py)

</details>



## Purpose and Scope

This document covers the BOS-aligned dataloader implementation in [nanochat/dataloader.py:1-166](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L1-L166). This dataloader ensures that every training sequence begins with a BOS (Beginning of Sequence) token, allowing the model to always have full document context during training. It uses a best-fit bin packing algorithm to minimize token waste while maintaining 100% batch utilization.

For the overall data pipeline context, see [Data Pipeline](deepwiki-06-data-pipeline.md). For tokenizer details, see [Dataset and Tokenizer](deepwiki-06-01-dataset-and-tokenizer.md). For conversation rendering during fine-tuning, see [SFT Data Loader and Task Mixture](deepwiki-06-04-sft-data-loader-and-task-mixture.md).

Sources: [nanochat/dataloader.py:1-17](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L1-L17), [nanochat/dataloader.py:74-95](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L74-L95)

## Overview

The BOS-aligned dataloader solves a fundamental problem with naive token streaming: sequences that start mid-document provide incomplete context to the model. The standard approach of streaming tokens into a flat buffer and reshaping into batches can result in rows like `[...doc1_end, doc2_middle, doc3_start...]` where the model must predict tokens without seeing document boundaries.

**Key Properties:**
- Every row starts with a BOS token [nanochat/dataloader.py:5](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L5)
- 100% batch utilization (no padding tokens) [nanochat/dataloader.py:8](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L8)
- Approximately 35% of tokens discarded due to cropping (at T=2048) [nanochat/dataloader.py:11](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L11)
- Distributed data sharding at the row group level [nanochat/dataloader.py:62-68](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L62-L68)
- Resumption support via `(pq_idx, rg_idx, epoch)` state tracking [nanochat/dataloader.py:40-42](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L40-L42)

**Function Signature:**
[nanochat/dataloader.py:74-79](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L74-L79)
```python
def tokenizing_distributed_data_loader_with_state_bos_bestfit(
    tokenizer, B, T, split,
    tokenizer_threads=4, tokenizer_batch_size=128,
    device="cuda", resume_state_dict=None,
    buffer_size=1000
):
```

Sources: [nanochat/dataloader.py:1-17](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L1-L17), [nanochat/dataloader.py:74-95](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L74-L95)

## The Problem: Mid-Document Sequences

### Original Dataloader Behavior

```mermaid
graph LR
    subgraph "Original Streaming Approach"
        D1["Document 1<br/>(BOS + 500 tokens)"]
        D2["Document 2<br/>(BOS + 1800 tokens)"]
        D3["Document 3<br/>(BOS + 300 tokens)"]
        Buffer["Flat Token Buffer"]
        Row1["Row 1: [BOS, doc1..., BOS, doc2_partial]"]
        Row2["Row 2: [doc2_middle, doc2_end, BOS, doc3...]"]

        D1 --> Buffer
        D2 --> Buffer
        D3 --> Buffer
        Buffer --> Row1
        Buffer --> Row2
    end
```

**Problem:** Row 2 starts with `doc2_middle` - the model has no BOS token and no document context for the first ~1300 tokens of this row. This "confusing" data is eliminated by the BOS-aligned loader.

Sources: [nanochat/dataloader.py:10-13](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L10-L13)

## Best-Fit Packing Algorithm

### Algorithm Overview

The best-fit algorithm balances two competing goals:
1. Minimize wasted tokens (cropping)
2. Maintain 100% batch utilization (no padding)

**Algorithm per Row:**

```mermaid
flowchart TD
    Start["Start Row<br/>pos=0, capacity=T+1"]
    Fill{"pos < capacity?"}
    Buffer["Ensure buffer has<br/>documents<br/>(refill if needed)"]
    Find["Find LARGEST doc<br/>that fits entirely:<br/>doc_len ≤ remaining<br/>AND doc_len is max"]
    Found{"Found doc?"}
    Pack["Pack entire doc<br/>into row<br/>pos += doc_len"]
    Crop["Crop shortest doc<br/>to fill remaining:<br/>doc[:remaining]<br/>pos = capacity"]
    Done["Row Complete"]

    Start --> Fill
    Fill --> Find
    Find --> Found
    Found -->|"Yes"| Pack
    Pack --> Fill
    Found -->|"No"| Crop
    Crop --> Done
```

Sources: [nanochat/dataloader.py:86-90](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L86-L90), [nanochat/dataloader.py:123-152](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L123-L152)

### Step-by-Step Example

Consider packing rows with `T=2048` (capacity = 2049 tokens including BOS):

| Step | Buffer Contents | Remaining Space | Action |
|------|----------------|-----------------|--------|
| 1 | [400, 1500, 200, 800] | 2049 | Pick 1500 (largest that fits) |
| 2 | [400, 200, 800] | 549 | Pick 400 (largest that fits) |
| 3 | [200, 800] | 149 | Pick none (800 > 149, 200 > 149) |
| 3b | [200, 800] | 149 | **Crop** shortest (200) → use first 149 tokens |

**Result:** One row contains 1500 + 400 + 149 = 2049 tokens, all starting from document boundaries except the final cropped segment.

Sources: [nanochat/dataloader.py:132-151](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L132-L151)

## Implementation Architecture

### Component Flow

```mermaid
graph TB
    subgraph "Document Source"
        Parquet["Parquet Files<br/>(base_data_climbmix/)"]
        DocBatch["_document_batches()<br/>Infinite iterator<br/>DDP-sharded"]
    end

    subgraph "Tokenization Layer"
        Tokenizer["tokenizer.encode()<br/>prepend=BOS<br/>num_threads=4"]
        DocBuffer["doc_buffer<br/>(list of token lists)<br/>buffer_size=1000"]
    end

    subgraph "Packing Layer"
        BestFit["Best-Fit Algorithm<br/>Search for largest fit<br/>Crop when needed"]
        RowBuffer["row_buffer<br/>[B, T+1]<br/>torch.Tensor"]
    end

    subgraph "GPU Transfer"
        PinnedCPU["Pinned CPU Buffer<br/>[2*B*T]<br/>(inputs + targets)"]
        GPU["GPU Buffer<br/>[2*B*T]<br/>device=cuda"]
    end

    Parquet --> DocBatch
    DocBatch -->|"(text_batch,<br/>state)"| Tokenizer
    Tokenizer -->|"token lists"| DocBuffer
    DocBuffer --> BestFit
    BestFit --> RowBuffer
    RowBuffer -->|"copy_"| PinnedCPU
    PinnedCPU -->|"HtoD transfer<br/>non_blocking"| GPU
    GPU -->|"yield<br/>(inputs, targets,<br/>state_dict)"| Output["Training Loop"]

    style BestFit fill:#f9f9f9
    style DocBatch fill:#f9f9f9
```

Sources: [nanochat/dataloader.py:74-161](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L74-L161), [nanochat/dataset.py:27](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py#L27)

### Buffer Management

The implementation uses three levels of buffering:

**1. Document Buffer** [nanochat/dataloader.py:101-109](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L101-L109)
```python
doc_buffer = []  # List of tokenized documents (List[List[int]])
buffer_size = 1000  # Target number of documents to keep buffered
```

**2. Row Buffer** [nanochat/dataloader.py:114](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L114)
```python
row_buffer = torch.empty((B, row_capacity), dtype=torch.long)
# Capacity = T+1 to hold inputs[:-1] and targets[1:]
```

**3. Transfer Buffers** [nanochat/dataloader.py:115-120](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L115-L120)
```python
# Single allocation for both inputs and targets
cpu_buffer = torch.empty(2 * B * T, dtype=torch.long, pin_memory=use_cuda)
gpu_buffer = torch.empty(2 * B * T, dtype=torch.long, device=device)

# Views into the buffers
cpu_inputs = cpu_buffer[:B * T].view(B, T)
cpu_targets = cpu_buffer[B * T:].view(B, T)
```

**Efficiency:** The pinned CPU buffer and pre-allocated GPU buffer enable a single efficient host-to-device transfer per batch via `gpu_buffer.copy_(cpu_buffer, non_blocking=use_cuda)`.

Sources: [nanochat/dataloader.py:111-121](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L111-L121), [nanochat/dataloader.py:160](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L160)

## Distributed Data Sharding

### DDP Row Group Sharding

```mermaid
graph TB
    subgraph "Parquet File Structure"
        PF["shard_00042.parquet<br/>row groups total"]
    end

    subgraph "8 DDP Ranks (world_size=8)"
        R0["Rank 0<br/>rg: 0, 8, 16, 24, ..."]
        R1["Rank 1<br/>rg: 1, 9, 17, 25, ..."]
        R2["Rank 2<br/>rg: 2, 10, 18, 26, ..."]
        R7["Rank 7<br/>rg: 7, 15, 23, 31, ..."]
    end

    PF --> R0
    PF --> R1
    PF --> R2
    PF --> R7

    subgraph "Sharding Formula"
        Formula["rg_idx = ddp_rank + N * ddp_world_size<br/>where N = 0, 1, 2, ..."]
    end
```

Each DDP rank processes a non-overlapping subset of row groups. The pattern ensures no data duplication across ranks.

**Implementation:** [nanochat/dataloader.py:62-68](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L62-L68)
```python
rg_idx = ddp_rank
while rg_idx < pf.num_row_groups:
    rg = pf.read_row_group(rg_idx)
    batch = rg.column('text').to_pylist()
    # ... process batch ...
    rg_idx += ddp_world_size  # Step by world_size
```

Sources: [nanochat/dataloader.py:25-72](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L25-L72), [nanochat/dataset.py:76-81](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py#L76-L81)

## State Management and Resumption

### Resume State Dictionary

The dataloader tracks three pieces of state for exact resumption:

```python
state_dict = {
    "pq_idx": int,    # Current parquet file index
    "rg_idx": int,    # Current row group index within file
    "epoch": int      # How many times we've cycled through dataset (starts at 1)
}
```

**Resumption Logic:** [nanochat/dataloader.py:40-60](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L40-L60)
- When resuming, start from `resume_rg_idx // ddp_world_size`
- Advance by +1 to avoid repeating the last processed batch [nanochat/dataloader.py:55](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L55)
- Resume only on first pass, then reset to normal DDP sharding [nanochat/dataloader.py:60](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L60)

```mermaid
flowchart LR
    subgraph "Normal Training"
        T1["Step 100<br/>pq=5, rg=24"]
        T2["Step 101<br/>pq=5, rg=32"]
        T3["Step 102<br/>pq=5, rg=40"]
    end

    subgraph "Crash & Resume"
        Save["Checkpoint saved<br/>state={pq:5, rg:24, epoch:1}"]
        Restart["Restart from checkpoint"]
        R1["Resume at<br/>base=(24//8)=3<br/>actual_rg=(3+1)*8+rank=32+rank"]
        Continue["Continue training<br/>from rg=32+rank"]
    end

    T1 --> Save
    Save --> Restart
    Restart --> R1
    R1 --> Continue
    Continue --> T2
```

**Key Insight:** Adding +1 to the base index ensures we skip the last batch seen before the checkpoint, preventing data duplication.

Sources: [nanochat/dataloader.py:40-60](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L40-L60)

### Multi-Epoch Training

```mermaid
graph LR
    subgraph "Epoch Tracking"
        E1["Epoch 1<br/>pq: 0→169"]
        E2["Epoch 2<br/>pq: 0→169"]
        E3["Epoch 3<br/>pq: 0→169"]
    end

    E1 -->|"pq_idx wraps"| E2
    E2 -->|"pq_idx wraps"| E3

    subgraph "State Updates"
        Loop["while True:<br/>  for pq in files:<br/>    yield batches<br/>  epoch += 1"]
    end
```

The outer infinite loop [nanochat/dataloader.py:47-71](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L47-L71) increments the epoch counter each time all parquet files are exhausted. This enables:
- Training for more than one pass through the dataset
- Tracking training progress in terms of epochs
- Proper resumption even in multi-epoch scenarios [nanochat/dataloader.py:42-45](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L42-L45)

Sources: [nanochat/dataloader.py:47-71](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L47-L71)

## Performance Characteristics

### Token Waste Analysis

The implementation achieves 100% token utilization (no padding) while discarding roughly 35% of tokens to maintain BOS alignment.

| Metric | Value | Notes |
|--------|-------|-------|
| **Tokens Cropped** | ~35% | Discarded when documents don't fit [nanochat/dataloader.py:8](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L8) |
| **Batch Utilization** | 100% | No padding tokens [nanochat/dataloader.py:8](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L8) |

**Algorithm Comparison:**
The `best-fit` search (Step 1) picks the LARGEST doc that fits entirely [nanochat/dataloader.py:87](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L87). When nothing fits (Step 2), it crops the SHORTEST doc in the buffer to fill the remaining space [nanochat/dataloader.py:148-150](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L148-L150). This combination minimizes waste compared to a naive greedy approach.

Sources: [nanochat/dataloader.py:4-17](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L4-L17), [nanochat/dataloader.py:81-95](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L81-L95)

## Code Structure

### Main Entry Points

**1. With State Tracking** [nanochat/dataloader.py:74-161](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L74-L161)
```python
tokenizing_distributed_data_loader_with_state_bos_bestfit(...)
# Yields: (inputs, targets, state_dict)
```
Used by training scripts that need checkpoint resumption.

**2. Without State Tracking** [nanochat/dataloader.py:163-166](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L163-L166)
```python
tokenizing_distributed_data_loader_bos_bestfit(...)
# Yields: (inputs, targets)
```
Helper that omits state_dict from yields for simpler iteration.

### Internal Functions

**Document Iteration:** [nanochat/dataloader.py:25-72](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L25-L72)
```python
def _document_batches(split, resume_state_dict, tokenizer_batch_size):
    """
    Infinite iterator over document batches from parquet files.
    Handles DDP sharding and approximate resume.

    Yields: (text_batch, (pq_idx, rg_idx, epoch))
    """
```

This function:
- Loads parquet files via `list_parquet_files()` [nanochat/dataset.py:32-65](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py#L32-L65)
- Splits train/val: last parquet is validation [nanochat/dataloader.py:38](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L38)
- Shards row groups across DDP ranks [nanochat/dataloader.py:62-68](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L62-L68)
- Handles multi-epoch cycling [nanochat/dataloader.py:47-71](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L47-L71)
- Manages resumption state [nanochat/dataloader.py:40-60](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L40-L60)

Sources: [nanochat/dataloader.py:25-72](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L25-L72)
