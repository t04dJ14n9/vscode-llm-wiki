import { Command } from 'commander';
import {
  detectVaultRoot, openDatabase, closeDatabase,
  rebuildAllLinks, checkLinks, safeRepairLinks,
  getBacklinks, getForwardLinks, runMigrations,
} from '@human-learning/core';

export function linksCommand(): Command {
  const cmd = new Command('links')
    .description('Manage the link graph');

  cmd.command('rebuild')
    .description('Rebuild all parser-generated links from markdown')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) { console.log(JSON.stringify({ status: 'error', message: 'Not in a vault' })); process.exit(1); }

      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const result = rebuildAllLinks(db, vaultRoot);
      closeDatabase(db);

      console.log(JSON.stringify({
        status: 'ok',
        notes_processed: result.notes,
        deleted: result.total_deleted,
        inserted: result.total_inserted,
      }, null, options.json ? 0 : 2));
    });

  cmd.command('check')
    .description('Check links for broken/unresolved targets')
    .option('--fix', 'Attempt safe auto-repair')
    .option('--dry-run', 'Preview repairs without applying')
    .option('--json', 'Output JSON')
    .action(async (options: { fix?: boolean; dryRun?: boolean; json?: boolean }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) { console.log(JSON.stringify({ status: 'error', message: 'Not in a vault' })); process.exit(1); }

      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const issues = checkLinks(db);

      let repairResult = { fixed: 0, ambiguous: 0 };
      if (options.fix && !options.dryRun) {
        repairResult = safeRepairLinks(db);
      }

      closeDatabase(db);

      console.log(JSON.stringify({
        status: issues.length === 0 ? 'clean' : 'issues_found',
        broken_links: issues.length,
        issues,
        repair: options.fix ? repairResult : undefined,
      }, null, options.json ? 0 : 2));
    });

  cmd.command('backlinks')
    .description('Show backlinks to a native note/PDF/code/web target')
    .argument('<uri>', 'Target URI, for example notes/Foo.md or raw/pdf/paper.pdf#page=7')
    .option('--json', 'Output JSON')
    .action(async (uri: string, options: { json?: boolean }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) { console.log(JSON.stringify({ status: 'error', message: 'Not in a vault' })); process.exit(1); }

      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const backlinks = getBacklinks(db, uri);
      closeDatabase(db);

      console.log(JSON.stringify({
        uri,
        count: backlinks.length,
        backlinks: backlinks.map(b => ({
          from: b.from_note_path,
          line: b.from_line,
          label: b.label,
        })),
      }, null, options.json ? 0 : 2));
    });

  cmd.command('forward')
    .description('Show forward links from a note')
    .argument('<path>', 'Note path relative to vault')
    .option('--json', 'Output JSON')
    .action(async (path: string, options: { json?: boolean }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) { console.log(JSON.stringify({ status: 'error', message: 'Not in a vault' })); process.exit(1); }

      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const forward = getForwardLinks(db, path);
      closeDatabase(db);

      console.log(JSON.stringify({
        path,
        count: forward.length,
        forward_links: forward.map(f => ({
          to: f.to_uri,
          line: f.from_line,
          label: f.label,
        })),
      }, null, options.json ? 0 : 2));
    });

  return cmd;
}
