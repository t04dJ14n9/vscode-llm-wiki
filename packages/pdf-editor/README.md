# PDF editor webview

This package is the browser-side PDF editor used by the combined LLM Wiki
extension.

## Boundaries

- `src/webview/pdf-viewer.ts` is the application shell. It owns DOM events,
  rendering orchestration, selection state, and host messages.
- `src/webview/domain/` contains pure PDF policies and geometry. Domain modules
  must not import VS Code, browser globals, the PDF engine, or persistence.
- `pdfEditorProvider.ts` remains in the combined extension. It is the host
  adapter between VS Code and this browser-side package.

The combined extension resolves `@llm-wiki/pdf-editor/webview` directly
instead of maintaining a mirrored implementation.

## Dependency direction

```text
extension provider -> webview bundle -> application shell -> pure domain
```

Domain code communicates with the application shell through typed values and
functions. Introduce an interface only at a real boundary (host messaging,
engine access, or persistence), not between every helper.
