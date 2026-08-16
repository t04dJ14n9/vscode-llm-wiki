# Canonical `_index.md` and Footnote Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `_index.md` the only hierarchical vault index filename and keep inactive footnote references visible in hybrid Markdown tables.

**Architecture:** Replace the index filename at the producer, validator, filesystem-graph, and URI-resolution boundaries, then atomically migrate the repository vault and fixtures. Separately stop footnote definitions from entering the collapsed reference-link index so the dedicated footnote renderer exclusively owns `[^id]` references.

**Tech Stack:** Python 3 `unittest`, TypeScript, Node.js test runner, CodeMirror 6, Playwright, pnpm.

## Global Constraints

- `_index.md` and `log.md` are the only reserved Markdown filenames at each vault level.
- There is no compatibility flag or fallback for legacy `index.md`.
- Directory links remain `child/` and resolve exclusively to `child/_index.md`.
- `index.md`, if present, is an ordinary concept and must pass ordinary concept validation.
- Only the bundle-root `_index.md` may contain exactly `okf_version: "0.2"` frontmatter.
- Footnote navigation, previews, raw Markdown copying, and ordinary reference links must remain unchanged.
- Preserve the user's dirty main checkout; all work stays in `.worktrees/vault-underscore-index`.

---

### Task 1: Separate footnotes from collapsed reference links

**Files:**
- Modify: `packages/vscode-extension/webview-src/markdownSpans.ts:341-363`
- Modify: `packages/vscode-extension/test/markdownSpans.test.mjs:28-64`
- Modify: `packages/vscode-extension/test/e2e/markdown-editor.spec.ts:707-730`

**Interfaces:**
- Consumes: `markdownReferenceDefinitionSourceSpan(lineFrom: number, text: string): MarkdownReferenceDefinition | null`
- Produces: reference-definition parsing that returns `null` for labels whose first character is `^`
- Preserves: `markdownFootnoteIndex(text: string): MarkdownFootnoteIndex`

- [ ] **Step 1: Write the parser regression**

Import `markdownReferenceDefinitions` from `markdownSpans.ts` in
`markdownSpans.test.mjs` and add:

```javascript
test('footnote definitions are not collapsed reference-link definitions', () => {
  const definitions = markdownReferenceDefinitions([
    '[guide]: concepts/guide.md',
    '[^smollm2]: SmolLM2',
  ].join('\n'));

  assert.equal(definitions.get('guide')?.destination, 'concepts/guide.md');
  assert.equal(definitions.has('^smollm2'), false);
});
```

- [ ] **Step 2: Write the active-table browser regression**

Extend the existing table-footnote Playwright coverage with a long identifier,
place the caret in another row so the table stays in source mode, and assert
that the inactive reference is still a footnote rather than a local-link
widget:

```typescript
test('long footnotes stay visible while another table row is active', async ({ page }) => {
  await page.goto('http://localhost:8979/test.html');
  await waitForEditorBootstrap(page);
  const doc = [
    '| Research source | Status |',
    '| --- | --- |',
    '| BPE[^bpe] | implemented |',
    '| SmolLM2/SmolTalk[^smollm2] | adapter |',
    '',
    '[^bpe]: BPE',
    '[^smollm2]: SmolLM2',
  ].join('\n');
  await page.evaluate(text => window.postMessage({ type: 'setText', text }, '*'), doc);
  await page.waitForSelector('#editor .cm-content');
  await page.evaluate(() => {
    const view = window.__cmView;
    view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 2 } });
    view.focus();
  });

  const smollm2 = page.locator('.cm-hybrid-footnote-ref[data-footnote-id="smollm2"]');
  await expect(smollm2).toBeVisible();
  await expect(smollm2).toHaveText('smollm2');
  await expect(page.locator('.cm-llm-wiki-link[aria-label="^smollm2"]')).toHaveCount(0);

  await page.evaluate(() => {
    const view = window.__cmView;
    const line = view.state.doc.line(4);
    view.dispatch({ selection: { anchor: line.from + line.text.indexOf('smollm2') + 2 } });
  });
  await expect(page.locator('.cm-active-footnote-ref')).toHaveText('smollm2');

  await page.evaluate(() => {
    const view = window.__cmView;
    view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 2 } });
  });
  await expect(smollm2).toBeVisible();
});
```

- [ ] **Step 3: Run both tests and capture RED**

Run:

```bash
node --test packages/vscode-extension/test/markdownSpans.test.mjs
pnpm exec playwright test --config playwright.config.ts \
  packages/vscode-extension/test/e2e/markdown-editor.spec.ts \
  --grep "long footnotes stay visible"
```

Expected: the parser includes `^smollm2`, and the browser renders
`.cm-llm-wiki-link[aria-label="^smollm2"]` instead of the footnote mark.

- [ ] **Step 4: Implement the parser boundary**

In `markdownReferenceDefinitionSourceSpan`, reject the footnote namespace
before destination parsing:

```typescript
const label = match[2] ?? '';
if (label.startsWith('^')) return null;
```

- [ ] **Step 5: Run focused GREEN and affected footnote coverage**

Run:

```bash
node --test packages/vscode-extension/test/markdownSpans.test.mjs
pnpm --filter llm-wiki-vscode build
pnpm exec playwright test --config playwright.config.ts \
  packages/vscode-extension/test/e2e/markdown-editor.spec.ts \
  --grep "footnote|footnotes"
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit the isolated fix**

```bash
git add \
  packages/vscode-extension/webview-src/markdownSpans.ts \
  packages/vscode-extension/test/markdownSpans.test.mjs \
  packages/vscode-extension/test/e2e/markdown-editor.spec.ts
git commit -m "fix(markdown): keep inactive footnotes visible"
```

---

### Task 2: Change the producer and validator contract

**Files:**
- Modify: `tools/demo-vault/rebuild_indexes.py:12-13,266-295`
- Modify: `tools/demo-vault/vault_checks.py:45-58,325-480,560-580,900-915`
- Modify: `tools/demo-vault/tests/test_rebuild_indexes.py:85-210`
- Modify: `tools/demo-vault/tests/test_validate_vault.py:405-455`
- Modify: `tools/demo-vault/tests/test_ci_contract.py`
- Modify: `tools/demo-vault/tests/test_operator_docs.py`

**Interfaces:**
- Produces: `INDEX_FILE = "_index.md"` as the producer's canonical output name
- Consumes: `build_indexes(vault_root: Path) -> dict[Path, str]`
- Preserves: `update_indexes(vault_root: Path, *, check: bool) -> tuple[Path, ...]`
- Validator contract: `_index.md` is reserved; `index.md` is an ordinary concept

- [ ] **Step 1: Convert producer expectations to `_index.md`**

Update expected output paths and lookups in `test_rebuild_indexes.py`, including:

```python
expected = {
    self.root / "_index.md",
    self.root / "raw/_index.md",
    self.root / "raw/assets/_index.md",
    self.root / "projects/_index.md",
    self.root / "projects/code/_index.md",
    self.root / "summaries/_index.md",
    self.root / "entities/_index.md",
    self.root / "concepts/_index.md",
    self.root / "comparisons/_index.md",
    self.root / "queries/_index.md",
}
self.assertNotIn(self.root / "index.md", outputs)
```

All other direct `index.md` lookups in this test become `_index.md`.

- [ ] **Step 2: Add validator regressions for the hard cutover**

Rename existing index-path fixtures to `_index.md` and add:

```python
def test_missing_raw_underscore_index_is_reported(self) -> None:
    (self.root / "raw/_index.md").unlink()
    self.assertIn("index.missing", self.issue_codes())

def test_plain_index_is_an_ordinary_concept(self) -> None:
    (self.root / "index.md").write_text(
        "# Legacy generated index\n",
        encoding="utf-8",
    )
    self.assertIn("okf.frontmatter", self.issue_codes())
```

- [ ] **Step 3: Update executable documentation-contract tests**

Change only current contract assertions in `test_ci_contract.py` and
`test_operator_docs.py` from `index.md` to `_index.md`. Keep historical
spec/plan documents out of these assertions.

- [ ] **Step 4: Run producer and validator tests and capture RED**

Run:

```bash
python3 -m unittest \
  tools.demo-vault.tests.test_rebuild_indexes \
  tools.demo-vault.tests.test_validate_vault \
  tools.demo-vault.tests.test_ci_contract \
  tools.demo-vault.tests.test_operator_docs -v
```

Expected: failures show generated/required paths still use `index.md`.

- [ ] **Step 5: Implement the producer filename change**

Change the producer constant:

```python
INDEX_FILE = "_index.md"
```

Continue using `directory / INDEX_FILE` everywhere; do not add a legacy
constant or fallback.

- [ ] **Step 6: Implement strict validator semantics**

Introduce/use one validator constant:

```python
INDEX_FILE = "_index.md"
RESERVED_MARKDOWN = {INDEX_FILE, "log.md"}
```

Replace hard-coded `index.md` branches so:

```python
if path == vault_root / INDEX_FILE:
    ...
if path.name == INDEX_FILE:
    ...
required = directory / INDEX_FILE
```

All concept enumerations must exclude `INDEX_FILE` and `log.md`, not
`index.md`.

- [ ] **Step 7: Run focused GREEN**

Run the same four-module unittest command from Step 4.

Expected: all tests pass.

- [ ] **Step 8: Commit the format tooling**

```bash
git add tools/demo-vault
git commit -m "feat(vault): make underscore indexes canonical"
```

---

### Task 3: Make extension directory resolution `_index.md`-only

**Files:**
- Modify: `packages/vscode-extension/src/filesystemWiki.ts:777-794`
- Modify: `packages/vscode-extension/src/localLinkTargetResolver.ts:83-109`
- Modify: `packages/vscode-extension/test/backlinksProvider.test.mjs:110-150`
- Modify: `packages/vscode-extension/test/localLinkTargetResolver.test.mjs:118-195`
- Modify: `packages/vscode-extension/test/uriDispatcher.test.mjs:129-190`

**Interfaces:**
- Consumes: `resolveKnownDocumentPath(candidate, documents, preferDirectoryIndex)`
- Consumes: `resolveLocalLinkTarget(vaultRoot, uri, probe, options)`
- Produces: directory targets resolving only to `_index.md`

- [ ] **Step 1: Update filesystem-graph expectations and add no-fallback coverage**

Use `_index.md` for the source and directory index:

```javascript
{ path: '_index.md', text: '[Concepts](concepts/)' },
{ path: 'concepts/_index.md', text: '# Concepts' },
```

Assert graph edges originate from `_index.md`. Add a second graph with only
`concepts/index.md` and assert its `concepts/` link has `resolved === false`.

- [ ] **Step 2: Update local resolver expectations and add legacy rejection**

Use `/vault/summaries/_index.md` in the positive probe and expect:

```javascript
{ uri: 'summaries/_index.md', origin: 'vault' }
```

Add:

```javascript
test('vault directories do not fall back to index.md', () => {
  const probe = probeFor(
    ['/vault/summaries/index.md'],
    ['/vault/summaries'],
  );
  assert.deepEqual(
    resolveLocalLinkTarget('/vault', 'summaries/', probe),
    { uri: 'summaries/', origin: 'unchanged' },
  );
});
```

- [ ] **Step 3: Update URI-dispatch directory coverage**

Create `summaries/_index.md` in the positive test and expect that exact path in
the `vscode.openWith` call. Add a directory containing only `index.md`, dispatch
its trailing-slash target, and assert no `vscode.openWith` call targets that
file.

- [ ] **Step 4: Run the three Node suites and capture RED**

Run:

```bash
node --test \
  packages/vscode-extension/test/backlinksProvider.test.mjs \
  packages/vscode-extension/test/localLinkTargetResolver.test.mjs \
  packages/vscode-extension/test/uriDispatcher.test.mjs
```

Expected: positive `_index.md` paths fail and legacy `index.md` still resolves.

- [ ] **Step 5: Implement graph resolution**

In `resolveKnownDocumentPath`, replace the directory candidate with:

```typescript
const directoryIndex = comparablePath(joinNotePath(candidate, '_index.md'));
```

Do not add `index.md` to the candidates.

- [ ] **Step 6: Implement URI directory resolution**

In `vaultRelativeTarget`, probe only:

```typescript
const indexPath = containedVaultPath(
  vaultRoot,
  `${bundlePath.replace(/[\\/]+$/, '')}/_index.md`,
);
```

When `direct` is a directory and that file does not exist, return
`undefined`; do not return the directory itself.

- [ ] **Step 7: Run focused GREEN**

Run the same three-suite Node command from Step 4.

Expected: all tests pass.

- [ ] **Step 8: Commit extension resolution**

```bash
git add \
  packages/vscode-extension/src/filesystemWiki.ts \
  packages/vscode-extension/src/localLinkTargetResolver.ts \
  packages/vscode-extension/test/backlinksProvider.test.mjs \
  packages/vscode-extension/test/localLinkTargetResolver.test.mjs \
  packages/vscode-extension/test/uriDispatcher.test.mjs
git commit -m "feat(extension): resolve underscore directory indexes"
```

---

### Task 4: Migrate the vault, skill, docs, and end-to-end fixtures

**Files:**
- Rename: `demo-vault/index.md` and every nested generated `index.md` to `_index.md`
- Modify: `demo-vault/AGENTS.md`
- Modify: `demo-vault/SCHEMA.md`
- Modify: `demo-vault/README.md`
- Modify: `demo-vault/log.md`
- Modify: `.agents/skills/llm-wiki/SKILL.md`
- Modify: `.agents/skills/llm-wiki/references/okf-profile.md`
- Modify: `README.md`
- Modify: `docs/TODO.md`
- Modify: `packages/vscode-extension/test/vscode-e2e/demo-vault.spec.ts`
- Modify: current non-historical fixtures and tests returned by `rg 'index\\.md'`

**Interfaces:**
- Consumes: canonical producer and validator from Task 2
- Consumes: `_index.md` directory resolution from Task 3
- Produces: a distributable demo vault with no hierarchical file named `index.md`

- [ ] **Step 1: Enumerate the exact migration set**

Run:

```bash
rg --files demo-vault packages/vscode-extension/test | rg '(^|/)index\\.md$'
rg -n 'index\\.md|root index|directory index|local index' \
  .agents/skills/llm-wiki README.md docs/TODO.md demo-vault \
  packages/vscode-extension/test/vscode-e2e
```

Classify historical documents under `docs/superpowers/specs` and
`docs/superpowers/plans` as immutable history; do not rewrite them.

- [ ] **Step 2: Rename generated vault indexes**

Use explicit `git mv` operations for every tracked generated index:

```bash
while IFS= read -r path; do
  git mv "$path" "$(dirname "$path")/_index.md"
done < <(rg --files demo-vault | rg '(^|/)index\\.md$')
```

Verify:

```bash
test -z "$(rg --files demo-vault | rg '(^|/)index\\.md$' || true)"
```

- [ ] **Step 3: Update current documentation and skill contracts**

Change all current instructions and examples to `_index.md`, including:

```markdown
Read the [root index](_index.md), [project index](projects/_index.md), and
[raw index](raw/_index.md).
```

The reusable skill invariants must say every visible owned directory has an
immediate-child `_index.md`.

- [ ] **Step 4: Update end-to-end expectations and fixtures**

Change Quick Open and navigation expectations in
`packages/vscode-extension/test/vscode-e2e/demo-vault.spec.ts` from
`index.md`/`code/index.md` to `_index.md`/`code/_index.md`. Update only tests
whose fixture represents a hierarchical vault index; leave deliberate
ordinary-link examples named `index.md` unchanged.

- [ ] **Step 5: Rebuild the complete vault**

Run:

```bash
python3 tools/demo-vault/rebuild_indexes.py --vault demo-vault
```

Expected: only `_index.md` outputs are reported or all are already current.

- [ ] **Step 6: Add the material-change log entry**

Add a newest-first `## 2026-08-17` section to `demo-vault/log.md` recording:

```markdown
* **Index migration**: Renamed every hierarchical index to `_index.md`; the
  producer, validator, extension, skill, and operator documentation no longer
  recognize `index.md` as an index.
* **Markdown rendering**: Footnote definitions no longer enter the collapsed
  reference-link index, so long inactive references remain visible in active
  tables.
```

- [ ] **Step 7: Run vault completion gates**

Run:

```bash
python3 tools/demo-vault/rebuild_indexes.py --vault demo-vault --check
python3 tools/demo-vault/validate_vault.py --vault demo-vault
python3 -m unittest discover -s tools/demo-vault/tests -v
git lfs ls-files
git submodule status -- demo-vault/projects/code/nanochat
```

Expected: indexes up to date, validation succeeds, all producer tests pass,
PDFs remain under LFS, and the Nanochat gitlink remains pinned.

- [ ] **Step 8: Run repository verification**

Run sequentially:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
git diff --check
git status --short
```

Expected: 600 or more tests pass with zero failures; lint, typecheck, build,
and diff checks exit 0; status contains only intended changes.

- [ ] **Step 9: Commit the atomic migration**

```bash
git add \
  .agents/skills/llm-wiki \
  README.md docs/TODO.md demo-vault \
  packages/vscode-extension/test/vscode-e2e/demo-vault.spec.ts \
  packages/vscode-extension/test
git commit -m "docs(vault): migrate hierarchical indexes"
```

- [ ] **Step 10: Review the complete branch**

Run:

```bash
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
git status --short
```

Confirm there is no fallback string that resolves a directory to `index.md`:

```bash
rg -n \"directoryIndex|/index\\.md|joinNotePath\\(candidate, 'index\\.md'\\)\" \
  packages/vscode-extension/src tools/demo-vault
```

Expected: no production fallback remains and the worktree is clean.
