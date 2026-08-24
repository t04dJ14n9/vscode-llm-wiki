---
type: "Query"
title: "How can a reader reproduce the pipeline?"
description: "A layered reproduction checklist that distinguishes repository setup, smoke tests, and the full GPU speedrun."
tags: ["operations", "project-nanochat", "reproducibility", "training-systems"]
status: "draft"
code_scope: true
generated: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
sources: [{"id": "project", "resource": "../README.md", "title": "Nanochat project-vault overview"}, {"id": "readme", "resource": "../../code/nanochat/README.md", "title": "Nanochat README", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "README.md"}, {"id": "speedrun", "resource": "../../code/nanochat/runs/speedrun.sh", "title": "Nanochat speedrun", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "runs/speedrun.sh"}, {"id": "cpu-run", "resource": "../../code/nanochat/runs/runcpu.sh", "title": "Nanochat CPU run", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "runs/runcpu.sh"}]
source_state: "awaiting-source"
condensed_summary: "A layered reproduction checklist that distinguishes repository setup, smoke tests, and the full GPU speedrun."
project: "nanochat"
conversation: {"selection_id": "migration-2026-08-23-how-can-a-reader-reproduce-the-pipeline"}
anchors: [{"source_id": "project", "kind": "markdown", "resource": "../README.md", "start_line": 1, "end_line": 1}, {"source_id": "readme", "kind": "code", "resource": "../../code/nanochat/README.md", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "README.md", "start_line": 1, "end_line": 1}, {"source_id": "speedrun", "kind": "code", "resource": "../../code/nanochat/runs/speedrun.sh", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "runs/speedrun.sh", "start_line": 1, "end_line": 1}, {"source_id": "cpu-run", "kind": "code", "resource": "../../code/nanochat/runs/runcpu.sh", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "runs/runcpu.sh", "start_line": 1, "end_line": 1}]
---

# How can a reader reproduce the pipeline?

## Answer

Reproduce in layers. First reproduce the source and navigation; then a CPU-scale
functional path; only then attempt the eight-GPU speedrun. This separates
“the code runs” from “the published wall-time and quality target are
replicated.”

## Evidence trail

1. Clone the outer repository with Git LFS. Provision the registered Nanochat
   source at `projects/code/nanochat` only when code verification or execution
   is needed, and confirm its HEAD against the project-vault overview.[^project]
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
defines stage order, and [language-model evaluation](../../../concepts/language-model-evaluation.md)
defines what to compare after each checkpoint.

## Limits

This vault does not include dataset shards, checkpoints, or a GPU environment.
The studied code revision is pinned in metadata, but the in-place working copy
is not distributed; remote datasets and package artifacts can still change
unless independently archived. A CPU smoke test verifies control flow, not
speedrun quality.

## Related pages

- [Nanochat model family](../entities/nanochat-model-family.md)
- [What dominates a Nanochat training run](what-dominates-a-nanochat-training-run.md)
- [Nanochat end-to-end training pipeline](../summaries/nanochat-end-to-end-training-pipeline.md)

[^project]: Nanochat project-vault overview
[^readme]: Nanochat README
[^speedrun]: Nanochat speedrun
[^cpu-run]: Nanochat CPU run
