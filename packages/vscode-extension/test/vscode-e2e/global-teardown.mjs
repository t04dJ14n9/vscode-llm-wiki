import { readFileSync, unlinkSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { listProcesses, selectStaleE2eProcesses, stopProcesses } from './processCleanup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pidFile = resolve(__dirname, '.vscode-test', 'pid');
const userDataDir = resolve(__dirname, '.vscode-test', 'user-data');

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
}

async function killRemainingTestProcesses() {
  const processes = selectStaleE2eProcesses(listProcesses(), { userDataDir });
  await stopProcesses(processes, { label: 'remaining VS Code test process' });
}
