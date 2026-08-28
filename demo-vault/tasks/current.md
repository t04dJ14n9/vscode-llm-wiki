---
type: "Task"
title: "Evaluate the next demo corpus increment"
description: "Decide whether the next proposed paper batch belongs in the demo without weakening provenance or duplicating durable pages."
tags: ["operations", "reproducibility"]
status: "draft"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-25T00:57:53+08:00"}
---

# Evaluate the next demo corpus increment

The outcome of this task is one reviewed admission decision for the next paper
batch. First curate the source set with
[`source-corpus-curation.md`](../playbooks/source-corpus-curation.md), then use
the bulk-ingestion playbook to decide which existing pages should absorb the
evidence and whether any new durable page clears the admission bar.

## Completion criteria

- Every proposed source has one security-reviewed disposition.
- The frozen candidate manifest maps each accepted idea to an existing or
  approved target and records direct reasons for rejections.
- Answerability, refusal, recall coverage, citation integrity, and duplicate
  content have been evaluated.
- Completed manifests and reports are filed under `output`, and only unresolved
  actions remain in this task.

Nanochat implementation notes are out of scope. If a writable Nanochat checkout
is supplied, that knowledge belongs in its own `docs/llm-wiki/`.
