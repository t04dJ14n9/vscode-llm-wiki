import { readFileSync, unlinkSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { listProcesses, selectStaleE2eProcesses, stopProcesses } from './processCleanup.mjs';
import { resolveVsCodeE2eTestDir } from './testDirectory.mjs';
import { cleanupSandboxFixtures } from './sandboxFixtures.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, 'fixtures', 'test-vault');

const testDir = resolveVsCodeE2eTestDir();
const pidFile = resolve(testDir, 'pid');
const userDataDir = resolve(testDir, 'user-data');

export default async function globalTeardown() {
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, 'utf-8').trim());
    const processInfo = listProcesses().find(process => process.pid === pid);
    if (processInfo?.command.includes(userDataDir)) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`[global-teardown] Killed VS Code (pid ${pid})`);
      } catch {
        // Process already gone
      }
    }
    unlinkSync(pidFile);
  }
  await killRemainingTestProcesses();
  cleanupSandboxFixtures(fixtures);
}

async function killRemainingTestProcesses() {
  const processes = selectStaleE2eProcesses(listProcesses(), { userDataDir });
  await stopProcesses(processes, { label: 'remaining VS Code test process' });
}
