import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readRaw, readSamples } from '@gt7/capture';
import { DEFAULT_CONFIG, DEFAULT_SIDE_CUE_DISTANCE_M, analyseReference, clipsOf, type ReferenceAnalysis } from '@gt7/core';
import { KPH_PER_MPS, type RawDatagram } from '@gt7/contracts';
import { cornerInfos } from '../src/references/references.service.js';
import { KNEX } from '../src/storage/knex.provider.js';
import { CLEAN_ATTEMPT, DEMONSTRATION, INTERLAGOS_TARGETS, TestApi, createReplayApp, insertAttempt, rawPathOf, type Range } from './support/api.js';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';
import { listen, openLive, type LiveConnection } from './support/live.js';
import { testTempDir } from '../../../tools/testing/temp-root.js';
import type { FixtureReplays } from './support/replay-sources.js';
import { fixturePath } from '../../../tools/testing/fixture-path.js';
import { anotherProfile, firstProfile } from './support/session.js';

async function demonstrationAnalysis(): Promise<ReferenceAnalysis> {
  return analyseReference(await readSamples(fixturePath('demo-a'), DEMONSTRATION), DEFAULT_CONFIG);
}

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
  const sockets: LiveConnection[] = [];
  const api = new TestApi(() => app!, () => replays, () => cookie);
  const http = () => api.http();
  const exercise = api.exercise.bind(api);
  const capture = api.capture.bind(api);

  async function start(env: Record<string, string> = {}) {
    await app?.close();
    ({ app, replays } = await createReplayApp(database.url, { dataDir, env }));
  }

  async function voiceDevice(): Promise<LiveConnection> {
    const connection = await openLive(await listen(app!), cookie);
    sockets.push(connection);
    connection.send({ type: 'claim-voice', deviceId: 'phone', ready: true });
    await connection.waitFor('state', message => message.state.voiceDeviceId === 'phone');
    return connection;
  }

  async function startDemo(exerciseId: string): Promise<string> {
    replays.queue.push('demo-a');
    const started = await http().post('/api/captures').set('Cookie', cookie).send({ exerciseId, purpose: 'demo' }).expect(201);
    await replays.finished();
    return started.body.id as string;
  }

  async function settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  async function storedCapture(id: string): Promise<{ body: Record<string, unknown> }> {
    const listed = await http().get('/api/captures').set('Cookie', cookie).expect(200);
    return { body: listed.body.find((entry: { id: string }) => entry.id === id) };
  }

  async function reference(exerciseId: string, captureId: string, range: Range = DEMONSTRATION): Promise<string> {
    return api.reference(exerciseId, captureId, range);
  }

  async function storedAttempt(exerciseId: string, captureId: string, referenceId: string, completion: 'complete' | 'aborted' = 'complete', range = CLEAN_ATTEMPT): Promise<string> {
    return insertAttempt(db, { exerciseId, captureId, referenceId, completion, range });
  }

  async function rawPath(captureId: string): Promise<string> {
    return rawPathOf(db, dataDir, captureId);
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
    dataDir = testTempDir('gt7-server-');
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
    await db('exercises').where({ id: interlagos.body.id }).update({ targets: JSON.stringify(INTERLAGOS_TARGETS) });
    const targets = await http().get(`/api/exercises/${interlagos.body.id}`).set('Cookie', cookie).expect(200);
    expect(targets.body.targets).toEqual(INTERLAGOS_TARGETS);
    const licence = await http().post('/api/exercises').set('Cookie', cookie).send({ catalogueId: 'licence-b-1' }).expect(201);
    expect(licence.body.targets).toEqual({ bronzeMs: 22800, silverMs: 21400, goldMs: 20800 });
    const own = await http()
      .post('/api/exercises')
      .set('Cookie', cookie)
      .send({ family: 'Time Trial', name: 'Tsukuba lap' })
      .expect(201);
    expect(own.body).toMatchObject({ catalogueId: null, targets: {}, carId: null });
    const patched = await http()
      .patch(`/api/exercises/${own.body.id}`)
      .set('Cookie', cookie)
      .send({ mutedCues: ['brake@332'] })
      .expect(200);
    expect(patched.body).toMatchObject({ mutedCues: ['brake@332'] });
    await http().post('/api/exercises').set('Cookie', cookie).send({ catalogueId: 'no-such-entry' }).expect(404);
    const listed = await http().get('/api/exercises').set('Cookie', cookie).expect(200);
    expect(listed.body).toHaveLength(3);
  });

  it('capture_from_replay_is_stored_and_complete', async () => {
    const captureId = await capture(await exercise(), 'ce-clean', 'player');
    const stored = await storedCapture(captureId);
    expect(stored.body).toMatchObject({ purpose: 'player', complete: true, packets: 1631, errorReason: null, active: false });
    expect(stored.body.endedAt).toEqual(expect.any(String));
    const written = await rows(await rawPath(captureId));
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
    const stored = await storedCapture(row.id);
    expect(stored.body).toMatchObject({ complete: false, errorReason: 'interrupted', packets: 100, active: false });
    expect(stored.body.endedAt).toEqual(expect.any(String));
    expect((await rows(join(dataDir, 'raw', 'interrupted.ndjson'))).map(item => item.rawIndex)).toEqual([...Array(100).keys()]);
  });

  it('one_demo_capture_proposes_its_timer_run', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-a', 'demo');
    const stored = await storedCapture(captureId);
    expect(Object.keys(stored.body).sort()).toEqual(['active', 'complete', 'endedAt', 'errorReason', 'exerciseId', 'id', 'packets', 'purpose', 'startedAt']);
    const response = await http().post(`/api/exercises/${exerciseId}/reference-proposals`).set('Cookie', cookie).send({ captureIds: [captureId] }).expect(201);
    expect(response.body).toEqual([
      { ranges: [{ captureId, first: 457, last: 1422 }], sampleCount: 966, ambiguous: false, evidence: ['Timer runs 16.082 s'], timeMs: 16082 }
    ]);
  });

  it('one_capture_without_a_demonstration_run_gives_no_proposal', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'ce-clean', 'demo');
    const response = await http().post(`/api/exercises/${exerciseId}/reference-proposals`).set('Cookie', cookie).send({ captureIds: [captureId] }).expect(201);
    expect(response.body).toEqual([]);
  });

  it('two_demo_captures_check_that_the_run_repeats', async () => {
    const exerciseId = await exercise();
    const captureIds = [await capture(exerciseId, 'demo-a', 'demo'), await capture(exerciseId, 'demo-b', 'demo')];
    const response = await http().post(`/api/exercises/${exerciseId}/reference-proposals`).set('Cookie', cookie).send({ captureIds }).expect(201);
    expect(response.body[0]).toMatchObject({
      ranges: [
        { captureId: captureIds[0], first: 457, last: 1422 },
        { captureId: captureIds[1], first: 738, last: 1703 }
      ],
      sampleCount: 966,
      ambiguous: true,
      timeMs: 16082
    });
  });

  it('proposals_take_one_or_two_captures', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-a', 'demo');
    for (const captureIds of [[], [captureId, captureId, captureId]]) {
      await http().post(`/api/exercises/${exerciseId}/reference-proposals`).set('Cookie', cookie).send({ captureIds }).expect(400);
    }
  });

  it('proposals_exclude_untimed_candidates', async () => {
    const exerciseId = await exercise();
    const captureIds = [await capture(exerciseId, 'ce-off-track-reset'), await capture(exerciseId, 'ce-off-track-reset')];
    const response = await http().post(`/api/exercises/${exerciseId}/reference-proposals`).set('Cookie', cookie).send({ captureIds }).expect(201);
    expect(response.body).toEqual([]);
  });

  it('reference_history_keeps_old_references', async () => {
    await http().put('/api/settings/game-version').set('Cookie', cookie).send({ version: '1.60' }).expect(200);
    const exerciseId = await exercise();
    const first = await reference(exerciseId, await capture(exerciseId, 'demo-a'));
    const exerciseAfterFirst = await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie).expect(200);
    expect(exerciseAfterFirst.body).toMatchObject({ activeReferenceId: first, status: 'ready', step: 2 });
    const second = await reference(exerciseId, await capture(exerciseId, 'demo-b'), { first: 738, last: 1703 });
    const history = await http().get(`/api/exercises/${exerciseId}/references`).set('Cookie', cookie).expect(200);
    expect(history.body.map((item: { id: string; active: boolean }) => [item.id, item.active])).toEqual([
      [second, true],
      [first, false]
    ]);
    expect(history.body[1]).toMatchObject({ origin: 'demo', first: 457, last: 1422, gameVersion: '1.60', needsCheck: false });
    await http().post(`/api/references/${first}/activate`).set('Cookie', cookie).expect(201);
    expect((await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie)).body.activeReferenceId).toBe(first);
  });

  it('hand_range_is_cut_to_the_timer_run', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-a');
    const created = await http()
      .post('/api/references')
      .set('Cookie', cookie)
      .send({ exerciseId, captureId, first: 300, last: 1700 })
      .expect(201);
    expect(created.body).toMatchObject({ captureId, first: 457, last: 1422, origin: 'demo', active: true });
    const stored = await db('references').where({ id: created.body.id }).first();
    expect([stored.first_raw_index, stored.last_raw_index, stored.timer_ms]).toEqual([457, 1422, 16082]);
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
        .send({ exerciseId, captureId, first, last })
        .expect(400);
      expect(refused.body).toEqual({ code: 'no-timer-run', reason: 'The range does not hold the whole demonstration.' });
    }
    expect(await db('references').where({ exercise_id: exerciseId })).toEqual([]);
  });

  it('reference_with_another_car_is_409', async () => {
    const licence = await exercise({ catalogueId: 'licence-b-1' });
    const captureId = await capture(licence, 'demo-a');
    const response = await http()
      .post('/api/references')
      .set('Cookie', cookie)
      .send({ exerciseId: licence, captureId, first: 457, last: 1422 })
      .expect(409);
    expect(response.body.code).toBe('car-mismatch');
  });

  it('promoted_attempt_becomes_active_reference_with_its_game_time', async () => {
    const exerciseId = await exercise();
    const demo = await reference(exerciseId, await capture(exerciseId, 'demo-a'));
    const playerCapture = await capture(exerciseId, 'ce-clean', 'player');
    const attempt = await storedAttempt(exerciseId, playerCapture, demo);
    const promoted = await http().post(`/api/attempts/${attempt}/promote`).set('Cookie', cookie).expect(201);
    expect(promoted.body).toMatchObject({ origin: 'attempt', captureId: playerCapture, first: 381, last: 1406, active: true });
    const history = await http().get(`/api/exercises/${exerciseId}/references`).set('Cookie', cookie).expect(200);
    expect(history.body).toHaveLength(2);
    expect(history.body.find((item: { id: string }) => item.id === demo)).toMatchObject({ active: false, attemptCount: 1 });
    expect((await db('references').where({ id: promoted.body.id }).first()).timer_ms).toBe(17071);
    const path = await http().get(`/api/references/${promoted.body.id}/path`).set('Cookie', cookie).expect(200);
    expect(path.body.timeMs).toBe(17071);
  });

  it('reference_without_a_stored_timer_gets_it_on_the_first_read', async () => {
    const exerciseId = await exercise();
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-a'));
    await db('references').where({ id: referenceId }).update({ timer_ms: null });
    await start();
    const path = await http().get(`/api/references/${referenceId}/path`).set('Cookie', cookie).expect(200);
    expect(path.body.timeMs).toBe(16082);
    expect((await db('references').where({ id: referenceId }).first()).timer_ms).toBe(16082);
  });

  it('reference_time_reads_the_stored_timer_value', async () => {
    const exerciseId = await exercise();
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-a'));
    await db('references').where({ id: referenceId }).update({ timer_ms: 16000 });
    await start();
    const path = await http().get(`/api/references/${referenceId}/path`).set('Cookie', cookie).expect(200);
    expect(path.body.timeMs).toBe(16000);
    const attempt = await storedAttempt(exerciseId, await capture(exerciseId, 'ce-clean', 'player'), referenceId);
    const review = await http().get(`/api/attempts/${attempt}/review`).set('Cookie', cookie).expect(200);
    expect(review.body.referenceTimeMs).toBe(16000);
  });

  it('promote_refuses_an_aborted_attempt', async () => {
    const exerciseId = await exercise();
    const demo = await reference(exerciseId, await capture(exerciseId, 'demo-a'));
    const playerCapture = await capture(exerciseId, 'ce-clean', 'player');
    const aborted = await storedAttempt(exerciseId, playerCapture, demo, 'aborted');
    const refused = await http().post(`/api/attempts/${aborted}/promote`).set('Cookie', cookie).expect(409);
    expect(refused.body).toEqual({ code: 'not-complete', reason: 'Only a complete attempt can become a reference.' });
    const history = await http().get(`/api/exercises/${exerciseId}/references`).set('Cookie', cookie).expect(200);
    expect(history.body.map((item: { id: string }) => item.id)).toEqual([demo]);
  });

  it('exercise_counts_all_attempts_and_references', async () => {
    const exerciseId = await exercise();
    const empty = await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie).expect(200);
    expect(empty.body).toMatchObject({ attemptCount: 0, referenceCount: 0 });
    const captureId = await capture(exerciseId, 'demo-a');
    const first = await reference(exerciseId, captureId);
    await reference(exerciseId, captureId);
    await storedAttempt(exerciseId, captureId, first);
    await storedAttempt(exerciseId, captureId, first, 'aborted');
    const listed = await http().get('/api/exercises').set('Cookie', cookie).expect(200);
    expect(listed.body[0]).toMatchObject({ attemptCount: 2, completeAttempts: 1, referenceCount: 2 });
  });

  it('best_time_is_the_lowest_game_time', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-a');
    const referenceId = await reference(exerciseId, captureId);
    const attemptId = await storedAttempt(exerciseId, captureId, referenceId);
    const faster = await storedAttempt(exerciseId, captureId, referenceId);
    await db('attempts').where({ id: faster }).update({ game_ms: 16950 });
    await storedAttempt(exerciseId, captureId, referenceId, 'aborted');
    const body = (await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie).expect(200)).body;
    expect(body.bestMs).toBe(16950);
    expect(body).not.toHaveProperty('bestMeasuredMs');
  });

  it('next_medal_comes_from_the_best_time_and_the_targets', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-a');
    const referenceId = await reference(exerciseId, captureId);
    const empty = (await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie).expect(200)).body;
    expect(empty.nextMedal).toBeNull();
    const attemptId = await storedAttempt(exerciseId, captureId, referenceId);
    await db('attempts').where({ id: attemptId }).update({ game_ms: 17071 });
    await db('exercises').where({ id: exerciseId }).update({ targets: { goldMs: 16400, silverMs: 16700, bronzeMs: 17800 } });
    const silver = (await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie).expect(200)).body;
    expect(silver.nextMedal).toEqual({ medal: 'silver', targetMs: 16700, gapMs: 371 });
    const listed = (await http().get('/api/exercises').set('Cookie', cookie).expect(200)).body;
    expect(listed[0].nextMedal).toEqual({ medal: 'silver', targetMs: 16700, gapMs: 371 });
    await db('attempts').where({ id: attemptId }).update({ game_ms: 16300 });
    const gold = (await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie).expect(200)).body;
    expect(gold.nextMedal).toBeNull();
  });

  it('delete_reference_with_attempts_is_409', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-a');
    const used = await reference(exerciseId, captureId);
    const unused = await reference(exerciseId, captureId);
    await storedAttempt(exerciseId, captureId, used);
    const conflict = await http().delete(`/api/references/${used}`).set('Cookie', cookie).expect(409);
    expect(conflict.body.code).toBe('reference-in-use');
    await http().post(`/api/references/${used}/activate`).set('Cookie', cookie).expect(201);
    await http().delete(`/api/references/${unused}`).set('Cookie', cookie).expect(200);
    const history = await http().get(`/api/exercises/${exerciseId}/references`).set('Cookie', cookie).expect(200);
    expect(history.body.map((item: { id: string }) => item.id)).toEqual([used]);
    expect((await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie)).body.activeReferenceId).toBe(used);
  });

  it('active_reference_cannot_be_deleted', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-a');
    const older = await reference(exerciseId, captureId);
    const active = await reference(exerciseId, captureId);
    const refused = await http().delete(`/api/references/${active}`).set('Cookie', cookie).expect(409);
    expect(refused.body).toMatchObject({ code: 'reference-active', reason: 'Activate another reference first.' });
    expect(await db('references').where({ id: active })).toHaveLength(1);
    await http().delete(`/api/references/${older}`).set('Cookie', cookie).expect(200);
  });

  it('reference_with_attempts_is_refused_by_the_foreign_key', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-a');
    const used = await reference(exerciseId, captureId);
    await reference(exerciseId, captureId);
    await storedAttempt(exerciseId, captureId, used);
    const queries: string[] = [];
    const record = (query: { sql: string }) => queries.push(query.sql);
    const appDb = app!.get<Knex>(KNEX);
    appDb.on('query', record);
    let refused: request.Response;
    try {
      refused = await http().delete(`/api/references/${used}`).set('Cookie', cookie).expect(409);
    } finally {
      appDb.off('query', record);
    }
    expect(refused.body).toMatchObject({ code: 'reference-in-use', reason: 'Attempts point to this reference. It cannot be deleted.' });
    const deleteAt = queries.findIndex(sql => sql.startsWith('delete from "references"'));
    expect(deleteAt).toBeGreaterThanOrEqual(0);
    expect(queries.slice(0, deleteAt).filter(sql => sql.includes('"attempts"'))).toEqual([]);
    expect(await db('references').where({ id: used })).toHaveLength(1);
  });

  it('game_version_change_marks_needs_check', async () => {
    await http().put('/api/settings/game-version').set('Cookie', cookie).send({ version: '1.60' }).expect(200);
    const exerciseId = await exercise();
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-a'));
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
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-a'));
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
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-a'));
    await http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ mutedCues: ['throttle@411'] }).expect(200);
    const cues = await http().get(`/api/references/${referenceId}/cues`).set('Cookie', cookie).expect(200);
    expect(cues.body.map((cue: { key: string }) => cue.key)).toEqual((await demonstrationAnalysis()).events.map(event => event.key));
    expect(cues.body[0]).toMatchObject({
      kind: 'brake',
      targetSpeedKph: 115,
      phrase: 'Hard brake. One fifteen',
      voice: 'hard-brake',
      bigStop: true,
      muted: false,
      clip: 'hard-brake',
      followClip: 'speed-115',
      text: 'Hard brake'
    });
    expect(cues.body.filter((cue: { muted: boolean }) => cue.muted).map((cue: { key: string }) => cue.key)).toEqual(['throttle@411']);
    await http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ speakTargets: false }).expect(200);
    const quiet = await http().get(`/api/references/${referenceId}/cues`).set('Cookie', cookie).expect(200);
    expect(quiet.body[0]).toMatchObject({ phrase: 'Hard brake', targetSpeedKph: 115, clip: 'hard-brake', followClip: 'speed-115', text: 'Hard brake' });
  });

  it('reference_clips_are_the_clips_of_its_analysis', async () => {
    const exerciseId = await exercise();
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-a'));
    const clips = await http().get(`/api/references/${referenceId}/clips`).set('Cookie', cookie).expect(200);
    const analysis = await demonstrationAnalysis();
    expect(clips.body).toEqual(clipsOf(analysis.events, analysis.corners));
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

  it('corners_route_gives_the_corners_of_the_analysis', async () => {
    const exerciseId = await exercise();
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-a'));
    const corners = await http().get(`/api/references/${referenceId}/corners`).set('Cookie', cookie).expect(200);
    const analysis = await demonstrationAnalysis();
    expect(corners.body).toEqual(cornerInfos(analysis.corners, analysis.path.lengthM));
    expect(corners.body.length).toBeGreaterThan(0);
  });

  it('reference_path_gives_map_geometry_on_the_review_grid', async () => {
    const exerciseId = await exercise();
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-a'));
    const path = await http().get(`/api/references/${referenceId}/path`).set('Cookie', cookie).expect(200);
    expect(path.body.gridM).toBe(2);
    expect(path.body.lengthM).toBeCloseTo((await demonstrationAnalysis()).path.lengthM, 6);
    const points = Math.floor(path.body.lengthM / 2) + 1;
    expect(path.body.x).toHaveLength(points);
    expect(path.body.z).toHaveLength(points);
    expect(path.body.speedMps).toHaveLength(points);
    expect(Math.max(...path.body.speedMps) * KPH_PER_MPS).toBeGreaterThan(100);
    expect(path.body.timeMs).toBe(16082);
  });

  it('other_profile_gets_404', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-a');
    const captureIds = [captureId, await capture(exerciseId, 'demo-b')];
    const referenceId = await reference(exerciseId, captureId);
    const attemptId = await storedAttempt(exerciseId, captureId, referenceId);
    const other = await anotherProfile(app!, cookie, 'Second');
    const otherExercise = await exercise(undefined, other);
    const as = (call: request.Test) => call.set('Cookie', other).expect(404);
    await as(http().get(`/api/exercises/${exerciseId}`));
    await as(http().patch(`/api/exercises/${exerciseId}`).send({ mutedCues: [] }));
    await as(http().post('/api/captures').send({ exerciseId, purpose: 'demo' }));
    await as(http().post(`/api/captures/${captureId}/stop`));
    await as(http().post(`/api/exercises/${exerciseId}/reference-proposals`).send({ captureIds }));
    await as(http().post(`/api/exercises/${otherExercise}/reference-proposals`).send({ captureIds }));
    await as(http().post('/api/references').send({ exerciseId, captureId, first: 457, last: 1422 }));
    await as(http().post('/api/references').send({ exerciseId: otherExercise, captureId, first: 457, last: 1422 }));
    await as(http().post(`/api/attempts/${attemptId}/promote`));
    await as(http().get(`/api/exercises/${exerciseId}/references`));
    await as(http().post(`/api/references/${referenceId}/activate`));
    await as(http().delete(`/api/references/${referenceId}`));
    await as(http().post(`/api/references/${referenceId}/check`).send({ captureId }));
    await as(http().get(`/api/references/${referenceId}/cues`));
    await as(http().get(`/api/references/${referenceId}/clips`));
    await as(http().get(`/api/references/${referenceId}/corners`));
    await as(http().get(`/api/references/${referenceId}/path`));
    await as(http().get(`/api/exercises/${exerciseId}/reactions`));
    expect((await http().get('/api/exercises').set('Cookie', other)).body.map((item: { id: string }) => item.id)).toEqual([otherExercise]);
    expect((await http().get('/api/captures').set('Cookie', other)).body).toEqual([]);
    expect((await db('exercises').where({ id: exerciseId }).first()).name).toBe('Autódromo de Interlagos');
  });

  it('cleanup_keeps_referenced_ranges_and_indices', async () => {
    const exerciseId = await exercise();
    const captureId = await capture(exerciseId, 'demo-a');
    await reference(exerciseId, captureId);
    const path = await rawPath(captureId);
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
    const referenceId = await reference(exerciseId, await capture(exerciseId, 'demo-a'));
    const runCapture = await capture(exerciseId, 'demo-c', 'player');
    const attemptId = await storedAttempt(exerciseId, runCapture, referenceId, 'complete', { first: 1054, last: 2019 });
    const review = async () => (await http().get(`/api/attempts/${attemptId}/review`).set('Cookie', cookie).expect(200)).body;
    const before = await review();
    await http().post('/api/storage/cleanup').set('Cookie', cookie).expect(201);
    expect((await rows(await rawPath(runCapture)))[0]!.rawIndex).toBe(454);
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

  it('demo_capture_sends_no_cues_to_the_voice_device', async () => {
    const voice = await voiceDevice();
    const captureId = await startDemo(await exercise());
    await http().post(`/api/captures/${captureId}/stop`).set('Cookie', cookie).expect(201);
    await settle();
    expect(voice.of('cue')).toEqual([]);
  });

  it('capture_request_with_an_unknown_field_is_400', async () => {
    const exerciseId = await exercise();
    await http().post('/api/captures').set('Cookie', cookie).send({ exerciseId, purpose: 'demo', wait: 5 }).expect(400);
  });
});
