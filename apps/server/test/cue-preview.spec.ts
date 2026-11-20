import type { INestApplication } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { replayCoach } from '@gt7/core';
import type { CuePreview, PreviewCue } from '@gt7/contracts';
import { TELEMETRY_SOURCE_FACTORY } from '../src/captures/telemetry-source.factory.js';
import { createTestApp } from './support/app.js';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';
import { testTempDir } from '../../../tools/testing/temp-root.js';
import { FixtureReplays } from './support/replay-sources.js';
import { anotherProfile, firstProfile } from './support/session.js';

vi.mock('@gt7/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@gt7/core')>();
  return { ...actual, replayCoach: vi.fn(actual.replayCoach) };
});

describe('cue preview', () => {
  let database: DisposableDatabase;
  let db: Knex;
  let app: INestApplication;
  let replays: FixtureReplays;
  let cookie: string;
  let exerciseId: string;
  const http = () => request(app.getHttpServer());

  async function capture(fixture: string, purpose = 'demo'): Promise<string> {
    replays.queue.push(fixture);
    const started = await http().post('/api/captures').set('Cookie', cookie).send({ exerciseId, purpose }).expect(201);
    await replays.finished();
    return (await http().post(`/api/captures/${started.body.id}/stop`).set('Cookie', cookie).expect(201)).body.id as string;
  }

  async function reference(): Promise<string> {
    const captureId = await capture('demo-a');
    const response = await http().post('/api/references').set('Cookie', cookie).send({ exerciseId, captureId, first: 457, last: 1422 }).expect(201);
    return response.body.id as string;
  }

  async function preview(id: string, session = cookie): Promise<CuePreview> {
    return (await http().get(`/api/references/${id}/preview`).set('Cookie', session).expect(200)).body as CuePreview;
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
    replays = new FixtureReplays();
    app = await createTestApp(database.url, {
      env: { DATA_DIR: testTempDir('gt7-server-'), TELEMETRY_SOURCE: 'replay' },
      override: builder => builder.overrideProvider(TELEMETRY_SOURCE_FACTORY).useValue(replays.factory)
    });
    cookie = await firstProfile(app);
    exerciseId = (await http().post('/api/exercises').set('Cookie', cookie).send({ catalogueId: 'ce-autodromo-de-interlagos' }).expect(201)).body.id;
  });

  afterEach(async () => {
    await app.close();
  });

  it('preview_drops_the_throttle_cues_after_a_lift_off', async () => {
    const body = await preview(await reference());
    expect(body.cues.map(cue => cue.key)).toEqual(['big-stop@291', 'brake@291', 'throttle@411', 'ease-off@564', 'ease-off@792']);
    expect(body.cues.map(cue => cue.rowKey)).toEqual([null, 'brake@291', 'throttle@411', 'ease-off@564', 'ease-off@792']);
    expect(body.dropped).toEqual([
      { rowKey: 'throttle@568', reason: 'voice-busy', afterRowKey: 'ease-off@564' },
      { rowKey: 'throttle@796', reason: 'voice-busy', afterRowKey: 'ease-off@792' }
    ]);
  });

  it('preview_cue_times_match_the_reference_time', async () => {
    const id = await reference();
    const body = await preview(id);
    const trace = (await http().get(`/api/references/${id}/path`).set('Cookie', cookie).expect(200)).body as { x: number[] };
    expect(body.gridTimeMs).toHaveLength(trace.x.length);
    expect(body.gridTimeMs[0]).toBe(0);
    expect(Math.abs(body.gridTimeMs.at(-1)! - body.timeMs)).toBeLessThan(100);
    const liftOff = body.cues.find((cue: PreviewCue) => cue.key === 'ease-off@564')!;
    expect(liftOff.atMs).toBeGreaterThan(10_800);
    expect(liftOff.atMs).toBeLessThan(11_000);
  });

  it('preview_follows_the_exercise_timing', async () => {
    const id = await reference();
    await http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ cueOffsetsMs: { 'ease-off@564': 1000 } }).expect(200);
    const body = await preview(id);
    expect(body.cues.map(cue => cue.key)).toContain('throttle@568');
    expect(body.dropped.map(drop => drop.rowKey)).toEqual(['throttle@796']);
  });

  it('preview_leaves_muted_cues_out', async () => {
    const id = await reference();
    await http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ mutedCues: ['throttle@568'] }).expect(200);
    const body = await preview(id);
    expect(body.cues.map(cue => cue.key)).not.toContain('throttle@568');
    expect(body.dropped.map(drop => drop.rowKey)).toEqual(['throttle@796']);
  });

  it('preview_of_another_profile_is_not_found', async () => {
    const id = await reference();
    const other = await anotherProfile(app, cookie, 'Other');
    await http().get(`/api/references/${id}/preview`).set('Cookie', other).expect(404);
  });

  it('preview_without_a_start_has_no_cues', async () => {
    const id = await reference();
    vi.mocked(replayCoach).mockReturnValueOnce({ attemptEvents: [], cues: [], suppressed: [], guidance: [] });
    const body = await preview(id);
    expect(body.cues).toEqual([]);
    expect(body.dropped).toEqual([]);
    expect(body.gridTimeMs.length).toBeGreaterThan(100);
  });

  it('preview_works_for_a_reference_from_an_attempt', async () => {
    const demo = await reference();
    const playerCapture = await capture('ce-clean', 'player');
    const [row] = await db('attempts')
      .insert({
        exercise_id: exerciseId,
        capture_id: playerCapture,
        reference_id: demo,
        first_raw_index: 381,
        last_raw_index: 1409,
        completion: 'complete',
        game_ms: 17071,
        started_at: new Date()
      })
      .returning('id');
    const promoted = await http().post(`/api/attempts/${row.id}/promote`).set('Cookie', cookie).expect(201);
    const body = await preview(promoted.body.id as string);
    expect(body.cues.length).toBeGreaterThan(0);
  });
});
