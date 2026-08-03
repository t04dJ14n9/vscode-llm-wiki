import { Command } from 'commander';
import {
  detectVaultRoot, isVaultRoot, readConfig,
  openDatabase, runMigrations, closeDatabase, SCHEMA_VERSION,
} from '@human-learning/core';
import { existsSync } from 'fs';
import { join } from 'path';

export function doctorCommand(): Command {
  return new Command('doctor')
    .description('Validate vault setup and report issues')
    .argument('[path]', 'Path to vault', '.')
    .action(async (targetPath: string) => {
      const vaultRoot = detectVaultRoot(targetPath) ?? (isVaultRoot(targetPath) ? targetPath : null);

      if (!vaultRoot) {
        console.log(JSON.stringify({
          status: 'error',
          message: 'Not a Human Learning vault. Run `hl init` to create one.',
        }));
        process.exit(1);
      }

      const checks: Array<{ check: string; status: string; message?: string }> = [];

      // Check vault layout
      const requiredDirs = ['raw', 'notes', '.hl'];
      for (const dir of requiredDirs) {
        const exists = existsSync(join(vaultRoot, dir));
        checks.push({
          check: `directory:${dir}`,
          status: exists ? 'pass' : 'fail',
          message: exists ? undefined : `Missing directory: ${dir}/`,
        });
      }

      // Check config
      try {
        const config = readConfig(vaultRoot);
        checks.push({
          check: 'config',
          status: 'pass',
          message: `version=${config.version}`,
        });
      } catch (e: any) {
        checks.push({
          check: 'config',
          status: 'fail',
          message: `Config error: ${e.message}`,
        });
      }

      // Check database
      try {
        const db = await openDatabase(vaultRoot);
        runMigrations(db);
        const currentVersion = (db.prepare(
          "SELECT MAX(version) as v FROM schema_version"
        ).get() as { v: number | null })?.v ?? 0;

        if (currentVersion < SCHEMA_VERSION) {
          checks.push({
            check: 'database',
            status: 'warn',
            message: `Schema version ${currentVersion} < ${SCHEMA_VERSION}. Run migrations.`,
          });
        } else {
          checks.push({
            check: 'database',
            status: 'pass',
            message: `Schema version ${currentVersion}`,
          });
        }

        // Check WAL mode
        const journalMode = db.pragma('journal_mode', { simple: true });
        if (journalMode !== 'wal') {
          checks.push({
            check: 'database:journal_mode',
            status: 'warn',
            message: `journal_mode=${journalMode}, expected wal`,
          });
        }

        closeDatabase(db);
      } catch (e: any) {
        checks.push({
          check: 'database',
          status: 'fail',
          message: `Database error: ${e.message}`,
        });
      }

      // Check AGENTS.md / CLAUDE.md
      for (const f of ['AGENTS.md', 'CLAUDE.md']) {
        const exists = existsSync(join(vaultRoot, f));
        checks.push({
          check: `file:${f}`,
          status: exists ? 'pass' : 'warn',
          message: exists ? 'exists' : `Missing ${f} (run agent setup)`,
        });
      }

      const failures = checks.filter(c => c.status === 'fail').length;

      console.log(JSON.stringify({
        vault: vaultRoot,
        status: failures === 0 ? 'healthy' : 'issues_found',
        checks,
      }, null, 2));

      if (failures > 0) {
        process.exit(1);
      }
    });
}
