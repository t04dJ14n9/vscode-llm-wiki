import { spawnSync } from 'child_process';

export function listProcesses() {
  const result = spawnSync('ps', ['-ax', '-o', 'pid=', '-o', 'command='], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .map(line => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      return match ? { pid: Number(match[1]), command: match[2] } : null;
    })
    .filter(Boolean);
}

export function selectStaleE2eProcesses(processes, { userDataDir, currentPid = process.pid }) {
  return processes.filter(({ pid, command }) => (
    pid !== currentPid
    && typeof command === 'string'
    && command.includes(userDataDir)
  ));
}

export async function stopProcesses(processes, { label = 'VS Code test process', graceMs = 1000 } = {}) {
  if (processes.length === 0) return;

  console.log(`[process-cleanup] Stopping ${processes.length} stale ${label}(es)...`);
  for (const { pid } of processes) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }

  await new Promise(resolve => setTimeout(resolve, graceMs));

  for (const { pid } of processes) {
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}
