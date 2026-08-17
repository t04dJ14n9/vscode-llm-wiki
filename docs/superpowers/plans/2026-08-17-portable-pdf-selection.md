# Portable PDF Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace screenshot-backed PDF handoff with automatic text-or-area selection, portable RFC 8118 links, raw agent context, and a vault-local PDF extraction skill.

**Architecture:** Keep the current exact text selection state and add a page-local area selection state chosen by bounded pointer hit testing at gesture start. Normalize both into one provider-neutral PDF agent selection, format one plain-Markdown handoff for Copy for Agent and Add to Chat, and let a vault-local Agent Skill reproduce text or visual regions with `pdfplumber` without persisting screenshots.

**Tech Stack:** TypeScript, PDFium webview rendering, VS Code/Cursor commands, Node test runner, Playwright, Python 3, `pdfplumber`, `pypdfium2`, Agent Skills `SKILL.md`, RFC 8118 PDF fragments.

## Global Constraints

- Keep character, word, line, reverse, zoom-restored, autoscrolling, and cross-page text selection behavior.
- A point outside the bounded text-hit tolerance starts an area selection instead of snapping to distant text.
- `Option` on macOS and `Alt` elsewhere force area selection for the gesture.
- Area selections stay on one page; cross-page text selections remain page-separated.
- The floating selection actions are only **Add to Chat** when Cursor supports it and **Copy for Agent** everywhere.
- Remove **Copy link** and the primary rectangular PDF++ coordinate-copy workflow.
- Copy for Agent and Add to Chat use the same human-readable Markdown containing relative RFC 8118 links, the PDF SHA-256, and exact raw text when present.
- Do not create, persist, cache, attach, or stitch PDF selection PNGs.
- Do not vendor, patch, or fork `pdfplumber` or `pypdfium2`.
- Treat `.agents/skills/` as hidden operational metadata, not OKF knowledge content.
- Preserve existing user-owned skills unless an explicit installer `--force` option is used.
- Preserve the user's unrelated modifications in `demo-vault/summaries/nanochat-end-to-end-training-pipeline.md`, `packages/vscode-extension/test/e2e/markdown-editor.spec.ts`, and `packages/vscode-extension/webview-src/extensions/hybridRendering.ts`.

## Backend Evaluation

- The bundled OpenAI PDF skill establishes the right temporary-render and `pdfplumber` workflow but has no portable region-locator adapter.
- `anthropics/skills` provides a broad PDF guide, but its checked-in license declares proprietary terms and its scripts render whole pages rather than RFC 8118 regions.
- Anthropic's `view-pdf` skill requires an interactive PDF server and explicitly excludes extraction.
- The Apache-2.0 Nutrient skill requires an internet service and API key, which violates local, provider-independent extraction.
- On the DPO paper's page-2 region `(90,45,522,185)`, `pdfplumber` and direct `pypdfium2` produced the same complete figure crop and identical bounded caption text. Direct PDFium took about 20 ms and `pdfplumber` about 183 ms in the local runtime; that difference is immaterial for a user-triggered selection.
- Use `pdfplumber` as the stable skill API because it accepts the approved top-left bounding box directly and already delegates rendering to `pypdfium2`. Keep direct `pypdfium2` out of the skill API.

---

### Task 1: Add RFC 8118 View Rectangles to Core PDF Links

**Files:**
- Modify: `packages/core/src/links/reference-target.ts:91-102`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/reference-target.test.mjs`

**Interfaces:**
- Consumes: existing `pdfHref(path, { page, textFragment })` callers.
- Produces: `PdfViewRect` and `pdfHref(path, { page, textFragment, viewRect })`, serializing `viewrect=left,top,width,height` in PDF points.

- [ ] **Step 1: Write failing literal serialization tests**

```javascript
assert.equal(
  pdfHref('raw/assets/paper.pdf', {
    page: 2,
    viewRect: { left: 90, top: 45, width: 432, height: 140 },
  }),
  'raw/assets/paper.pdf#page=2&viewrect=90%2C45%2C432%2C140',
);
assert.throws(
  () => pdfHref('raw/assets/paper.pdf', {
    page: 2,
    viewRect: { left: 90, top: 45, width: 0, height: 140 },
  }),
  /view rectangle/i,
);
```

The first mutation caught is omitting or reordering `left,top,width,height`; the second catches silently accepting an empty area.

- [ ] **Step 2: Run the core test and verify RED**

```bash
node --test packages/core/test/reference-target.test.mjs
```

Expected: FAIL because `viewRect` is ignored and no validation error is raised.

- [ ] **Step 3: Implement the minimal view-rectangle contract**

```typescript
export interface PdfViewRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function serializePdfViewRect(value: PdfViewRect | undefined): string | undefined {
  if (value === undefined) return undefined;
  const coordinates = [value.left, value.top, value.width, value.height];
  if (
    !coordinates.every(Number.isFinite)
    || value.left < 0
    || value.top < 0
    || value.width <= 0
    || value.height <= 0
  ) throw new TypeError('Invalid PDF view rectangle');
  return coordinates.map(coordinate => String(Math.round(coordinate * 1000) / 1000)).join(',');
}
```

Extend `pdfHref` options with `viewRect?: PdfViewRect`, append it to the same `URLSearchParams`, and export `PdfViewRect` from the core barrel.

- [ ] **Step 4: Run the core test and verify GREEN**

```bash
node --test packages/core/test/reference-target.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the core contract**

```bash
git add packages/core/src/links/reference-target.ts packages/core/src/index.ts packages/core/test/reference-target.test.mjs
git commit -m "feat(pdf): address portable page regions"
```

---

### Task 2: Unify Text and Area Agent Selections

**Files:**
- Modify: `packages/vscode-extension/src/agentClipboard.ts`
- Modify: `packages/vscode-extension/src/pdfEditorProvider.ts:29-84,1099-1135,1900-2020`
- Test: `packages/vscode-extension/test/agentClipboard.test.mjs`
- Test: `packages/vscode-extension/test/pdfSelectionContext.test.mjs`

**Interfaces:**
- Consumes: page-local rectangles in `[left, top, right, bottom]` PDF points and `pdfHref(..., { viewRect })` from Task 1.
- Produces `PdfAgentSelectionKind = 'text' | 'area'`, a discriminated `PdfAgentClipboardSelection`, and `createPdfAgentClipboardContext({ selectionKey, relativePath, sourceSha256, selection })`.

- [ ] **Step 1: Write failing formatter tests for text, area, and cross-page payloads**

```javascript
const hash = 'a'.repeat(64);
const textSelection = {
  kind: 'text',
  startPage: 1,
  endPage: 2,
  pages: [
    { page: 1, rects: [[108, 728, 385, 746]] },
    { page: 2, rects: [[108, 158, 504, 205]] },
  ],
  selectedText: 'Conference footer Figure 1 caption',
};
const context = createPdfAgentClipboardContext({
  selectionKey: 'selection-key',
  relativePath: 'raw/assets/paper.pdf',
  sourceSha256: hash,
  selection: textSelection,
});
assert.equal(context.plainText, [
  'Sources:',
  '- [raw/assets/paper.pdf (page 1)](<raw/assets/paper.pdf#page=1&viewrect=108%2C728%2C277%2C18>)',
  '- [raw/assets/paper.pdf (page 2)](<raw/assets/paper.pdf#page=2&viewrect=108%2C158%2C396%2C47>)',
  `PDF source SHA-256: \`${hash}\``,
  '',
  'Selected text:',
  'Conference footer Figure 1 caption',
].join('\n'));
```

Add an area case ending with `Selected PDF region. Use the vault PDF skill to extract its text and inspect its visual content.` Add rejection tests for duplicate pages, empty text selections, area text, invalid SHA-256, and invalid rectangles.

- [ ] **Step 2: Run focused formatter tests and verify RED**

```bash
node --test packages/vscode-extension/test/agentClipboard.test.mjs packages/vscode-extension/test/pdfSelectionContext.test.mjs
```

Expected: FAIL because the current selection requires text, lacks `kind` and SHA-256, and formats no `viewrect`.

- [ ] **Step 3: Implement the discriminated selection and formatter**

```typescript
export type PdfAgentClipboardSelection =
  | {
      kind: 'text';
      startPage: number;
      endPage: number;
      pages: readonly PdfAgentClipboardPageSelection[];
      selectedText: string;
    }
  | {
      kind: 'area';
      startPage: number;
      endPage: number;
      pages: readonly [PdfAgentClipboardPageSelection];
    };

export interface PdfAgentClipboardContextInput {
  selectionKey: string;
  relativePath: string;
  sourceSha256: string;
  selection: PdfAgentClipboardSelection;
}
```

Add `unionPdfRects(rects)` returning `{ left, top, width, height }`. Format one link per page with the union rectangle. Keep exact rectangles in the selection key. Normalize whitespace only for text selections.

- [ ] **Step 4: Update host normalizers and context correlation**

Require `kind`, preserve exact rectangles, and reject multi-page area selections or page ranges inconsistent with their ordered pages. Add `pdfSha256?: string` to `ActivePdfWebview`; change `loadPdf` to accept the active record, hash the same bytes it posts, and assign:

```typescript
active.pdfSha256 = createHash('sha256').update(bytes).digest('hex');
```

Do not reread and rehash the PDF during pointer movement. Make `updateActiveSelection` refuse to publish agent context until that hash is available.

Extend `PdfSelectionAnchor` with `area?: true`. In `toSelectionContext`, an area anchor uses `text: 'Selected PDF region.'`, a `pdfHref` with its union `viewRect`, and `metadata.selectionKind = 'area'`; it must not create a text fragment. Add a provider test that resolves this area context and a text-context regression that retains its exact text fragment.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
node --test packages/vscode-extension/test/agentClipboard.test.mjs packages/vscode-extension/test/pdfSelectionContext.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the unified model**

```bash
git add packages/vscode-extension/src/agentClipboard.ts packages/vscode-extension/src/pdfEditorProvider.ts packages/vscode-extension/test/agentClipboard.test.mjs packages/vscode-extension/test/pdfSelectionContext.test.mjs
git commit -m "feat(pdf): format portable agent selections"
```

---

### Task 3: Choose Text or Area Selection from the Pointer Start

**Files:**
- Modify: `packages/pdf-editor/src/webview/domain/pdfSelection.ts`
- Modify: `packages/pdf-editor/src/webview/pdf-viewer.ts:290-310,459-506,1017-1255,1515-1615,2990-3310`
- Modify: `packages/pdf-editor/src/webview/pdf-viewer.css`
- Modify: `packages/vscode-extension/src/pdfEditorProvider.ts:1420-1580`
- Test: `packages/vscode-extension/test/pdfSelectionDomain.test.mjs`
- Test: `packages/vscode-extension/test/e2e/pdf-preview-selection.spec.ts`
- Test: `packages/vscode-extension/test/e2e/pdf-viewer.spec.ts`

**Interfaces:**
- Consumes: glyph hit rectangles, page wrappers, exact text-selection carets, and Task 2's unified selection.
- Produces `pdfPointerSelectionIntent(hit, lineHeight, forceArea): 'text' | 'area'`, context-sensitive cursors, unchanged text selection, and persistent page-local area selection.

- [ ] **Step 1: Write failing pure intent tests**

```javascript
assert.equal(pdfSelection.pdfPointerSelectionIntent({ horizontalDistance: 0, verticalDistance: 0 }, 12, false), 'text');
assert.equal(pdfSelection.pdfPointerSelectionIntent({ horizontalDistance: 80, verticalDistance: 44 }, 12, false), 'area');
assert.equal(pdfSelection.pdfPointerSelectionIntent({ horizontalDistance: 0, verticalDistance: 0 }, 12, true), 'area');
```

- [ ] **Step 2: Run the domain test and verify RED**

```bash
node --test --test-name-pattern "pointer selection intent" packages/vscode-extension/test/pdfSelectionDomain.test.mjs
```

Expected: FAIL because the intent helper does not exist.

- [ ] **Step 3: Implement bounded selection intent**

```typescript
export function pdfPointerSelectionIntent(
  hit: { horizontalDistance: number; verticalDistance: number } | undefined,
  lineHeight: number,
  forceArea: boolean,
): 'text' | 'area' {
  if (forceArea || !hit || !Number.isFinite(lineHeight) || lineHeight <= 0) return 'area';
  const tolerance = Math.max(2, Math.min(8, lineHeight * 0.45));
  return hit.horizontalDistance <= tolerance && hit.verticalDistance <= tolerance
    ? 'text'
    : 'area';
}
```

Make `hitTestSelectionGlyph` return the winning glyph plus horizontal and vertical distances rather than treating every winning glyph as a text hit.

- [ ] **Step 4: Write failing browser tests for cursor and selection kind**

Extend a fixture with a non-text figure between text runs. Expect `cursor: crosshair` and one `.pdf-area-selection` over the figure with zero `.pdf-selection-rect`; expect `cursor: text` and the existing exact snippet over a glyph. Add an `Alt` drag over text that creates an area selection. Keep cross-page text tests unchanged.

- [ ] **Step 5: Run browser tests and verify RED**

```bash
pnpm exec playwright test --config playwright.config.ts packages/vscode-extension/test/e2e/pdf-preview-selection.spec.ts packages/vscode-extension/test/e2e/pdf-viewer.spec.ts --grep "automatic PDF selection|continuous mode permits"
```

Expected: FAIL because area selection requires the old toolbar toggle and immediately copies a PDF++ link.

- [ ] **Step 6: Reuse rectangle drag as persistent area selection**

```typescript
interface PdfAreaSelection {
  page: number;
  rect: PdfRect;
}

private areaSelection: PdfAreaSelection | null = null;
```

At pointer-down, preserve link handling, calculate bounded intent with `forceArea = event.altKey`, and lock either text or rectangle drag. On area pointer-up, convert CSS coordinates to PDF points, retain one overlay, set an anchor with `area: true` and `snippet: 'Selected PDF region.'`, publish a `kind: 'area'` selection, and show the normal toolbar. Remove the rectangle toolbar button and mode CSS. Restore or clear the area overlay on rerender, Escape, new selection, and document reload.

- [ ] **Step 7: Render context-sensitive cursors**

On passive pointer movement, apply a text cursor only for bounded text intent; otherwise use the page crosshair. Do not change cursor during a drag. Clear cursor state on leave, rerender, and unload.

- [ ] **Step 8: Run unit and browser tests and verify GREEN**

```bash
node --test packages/vscode-extension/test/pdfSelectionDomain.test.mjs
pnpm exec playwright test --config playwright.config.ts packages/vscode-extension/test/e2e/pdf-preview-selection.spec.ts packages/vscode-extension/test/e2e/pdf-viewer.spec.ts --grep "automatic PDF selection|continuous mode permits|rectangular selection"
```

Expected: PASS after replacing the old rectangular-selection expectation.

- [ ] **Step 9: Commit the interaction**

```bash
git add packages/pdf-editor/src/webview/domain/pdfSelection.ts packages/pdf-editor/src/webview/pdf-viewer.ts packages/pdf-editor/src/webview/pdf-viewer.css packages/vscode-extension/src/pdfEditorProvider.ts packages/vscode-extension/test/pdfSelectionDomain.test.mjs packages/vscode-extension/test/e2e/pdf-preview-selection.spec.ts packages/vscode-extension/test/e2e/pdf-viewer.spec.ts
git commit -m "feat(pdf): select text or page areas automatically"
```

---

### Task 4: Remove Screenshot Handoff and Collapse Selection Actions

**Files:**
- Modify: `packages/pdf-editor/src/webview/pdf-viewer.ts:3150-3435`
- Modify: `packages/pdf-editor/src/webview/pdfAgentClipboard.ts`
- Modify: `packages/vscode-extension/src/pdfEditorProvider.ts:25-60,320-330,444-490,1050-1145`
- Modify: `packages/vscode-extension/src/extension.ts:1-80,170-205,530-675`
- Delete: `packages/vscode-extension/src/pdfAgentClipboardImage.ts`
- Delete: `packages/vscode-extension/test/pdfAgentClipboardImage.test.mjs`
- Test: `packages/vscode-extension/test/pdfAgentClipboard.test.mjs`
- Test: `packages/vscode-extension/test/pdfSelectionContext.test.mjs`
- Test: `packages/vscode-extension/test/extensionActivation.test.mjs`
- Test: `packages/vscode-extension/test/e2e/ask-pdf.spec.ts`
- Test: `packages/vscode-extension/test/e2e/pdf-viewer.spec.ts`

**Interfaces:**
- Consumes: `PdfAgentClipboardContext.plainText` from Task 2 and `handoffRawTextToCursor`.
- Produces: exactly two visible actions, direct text-only clipboard writes, and raw-text Cursor handoff with zero attachment URIs.

- [ ] **Step 1: Write failing host tests that forbid every PNG path**

Make the PDF Copy for Agent and Add to Chat tests throw if any of these are called:

```javascript
persistPdfAgentClipboardImage: () => { throw new Error('PDF selection images must not be persisted'); },
syncSelectionExportAttachment: () => { throw new Error('PDF selection images must not be exported'); },
validateCursorCropPng: () => { throw new Error('PDF selection images must not be decoded'); },
```

Assert Copy for Agent writes the exact `context.plainText`. Assert PDF Add to Chat calls `handoffRawTextToCursor(input, [])`, and neither command contains `.png`, `selection.md`, or `copyLink`.

- [ ] **Step 2: Run focused host tests and verify RED**

```bash
node --test packages/vscode-extension/test/pdfSelectionContext.test.mjs packages/vscode-extension/test/extensionActivation.test.mjs
```

Expected: FAIL because Copy for Agent requests a crop and Add to Chat persists and attaches it.

- [ ] **Step 3: Move Copy for Agent to one host action**

Add `'copyForAgent'` to `PdfSelectionAction`. Make the toolbar and context menu post it. In `handleSelectionAction`, correlate the active context and run:

```typescript
await vscode.env.clipboard.writeText(context.plainText);
vscode.window.showInformationMessage('PDF selection copied for agent.');
```

Make the provider command call the same private helper directly. Remove `agentClipboardResult`, `agentClipboardWriteAttempt`, `writePdfAgentClipboard`, `capturePdfAgentClipboardPng`, stitched crops, and image-reference formatting. Keep crop APIs still used by Ask PDF snapshots.

- [ ] **Step 4: Make PDF Add to Chat raw-text only**

Remove `snapshotPngBase64` and `cropCaptureFailed` from PDF selection actions. Change PDF handoff to:

```typescript
return handoffRawTextToCursor({
  uri: selection.uri,
  range: { startLine: selection.startLine, endLine: selection.endLine },
  rawText: context.plainText,
}, []);
```

Do not change browser-selection screenshots or durable Ask PDF discussion snapshots.

- [ ] **Step 5: Reduce the selection actions**

For text and area toolbars/context menus, show Add to Chat only for Cursor and Copy for Agent everywhere. Remove Copy link to selection and Copy selected text from the selection surface. Keep page-level Copy link to page unchanged. Remove `copyLink` and `copyRectEmbed` host branches.

- [ ] **Step 6: Remove obsolete image-cache files**

Delete `pdfAgentClipboardImage.ts` and its test after imports are gone. Remove only agent-clipboard stitching from `pdfAgentClipboard.ts`; retain Ask PDF and discussion crop APIs.

- [ ] **Step 7: Run focused host and browser tests and verify GREEN**

```bash
node --test packages/vscode-extension/test/pdfAgentClipboard.test.mjs packages/vscode-extension/test/pdfSelectionContext.test.mjs packages/vscode-extension/test/extensionActivation.test.mjs
pnpm exec playwright test --config playwright.config.ts packages/vscode-extension/test/e2e/pdf-viewer.spec.ts packages/vscode-extension/test/e2e/ask-pdf.spec.ts --grep "Copy for Agent|adds exact text|selection actions"
```

Expected: PASS with no PDF selection PNG or attachment assertion. Ask PDF snapshot tests remain unchanged.

- [ ] **Step 8: Commit text-only handoff**

```bash
git add packages/pdf-editor/src/webview/pdf-viewer.ts packages/pdf-editor/src/webview/pdfAgentClipboard.ts packages/vscode-extension/src/pdfEditorProvider.ts packages/vscode-extension/src/extension.ts packages/vscode-extension/test/pdfAgentClipboard.test.mjs packages/vscode-extension/test/pdfSelectionContext.test.mjs packages/vscode-extension/test/extensionActivation.test.mjs packages/vscode-extension/test/e2e/ask-pdf.spec.ts packages/vscode-extension/test/e2e/pdf-viewer.spec.ts packages/vscode-extension/src/pdfAgentClipboardImage.ts packages/vscode-extension/test/pdfAgentClipboardImage.test.mjs
git commit -m "fix(pdf): hand off portable selections without images"
```

---

### Task 5: Build and Install the Vault-Local PDF Skill

**Files:**
- Create: `.agents/skills/pdf/SKILL.md`
- Create: `.agents/skills/pdf/scripts/extract_selection.py`
- Create: `demo-vault/.agents/skills/pdf/SKILL.md`
- Create: `demo-vault/.agents/skills/pdf/scripts/extract_selection.py`
- Create: `tools/demo-vault/install_agent_skills.py`
- Create: `tools/demo-vault/tests/test_pdf_skill.py`
- Modify: `tools/demo-vault/tests/test_operator_docs.py`
- Modify: `demo-vault/README.md`
- Modify: `demo-vault/AGENTS.md`
- Modify: `demo-vault/log.md`
- Verify: `tools/demo-vault/rebuild_indexes.py`
- Verify: `tools/demo-vault/validate_vault.py`

**Interfaces:**
- Consumes: relative `application/pdf#page=N&viewrect=L%2CT%2CW%2CH` links, a `PDF source SHA-256` line, and optional raw text.
- Produces:
  - `extract_selection.py extract --vault PATH --link LINK [--link LINK...] --sha256 HEX [--quote TEXT] [--render]`
  - JSON with ordered targets, extracted text, quote status, temporary PNGs, and cleanup path
  - `extract_selection.py cleanup --path TEMP_DIR`
  - a portable `pdf` Agent Skill installed in the distributable vault.

- [ ] **Step 1: Initialize the canonical skill skeleton**

Invoke `skill-creator` and `superpowers:writing-skills`, then use the active `skill-creator` initializer to create `.agents/skills/pdf` with `scripts/`. Remove placeholders and product-specific UI metadata; retain only `SKILL.md` and `scripts/extract_selection.py`.

- [ ] **Step 2: Write failing parser and security tests**

```python
target = parse_pdf_link(
    "raw/assets/paper.pdf#page=2&viewrect=90%2C45%2C432%2C140"
)
self.assertEqual(target.page, 2)
self.assertEqual(target.view_rect, (90.0, 45.0, 432.0, 140.0))
```

Add tests rejecting absolute paths, `..`, encoded traversal, URI schemes, missing or duplicate parameters, invalid dimensions, page zero, mixed sources, symlink components, and cleanup paths without the helper marker.

- [ ] **Step 3: Run parser tests and verify RED**

```bash
python3 -m unittest tools.demo-vault.tests.test_pdf_skill -v
```

Expected: FAIL because the helper and installer do not exist.

- [ ] **Step 4: Implement locator parsing and source confinement**

```python
@dataclass(frozen=True)
class PdfTarget:
    source: str
    page: int
    view_rect: tuple[float, float, float, float]

@dataclass(frozen=True)
class ExtractionResult:
    source: str
    sha256: str
    targets: tuple[PdfTarget, ...]
    extracted_text: str
    quote_status: str
    images: tuple[str, ...]
    cleanup_path: str | None
```

Parse with `urlsplit` and `parse_qs(..., strict_parsing=True)`, requiring exactly one `page` and `viewrect`. Resolve every component under `Path(vault).resolve()`, reject symlinks with `lstat`, and require an ordinary `.pdf` file.

- [ ] **Step 5: Write failing real extraction and render tests**

When the Git LFS object is present, use the DPO PDF. For page 2 and `(90,45,432,140)`, assert bounded text begins `Figure 1: DPO optimizes`, the rendered PNG has a valid signature and nonzero dimensions, and visual QA later shows both RLHF and DPO panels. For page-1 footer plus page-2 caption links, assert ordered pages and joined text beginning `37th Conference` followed by `Figure 1`.

- [ ] **Step 6: Run extraction tests and verify RED**

```bash
/Users/t04dj14n9/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest tools.demo-vault.tests.test_pdf_skill -v
```

Expected: parser tests pass; extraction tests FAIL because `pdfplumber` execution is absent.

- [ ] **Step 7: Implement extraction, verification, rendering, and cleanup**

Lazy-import `pdfplumber`; when absent print:

```text
pdfplumber is required. Run: uv run --with 'pdfplumber>=0.11,<0.12' <script> ...
```

For each target:

```python
left, top, width, height = target.view_rect
bbox = (left, top, left + width, top + height)
cropped = pdf.pages[target.page - 1].crop(bbox, strict=True)
text = cropped.extract_text(x_tolerance=2, y_tolerance=2) or ""
```

For `--render`, create `tempfile.mkdtemp(prefix="llm-wiki-pdf-selection-")`, write an ownership marker, and save one PNG per target with `cropped.to_image(resolution=180, antialias=True)`. Return raw page text and normalized joined text. Cleanup validates the system temporary root, prefix, marker, and symlink-free components before deletion.

- [ ] **Step 8: Write the concise portable SKILL.md**

Trigger on PDF selections, RFC 8118 links, figures, tables, equations, and copied LLM Wiki PDF context. Instruct agents to keep raw text available, run the helper, use `--render` only for visual/layout questions, inspect every PNG, clean temporary files, and report hash or quote mismatches. Do not copy OpenAI, Anthropic, or vendor skill prose.

- [ ] **Step 9: Implement safe installation and the distributable default**

`install_agent_skills.py --vault PATH` copies the canonical skill only when absent or byte-identical. A differing destination is preserved and exits nonzero. `--force` replaces only the validated `.agents/skills/pdf` destination. Install into `demo-vault/.agents/skills/pdf` and test byte equality.

Update operator docs to identify `.agents/skills` as hidden operational metadata. Add a newest-first log entry. Do not add `_index.md` under `.agents`.

- [ ] **Step 10: Validate the skill and vault**

```bash
python3 -m unittest tools.demo-vault.tests.test_pdf_skill tools.demo-vault.tests.test_operator_docs -v
python3 tools/demo-vault/rebuild_indexes.py --vault demo-vault
python3 tools/demo-vault/rebuild_indexes.py --vault demo-vault --check
python3 tools/demo-vault/validate_vault.py --vault demo-vault
diff -r .agents/skills/pdf demo-vault/.agents/skills/pdf
```

Expected: all commands exit zero and hidden skill files never enter OKF indexes.

- [ ] **Step 11: Visually verify and clean the DPO region**

Run the installed helper with `--render` on `raw/assets/direct-preference-optimization-your-language-model-is-secretly-a-reward-model.pdf#page=2&viewrect=90%2C45%2C432%2C140`. Inspect that both panels and the caption beginning are complete. Run the returned cleanup command and verify the temporary directory is absent.

- [ ] **Step 12: Commit the skill**

```bash
git add .agents/skills/pdf demo-vault/.agents/skills/pdf tools/demo-vault/install_agent_skills.py tools/demo-vault/tests/test_pdf_skill.py tools/demo-vault/tests/test_operator_docs.py demo-vault/README.md demo-vault/AGENTS.md demo-vault/log.md
git commit -m "feat(vault): include portable PDF extraction skill"
```

---

### Task 6: Complete Acceptance Coverage and Repository Verification

**Files:**
- Modify: `packages/vscode-extension/test/e2e/pdf-preview-selection.spec.ts`
- Modify: `packages/vscode-extension/test/e2e/pdf-viewer.spec.ts`
- Modify: `packages/vscode-extension/test/e2e/ask-pdf.spec.ts`
- Modify: `packages/vscode-extension/test/vscode-e2e/demo-vault.spec.ts` only if existing host coverage cannot observe both actions
- Modify: `docs/superpowers/specs/2026-08-17-portable-pdf-selection-design.md` only for evidence-driven factual corrections

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: browser and host evidence for complete figure selection, cross-page text, reduced actions, portable handoff, and zero screenshot persistence.

- [ ] **Step 1: Add the complete interaction acceptance test**

Use a fixture with text above and below a vector-like figure. Verify I-beam text drag, crosshair figure drag, no neighboring text highlight, area bounds within two CSS pixels, exact toolbar labels, area RFC 8118 Copy for Agent payload with SHA-256 and no `.png`, and Add to Chat with identical raw text plus an empty attachment list.

- [ ] **Step 2: Add cross-page clipboard acceptance**

Grant clipboard permissions, drag text across two pages, choose Copy for Agent, and assert ordered page links followed by exact canonical text. Assert no stitched-image reference or `.llm_wiki/agent/clipboard` path.

- [ ] **Step 3: Run all focused PDF tests**

```bash
node --test packages/core/test/reference-target.test.mjs packages/vscode-extension/test/agentClipboard.test.mjs packages/vscode-extension/test/pdfAgentClipboard.test.mjs packages/vscode-extension/test/pdfSelectionContext.test.mjs packages/vscode-extension/test/pdfSelectionDomain.test.mjs packages/vscode-extension/test/extensionActivation.test.mjs
pnpm exec playwright test --config playwright.config.ts packages/vscode-extension/test/e2e/pdf-preview-selection.spec.ts packages/vscode-extension/test/e2e/pdf-viewer.spec.ts packages/vscode-extension/test/e2e/ask-pdf.spec.ts
python3 -m unittest tools.demo-vault.tests.test_pdf_skill -v
```

Expected: all commands exit zero.

- [ ] **Step 4: Run affected-test discovery**

```bash
codegraph affected packages/core/src/links/reference-target.ts packages/pdf-editor/src/webview/domain/pdfSelection.ts packages/pdf-editor/src/webview/pdf-viewer.ts packages/vscode-extension/src/agentClipboard.ts packages/vscode-extension/src/pdfEditorProvider.ts packages/vscode-extension/src/extension.ts
```

Run every additional test file CodeGraph reports.

- [ ] **Step 5: Run full verification**

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter llm-wiki-vscode test
python3 -m unittest discover -s tools/demo-vault/tests -v
python3 tools/demo-vault/rebuild_indexes.py --vault demo-vault --check
python3 tools/demo-vault/validate_vault.py --vault demo-vault
git diff --check
```

Expected: every command exits zero. Record pre-existing runtime warnings separately.

- [ ] **Step 6: Audit the final diff and persisted artifacts**

```bash
git status --short
rg -n "pdf-selection-.*\\.png|persistPdfAgentClipboardImage|copyLink|copyRectEmbed" packages/pdf-editor/src packages/vscode-extension/src .agents/skills/pdf demo-vault/.agents/skills/pdf
find demo-vault/.llm_wiki/agent/clipboard -type f -newer docs/superpowers/specs/2026-08-17-portable-pdf-selection-design.md -print 2>/dev/null
```

Expected: no production selection-image pipeline or selection link action remains and no new cache image exists. Existing older cache images stay untouched. Confirm the three unrelated user-modified files retain their original diffs.

- [ ] **Step 7: Commit acceptance tests if needed**

```bash
git add packages/vscode-extension/test/e2e/pdf-preview-selection.spec.ts packages/vscode-extension/test/e2e/pdf-viewer.spec.ts packages/vscode-extension/test/e2e/ask-pdf.spec.ts packages/vscode-extension/test/vscode-e2e/demo-vault.spec.ts docs/superpowers/specs/2026-08-17-portable-pdf-selection-design.md
git commit -m "test(pdf): verify portable text and area handoff"
```

If Task 6 changed no tracked file, do not create an empty commit.
