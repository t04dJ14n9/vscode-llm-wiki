import { randomUUID } from 'node:crypto';
import type { Database } from '../db/connection';
import { recordActivity } from '../activity/record';
import { computeNextReview, getLastReview } from './scheduler';
import type { ReviewHistoryRow } from './scheduler';

export type { ReviewHistoryRow as ReviewHistoryRecord };

export interface RecordReviewInput {
  learning_object_id: string;
  confidence: number;
  latency_ms?: number;
  hints_used?: number;
  source_revealed?: boolean;
}

export function recordReview(db: Database, input: RecordReviewInput): ReviewHistoryRow {
  const last = getLastReview(db, input.learning_object_id);

  const state = last
    ? {
        interval_days: last.scheduled_interval_days ?? 1,
        ease_factor: 2.5,
        repetitions: last.attempt_number,
      }
    : { interval_days: 1, ease_factor: 2.5, repetitions: 0 };

  const q = Math.round(Math.max(0, Math.min(5, input.confidence * 5)));
  const schedule = computeNextReview(state, q);

  const correctness =
    input.confidence >= 0.6 ? 'correct' :
    input.confidence >= 0.4 ? 'partial' : 'incorrect';

  const id = 'rh_' + randomUUID().replace(/-/g, '').substring(0, 12);
  const attemptNumber = (last?.attempt_number ?? 0) + 1;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO review_history
      (id, learning_object_id, attempt_number, confidence, latency_ms,
       hints_used, source_revealed, correctness, scheduled_interval_days, due_at, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.learning_object_id,
    attemptNumber,
    input.confidence,
    input.latency_ms ?? null,
    input.hints_used ?? 0,
    input.source_revealed ? 1 : 0,
    correctness,
    schedule.next_interval_days,
    schedule.due_at,
    now,
  );

  recordActivity(db, {
    event_type: 'record_review',
    metadata: { learning_object_id: input.learning_object_id, confidence: input.confidence },
  });

  return getLastReview(db, input.learning_object_id)!;
}

export function getReviewHistory(db: Database, learningObjectId: string): ReviewHistoryRow[] {
  return db.prepare(`
    SELECT * FROM review_history
    WHERE learning_object_id = ?
    ORDER BY attempt_number ASC
  `).all(learningObjectId) as ReviewHistoryRow[];
}
