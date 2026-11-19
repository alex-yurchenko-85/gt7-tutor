import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  DeleteAttemptsResult,
  DeleteHistoryRequest,
  DeleteHistoryResult,
  DeleteProfileRequest,
  DeleteProfileResult,
  ProfileUser,
  RemoveExercisesRequest,
  RemoveExercisesResult
} from '@gt7/contracts';
import type { Knex } from 'knex';
import { conflict } from '../http-errors.js';
import { AuthService } from '../auth/auth.service.js';
import { StorageService } from '../captures/storage.service.js';
import { ownedExercise } from '../ownership/owned.js';
import { LiveHub } from '../live/live-hub.service.js';
import type { CaptureRow } from '../ownership/owned.js';
import { KNEX } from '../storage/knex.provider.js';
import { TrainingService } from '../training/training.service.js';

async function ownedAttemptCount(db: Knex, userId: string, ids: string[]): Promise<number> {
  const row = await db('attempts as a')
    .join('exercises as e', 'e.id', 'a.exercise_id')
    .whereIn('a.id', ids)
    .where('e.user_id', userId)
    .first<{ count: number }>(db.raw('count(*)::int as count'));
  return row.count;
}

async function countExerciseRows(trx: Knex.Transaction, ids: string[]): Promise<Omit<RemoveExercisesResult, 'cleanup'>> {
  const attempts = await trx('attempts').whereIn('exercise_id', ids).count<{ count: string }>('* as count').first();
  const references = await trx('references').whereIn('exercise_id', ids).count<{ count: string }>('* as count').first();
  return { exercises: ids.length, attempts: Number(attempts!.count), references: Number(references!.count) };
}

@Injectable()
export class HistoryService {
  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly training: TrainingService,
    private readonly storage: StorageService,
    private readonly auth: AuthService,
    private readonly hub: LiveHub
  ) {}

  async deleteAttempts(userId: string, ids: string[]): Promise<DeleteAttemptsResult> {
    await this.waitUntilIdle(userId);
    const unique = [...new Set(ids)];
    const deleted = await this.db.transaction(async (trx): Promise<number> => {
      if ((await ownedAttemptCount(trx, userId, unique)) !== unique.length) throw new NotFoundException('Attempt not found');
      return await trx('attempts').whereIn('id', unique).del();
    });
    return { deleted };
  }

  async deleteHistory(userId: string, request: DeleteHistoryRequest): Promise<DeleteHistoryResult> {
    await this.waitUntilIdle(userId);
    const counts = await this.db.transaction(async trx => {
      const exerciseIds =
        request.exerciseId === undefined
          ? await trx('exercises').where({ user_id: userId }).pluck<string[]>('id')
          : [(await ownedExercise(trx, userId, request.exerciseId)).id];
      const attempts = await trx('attempts').whereIn('exercise_id', exerciseIds).del();
      const references = request.scope === 'everything' ? await trx('references').whereIn('exercise_id', exerciseIds).del() : 0;
      return { attempts, references };
    });
    return { ...counts, cleanup: request.cleanup ? await this.storage.cleanup(userId) : null };
  }

  async removeExercises(userId: string, request: RemoveExercisesRequest): Promise<RemoveExercisesResult> {
    await this.waitUntilIdle(userId);
    const ids = [...new Set(request.ids)];
    const counts = await this.db.transaction(async trx => {
      const owned = await trx('exercises').whereIn('id', ids).where({ user_id: userId }).pluck<string[]>('id');
      if (owned.length !== ids.length) throw new NotFoundException('Exercise not found');
      const counts = await countExerciseRows(trx, ids);
      await trx('exercises').whereIn('id', ids).del();
      return counts;
    });
    return { ...counts, cleanup: request.cleanup ? await this.storage.cleanup(userId) : null };
  }

  async deleteProfile(user: ProfileUser, request: DeleteProfileRequest, address: string): Promise<DeleteProfileResult> {
    await this.waitUntilIdle(user.id);
    await this.auth.confirmPassword(user, request.password, address);
    const { counts, captures } = await this.db.transaction(async trx => {
      const exerciseIds = await trx('exercises').where({ user_id: user.id }).pluck<string[]>('id');
      const removed = await countExerciseRows(trx, exerciseIds);
      const rows = await trx<CaptureRow>('captures').where({ user_id: user.id }).select('raw_path');
      await trx('users').where({ id: user.id }).del();
      return { counts: removed, captures: rows };
    });
    this.hub.changed();
    return { ...counts, cleanup: await this.storage.removeFiles(captures) };
  }

  private async waitUntilIdle(userId: string): Promise<void> {
    if (this.training.busyFor(userId)) throw conflict('busy', 'Stop the training or the recording first.');
    await this.training.idle();
  }
}
