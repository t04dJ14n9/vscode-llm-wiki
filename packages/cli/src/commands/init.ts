import { Command } from 'commander';
import { initVault, openDatabase, runMigrations, closeDatabase, generateAgentInstructions } from '@human-learning/core';
import { existsSync } from 'fs';
import { resolve } from 'path';

export function initCommand(): Command {
  return new Command('init')
    .description('Initialize a Human Learning vault')
    .argument('[path]', 'Path to create vault in', '.')
    .option('--name <name>', 'Vault name')
    .option('--json', 'Output JSON')
    .action(async (targetPath: string, options: { name?: string; json?: boolean }) => {
      const vaultPath = resolve(targetPath);

      if (existsSync(vaultPath) && existsSync(vaultPath + '/.hl')) {
        console.log(JSON.stringify({
          status: 'ok',
          path: vaultPath,
          created: [],
          already_initialized: true,
        }, null, 2));
        return;
      }

      const result = initVault(vaultPath, options.name);

      // Initialize database
      const db = await openDatabase(vaultPath);
      const migrationResult = runMigrations(db);
      closeDatabase(db);

      // Generate agent instruction files
      const agentFiles = generateAgentInstructions(vaultPath);

      const json = {
        status: 'ok',
        path: result.path,
        created: result.created,
        schema_version: migrationResult.version,
        migrations_applied: migrationResult.applied,
        agent_files: agentFiles,
      };

      console.log(JSON.stringify(json, null, 2));
    });
}
