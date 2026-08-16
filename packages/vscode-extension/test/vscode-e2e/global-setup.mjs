import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { findFreePort } from './debugPort.mjs';
import { listProcesses, selectStaleE2eProcesses, stopProcesses } from './processCleanup.mjs';
import { resolveVsCodeE2eTestDir } from './testDirectory.mjs';
import { cleanupSandboxFixtures, prepareSandboxFixtures } from './sandboxFixtures.mjs';
import {
  isCustomVsCodeE2eWorkspace,
  resolveVsCodeE2eWorkspace,
} from './workspaceRoot.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const VSCODE_VERSION = 'stable';
const DEFAULT_FIXTURES = resolve(__dirname, 'fixtures', 'test-vault');
const WORKSPACE = resolveVsCodeE2eWorkspace({
  defaultWorkspace: DEFAULT_FIXTURES,
});
const EXTENSION_PATH = resolve(__dirname, '..', '..');
const TEST_DIR = resolveVsCodeE2eTestDir();

export default async function globalSetup() {
  console.log('\n[global-setup] Downloading VS Code...');
  const downloadedPath = await downloadAndUnzipVSCode(VSCODE_VERSION);
  const electronPath = resolveVsCodeExecutable(downloadedPath);
  const codeCli = resolveVsCodeCli(downloadedPath, electronPath);
  console.log(`[global-setup] Electron binary: ${electronPath}`);

  const userDataDir = resolve(TEST_DIR, 'user-data');
  const extensionsDir = resolve(TEST_DIR, 'extensions');
  await killExistingTestProcesses(userDataDir);
  const debugPort = await findFreePort();
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(extensionsDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });
  mkdirSync(extensionsDir, { recursive: true });
  const userSettingsDir = resolve(userDataDir, 'User');
  mkdirSync(userSettingsDir, { recursive: true });
  writeFileSync(resolve(userSettingsDir, 'settings.json'), JSON.stringify({
    'editor.fontSize': 16,
    'editor.lineHeight': 24,
  }));
  if (!isCustomVsCodeE2eWorkspace()) {
    cleanupSandboxFixtures(DEFAULT_FIXTURES);
    prepareSandboxFixtures(DEFAULT_FIXTURES);
  }

  // Use a file:// URI for the folder
  const folderUri = `file://${WORKSPACE}`;

  const args = [
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
    `--folder-uri=${folderUri}`,
  ];

  console.log('[global-setup] Launching VS Code...');
  console.log(`[global-setup] Executable: ${electronPath}`);
  console.log(`[global-setup] Extension path: ${EXTENSION_PATH}`);
  console.log(`[global-setup] Workspace: ${WORKSPACE}`);
  console.log(`[global-setup] User data: ${userDataDir}`);
  console.log(`[global-setup] Debug port: ${debugPort}`);

  const proc = spawn(electronPath, args, {
    stdio: 'pipe',
    env: {
      ...process.env,
      ELECTRON_NO_ATTACH_CONSOLE: '1',
    },
    detached: true,
  });

  proc.stdout?.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) console.log(`[vscode] ${msg}`);
  });
  proc.stderr?.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) console.log(`[vscode-err] ${msg}`);
  });
  proc.on('exit', (code, signal) => {
    console.log(`[global-setup] VS Code launcher exited: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  });

  writeFileSync(resolve(TEST_DIR, 'pid'), String(proc.pid));
  proc.unref();

  // Wait for VS Code CDP
  console.log('[global-setup] Waiting for VS Code CDP...');
  const deadline = Date.now() + 60_000;
  let wsUrl = null;

  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (resp.ok) {
        const data = await resp.json();
        wsUrl = data.webSocketDebuggerUrl;
        console.log(`[global-setup] VS Code ready! WS: ${wsUrl}`);
        break;
      }
    } catch {
      // Not ready yet
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!wsUrl) {
    try {
      proc.kill('SIGTERM');
    } catch {
      // The code CLI wrapper can exit before the Electron app.
    }
    await killExistingTestProcesses(userDataDir);
    throw new Error('VS Code failed to start within 60s');
  }

  writeFileSync(resolve(TEST_DIR, 'ws-url'), wsUrl);
  writeFileSync(resolve(TEST_DIR, 'debug-port'), String(debugPort));
  writeFileSync(resolve(TEST_DIR, 'code-cli'), codeCli);

  // Give the extension time to activate
  console.log('[global-setup] Waiting for extension activation...');
  await new Promise((r) => setTimeout(r, 5000));
}

function resolveVsCodeExecutable(downloadedPath) {
  if (existsSync(downloadedPath)) return downloadedPath;
  // VS Code 1.131 renamed the macOS bundle executable from Electron to Code
  // while @vscode/test-electron still reports the former path.
  const macCodePath = resolve(dirname(downloadedPath), 'Code');
  if (existsSync(macCodePath)) return macCodePath;
  throw new Error(`VS Code executable does not exist: ${downloadedPath}`);
}

function resolveVsCodeCli(downloadedPath, electronPath) {
  const appRoot = process.platform === 'darwin'
    ? resolve(electronPath, '..', '..')
    : resolve(downloadedPath, '..');
  const codeCli = process.platform === 'win32'
    ? resolve(appRoot, 'resources', 'app', 'bin', 'code.cmd')
    : resolve(appRoot, 'resources', 'app', 'bin', 'code');
  if (!existsSync(codeCli)) {
    throw new Error(`VS Code CLI does not exist: ${codeCli}`);
  }
  return codeCli;
}

async function killExistingTestProcesses(userDataDir) {
  const processes = selectStaleE2eProcesses(listProcesses(), { userDataDir });
  await stopProcesses(processes, { label: 'VS Code test process' });
}
