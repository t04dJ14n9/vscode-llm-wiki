import type { Database } from '../db/connection';
import type { LearningObjectRecord } from './cards';

export interface Sm2State {
  interval_days: number;
  ease_factor: number;
  repetitions: number;
}

export interface ScheduleResult {
  next_interval_days: number;
  next_ease_factor: number;
  next_repetitions: number;
  due_at: string;
}

export function computeNextReview(state: Sm2State, q: number): ScheduleResult {
  // q is 0-5 (SM-2 quality rating)
  let { interval_days, ease_factor, repetitions } = state;

  if (q < 3) {
    repetitions = 0;
    interval_days = 1;
  } else {
    if (repetitions === 0) {
      interval_days = 1;
    } else if (repetitions === 1) {
      interval_days = 6;
    } else {
      interval_days = Math.round(interval_days * ease_factor);
    }
    ease_factor = Math.max(1.3, ease_factor + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    repetitions++;
  }

  const dueAt = new Date(Date.now() + interval_days * 86400 * 1000).toISOString();

  return {
    next_interval_days: interval_days,
    next_ease_factor: ease_factor,
    next_repetitions: repetitions,
    due_at: dueAt,
  };
}

export function getDueCards(db: Database, asOf?: string): LearningObjectRecord[] {
  const now = asOf ?? new Date().toISOString();
  return db.prepare(`
    SELECT lo.*
    FROM learning_objects lo
    WHERE lo.status = 'active'
      AND (
        NOT EXISTS (SELECT 1 FROM review_history rh WHERE rh.learning_object_id = lo.id)
        OR EXISTS (
          SELECT 1 FROM review_history rh
          WHERE rh.learning_object_id = lo.id
            AND rh.due_at <= ?
            AND rh.attempt_number = (
              SELECT MAX(attempt_number) FROM review_history WHERE learning_object_id = lo.id
            )
        )
      )
    ORDER BY lo.importance DESC, lo.created_at ASC
  `).all(now) as LearningObjectRecord[];
}

export interface ReviewHistoryRow {
  id: string;
  learning_object_id: string;
  attempt_number: number;
  confidence: number | null;
  latency_ms: number | null;
  hints_used: number;
  source_revealed: number;
  correctness: string | null;
  scheduled_interval_days: number | null;
  due_at: string | null;
  reviewed_at: string;
}

export function getLastReview(db: Database, learningObjectId: string): ReviewHistoryRow | null {
  return (db.prepare(`
    SELECT * FROM review_history
    WHERE learning_object_id = ?
    ORDER BY attempt_number DESC
    LIMIT 1
  `).get(learningObjectId) as ReviewHistoryRow | undefined) ?? null;
}
