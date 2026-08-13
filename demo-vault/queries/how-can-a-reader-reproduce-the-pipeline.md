---
type: "Query"
title: "How can a reader reproduce the pipeline?"
description: "A layered reproduction checklist that distinguishes repository setup, smoke tests, and the full GPU speedrun."
tags: ["operations", "project-nanochat", "reproducibility", "training-systems"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "project", "resource": "../projects/nanochat.md", "title": "Nanochat project card"}, {"id": "readme", "resource": "../projects/code/nanochat/README.md", "title": "Nanochat README", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}, {"id": "speedrun", "resource": "../projects/code/nanochat/runs/speedrun.sh", "title": "Nanochat speedrun", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}, {"id": "cpu-run", "resource": "../projects/code/nanochat/runs/runcpu.sh", "title": "Nanochat CPU run", "commit": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"}]
---

# How can a reader reproduce the pipeline?

## Answer

Reproduce in layers. First reproduce the source and navigation; then a CPU-scale
functional path; only then attempt the eight-GPU speedrun. This separates
“the code runs” from “the published wall-time and quality target are
replicated.”

## Evidence trail

1. Clone the outer repository with Git LFS and initialize submodules. Confirm
   Nanochat HEAD equals the project card’s full pinned commit.[^project]
2. Read the upstream prerequisites and choose CPU, single-GPU, or speedrun
   scope.[^readme]
3. Use `runs/runcpu.sh` for a tiny end-to-end mechanics check that avoids
   claiming realistic quality.[^cpu-run]
4. For the full path, provision the intended eight-H100 class environment,
   inspect storage/network requirements, and run `runs/speedrun.sh` while
   capturing its exact environment and output.[^speedrun]
5. Record dataset shard state, package lock, GPU/driver versions, flags, seed,
   checkpoint identifiers, and evaluation outputs.
6. Validate this OKF bundle separately with the workflows in `AGENTS.md`; wiki
   integrity is not model-training success.

The [pipeline summary](../summaries/nanochat-end-to-end-training-pipeline.md)
defines stage order, and [language-model evaluation](../concepts/language-model-evaluation.md)
defines what to compare after each checkpoint.

## Limits

This vault does not include dataset shards, checkpoints, or a GPU environment.
The submodule is pinned, but remote datasets and package artifacts can still
change unless independently archived. A CPU smoke test verifies control flow,
not speedrun quality.

## Related pages

- [Nanochat model family](../entities/nanochat-model-family.md)
- [What dominates a Nanochat training run](what-dominates-a-nanochat-training-run.md)
- [Nanochat end-to-end training pipeline](../summaries/nanochat-end-to-end-training-pipeline.md)

[^project]: Nanochat project card
[^readme]: Nanochat README
[^speedrun]: Nanochat speedrun
[^cpu-run]: Nanochat CPU run
