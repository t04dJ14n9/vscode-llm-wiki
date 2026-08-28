# EmbedPDF headless migration spike

This spike tests replacing the custom PDF viewer architecture with EmbedPDF's
headless components while preserving the LLM Wiki host protocol and UI
ownership.

It registers the headless plugins needed by the LLM Wiki viewer:

- document manager
- viewport and scroll
- render
- interaction manager
- selection
- zoom and pan
- spread layouts
- search
- thumbnails and bookmarks

The toolbar, selection actions, PDF anchors, and `selectionChanged` message are
implemented by LLM Wiki in `embedpdf-viewer-spike.tsx`.

## Result

The headless architecture is a viable replacement for rendering, scrolling,
hit testing, ordinary text selection, selection rectangles, zoom/fit and
gesture zoom, all four single/two-page continuous/paginated modes, search,
thumbnails, outlines, and pan.

The stock selection plugin is not a complete replacement for LLM Wiki's
selection semantics:

- GQA page 2 caption-to-left-column selection stays in one reading flow and
  does not leak into the right column.
- DeepSeek-V2 equation (19) is returned in correct visual equation order.
- Stock selection interprets a vertical SmolLM table-column drag as a
  contiguous source range. The spike adds a small LLM Wiki-owned rectangular
  adapter built from page geometry and text slices; the same drag now yields
  exactly `25.6 24.8 22.4 22.7`.

LLM Wiki retains ownership of its toolbar and docking preference, agent actions,
anchor/query overlays, internal-link hover previews and navigation history,
and the rectangular table-selection adapter. These are adapters over EmbedPDF
rather than a second reading-order engine.

The production port should use EmbedPDF as the viewer/selection foundation and
remove the current flow/grid/corridor resolver. Table columns remain an
explicit geometry operation layered after ordinary linear selection.

## Verification

```sh
pnpm build:extension
pnpm typecheck
pnpm exec playwright test --config playwright.config.ts \
  packages/vscode-extension/test/e2e/embedpdf-headless-spike.spec.ts
```

The production build emits one shared `pdfium.wasm` plus approximately 1.35 MiB
of headless spike JavaScript split across the entry and engine chunks. A VS Code
webview port must provide CSP-compatible chunk loading and the webview URI for
`pdfium.wasm`.
