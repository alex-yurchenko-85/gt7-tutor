import { Inject, Injectable } from '@nestjs/common';
import type { CreateExerciseRequest, Exercise, ExerciseTargets, UpdateExerciseRequest } from '@gt7/contracts';
import { nextMedal } from '@gt7/core';
import type { Knex } from 'knex';
import { CatalogueService } from '../catalogue/catalogue.service.js';
import { ownedExercise, type ExerciseRow } from '../ownership/owned.js';
import { KNEX } from '../storage/knex.provider.js';
import { exerciseStatuses, type ExerciseStatusSummary } from './exercise-status.js';
import { exerciseStep } from './exercise-step.js';
import { httpError } from '../http-errors.js';

type NewExercise = {
  catalogue_id: string | null;
  family: string;
  name: string;
  car_id: number | null;
  targets: object;
};

function withoutZeroOffsets(offsets: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(offsets).filter(([, value]) => value !== 0));
}

function exerciseView(row: ExerciseRow, summary: ExerciseStatusSummary): Exercise {
  return {
    id: row.id,
    catalogueId: row.catalogue_id,
    family: row.family,
    name: row.name,
    carId: row.car_id,
    targets: row.targets,
    mutedCues: row.muted_cues,
    speakTargets: row.speak_targets,
    cueOffsetsMs: row.cue_offsets,
    sideCueDistanceM: row.side_cue_distance_m,
    activeReferenceId: row.active_reference_id,
    status: summary.status,
    step: exerciseStep({
      hasActiveReference: row.active_reference_id !== null,
      activeReferenceAttempts: summary.activeReferenceAttempts
    }),
    attemptCount: summary.attemptCount,
    referenceCount: summary.referenceCount,
    completeAttempts: summary.completeAttempts,
    bestMs: summary.bestMs,
    nextMedal: nextMedal(summary.bestMs, row.targets),
    createdAt: row.created_at.toISOString()
  };
}

@Injectable()
export class ExercisesService {
  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly catalogue: CatalogueService
  ) {}

  async list(userId: string): Promise<Exercise[]> {
    const rows = await this.db<ExerciseRow>('exercises').where({ user_id: userId }).orderBy('created_at');
    const summaries = new Map((await exerciseStatuses(this.db, userId)).map(summary => [summary.exerciseId, summary]));
    return rows.map(row => exerciseView(row, summaries.get(row.id)!));
  }

  async get(userId: string, id: string): Promise<Exercise> {
    const row = await ownedExercise(this.db, userId, id);
    const [summary] = await exerciseStatuses(this.db, userId, id);
    return exerciseView(row, summary!);
  }

  async create(userId: string, body: CreateExerciseRequest): Promise<Exercise> {
    const values: NewExercise =
      'catalogueId' in body
        ? this.fromCatalogue(body.catalogueId)
        : { catalogue_id: null, family: body.family, name: body.name, car_id: null, targets: {} };
    const [row] = await this.db('exercises')
      .insert({
        ...values,
        user_id: userId,
        targets: JSON.stringify(values.targets)
      })
      .returning<{ id: string }[]>('id');
    return this.get(userId, row!.id);
  }

  async update(userId: string, id: string, body: UpdateExerciseRequest): Promise<Exercise> {
    await ownedExercise(this.db, userId, id);
    const changes: Record<string, unknown> = {};
    if (body.mutedCues !== undefined) changes.muted_cues = JSON.stringify([...new Set(body.mutedCues)]);
    if (body.speakTargets !== undefined) changes.speak_targets = body.speakTargets;
    if (body.sideCueDistanceM !== undefined) changes.side_cue_distance_m = body.sideCueDistanceM;
    if (body.cueOffsetsMs !== undefined) changes.cue_offsets = JSON.stringify(withoutZeroOffsets(body.cueOffsetsMs));
    if (Object.keys(changes).length > 0) await this.db('exercises').where({ id, user_id: userId }).update(changes);
    return this.get(userId, id);
  }

  async setTargets(userId: string, id: string, targets: ExerciseTargets): Promise<void> {
    await ownedExercise(this.db, userId, id);
    await this.db('exercises').where({ id, user_id: userId }).update({ targets: JSON.stringify(targets) });
  }

  private fromCatalogue(catalogueId: string): NewExercise {
    const entry = this.catalogue.entry(catalogueId);
    if (!entry) throw httpError(404, 'not-found');
    return {
      catalogue_id: entry.id,
      family: entry.family,
      name: entry.name,
      car_id: this.catalogue.carIdByName(entry.car),
      targets: entry.targets ?? {}
    };
  }
}
