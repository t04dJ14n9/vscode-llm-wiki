# OKF Vault Profile

Use this reference when initializing, converting, restructuring, indexing, or
validating a vault.

## Bundle boundary

Choose one directory as the distribution root. Everything below that root is
inside the bundle unless it is an explicit opaque nested repository.

Keep these outside a strict bundle:

- reusable agent skills;
- producer scripts and tests;
- build artifacts and editor state.

The bundle may itself be a repository or a subdirectory of a larger
repository.

## Markdown contract

`index.md` and `log.md` are reserved at every level. Every other `.md` file is
an OKF concept and begins with YAML frontmatter containing a nonempty `type`.

The interoperable minimum is:

```yaml
---
type: Concept
---
```

For maintained knowledge, also provide:

```yaml
---
type: Concept
title: Byte-pair encoding
description: Subword tokenization learned by iterative pair merges.
tags: [tokenization]
status: stable
generated: {by: codex/gpt-5.6, at: 2026-08-13T00:00:00Z}
sources:
  - {id: bpe-paper, resource: ../raw/paper.md, title: Paper title}
---
```

Use descriptive open types. Consumers must tolerate unknown types and
extension fields.

## Hierarchical indexes

Give every visible bundle-owned directory an `index.md`.

- List only immediate children.
- Link a child directory to `child/`; consumers open its local `index.md`.
- Group concepts by exact `type`.
- Include a concept's title and description.
- List local binary or code resources in a resource section.
- Sort deterministically.
- Put only `okf_version: "0.2"` frontmatter on the bundle-root index.
- Put no frontmatter on nested indexes.

Do not descend into a Git submodule. Index it from the parent as an opaque code
resource.

Do not repartition automatically at a size threshold. Paths are concept IDs;
move them only in an explicit migration that updates references atomically.

## Links and provenance

Use ordinary Markdown links. Relative and `/bundle-relative` paths are both
valid. A concept ID omits `.md`; consumers SHOULD accept both the ID and the
explicit Markdown filename as navigation targets. External URLs remain
external.

Obsidian image embeds (`![[path/to/image.png|Alt text]]`) are a compatible body
extension. Resolve their targets from the bundle root; resolve ordinary
Markdown image paths from the containing document.

Record each derivation source:

```yaml
sources:
  - id: flash-attention-paper
    resource: ../raw/flashattention.md
    title: FlashAttention
```

Join a sourced body claim to that entry:

```markdown
The algorithm tiles attention to reduce memory traffic.[^flash-attention-paper]

[^flash-attention-paper]: FlashAttention
```

`generated` means authored. Add `verified` only after an actual verifier
checks the current content against its sources. Use `human:` only for a real
human review.

## Evidence and large files

Keep title-derived source companions in `raw/` and matching binaries under
`raw/assets/`. Route binary extensions—not `raw/assets/**`—through Git LFS so
`raw/assets/index.md` remains ordinary Git text.

Exclude databases, embeddings, caches, temporary extraction files, editor
state, and copied project repositories.

## Completion

Run the repository's index builder, index check, full validator, Git LFS
inspection, and submodule inspection. Treat a passing generic OKF parse as
necessary but not sufficient when the repository declares a stricter profile.
