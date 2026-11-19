import { join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TELEMETRY_SOURCE_FACTORY } from '../src/captures/telemetry-source.factory.js';
import { LiveHub, type LiveClient } from '../src/live/live-hub.service.js';
import { createTestApp } from './support/app.js';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';
import { ManualSource } from './support/live.js';
import { tempDir } from './support/process.js';
import { FixtureReplays } from './support/replay-sources.js';
import { anotherProfile, firstProfile, PASSWORD } from './support/session.js';

describe('deleting attempts and history', () => {
  let database: DisposableDatabase;
  let db: Knex;
  let app: INestApplication | null = null;
  let dataDir: string;
  let replays: FixtureReplays;
  let cookie: string;
  const http = () => request(app!.getHttpServer());

  async function exercise(session = cookie): Promise<string> {
    return (await http().post('/api/exercises').set('Cookie', session).send({ catalogueId: 'ce-autodromo-de-interlagos' }).expect(201)).body.id as string;
  }

  async function capture(exerciseId: string, fixture: string, session = cookie): Promise<string> {
    replays.queue.push(fixture);
    const started = await http().post('/api/captures').set('Cookie', session).send({ exerciseId, purpose: 'demo' }).expect(201);
    await replays.finished();
    return (await http().post(`/api/captures/${started.body.id}/stop`).set('Cookie', session).expect(201)).body.id as string;
  }

  async function reference(exerciseId: string, captureId: string, session = cookie): Promise<string> {
    return (
      await http().post('/api/references').set('Cookie', session).send({ exerciseId, captureId, first: 457, last: 1422, startKind: 'flying' }).expect(201)
    ).body.id as string;
  }

  async function storedAttempt(exerciseId: string, captureId: string, referenceId: string): Promise<string> {
    const [row] = await db('attempts')
      .insert({
        exercise_id: exerciseId,
        capture_id: captureId,
        reference_id: referenceId,
        first_raw_index: 457,
        last_raw_index: 1422,
        mode: 'baseline',
        completion: 'complete',
        measured_ms: 17100,
        started_at: new Date()
      })
      .returning('id');
    const attemptId = row.id as string;
    await db('cue_events').insert({ attempt_id: attemptId, event_key: 'brake@291', kind: 'brake', decided_mono_ms: 1000, outcome: 'played' });
    await db('attempt_findings').insert({ attempt_id: attemptId, reference_id: referenceId, kind: 'brake-late', event_key: 'brake@291', s_m: 290, size: 4, unit: 'm' });
    return attemptId;
  }

  type Setup = { exerciseId: string; captureId: string; referenceId: string; attempts: string[] };

  async function exerciseWithAttempts(count: number, session = cookie): Promise<Setup> {
    const exerciseId = await exercise(session);
    const captureId = await capture(exerciseId, 'demo-a', session);
    const referenceId = await reference(exerciseId, captureId, session);
    const attempts: string[] = [];
    for (let index = 0; index < count; index++) attempts.push(await storedAttempt(exerciseId, captureId, referenceId));
    return { exerciseId, captureId, referenceId, attempts };
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
    app = await createTestApp(database.url, {
      env: { DATA_DIR: dataDir, TELEMETRY_SOURCE: 'replay' },
      override: builder => builder.overrideProvider(TELEMETRY_SOURCE_FACTORY).useValue(replays.factory)
    });
    cookie = await firstProfile(app);
  });

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it('delete_selected_attempts_removes_cue_events_and_findings', async () => {
    const { exerciseId, attempts } = await exerciseWithAttempts(3);
    const response = await http().post('/api/attempts/delete').set('Cookie', cookie).send({ ids: attempts.slice(0, 2) }).expect(200);
    expect(response.body).toEqual({ deleted: 2 });
    expect((await db('attempts').where({ exercise_id: exerciseId })).map(row => row.id)).toEqual([attempts[2]]);
    expect(await db('cue_events').whereIn('attempt_id', attempts.slice(0, 2))).toEqual([]);
    expect(await db('attempt_findings').whereIn('attempt_id', attempts.slice(0, 2))).toEqual([]);
    expect(await db('cue_events').where({ attempt_id: attempts[2] })).toHaveLength(1);
  });

  it('delete_refuses_foreign_ids_atomically', async () => {
    const own = await exerciseWithAttempts(1);
    const other = await anotherProfile(app!, cookie, 'Second');
    const foreign = await exerciseWithAttempts(1, other);
    await http().post('/api/attempts/delete').set('Cookie', cookie).send({ ids: [own.attempts[0], foreign.attempts[0]] }).expect(404);
    const listed = await http().get(`/api/exercises/${own.exerciseId}/attempts`).set('Cookie', cookie).expect(200);
    expect(listed.body.days.flatMap((day: { attempts: { id: string }[] }) => day.attempts.map(attempt => attempt.id))).toEqual(own.attempts);
    expect(await db('attempts').where({ id: foreign.attempts[0] })).toHaveLength(1);
    await http().post('/api/history/delete').set('Cookie', cookie).send({ scope: 'exercise', exerciseId: foreign.exerciseId, cleanup: false }).expect(404);
    expect(await db('attempts').where({ id: foreign.attempts[0] })).toHaveLength(1);
  });

  it('delete_refuses_while_armed', async () => {
    const { exerciseId, attempts } = await exerciseWithAttempts(1);
    replays.queue.push(new ManualSource());
    await http().post('/api/training/arm').set('Cookie', cookie).send({ exerciseId, mode: 'baseline' }).expect(201);
    const selected = await http().post('/api/attempts/delete').set('Cookie', cookie).send({ ids: attempts }).expect(409);
    expect(selected.body.code).toBe('busy');
    const history = await http().post('/api/history/delete').set('Cookie', cookie).send({ scope: 'attempts', cleanup: false }).expect(409);
    expect(history.body.code).toBe('busy');
    expect(await db('attempts').whereIn('id', attempts)).toHaveLength(1);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    await http().post('/api/attempts/delete').set('Cookie', cookie).send({ ids: attempts }).expect(200);
  });

  it('delete_is_allowed_while_another_profile_trains', async () => {
    const own = await exerciseWithAttempts(1);
    const other = await anotherProfile(app!, cookie, 'Second');
    const foreign = await exerciseWithAttempts(0, other);
    replays.queue.push(new ManualSource());
    await http().post('/api/training/arm').set('Cookie', other).send({ exerciseId: foreign.exerciseId, mode: 'baseline' }).expect(201);
    await http().post('/api/attempts/delete').set('Cookie', cookie).send({ ids: own.attempts }).expect(200);
    await http().post('/api/training/disarm').set('Cookie', other).expect(201);
  });

  it('delete_request_is_validated', async () => {
    await http().post('/api/attempts/delete').set('Cookie', cookie).send({ ids: [] }).expect(400);
    await http().post('/api/history/delete').set('Cookie', cookie).send({ scope: 'exercise', cleanup: false }).expect(400);
    await http().post('/api/history/delete').set('Cookie', cookie).send({ scope: 'attempts', exerciseId: crypto.randomUUID(), cleanup: false }).expect(400);
    await http().post('/api/history/delete').send({ scope: 'attempts', cleanup: false }).expect(401);
  });

  it('exercise_scope_keeps_references', async () => {
    const first = await exerciseWithAttempts(2);
    const second = await exerciseWithAttempts(1);
    const response = await http()
      .post('/api/history/delete')
      .set('Cookie', cookie)
      .send({ scope: 'exercise', exerciseId: first.exerciseId, cleanup: false })
      .expect(200);
    expect(response.body).toEqual({ attempts: 2, references: 0, cleanup: null });
    expect(await db('attempts').where({ exercise_id: first.exerciseId })).toEqual([]);
    expect(await db('attempts').where({ exercise_id: second.exerciseId })).toHaveLength(1);
    expect(await db('references').where({ id: first.referenceId })).toHaveLength(1);
    const exercise = await http().get(`/api/exercises/${first.exerciseId}`).set('Cookie', cookie).expect(200);
    expect(exercise.body.activeReferenceId).toBe(first.referenceId);
  });

  it('attempts_scope_removes_every_attempt_of_the_profile_only', async () => {
    const first = await exerciseWithAttempts(2);
    const second = await exerciseWithAttempts(1);
    const other = await anotherProfile(app!, cookie, 'Second');
    const foreign = await exerciseWithAttempts(1, other);
    const response = await http().post('/api/history/delete').set('Cookie', cookie).send({ scope: 'attempts', cleanup: false }).expect(200);
    expect(response.body).toEqual({ attempts: 3, references: 0, cleanup: null });
    expect(await db('attempts').whereIn('exercise_id', [first.exerciseId, second.exerciseId])).toEqual([]);
    expect(await db('attempts').where({ exercise_id: foreign.exerciseId })).toHaveLength(1);
  });

  it('everything_scope_removes_references_and_resets_status', async () => {
    const first = await exerciseWithAttempts(2);
    const other = await anotherProfile(app!, cookie, 'Second');
    const foreign = await exerciseWithAttempts(1, other);
    const response = await http().post('/api/history/delete').set('Cookie', cookie).send({ scope: 'everything', cleanup: false }).expect(200);
    expect(response.body).toEqual({ attempts: 2, references: 1, cleanup: null });
    const exercise = await http().get(`/api/exercises/${first.exerciseId}`).set('Cookie', cookie).expect(200);
    expect(exercise.body).toMatchObject({ status: 'new', activeReferenceId: null });
    const listed = await http().get('/api/exercises').set('Cookie', cookie).expect(200);
    expect(listed.body.map((item: { id: string }) => item.id)).toEqual([first.exerciseId]);
    expect(await db('captures').where({ id: first.captureId })).toHaveLength(1);
    expect(await db('references').where({ id: foreign.referenceId })).toHaveLength(1);
    expect(await db('attempts').where({ exercise_id: foreign.exerciseId })).toHaveLength(1);
  });

  it('cleanup_flag_returns_cleanup_result', async () => {
    const { captureId } = await exerciseWithAttempts(1);
    const path = await rawPathOf(captureId);
    const sizeBefore = statSync(path).size;
    const response = await http().post('/api/history/delete').set('Cookie', cookie).send({ scope: 'everything', cleanup: true }).expect(200);
    expect(response.body).toMatchObject({ attempts: 1, references: 1, cleanup: { captures: 1, bytesBefore: sizeBefore, bytesAfter: 0 } });
    expect(statSync(path).size).toBe(0);
  });

  it('raw_files_stay_without_cleanup', async () => {
    const { captureId, attempts } = await exerciseWithAttempts(2);
    const path = await rawPathOf(captureId);
    const sizeBefore = statSync(path).size;
    await http().post('/api/attempts/delete').set('Cookie', cookie).send({ ids: attempts }).expect(200);
    await http().post('/api/history/delete').set('Cookie', cookie).send({ scope: 'everything', cleanup: false }).expect(200);
    expect(statSync(path).size).toBe(sizeBefore);
  });

  it('remove_exercises_removes_attempts_and_references', async () => {
    const first = await exerciseWithAttempts(2);
    const second = await exerciseWithAttempts(1);
    const third = await exerciseWithAttempts(1);
    const response = await http()
      .post('/api/exercises/remove')
      .set('Cookie', cookie)
      .send({ ids: [first.exerciseId, second.exerciseId], cleanup: false })
      .expect(200);
    expect(response.body).toEqual({ exercises: 2, attempts: 3, references: 2, cleanup: null });
    const listed = await http().get('/api/exercises').set('Cookie', cookie).expect(200);
    expect(listed.body.map((item: { id: string }) => item.id)).toEqual([third.exerciseId]);
    await http().get(`/api/exercises/${first.exerciseId}`).set('Cookie', cookie).expect(404);
    expect(await db('attempts').whereIn('exercise_id', [first.exerciseId, second.exerciseId])).toEqual([]);
    expect(await db('references').whereIn('exercise_id', [first.exerciseId, second.exerciseId])).toEqual([]);
    expect(await db('cue_events').whereIn('attempt_id', first.attempts)).toEqual([]);
    expect(await db('captures').whereIn('id', [first.captureId, second.captureId])).toHaveLength(2);
    expect(await db('attempts').where({ exercise_id: third.exerciseId })).toHaveLength(1);
    expect((await http().get(`/api/exercises/${third.exerciseId}`).set('Cookie', cookie).expect(200)).body.activeReferenceId).toBe(third.referenceId);
  });

  it('remove_exercises_refuses_foreign_ids_atomically', async () => {
    const own = await exerciseWithAttempts(1);
    const other = await anotherProfile(app!, cookie, 'Second');
    const foreign = await exerciseWithAttempts(1, other);
    await http().post('/api/exercises/remove').set('Cookie', cookie).send({ ids: [own.exerciseId, foreign.exerciseId], cleanup: false }).expect(404);
    await http().post('/api/exercises/remove').set('Cookie', cookie).send({ ids: [own.exerciseId, crypto.randomUUID()], cleanup: false }).expect(404);
    expect(await db('exercises').whereIn('id', [own.exerciseId, foreign.exerciseId])).toHaveLength(2);
    expect(await db('attempts').where({ exercise_id: own.exerciseId })).toHaveLength(1);
    expect(await db('references').where({ exercise_id: own.exerciseId })).toHaveLength(1);
  });

  it('remove_exercises_refuses_while_armed', async () => {
    const { exerciseId } = await exerciseWithAttempts(1);
    const idle = await exercise();
    replays.queue.push(new ManualSource());
    await http().post('/api/training/arm').set('Cookie', cookie).send({ exerciseId, mode: 'baseline' }).expect(201);
    const response = await http().post('/api/exercises/remove').set('Cookie', cookie).send({ ids: [idle], cleanup: false }).expect(409);
    expect(response.body.code).toBe('busy');
    expect(await db('exercises').where({ id: idle })).toHaveLength(1);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
  });

  it('removed_catalogue_entry_can_be_added_again', async () => {
    const { exerciseId } = await exerciseWithAttempts(1);
    const entry = async () =>
      (await http().get('/api/catalogue').query({ q: 'Interlagos' }).set('Cookie', cookie).expect(200)).body.find(
        (item: { id: string }) => item.id === 'ce-autodromo-de-interlagos'
      );
    expect((await entry()).exerciseId).toBe(exerciseId);
    await http().post('/api/exercises/remove').set('Cookie', cookie).send({ ids: [exerciseId], cleanup: false }).expect(200);
    expect(await entry()).toMatchObject({ exerciseId: null, status: null });
    const again = await exercise();
    expect((await entry()).exerciseId).toBe(again);
  });

  it('remove_cleanup_flag_returns_cleanup_result', async () => {
    const { exerciseId, captureId } = await exerciseWithAttempts(1);
    const path = await rawPathOf(captureId);
    const sizeBefore = statSync(path).size;
    const response = await http().post('/api/exercises/remove').set('Cookie', cookie).send({ ids: [exerciseId], cleanup: true }).expect(200);
    expect(response.body).toMatchObject({ exercises: 1, attempts: 1, references: 1, cleanup: { captures: 1, bytesBefore: sizeBefore, bytesAfter: 0 } });
  });

  async function userIdOf(name: string): Promise<string> {
    return (await db('users').where({ name }).first()).id as string;
  }

  it('delete_profile_removes_its_data_only', async () => {
    const own = await exerciseWithAttempts(2);
    const other = await anotherProfile(app!, cookie, 'Second');
    const foreign = await exerciseWithAttempts(1, other);
    const driverId = await userIdOf('Driver');
    const ownPath = await rawPathOf(own.captureId);
    const ownSize = statSync(ownPath).size;
    const foreignPath = await rawPathOf(foreign.captureId);
    const hub = app!.get(LiveHub);
    let closed = false;
    const client: LiveClient = { id: 'phone', userId: driverId, sessionKey: 'phone-session', expiresAtMs: Number.MAX_SAFE_INTEGER, bufferedAmount: 0, send: () => undefined, close: () => (closed = true) };
    hub.attach(client);
    hub.receive(client, { type: 'claim-voice', deviceId: 'phone', ready: true });
    expect(hub.voiceReady(driverId)).toBe(true);
    const response = await http().post('/api/profiles/me/delete').set('Cookie', cookie).send({ password: PASSWORD }).expect(200);
    expect(response.body).toEqual({ exercises: 1, attempts: 2, references: 1, cleanup: { captures: 1, bytesBefore: ownSize, bytesAfter: 0 } });
    expect(String(response.headers['set-cookie'])).toMatch(/gt7_session=;/);
    expect(hub.voiceReady(driverId)).toBe(false);
    expect(closed).toBe(true);
    expect(await db('users').where({ id: driverId })).toEqual([]);
    expect(await db('sessions').where({ user_id: driverId })).toEqual([]);
    expect(await db('exercises').where({ id: own.exerciseId })).toEqual([]);
    expect(await db('attempts').whereIn('id', own.attempts)).toEqual([]);
    expect(await db('references').where({ id: own.referenceId })).toEqual([]);
    expect(existsSync(ownPath)).toBe(false);
    expect(statSync(foreignPath).size).toBeGreaterThan(0);
    const state = await http().get('/api/auth/state').set('Cookie', cookie).expect(200);
    expect(state.body).toMatchObject({ hasUsers: true, user: null });
    expect(await db('attempts').where({ exercise_id: foreign.exerciseId })).toHaveLength(1);
    await http().get(`/api/exercises/${foreign.exerciseId}`).set('Cookie', other).expect(200);
  });

  it('delete_profile_refuses_a_cleanup_field', async () => {
    await http().post('/api/profiles/me/delete').set('Cookie', cookie).send({ password: PASSWORD, cleanup: false }).expect(400);
    expect(await db('users').where({ name: 'Driver' })).toHaveLength(1);
  });

  it('delete_profile_needs_its_password', async () => {
    const own = await exerciseWithAttempts(1);
    const response = await http().post('/api/profiles/me/delete').set('Cookie', cookie).send({ password: 'wrong password' }).expect(403);
    expect(response.body.code).toBe('wrong-password');
    expect(await db('exercises').where({ id: own.exerciseId })).toHaveLength(1);
    await http().get('/api/exercises').set('Cookie', cookie).expect(200);
  });

  it('delete_profile_refused_while_armed', async () => {
    const { exerciseId } = await exerciseWithAttempts(1);
    replays.queue.push(new ManualSource());
    await http().post('/api/training/arm').set('Cookie', cookie).send({ exerciseId, mode: 'baseline' }).expect(201);
    const response = await http().post('/api/profiles/me/delete').set('Cookie', cookie).send({ password: PASSWORD }).expect(409);
    expect(response.body.code).toBe('busy');
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
  });

  it('deleting_the_last_profile_returns_to_first_profile', async () => {
    const { captureId } = await exerciseWithAttempts(1);
    const path = await rawPathOf(captureId);
    const sizeBefore = statSync(path).size;
    const response = await http().post('/api/profiles/me/delete').set('Cookie', cookie).send({ password: PASSWORD }).expect(200);
    expect(response.body.cleanup).toEqual({ captures: 1, bytesBefore: sizeBefore, bytesAfter: 0 });
    expect(existsSync(path)).toBe(false);
    expect((await http().get('/api/auth/state').expect(200)).body).toMatchObject({ hasUsers: false, user: null });
  });

  it('known_foreign_ids_delete_nothing', async () => {
    const victim = await exerciseWithAttempts(2);
    const victimId = await userIdOf('Driver');
    const intruder = await anotherProfile(app!, cookie, 'Intruder');
    const before = async () => ({
      exercises: (await db('exercises').where({ id: victim.exerciseId })).length,
      attempts: (await db('attempts').whereIn('id', victim.attempts)).length,
      references: (await db('references').where({ id: victim.referenceId })).length,
      users: (await db('users').where({ id: victimId })).length
    });
    const intact = { exercises: 1, attempts: 2, references: 1, users: 1 };
    const routes: [string, object][] = [
      ['/api/attempts/delete', { ids: victim.attempts }],
      ['/api/history/delete', { scope: 'exercise', exerciseId: victim.exerciseId, cleanup: true }],
      ['/api/exercises/remove', { ids: [victim.exerciseId], cleanup: true }],
      ['/api/profiles/me/delete', { password: PASSWORD }]
    ];
    for (const [path, body] of routes) await http().post(path).send(body).expect(401);
    for (const [path, body] of routes.slice(0, 3)) await http().post(path).set('Cookie', intruder).send(body).expect(404);
    await http().post('/api/history/delete').set('Cookie', intruder).send({ scope: 'everything', cleanup: true }).expect(200);
    await http().post('/api/history/delete').set('Cookie', intruder).send({ scope: 'attempts', cleanup: true }).expect(200);
    expect(await before()).toEqual(intact);
    await http().post('/api/profiles/me/delete').set('Cookie', intruder).send({ password: PASSWORD, userId: victimId }).expect(400);
    await http().post('/api/attempts/delete').set('Cookie', 'gt7_session=forged-token').send({ ids: victim.attempts }).expect(401);
    await http().post('/api/profiles/me/delete').set('Cookie', intruder).send({ password: PASSWORD }).expect(200);
    expect(await before()).toEqual(intact);
    await http().get(`/api/exercises/${victim.exerciseId}`).set('Cookie', cookie).expect(200);
  });
});
