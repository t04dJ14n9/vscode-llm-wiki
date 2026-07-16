# Human Learning Reference Model

This is the short authoritative reference for current link and locator behavior.

## Current Decision

Human Learning uses native Markdown and Obsidian-compatible links as the
user-facing persisted format. `hl://` is not generated for MVP notes.

SQLite stores parsed graph edges, link status, chunk locators, anchors, and web
fallback targets. Markdown remains readable outside the extension.

## Link Formats

| Target | Format |
| --- | --- |
| Notes | `[[Online Softmax#Why This Matters]]` |
| Code | `[kernel](raw/code/attention.cu#L42-L57)` |
| PDF page | `[paper p7](raw/pdf/flash-attention.pdf#page=7)` |
| PDF text selection | `[selected text](raw/pdf/flash-attention.pdf#page=7:~:text=selected%20text)` |
| Web native section | `[section](https://example.com/article#results)` |
| Web text fragment | `[quote](https://example.com/article#:~:text=selected%20text)` |
| Web fallback target | `[DOM block](https://example.com/article#hl-web=web_abc123)` |

## Target Classification

`classifyReferenceTarget()` classifies link targets by scheme, path, file
extension, and fragment.

```text
note:
  *.md

pdf:
  *.pdf
  raw/pdf/...
  #page=
  :~:text=

code:
  known code extension
  #L42
  #L42-L57

web:
  http://
  https://
  #hl-web=

image:
  gif, jpeg, jpg, png, svg, webp

text:
  txt, text
```

## Graph Storage

The parser writes every graph edge to `links`:

```text
from_note_path
from_line
to_uri
to_anchor_id
label
relation
created_by
status
```

`to_uri` is the native target string. Backlinks query exact target URIs.

## PDF Locator Model

Chunks are retrieval units. Anchors are durable arbitrary selections.

```text
PDF ingestion -> chunks with metadata_json
Search result -> portable page/text-fragment link
Arbitrary selection -> portable link; highlight may also create an internal anchor row
```

Chunk metadata includes page range, block type, reading order, text offsets,
future rectangles, source hash, and chunk hash.

Anchor metadata includes page, rects, text item offsets when available, quote
offset, quote length, text hash, source hash, confidence, and status.
Internal chunk and anchor IDs never appear in user-facing PDF links.

## Web Locator Model

Prefer native web URLs:

```text
https://example.com/article#results
https://example.com/article#:~:text=selected%20text
```

Use `web_targets` only when the browser cannot produce a durable native target.
The fallback id is referenced through:

```text
https://example.com/article#hl-web=web_abc123
```

Chrome is the preferred open target. VS Code's external URL opener is the
fallback path in the current implementation.

## Agent Rules

Agents should:

- preserve markdown portability
- use wikilinks for notes when appropriate
- use relative markdown links for code and PDFs
- use normal URLs for web references
- cite PDF chunks returned from search directly
- create anchors only for arbitrary selections outside stable chunks
- never fabricate chunk IDs, anchor IDs, web target IDs, or PDF geometry
- use `qmd` for local hybrid retrieval/reranking when configured
