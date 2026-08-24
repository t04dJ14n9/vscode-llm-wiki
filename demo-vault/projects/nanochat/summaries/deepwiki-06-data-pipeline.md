---
type: "Summary"
title: "DeepWiki: Data Pipeline"
description: "Imported DeepWiki page 6 about Data Pipeline."
tags: ["project-nanochat", "repository-documentation", "provenance"]
status: "draft"
code_scope: true
generated: {"by": "process:deepwiki-import", "at": "2026-08-07T09:40:41.303058Z"}
project: "nanochat"
provenance_state: "unverified"
repository: "nanochat"
revision: "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"
retrieved_at: "2026-08-24"
deepwiki: {"page_id": "6", "source_url": "https://deepwiki.com/karpathy/nanochat/6-data-pipeline", "indexed_revision": "92d63d4e", "content_sha256": "655ed0cb3b174cdd475b914fb1138031b03d833608fcce9e3b29ba2bdb2c3b61"}
sources: [{"id": "deepwiki-page", "resource": "https://deepwiki.com/karpathy/nanochat/6-data-pipeline", "title": "DeepWiki: Data Pipeline", "last_modified": "2026-08-07T09:40:41.303058"}]
---

> [!WARNING]
> Imported from DeepWiki as generated, unverified repository documentation. Verify code-behavior claims against the revision below before stabilization.

# Data Pipeline

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [nanochat/dataloader.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py)
- [nanochat/dataset.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py)

</details>



The data pipeline system manages the flow of training data from raw Parquet shards to GPU tensors, implementing a sophisticated BOS-aligned Best-Fit packing algorithm that achieves 100% token utilization with zero padding. The pipeline handles distributed data loading across DDP ranks, supports exact resumption of training, and provides efficient memory transfer through a multi-stage buffer architecture.

This page provides an overview of the data pipeline architecture and data flow. For detailed information on specific components:
- Dataset structure and tokenizer training: see [Dataset and Tokenizer](deepwiki-06-01-dataset-and-tokenizer.md)
- BOS-aligned packing algorithm internals: see [BOS-Aligned Best-Fit DataLoader](deepwiki-06-02-bos-aligned-best-fit-dataloader.md)
- DDP sharding and resume mechanics: see [Distributed Data Loading and State Management](deepwiki-06-03-distributed-data-loading-and-state-management.md)
- SFT-specific data handling: see [SFT Data Loader and Task Mixture](deepwiki-06-04-sft-data-loader-and-task-mixture.md)

## Pipeline Architecture Overview

The data pipeline consists of three major layers: the dataset layer (Parquet files), the distributed loading layer (document iteration and DDP sharding), and the packing layer (BOS-aligned Best-Fit with memory buffers).

Title: "Data Pipeline Architecture"
```mermaid
graph TB
    subgraph "Dataset Layer"
        ["download_single_file"] -- "Fetch" --> ["Local_Parquet_Shards"]
        ["Local_Parquet_Shards"] -- "list_parquet_files" --> ["File_Paths"]
    end

    subgraph "Document Iteration Layer"
        ["File_Paths"] -- "parquets_iter_batched" --> ["Row_Groups"]
        ["Row_Groups"] -- "_document_batches" --> ["Text_Batches"]
        ["Text_Batches"] -- "tokenizer.encode" --> ["Token_Lists"]
    end

    subgraph "Packing & Buffer Layer"
        ["Token_Lists"] --> ["doc_buffer"]
        ["doc_buffer"] -- "Best-Fit Search" --> ["row_buffer"]
        ["row_buffer"] -- "Pin Memory" --> ["cpu_buffer"]
        ["cpu_buffer"] -- "HtoD Transfer" --> ["gpu_buffer"]
    end

    subgraph "Output Tensors"
        ["gpu_buffer"] -- "View" --> ["inputs"]
        ["gpu_buffer"] -- "View" --> ["targets"]
        ["_document_batches"] -- "Metadata" --> ["state_dict"]
    end
```

**Sources:** [nanochat/dataloader.py:1-167](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L1-L167), [nanochat/dataset.py:1-161](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py#L1-L161)

## Dataset: ClimbMix-400B

The base pretraining dataset is ClimbMix-400B, a curated mixture of high-quality web text, code, and math [nanochat/dataset.py:20-28](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py#L20-L28).

| Property | Value |
|----------|-------|
| Dataset Name | ClimbMix-400B |
| HuggingFace Path | `karpathy/climbmix-400b-shuffle` |
| Base URL | `https://huggingface.co/datasets/karpathy/climbmix-400b-shuffle/resolve/main` |
| Number of Shards | 6543 (0-6542) |
| Filename Pattern | `shard_{index:05d}.parquet` |
| Local Directory | `base_data_climbmix/` |
| Validation Shard | Last shard (6542) |
| Training Shards | All except last (0-6541) |

The dataset is downloaded on-demand via `download_single_file()` [nanochat/dataset.py:84-133](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py#L84-L133) with exponential backoff retry logic. The `list_parquet_files()` [nanochat/dataset.py:32-65](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py#L32-L65) function discovers all `.parquet` files in the data directory and returns their full paths, excluding temporary `.tmp` files. It includes a migration warning for users still using the legacy FineWeb-EDU directory [nanochat/dataset.py:38-56](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py#L38-L56).

**Sources:** [nanochat/dataset.py:20-28](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py#L20-L28), [nanochat/dataset.py:32-65](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py#L32-L65), [nanochat/dataset.py:84-134](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py#L84-L134)

## Tokenizer Training

The tokenizer is a Byte Pair Encoding (BPE) model trained using the `RustBPETokenizer` library [scripts/tok_train.py:9-9](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/tok_train.py#L9-L9). It is trained on up to 2 billion characters from the `ClimbMix` dataset [scripts/tok_train.py:17-17](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/tok_train.py#L17-L17).

Title: "Tokenizer Training and Evaluation Flow"
```mermaid
graph LR
    subgraph "Training Process"
        ["parquets_iter_batched"] -- "Text Stream" --> ["text_iterator"]
        ["text_iterator"] -- "2B Chars" --> ["RustBPETokenizer.train_from_iterator"]
        ["RustBPETokenizer.train_from_iterator"] -- "Save" --> ["tokenizer_dir"]
    end

    subgraph "Metadata Generation"
        ["tokenizer_dir"] -- "decode_single_token_bytes" --> ["token_bytes.pt"]
    end
```

Key features of the tokenizer pipeline include:
- **Vocabulary Size**: Defaulted to 32,768 (2^15) [scripts/tok_train.py:19-19](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/tok_train.py#L19-L19).
- **Token Byte Mapping**: The script generates a `token_bytes.pt` file mapping every token ID to its raw byte length [scripts/tok_train.py:76-91](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/tok_train.py#L76-L91). This is used for calculating Bits Per Byte (BPB), a metric invariant to vocabulary size [scripts/tok_train.py:72-75](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/tok_train.py#L72-L75).
- **Evaluation**: The `scripts/tok_eval.py` script measures compression ratios across diverse text types including Korean, Math (LaTeX), and Python code [scripts/tok_eval.py:18-65](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/tok_eval.py#L18-L65).

**Sources:** [scripts/tok_train.py:1-92](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/tok_train.py#L1-L92), [scripts/tok_eval.py:1-65](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/tok_eval.py#L1-L65)

## Core Dataloader: BOS-Aligned Best-Fit

The primary dataloader is `tokenizing_distributed_data_loader_with_state_bos_bestfit()` [nanochat/dataloader.py:74-79](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L74-L79), which implements a packing algorithm that ensures every sequence row starts with a BOS token and achieves 100% token utilization by cropping documents when necessary.

Title: "Best-Fit Packing Logic"
```mermaid
graph LR
    subgraph "tokenizing_distributed_data_loader_with_state_bos_bestfit"
        ["refill_buffer"] -- "Fetch & Tokenize" --> ["doc_buffer"]

        subgraph "Packing Loop"
            ["doc_buffer"] -- "Find Largest Fitting" --> ["row_buffer"]
            ["row_buffer"] -- "If None Fit" --> ["Crop Shortest"]
        end

        ["row_buffer"] -- "B*T View" --> ["cpu_inputs"]
        ["row_buffer"] -- "B*T View" --> ["cpu_targets"]
        ["cpu_buffer"] -- "copy_" --> ["gpu_buffer"]
    end
```

### Key Properties

- **BOS Alignment**: Every row begins with `BOS` token [nanochat/dataloader.py:100-107](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L100-L107), ensuring every token can attend back to the start of a document [nanochat/dataloader.py:11-13](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L11-L13).
- **100% Utilization**: No padding tokens—every position contains a training token [nanochat/dataloader.py:93-93](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L93-L93).
- **Cropping Waste**: Approximately 35% of tokens are cropped at `T=2048` to maintain alignment [nanochat/dataloader.py:94-94](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L94-L94).
- **Best-Fit Strategy**: Searches `doc_buffer` for the largest fitting document to minimize waste [nanochat/dataloader.py:132-140](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L132-L140).
- **Fallback Cropping**: When no document fits, the loader crops the shortest document in the buffer to fill the remaining space exactly [nanochat/dataloader.py:147-151](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L147-L151).

**Sources:** [nanochat/dataloader.py:1-167](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L1-L167)

## Distributed Data Loading and DDP Sharding

The `_document_batches()` [nanochat/dataloader.py:25-32](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L25-L32) iterator handles DDP sharding by offsetting the row group index by rank and stepping by world size [nanochat/dataloader.py:68-68](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L68-L68). This ensures each rank processes disjoint subsets of the data without overlap.

### Resume Mechanism

The dataloader supports exact resumption by tracking three indices in the state dictionary:
- `pq_idx`: Which parquet file is currently being read [nanochat/dataloader.py:102-102](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L102-L102).
- `rg_idx`: Which row group within that file is being processed [nanochat/dataloader.py:102-102](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L102-L102).
- `epoch`: How many times the dataset has been fully traversed [nanochat/dataloader.py:102-102](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L102-L102).

When resuming, the loader advances by one step (`base_idx += 1`) [nanochat/dataloader.py:55-55](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L55-L55) to avoid repeating the last batch seen before the checkpoint.

**Sources:** [nanochat/dataloader.py:25-72](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L25-L72)

## Memory Buffer Architecture

The dataloader employs a three-stage buffer architecture to minimize memory allocations and achieve a single efficient Host-to-Device transfer per batch.

1. **`row_buffer`**: Shape `(B, T+1)`, used to construct individual rows using best-fit packing [nanochat/dataloader.py:114-114](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L114-L114). The extra token allows shifting to create input/target pairs.
2. **`cpu_buffer`**: Shape `(2*B*T)`, pinned memory on CPU. Provides contiguous layout for both inputs and targets [nanochat/dataloader.py:115-115](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L115-L115).
3. **`gpu_buffer`**: Shape `(2*B*T)`, allocated on GPU device. Receives the single `copy_` operation with `non_blocking=True` [nanochat/dataloader.py:116-116](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L116-L116).

The layout `[inputs (B*T) | targets (B*T)]` in both CPU and GPU buffers allows the use of convenient views (`cpu_inputs`, `cpu_targets`, `inputs`, `targets`) without additional memory overhead [nanochat/dataloader.py:117-120](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L117-L120).

**Sources:** [nanochat/dataloader.py:111-161](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L111-L161)

## Data Flow Summary

The complete data flow from Parquet files to GPU tensors:

1. **Download Phase**: `download_single_file()` fetches shards from HuggingFace with retry logic.
2. **Discovery Phase**: `list_parquet_files()` identifies available shards, separating train/val.
3. **DDP Iteration**: `_document_batches()` yields document batches with DDP sharding and state tracking.
4. **Tokenization**: Documents are tokenized in parallel threads with BOS prepended.
5. **Best-Fit Packing**: Documents are packed into fixed-length rows using the best-fit algorithm.
6. **Buffer Transfer**: Row data is copied to CPU staging, then transferred to GPU in a single operation.
7. **Training Consumption**: The `inputs` and `targets` views provide training data to the model.

For detailed explanations of each component, see the subsection pages [Dataset and Tokenizer](deepwiki-06-01-dataset-and-tokenizer.md), [BOS-Aligned Best-Fit DataLoader](deepwiki-06-02-bos-aligned-best-fit-dataloader.md), [Distributed Data Loading and State Management](deepwiki-06-03-distributed-data-loading-and-state-management.md), and [SFT Data Loader and Task Mixture](deepwiki-06-04-sft-data-loader-and-task-mixture.md).

**Sources:** [nanochat/dataloader.py:1-167](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py#L1-L167), [nanochat/dataset.py:1-161](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py#L1-L161)
