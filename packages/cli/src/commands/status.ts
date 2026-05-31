import { Command } from 'commander';
import { detectVaultRoot, isVaultRoot, readConfig, openDatabase, closeDatabase, runMigrations } from '@human-learning/core';

export function statusCommand(): Command {
  return new Command('status')
    .description('Show vault status')
    .argument('[path]', 'Path to vault', '.')
    .action(async (targetPath: string) => {
      const vaultRoot = detectVaultRoot(targetPath) ?? (isVaultRoot(targetPath) ? targetPath : null);

      if (!vaultRoot) {
        console.log(JSON.stringify({ status: 'no_vault', path: targetPath }));
        return;
      }

      const config = readConfig(vaultRoot);
      const db = await openDatabase(vaultRoot);
      runMigrations(db);

      const sourceCount = db.prepare('SELECT COUNT(*) as c FROM sources').get() as { c: number };
      const noteCount = db.prepare("SELECT COUNT(*) as c FROM sources WHERE kind = 'markdown'").get() as { c: number };
      const linkCount = db.prepare('SELECT COUNT(*) as c FROM links').get() as { c: number };
      const anchorCount = db.prepare('SELECT COUNT(*) as c FROM anchors').get() as { c: number };
      const chunkCount = db.prepare('SELECT COUNT(*) as c FROM chunks WHERE active = 1').get() as { c: number };
      const brokenLinks = db.prepare("SELECT COUNT(*) as c FROM links WHERE status != 'resolved'").get() as { c: number };

      closeDatabase(db);

      console.log(JSON.stringify({
        path: vaultRoot,
        config: { version: config.version, name: config.name },
        counts: {
          sources: sourceCount.c,
          notes: noteCount.c,
          links: linkCount.c,
          anchors: anchorCount.c,
          chunks: chunkCount.c,
          broken_links: brokenLinks.c,
        },
      }, null, 2));
    });
}
