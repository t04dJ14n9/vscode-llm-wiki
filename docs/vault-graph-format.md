# Future vault graph format

This document fixes the data contract for a later graph-view phase. It does not
change the current graph implementation.

## Nodes

Each Markdown file below a recognized `wiki/` root is one node, except generated
`_index.md` files. Node label, type, lifecycle status, and tags come from the
existing frontmatter. Templates, summaries, playbooks, raw sources, project
cards, assets, workbench pages, and ignored code bindings are not nodes.

## Edges

Edges come only from validated `relations[]`. Direction is always the current
page to `target`; the edge displays `kind` and `caption`. Body links and
provenance references remain ordinary navigation and never create implicit
edges. Targets are paths relative to the same recognized wiki root, so a graph
is portable and cannot escape into another vault.

## Future interaction

Invoking the future graph from a wiki page should focus that page and show its
incoming and outgoing depth-one neighborhood, with depth-two and full-graph
controls. Invoking it outside `wiki/` should open the full wiki graph without a
focused node. Filters should support tags, and visible edges should expose both
kind and caption. Directed layout, node navigation, filtering UI, and webview
replacement are explicitly deferred.
