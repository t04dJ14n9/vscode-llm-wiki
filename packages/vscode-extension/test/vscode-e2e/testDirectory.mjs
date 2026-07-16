import { createHash } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOCAL_TEST_DIR = resolve(__dirname, '.vscode-test');

export function resolveVsCodeE2eTestDir({
  override = process.env.HL_VSCODE_E2E_TEST_DIR,
  platform = process.platform,
  localTestDir = DEFAULT_LOCAL_TEST_DIR,
  temporaryRoot = '/tmp',
} = {}) {
  if (override) {
    return resolve(override);
  }
  if (platform !== 'darwin') {
    return resolve(localTestDir);
  }

  const workspaceKey = createHash('sha256')
    .update(resolve(localTestDir))
    .digest('hex')
    .slice(0, 12);
  return resolve(temporaryRoot, `hl-vscode-e2e-${workspaceKey}`);
}
