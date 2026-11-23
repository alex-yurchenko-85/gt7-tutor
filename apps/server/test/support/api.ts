import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
import type { Knex } from 'knex';
import request from 'supertest';
import { TELEMETRY_SOURCE_FACTORY } from '../../src/captures/telemetry-source.factory.js';
import { testTempDir } from '../../../../tools/testing/temp-root.js';
import { createTestApp } from './app.js';
import { FixtureReplays } from './replay-sources.js';

export const INTERLAGOS = 'ce-autodromo-de-interlagos-s2';
export const INTERLAGOS_TARGET_MS = 16400;
export const DEMONSTRATION = { first: 457, last: 1422 };
export const CLEAN_ATTEMPT = { first: 381, last: 1409 };

export type Range = { first: number; last: number };

export type ReplayApp = { app: INestApplication; replays: FixtureReplays; dataDir: string };

export type ReplayAppOptions = {
  dataDir?: string;
  env?: Record<string, string>;
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
};

export async function createReplayApp(databaseUrl: string, options: ReplayAppOptions = {}): Promise<ReplayApp> {
  const replays = new FixtureReplays();
  const dataDir = options.dataDir ?? testTempDir('gt7-server-');
  const app = await createTestApp(databaseUrl, {
    env: { DATA_DIR: dataDir, TELEMETRY_SOURCE: 'replay', ...options.env },
    override: builder => {
      const replaced = builder.overrideProvider(TELEMETRY_SOURCE_FACTORY).useValue(replays.factory);
      return options.override ? options.override(replaced) : replaced;
    }
  });
  return { app, replays, dataDir };
}

export class TestApi {
  constructor(
    private readonly app: () => INestApplication,
    private readonly replays: () => FixtureReplays,
    private readonly session: () => string
  ) {}

  http() {
    return request(this.app().getHttpServer());
  }

  async exercise(body: object = { catalogueId: INTERLAGOS }, session = this.session()): Promise<string> {
    return (await this.http().post('/api/exercises').set('Cookie', session).send(body).expect(201)).body.id as string;
  }

  async capture(exerciseId: string, fixture: string, purpose = 'demo', session = this.session()): Promise<string> {
    this.replays().queue.push(fixture);
    const started = await this.http().post('/api/captures').set('Cookie', session).send({ exerciseId, purpose }).expect(201);
    await this.replays().finished();
    await this.http().post(`/api/captures/${started.body.id}/stop`).set('Cookie', session).expect(201);
    return started.body.id as string;
  }

  async reference(exerciseId: string, captureId: string, range: Range = DEMONSTRATION, session = this.session()): Promise<string> {
    return (await this.http().post('/api/references').set('Cookie', session).send({ exerciseId, captureId, ...range }).expect(201)).body.id as string;
  }
}

export type StoredAttempt = {
  exerciseId: string;
  captureId: string;
  referenceId: string;
  completion?: 'complete' | 'aborted';
  range?: Range;
  gameMs?: number | null;
  startedAt?: Date;
};

export async function insertAttempt(db: Knex, attempt: StoredAttempt): Promise<string> {
  const completion = attempt.completion ?? 'complete';
  const range = attempt.range ?? CLEAN_ATTEMPT;
  const [row] = await db('attempts')
    .insert({
      exercise_id: attempt.exerciseId,
      capture_id: attempt.captureId,
      reference_id: attempt.referenceId,
      first_raw_index: range.first,
      last_raw_index: range.last,
      completion,
      reason: completion === 'complete' ? 'game-timer' : 'left-track',
      game_ms: attempt.gameMs === undefined ? (completion === 'complete' ? 17071 : null) : attempt.gameMs,
      started_at: attempt.startedAt ?? new Date()
    })
    .returning('id');
  return row.id as string;
}

export async function rawPathOf(db: Knex, dataDir: string, captureId: string): Promise<string> {
  return join(dataDir, (await db('captures').where({ id: captureId }).first()).raw_path as string);
}

export async function insertRace(db: Knex, userId: string, rawPath = 'raw/race.ndjson'): Promise<string> {
  const [capture] = await db('captures').insert({ user_id: userId, purpose: 'race', raw_path: rawPath, started_at: new Date(), ended_at: new Date(), complete: true }).returning('id');
  const [race] = await db('races')
    .insert({
      user_id: userId,
      capture_id: capture.id,
      first_raw_index: 0,
      last_raw_index: 100,
      car_id: 3602,
      first_lap: 1,
      laps_in_race: 2,
      cars: 16,
      start_position: 8,
      finish_position: 7,
      race_ms: 118000,
      best_lap: 2,
      best_lap_ms: 58000,
      reference_lap: 2,
      complete: true,
      position_steps: JSON.stringify([{ tMs: 0, position: 8 }]),
      fuel_points: JSON.stringify([{ tMs: 0, fuel: 100 }]),
      recurring: JSON.stringify([]),
      started_at: new Date()
    })
    .returning('id');
  await db('race_laps').insert(
    [1, 2].map(number => ({ race_id: race.id, number, first_raw_index: number * 40, last_raw_index: number * 40 + 39, time_ms: 58000 + (2 - number) * 2000, position_start: 8, position_end: 8, top_speed_mps: 50, fuel_start: 100, fuel_end: 90, pit_in: false, pit_out: false }))
  );
  return race.id as string;
}
