---
type: "Software Project"
title: "Nanochat"
description: "Repository overview, studied baseline, working-copy status, and entry point for the Nanochat code vault."
resource: "https://github.com/karpathy/nanochat"
tags: ["language-models", "project-nanochat", "reproducibility", "training-systems"]
status: "stable"
generated: {"by": "process:project-vault-migration", "at": "2026-08-24T00:00:00+08:00"}
sources: [{"id": "nanochat-repository", "resource": "https://github.com/karpathy/nanochat", "title": "Nanochat repository"}]
repository: "nanochat"
vcs: "git"
repository_url: "https://github.com/karpathy/nanochat.git"
default_ref: "master"
vault_path: "nanochat"
code_path: "code/nanochat"
workspace: "in-place"
studied_revision: "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd"
studied_at: "2026-08-23T13:38:07Z"
project_status: "active"
code_state: "missing"
current_task: "nanochat/tasks/current.md"
ongoing_change: "DeepWiki repository-documentation verification pending"
license: "MIT"
---

# Nanochat

Nanochat is Karpathy's compact end-to-end language-model training and
inference repository. Its executable path covers data preparation and tokenizer
training, base-model pretraining and evaluation, supervised chat finetuning,
reinforcement learning, serving, and chat evaluation.[^nanochat-repository]

## Repository baseline

- VCS: Git.
- Default ref: `master`.
- Studied revision: `92d63d4e8bb4df75c3b71618f31ddde2378b2bcd`.
- Knowledge status: active, with code-backed pages still draft.
- Working copy: expected at `code/nanochat/` but currently absent. It is always
  an in-place checkout managed by its own VCS and ignored by the outer vault
  repository.

The working copy may advance independently. `studied_revision` changes only
after its diff and affected knowledge have been reviewed.

## Codebase map

The speedrun is the shortest architecture map: prepare data and train the
tokenizer, train and evaluate the base model, then perform chat finetuning and
evaluation. The repository's tokenizer, model, training scripts, optimizer,
evaluation, and inference engine are the main evidence surfaces.

Open the self-contained [Nanochat code vault](nanochat/) for its
[pipeline narrative](nanochat/summaries/nanochat-end-to-end-training-pipeline.md),
[imported repository documentation](nanochat/summaries/deepwiki-01-overview.md),
[durable code Queries](nanochat/queries/), and
[current task](nanochat/tasks/current.md). Higher-level [papers](../raw/),
[concepts](../concepts/), and [comparisons](../comparisons/) stay in the outer
vault.

## Current work

The current task is to verify the imported DeepWiki discovery map against the
studied commit once the in-place working copy is available. Detailed state
belongs in [`tasks/current.md`](nanochat/tasks/current.md); this card keeps only
the short catalog-level status.

## Knowledge boundary

The code checkout is not distributed with the vault. Code claims retain their
historical commit and path, but remain `draft`/`awaiting-source` until the
in-place checkout is available and content hashes are verified.

[^nanochat-repository]: Nanochat repository
