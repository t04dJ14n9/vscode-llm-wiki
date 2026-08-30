# PDF editor webview

This package is the browser-side PDF editor used by the combined LLM Wiki
extension.

## Boundaries

- `src/embedpdf-spike/embedpdf-viewer-spike.tsx` is the production application
  shell. It owns the LLM Wiki UI and host protocol over EmbedPDF's rendering,
  navigation, and selection plugins.
- `src/webview/pdf-viewer.ts` is the legacy browser-test fixture. It remains
  temporarily while its regression coverage is migrated to the production
  shell, but the VS Code provider no longer loads it.
- `src/webview/domain/` contains pure PDF policies and geometry. Domain modules
  must not import VS Code, browser globals, the PDF engine, or persistence.
- `pdfEditorProvider.ts` remains in the combined extension. It is the host
  adapter between VS Code and this browser-side package.

The combined extension builds the production shell directly from
`@llm-wiki/pdf-editor/embedpdf-spike` instead of maintaining a mirrored
implementation.

## Dependency direction

```text
extension provider -> webview bundle -> application shell -> pure domain
```

Domain code communicates with the application shell through typed values and
functions. Introduce an interface only at a real boundary (host messaging,
engine access, or persistence), not between every helper.
