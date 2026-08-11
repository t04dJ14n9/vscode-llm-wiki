import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testRoot = dirname(fileURLToPath(import.meta.url));

test('combined and fixture PDF viewports suppress the programmatic focus frame', () => {
  for (const relativePath of [
    '../src/pdfEditorProvider.ts',
    './e2e/pdf-viewer.html',
  ]) {
    const source = readFileSync(resolve(testRoot, relativePath), 'utf8');
    assert.match(
      source,
      /#viewer-container\s*\{[^}]*\boutline:\s*none;/s,
      `${relativePath} must suppress the focused viewport outline`,
    );
  }
});
