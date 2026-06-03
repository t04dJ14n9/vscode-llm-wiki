#!/usr/bin/env node
import { detectVaultRoot } from '@human-learning/core';
import { startMcpServer } from './server';

const vaultRoot = detectVaultRoot(process.cwd());
if (!vaultRoot) {
  process.stderr.write('Human Learning: No vault found. Run `hl init` to create one.\n');
  process.exit(1);
}

startMcpServer({ vaultRoot }).catch((err) => {
  process.stderr.write(`MCP server error: ${err.message}\n`);
  process.exit(1);
});
