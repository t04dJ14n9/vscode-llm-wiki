# PDF editor webview

This package is the browser-side PDF editor shared by the combined Human
Learning extension and the standalone PDF extension.

## Boundaries

- `src/webview/pdf-viewer.ts` is the application shell. It owns DOM events,
  rendering orchestration, selection state, and host messages.
- `src/webview/domain/` contains pure PDF policies and geometry. Domain modules
  must not import VS Code, browser globals, the PDF engine, or persistence.
- `src/webview/pdfAskPanel*.ts` owns the annotation-scoped Ask PDF window.
- `pdfEditorProvider.ts` remains in each extension package. Providers are host
  adapters and may differ between the combined and standalone products.

The two extension builds must resolve `@human-learning/pdf-editor/webview`
instead of maintaining mirrored implementations.

## Dependency direction

```text
extension provider -> webview bundle -> application shell -> pure domain
```

Domain code communicates with the application shell through typed values and
functions. Introduce an interface only at a real boundary (host messaging,
engine access, discussions, or persistence), not between every helper.
