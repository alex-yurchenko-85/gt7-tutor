import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readRaw } from '@gt7/capture';
import { DEFAULT_SIDE_CUE_DISTANCE_M } from '@gt7/core';
import type { RawDatagram } from '@gt7/contracts';
import { COUNTDOWN_SCHEDULER, type CountdownScheduler } from '../src/captures/countdown.js';
import { TELEMETRY_SOURCE_FACTORY } from '../src/captures/telemetry-source.factory.js';
import { createTestApp } from './support/app.js';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';
import { openLive, type LiveConnection } from './support/live.js';
import { tempDir } from './support/process.js';
import { FixtureReplays, fixturePath } from './support/replay-sources.js';
import { anotherProfile, firstProfile } from './support/session.js';

type Scheduled = { ms: number; run: () => void; cancelled: boolean };

class ManualScheduler implements CountdownScheduler {
  readonly scheduled: Scheduled[] = [];

  after(ms: number, run: () => void): () => void {
    const entry: Scheduled = { ms, run, cancelled: false };
    this.scheduled.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }

  runAll(): void {
    for (const entry of [...this.scheduled].sort((left, right) => left.ms - right.ms)) if (!entry.cancelled) entry.run();
  }
}

const INTERLAGOS_TARGETS = { goldMs: 16400, silverMs: 16700, bronzeMs: 17800 };

const CLEAN_ATTEMPT = { first: 381, last: 1409 };

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
  let scheduler: ManualScheduler;
  const sockets: LiveConnection[] = [];
  const http = () => request(app!.getHttpServer());

  async function start(env: Record<string, string> = {}) {
    await app?.close();
    scheduler = new ManualScheduler();
    app = await createTestApp(database.url, {
      env: { DATA_DIR: dataDir, TELEMETRY_SOURCE: 'replay', ...env },
      override: builder =>
        builder.overrideProvider(TELEMETRY_SOURCE_FACTORY).useValue(replays.factory).overrideProvider(COUNTDOWN_SCHEDULER).useValue(scheduler)
    });
  }

  async function voiceDevice(): Promise<LiveConnection> {
    await app!.listen(0, '127.0.0.1');
    const port = (app!.getHttpServer().address() as { port: number }).port;
    const connection = await openLive(port, cookie);
    sockets.push(connection);
    connection.send({ type: 'claim-voice', deviceId: 'phone', ready: true });
    await connection.waitFor('state', message => message.state.voiceDeviceId === 'phone');
    return connection;
  }

  async function startDemo(exerciseId: string, startAfterS?: number): Promise<string> {
    replays.queue.push('demo-a');
    const body = startAfterS === undefined ? { exerciseId, purpose: 'demo' } : { exerciseId, purpose: 'demo', startAfterS };
    const started = await http().post('/api/captures').set('Cookie', cookie).send(body).expect(201);
    await replays.finished();
    return started.body.id as string;
  }

  async function settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  async function exercise(body: object = { catalogueId: 'ce-autodromo-de-interlagos' }, session = cookie): Promise<string> {
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

  async function storedAttempt(exerciseId: string, captureId: string, referenceId: string, completion = 'complete', range = CLEAN_ATTEMPT): Promise<string> {
    const [row] = await db('attempts')
      .insert({
        exercise_id: exerciseId,
        capture_id: captureId,
        reference_id: referenceId,
        first_raw_index: range.first,
        last_raw_index: range.last,
        mode: 'baseline',
        completion,
        measured_ms: completion === 'complete' ? 17100 : null,
        game_ms: completion === 'complete' ? 17071 : null,
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
    for (const socket of sockets.splice(0)) await socket.close();
    await app?.close();
    app = null;
  });

  it('exercise_from_catalogue_copies_targets_and_car', async () => {
    const interlagos = await http().get(`/api/exercises/${await exercise()}`).set('Cookie', cookie).expect(200);
    expect(interlagos.body).toMatchObject({ family: 'Circuit Experience', carId: 1905, targets: {}, status: 'new', step: 1, mutedCues: [], activeReferenceId: null });
    const targets = await http().patch(`/api/exercises/${interlagos.body.id}`).set('Cookie', cookie).send({ targets: INTERLAGOS_TARGETS }).expect(200);
    expect(targets.body.targets).toEqual(INTERLAGOS_TARGETS);
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
    const captureId = await capture(await exercise(), 'ce-clean', 'player');
    const stored = await http().get(`/api/captures/${captureId}`).set('Cookie', cookie).expect(200);
    expect(stored.body).toMatchObject({ purpose: 'player', complete: true, packets: 1631, errorReason: null, active: false });
    expect(stored.body.endedAt).toEqual(expect.any(String));
    const written = await rows(await rawPathOf(captureId));
    const original = await rows(fixturePath('ce-clean'));
    expect(written.map(row => row.rawIndex)).toEqual(original.map((_, index) => index));
    expect(written.map(row => row.payloadBase64)).toEqual(original.map(row => row.payloadBase64));
    expect(written.every(row => row.captureId === captureId)).toBe(true);
    const listed = await http().get('/api/captures').set('Cookie', cookie).expect(200);
    expect(listed.body.map((item: { id: string }) => item.id)).toEqual([captureId]);
  });

  it('second_capture_conflicts_409', async () => {
    const exerciseId = await exercise();
    replays.queue.push('ce-clean', 'ce-clean');
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
    replays.queue.push('demo-a');
    const started = await http().post('/api/captures').set('Cookie', cookie).send({ exerciseId, purpose: 'demo' }).expect(201);
    expect(replays.requests.at(-1)).toEqual({ ps5Ip: '10.0.0.7' });
    await replays.finished();
    await http().post(`/api/captures/${started.body.id}/stop`).set('Cookie', cookie).expect(201);
  });

  it('open_capture_is_marked_incomplete_at_start', async () => {
    const exerciseId = await exercise();
    const user = await db('users').first();
    mkdirSync(join(dataDir, 'raw'), { recursive: true });
    const text = readFileSync(fixturePath('demo-a'), 'utf8');
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

  it('three_demo_captures_propose_the_demonstration', async () => {
    const exerciseId = await exercise();
    const captureIds = [
      await capture(exerciseId, 'demo-a', 'demo', 5),
      await capture(exerciseId, 'demo-b', 'demo', 10),
      await capture(exerciseId, 'demo-c', 'demo', 15)
    ];
    const stored = await http().get(`/api/captures/${captureIds[0]}`).set('Cookie', cookie).expect(200);
    expect(stored.body.startCueMonoMs).toBe(5000);
    const response = await http().post(`/api/exercises/${exerciseId}/reference-proposals`).set('Cookie', cookie).send({ captureIds }).expect(201);
    expect(response.body[0]).toMatchObject({
      ranges: [
        { captureId: captureIds[0], first: 457, last: 1422 },
        { captureId: captureIds[1], first: 738, last: 1703 },
        { captureId: captureIds[2], first: 1054, last: 2019 }
      ],
      sampleCount: 966,
      ambiguous: false
    });
    expect(response.body).toHaveLength(1);
  });

  it('proposals_exclude_untimed_candidates', async () => {
    const exerciseId = await exercise();
    const captureIds = [
      await capture(exerciseId, 'ce-off-track-reset'),
      await capture(exerciseId, 'ce-off-track-reset'),
      await capture(exerciseId, 'ce-off-track-reset')
    ];
    const response = await http().post(`/api/exercises/${exerciseId}/reference-proposals`).set('Cookie', cookie).send({ captureIds }).expect(201);
    expect(response.body).toEqual([]);
  });

  it('reference_history_keeps_old_references', async () => {
    await http().put('/api/settings/game-version').set('Cookie', cookie).send({ version: '1.60' }).expect(200);
    const exerciseId = await exercise();
    const first = await reference(exerciseId, await capture(exerciseId, 'demo-a'), 457, 1422);
    const exerciseAfterFirst = await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie).expect(200);
    expect(exerciseAfterFirst.body).toMatchObject({ activeReferenceId: first, status: 'ready', step: 2 });
    const second = await reference(exerciseId, await capture(exerciseId, 'demo-b'), 738, 1703);
    const history = await http().get(`/api/exercises/${exerciseId}/references`).set('Cookie', cookie).expect(200);
    expect(history.body.map((item: { id: string; active: boolean }) => [item.id, item.active])).toEqual([
      [second, true],
      [first, false]
    ]);
    expect(history.body[1]).toMatchObject({ origin: 'demo', startKind: 'flying', first: 457, last: 1422, gameVersion: '1.60', needsCheck: false });
    await http().post(`/api/references/${first}/activate`).set('Cookie', cookie).expect(201);
    expect((await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie)).body.activeReferenceId).toBe(first);
  });

  it('hand_range_is_cut_to_the_timer_run', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-a');
    const created = await http()
      .post('/api/references')
      .set('Cookie', cookie)
      .send({ exerciseId, captureId, first: 300, last: 1700, startKind: 'flying' })
      .expect(201);
    expect(created.body).toMatchObject({ captureId, first: 457, last: 1422, origin: 'demo', active: true });
    const stored = await db('references').where({ id: created.body.id }).first();
    expect([stored.first_raw_index, stored.last_raw_index]).toEqual([457, 1422]);
    const path = await http().get(`/api/references/${created.body.id}/path`).set('Cookie', cookie).expect(200);
    expect(path.body.timeMs).toBe(16082);
  });

  it('hand_range_without_a_timer_run_is_refused', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-a');
    for (const [first, last] of [
      [0, 300],
      [300, 1421],
      [400, 400],
      [5000, 6000]
    ]) {
      const refused = await http()
        .post('/api/references')
        .set('Cookie', cookie)
        .send({ exerciseId, captureId, first, last, startKind: 'flying' })
        .expect(400);
      expect(refused.body).toEqual({ code: 'no-timer-run', reason: expect.any(String) });
    }
    expect(await db('references').where({ exercise_id: exerciseId })).toEqual([]);
  });

  it('reference_with_another_car_is_409', async () => {
    const licence = await exercise({ catalogueId: 'licence-b-1' });
    const captureId = await capture(licence, 'demo-a');
    const response = await http()
      .post('/api/references')
      .set('Cookie', cookie)
      .send({ exerciseId: licence, captureId, first: 457, last: 1422, startKind: 'flying' })
      .expect(409);
    expect(response.body.code).toBe('car-mismatch');
  });

  it('promoted_attempt_becomes_active_reference', async () => {
    const exerciseId = await exercise();
    const demo = await reference(exerciseId, await capture(exerciseId, 'demo-a'), 457, 1422);
    const playerCapture = await capture(exerciseId, 'ce-clean', 'player');
    const attempt = await storedAttempt(exerciseId, playerCapture, demo);
    const promoted = await http().post(`/api/attempts/${attempt}/promote`).set('Cookie', cookie).expect(201);
    expect(promoted.body).toMatchObject({ origin: 'attempt', captureId: playerCapture, first: 381, last: 1406, startKind: 'flying', active: true });
    const history = await http().get(`/api/exercises/${exerciseId}/references`).set('Cookie', cookie).expect(200);
    expect(history.body).toHaveLength(2);
    expect(history.body.find((item: { id: string }) => item.id === demo)).toMatchObject({ active: false, attemptCount: 1 });
  });

  it('promote_uses_the_game_time', async () => {
    const exerciseId = await exercise();
    const demo = await reference(exerciseId, await capture(exerciseId, 'demo-a'), 457, 1422);
    const playerCapture = await capture(exerciseId, 'ce-clean', 'player');
    const attempt = await storedAttempt(exerciseId, playerCapture, demo);
    const promoted = await http().post(`/api/attempts/${attempt}/promote`).set('Cookie', cookie).expect(201);
    const path = await http().get(`/api/references/${promoted.body.id}/path`).set('Cookie', cookie).expect(200);
    const { game_ms: gameMs } = await db('attempts').where({ id: attempt }).first();
    expect(gameMs).toBe(17071);
    expect(path.body.timeMs).toBe(gameMs);
  });

  it('promote_refuses_an_attempt_without_a_game_time', async () => {
    const exerciseId = await exercise();
    const demo = await reference(exerciseId, await capture(exerciseId, 'demo-a'), 457, 1422);
    const playerCapture = await capture(exerciseId, 'ce-clean', 'player');
    const aborted = await storedAttempt(exerciseId, playerCapture, demo, 'aborted');
    const untimed = await storedAttempt(exerciseId, playerCapture, demo);
    await db('attempts').where({ id: untimed }).update({ game_ms: null });
    for (const attempt of [aborted, untimed]) {
      const refused = await http().post(`/api/attempts/${attempt}/promote`).set('Cookie', cookie).expect(409);
      expect(refused.body).toEqual({ code: 'no-game-time', reason: expect.any(String) });
    }
    const history = await http().get(`/api/exercises/${exerciseId}/references`).set('Cookie', cookie).expect(200);
    expect(history.body.map((item: { id: string }) => item.id)).toEqual([demo]);
  });

  it('exercise_counts_all_attempts_and_references', async () => {
    const exerciseId = await exercise();
    const empty = await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie).expect(200);
    expect(empty.body).toMatchObject({ attemptCount: 0, referenceCount: 0 });
    const captureId = await capture(exerciseId, 'demo-a');
    const first = await reference(exerciseId, captureId, 457, 1422);
    await reference(exerciseId, captureId, 457, 1422);
    await storedAttempt(exerciseId, captureId, first);
    await storedAttempt(exerciseId, captureId, first, 'aborted');
    const listed = await http().get('/api/exercises').set('Cookie', cookie).expect(200);
    expect(listed.body[0]).toMatchObject({ attemptCount: 2, completeAttempts: 1, referenceCount: 2 });
  });

  it('best_time_is_the_lowest_game_time', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-a');
    const referenceId = await reference(exerciseId, captureId, 457, 1422);
    const attemptId = await storedAttempt(exerciseId, captureId, referenceId);
    const faster = await storedAttempt(exerciseId, captureId, referenceId);
    await db('attempts').where({ id: faster }).update({ game_ms: 16950, measured_ms: 17200 });
    const aborted = await storedAttempt(exerciseId, captureId, referenceId, 'aborted');
    await db('attempts').where({ id: aborted }).update({ game_ms: 15000 });
    const body = (await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie).expect(200)).body;
    expect(body.bestMs).toBe(16950);
    expect(body).not.toHaveProperty('bestMeasuredMs');
  });

  it('delete_reference_with_attempts_is_409', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-a');
    const used = await reference(exerciseId, captureId, 457, 1422);
    const unused = await reference(exerciseId, captureId, 457, 1422);
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
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-a'), 457, 1422);
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
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-a'), 457, 1422);
    await http().put('/api/settings/game-version').set('Cookie', cookie).send({ version: '1.61' }).expect(200);
    const playerCapture = await capture(exerciseId, 'ce-clean', 'player');
    const mismatch = await http().post(`/api/references/${referenceId}/check`).set('Cookie', cookie).send({ captureId: playerCapture }).expect(201);
    expect(mismatch.body).toMatchObject({ matched: false, range: null, reference: { needsCheck: true } });
    const demoCapture = await capture(exerciseId, 'demo-b');
    const match = await http().post(`/api/references/${referenceId}/check`).set('Cookie', cookie).send({ captureId: demoCapture }).expect(201);
    expect(match.body).toMatchObject({ matched: true, range: { first: 737, last: 1704 }, reference: { needsCheck: false, gameVersion: '1.61' } });
  });

  it('reference_cues_have_phrase_target_and_voice', async () => {
    const exerciseId = await exercise();
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-a'), 457, 1422);
    await http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ mutedCues: ['throttle@411'] }).expect(200);
    const cues = await http().get(`/api/references/${referenceId}/cues`).set('Cookie', cookie).expect(200);
    expect(cues.body.map((cue: { key: string }) => cue.key)).toEqual([
      'brake@291',
      'throttle@411',
      'ease-off@564',
      'throttle@568',
      'ease-off@792',
      'throttle@796'
    ]);
    expect(cues.body[0]).toMatchObject({
      kind: 'brake',
      targetSpeedKph: 115,
      phrase: 'Hard brake. One fifteen',
      voice: 'hard-brake',
      bigStop: true,
      muted: false
    });
    expect(cues.body[0]).not.toHaveProperty('text');
    expect(cues.body[1]).toMatchObject({ phrase: 'Full throttle', voice: 'full-throttle', targetSpeedKph: 140, bigStop: false, muted: true });
    expect(cues.body[2]).toMatchObject({ phrase: 'Ease off', voice: 'ease-off', targetSpeedKph: null, bigStop: false, muted: false });
    await http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ speakTargets: false }).expect(200);
    const quiet = await http().get(`/api/references/${referenceId}/cues`).set('Cookie', cookie).expect(200);
    expect(quiet.body[0]).toMatchObject({ phrase: 'Hard brake', targetSpeedKph: 115 });
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

  it('corners_route_gives_the_interlagos_corner', async () => {
    const exerciseId = await exercise();
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-a'), 457, 1422);
    const corners = await http().get(`/api/references/${referenceId}/corners`).set('Cookie', cookie).expect(200);
    expect(corners.body.map((corner: { number: number }) => corner.number)).toEqual([1]);
    expect(Math.abs(corners.body[0].apexSM - 404)).toBeLessThanOrEqual(5);
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
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-a'), 457, 1422);
    const path = await http().get(`/api/references/${referenceId}/path`).set('Cookie', cookie).expect(200);
    expect(path.body.gridM).toBe(2);
    expect(path.body.lengthM).toBeCloseTo(818.17, 0);
    const points = Math.floor(path.body.lengthM / 2) + 1;
    expect(path.body.x).toHaveLength(points);
    expect(path.body.z).toHaveLength(points);
    expect(path.body.speedKph).toHaveLength(points);
    expect(Math.max(...path.body.speedKph)).toBeGreaterThan(100);
    expect(path.body.timeMs).toBe(16082);
    const other = await anotherProfile(app!, cookie, 'Other');
    await http().get(`/api/references/${referenceId}/path`).set('Cookie', other).expect(404);
  });

  it('other_profile_gets_404', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-a');
    const captureIds = [captureId, await capture(exerciseId, 'demo-b')];
    const referenceId = await reference(exerciseId, captureId, 457, 1422);
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
    await as(http().post('/api/references').send({ exerciseId, captureId, first: 457, last: 1422, startKind: 'flying' }));
    await as(http().post('/api/references').send({ exerciseId: otherExercise, captureId, first: 457, last: 1422, startKind: 'flying' }));
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
    expect((await db('exercises').where({ id: exerciseId }).first()).name).toBe('Autódromo de Interlagos');
  });

  it('cleanup_keeps_referenced_ranges_and_indices', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-a');
    await reference(exerciseId, captureId, 457, 1422);
    const path = await rawPathOf(captureId);
    const before = await rows(path, { first: 0, last: 1422 });
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

  it('review_times_stay_the_same_after_cleanup', async () => {
    const exerciseId = await exercise();
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-a'), 457, 1422);
    const runCapture = await capture(exerciseId, 'demo-c', 'player');
    const attemptId = await storedAttempt(exerciseId, runCapture, referenceId, 'complete', { first: 1054, last: 2019 });
    const review = async () => (await http().get(`/api/attempts/${attemptId}/review`).set('Cookie', cookie).expect(200)).body;
    const before = await review();
    await http().post('/api/storage/cleanup').set('Cookie', cookie).expect(201);
    expect((await rows(await rawPathOf(runCapture)))[0]!.rawIndex).toBe(454);
    await start();
    const after = await review();
    expect(after.attempt.t).toHaveLength(before.attempt.t.length);
    after.attempt.t.forEach((value: number | null, index: number) => {
      const old = before.attempt.t[index] as number | null;
      if (old === null) expect(value).toBeNull();
      else expect(Math.abs(value! - old)).toBeLessThan(0.01);
    });
  });

  it('invalid_ip_is_400', async () => {
    await http().put('/api/settings/connection').set('Cookie', cookie).send({ ps5Ip: '999.1.1.1' }).expect(400);
    await http().put('/api/settings/connection').set('Cookie', cookie).send({ ps5Ip: 'console.local' }).expect(400);
    await http().put('/api/settings/connection').set('Cookie', cookie).send({ ps5Ip: '10.0.0.7' }).expect(200);
    expect((await http().get('/api/settings').set('Cookie', cookie)).body.ps5Ip).toBe('10.0.0.7');
    await http().put('/api/settings/connection').send({ ps5Ip: '10.0.0.8' }).expect(401);
  });

  it('demo_capture_with_wait_sends_countdown_cues_to_the_voice_device', async () => {
    const voice = await voiceDevice();
    const captureId = await startDemo(await exercise(), 5);
    expect(scheduler.scheduled.map(entry => entry.ms)).toEqual([2000, 3000, 4000, 5000]);
    scheduler.runAll();
    await voice.waitFor('cue', message => message.cue.clip === 'countdown-start');
    const cues = voice.of('cue').map(message => message.cue);
    expect(cues.map(cue => cue.clip)).toEqual(['countdown-three', 'countdown-two', 'countdown-one', 'countdown-start']);
    expect(cues.map(cue => cue.eventKey)).toEqual([3, 2, 1, 0].map(n => `countdown-${captureId}-${n}`));
    for (const cue of cues) {
      expect(cue).toMatchObject({ kind: 'countdown', ttlMs: 800, followClip: null, targetSpeedKph: null });
      expect(cue.priority).toBeGreaterThan(100);
      expect(cue.generation).toBeGreaterThan(0);
    }
    expect(new Set(cues.map(cue => cue.id)).size).toBe(4);
    await http().post(`/api/captures/${captureId}/stop`).set('Cookie', cookie).expect(201);
  });

  it('short_wait_skips_the_counts_before_the_start', async () => {
    await voiceDevice();
    const captureId = await startDemo(await exercise(), 2);
    expect(scheduler.scheduled.map(entry => entry.ms)).toEqual([0, 1000, 2000]);
    await http().post(`/api/captures/${captureId}/stop`).set('Cookie', cookie).expect(201);
  });

  it('stopping_capture_cancels_countdown', async () => {
    const voice = await voiceDevice();
    const captureId = await startDemo(await exercise(), 5);
    await http().post(`/api/captures/${captureId}/stop`).set('Cookie', cookie).expect(201);
    expect(scheduler.scheduled.every(entry => entry.cancelled)).toBe(true);
    scheduler.runAll();
    await settle();
    expect(voice.of('cue')).toEqual([]);
  });

  it('capture_without_wait_sends_no_countdown', async () => {
    const voice = await voiceDevice();
    const captureId = await startDemo(await exercise());
    expect(scheduler.scheduled).toEqual([]);
    await http().post(`/api/captures/${captureId}/stop`).set('Cookie', cookie).expect(201);
    await settle();
    expect(voice.of('cue')).toEqual([]);
  });
});
