---
type: "Concept"
title: "Byte-pair encoding"
description: "A subword vocabulary learned by repeatedly merging frequent adjacent symbols."
tags: ["tokenization", "language-models", "project-nanochat"]
status: "draft"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-24T20:14:36+08:00"}
sources: [{"id": "bpe-paper", "resource": "../../raw/neural-machine-translation-of-rare-words-with-subword-units.md", "title": "Neural Machine Translation of Rare Words with Subword Units"}, {"id": "nanochat-tokenizer", "resource": "../../projects/code/nanochat/nanochat/tokenizer.py", "title": "Nanochat tokenizer", "repository": "nanochat", "revision": "92d63d4e8bb4df75c3b71618f31ddde2378b2bcd", "path": "nanochat/tokenizer.py"}]
created: {"by": "codex/gpt-5.6", "at": "2026-08-13T00:00:00Z"}
source_state: "awaiting-source"
relations: [{"target": "concepts/bits-per-byte.md", "kind": "references", "caption": "bits-per-byte metric"}, {"target": "concepts/chat-formatting.md", "kind": "references", "caption": "Chat formatting"}]
---

# Byte-pair encoding

## Definition

Byte-pair encoding (BPE) represents text using a learned inventory between
characters/bytes and whole words. Starting from small symbols, training counts
adjacent pairs and repeatedly promotes frequent pairs into new vocabulary
entries. The resulting finite merge table lets common fragments use fewer
tokens while retaining a fallback for unfamiliar text.[^bpe-paper]

## Mechanism

Merge rank matters: encoding applies learned merges in their trained order, so
the tokenizer is an algorithm plus vocabulary, not simply a word list. Vocabulary
size trades sequence length against embedding/output-table size. A model and its
tokenizer must agree on token IDs and special tokens at every stage.

## Nanochat connection

Nanochat trains a 32,768-token BPE vocabulary with RustBPE, converts it to a
tiktoken-compatible representation for inference, and appends reserved chat
tokens.[^nanochat-tokenizer] Its
[bits-per-byte metric](bits-per-byte.md) helps compare tokenizers and models
without making raw token count the unit of comparison.

## Related pages

- [Chat formatting](chat-formatting.md)

[^bpe-paper]: [Neural Machine Translation of Rare Words with Subword Units](../../raw/neural-machine-translation-of-rare-words-with-subword-units.md)
[^nanochat-tokenizer]: Nanochat tokenizer
