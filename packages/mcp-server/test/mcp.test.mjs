import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mcpBin = join(packageRoot, 'dist', 'main.js');
const cliRoot = resolve(packageRoot, '..', 'cli');
const cli = join(cliRoot, 'dist', 'main.js');

function makeVault() {
  const root = mkdtempSync(join(tmpdir(), 'hl-mcp-'));
  execFileSync(process.execPath, [cli, 'init', '.', '--name', 'MCP Test'], { cwd: root });
  mkdirSync(join(root, 'notes', 'Concepts'), { recursive: true });
  writeFileSync(
    join(root, 'notes', 'Concepts', 'Attention.md'),
    '# Attention\n\nAttention mechanism in transformers.\n',
  );
  writeFileSync(
    join(root, 'notes', 'Concepts', 'Memory.md'),
    '# Memory\n\nMemory bandwidth is the bottleneck.\n',
  );
  execFileSync(process.execPath, [cli, 'ingest', 'notes', '--recursive', '--json'], { cwd: root });
  return root;
}

function sendRequest(child, request) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf('\n');
      if (newline !== -1) {
        child.stdout.off('data', onData);
        try {
          resolve(JSON.parse(buffer.slice(0, newline)));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${buffer.slice(0, newline)}`));
        }
      }
    };
    child.stdout.on('data', onData);
    child.stdin.write(JSON.stringify(request) + '\n');
  });
}

function spawnMcp(root) {
  return spawn(process.execPath, [mcpBin], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

test('initialize returns server capabilities', async () => {
  const root = makeVault();
  const child = spawnMcp(root);
  try {
    const resp = await sendRequest(child, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    assert.equal(resp.jsonrpc, '2.0');
    assert.equal(resp.id, 1);
    assert.ok(resp.result.serverInfo.name);
    assert.ok(resp.result.capabilities.tools !== undefined);
  } finally {
    child.kill();
  }
});

test('tools/list returns 7 tools', async () => {
  const root = makeVault();
  const child = spawnMcp(root);
  try {
    const resp = await sendRequest(child, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    assert.equal(resp.result.tools.length, 7);
    const names = resp.result.tools.map(t => t.name);
    assert.ok(names.includes('search'));
    assert.ok(names.includes('get_backlinks'));
    assert.ok(names.includes('get_forward_links'));
    assert.ok(names.includes('resolve_anchor'));
    assert.ok(names.includes('export_context'));
    assert.ok(names.includes('list_sources'));
    assert.ok(names.includes('get_chunk'));
  } finally {
    child.kill();
  }
});

test('search tool returns results for ingested vault', async () => {
  const root = makeVault();
  const child = spawnMcp(root);
  try {
    const resp = await sendRequest(child, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'search', arguments: { query: 'attention', mode: 'lexical' } },
    });
    assert.ok(!resp.error, `Unexpected error: ${JSON.stringify(resp.error)}`);
    const content = JSON.parse(resp.result.content[0].text);
    assert.ok(content.results.length >= 1);
  } finally {
    child.kill();
  }
});

test('list_sources returns ingested sources', async () => {
  const root = makeVault();
  const child = spawnMcp(root);
  try {
    const resp = await sendRequest(child, {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'list_sources', arguments: {} },
    });
    assert.ok(!resp.error);
    const content = JSON.parse(resp.result.content[0].text);
    assert.ok(content.sources.length >= 2);
  } finally {
    child.kill();
  }
});

test('unknown method returns -32601 error', async () => {
  const root = makeVault();
  const child = spawnMcp(root);
  try {
    const resp = await sendRequest(child, { jsonrpc: '2.0', id: 5, method: 'nonexistent', params: {} });
    assert.equal(resp.error.code, -32601);
  } finally {
    child.kill();
  }
});

test('tools/call with missing name returns -32602 error', async () => {
  const root = makeVault();
  const child = spawnMcp(root);
  try {
    const resp = await sendRequest(child, {
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { arguments: {} },
    });
    assert.equal(resp.error.code, -32602);
  } finally {
    child.kill();
  }
});
