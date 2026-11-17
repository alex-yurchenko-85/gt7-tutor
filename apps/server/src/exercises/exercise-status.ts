import { exerciseStatus, type ExerciseStatus, type Medal, type MedalTargets } from '@gt7/core';
import type { Knex } from 'knex';

export type ExerciseStatusSummary = {
  exerciseId: string;
  catalogueId: string | null;
  status: ExerciseStatus;
  completeAttempts: number;
  baselineAttempts: number;
  guidedAttempts: number;
  bestMs: number | null;
  createdAt: Date;
  activeReferenceId: string | null;
};

type StatusRow = {
  id: string;
  catalogue_id: string | null;
  active_reference_id: string | null;
  targets: MedalTargets;
  created_at: Date;
  complete_attempts: number;
  baseline_attempts: number;
  guided_attempts: number;
  best_ms: number | null;
  medals: Medal[];
};

const medalRank: Record<Medal, number> = { bronze: 1, silver: 2, gold: 3 };

function bestMedal(medals: Medal[]): Medal | null {
  return medals.reduce<Medal | null>((best, medal) => (best === null || medalRank[medal] > medalRank[best] ? medal : best), null);
}

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
      'e.targets',
      'e.created_at',
      db.raw("(count(a.id) filter (where a.completion = 'complete'))::int as complete_attempts"),
      db.raw("(count(a.id) filter (where a.completion = 'complete' and a.mode = 'baseline'))::int as baseline_attempts"),
      db.raw("(count(a.id) filter (where a.completion = 'complete' and a.mode = 'guided'))::int as guided_attempts"),
      db.raw("min(coalesce(a.official_ms, a.measured_ms)) filter (where a.completion = 'complete') as best_ms"),
      db.raw("coalesce(array_agg(distinct a.medal) filter (where a.medal is not null), '{}'::text[]) as medals")
    );
  return rows.map(row => ({
    exerciseId: row.id,
    catalogueId: row.catalogue_id,
    completeAttempts: row.complete_attempts,
    baselineAttempts: row.baseline_attempts,
    guidedAttempts: row.guided_attempts,
    bestMs: row.best_ms,
    createdAt: row.created_at,
    activeReferenceId: row.active_reference_id,
    status: exerciseStatus({
      hasActiveReference: row.active_reference_id !== null,
      completeAttempts: row.complete_attempts,
      bestMs: row.best_ms,
      targets: row.targets,
      manualMedal: bestMedal(row.medals)
    })
  }));
}
