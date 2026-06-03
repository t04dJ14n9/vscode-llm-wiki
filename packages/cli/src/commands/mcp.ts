import { Command } from 'commander';
import { detectVaultRoot } from '@human-learning/core';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

export function mcpCommand(): Command {
  const cmd = new Command('mcp').description('Model Context Protocol server');

  cmd.command('stdio')
    .description('Start MCP server over stdio (JSON-RPC 2.0)')
    .action(() => {
      const vaultRoot = detectVaultRoot(process.cwd());
      if (!vaultRoot) {
        process.stderr.write('Not in a Human Learning vault\n');
        process.exit(1);
      }

      const mcpBin = join(
        __dirname, '..', '..', '..', 'mcp-server', 'dist', 'main.js',
      );

      const child = spawn(process.execPath, [mcpBin], {
        stdio: 'inherit',
        cwd: process.cwd(),
      });
      child.on('exit', (code) => process.exit(code ?? 0));
    });

  return cmd;
}
