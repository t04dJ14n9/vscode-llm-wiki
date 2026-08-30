import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testRoot = dirname(fileURLToPath(import.meta.url));

test('combined and fixture PDF viewports suppress the programmatic focus frame', () => {
  for (const [relativePath, pattern] of [
    [
      '../../pdf-editor/src/embedpdf-spike/embedpdf-viewer-spike.tsx',
      /\.embedpdf-headless-viewport\s*\{[^}]*\boutline:\s*none;/s,
    ],
    ['./e2e/pdf-viewer.html', /#viewer-container\s*\{[^}]*\boutline:\s*none;/s],
  ]) {
    const source = readFileSync(resolve(testRoot, relativePath), 'utf8');
    assert.match(
      source,
      pattern,
      `${relativePath} must suppress the focused viewport outline`,
    );
  }
});
