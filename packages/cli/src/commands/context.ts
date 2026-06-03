import { Command } from 'commander';
import {
  detectVaultRoot,
  openDatabase,
  closeDatabase,
  runMigrations,
  exportSourceContext,
  recordActivity,
} from '@human-learning/core';

export function contextCommand(): Command {
  const cmd = new Command('context')
    .description('Export agent-readable context');

  cmd.command('export')
    .description('Export source or anchor context into .hl/agent/context.*')
    .option('--source <path>', 'Source path relative to vault')
    .option('--anchor <id>', 'Anchor id')
    .option('--json', 'Output JSON')
    .action(async (options: { source?: string; anchor?: string; json?: boolean }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) {
        console.log(JSON.stringify({ status: 'error', message: 'Not in a Human Learning vault' }));
        process.exit(1);
      }
      if (!options.source && !options.anchor) {
        console.log(JSON.stringify({
          status: 'error',
          message: 'Provide --source <path> or --anchor <id>',
        }));
        process.exit(1);
      }

      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const context = exportSourceContext(db, vaultRoot, {
        sourcePath: options.source,
        anchorId: options.anchor,
      });
      recordActivity(db, {
        event_type: 'export_context',
        metadata: { source: options.source, anchor: options.anchor },
      });
      closeDatabase(db);

      console.log(JSON.stringify({
        status: 'ok',
        context,
      }, null, options.json ? 0 : 2));
    });

  return cmd;
}
