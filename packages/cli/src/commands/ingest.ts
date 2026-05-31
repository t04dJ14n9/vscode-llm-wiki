import { Command } from 'commander';
import {
  detectVaultRoot, openDatabase, closeDatabase,
  registerSource, ingestFile, runMigrations,
} from '@human-learning/core';
import { existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

export function ingestCommand(): Command {
  return new Command('ingest')
    .description('Ingest sources into the vault index')
    .argument('<path>', 'File or directory to ingest')
    .option('--recursive', 'Recurse into directories')
    .option('--json', 'Output JSON')
    .action(async (targetPath: string, options: { recursive?: boolean; json?: boolean }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) {
        console.log(JSON.stringify({ status: 'error', message: 'Not in a Human Learning vault' }));
        process.exit(1);
      }

      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const results: Array<{ path: string; source_id: string; chunks: number }> = [];

      async function ingestFileAt(absPath: string) {
        const relPath = absPath.replace(vaultRoot! + '/', '');
        const source = registerSource(db, vaultRoot!, relPath);
        const { chunkCount } = await ingestFile(db, vaultRoot!, relPath, source.id);
        results.push({ path: relPath, source_id: source.id, chunks: chunkCount });
      }

      async function walkDir(dir: string) {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) {
            if (options.recursive) await walkDir(full);
          } else if (/\.(md|pdf|html?|txt|json|yaml|yml|xml|css|js|ts|py|rs|go|java|cpp|c|h|cu)$/i.test(entry)) {
            await ingestFileAt(full);
          }
        }
      }

      const absPath = resolve(targetPath);
      if (statSync(absPath).isDirectory()) {
        await walkDir(absPath);
      } else if (existsSync(absPath)) {
        await ingestFileAt(absPath);
      } else {
        console.log(JSON.stringify({ status: 'error', message: `Path not found: ${targetPath}` }));
        process.exit(1);
      }

      closeDatabase(db);

      console.log(JSON.stringify({
        status: 'ok',
        ingested: results.length,
        total_chunks: results.reduce((sum, r) => sum + r.chunks, 0),
        files: results,
      }, null, options.json ? 0 : 2));
    });
}
