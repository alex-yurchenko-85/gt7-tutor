import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSamples } from '@gt7/capture';
import { cutToTimerRun, replayCoach } from '@gt7/core';
import type { CuePreview, PreviewCue } from '@gt7/contracts';
import { TestApi, createReplayApp, insertAttempt } from './support/api.js';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';
import type { FixtureReplays } from './support/replay-sources.js';
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
  let dataDir: string;
  const api = new TestApi(() => app, () => replays, () => cookie);
  const http = () => api.http();

  function capture(fixture: string, purpose = 'demo'): Promise<string> {
    return api.capture(exerciseId, fixture, purpose);
  }

  async function reference(): Promise<string> {
    return api.reference(exerciseId, await capture('demo-a'));
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
    ({ app, replays, dataDir } = await createReplayApp(database.url));
    cookie = await firstProfile(app);
    exerciseId = await api.exercise();
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
    expect(body.cues.map(cue => cue.key)).toContain('ease-off@564');
    const liftOff = body.cues.find((cue: PreviewCue) => cue.key === 'ease-off@564');
    expect(liftOff?.atMs).toBeGreaterThan(10_800);
    expect(liftOff?.atMs).toBeLessThan(11_000);
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

  async function promotedReference(fixture: string): Promise<string> {
    const demo = await reference();
    const playerCapture = await capture(fixture, 'player');
    const stored = await db('captures').where({ id: playerCapture }).first();
    const samples = await readSamples(join(dataDir, stored.raw_path));
    const range = cutToTimerRun(samples, { first: samples[0]!.rawIndex, last: samples.at(-1)!.rawIndex }, 'player')!;
    const attemptId = await insertAttempt(db, { exerciseId, captureId: playerCapture, referenceId: demo, range, gameMs: range.gameTimeMs });
    return (await http().post(`/api/attempts/${attemptId}/promote`).set('Cookie', cookie).expect(201)).body.id as string;
  }

  it('preview_leaves_out_a_pause_of_the_reference', async () => {
    const id = await promotedReference('ce-pause');
    const body = await preview(id);
    expect(body.dropped).toContainEqual({ rowKey: 'throttle@124', reason: 'voice-busy', afterRowKey: 'ease-off@91' });
    expect(body.cues.map(cue => cue.key)).toContain('brake@256');
    const brake = body.cues.find(cue => cue.key === 'brake@256');
    expect(brake?.atMs).toBeGreaterThan(3600);
    expect(brake?.atMs).toBeLessThan(3900);
  });

  it('preview_works_for_a_reference_from_an_attempt', async () => {
    const body = await preview(await promotedReference('ce-clean'));
    expect(body.cues.length).toBeGreaterThan(0);
  });
});
