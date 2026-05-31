import { Command } from 'commander';
import {
  detectVaultRoot, openDatabase, closeDatabase,
  searchLexical, searchNotes, searchSemantic, searchHybrid, runMigrations,
} from '@human-learning/core';

export function searchCommand(): Command {
  return new Command('search')
    .description('Search the vault')
    .argument('<query>', 'Search query')
    .option('--mode <mode>', 'Search mode: lexical, semantic, hybrid', 'lexical')
    .option('--kind <kind>', 'Filter: notes, pdf, code, all', 'all')
    .option('--limit <n>', 'Max results', '10')
    .option('--json', 'Output JSON')
    .action(async (query: string, options: { mode: string; kind: string; limit: string; json?: boolean }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) {
        console.log(JSON.stringify({ status: 'error', message: 'Not in a Human Learning vault' }));
        process.exit(1);
      }

      const db = await openDatabase(vaultRoot);
      runMigrations(db);
      const limit = parseInt(options.limit, 10);

      let results;
      if (options.kind === 'notes') {
        results = searchNotes(db, query, limit);
      } else if (options.mode === 'semantic') {
        results = searchSemantic(db, query, limit);
      } else if (options.mode === 'hybrid') {
        results = searchHybrid(db, query, limit);
      } else {
        results = searchLexical(db, query, limit);
      }

      closeDatabase(db);

      if (options.json) {
        console.log(JSON.stringify({ query, count: results.length, results }, null, 2));
      } else {
        for (const r of results) {
          console.log(`[${r.source_kind}] ${r.title}`);
          console.log(`  rank=${r.rank.toFixed(2)} "${r.snippet}..."`);
          console.log(`  → ${r.anchor_uri}`);
          console.log();
        }
      }
    });
}
