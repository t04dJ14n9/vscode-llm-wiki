import { Command } from 'commander';
import { detectVaultRoot } from '@human-learning/core';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

export function hooksCommand(): Command {
  const cmd = new Command('hooks')
    .description('Install Claude Code hooks into the vault');

  cmd.command('install')
    .description('Install hook configuration for Claude Code')
    .option('--target <target>', 'claude (only supported target)', 'claude')
    .option('--json', 'Output JSON')
    .action(async (options: { target: string; json?: boolean }) => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) {
        console.log(JSON.stringify({ status: 'error', message: 'Not in a Human Learning vault' }));
        process.exit(1);
      }

      if (options.target !== 'claude') {
        console.log(JSON.stringify({
          status: 'error',
          message: `Only --target claude is supported. Got: ${options.target}`,
        }));
        process.exit(1);
      }

      const settingsDir = join(vaultRoot, '.claude');
      if (!existsSync(settingsDir)) mkdirSync(settingsDir, { recursive: true });

      const settingsPath = join(settingsDir, 'settings.local.json');
      let settings: any = {};
      if (existsSync(settingsPath)) {
        try {
          settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        } catch {
          settings = {};
        }
      }

      // Merge hooks while preserving existing settings
      settings.hooks = settings.hooks || {};
      settings.hooks.PostToolUse = settings.hooks.PostToolUse || [];
      settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];

      const linkCheckHook = {
        matcher: 'Write|Edit',
        hooks: [{
          type: 'command',
          command: 'hl links check --fix --json',
        }],
      };

      const hasHook = settings.hooks.PostToolUse?.some(
        (h: any) => h.matcher === 'Write|Edit'
      );
      if (!hasHook) {
        settings.hooks.PostToolUse.push(linkCheckHook);
      }

      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.log(JSON.stringify({
        status: 'ok',
        file: '.claude/settings.local.json',
        hooks_added: hasHook ? 0 : 1,
      }, null, options.json ? 0 : 2));
    });

  return cmd;
}
