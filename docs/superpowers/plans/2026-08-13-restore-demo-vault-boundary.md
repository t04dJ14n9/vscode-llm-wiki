# Restore Demo Vault Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore `demo-vault/` as the distributable Nanochat OKF bundle and make CI reject any future promotion of its contents into the extension repository root.

**Architecture:** Reverse the two commits that changed the approved bundle boundary, preserving all earlier extension and release work. Keep reusable producer code and the `llm-wiki` skill outside the bundle, restore the real-vault VS Code acceptance fixtures, and add a dedicated CI job that checks the Python producer suite, deterministic indexes, validator, Git LFS assets, and pinned Nanochat submodule.

**Tech Stack:** Git, Python `unittest`, Node.js 22, pnpm 10.28.2, GitHub Actions, Git LFS, Git submodules.

## Global Constraints

- `demo-vault/` is the OKF v0.2 bundle root and unit of distribution.
- Vault content includes `AGENTS.md`, `README.md`, `SCHEMA.md`, `index.md`, `log.md`, `comparisons/`, `concepts/`, `entities/`, `projects/`, `queries/`, `raw/`, and `summaries/`.
- Producer code and tests live outside the bundle under `tools/demo-vault/`.
- The Nanochat gitlink remains at `demo-vault/projects/code/nanochat` and stays pinned to its existing commit.
- PDF evidence remains tracked through Git LFS under `demo-vault/raw/assets/`.
- Preserve every commit and feature before `19f1567d`; reverse only `19f1567d` and its root-only follow-up `a3ce56da`.
- CI must run the existing Node quality and browser jobs plus a dedicated demo-vault validation job.

---

### Task 1: Restore the approved repository and vault boundary

**Files:**
- Restore: `demo-vault/**`
- Restore: `tools/demo-vault/**`
- Restore: `packages/vscode-extension/test/vscode-e2e/demo-vault.spec.ts`
- Restore: `packages/vscode-extension/test/vscode-e2e/workspaceRoot.mjs`
- Restore: `packages/vscode-extension/test/vscodeE2eWorkspace.test.mjs`
- Modify: `.gitmodules`
- Modify: `.gitignore`
- Modify: `.vscode/launch.json`
- Modify: `README.md`
- Modify: `.agents/skills/llm-wiki/**`
- Remove misplaced vault payload: root `AGENTS.md`, `SCHEMA.md`, `index.md`, `log.md`, `comparisons/`, `concepts/`, `entities/`, `projects/`, `queries/`, `raw/`, and `summaries/`
- Remove renamed producer path after restoration: `tools/okf/`

**Interfaces:**
- Consumes: approved design at `docs/superpowers/specs/2026-08-13-nanochat-llm-wiki-demo-vault-design.md`.
- Produces: `default_vault_root() -> Path` resolving to repository `demo-vault/`; VS Code E2E can explicitly open `demo-vault/`.

- [ ] **Step 1: Restore the failing boundary test first**

Restore `tools/demo-vault/tests/test_cli_paths.py` with:

```python
class CliPathTests(unittest.TestCase):
    def test_default_vault_is_repository_demo_vault(self) -> None:
        expected = Path(__file__).resolve().parents[3] / "demo-vault"

        self.assertEqual(default_vault_root(), expected)
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
python3 -m unittest tools/demo-vault/tests/test_cli_paths.py -v
```

Expected: FAIL because the promoted implementation resolves the repository root or because the restored module path is not yet present.

- [ ] **Step 3: Reverse only the two boundary-breaking commits**

Apply the inverse of `a3ce56da97bc330ccad4b7e054fc736760fd0beb`, then the inverse of `19f1567d36499798633af5252c481046903a53d4`, without creating intermediate commits. Resolve only path-level conflicts needed to preserve the restored failing test.

- [ ] **Step 4: Verify GREEN and full producer coverage**

Run:

```bash
python3 -m unittest discover -s tools/demo-vault/tests -v
python3 tools/demo-vault/rebuild_indexes.py --vault demo-vault --check
python3 tools/demo-vault/validate_vault.py --vault demo-vault
git submodule status -- demo-vault/projects/code/nanochat
git lfs ls-files
```

Expected: all tests and validators pass; the gitlink has no `-` or `+` prefix; PDF evidence appears under `demo-vault/raw/assets/`.

- [ ] **Step 5: Run extension tests affected by restored workspace routing**

Run:

```bash
pnpm --filter llm-wiki-vscode test
```

Expected: PASS, including `vscodeE2eWorkspace.test.mjs`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix: restore dedicated demo vault"
```

### Task 2: Make CI enforce the demo-vault contract

**Files:**
- Modify: `.github/workflows/quality.yml`
- Create: `tools/demo-vault/tests/test_ci_contract.py`

**Interfaces:**
- Consumes: the restored `tools/demo-vault/` CLIs and `demo-vault/` bundle.
- Produces: a `demo-vault` GitHub Actions job that checks out Git LFS objects and submodules, runs producer tests, checks deterministic indexes, validates the bundle, and verifies the Nanochat gitlink.

- [ ] **Step 1: Write the failing CI contract test**

Create `tools/demo-vault/tests/test_ci_contract.py` that loads `.github/workflows/quality.yml` as text and asserts the exact presence of:

```text
lfs: true
submodules: recursive
python3 -m unittest discover -s tools/demo-vault/tests -v
python3 tools/demo-vault/rebuild_indexes.py --vault demo-vault --check
python3 tools/demo-vault/validate_vault.py --vault demo-vault
git submodule status -- demo-vault/projects/code/nanochat
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
python3 -m unittest tools/demo-vault/tests/test_ci_contract.py -v
```

Expected: FAIL because the current workflow has no demo-vault job or checkout options.

- [ ] **Step 3: Add the dedicated CI job**

Add a `demo-vault` job to `.github/workflows/quality.yml` with:

```yaml
  demo-vault:
    name: Validate distributable demo vault
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Check out repository, LFS evidence, and Nanochat
        uses: actions/checkout@v4
        with:
          lfs: true
          submodules: recursive

      - name: Run demo-vault producer tests
        run: python3 -m unittest discover -s tools/demo-vault/tests -v

      - name: Check deterministic demo-vault indexes
        run: python3 tools/demo-vault/rebuild_indexes.py --vault demo-vault --check

      - name: Validate demo-vault
        run: python3 tools/demo-vault/validate_vault.py --vault demo-vault

      - name: Verify pinned Nanochat submodule
        run: git submodule status -- demo-vault/projects/code/nanochat
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
python3 -m unittest discover -s tools/demo-vault/tests -v
```

Expected: PASS.

- [ ] **Step 5: Run all local CI equivalents**

Run:

```bash
pnpm check
pnpm build:extension
pnpm exec playwright test --config playwright.config.ts packages/vscode-extension/test/e2e/markdown-editor-fuzz.spec.ts
pnpm exec playwright test --config playwright.config.ts packages/vscode-extension/test/e2e/markdown-editor-vim-command-fuzz.spec.ts
pnpm exec playwright test --config playwright.config.ts --grep-invert 'LLM Wiki Markdown (deterministic keystroke fuzzing|expanded Vim command fuzzing)'
python3 -m unittest discover -s tools/demo-vault/tests -v
python3 tools/demo-vault/rebuild_indexes.py --vault demo-vault --check
python3 tools/demo-vault/validate_vault.py --vault demo-vault
git submodule status -- demo-vault/projects/code/nanochat
git diff --check
```

Expected: every command passes. The four intentionally manual Playwright tests may remain skipped.

- [ ] **Step 6: Commit and push**

```bash
git add .github/workflows/quality.yml tools/demo-vault/tests/test_ci_contract.py
git commit -m "ci: validate distributable demo vault"
git push origin main
```

After the push, wait for the `Quality` workflow on the new commit and verify every job concludes `success`.
