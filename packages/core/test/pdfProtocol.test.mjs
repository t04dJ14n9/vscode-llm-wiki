import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfWebviewToHostMessage } from '../dist/index.js';

test('PDF webview protocol accepts known messages and rejects unknown shapes', () => {
  const ready = { type: 'ready' };
  assert.equal(pdfWebviewToHostMessage(ready), ready);
  assert.equal(pdfWebviewToHostMessage({ type: 'removedAction' }), undefined);
  assert.equal(pdfWebviewToHostMessage(null), undefined);
});
