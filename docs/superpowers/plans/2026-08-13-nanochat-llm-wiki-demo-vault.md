# Nanochat LLM Wiki Demo Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a source-grounded Nanochat LLM wiki as a faithful OKF v0.2 bundle, then prove that it reads smoothly through the LLM Wiki extension in VS Code and Cursor.

**Architecture:** `demo-vault/` is the distributable OKF root. Immutable paper companions and Git-LFS PDFs live under `raw/`; Nanochat is an exact-commit submodule under `projects/code/`; summaries, entities, concepts, comparisons, and saved queries are first-class OKF concepts at the bundle root. Deterministic producer tools and the reusable `llm-wiki` skill live outside the bundle so their Markdown does not become accidental OKF concepts.

**Tech Stack:** Python 3 standard library, `pdftotext`, Git, Git LFS, Markdown with YAML-compatible JSON-flow frontmatter, Git submodules, TypeScript, Playwright, VS Code Extension Development Host, Cursor.

## Global Constraints

- `demo-vault/` itself is the OKF v0.2 bundle root.
- Every non-reserved Markdown file below the bundle root has parseable frontmatter with a non-empty `type`.
- Every visible bundle-owned directory has an `index.md`; the Nanochat submodule is an opaque exception indexed by `projects/code/index.md`.
- Indexes contain immediate children only and are generated deterministically from real metadata.
- Raw companions are flat under `raw/`; same-basename PDFs live under `raw/assets/`.
- Raw filenames derive from canonical paper titles, not arXiv IDs.
- Mirrored paper versions must have verified redistribution permission.
- Existing raw snapshots are immutable; ingestion is atomic.
- Binary assets use extension-specific Git LFS rules; Markdown never enters LFS.
- Nanochat source is a Git submodule pinned to one exact commit, never a copied snapshot.
- Compiled claims cite raw paper companions and/or exact pinned Nanochat files.
- Lifecycle values are only `draft`, `stable`, and `deprecated`.
- No database, vector store, embeddings, runtime cache, or editor state is committed.
- New producer behavior follows strict red-green-refactor TDD.
- Completion requires automated checks plus real reading acceptance in VS Code and Cursor.

---

### Task 1: Migrate producer tooling outside the OKF bundle

**Files:**
- Move: `demo-vault/scripts/*.py` → `tools/demo-vault/*.py`
- Move: `demo-vault/scripts/tests/` → `tools/demo-vault/tests/`
- Delete after migration: `demo-vault/scripts/`
- Test: `tools/demo-vault/tests/test_cli_paths.py`

**Interfaces:**
- Consumes: current `vaultlib.py`, `ingest_arxiv.py`, `rebuild_indexes.py`, and `validate_vault.py`.
- Produces: all CLIs accept `--vault PATH`; the default resolves to repository-root `demo-vault/`.

- [ ] **Step 1: Write a failing CLI-path test**

```python
def test_default_vault_is_repository_demo_vault():
    expected = Path(__file__).resolve().parents[3] / "demo-vault"
    assert default_vault_root() == expected
```

- [ ] **Step 2: Run the test and verify the old in-bundle default fails**

Run:

```bash
python3 tools/demo-vault/tests/test_cli_paths.py -v
```

Expected: failure because the external tool module/default does not exist.

- [ ] **Step 3: Move the implementation and expose one shared default**

Add to `tools/demo-vault/vaultlib.py`:

```python
def default_vault_root() -> Path:
    return Path(__file__).resolve().parents[2] / "demo-vault"
```

Import it into each CLI and use it as the `--vault` default.

- [ ] **Step 4: Run all producer tests**

Run:

```bash
python3 -m unittest discover -s tools/demo-vault/tests -v
```

Expected: all migrated tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/demo-vault demo-vault/scripts
git commit -m "refactor: move vault producer tools outside bundle"
```

### Task 2: Generate the complete hierarchical index tree

**Files:**
- Modify: `tools/demo-vault/rebuild_indexes.py`
- Modify: `tools/demo-vault/vaultlib.py`
- Replace: `tools/demo-vault/tests/test_rebuild_indexes.py`

**Interfaces:**
- Consumes: `parse_frontmatter(text) -> FrontmatterDocument`.
- Produces: `build_indexes(vault_root: Path) -> dict[Path, str]` for every owned directory; `update_indexes(vault_root, check) -> tuple[Path, ...]`.

- [ ] **Step 1: Write failing bottom-up hierarchy tests**

Use a temporary bundle containing a `Paper`, its PDF, a `Software Project`,
two compiled concepts, and an opaque `projects/code/nanochat` directory.
Assert literal outputs:

```python
assert root / "raw/index.md" in outputs
assert root / "raw/assets/index.md" in outputs
assert root / "projects/code/index.md" in outputs
assert root / "projects/code/nanochat/index.md" not in outputs
assert "[assets](assets/index.md)" in outputs[root / "raw/index.md"]
assert "[Archived PDF](paper.pdf)" in outputs[root / "raw/assets/index.md"]
```

- [ ] **Step 2: Run the index test and observe the old `wiki/` assumptions fail**

Run:

```bash
python3 tools/demo-vault/tests/test_rebuild_indexes.py -v
```

Expected: failures for missing raw/assets/code indexes and nested `wiki/`
paths.

- [ ] **Step 3: Implement generic bottom-up indexing**

Implement:

```python
def owned_directories(vault_root: Path) -> tuple[Path, ...]: ...
def child_records(directory: Path, vault_root: Path) -> tuple[IndexRecord, ...]: ...
def build_index(directory: Path, vault_root: Path, records: tuple[IndexRecord, ...]) -> str: ...
```

Rules:

- skip hidden directories and `projects/code/nanochat`;
- parse immediate Markdown concepts except reserved files;
- list non-Markdown files as resources;
- group concepts by exact `type`;
- group directories under `Subdirectories`;
- use `Resources` for PDFs and other files;
- put only `okf_version: "0.2"` frontmatter on the root index;
- sort sections and entries deterministically; and
- reject missing `title` or `description` rather than synthesizing them.

- [ ] **Step 4: Verify generation and check mode**

Run:

```bash
python3 -m unittest tools/demo-vault/tests/test_rebuild_indexes.py -v
```

Expected: all index tests pass, including byte-for-byte repeatability.

- [ ] **Step 5: Commit**

```bash
git add tools/demo-vault/rebuild_indexes.py tools/demo-vault/vaultlib.py tools/demo-vault/tests/test_rebuild_indexes.py
git commit -m "feat: generate hierarchical OKF indexes"
```

### Task 3: Make arXiv companions first-class OKF Paper concepts

**Files:**
- Modify: `tools/demo-vault/ingest_arxiv.py`
- Modify: `tools/demo-vault/tests/test_ingest_arxiv.py`
- Keep fixture: `tools/demo-vault/tests/fixtures/arxiv-1508.07909v5.html`

**Interfaces:**
- Consumes: exact `ArxivRef`, canonical `PaperMetadata`, PDF loader, and text extractor.
- Produces: same-basename title-derived files such as `raw/neural-machine-translation-of-rare-words-with-subword-units.md` and `raw/assets/neural-machine-translation-of-rare-words-with-subword-units.pdf`; companion metadata with `type: Paper`, OKF provenance/lifecycle fields, integrity extensions, and extraction metadata.

- [ ] **Step 1: Add failing assertions for the OKF contract**

```python
assert document.metadata["type"] == "Paper"
assert document.metadata["resource"] == "https://arxiv.org/abs/1508.07909v5"
assert document.metadata["status"] == "stable"
assert document.metadata["generated"] == {
    "by": "process:arxiv-ingest",
    "at": "2026-08-13T00:00:00Z",
}
assert document.metadata["sources"][0]["id"] == "arxiv-record"
assert document.metadata["attachment"]["resource"] == f"assets/{SLUG}.pdf"
assert document.metadata["attachment"]["bytes"] == len(pdf_bytes)
```

- [ ] **Step 2: Run and confirm the old source-only frontmatter fails**

Run:

```bash
python3 -m unittest tools/demo-vault/tests/test_ingest_arxiv.py -v
```

Expected: failure on missing OKF fields.

- [ ] **Step 3: Implement the Paper frontmatter**

Keep immutable collision/no-op/atomicity behavior. Add exact ISO datetime input
for reproducible tests; CLI defaults to current UTC. Record authors, version
dates, `sources`, `generated`, `status`, attachment byte size, body/PDF hashes,
and extraction version.

- [ ] **Step 4: Run ingestion tests**

Run:

```bash
python3 -m unittest tools/demo-vault/tests/test_ingest_arxiv.py -v
```

Expected: every metadata, rejection, collision, no-op, and atomicity test
passes.

- [ ] **Step 5: Commit**

```bash
git add tools/demo-vault/ingest_arxiv.py tools/demo-vault/tests/test_ingest_arxiv.py
git commit -m "feat: emit OKF paper snapshots"
```

### Task 4: Validate base OKF plus the strict Nanochat-wiki profile

**Files:**
- Modify: `tools/demo-vault/vault_checks.py`
- Modify: `tools/demo-vault/validate_vault.py`
- Replace: `tools/demo-vault/tests/test_validate_vault.py`

**Interfaces:**
- Consumes: bundle root, generated-index output, Markdown targets, raw integrity metadata, Git/LFS/submodule state.
- Produces: `validate_vault(vault_root, git_state=None) -> tuple[Issue, ...]`; each issue has stable `code`, bundle-relative `path`, and actionable `message`.

- [ ] **Step 1: Replace the fixture with the approved root layout**

The valid fixture has typed root concepts, `raw/index.md`,
`raw/assets/index.md`, `projects/code/index.md`, and root-level compiled
directories. Add focused failing tests for:

```python
assert "okf.frontmatter" in issue_codes_after_untyped_readme
assert "index.missing" in issue_codes_after_removing_raw_index
assert "index.stale" in issue_codes_after_adding_unindexed_pdf
assert "lfs.markdown" in issue_codes_when_index_has_lfs_filter
assert "page.generated" in issue_codes_when_generated_at_is_missing
assert "page.status" in issue_codes_when_status_is_contested
assert "source.footnote" in issue_codes_when_claim_footnote_has_no_source_id
```

- [ ] **Step 2: Run and verify failures against the old profile**

Run:

```bash
python3 -m unittest tools/demo-vault/tests/test_validate_vault.py -v
```

Expected: failures because the old validator forbids `raw/index.md`, expects a
`wiki/` subtree, permits `contested`, and routes every asset—including
Markdown—through LFS.

- [ ] **Step 3: Implement the new checks**

Implement independent checks for:

- base OKF conformance of all non-reserved Markdown;
- reserved root/nested index and log structure;
- complete owned-directory index coverage;
- profile field/type/directory agreement;
- raw title/version/license/hash/attachment integrity;
- source entries and footnote IDs;
- internal links and minimum meaningful compiled cross-links;
- allowed lifecycle, actor, ISO timestamp, and tag values;
- symmetric conflict extensions without changing lifecycle;
- Git LFS for binary extensions and explicitly not `.md`;
- forbidden runtime state;
- project card/gitmodules/gitlink/checkout agreement; and
- deterministic generated indexes.

- [ ] **Step 4: Run the complete producer suite**

Run:

```bash
python3 -m unittest discover -s tools/demo-vault/tests -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/demo-vault/vault_checks.py tools/demo-vault/validate_vault.py tools/demo-vault/tests/test_validate_vault.py
git commit -m "feat: validate strict OKF demo vault profile"
```

### Task 5: Build the operator handbook and reusable setup skill

**Files:**
- Create: `.agents/skills/llm-wiki/SKILL.md`
- Create: `.agents/skills/llm-wiki/references/arxiv-ingestion.md`
- Create: `.agents/skills/llm-wiki/references/authoring-workflow.md`
- Create: `.agents/skills/llm-wiki/references/okf-profile.md`
- Create: `demo-vault/README.md`
- Create: `demo-vault/SCHEMA.md`
- Create: `demo-vault/AGENTS.md`
- Move/replace: `tools/demo-vault/tests/test_operator_docs.py`

**Interfaces:**
- Consumes: exact external CLI commands and approved profile.
- Produces: an agent-triggerable `llm-wiki` skill and executable human/agent workflow documentation.

- [ ] **Step 1: Use `superpowers:writing-skills` and `skill-creator`**

Read both complete instruction files. Create pressure scenarios covering new
vault setup, existing-vault preservation, exact arXiv ingestion, contradictory
sources, and post-mutation validation.

- [ ] **Step 2: Establish failing baseline behavior**

Run the scenarios without the new skill and record where an agent omits
orientation, mutates raw evidence, creates non-OKF Markdown, or forgets
hierarchical indexes.

- [ ] **Step 3: Write the minimal skill and references**

`SKILL.md` contains only supported skill metadata (`name`, `description`) and
routes to focused references. `AGENTS.md` is an OKF `Playbook` with the exact
commands and workflows specified by the design. `README.md` and `SCHEMA.md`
are OKF `Reference` concepts.

- [ ] **Step 4: Re-run skill pressure tests and CLI smoke tests**

Run:

```bash
python3 -m unittest tools/demo-vault/tests/test_operator_docs.py -v
python3 tools/demo-vault/ingest_arxiv.py --help
python3 tools/demo-vault/rebuild_indexes.py --help
python3 tools/demo-vault/validate_vault.py --help
```

Expected: workflow scenarios comply; every documented CLI is runnable.

- [ ] **Step 5: Commit**

```bash
git add .agents/skills/llm-wiki demo-vault/README.md demo-vault/SCHEMA.md demo-vault/AGENTS.md tools/demo-vault/tests/test_operator_docs.py
git commit -m "feat: add OKF vault operator skill"
```

### Task 6: Establish the pinned Nanochat project layer

**Files:**
- Modify: `.gitmodules`
- Add gitlink: `demo-vault/projects/code/nanochat`
- Create: `demo-vault/projects/nanochat.md`
- Generated: `demo-vault/projects/index.md`
- Generated: `demo-vault/projects/code/index.md`

**Interfaces:**
- Consumes: upstream `https://github.com/karpathy/nanochat.git` and reviewed exact commit.
- Produces: initialized submodule, typed project card, and indexed code resource with matching commit metadata.

- [ ] **Step 1: Run the validator and capture the missing/mismatched project failures**

Run:

```bash
python3 tools/demo-vault/validate_vault.py --vault demo-vault
```

Expected: project-card/gitmodules/gitlink/checkout issues.

- [ ] **Step 2: Add or correct the submodule**

```bash
git submodule add https://github.com/karpathy/nanochat.git demo-vault/projects/code/nanochat
git -C demo-vault/projects/code/nanochat checkout 92d63d4e8bb4df75c3b71618f31ddde2378b2bcd
git add .gitmodules demo-vault/projects/code/nanochat
```

If the submodule already exists, inspect and correct it without replacing user
work.

- [ ] **Step 3: Author the project card from the pinned source**

Record exact commit, license, default branch, source path, primary scripts,
model/tokenizer/data/evaluation entry points, and links to relevant compiled
pages. Do not copy source files into `raw/`.

- [ ] **Step 4: Rebuild and validate project invariants**

Run:

```bash
python3 tools/demo-vault/rebuild_indexes.py --vault demo-vault
python3 tools/demo-vault/validate_vault.py --vault demo-vault
git ls-files --stage demo-vault/projects/code/nanochat
git -C demo-vault/projects/code/nanochat rev-parse HEAD
```

Expected: git mode `160000`; both OIDs equal the card's full commit.

- [ ] **Step 5: Commit**

```bash
git add .gitmodules demo-vault/projects
git commit -m "feat: pin Nanochat project source"
```

### Task 7: Ingest the license-verified research corpus

**Files:**
- Create: `demo-vault/raw/*.md`
- Create: `demo-vault/raw/assets/*.pdf`
- Modify: `demo-vault/.gitattributes`
- Generated: `demo-vault/raw/index.md`
- Generated: `demo-vault/raw/assets/index.md`
- Modify: `demo-vault/log.md`

**Interfaces:**
- Consumes: exact versioned arXiv IDs and the production ingester.
- Produces: at least eight title-derived immutable Markdown/PDF pairs with verified license and hashes.

- [ ] **Step 1: Inspect pinned Nanochat and finalize the paper manifest**

Map central source files and README references to tokenization, data curation,
architecture, attention, numerics, optimization, post-training, inference, and
evaluation. Keep the eight required papers and add only papers that materially
ground the actual implementation.

- [ ] **Step 2: Verify each exact arXiv version's license before download**

For every manifest entry, retain the canonical arXiv page as provenance. Do
not ingest a paper unless its exact page identifies CC BY 4.0 or another
explicitly approved redistribution license supported by the ingester.

- [ ] **Step 3: Ingest through the delivered workflow**

Run once per version:

```bash
python3 tools/demo-vault/ingest_arxiv.py --vault demo-vault --id 1508.07909v5
python3 tools/demo-vault/ingest_arxiv.py --vault demo-vault --id 2406.17557v2
python3 tools/demo-vault/ingest_arxiv.py --vault demo-vault --id 2406.11794v4
python3 tools/demo-vault/ingest_arxiv.py --vault demo-vault --id 2502.02737v1
python3 tools/demo-vault/ingest_arxiv.py --vault demo-vault --id 2305.13245v3
python3 tools/demo-vault/ingest_arxiv.py --vault demo-vault --id 2407.08608v2
python3 tools/demo-vault/ingest_arxiv.py --vault demo-vault --id 2209.05433v2
python3 tools/demo-vault/ingest_arxiv.py --vault demo-vault --id 2305.18290v3
```

Expected: eight `created` results, each naming a title-derived Markdown
companion and same-basename PDF.

- [ ] **Step 4: Configure and verify Git LFS**

Use patterns such as:

```gitattributes
raw/assets/**/*.pdf filter=lfs diff=lfs merge=lfs -text
raw/assets/**/*.png filter=lfs diff=lfs merge=lfs -text
raw/assets/**/*.jpg filter=lfs diff=lfs merge=lfs -text
raw/assets/**/*.jpeg filter=lfs diff=lfs merge=lfs -text
raw/assets/**/*.webp filter=lfs diff=lfs merge=lfs -text
```

Then run:

```bash
git lfs ls-files
git check-attr filter -- demo-vault/raw/assets/index.md
```

Expected: every PDF appears in LFS; `index.md` is `unspecified`.

- [ ] **Step 5: Rebuild, validate, and record the ingest**

Run:

```bash
python3 tools/demo-vault/rebuild_indexes.py --vault demo-vault
python3 tools/demo-vault/validate_vault.py --vault demo-vault
```

Add a newest-first dated entry to `log.md`.

- [ ] **Step 6: Commit**

```bash
git add demo-vault/raw demo-vault/.gitattributes demo-vault/log.md
git commit -m "feat: ingest Nanochat research corpus"
```

### Task 8: Author the meaningful compiled wiki

**Files:**
- Create: `demo-vault/summaries/*.md`
- Create: `demo-vault/entities/*.md`
- Create: `demo-vault/concepts/*.md`
- Create: `demo-vault/comparisons/*.md`
- Create: `demo-vault/queries/*.md`
- Generated: every category `index.md`
- Modify: `demo-vault/log.md`

**Interfaces:**
- Consumes: raw companions, archived PDFs, project card, and exact pinned Nanochat files.
- Produces: the complete page inventory in the design, plus only necessary source-driven additions.

- [ ] **Step 1: Build a source-to-page evidence matrix**

For every planned page, identify at least one raw paper and/or exact Nanochat
file, plus two meaningful related compiled pages. Drop or merge any page that
cannot answer a durable question without duplication.

- [ ] **Step 2: Author summaries and entities**

Each file uses its exact OKF type, registered tags, lifecycle/provenance,
claim-level source footnotes, and related-page links. Summaries provide the
primary narrative path; entities orient datasets, model families, and
projects.

- [ ] **Step 3: Author concepts and comparisons**

Explain mechanism and implementation connection precisely. Comparisons state
a decision frame and avoid declaring a universal winner when evidence is
conditional.

- [ ] **Step 4: Author saved queries**

Each query begins with a direct answer, follows with an evidence trail and
limits, and links into summaries/concepts rather than duplicating them.

- [ ] **Step 5: Rebuild and validate after each category**

Run:

```bash
python3 tools/demo-vault/rebuild_indexes.py --vault demo-vault
python3 tools/demo-vault/validate_vault.py --vault demo-vault
```

Expected: no missing sources, footnotes, links, cross-links, or stale indexes.

- [ ] **Step 6: Perform a grounded-content audit**

Sample every page and inspect every quantitative or implementation-specific
claim against its paper companion, PDF, or pinned code. Remove unsupported
claims; never convert synthesis into false source fact.

- [ ] **Step 7: Commit**

```bash
git add demo-vault/summaries demo-vault/entities demo-vault/concepts demo-vault/comparisons demo-vault/queries demo-vault/log.md demo-vault/index.md
git commit -m "feat: compile Nanochat LLM wiki"
```

### Task 9: Add automated real-vault extension reading coverage

**Files:**
- Create: `packages/vscode-extension/test/vscode-e2e/demo-vault-reading.spec.ts`
- Modify: `packages/vscode-extension/test/vscode-e2e/global-setup.mjs`
- Modify: `packages/vscode-extension/test/vscode-e2e/global-teardown.mjs`
- Modify if necessary: `packages/vscode-extension/test/vscode-e2e/sandboxFixtures.mjs`

**Interfaces:**
- Consumes: built extension and repository `demo-vault/`.
- Produces: a sandboxed VS Code E2E run proving the two primary reading paths and capturing screenshots.

- [ ] **Step 1: Write a failing real-vault E2E test**

The test opens the repository `demo-vault/` rather than the small legacy
fixture, then asserts:

```typescript
await openQuickFile(page, 'index.md');
expect(await markdownSource('Nanochat LLM Wiki')).toContain('summaries/index.md');
await clickMarkdownLink('Nanochat end-to-end training pipeline');
await clickMarkdownLink('Byte-pair encoding');
await clickMarkdownLink('Neural Machine Translation of Rare Words');
await clickMarkdownLink('Open the archived PDF');
expect(await pdfPageCount()).toBeGreaterThan(0);
```

Add a second path through `projects/nanochat.md` to an exact source file.

- [ ] **Step 2: Run and verify the old fixture/setup cannot satisfy the test**

Run:

```bash
pnpm --filter llm-wiki-vscode test:vscode-e2e \
  --grep "demo vault reading"
```

Expected: failure because global setup still opens the legacy fixture or the
new navigation helpers are absent.

- [ ] **Step 3: Add isolated real-vault setup and helpers**

Copy the bundle into a temporary workspace while preserving or initializing
the submodule; keep all E2E mutations outside the source tree. Do not weaken
existing tests.

- [ ] **Step 4: Fix only demonstrated extension defects with TDD**

If relative link navigation, long-document rendering, PDF opening, backlinks,
or code-resource opening fails, add the narrowest failing unit/E2E regression
test first, then fix the extension.

- [ ] **Step 5: Run extension verification**

Run:

```bash
pnpm typecheck
pnpm --filter llm-wiki-vscode build
pnpm --filter llm-wiki-vscode test
pnpm --filter llm-wiki-vscode test:vscode-e2e --grep "demo vault reading"
```

Expected: all commands pass and screenshots show the real wiki.

- [ ] **Step 6: Commit**

```bash
git add packages/vscode-extension/test packages/vscode-extension/src
git commit -m "test: verify real demo vault reading flow"
```

### Task 10: Complete manual VS Code and Cursor acceptance

**Files:**
- Create: `docs/testing/nanochat-demo-vault-reading-acceptance.md`
- Create: `e2e-report/demo-vault-reading/*.png`
- Modify only on reproduced defects: extension source/tests.

**Interfaces:**
- Consumes: validated bundle, built extension, VS Code, Cursor, and the documented reading paths.
- Produces: editor-specific acceptance notes and screenshots.

- [ ] **Step 1: Run the full repository and vault gates**

```bash
python3 -m unittest discover -s tools/demo-vault/tests -v
python3 tools/demo-vault/rebuild_indexes.py --vault demo-vault --check
python3 tools/demo-vault/validate_vault.py --vault demo-vault
git lfs ls-files
git submodule status -- demo-vault/projects/code/nanochat
pnpm lint
pnpm typecheck
pnpm --filter llm-wiki-vscode build
```

- [ ] **Step 2: Exercise VS Code through Computer Use**

Open `demo-vault/` in an Extension Development Host. Follow both primary
paths, use Quick Open/search, inspect outline and backlinks, open one archived
PDF, and open one pinned Nanochat source file. Capture screenshots.

- [ ] **Step 3: Exercise Cursor through Computer Use**

Load the built extension in Cursor and repeat the same paths. Verify Cursor's
host-specific controls do not obscure navigation or reading. Capture
screenshots.

- [ ] **Step 4: Reproduce and fix any defect test-first**

For every blocker or material rough edge, write a failing automated regression
test, verify the failure, implement the smallest fix, and rerun both editors.

- [ ] **Step 5: Write acceptance evidence**

Record exact versions, commands, paths exercised, observations, screenshot
links, and any accepted non-blocking limitations in
`docs/testing/nanochat-demo-vault-reading-acceptance.md`.

- [ ] **Step 6: Final clean-tree verification and commit**

```bash
git status --short
python3 tools/demo-vault/rebuild_indexes.py --vault demo-vault --check
python3 tools/demo-vault/validate_vault.py --vault demo-vault
git add docs/testing e2e-report/demo-vault-reading
git commit -m "test: record Nanochat wiki editor acceptance"
```

Expected: no unaccounted changes; every completion-evidence item in the design
is backed by current command output, files, or screenshots.
