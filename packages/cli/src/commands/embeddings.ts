import { Command } from 'commander';
import {
  detectVaultRoot,
  openDatabase,
  closeDatabase,
  runMigrations,
  refreshEmbeddings,
  getEmbeddingStatus,
  readConfig,
} from '@human-learning/core';

export function embeddingsCommand(): Command {
  const cmd = new Command('embeddings')
    .description('Manage local chunk embeddings');

  cmd.command('refresh')
    .description('Refresh deterministic local embeddings')
    .option('--changed', 'Only refresh missing or stale embeddings')
    .option('--json', 'Output JSON')
    .action(async (options: { changed?: boolean; json?: boolean }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) {
        console.log(JSON.stringify({ status: 'error', message: 'Not in a Human Learning vault' }));
        process.exit(1);
      }

      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const config = readConfig(vaultRoot);
      const result = await refreshEmbeddings(db, { changedOnly: options.changed, config });
      closeDatabase(db);

      console.log(JSON.stringify({
        status: 'ok',
        ...result,
      }, null, options.json ? 0 : 2));
    });

  cmd.command('status')
    .description('Show embedding coverage')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) {
        console.log(JSON.stringify({ status: 'error', message: 'Not in a Human Learning vault' }));
        process.exit(1);
      }

      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const status = getEmbeddingStatus(db);
      closeDatabase(db);

      console.log(JSON.stringify({
        status: 'ok',
        embeddings: status,
      }, null, options.json ? 0 : 2));
    });

  return cmd;
}
