import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

const SANDBOX_ROOT = '__hl_vscode_e2e_sandboxes__';

export const VIM_SANDBOXES = Object.freeze({
  modifierShortcuts: sandbox('vim-modifier-shortcuts.md', 'HL E2E Vim modifier shortcuts'),
  commandO: sandbox('vim-command-o.md', 'HL E2E Vim command O'),
  delayedFocus: sandbox('vim-delayed-focus.md', 'HL E2E Vim delayed focus'),
  deleteLine: sandbox('vim-delete-line.md', 'HL E2E Vim delete line'),
  deleteHeading: sandbox('vim-delete-heading.md', 'HL E2E Vim delete heading'),
  headingCommands: sandbox('vim-heading-commands.md', 'HL E2E Vim heading commands'),
});

export function prepareSandboxFixtures(vaultRoot) {
  for (const fixture of Object.values(VIM_SANDBOXES)) {
    const file = resolve(vaultRoot, fixture.relativePath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${fixture.marker}\n`, 'utf8');
  }
}

export function cleanupSandboxFixtures(vaultRoot) {
  rmSync(resolve(vaultRoot, SANDBOX_ROOT), { recursive: true, force: true });
}

function sandbox(fileName, marker) {
  return Object.freeze({
    relativePath: `${SANDBOX_ROOT}/${fileName}`,
    marker,
  });
}
