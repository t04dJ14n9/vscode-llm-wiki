---
type: "Summary"
title: "DeepWiki: Development Guide"
description: "Imported DeepWiki page 13 about Development Guide."
tags: ["project-nanochat", "repository-documentation", "provenance"]
status: "draft"
code_scope: true
generated: {"by": "process:deepwiki-import", "at": "2026-08-07T09:40:41.303058Z"}
project: "nanochat"
provenance_state: "unverified"
repository: "nanochat"
revision: "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"
retrieved_at: "2026-08-24"
deepwiki: {"page_id": "13", "source_url": "https://deepwiki.com/karpathy/nanochat/13-development-guide", "indexed_revision": "92d63d4e", "content_sha256": "4c0d3bd5e8690c7bf076080a0280084d671b20b16a4353da93c85873e13c9747"}
sources: [{"id": "deepwiki-page", "resource": "https://deepwiki.com/karpathy/nanochat/13-development-guide", "title": "DeepWiki: Development Guide", "last_modified": "2026-08-07T09:40:41.303058"}]
---

> [!WARNING]
> Imported from DeepWiki as generated, unverified repository documentation. Verify code-behavior claims against the revision below before stabilization.

# Development Guide

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- .gitignore
- [tests/test_execution.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/tests/test_execution.py)
- [tests/test_optim.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/tests/test_optim.py)
- [tests/test_tasks.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/tests/test_tasks.py)
- [tests/test_tokenizer.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/tests/test_tokenizer.py)

</details>



This guide provides essential information for developers contributing to `nanochat`. It covers the repository structure, development workflows, testing conventions, and contribution guidelines. The goal is to help you navigate the codebase, understand where different components live, and follow the project's development practices.

For information about training models, see [Base Model Pretraining](deepwiki-03-base-model-pretraining.md). For details on the model architecture, see [Model Architecture](deepwiki-04-model-architecture.md). For inference deployment, see [Inference and Deployment](deepwiki-10-inference-and-deployment.md).

---

## Repository Structure

The `nanochat` repository is organized into a simple, flat directory structure that separates concerns clearly: core library code, executable scripts, evaluation tasks, orchestration scripts, development artifacts, and tests.

For a detailed breakdown of the file system, see [Repository Structure](deepwiki-13-01-repository-structure.md).

### Directory Layout

| Directory | Purpose |
|:---|:---|
| `nanochat/` | Core library modules (infrastructure) nanochat/ |
| `scripts/` | Executable entry points (training, eval, inference) scripts/ |
| `tasks/` | Evaluation benchmark implementations tasks/ |
| `runs/` | Orchestration shell scripts runs/ |
| `dev/` | Development logs, documentation, and leaderboard dev/ |
| `tests/` | Test suite tests/ |

### Core Library (`nanochat/`)

The `nanochat/` directory contains the foundational modules used across all training, evaluation, and inference scripts. These are pure Python library code with no entry points.

| Module | Purpose | Key Entities |
|:---|:---|:---|
| `common.py` | Device management, DDP utilities, logging | `COMPUTE_DTYPE`, `compute_init()`, `autodetect_device_type()` [nanochat/common.py:20](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L20) |
| `gpt.py` | Transformer model definition | `GPT`, `GPTConfig`, `Block` |
| `optim.py` | Hybrid optimizer | `MuonAdamW`, `DistMuonAdamW` [nanochat/optim.py:19](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py#L19) |
| `dataloader.py` | Distributed data loading with packing | `tokenizing_distributed_data_loader_bos_bestfit()` |
| `engine.py` | Inference engine with KV cache | `Engine`, `KVCache`, `sample_next_token` [nanochat/engine.py:82-169](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py#L82-L169) |
| `flash_attention.py` | Unified FA3/SDPA interface | `flash_attn_func`, `flash_attn_with_kvcache` [nanochat/flash_attention.py:107-131](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/flash_attention.py#L107-L131) |
| `checkpoint_manager.py` | Model serialization | `save_checkpoint()`, `load_model()` [nanochat/checkpoint_manager.py:21](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/checkpoint_manager.py#L21) |
| `execution.py` | Sandboxed code execution | `execute_code()`, `ExecutionResult` [nanochat/execution.py:11](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/execution.py#L11) |

### Repository Structure Diagram

```mermaid
graph TB
    subgraph "EntryPoints"
        [Scripts] --> ["scripts/<br/>Python modules (-m)<br/>★ Executable"]
        [Runs] --> ["runs/<br/>Shell scripts<br/>★ Orchestration"]
    end

    subgraph "CoreInfrastructure"
        [Nanochat] --> ["nanochat/<br/>Library modules<br/>★ Imported by scripts"]
        [Tasks] --> ["tasks/<br/>Benchmark definitions<br/>★ Evaluation logic"]
    end

    subgraph "SupportingFiles"
        [Tests] --> ["tests/<br/>pytest test suite"]
        [Dev] --> ["dev/<br/>Logs & utilities"]
        [Config] --> ["pyproject.toml<br/>Dependencies"]
        [Lock] --> ["uv.lock<br/>Reproducible builds"]
    end

    [Runs] -->|"bash runs/speedrun.sh"| [Scripts]
    [Scripts] -->|"import nanochat.*"| [Nanochat]
    [Scripts] -->|"import tasks.*"| [Tasks]
    [Tests] -->|"import nanochat.*"| [Nanochat]
    [Tests] -->|"import scripts.*"| [Scripts]

    [Config] -->|"uv sync"| [Lock]
```

**Sources:** [nanochat/engine.py:1-12](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py#L1-L12), [nanochat/checkpoint_manager.py:21](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/checkpoint_manager.py#L21), [nanochat/flash_attention.py:1-15](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/flash_attention.py#L1-L15), [nanochat/execution.py:11](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/execution.py#L11), [nanochat/optim.py:19](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py#L19)

---

## Development Workflow

### Setting Up the Development Environment

`nanochat` uses `uv` for dependency management, providing fast, reproducible builds with a lockfile.

**1. Clone and Install:**
The project uses `pyproject.toml` to manage dependencies, including specific indices for CPU and GPU variants of PyTorch.

```bash
uv sync --extra gpu --group dev
source .venv/bin/activate
```

### Making Changes

**Quick Iteration Loop:**
For rapid experimentation, the recommended workflow is to train a small model (e.g., depth 12, ~5 minutes), observe metrics, modify code, and repeat.

```bash
OMP_NUM_THREADS=1 torchrun --standalone --nproc_per_node=8 -m scripts.base_train -- \
    --depth=12 \
    --run="d12" \
    --model-tag="d12" \
    --core-metric-every=999999 \
    --sample-every=-1 \
    --save-every=-1
```

**Key metrics to monitor in wandb:**
1. `val_bpb` (bits per byte) vs `step`, `total_training_time`, and `total_training_flops`.
2. `core_metric` (DCLM CORE score).
3. `train/mfu` (Model FLOPs Utilization) and `train/tok_per_sec`.

### The "Complexity Dial" Design Philosophy

All changes must work across the entire model size spectrum via the `--depth` parameter. When you set `--depth`, the system automatically scales hyperparameters like width, heads, and learning rates. Your improvements must be principled enough to generalize via scaling laws.

### Development Workflow Diagram

```mermaid
graph LR
    subgraph "LocalDevelopment"
        [Edit] --> ["Edit code<br/>nanochat/*.py<br/>scripts/*.py"]
        [Test] --> ["Run tests<br/>pytest tests/"]
        [Experiment] --> ["Quick experiment<br/>scripts.base_train --depth=12"]
    end

    subgraph "Validation"
        [Monitor] --> ["Monitor metrics<br/>val_bpb, core_metric<br/>mfu, tok_per_sec"]
        [Sweep] --> ["Test across depths<br/>d12, d16, d20, d24"]
        [Speedrun] --> ["Full speedrun<br/>runs/speedrun.sh"]
    end

    subgraph "Contribution"
        [PR] --> ["Create Pull Request"]
        [Review] --> ["Qualitative review<br/>Not gnarly/bloated<br/>Generalizable<br/>Principled"]
        [Merge] --> ["Merge to master<br/>Update leaderboard"]
    end

    [Edit] --> [Test]
    [Test] --> [Experiment]
    [Experiment] --> [Monitor]
    [Monitor] -->|"Improvement?"| [Sweep]
    [Sweep] -->|"Works for all depths?"| [Edit]
    [Speedrun] -->|"CORE > 0.256525?"| [PR]
    [PR] --> [Review]
    [Review] --> [Merge]

    [Monitor] -->|"No improvement"| [Edit]
    [Sweep] -->|"Fails at some depth"| [Edit]
```

**Sources:** [nanochat/common.py:20](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py#L20), [nanochat/optim.py:19](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py#L19)

---

## Testing and Validation

For detailed documentation on the test suite and validation patterns, see [Testing and Validation](deepwiki-13-02-testing-and-validation.md).

### Running Tests

`nanochat` uses `pytest` for its test suite. Tests are located in the `tests/` directory.

**Run all tests:**
```bash
python -m pytest tests/ -v
```

### Key Test Coverage

The test suite includes critical validation for hardware compatibility, optimizer behavior, and engine logic:
- **Attention Fallback:** Ensuring that the `flash_attn` module correctly switches between Flash Attention 3 (FA3) on Hopper GPUs and PyTorch SDPA on other hardware [nanochat/flash_attention.py:2-15](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/flash_attention.py#L2-L15).
- **Optimizer Determinism:** `MuonAdamW` is tested to ensure identical parameters across bitwise identical runs [tests/test_optim.py:64-78](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/tests/test_optim.py#L64-L78).
- **Sandboxed Execution:** The tool-use execution environment is tested against memory limits, timeouts, and adversarial system calls [tests/test_execution.py:26-51](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/tests/test_execution.py#L26-L51).
- **Tokenizer Round-trips:** Verifying BPE encoding/decoding and conversation masking [tests/test_tokenizer.py:31-80](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/tests/test_tokenizer.py#L31-L80).
- **Task Mixture:** Ensuring `TaskMixture` covers examples deterministically and handles oversampling [tests/test_tasks.py:46-64](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/tests/test_tasks.py#L46-L64).

### Testing and Validation Diagram

```mermaid
graph TB
    subgraph "AutomatedTests"
        [Pytest] --> ["pytest tests/"]
        [AttnTests] --> ["Attention Fallback<br/>tests/test_attention_fallback.py"]
        [OptimTests] --> ["MuonAdamW Logic<br/>tests/test_optim.py"]
        [ExecTests] --> ["Sandbox Security<br/>tests/test_execution.py"]
    end

    subgraph "HardwareAndSafety"
        [FA3] --> ["_load_flash_attention_3<br/>Hopper/sm90 Check"]
        [SDPA] --> ["_sdpa_attention<br/>Fallback Logic"]
        [Sandbox] --> ["execute_code<br/>timeout & memory limits"]
    end

    subgraph "CoreLogic"
        [Muon] --> ["Muon Update<br/>Orthogonalization check"]
        [KVCache] --> ["KVCache<br/>In-place updates"]
    end

    [Pytest] --> [AttnTests]
    [Pytest] --> [OptimTests]
    [Pytest] --> [ExecTests]

    [AttnTests] --> [FA3]
    [AttnTests] --> [SDPA]
    [ExecTests] --> [Sandbox]
    [OptimTests] --> [Muon]
    [AttnTests] --> [KVCache]
```

**Sources:** [nanochat/flash_attention.py:23-102](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/flash_attention.py#L23-L102), [tests/test_optim.py:64-115](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/tests/test_optim.py#L64-L115), [tests/test_execution.py:11-51](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/tests/test_execution.py#L11-L51), [tests/test_tokenizer.py:10-80](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/tests/test_tokenizer.py#L10-L80), [tests/test_tasks.py:46-64](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/tests/test_tasks.py#L46-L64)

---

## Infrastructure and Utilities

### Checkpoint Management

`nanochat` includes a robust checkpointing system capable of saving and loading model states for resuming training or inference [nanochat/checkpoint_manager.py:21](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/checkpoint_manager.py#L21).

### Calculator Tool Integration

The `Engine` supports a secure calculator tool that allows the model to perform math and string operations during generation. This is backed by `nanochat.execution` which provides:
- **Safety:** Disabling destructive functions like `os.system` or `shutil.rmtree` [tests/test_execution.py:41-51](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/tests/test_execution.py#L41-L51).
- **Resource Limits:** Enforcement of timeouts and memory limits to prevent runaway processes [tests/test_execution.py:26-39](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/tests/test_execution.py#L26-L39).
- **Isolation:** Environment scrubbing and temporary directory management for file writes [tests/test_execution.py:58-71](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/tests/test_execution.py#L58-L71).

**Sources:** [nanochat/flash_attention.py:1-15](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/flash_attention.py#L1-L15), [nanochat/checkpoint_manager.py:21](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/checkpoint_manager.py#L21), [nanochat/execution.py:11](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/execution.py#L11), [tests/test_execution.py:11-84](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/tests/test_execution.py#L11-L84)
