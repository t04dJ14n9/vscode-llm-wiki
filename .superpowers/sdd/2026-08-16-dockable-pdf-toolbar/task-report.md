# Dockable PDF Toolbar — Verification Report

Date: 2026-08-16

## Delivered behavior

- The PDF toolbar has exactly two visible docks: `top` and `left`.
- Both docks occupy layout space; neither overlays the PDF viewer or its internal sidebar.
- A dedicated, accessible **Move PDF toolbar** grip owns pointer dragging.
- Dragging commits only over the top or left targets. Middle releases and `Escape`
  preserve the prior dock.
- **Display options** exposes **Move toolbar to top**, **Move toolbar to left**,
  and **Hide toolbar**.
- `Shift+T` hides or restores the toolbar while focus is in the PDF, but is ignored
  in editable controls.
- **LLM Wiki: Toggle PDF Toolbar** restores or hides it from the Command Palette.
- Dock and hidden state persist globally, synchronize across open PDF viewers, and
  survive window reloads.

## TDD evidence

The viewer browser tests were first observed RED:

- no `#pdf-reader-layout`;
- no accessible **Move PDF toolbar** grip;
- no **Hide toolbar** action.

Two additional regressions were captured RED during self-review:

1. A left-docked menu in a 260 px editor group extended to x=294, beyond the
   260 px viewport. The menu now clamps to both viewport edges.
2. A same-value host preference echo could cancel a subsequent active grip drag.
   The deterministic regression injects that echo during a drag; only an actual
   preference change now cancels interaction or reapplies fit mode.

## Automated verification

- Focused toolbar browser tests: **4 passed**
  - top/left layout and non-overlap;
  - narrow-viewport menu containment;
  - grip-only top/left/invalid/Escape behavior plus same-value host echo;
  - hide, `Shift+T`, editable-control guard, and state preservation.
- Affected PDF browser suites: **65 passed, 0 failed**
  - `pdf-viewer.spec.ts`
  - `pdf-navigation-preview.spec.ts`
  - `pdf-selection-preview-parity.spec.ts`
- Repository tests: **599 passed, 0 failed**
  - core: **36/36**
  - VS Code extension: **563/563**
- Fresh `pnpm build`: exit 0.
- Fresh `pnpm lint`: exit 0, zero warnings.
- Fresh `pnpm typecheck`: exit 0.
- `git diff --check`: exit 0.

Playwright emitted the repository's existing Node `DEP0205` warning and the
existing `NO_COLOR`/`FORCE_COLOR` warning; neither affected results.

## Live Extension Development Host acceptance

A fresh debug host was launched from the worktree after the production build.
The **Move PDF toolbar** control and the inferred outline label proved that the
new webview bundle was loaded rather than the older already-running host.

Verified live:

1. The bookmark-less Sennrich paper showed **Inferred outline** with six
   conservative section entries.
2. Menu movement top → left shifted the PDF into a separate grid column and did
   not cover the Explorer or PDF content.
3. **Hide toolbar** removed the toolbar and returned the PDF to the freed space.
4. `Shift+T` restored the toolbar at the last left dock.
5. The Command Palette restored a hidden toolbar while focus was outside the PDF
   webview.
6. A second PDF opened in the LLM Wiki viewer inherited the left dock.
7. Reloading the Extension Development Host preserved the left dock.
8. Menu movement left → top restored the horizontal row.
9. Page navigation reached page 2, and live search returned
   `1 of 6 · Searching…` for `dataset` after the layout changes.
10. The authored DataComp outline remained nested while the inferred Sennrich
    outline remained labelled as inferred.

The desktop automation service could not perform a coordinate drag in this
external-window geometry (`windowNotFoundAtPosition`). The real pointer path is
therefore evidenced by the browser tests, which exercise top→left, left→top,
middle release, `Escape`, non-grip controls, active drop targets, and the
preference-echo race.

Live actions were limited to editor/viewer interaction. No demo-vault file was
written or staged by this verification.

## Commits

- `e8c659d4` — define toolbar docking preferences
- `f80f93ed` — persist toolbar visibility and dock
- `022bc58b` — dock and hide the navigation toolbar
- `2f72d749` — preserve toolbar drags across preference echoes
