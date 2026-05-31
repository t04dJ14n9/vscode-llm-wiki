import { Command } from 'commander';
import { detectVaultRoot, generateAgentInstructions } from '@human-learning/core';

export function skillsCommand(): Command {
  const cmd = new Command('skills')
    .description('Install agent skills into the vault');

  cmd.command('install')
    .description('Install agent skill files (AGENTS.md, CLAUDE.md, Codex SKILL.md, Claude commands)')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) {
        console.log(JSON.stringify({ status: 'error', message: 'Not in a Human Learning vault' }));
        process.exit(1);
      }

      const created = generateAgentInstructions(vaultRoot);

      console.log(JSON.stringify({
        status: 'ok',
        created,
      }, null, options.json ? 0 : 2));
    });

  return cmd;
}
