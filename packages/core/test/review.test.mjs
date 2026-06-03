import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import core from '../dist/index.js';

const {
  initVault,
  openDatabase,
  runMigrations,
  closeDatabase,
  createLearningObject,
  getLearningObject,
  listLearningObjects,
  suspendLearningObject,
  computeNextReview,
  getDueCards,
  recordReview,
  getReviewHistory,
} = core;

function makeVault() {
  const root = mkdtempSync(join(tmpdir(), 'hl-review-'));
  initVault(root, 'Review Test Vault');
  return root;
}

async function withDb(root, fn) {
  const db = await openDatabase(root);
  runMigrations(db);
  try {
    return await fn(db);
  } finally {
    closeDatabase(db);
  }
}

test('creates learning object and queries by status', async () => {
  const root = makeVault();
  await withDb(root, async (db) => {
    const card = createLearningObject(db, {
      kind: 'concept_card',
      title: 'Attention Mechanism',
      prompt: 'Explain how scaled dot-product attention works.',
      tags: ['transformers', 'attention'],
    });

    assert.match(card.id, /^lo_/);
    assert.equal(card.status, 'active');
    assert.equal(card.title, 'Attention Mechanism');

    const fetched = getLearningObject(db, card.id);
    assert.equal(fetched?.id, card.id);

    const active = listLearningObjects(db, { status: 'active' });
    assert.equal(active.length, 1);

    suspendLearningObject(db, card.id);
    const suspended = listLearningObjects(db, { status: 'suspended' });
    assert.equal(suspended.length, 1);
    assert.equal(suspended[0]?.id, card.id);

    const activeAfter = listLearningObjects(db, { status: 'active' });
    assert.equal(activeAfter.length, 0);
  });
});

test('SM-2: first correct review sets interval=1 and repetitions=1', () => {
  const state = { interval_days: 1, ease_factor: 2.5, repetitions: 0 };
  const result = computeNextReview(state, 5);
  assert.equal(result.next_interval_days, 1);
  assert.equal(result.next_repetitions, 1);
  assert.ok(result.next_ease_factor >= 2.5);
});

test('SM-2: consecutive correct reviews increase interval', () => {
  let state = { interval_days: 1, ease_factor: 2.5, repetitions: 0 };
  const r1 = computeNextReview(state, 5);
  assert.equal(r1.next_interval_days, 1);

  state = { interval_days: r1.next_interval_days, ease_factor: r1.next_ease_factor, repetitions: r1.next_repetitions };
  const r2 = computeNextReview(state, 5);
  assert.equal(r2.next_interval_days, 6);

  state = { interval_days: r2.next_interval_days, ease_factor: r2.next_ease_factor, repetitions: r2.next_repetitions };
  const r3 = computeNextReview(state, 5);
  assert.ok(r3.next_interval_days > 6);
});

test('SM-2: low quality review resets interval to 1', () => {
  const state = { interval_days: 20, ease_factor: 2.5, repetitions: 5 };
  const result = computeNextReview(state, 1);
  assert.equal(result.next_interval_days, 1);
  assert.equal(result.next_repetitions, 0);
});

test('getDueCards returns only due active cards', async () => {
  const root = makeVault();
  await withDb(root, async (db) => {
    const card1 = createLearningObject(db, { kind: 'concept_card', title: 'Card 1', prompt: 'Q1' });
    const card2 = createLearningObject(db, { kind: 'concept_card', title: 'Card 2', prompt: 'Q2' });

    // card1 never reviewed → due immediately
    // card2: record a review with far future due_at
    db.prepare(`
      INSERT INTO review_history (id, learning_object_id, attempt_number, confidence, correctness, scheduled_interval_days, due_at, reviewed_at)
      VALUES ('rh_test1', ?, 1, 1.0, 'correct', 30, ?, datetime('now'))
    `).run(card2.id, new Date(Date.now() + 30 * 86400 * 1000).toISOString());

    const due = getDueCards(db);
    assert.equal(due.length, 1);
    assert.equal(due[0]?.id, card1.id);
  });
});

test('recordReview writes review_history and triggers activity event', async () => {
  const root = makeVault();
  await withDb(root, async (db) => {
    const card = createLearningObject(db, { kind: 'concept_card', title: 'Test Card', prompt: 'Q?' });

    const review = recordReview(db, {
      learning_object_id: card.id,
      confidence: 0.8,
      latency_ms: 3000,
    });

    assert.match(review.id, /^rh_/);
    assert.equal(review.learning_object_id, card.id);
    assert.equal(review.attempt_number, 1);
    assert.equal(review.correctness, 'correct');
    assert.ok(review.scheduled_interval_days !== null);

    const history = getReviewHistory(db, card.id);
    assert.equal(history.length, 1);

    const activityRow = db.prepare("SELECT COUNT(*) as cnt FROM activity WHERE event_type = 'record_review'").get();
    assert.equal(activityRow.cnt, 1);
  });
});
