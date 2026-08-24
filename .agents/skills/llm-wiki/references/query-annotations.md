# Query annotations

A Query requires title, description, lifecycle, generated metadata, a one- or
two-sentence `condensed_summary` of at most 360 Unicode code points,
`conversation.selection_id`, `sources[]`, and `anchors[]`. Each anchor has a
unique `source_id` bound to one source.

Markdown anchors record resource, document SHA-256, quote, context, offsets,
and lines. Resolve exact hash/offset first; otherwise relocate only a unique
quote plus context. PDF anchors record PDF SHA-256, 1-based page, exact
top-left-origin point rectangles, quote, and context; suppress geometry after
a hash mismatch. Code anchors record repository, revision, path, optional
symbol, lines, and a verified hash for stable claims. Hover is local-only.
