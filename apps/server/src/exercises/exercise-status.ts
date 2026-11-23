import type { ExerciseStatusName } from '@gt7/contracts';
import { exerciseStatus } from '@gt7/core';
import type { Knex } from 'knex';

export type ExerciseStatusSummary = {
  exerciseId: string;
  catalogueId: string | null;
  status: ExerciseStatusName;
  attemptCount: number;
  referenceCount: number;
  completeAttempts: number;
  bestMs: number | null;
  createdAt: Date;
  activeReferenceId: string | null;
};

type StatusRow = {
  id: string;
  catalogue_id: string | null;
  active_reference_id: string | null;
  target_ms: number | null;
  created_at: Date;
  attempt_count: number;
  reference_count: number;
  complete_attempts: number;
  best_ms: number | null;
};

export async function exerciseStatuses(db: Knex, userId: string, exerciseId?: string): Promise<ExerciseStatusSummary[]> {
  const rows = await db('exercises as e')
    .leftJoin('attempts as a', 'a.exercise_id', 'e.id')
    .where('e.user_id', userId)
    .modify(builder => {
      if (exerciseId !== undefined) builder.where('e.id', exerciseId);
    })
    .groupBy('e.id')
    .orderBy('e.created_at')
    .select<StatusRow[]>(
      'e.id',
      'e.catalogue_id',
      'e.active_reference_id',
      'e.target_ms',
      'e.created_at',
      db.raw('count(a.id)::int as attempt_count'),
      db.raw('(select count(*) from "references" r where r.exercise_id = e.id)::int as reference_count'),
      db.raw("(count(a.id) filter (where a.completion = 'complete'))::int as complete_attempts"),
      db.raw("min(a.game_ms) filter (where a.completion = 'complete') as best_ms")
    );
  return rows.map(row => ({
    exerciseId: row.id,
    catalogueId: row.catalogue_id,
    attemptCount: row.attempt_count,
    referenceCount: row.reference_count,
    completeAttempts: row.complete_attempts,
    bestMs: row.best_ms,
    createdAt: row.created_at,
    activeReferenceId: row.active_reference_id,
    status: exerciseStatus({
      hasActiveReference: row.active_reference_id !== null,
      bestMs: row.best_ms,
      targetMs: row.target_ms
    })
  }));
}
