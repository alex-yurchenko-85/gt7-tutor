import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateExerciseRequest, Exercise, UpdateExerciseRequest } from '@gt7/contracts';
import { DEFAULT_SIDE_CUE_DISTANCE_M } from '@gt7/core';
import type { Knex } from 'knex';
import { CatalogueService } from '../catalogue/catalogue.service.js';
import { ownedExercise, type ExerciseRow } from '../ownership/owned.js';
import { KNEX } from '../storage/knex.provider.js';
import { exerciseStatuses, type ExerciseStatusSummary } from './exercise-status.js';
import { exerciseStep } from './exercise-step.js';

type NewExercise = {
  catalogue_id: string | null;
  family: string;
  name: string;
  car_id: number | null;
  conditions: Record<string, string>;
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
    conditions: row.conditions,
    targets: row.targets,
    mutedCues: row.muted_cues,
    speakTargets: row.speak_targets,
    cueOffsetsMs: row.cue_offsets,
    sideCueDistanceM: row.side_cue_distance_m,
    activeReferenceId: row.active_reference_id,
    status: summary.status,
    step: exerciseStep({
      hasActiveReference: row.active_reference_id !== null,
      baselineAttempts: summary.baselineAttempts,
      guidedAttempts: summary.guidedAttempts
    }),
    attemptCount: summary.attemptCount,
    referenceCount: summary.referenceCount,
    completeAttempts: summary.completeAttempts,
    bestMs: summary.bestMs,
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
        ? await this.fromCatalogue(body.catalogueId)
        : { catalogue_id: null, family: body.family, name: body.name, car_id: null, conditions: body.conditions, targets: {} };
    const [row] = await this.db('exercises')
      .insert({
        ...values,
        user_id: userId,
        conditions: JSON.stringify(values.conditions),
        targets: JSON.stringify(values.targets),
        side_cue_distance_m: DEFAULT_SIDE_CUE_DISTANCE_M
      })
      .returning<{ id: string }[]>('id');
    return this.get(userId, row!.id);
  }

  async update(userId: string, id: string, body: UpdateExerciseRequest): Promise<Exercise> {
    await ownedExercise(this.db, userId, id);
    const changes: Record<string, unknown> = {};
    if (body.name !== undefined) changes.name = body.name;
    if (body.conditions !== undefined) changes.conditions = JSON.stringify(body.conditions);
    if (body.targets !== undefined) changes.targets = JSON.stringify(body.targets);
    if (body.mutedCues !== undefined) changes.muted_cues = JSON.stringify([...new Set(body.mutedCues)]);
    if (body.speakTargets !== undefined) changes.speak_targets = body.speakTargets;
    if (body.sideCueDistanceM !== undefined) changes.side_cue_distance_m = body.sideCueDistanceM;
    if (body.cueOffsetsMs !== undefined) changes.cue_offsets = JSON.stringify(withoutZeroOffsets(body.cueOffsetsMs));
    if (Object.keys(changes).length > 0) await this.db('exercises').where({ id, user_id: userId }).update(changes);
    return this.get(userId, id);
  }

  private async fromCatalogue(catalogueId: string): Promise<NewExercise> {
    const entry = await this.db('catalogue_entries').where({ id: catalogueId }).first();
    if (!entry) throw new NotFoundException(`Catalogue entry ${catalogueId} not found`);
    return {
      catalogue_id: entry.id as string,
      family: entry.family as string,
      name: entry.name as string,
      car_id: this.catalogue.carIdByName(entry.car as string | null),
      conditions: {},
      targets: (entry.targets as object | null) ?? {}
    };
  }
}
