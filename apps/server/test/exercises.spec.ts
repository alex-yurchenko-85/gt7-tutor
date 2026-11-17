import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readRaw } from '@gt7/capture';
import { DEFAULT_SIDE_CUE_DISTANCE_M } from '@gt7/core';
import type { RawDatagram } from '@gt7/contracts';
import { TELEMETRY_SOURCE_FACTORY } from '../src/captures/telemetry-source.factory.js';
import { createTestApp } from './support/app.js';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';
import { tempDir } from './support/process.js';
import { FixtureReplays, fixturePath } from './support/replay-sources.js';
import { anotherProfile, firstProfile } from './support/session.js';

async function rows(path: string, range?: { first: number; last: number }): Promise<RawDatagram[]> {
  const result: RawDatagram[] = [];
  for await (const row of readRaw(path, range)) result.push(row);
  return result;
}

describe('exercises, captures and references', () => {
  let database: DisposableDatabase;
  let db: Knex;
  let app: INestApplication | null = null;
  let dataDir: string;
  let replays: FixtureReplays;
  let cookie: string;
  const http = () => request(app!.getHttpServer());

  async function start(env: Record<string, string> = {}) {
    await app?.close();
    app = await createTestApp(database.url, {
      env: { DATA_DIR: dataDir, TELEMETRY_SOURCE: 'replay', ...env },
      override: builder => builder.overrideProvider(TELEMETRY_SOURCE_FACTORY).useValue(replays.factory)
    });
  }

  async function exercise(body: object = { catalogueId: 'brand-yangwang-racing-lines' }, session = cookie): Promise<string> {
    return (await http().post('/api/exercises').set('Cookie', session).send(body).expect(201)).body.id as string;
  }

  async function capture(exerciseId: string, fixture: string, purpose = 'demo', startAfterS?: number): Promise<string> {
    replays.queue.push(fixture);
    const body = startAfterS === undefined ? { exerciseId, purpose } : { exerciseId, purpose, startAfterS };
    const started = await http().post('/api/captures').set('Cookie', cookie).send(body).expect(201);
    expect(started.body.active).toBe(true);
    await replays.finished();
    const stopped = await http().post(`/api/captures/${started.body.id}/stop`).set('Cookie', cookie).expect(201);
    return stopped.body.id as string;
  }

  async function reference(exerciseId: string, captureId: string, first: number, last: number, startKind = 'flying'): Promise<string> {
    const response = await http()
      .post('/api/references')
      .set('Cookie', cookie)
      .send({ exerciseId, captureId, first, last, startKind })
      .expect(201);
    return response.body.id as string;
  }

  async function storedAttempt(exerciseId: string, captureId: string, referenceId: string, completion = 'complete'): Promise<string> {
    const [row] = await db('attempts')
      .insert({
        exercise_id: exerciseId,
        capture_id: captureId,
        reference_id: referenceId,
        first_raw_index: 1162,
        last_raw_index: 2786,
        mode: 'baseline',
        completion,
        measured_ms: completion === 'complete' ? 27100 : null,
        started_at: new Date()
      })
      .returning('id');
    return row.id as string;
  }

  async function rawPathOf(captureId: string): Promise<string> {
    return join(dataDir, (await db('captures').where({ id: captureId }).first()).raw_path as string);
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
    dataDir = tempDir();
    replays = new FixtureReplays();
    await start();
    cookie = await firstProfile(app!);
  });

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it('exercise_from_catalogue_copies_targets_and_car', async () => {
    const yangwang = await http().get(`/api/exercises/${await exercise()}`).set('Cookie', cookie).expect(200);
    expect(yangwang.body).toMatchObject({ family: 'Brand Central', carId: 3602, status: 'new', step: 1, mutedCues: [], activeReferenceId: null });
    const licence = await http().post('/api/exercises').set('Cookie', cookie).send({ catalogueId: 'licence-b-1' }).expect(201);
    expect(licence.body.targets).toEqual({ bronzeMs: 22800, silverMs: 21400, goldMs: 20800 });
    const own = await http()
      .post('/api/exercises')
      .set('Cookie', cookie)
      .send({ family: 'Time Trial', name: 'Tsukuba lap', conditions: { weather: 'dry' } })
      .expect(201);
    expect(own.body).toMatchObject({ catalogueId: null, conditions: { weather: 'dry' }, targets: {}, carId: null });
    const patched = await http()
      .patch(`/api/exercises/${own.body.id}`)
      .set('Cookie', cookie)
      .send({ targets: { goldMs: 60000 }, mutedCues: ['brake@332'] })
      .expect(200);
    expect(patched.body).toMatchObject({ targets: { goldMs: 60000 }, mutedCues: ['brake@332'] });
    await http().post('/api/exercises').set('Cookie', cookie).send({ catalogueId: 'no-such-entry' }).expect(404);
    const listed = await http().get('/api/exercises').set('Cookie', cookie).expect(200);
    expect(listed.body).toHaveLength(3);
  });

  it('capture_from_replay_is_stored_and_complete', async () => {
    const captureId = await capture(await exercise(), 'player-run', 'player');
    const stored = await http().get(`/api/captures/${captureId}`).set('Cookie', cookie).expect(200);
    expect(stored.body).toMatchObject({ purpose: 'player', complete: true, packets: 3784, errorReason: null, active: false });
    expect(stored.body.endedAt).toEqual(expect.any(String));
    const written = await rows(await rawPathOf(captureId));
    const original = await rows(fixturePath('player-run'));
    expect(written.map(row => row.rawIndex)).toEqual(original.map(row => row.rawIndex));
    expect(written.map(row => row.payloadBase64)).toEqual(original.map(row => row.payloadBase64));
    expect(written.every(row => row.captureId === captureId)).toBe(true);
    const listed = await http().get('/api/captures').set('Cookie', cookie).expect(200);
    expect(listed.body.map((item: { id: string }) => item.id)).toEqual([captureId]);
  });

  it('second_capture_conflicts_409', async () => {
    const exerciseId = await exercise();
    replays.queue.push('player-run', 'player-run');
    const first = await http().post('/api/captures').set('Cookie', cookie).send({ exerciseId, purpose: 'player' }).expect(201);
    await http().post('/api/captures').set('Cookie', cookie).send({ exerciseId, purpose: 'player' }).expect(409);
    const other = await anotherProfile(app!, cookie, 'Second');
    const otherExercise = await exercise(undefined, other);
    await http().post('/api/captures').set('Cookie', other).send({ exerciseId: otherExercise, purpose: 'demo' }).expect(409);
    await replays.finished();
    await http().post(`/api/captures/${first.body.id}/stop`).set('Cookie', cookie).expect(201);
    await http().post(`/api/captures/${first.body.id}/stop`).set('Cookie', cookie).expect(409);
  });

  it('udp_capture_needs_console_address', async () => {
    await start({ TELEMETRY_SOURCE: 'udp' });
    const exerciseId = await exercise();
    const response = await http().post('/api/captures').set('Cookie', cookie).send({ exerciseId, purpose: 'demo' }).expect(409);
    expect(response.body.code).toBe('console-address-missing');
    await http().put('/api/settings/connection').set('Cookie', cookie).send({ ps5Ip: '10.0.0.7' }).expect(200);
    replays.queue.push('demo-wait05');
    const started = await http().post('/api/captures').set('Cookie', cookie).send({ exerciseId, purpose: 'demo' }).expect(201);
    expect(replays.requests.at(-1)).toEqual({ ps5Ip: '10.0.0.7' });
    await replays.finished();
    await http().post(`/api/captures/${started.body.id}/stop`).set('Cookie', cookie).expect(201);
  });

  it('open_capture_is_marked_incomplete_at_start', async () => {
    const exerciseId = await exercise();
    const user = await db('users').first();
    mkdirSync(join(dataDir, 'raw'), { recursive: true });
    const text = readFileSync(fixturePath('demo-wait05'), 'utf8');
    const lines = text.split('\n').slice(0, 100);
    writeFileSync(join(dataDir, 'raw', 'interrupted.ndjson'), `${lines.join('\n')}\n${lines[100 - 1]!.slice(0, 40)}`);
    const [row] = await db('captures')
      .insert({ user_id: user.id, exercise_id: exerciseId, purpose: 'demo', raw_path: 'raw/interrupted.ndjson', started_at: new Date() })
      .returning('id');
    await start();
    const stored = await http().get(`/api/captures/${row.id}`).set('Cookie', cookie).expect(200);
    expect(stored.body).toMatchObject({ complete: false, errorReason: 'interrupted', packets: 100, active: false });
    expect(stored.body.endedAt).toEqual(expect.any(String));
    expect((await rows(join(dataDir, 'raw', 'interrupted.ndjson'))).map(item => item.rawIndex)).toEqual([...Array(100).keys()]);
  });

  it('three_demo_captures_propose_352_1897', async () => {
    const exerciseId = await exercise();
    const captureIds = [
      await capture(exerciseId, 'demo-wait05', 'demo', 5),
      await capture(exerciseId, 'demo-wait10', 'demo', 10),
      await capture(exerciseId, 'demo-wait15', 'demo', 15)
    ];
    const stored = await http().get(`/api/captures/${captureIds[0]}`).set('Cookie', cookie).expect(200);
    expect(stored.body.startCueMonoMs).toBe(5000);
    const response = await http().post(`/api/exercises/${exerciseId}/reference-proposals`).set('Cookie', cookie).send({ captureIds }).expect(201);
    expect(response.body[0]).toMatchObject({
      ranges: [
        { captureId: captureIds[0], first: 352, last: 1897 },
        { captureId: captureIds[1], first: 655, last: 2200 },
        { captureId: captureIds[2], first: 978, last: 2523 }
      ],
      sampleCount: 1546,
      ambiguous: false
    });
  });

  it('reference_history_keeps_old_references', async () => {
    await http().put('/api/settings/game-version').set('Cookie', cookie).send({ version: '1.60' }).expect(200);
    const exerciseId = await exercise();
    const first = await reference(exerciseId, await capture(exerciseId, 'demo-wait05'), 352, 1897);
    const exerciseAfterFirst = await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie).expect(200);
    expect(exerciseAfterFirst.body).toMatchObject({ activeReferenceId: first, status: 'ready', step: 2 });
    const second = await reference(exerciseId, await capture(exerciseId, 'demo-wait10'), 655, 2200);
    const history = await http().get(`/api/exercises/${exerciseId}/references`).set('Cookie', cookie).expect(200);
    expect(history.body.map((item: { id: string; active: boolean }) => [item.id, item.active])).toEqual([
      [second, true],
      [first, false]
    ]);
    expect(history.body[1]).toMatchObject({ origin: 'demo', startKind: 'flying', first: 352, last: 1897, gameVersion: '1.60', needsCheck: false });
    await http().post(`/api/references/${first}/activate`).set('Cookie', cookie).expect(201);
    expect((await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie)).body.activeReferenceId).toBe(first);
  });

  it('invalid_range_is_400_with_code', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-wait05');
    const single = await http()
      .post('/api/references')
      .set('Cookie', cookie)
      .send({ exerciseId, captureId, first: 400, last: 400, startKind: 'flying' })
      .expect(400);
    expect(single.body.code).toBe('too-few-points');
    await http().post('/api/references').set('Cookie', cookie).send({ exerciseId, captureId, first: 5000, last: 6000, startKind: 'flying' }).expect(400);
  });

  it('reference_with_another_car_is_409', async () => {
    const licence = await exercise({ catalogueId: 'licence-b-1' });
    const captureId = await capture(licence, 'demo-wait05');
    const response = await http()
      .post('/api/references')
      .set('Cookie', cookie)
      .send({ exerciseId: licence, captureId, first: 352, last: 1897, startKind: 'flying' })
      .expect(409);
    expect(response.body.code).toBe('car-mismatch');
  });

  it('promoted_attempt_becomes_active_reference', async () => {
    const exerciseId = await exercise();
    const demo = await reference(exerciseId, await capture(exerciseId, 'demo-wait05'), 352, 1897);
    const playerCapture = await capture(exerciseId, 'player-run', 'player');
    const aborted = await storedAttempt(exerciseId, playerCapture, demo, 'aborted');
    await http().post(`/api/attempts/${aborted}/promote`).set('Cookie', cookie).expect(409);
    const attempt = await storedAttempt(exerciseId, playerCapture, demo);
    const promoted = await http().post(`/api/attempts/${attempt}/promote`).set('Cookie', cookie).expect(201);
    expect(promoted.body).toMatchObject({ origin: 'attempt', captureId: playerCapture, first: 1162, last: 2786, startKind: 'flying', active: true });
    const history = await http().get(`/api/exercises/${exerciseId}/references`).set('Cookie', cookie).expect(200);
    expect(history.body).toHaveLength(2);
    expect(history.body.find((item: { id: string }) => item.id === demo)).toMatchObject({ active: false, attemptCount: 2 });
  });

  it('delete_reference_with_attempts_is_409', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-wait05');
    const used = await reference(exerciseId, captureId, 352, 1897);
    const unused = await reference(exerciseId, captureId, 352, 1897);
    await storedAttempt(exerciseId, captureId, used);
    const conflict = await http().delete(`/api/references/${used}`).set('Cookie', cookie).expect(409);
    expect(conflict.body.code).toBe('reference-in-use');
    await http().delete(`/api/references/${unused}`).set('Cookie', cookie).expect(200);
    const history = await http().get(`/api/exercises/${exerciseId}/references`).set('Cookie', cookie).expect(200);
    expect(history.body.map((item: { id: string }) => item.id)).toEqual([used]);
    expect((await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie)).body.activeReferenceId).toBeNull();
  });

  it('game_version_change_marks_needs_check', async () => {
    await http().put('/api/settings/game-version').set('Cookie', cookie).send({ version: '1.60' }).expect(200);
    const exerciseId = await exercise();
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-wait05'), 352, 1897);
    await http().put('/api/settings/game-version').set('Cookie', cookie).send({ version: '1.60' }).expect(200);
    expect((await db('references').where({ id: referenceId }).first()).needs_check).toBe(false);
    await http().put('/api/settings/game-version').set('Cookie', cookie).send({ version: '1.61' }).expect(200);
    const history = await http().get(`/api/exercises/${exerciseId}/references`).set('Cookie', cookie).expect(200);
    expect(history.body[0]).toMatchObject({ id: referenceId, needsCheck: true, gameVersion: '1.60' });
    const settings = await http().get('/api/settings').set('Cookie', cookie).expect(200);
    expect(settings.body).toEqual({ ps5Ip: null, gameVersion: '1.61' });
  });

  it('check_with_matching_demo_clears_it', async () => {
    await http().put('/api/settings/game-version').set('Cookie', cookie).send({ version: '1.60' }).expect(200);
    const exerciseId = await exercise();
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-wait05'), 352, 1897);
    await http().put('/api/settings/game-version').set('Cookie', cookie).send({ version: '1.61' }).expect(200);
    const playerCapture = await capture(exerciseId, 'player-run', 'player');
    const mismatch = await http().post(`/api/references/${referenceId}/check`).set('Cookie', cookie).send({ captureId: playerCapture }).expect(201);
    expect(mismatch.body).toMatchObject({ matched: false, range: null, reference: { needsCheck: true } });
    const demoCapture = await capture(exerciseId, 'demo-wait10');
    const match = await http().post(`/api/references/${referenceId}/check`).set('Cookie', cookie).send({ captureId: demoCapture }).expect(201);
    expect(match.body).toMatchObject({ matched: true, range: { first: 655, last: 2200 }, reference: { needsCheck: false, gameVersion: '1.61' } });
  });

  it('reference_cues_have_phrase_target_and_voice', async () => {
    const exerciseId = await exercise();
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-wait05'), 352, 1897);
    await http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ mutedCues: ['throttle@491'] }).expect(200);
    const cues = await http().get(`/api/references/${referenceId}/cues`).set('Cookie', cookie).expect(200);
    expect(cues.body.map((cue: { key: string }) => cue.key)).toEqual([
      'brake@332',
      'throttle@491',
      'brake@677',
      'throttle@737',
      'brake@832',
      'throttle@859',
      'brake@1044'
    ]);
    expect(cues.body[0]).toMatchObject({
      kind: 'brake',
      targetSpeedKph: 85,
      phrase: 'Hard brake. Eighty five',
      voice: 'hard-brake',
      bigStop: true,
      muted: false
    });
    expect(cues.body[0]).not.toHaveProperty('text');
    expect(cues.body[1]).toMatchObject({ phrase: 'Full throttle', voice: 'full-throttle', targetSpeedKph: 95, bigStop: false, muted: true });
    expect(cues.body[2]).toMatchObject({ phrase: 'Brake. One ten', voice: 'brake', bigStop: false });
    await http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ speakTargets: false }).expect(200);
    const quiet = await http().get(`/api/references/${referenceId}/cues`).set('Cookie', cookie).expect(200);
    expect(quiet.body[0]).toMatchObject({ phrase: 'Hard brake', targetSpeedKph: 85 });
  });

  it('speak_targets_and_cue_offsets_are_validated_and_stored', async () => {
    const exerciseId = await exercise();
    const created = await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie).expect(200);
    expect(created.body).toMatchObject({ speakTargets: true, cueOffsetsMs: {} });
    const patch = (body: object) => http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send(body);
    await patch({ cueOffsetsMs: { 'brake@332': 1100 } }).expect(400);
    await patch({ cueOffsetsMs: { 'brake@332': 150 } }).expect(400);
    await patch({ cueOffsetsMs: { 'brake@332': -600 } }).expect(400);
    await patch({ speakTargets: 'yes' }).expect(400);
    const saved = await patch({ speakTargets: false, cueOffsetsMs: { 'brake@332': 300, 'brake@832': -500 } }).expect(200);
    expect(saved.body).toMatchObject({ speakTargets: false, cueOffsetsMs: { 'brake@332': 300, 'brake@832': -500 } });
    const again = await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie).expect(200);
    expect(again.body).toMatchObject({ speakTargets: false, cueOffsetsMs: { 'brake@332': 300, 'brake@832': -500 } });
  });

  it('new_exercise_takes_the_side_cue_distance_from_the_core_default', async () => {
    await db.raw('ALTER TABLE exercises ALTER COLUMN side_cue_distance_m SET DEFAULT 3');
    try {
      const exerciseId = await exercise();
      const created = await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie).expect(200);
      expect(created.body.sideCueDistanceM).toBe(DEFAULT_SIDE_CUE_DISTANCE_M);
    } finally {
      await db.raw(`ALTER TABLE exercises ALTER COLUMN side_cue_distance_m SET DEFAULT ${DEFAULT_SIDE_CUE_DISTANCE_M}`);
    }
  });

  it('side_cue_distance_is_stored_and_validated', async () => {
    const exerciseId = await exercise();
    const created = await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie).expect(200);
    expect(created.body.sideCueDistanceM).toBe(DEFAULT_SIDE_CUE_DISTANCE_M);
    const patch = (sideCueDistanceM: unknown) => http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ sideCueDistanceM });
    for (const rejected of [0.3, 3.5, 1.2, 0, '1']) await patch(rejected).expect(400);
    for (const accepted of [0.5, 3, null]) {
      const saved = await patch(accepted).expect(200);
      expect(saved.body.sideCueDistanceM).toBe(accepted);
      const again = await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie).expect(200);
      expect(again.body.sideCueDistanceM).toBe(accepted);
    }
  });

  it('corners_route_gives_three_yangwang_corners', async () => {
    const exerciseId = await exercise();
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-wait05'), 352, 1897);
    const corners = await http().get(`/api/references/${referenceId}/corners`).set('Cookie', cookie).expect(200);
    expect(corners.body.map((corner: { number: number }) => corner.number)).toEqual([1, 2, 3]);
    const apexes = corners.body.map((corner: { apexSM: number }) => corner.apexSM);
    [519, 737, 870].forEach((apex, index) => expect(Math.abs(apexes[index] - apex)).toBeLessThanOrEqual(5));
    expect(corners.body[0]).toEqual({
      number: 1,
      turnInSM: expect.any(Number),
      apexSM: expect.any(Number),
      radiusM: expect.any(Number),
      apexSpeedKph: expect.any(Number)
    });
    const other = await anotherProfile(app!, cookie, 'Other');
    await http().get(`/api/references/${referenceId}/corners`).set('Cookie', other).expect(404);
  });

  it('reference_path_gives_map_geometry_on_the_review_grid', async () => {
    const exerciseId = await exercise();
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-wait05'), 352, 1897);
    const path = await http().get(`/api/references/${referenceId}/path`).set('Cookie', cookie).expect(200);
    expect(path.body.gridM).toBe(2);
    expect(path.body.lengthM).toBeCloseTo(1092.65, 0);
    const points = Math.floor(path.body.lengthM / 2) + 1;
    expect(path.body.x).toHaveLength(points);
    expect(path.body.z).toHaveLength(points);
    expect(path.body.speedKph).toHaveLength(points);
    expect(Math.max(...path.body.speedKph)).toBeGreaterThan(100);
    expect(path.body.timeMs).toBeGreaterThan(20000);
    const other = await anotherProfile(app!, cookie, 'Other');
    await http().get(`/api/references/${referenceId}/path`).set('Cookie', other).expect(404);
  });

  it('other_profile_gets_404', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-wait05');
    const captureIds = [captureId, await capture(exerciseId, 'demo-wait10')];
    const referenceId = await reference(exerciseId, captureId, 352, 1897);
    const attemptId = await storedAttempt(exerciseId, captureId, referenceId);
    const other = await anotherProfile(app!, cookie, 'Second');
    const otherExercise = await exercise(undefined, other);
    const as = (call: request.Test) => call.set('Cookie', other).expect(404);
    await as(http().get(`/api/exercises/${exerciseId}`));
    await as(http().patch(`/api/exercises/${exerciseId}`).send({ name: 'Mine' }));
    await as(http().post('/api/captures').send({ exerciseId, purpose: 'demo' }));
    await as(http().get(`/api/captures/${captureId}`));
    await as(http().post(`/api/captures/${captureId}/stop`));
    await as(http().post(`/api/exercises/${exerciseId}/reference-proposals`).send({ captureIds }));
    await as(http().post(`/api/exercises/${otherExercise}/reference-proposals`).send({ captureIds }));
    await as(http().post('/api/references').send({ exerciseId, captureId, first: 352, last: 1897, startKind: 'flying' }));
    await as(http().post('/api/references').send({ exerciseId: otherExercise, captureId, first: 352, last: 1897, startKind: 'flying' }));
    await as(http().post(`/api/attempts/${attemptId}/promote`));
    await as(http().get(`/api/exercises/${exerciseId}/references`));
    await as(http().post(`/api/references/${referenceId}/activate`));
    await as(http().delete(`/api/references/${referenceId}`));
    await as(http().post(`/api/references/${referenceId}/check`).send({ captureId }));
    await as(http().get(`/api/references/${referenceId}/cues`));
    await as(http().get(`/api/references/${referenceId}/corners`));
    await as(http().get(`/api/exercises/${exerciseId}/reactions`));
    expect((await http().get('/api/exercises').set('Cookie', other)).body.map((item: { id: string }) => item.id)).toEqual([otherExercise]);
    expect((await http().get('/api/captures').set('Cookie', other)).body).toEqual([]);
    expect((await db('exercises').where({ id: exerciseId }).first()).name).toBe('Racing Lines');
  });

  it('cleanup_keeps_referenced_ranges_and_indices', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-wait05');
    await reference(exerciseId, captureId, 352, 1897);
    const path = await rawPathOf(captureId);
    const before = await rows(path, { first: 352, last: 1897 });
    const sizeBefore = statSync(path).size;
    const use = await http().get('/api/storage').set('Cookie', cookie).expect(200);
    expect(use.body).toMatchObject({ profileCaptures: 1, profileRawBytes: sizeBefore });
    const result = await http().post('/api/storage/cleanup').set('Cookie', cookie).expect(201);
    expect(result.body).toMatchObject({ captures: 1, bytesBefore: sizeBefore });
    expect(result.body.bytesAfter).toBeLessThan(sizeBefore);
    const after = await rows(path);
    expect(after).toEqual(before);
    expect(after.map(row => row.rawIndex)).toEqual(before.map(row => row.rawIndex));
    expect(statSync(path).size).toBe(result.body.bytesAfter);
  });

  it('invalid_ip_is_400', async () => {
    await http().put('/api/settings/connection').set('Cookie', cookie).send({ ps5Ip: '999.1.1.1' }).expect(400);
    await http().put('/api/settings/connection').set('Cookie', cookie).send({ ps5Ip: 'console.local' }).expect(400);
    await http().put('/api/settings/connection').set('Cookie', cookie).send({ ps5Ip: '10.0.0.7' }).expect(200);
    expect((await http().get('/api/settings').set('Cookie', cookie)).body.ps5Ip).toBe('10.0.0.7');
    await http().put('/api/settings/connection').send({ ps5Ip: '10.0.0.8' }).expect(401);
  });
});
