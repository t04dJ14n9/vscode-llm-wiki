# Inferred PDF Outline Task Report

Date: 2026-08-16

## Result

Implemented a local, conservative PDF-outline fallback that:

- runs only when the embedded bookmark tree is empty;
- reconstructs fragmented visual heading lines from normalized PDF text runs;
- learns body typography and recurring heading styles;
- rejects running headers, footers, page numbers, captions, bullets, equations,
  email addresses, bibliography entries, long prose, and one-off title text;
- builds decimal and recurring-typography hierarchy;
- emits exact page/XYZ destinations;
- labels the result **Inferred outline** in the PDF sidebar and Explorer tree;
- extracts page text with concurrency four and cancels stale document runs.

Embedded PDF bookmarks remain authoritative.

## TDD Evidence

### Pure detector RED

```text
node --test packages/vscode-extension/test/pdfInferredOutline.test.mjs
```

Failed because `pdfInferredOutline.ts` did not exist.

### Pure detector GREEN

```text
6 tests, 6 passed
```

Covered fragmented headings, decimal nesting, malformed hierarchy, recurring
unnumbered typography, explicit false-positive classes, conventional-label
guardrails, and image-only/empty failure.

### Viewer integration RED

```text
pnpm exec playwright test --config playwright.config.ts \
  packages/vscode-extension/test/e2e/pdf-viewer.spec.ts \
  --grep "infers a labelled nested outline|keeps embedded outline surfaces"
```

Both cases failed: the no-bookmarks fixture had no inferred label, and the
embedded snapshot lacked the explicit authored/inferred state.

### Viewer integration GREEN

```text
2 tests, 2 passed
```

The no-bookmarks fixture produced nested entries and navigated to page 2; the
embedded fixture remained authored.

### Host and Explorer RED

```text
node --test packages/vscode-extension/test/pdfSelectionContext.test.mjs \
  packages/vscode-extension/test/markdownSymbols.test.mjs
```

The provider lacked `isPdfOutlineInferred`, and the Explorer tree returned one
root instead of the inferred status plus the real root.

### Host and Explorer GREEN

```text
29 tests, 29 passed
```

## Real-PDF Evidence

Command:

```text
LLM_WIKI_PDF_SMOKE_PATH=/Users/t04dj14n9/Code/human-learning/demo-vault/raw/assets/neural-machine-translation-of-rare-words-with-subword-units.pdf \
  pnpm exec playwright test --config playwright.config.ts \
  packages/vscode-extension/test/e2e/pdf-manual-smoke.spec.ts \
  --grep "conservative inferred outline"
```

Result: `1 passed`.

Verified:

- `2 Neural Machine Translation` is present;
- `4 Evaluation` is present;
- `Algorithm 1` is absent;
- `Figure 1` is absent;
- author names are absent.

## Regression Evidence

```text
node --test packages/vscode-extension/test/pdfTextExtraction.test.mjs \
  packages/vscode-extension/test/pdfSelectionDomain.test.mjs
```

Result: `64 passed`.

```text
pnpm exec playwright test --config playwright.config.ts \
  packages/vscode-extension/test/e2e/pdf-viewer.spec.ts \
  packages/vscode-extension/test/e2e/pdf-internal-links.spec.ts \
  --grep "outline|sidebar renders page thumbnails"
```

Final result: `6 passed`.

The first combined run had one existing destination-highlight timing miss. The
exact case passed three consecutive isolated repetitions, and the unchanged
combined set then passed 6/6. No navigation change was made for the transient
miss.

```text
pnpm test
```

Result:

- core: `36 passed`;
- VS Code extension: `557 passed`;
- total failures: `0`.

`pnpm build`, `pnpm lint`, `pnpm typecheck`, and `git diff --check` also exited
zero during the task.
