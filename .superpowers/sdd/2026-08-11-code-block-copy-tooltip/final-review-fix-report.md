# Copy Tooltip Final Review Fix

## Findings addressed

1. The `role="status"` tooltip is now a sibling of the copy button inside
   the relative-positioned header. The button contains only its SVG, retains
   its `Copy code` accessible name and title, and the status remains locally
   positioned above the button with `right: 8px`.
2. The empty live region is visually hidden with opacity and non-interactive
   pointer handling only. It no longer uses `visibility:hidden`, so it stays
   in the accessibility tree after its text is cleared.
3. The header has matching `4px` top-left and top-right radii, preventing its
   background from painting square corners through the rounded code-block
   container.

## Regression coverage

The real-widget Playwright test verifies that the status is a direct header
child rather than a button descendant, the button's accessible name remains
`Copy code`, the empty status stays attached and role-addressable, and both
computed header top radii are `4px`. It continues to cover the existing copy
payload, theme, geometry, timer restart, and host-fallback behavior.

## TDD and verification evidence

- RED: `pnpm exec playwright test test/e2e/markdown-editor.spec.ts -g "code block copy keeps feedback outside"` failed before the production edit at the new header-child assertion: `Expected: true`, `Received: false`.
- GREEN: after rebuilding the webview fixture, `pnpm exec playwright test test/e2e/markdown-editor.spec.ts -g "code block copy"` passed 2/2.
- Build: root `pnpm build` completed successfully.
- Package validation: `pnpm test` in `packages/vscode-extension` completed successfully.
- Whitespace validation: `git diff --check` completed successfully.
