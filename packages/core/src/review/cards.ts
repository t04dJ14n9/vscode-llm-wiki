import { randomUUID } from 'node:crypto';
import type { Database } from '../db/connection';

export interface LearningObjectRecord {
  id: string;
  kind: string;
  title: string;
  prompt: string;
  ideal_answer: string | null;
  hints_json: string;
  anchor_ids_json: string;
  tags_json: string;
  difficulty_seed: number;
  importance: number;
  retention_target: number;
  status: 'draft' | 'active' | 'suspended' | 'retired';
  created_at: string;
  updated_at: string;
}

export interface CreateLearningObjectInput {
  kind: string;
  title: string;
  prompt: string;
  ideal_answer?: string;
  hints?: string[];
  anchor_ids?: string[];
  tags?: string[];
  difficulty_seed?: number;
  importance?: number;
  retention_target?: number;
}

export function createLearningObject(
  db: Database,
  input: CreateLearningObjectInput,
): LearningObjectRecord {
  const id = 'lo_' + randomUUID().replace(/-/g, '').substring(0, 12);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO learning_objects
      (id, kind, title, prompt, ideal_answer, hints_json, anchor_ids_json, tags_json,
       difficulty_seed, importance, retention_target, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(
    id,
    input.kind,
    input.title,
    input.prompt,
    input.ideal_answer ?? null,
    JSON.stringify(input.hints ?? []),
    JSON.stringify(input.anchor_ids ?? []),
    JSON.stringify(input.tags ?? []),
    input.difficulty_seed ?? 0.5,
    input.importance ?? 0.5,
    input.retention_target ?? 0.9,
    now,
    now,
  );
  return getLearningObject(db, id)!;
}

export function getLearningObject(db: Database, id: string): LearningObjectRecord | null {
  return (db.prepare('SELECT * FROM learning_objects WHERE id = ?').get(id) as LearningObjectRecord | undefined) ?? null;
}

export function listLearningObjects(
  db: Database,
  options?: { status?: string; tag?: string },
): LearningObjectRecord[] {
  if (options?.status) {
    return db.prepare('SELECT * FROM learning_objects WHERE status = ? ORDER BY created_at DESC')
      .all(options.status) as LearningObjectRecord[];
  }
  return db.prepare('SELECT * FROM learning_objects ORDER BY created_at DESC')
    .all() as LearningObjectRecord[];
}

export function updateLearningObject(
  db: Database,
  id: string,
  updates: Partial<CreateLearningObjectInput>,
): LearningObjectRecord | null {
  const existing = getLearningObject(db, id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.prompt !== undefined) { fields.push('prompt = ?'); values.push(updates.prompt); }
  if (updates.ideal_answer !== undefined) { fields.push('ideal_answer = ?'); values.push(updates.ideal_answer); }
  if (updates.hints !== undefined) { fields.push('hints_json = ?'); values.push(JSON.stringify(updates.hints)); }
  if (updates.anchor_ids !== undefined) { fields.push('anchor_ids_json = ?'); values.push(JSON.stringify(updates.anchor_ids)); }
  if (updates.tags !== undefined) { fields.push('tags_json = ?'); values.push(JSON.stringify(updates.tags)); }
  if (updates.difficulty_seed !== undefined) { fields.push('difficulty_seed = ?'); values.push(updates.difficulty_seed); }
  if (updates.importance !== undefined) { fields.push('importance = ?'); values.push(updates.importance); }
  if (updates.retention_target !== undefined) { fields.push('retention_target = ?'); values.push(updates.retention_target); }

  if (fields.length === 0) return existing;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE learning_objects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getLearningObject(db, id);
}

export function suspendLearningObject(db: Database, id: string): void {
  db.prepare("UPDATE learning_objects SET status = 'suspended', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
}

export function retireLearningObject(db: Database, id: string): void {
  db.prepare("UPDATE learning_objects SET status = 'retired', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
}
