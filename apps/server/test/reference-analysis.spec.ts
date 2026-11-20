import type { INestApplication } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSamples } from '@gt7/capture';
import { DEFAULT_CONFIG, analyseReference } from '@gt7/core';
import type { ReferenceRow } from '../src/ownership/owned.js';
import { ReferencesService } from '../src/references/references.service.js';
import { DEMONSTRATION, TestApi, createReplayApp } from './support/api.js';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';
import type { FixtureReplays } from './support/replay-sources.js';
import { fixturePath } from '../../../tools/testing/fixture-path.js';
import { firstProfile } from './support/session.js';

vi.mock('@gt7/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@gt7/core')>();
  return { ...actual, analyseReference: vi.fn(actual.analyseReference) };
});

describe('reference analysis cache', () => {
  let database: DisposableDatabase;
  let db: Knex;
  let app: INestApplication;
  let replays: FixtureReplays;
  let cookie: string;
  let exerciseId: string;
  let captureId: string;
  const api = new TestApi(() => app, () => replays, () => cookie);
  const http = () => api.http();
  const analysed = vi.mocked(analyseReference);

  async function reference(): Promise<string> {
    return api.reference(exerciseId, captureId);
  }

  async function readAll(referenceId: string): Promise<void> {
    for (const route of ['cues', 'corners', 'path']) await http().get(`/api/references/${referenceId}/${route}`).set('Cookie', cookie).expect(200);
  }

  beforeAll(async () => {
    database = await createMigratedDatabase();
    db = knex({ client: 'pg', connection: database.url });
  });

  afterAll(async () => {
    await db.destroy();
    await database.drop();
  });

  beforeEach(async () => {
    await db.raw('truncate table users, sessions, settings cascade');
    ({ app, replays } = await createReplayApp(database.url));
    cookie = await firstProfile(app);
    exerciseId = await api.exercise();
    captureId = await api.capture(exerciseId, 'demo-a');
    analysed.mockClear();
  });

  afterEach(async () => {
    await app.close();
  });

  it('reference_analysis_is_computed_once_per_reference', async () => {
    const referenceId = await reference();
    await readAll(referenceId);
    await http().get(`/api/references/${referenceId}/clips`).set('Cookie', cookie).expect(200);
    expect(analysed).toHaveBeenCalledTimes(1);
  });

  it('parallel_reads_share_one_analysis', async () => {
    const referenceId = await reference();
    await Promise.all(['cues', 'corners', 'path', 'clips'].map(route => http().get(`/api/references/${referenceId}/${route}`).set('Cookie', cookie).expect(200)));
    expect(analysed).toHaveBeenCalledTimes(1);
  });

  it('cached_analysis_equals_a_fresh_one', async () => {
    const referenceId = await reference();
    const row = (await db<ReferenceRow>('references').where({ id: referenceId }).first())!;
    const service = app.get(ReferencesService);
    const first = await service.analysisOf(row);
    const cached = await service.analysisOf(row);
    const fresh = analyseReference(await readSamples(fixturePath('demo-a'), DEMONSTRATION), DEFAULT_CONFIG);
    expect(cached).toBe(first);
    expect(cached).toEqual(fresh);
  });

  it('analysis_cache_keeps_the_last_eight_references', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 9; index++) ids.push(await reference());
    for (const id of ids) await readAll(id);
    expect(analysed).toHaveBeenCalledTimes(9);
    for (const id of ids.slice(1)) await readAll(id);
    expect(analysed).toHaveBeenCalledTimes(9);
    await readAll(ids[0]!);
    expect(analysed).toHaveBeenCalledTimes(10);
  });
});
