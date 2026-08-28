---
type: "Knowledge Vault"
title: "Upstream LLM Wiki demo vault"
description: "Reference-only registration of the public upstream demo as an independently versioned knowledge vault."
tags: ["federated-search", "knowledge-vault", "reference"]
status: "stable"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-25T16:30:00+08:00"}
vcs: "git"
repository_url: "https://github.com/t04dJ14n9/vscode-llm-wiki.git"
tracked_ref: "main"
observed_revision: "1ac415cb45350ee1d630cc7330baff7083c48424"
observed_at: "2026-08-25T16:30:00+08:00"
entrypoint: "demo-vault/README.md"
search_roots: ["demo-vault/wiki", "demo-vault/raw", "demo-vault/playbooks"]
vault_id: "upstream-demo-vault"
vault_profile: "okf-v0.2"
vault_status: "reference"
ownership: "Public upstream LLM Wiki demo content, reusable workflow examples, and extension-facing vault behavior."
---

# Upstream LLM Wiki demo vault

This card shows how a parent vault can describe another searchable vault
without copying its pages or adding a Git submodule. The pinned repository URL
and revision make the observation portable; `vault_status: "reference"` means
the parent does not require a local checkout.

## Search contract

- **Profile:** `okf-v0.2`
- **Entrypoint:** `demo-vault/README.md`
- **Search roots:** `demo-vault/wiki`, `demo-vault/raw`, and
  `demo-vault/playbooks`
- **Observed revision:** `1ac415cb45350ee1d630cc7330baff7083c48424`

If a user later supplies a working copy, its only local binding is the ignored
path `vaults/bindings/upstream-demo-vault`. Federated search must verify the Git
identity and observed revision before reading the declared roots. Editing the
child requires following that vault's own instructions and recording history
there, not in the parent.
