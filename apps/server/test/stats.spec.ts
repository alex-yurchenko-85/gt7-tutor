import type { INestApplication } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sample } from '@gt7/contracts';
import { DEFAULT_CONFIG, buildReference, buildReview, findDifferences, toSample } from '@gt7/core';
import { TELEMETRY_SOURCE_FACTORY } from '../src/captures/telemetry-source.factory.js';
import { createTestApp } from './support/app.js';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';
import { fixtureRows } from './support/live.js';
import { tempDir } from './support/process.js';
import { FixtureReplays } from './support/replay-sources.js';
import { anotherProfile, firstProfile } from './support/session.js';

async function fixtureSamples(name: string, first: number, last: number): Promise<Sample[]> {
  return (await fixtureRows(name))
    .filter(row => row.rawIndex >= first && row.rawIndex <= last)
    .map(toSample)
    .filter((sample): sample is Sample => sample !== null);
}

function localDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

describe('attempts, review and statistics', () => {
  let database: DisposableDatabase;
  let db: Knex;
  let app: INestApplication;
  let replays: FixtureReplays;
  let cookie: string;
  let exerciseId: string;
  let demoCapture: string;
  let playerCapture: string;
  let referenceId: string;
  const http = () => request(app.getHttpServer());

  async function capture(fixture: string, purpose: string, exercise = exerciseId): Promise<string> {
    replays.queue.push(fixture);
    const started = await http().post('/api/captures').set('Cookie', cookie).send({ exerciseId: exercise, purpose }).expect(201);
    await replays.finished();
    await http().post(`/api/captures/${started.body.id}/stop`).set('Cookie', cookie).expect(201);
    return started.body.id as string;
  }

  async function reference(captureId: string, first: number, last: number, exercise = exerciseId): Promise<string> {
    const response = await http()
      .post('/api/references')
      .set('Cookie', cookie)
      .send({ exerciseId: exercise, captureId, first, last, startKind: 'flying' })
      .expect(201);
    return response.body.id as string;
  }

  type AttemptOptions = { completion?: string; measuredMs?: number | null; startedAt?: Date; mode?: string; exercise?: string; reference?: string };

  async function attempt(options: AttemptOptions = {}): Promise<string> {
    const completion = options.completion ?? 'complete';
    const [row] = await db('attempts')
      .insert({
        exercise_id: options.exercise ?? exerciseId,
        capture_id: playerCapture,
        reference_id: options.reference ?? referenceId,
        first_raw_index: 1162,
        last_raw_index: 2786,
        mode: options.mode ?? 'baseline',
        completion,
        reason: completion === 'complete' ? 'end-gate' : 'player-session-ended',
        measured_ms: options.measuredMs === undefined ? (completion === 'complete' ? 27100 : null) : options.measuredMs,
        started_at: options.startedAt ?? new Date()
      })
      .returning('id');
    return row.id as string;
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
      env: { DATA_DIR: tempDir(), TELEMETRY_SOURCE: 'replay' },
      override: builder => builder.overrideProvider(TELEMETRY_SOURCE_FACTORY).useValue(replays.factory)
    });
    cookie = await firstProfile(app);
    exerciseId = (await http().post('/api/exercises').set('Cookie', cookie).send({ catalogueId: 'brand-yangwang-racing-lines' }).expect(201)).body.id;
    demoCapture = await capture('demo-wait05', 'demo');
    playerCapture = await capture('player-run', 'player');
    referenceId = await reference(demoCapture, 352, 1897);
  });

  afterEach(async () => {
    await app.close();
  });

  it('review_matches_core_output', async () => {
    const attemptId = await attempt();
    const path = buildReference(await fixtureSamples('demo-wait05', 352, 1897), 'flying');
    const expected = buildReview(await fixtureSamples('player-run', 1162, 2786), path, DEFAULT_CONFIG);
    const response = await http().get(`/api/attempts/${attemptId}/review`).set('Cookie', cookie).expect(200);
    const { corners, ...comparable } = expected;
    expect(response.body).toMatchObject(JSON.parse(JSON.stringify({ ...comparable, referenceId })));
    expect(response.body.corners.map((corner: { apexSM: number }) => corner.apexSM)).toEqual(corners.map(corner => corner.apexSM));
    expect(response.body.findings).toEqual(JSON.parse(JSON.stringify(findDifferences(expected, DEFAULT_CONFIG))));
    expect(response.body.cues).toEqual([]);
    const stored = await db('attempt_findings').where({ attempt_id: attemptId, reference_id: referenceId });
    expect(stored).toHaveLength(response.body.findings.length);
  });

  it('review_with_other_reference_recomputes', async () => {
    const attemptId = await attempt();
    const otherReference = await reference(await capture('demo-wait10', 'demo'), 655, 2200);
    const path = buildReference(await fixtureSamples('demo-wait10', 655, 2200), 'flying');
    const expected = buildReview(await fixtureSamples('player-run', 1162, 2786), path, DEFAULT_CONFIG);
    const response = await http().get(`/api/attempts/${attemptId}/review?referenceId=${otherReference}`).set('Cookie', cookie).expect(200);
    expect(response.body.referenceId).toBe(otherReference);
    expect(response.body.reference).toEqual(JSON.parse(JSON.stringify(expected.reference)));
    expect(response.body.findings).toEqual(JSON.parse(JSON.stringify(findDifferences(expected, DEFAULT_CONFIG))));
    expect(await db('attempt_findings').where({ attempt_id: attemptId, reference_id: otherReference })).toHaveLength(response.body.findings.length);
    const otherExercise = (await http().post('/api/exercises').set('Cookie', cookie).send({ catalogueId: 'brand-yangwang-racing-lines' }).expect(201)).body.id;
    const foreignReference = await reference(demoCapture, 352, 1897, otherExercise);
    await http().get(`/api/attempts/${attemptId}/review?referenceId=${foreignReference}`).set('Cookie', cookie).expect(404);
  });

  it('official_time_is_stored_separately_from_measured', async () => {
    const attemptId = await attempt();
    const patched = await http().patch(`/api/attempts/${attemptId}`).set('Cookie', cookie).send({ officialMs: 26950, medal: 'silver' }).expect(200);
    expect(patched.body).toMatchObject({ measuredMs: 27100, officialMs: 26950, medal: 'silver', timeMs: 26950 });
    const stored = await db('attempts').where({ id: attemptId }).first();
    expect(stored).toMatchObject({ measured_ms: 27100, official_ms: 26950, medal: 'silver' });
    const exercise = await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie).expect(200);
    expect(exercise.body.status).toBe('silver');
    const cleared = await http().patch(`/api/attempts/${attemptId}`).set('Cookie', cookie).send({ officialMs: null, medal: null }).expect(200);
    expect(cleared.body).toMatchObject({ measuredMs: 27100, officialMs: null, medal: null, timeMs: 27100 });
    await http().patch(`/api/attempts/${attemptId}`).set('Cookie', cookie).send({ medal: 'platinum' }).expect(400);
  });

  it('incomplete_attempt_has_no_time', async () => {
    await attempt({ measuredMs: 27500 });
    const aborted = await attempt({ completion: 'aborted' });
    const detail = await http().get(`/api/attempts/${aborted}`).set('Cookie', cookie).expect(200);
    expect(detail.body).toMatchObject({ completion: 'aborted', measuredMs: null, timeMs: null, gapToBestMs: null });
    await http().patch(`/api/attempts/${aborted}`).set('Cookie', cookie).send({ officialMs: 30000 }).expect(409);
    const list = await http().get(`/api/exercises/${exerciseId}/attempts`).set('Cookie', cookie).expect(200);
    expect(list.body.bestMs).toBe(27500);
  });

  it('attempt_list_has_gap_to_best_and_largest_difference', async () => {
    const slower = await attempt({ measuredMs: 27600, startedAt: new Date(Date.now() - 60000) });
    const faster = await attempt({ measuredMs: 27100 });
    await http().get(`/api/attempts/${slower}/review`).set('Cookie', cookie).expect(200);
    const list = await http().get(`/api/exercises/${exerciseId}/attempts`).set('Cookie', cookie).expect(200);
    const attempts = list.body.days.flatMap((day: { attempts: object[] }) => day.attempts);
    expect(attempts.map((item: { id: string; number: number; gapToBestMs: number }) => [item.id, item.number, item.gapToBestMs])).toEqual([
      [faster, 2, 0],
      [slower, 1, 500]
    ]);
    expect(attempts[1].largestDifference).toMatchObject({ kind: 'brake-early', eventKey: 'brake@332' });
  });

  it('recurring_uses_last_complete_attempts_only', async () => {
    const base = Date.now() - 3600000;
    for (let index = 0; index < 4; index++) await attempt({ startedAt: new Date(base + index * 60000) });
    await attempt({ completion: 'aborted', startedAt: new Date(base + 10 * 60000) });
    const lastThree = await http().get(`/api/exercises/${exerciseId}/recurring?last=3`).set('Cookie', cookie).expect(200);
    expect(lastThree.body.length).toBeGreaterThan(0);
    expect(lastThree.body.every((item: { count: number; of: number }) => item.of === 3 && item.count === 3)).toBe(true);
    expect(lastThree.body.find((item: { eventKey: string }) => item.eventKey === 'brake@332')).toMatchObject({ kind: 'brake-early', unit: 'm' });
    const lastTwo = await http().get(`/api/exercises/${exerciseId}/recurring?last=2`).set('Cookie', cookie).expect(200);
    expect(lastTwo.body).toEqual([]);
    const defaults = await http().get(`/api/exercises/${exerciseId}/recurring`).set('Cookie', cookie).expect(200);
    expect(defaults.body.every((item: { of: number }) => item.of === 4)).toBe(true);
  });

  it('progress_counts_by_status', async () => {
    await attempt();
    const create = async (body: object) => (await http().post('/api/exercises').set('Cookie', cookie).send(body).expect(201)).body.id as string;
    await create({ catalogueId: 'licence-b-1' });
    await create({ family: 'Time Trial', name: 'Tsukuba lap', conditions: {} });
    const ready = await create({ catalogueId: 'brand-yangwang-racing-lines' });
    await reference(demoCapture, 352, 1897, ready);
    const gold = await create({ catalogueId: 'brand-yangwang-racing-lines' });
    const goldReference = await reference(demoCapture, 352, 1897, gold);
    await http().patch(`/api/exercises/${gold}`).set('Cookie', cookie).send({ targets: { goldMs: 30000, silverMs: 32000, bronzeMs: 34000 } }).expect(200);
    await attempt({ exercise: gold, reference: goldReference });
    const progress = await http().get('/api/progress').set('Cookie', cookie).expect(200);
    const counts = (family: string, collection: string) =>
      progress.body.collections.find((item: { family: string; collection: string }) => item.family === family && item.collection === collection)?.counts;
    expect(counts('Brand Experience', 'Yangwang')).toEqual({ new: 0, ready: 1, practising: 1, bronze: 0, silver: 0, gold: 1 });
    expect(counts('Licence', 'National B')).toEqual({ new: 1, ready: 0, practising: 0, bronze: 0, silver: 0, gold: 0 });
    expect(counts('Time Trial', 'Own exercises')).toEqual({ new: 1, ready: 0, practising: 0, bronze: 0, silver: 0, gold: 0 });
    expect(progress.body.exercises.find((item: { id: string }) => item.id === exerciseId)).toMatchObject({ status: 'practising', bestMs: 27100 });
  });

  it('best_by_day_groups_local_dates', async () => {
    const lateEvening = new Date(2026, 10, 14, 23, 30);
    const nextMorning = new Date(2026, 10, 15, 0, 30);
    await attempt({ measuredMs: 28000, startedAt: new Date(2026, 10, 14, 20, 0) });
    await attempt({ measuredMs: 27500, startedAt: lateEvening });
    await attempt({ measuredMs: 27900, startedAt: nextMorning });
    await attempt({ completion: 'aborted', startedAt: new Date(2026, 10, 16, 10, 0) });
    const progress = await http().get('/api/progress').set('Cookie', cookie).expect(200);
    const exercise = progress.body.exercises.find((item: { id: string }) => item.id === exerciseId);
    expect(exercise.bestByDay).toEqual([
      { date: localDate(lateEvening), bestMs: 27500 },
      { date: localDate(nextMorning), bestMs: 27900 }
    ]);
    const list = await http().get(`/api/exercises/${exerciseId}/attempts`).set('Cookie', cookie).expect(200);
    expect(list.body.days.map((day: { date: string; bestMs: number | null; attempts: unknown[] }) => [day.date, day.bestMs, day.attempts.length])).toEqual([
      [localDate(new Date(2026, 10, 16, 10, 0)), null, 1],
      [localDate(nextMorning), 27900, 1],
      [localDate(lateEvening), 27500, 2]
    ]);
  });

  it('review_lists_corners_with_outside_distance', async () => {
    const attemptId = await attempt();
    const response = await http().get(`/api/attempts/${attemptId}/review`).set('Cookie', cookie).expect(200);
    expect(response.body.corners).toHaveLength(3);
    for (const corner of response.body.corners) {
      expect(corner).toEqual({
        number: expect.any(Number),
        turnInSM: expect.any(Number),
        apexSM: expect.any(Number),
        radiusM: expect.any(Number),
        apexSpeedKph: expect.any(Number),
        outsideM: expect.any(Number),
        speedKph: expect.any(Number)
      });
      expect(Math.abs(corner.speedKph - corner.apexSpeedKph)).toBeLessThan(40);
    }
    const wide = response.body.findings.filter((finding: { kind: string }) => finding.kind === 'wide-apex');
    for (const finding of wide) {
      const corner = response.body.corners.find((entry: { number: number }) => `corner-${entry.number}` === finding.eventKey);
      expect(corner.outsideM).toBeCloseTo(finding.size, 6);
    }
    expect(response.body.reactions).toEqual([]);
  });

  it('summary_has_focus_sentence', async () => {
    const attemptId = await attempt();
    await http().get(`/api/attempts/${attemptId}/review`).set('Cookie', cookie).expect(200);
    const summary = await http().get(`/api/attempts/${attemptId}`).set('Cookie', cookie).expect(200);
    expect(summary.body.focus).toEqual({ text: 'Turn one. Brake later.', turn: 1, kind: 'brake-early' });
    const aborted = await attempt({ completion: 'aborted' });
    await http().get(`/api/attempts/${aborted}/review`).set('Cookie', cookie).expect(200);
    expect((await http().get(`/api/attempts/${aborted}`).set('Cookie', cookie).expect(200)).body.focus).toBeNull();
  });

  it('other_profile_gets_404', async () => {
    const attemptId = await attempt();
    const other = await anotherProfile(app, cookie, 'Second');
    const as = (call: request.Test) => call.set('Cookie', other).expect(404);
    await as(http().get(`/api/exercises/${exerciseId}/attempts`));
    await as(http().get(`/api/attempts/${attemptId}`));
    await as(http().patch(`/api/attempts/${attemptId}`).send({ officialMs: 1000 }));
    await as(http().get(`/api/attempts/${attemptId}/review`));
    await as(http().get(`/api/exercises/${exerciseId}/recurring`));
    const progress = await http().get('/api/progress').set('Cookie', other).expect(200);
    expect(progress.body).toEqual({ collections: [], exercises: [] });
    expect((await db('attempts').where({ id: attemptId }).first()).official_ms).toBeNull();
  });
});
