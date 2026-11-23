import type { CapturePurpose, ErrorCode, ReferenceOrigin } from '@gt7/contracts';
import type { Knex } from 'knex';
import { httpError } from '../http-errors.js';

export type ExerciseRow = {
  id: string;
  user_id: string;
  catalogue_id: string | null;
  family: string;
  name: string;
  car_id: number | null;
  target_ms: number | null;
  muted_cues: string[];
  speak_targets: boolean;
  cue_offsets: Record<string, number>;
  side_cue_distance_m: number | null;
  active_reference_id: string | null;
  created_at: Date;
};

export type CaptureRow = {
  id: string;
  user_id: string;
  exercise_id: string | null;
  purpose: CapturePurpose;
  raw_path: string;
  started_at: Date;
  ended_at: Date | null;
  packets: number;
  complete: boolean;
  error_reason: string | null;
};

export type ReferenceRow = {
  id: string;
  exercise_id: string;
  capture_id: string;
  first_raw_index: number;
  last_raw_index: number;
  origin: ReferenceOrigin;
  game_version: string | null;
  needs_check: boolean;
  timer_ms: number | null;
  created_at: Date;
};

export type AttemptRow = {
  id: string;
  exercise_id: string;
  capture_id: string;
  reference_id: string;
  first_raw_index: number;
  last_raw_index: number;
  completion: 'complete' | 'aborted';
  reason: string | null;
  game_ms: number | null;
  started_at: Date;
  created_at: Date;
};

export type RaceRow = {
  id: string;
  user_id: string;
  capture_id: string;
  first_raw_index: number;
  last_raw_index: number;
  track_name: string | null;
  track_candidates: string[];
  car_id: number;
  first_lap: number;
  laps_in_race: number;
  cars: number;
  start_position: number;
  finish_position: number;
  race_ms: number;
  best_lap: number;
  best_lap_ms: number;
  reference_lap: number;
  lap_length_m: number | null;
  complete: boolean;
  position_steps: { tMs: number; position: number }[];
  fuel_points: { tMs: number; fuel: number }[];
  recurring: unknown[];
  started_at: Date;
  created_at: Date;
};

function found<T>(row: T | undefined, code: ErrorCode): T {
  if (!row) throw httpError(404, code);
  return row;
}

export async function ownedExercise(db: Knex, userId: string, id: string): Promise<ExerciseRow> {
  return found(await db<ExerciseRow>('exercises').where({ id, user_id: userId }).first(), 'exercise-not-found');
}

export async function ownedCapture(db: Knex, userId: string, id: string): Promise<CaptureRow> {
  return found(await db<CaptureRow>('captures').where({ id, user_id: userId }).first(), 'capture-not-found');
}

export async function ownedReference(db: Knex, userId: string, id: string): Promise<ReferenceRow> {
  const row = await db('references as r')
    .join('exercises as e', 'e.id', 'r.exercise_id')
    .where({ 'r.id': id, 'e.user_id': userId })
    .first<ReferenceRow | undefined>('r.*');
  return found(row, 'reference-not-found');
}

export async function ownedAttempt(db: Knex, userId: string, id: string): Promise<AttemptRow> {
  const row = await db('attempts as a')
    .join('exercises as e', 'e.id', 'a.exercise_id')
    .where({ 'a.id': id, 'e.user_id': userId })
    .first<AttemptRow | undefined>('a.*');
  return found(row, 'attempt-not-found');
}

export async function ownedRace(db: Knex, userId: string, id: string): Promise<RaceRow> {
  return found(await db<RaceRow>('races').where({ id, user_id: userId }).first(), 'race-not-found');
}
