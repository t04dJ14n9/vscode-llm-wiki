import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { mkdirSync, existsSync } from 'fs';
import { findFreePort } from './debugPort.mjs';
import { resolveVsCodeE2eTestDir } from './testDirectory.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const VSCODE_VERSION = 'stable';
const FIXTURES = resolve(__dirname, 'fixtures', 'test-vault');
const EXTENSION_PATH = resolve(__dirname, '..', '..');
const TEST_DIR = resolveVsCodeE2eTestDir();

async function main() {
  console.log('[vscode-runner] Downloading VS Code...');
  const downloadedPath = await downloadAndUnzipVSCode(VSCODE_VERSION);
  const vscodePath = resolveVsCodeExecutable(downloadedPath);
  console.log(`[vscode-runner] VS Code at: ${vscodePath}`);

  // Ensure user-data-dir exists
  const userDataDir = resolve(TEST_DIR, 'user-data');
  mkdirSync(userDataDir, { recursive: true });

  // Ensure extensions-dir exists
  const extensionsDir = resolve(TEST_DIR, 'extensions');
  mkdirSync(extensionsDir, { recursive: true });

  const debugPort = await findFreePort();

  const args = [
    FIXTURES,
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-telemetry',
    '--disable-updates',
    '--disable-workspace-trust',
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    `--extensionDevelopmentPath=${EXTENSION_PATH}`,
    `--remote-debugging-port=${debugPort}`,
  ];

  console.log('[vscode-runner] Launching VS Code...');
  console.log(`[vscode-runner] Extension path: ${EXTENSION_PATH}`);
  console.log(`[vscode-runner] Workspace: ${FIXTURES}`);
  console.log(`[vscode-runner] Debug port: ${debugPort}`);

  const proc = spawn(vscodePath, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_NO_ATTACH_CONSOLE: '1',
    },
  });

  proc.on('error', (err) => {
    console.error('[vscode-runner] Failed to start:', err);
    process.exit(1);
  });

  // Wait a bit for VS Code to start, then print readiness
  await new Promise((r) => setTimeout(r, 3000));
  console.log(`[vscode-runner] VS Code launched. CDP at http://127.0.0.1:${debugPort}`);
  console.log('[vscode-runner] Press Ctrl+C to stop.');

  // Keep running until killed
  process.on('SIGINT', () => {
    console.log('[vscode-runner] Shutting down...');
    proc.kill('SIGTERM');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    proc.kill('SIGTERM');
    process.exit(0);
  });

  // Wait for process to exit
  const code = await new Promise((resolve) => {
    proc.on('close', (code) => resolve(code ?? 0));
  });

  console.log(`[vscode-runner] VS Code exited with code ${code}`);
  process.exit(code);
}

function resolveVsCodeExecutable(downloadedPath) {
  if (existsSync(downloadedPath)) return downloadedPath;
  const macCodePath = resolve(dirname(downloadedPath), 'Code');
  if (existsSync(macCodePath)) return macCodePath;
  throw new Error(`VS Code executable does not exist: ${downloadedPath}`);
}

main().catch((err) => {
  console.error('[vscode-runner] Fatal error:', err);
  process.exit(1);
});
