import { Inject, Injectable } from '@nestjs/common';
import type { ExerciseStatusName, Progress, ProgressCollection, ProgressExercise, RecurringDifference } from '@gt7/contracts';
import { DEFAULT_CONFIG, recurring } from '@gt7/core';
import type { Knex } from 'knex';
import { AttemptsService, attemptTimeMs } from '../attempts/attempts.service.js';
import { localDate } from '../attempts/local-date.js';
import { exerciseStatuses } from '../exercises/exercise-status.js';
import { ownedExercise, type AttemptRow, type ReferenceRow } from '../ownership/owned.js';
import { KNEX } from '../storage/knex.provider.js';

export const OWN_EXERCISES_COLLECTION = 'Own exercises';

const STATUSES: ExerciseStatusName[] = ['new', 'ready', 'practising', 'bronze', 'silver', 'gold'];

type ExerciseGroupRow = { id: string; name: string; family: string; collection: string | null };

function zeroCounts(): Record<ExerciseStatusName, number> {
  return Object.fromEntries(STATUSES.map(status => [status, 0])) as Record<ExerciseStatusName, number>;
}

function bestByDay(attempts: AttemptRow[]): { date: string; bestMs: number }[] {
  const best = new Map<string, number>();
  for (const attempt of attempts) {
    const time = attemptTimeMs(attempt);
    if (time === null) continue;
    const date = localDate(attempt.started_at);
    best.set(date, Math.min(best.get(date) ?? Number.POSITIVE_INFINITY, time));
  }
  return [...best.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, bestMs]) => ({ date, bestMs }));
}

@Injectable()
export class StatsService {
  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly attempts: AttemptsService
  ) {}

  async recurring(userId: string, exerciseId: string, last: number): Promise<RecurringDifference[]> {
    const exercise = await ownedExercise(this.db, userId, exerciseId);
    if (!exercise.active_reference_id) return [];
    const reference = (await this.db<ReferenceRow>('references').where({ id: exercise.active_reference_id }).first())!;
    const recent = await this.db<AttemptRow>('attempts')
      .where({ exercise_id: exerciseId, completion: 'complete' })
      .orderBy([{ column: 'started_at', order: 'desc' }, { column: 'id', order: 'desc' }])
      .limit(last);
    const perAttempt = [];
    for (const attempt of recent) perAttempt.push(await this.attempts.findingsAgainst(attempt, reference));
    return recurring(perAttempt, DEFAULT_CONFIG);
  }

  async progress(userId: string): Promise<Progress> {
    const exercises = await this.db('exercises as e')
      .leftJoin('catalogue_entries as c', 'c.id', 'e.catalogue_id')
      .where('e.user_id', userId)
      .orderBy('e.created_at')
      .select<ExerciseGroupRow[]>('e.id', 'e.name', 'e.family', 'c.collection');
    const statuses = new Map((await exerciseStatuses(this.db, userId)).map(summary => [summary.exerciseId, summary]));
    const attempts = await this.db('attempts as a')
      .join('exercises as e', 'e.id', 'a.exercise_id')
      .where('e.user_id', userId)
      .select<AttemptRow[]>('a.*');
    const collections = new Map<string, ProgressCollection>();
    const rows: ProgressExercise[] = exercises.map(exercise => {
      const summary = statuses.get(exercise.id)!;
      const collection = exercise.collection ?? OWN_EXERCISES_COLLECTION;
      const key = `${exercise.family}\u0000${collection}`;
      const group = collections.get(key) ?? { family: exercise.family, collection, counts: zeroCounts() };
      group.counts[summary.status]++;
      collections.set(key, group);
      return {
        id: exercise.id,
        name: exercise.name,
        family: exercise.family,
        collection,
        status: summary.status,
        bestMs: summary.bestMs,
        bestByDay: bestByDay(attempts.filter(attempt => attempt.exercise_id === exercise.id))
      };
    });
    const sorted = [...collections.values()].sort(
      (left, right) => left.family.localeCompare(right.family) || left.collection.localeCompare(right.collection)
    );
    return { collections: sorted, exercises: rows };
  }
}
