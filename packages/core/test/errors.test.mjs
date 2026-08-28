import assert from 'node:assert/strict';
import test from 'node:test';

import { formatUnknownError, structuredErrorCode } from '../dist/index.js';

test('formatUnknownError preserves structured PDF task details', () => {
  const error = { code: 26, message: 'Cannot select PDF text' };
  assert.equal(formatUnknownError(error), 'Cannot select PDF text (code 26)');
  assert.equal(structuredErrorCode(error), 26);

  const taskError = { type: 'reject', reason: error };
  assert.equal(formatUnknownError(taskError), 'Cannot select PDF text (code 26)');
  assert.equal(structuredErrorCode(taskError), 26);
});

test('formatUnknownError never collapses an object to [object Object]', () => {
  assert.equal(formatUnknownError({ reason: { message: 'PDF worker stopped' } }), 'PDF worker stopped');
  assert.equal(formatUnknownError([{ message: 'First failure' }, { message: 'Second failure' }]), 'First failure; Second failure');
  assert.equal(formatUnknownError({ unexpected: true }), '{"unexpected":true}');
  assert.equal(formatUnknownError(null, 'PDF operation failed'), 'PDF operation failed');

  const circular = {};
  circular.reason = circular;
  assert.equal(formatUnknownError(circular, 'Circular PDF error'), 'Circular PDF error');
});
