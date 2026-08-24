# LLM Wiki: PDF Viewer and Selection Handoff

> Current behavior of the combined desktop extension in VS Code and Cursor.
> For the full system, see
> [Architecture and VS Code Integration](architecture-and-vscode-integration.md).

## 1. Current boundary

The combined extension is the product. It reads PDF bytes through the VS Code
extension host and renders them locally with the bundled EmbedPDF/PDFium
webview. The renderer does not upload the document.

The reader supports local search, page and outline navigation, zoom and fit
modes, continuous or paginated navigation, one- or two-page layouts, and exact
text selection. PDF text and glyph geometry come from PDFium, so a selection
can survive zoom and layout changes without relying on stretched browser text.

The active PDF workflow is filesystem-first:

- the PDF stays unchanged;
- learning answers are readable Markdown;
- annotation geometry and viewer state are inspectable JSON;
- Git can diff, merge, and restore those files;
- the combined extension does not require SQLite, a CLI, or an MCP server.

## 2. What a PDF anchor is

An anchor is the durable description of the selected source passage. It is not
a screenshot, a search chunk, or a database row.

Each PDF selection anchor records complementary selectors:

| Selector | Stored value | Purpose |
| --- | --- | --- |
| Exact quote | Selected text, with optional prefix and suffix | Lets any scanner recover and verify the original passage |
| Page | One-based PDF page | Gives a portable page-level fallback |
| Geometry | Every selection rectangle | Restores the precise visual highlight |
| Text position | Optional start/end text-item and character offsets | Qualifies the selection when PDFium exposes stable offsets |

Rectangles use `[left, top, right, bottom]` in PDF points (`pt`, 1/72 inch),
measured right and down from the page's top-left origin. A multi-line selection
has multiple rectangles. These are page coordinates, not viewport pixels, so
they do not change with zoom.

The canonical extracted quote, page, and rectangles are deliberately
redundant. Consumers that do not understand the optional text offsets can
still locate the original text, and the current viewer can draw the original
highlight.

Learning notes use an ordinary repository-relative PDF link such as:

```markdown
[Open source](../../papers/paper.pdf#page=7)
```

The anchor keeps the canonical quote and geometry even when the visible link
uses only its portable page fragment.

## 3. Local agent handoff

**LLM Wiki: Send Selection to Agent…** is a separate, lightweight path.
For the active Markdown or PDF selection it writes an immutable snapshot and
refreshes stable latest-export aliases:

```text
.llm_wiki/agent/exports/<id>/selection.md
.llm_wiki/agent/exports/<id>/selection.json
.llm_wiki/agent/selection.md                  # latest alias
.llm_wiki/agent/selection.json                # latest alias
```

The extension then attaches the immutable snapshot's `selection.md` to an
installed Codex, Claude, Cursor Agent, or CodeBuddy panel. The Markdown file
contains the canonical extracted passage and portable source anchor; the JSON
file preserves structured context. PDFium line-wrap hyphens may be normalized
out of that quote, while rectangle geometry and the crop preserve the visual
source. A later export can refresh the aliases without changing a file already
attached to a composer.

For a selected PDF passage, **Add to Chat** is available in the
right-click selection menu, floating selection toolbar, and editor title
toolbar. It routes through the same export instead of maintaining a separate
context format. The chosen supported agent receives:

- `.llm_wiki/agent/exports/<id>/selection.md`, containing the canonical extracted quote and
  portable page/text-fragment anchor;
- `.llm_wiki/agent/exports/<id>/selection.png`, when the best-effort crop is a valid,
  bounded PNG that can be saved and attached.

The structured `.llm_wiki/agent/selection.json` remains available as the latest
repository alias but is not attached. The optional latest crop alias is
`.llm_wiki/agent/selection.png`. If saving or attaching the crop fails, the extension
warns and continues with the Markdown attachment only. The extension updates
the chosen draft with the available attachments and never submits it. If no
supported provider is available, the export
is retained and an availability warning is shown.

This handoff does not submit the external provider's prompt, read its
transcript, or auto-persist its answer.

## 4. Security and path constraints

- Webviews run under a restrictive content-security policy and send typed,
  validated messages to the extension host.
- Portable paths must be repository-relative. Absolute paths, URI schemes,
  `..` traversal, and malformed percent encoding are rejected.
- Selection exports and crops are bounded; snapshot bytes are verified as PNG
  data when a crop is captured.
- Without an open folder, repository and agent features remain disabled; the
  Markdown and PDF viewers remain available without writing to the process
  working directory.
- The raw PDF is never modified, and read-only agent threads cannot silently
  edit the repository.

## 5. Verification

Run the current combined extension checks from the repository root:

```bash
pnpm --filter llm-wiki-vscode exec tsc --noEmit
pnpm --filter @llm-wiki/core test
pnpm --filter llm-wiki-vscode test
pnpm exec playwright test --config playwright.config.ts
```

The final desktop smoke test should be repeated in both VS Code and Cursor:

1. select a multi-line PDF passage and choose **Add to Chat**;
2. confirm the immutable selection export is written under
   `.llm_wiki/agent/exports/<id>/` and the latest alias refreshes;
3. verify the chosen agent draft receives `selection.md` (and `selection.png`
   when the crop succeeds) without submitting;
4. reload the window and reopen the PDF;
5. verify navigation, selection, and the context menu still work.
