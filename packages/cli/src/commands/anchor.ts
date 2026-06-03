import { Command } from 'commander';
import {
  detectVaultRoot,
  openDatabase,
  closeDatabase,
  runMigrations,
  createPdfAnchorFromQuote,
  resolveAnchor,
  recordActivity,
} from '@human-learning/core';

export function anchorCommand(): Command {
  const cmd = new Command('anchor')
    .description('Create and inspect source anchors');

  cmd.command('create-pdf')
    .description('Create a PDF anchor from a validated quote')
    .argument('<path>', 'PDF path relative to vault')
    .requiredOption('--quote <text>', 'Exact quote to anchor')
    .option('--page <page>', '1-based page number')
    .option('--json', 'Output JSON')
    .action(async (
      sourcePath: string,
      options: { quote: string; page?: string; json?: boolean },
    ) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) {
        console.log(JSON.stringify({ status: 'error', message: 'Not in a Human Learning vault' }));
        process.exit(1);
      }

      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const anchor = createPdfAnchorFromQuote(db, vaultRoot, sourcePath, {
        quote: options.quote,
        page: options.page ? Number(options.page) : undefined,
        createdBy: 'user',
      });
      if (anchor.status === 'resolved') {
        recordActivity(db, {
          event_type: 'create_anchor',
          anchor_id: anchor.id,
          metadata: { source: sourcePath },
        });
      }
      closeDatabase(db);

      console.log(JSON.stringify({
        status: anchor.status === 'resolved' ? 'ok' : 'not_found',
        anchor,
      }, null, options.json ? 0 : 2));

      if (anchor.status !== 'resolved') process.exit(2);
    });

  cmd.command('resolve')
    .description('Resolve an anchor by id or URI')
    .argument('<id-or-uri>', 'Anchor id or native PDF anchor URI')
    .option('--json', 'Output JSON')
    .action(async (idOrUri: string, options: { json?: boolean }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) {
        console.log(JSON.stringify({ status: 'error', message: 'Not in a Human Learning vault' }));
        process.exit(1);
      }

      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const anchor = resolveAnchor(db, idOrUri);
      closeDatabase(db);

      console.log(JSON.stringify({
        status: anchor ? 'ok' : 'not_found',
        anchor,
      }, null, options.json ? 0 : 2));

      if (!anchor) process.exit(2);
    });

  return cmd;
}
