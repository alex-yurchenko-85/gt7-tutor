import type { INestApplication } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSamples } from '@gt7/capture';
import type { Sample } from '@gt7/contracts';
import { DEFAULT_CONFIG, analyseReference, buildReview, findDifferences, turnLosses, turnOf, type Review } from '@gt7/core';
import { KNEX } from '../src/storage/knex.provider.js';
import { ReferencesService } from '../src/references/references.service.js';
import { DEMONSTRATION, INTERLAGOS, INTERLAGOS_TARGETS, TestApi, createReplayApp, insertAttempt, type Range, type StoredAttempt } from './support/api.js';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';
import type { FixtureReplays } from './support/replay-sources.js';
import { fixturePath } from '../../../tools/testing/fixture-path.js';
import { anotherProfile, firstProfile } from './support/session.js';

function fixtureSamples(name: string, range: Range): Promise<Sample[]> {
  return readSamples(fixturePath(name), range);
}

function differencesOf(review: Review): object[] {
  return JSON.parse(JSON.stringify(findDifferences(review, DEFAULT_CONFIG).map(finding => ({ ...finding, turn: turnOf(review.corners, finding.sM) }))));
}

const CLEAN_RUN = { first: 8451, last: 9479 };
const DEMONSTRATION_B = { first: 738, last: 1703 };

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

  const api = new TestApi(() => app, () => replays, () => cookie);
  const http = () => api.http();

  function capture(fixture: string, purpose: string, exercise = exerciseId): Promise<string> {
    return api.capture(exercise, fixture, purpose);
  }

  function reference(captureId: string, range: Range = DEMONSTRATION, exercise = exerciseId): Promise<string> {
    return api.reference(exercise, captureId, range);
  }

  async function interlagos(): Promise<string> {
    const id = await api.exercise({ catalogueId: INTERLAGOS });
    await db('exercises').where({ id }).update({ targets: JSON.stringify(INTERLAGOS_TARGETS) });
    return id;
  }

  type AttemptOptions = Partial<Omit<StoredAttempt, 'exerciseId' | 'captureId' | 'referenceId'>> & { exercise?: string; reference?: string };

  function attempt(options: AttemptOptions = {}): Promise<string> {
    const { exercise, reference: referenceOf, ...rest } = options;
    return insertAttempt(db, { exerciseId: exercise ?? exerciseId, captureId: playerCapture, referenceId: referenceOf ?? referenceId, ...rest });
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
    exerciseId = await interlagos();
    demoCapture = await capture('demo-a', 'demo');
    playerCapture = await capture('ce-clean', 'player');
    referenceId = await reference(demoCapture);
  });

  afterEach(async () => {
    await app.close();
  });

  async function queriesOf(action: () => Promise<unknown>): Promise<string[]> {
    const knexInstance = app.get<Knex>(KNEX);
    const sql: string[] = [];
    const listener = (query: { sql: string }) => sql.push(query.sql);
    knexInstance.on('query', listener);
    try {
      await action();
    } finally {
      knexInstance.removeListener('query', listener);
    }
    return sql;
  }

  it('attempt_list_runs_a_fixed_number_of_queries', async () => {
    const list = () => http().get(`/api/exercises/${exerciseId}/attempts`).set('Cookie', cookie).expect(200);
    const base = Date.now() - 3600000;
    const add = async (from: number, to: number) => {
      for (let index = from; index < to; index++) {
        const id = await attempt({ startedAt: new Date(base + index * 60000) });
        await http().get(`/api/attempts/${id}/review`).set('Cookie', cookie).expect(200);
      }
    };
    await add(0, 3);
    await list();
    const few = await queriesOf(list);
    await add(3, 10);
    const many = await queriesOf(list);
    expect(many.length).toBe(few.length);
  });

  it('review_get_does_not_delete_findings', async () => {
    const attemptId = await attempt();
    const sql = await queriesOf(async () => {
      await http().get(`/api/attempts/${attemptId}/review`).set('Cookie', cookie).expect(200);
      await http().get(`/api/attempts/${attemptId}/review`).set('Cookie', cookie).expect(200);
      await http().get(`/api/attempts/${attemptId}`).set('Cookie', cookie).expect(200);
      await http().get(`/api/exercises/${exerciseId}/recurring`).set('Cookie', cookie).expect(200);
    });
    expect(sql.filter(text => /delete\s+from\s+"attempt_findings"/i.test(text))).toEqual([]);
    const stored = await db('attempt_findings').where({ attempt_id: attemptId });
    const again = await http().get(`/api/attempts/${attemptId}/review`).set('Cookie', cookie).expect(200);
    expect(stored).toHaveLength(again.body.findings.length);
  });

  it('clean_attempt_is_compared_only_once', async () => {
    const id = await insertAttempt(db, { exerciseId, captureId: demoCapture, referenceId, range: DEMONSTRATION, gameMs: 16082 });
    const samplesOf = vi.spyOn(app.get(ReferencesService), 'samplesOf');
    await http().get(`/api/exercises/${exerciseId}/recurring`).set('Cookie', cookie).expect(200);
    expect(await db('attempt_findings').where({ attempt_id: id })).toEqual([]);
    expect(await db('attempt_comparisons').where({ attempt_id: id, reference_id: referenceId })).toHaveLength(1);
    const before = samplesOf.mock.calls.length;
    await http().get(`/api/exercises/${exerciseId}/recurring`).set('Cookie', cookie).expect(200);
    expect(samplesOf.mock.calls.length).toBe(before);
  });

  it('review_matches_core_output', async () => {
    const attemptId = await attempt();
    const analysis = analyseReference(await fixtureSamples('demo-a', DEMONSTRATION), DEFAULT_CONFIG);
    const expected = buildReview(await fixtureSamples('ce-clean', CLEAN_RUN), analysis, DEFAULT_CONFIG);
    const response = await http().get(`/api/attempts/${attemptId}/review`).set('Cookie', cookie).expect(200);
    const { corners, ...comparable } = expected;
    expect(response.body).toMatchObject(JSON.parse(JSON.stringify({ ...comparable, referenceId })));
    expect(response.body.corners.map((corner: { apexSM: number }) => corner.apexSM)).toEqual(corners.map(corner => corner.apexSM));
    expect(response.body.findings).toEqual(differencesOf(expected));
    expect(response.body.turnLosses).toEqual(turnLosses(corners, expected.lengthM, expected.gridM, expected.attempt.t, expected.reference.t));
    expect(response.body.cues).toEqual([]);
    expect(response.body.referenceTimeMs).toBe(16082);
    const stored = await db('attempt_findings').where({ attempt_id: attemptId, reference_id: referenceId });
    expect(stored).toHaveLength(response.body.findings.length);
  });

  it('review_with_other_reference_recomputes', async () => {
    const attemptId = await attempt();
    const otherReference = await reference(await capture('demo-b', 'demo'), DEMONSTRATION_B);
    const analysis = analyseReference(await fixtureSamples('demo-b', DEMONSTRATION_B), DEFAULT_CONFIG);
    const expected = buildReview(await fixtureSamples('ce-clean', CLEAN_RUN), analysis, DEFAULT_CONFIG);
    const response = await http().get(`/api/attempts/${attemptId}/review?referenceId=${otherReference}`).set('Cookie', cookie).expect(200);
    expect(response.body.referenceId).toBe(otherReference);
    expect(response.body.reference).toEqual(JSON.parse(JSON.stringify(expected.reference)));
    expect(response.body.findings).toEqual(differencesOf(expected));
    expect(await db('attempt_findings').where({ attempt_id: attemptId, reference_id: otherReference })).toHaveLength(response.body.findings.length);
    const otherExercise = await interlagos();
    const foreignReference = await reference(demoCapture, DEMONSTRATION, otherExercise);
    await http().get(`/api/attempts/${attemptId}/review?referenceId=${foreignReference}`).set('Cookie', cookie).expect(404);
  });

  it('incomplete_attempt_has_no_time', async () => {
    await attempt({ gameMs: 17500 });
    const aborted = await attempt({ completion: 'aborted' });
    const detail = await http().get(`/api/attempts/${aborted}`).set('Cookie', cookie).expect(200);
    expect(detail.body).toMatchObject({ completion: 'aborted', timeMs: null, gapToBestMs: null });
    const list = await http().get(`/api/exercises/${exerciseId}/attempts`).set('Cookie', cookie).expect(200);
    expect(list.body.bestMs).toBe(17500);
  });

  it('attempt_list_has_gap_to_best_and_largest_difference', async () => {
    const slower = await attempt({ gameMs: 17571, startedAt: new Date(Date.now() - 60000) });
    const faster = await attempt({ gameMs: 17071 });
    await http().get(`/api/attempts/${slower}/review`).set('Cookie', cookie).expect(200);
    const list = await http().get(`/api/exercises/${exerciseId}/attempts`).set('Cookie', cookie).expect(200);
    const attempts = list.body.days.flatMap((day: { attempts: object[] }) => day.attempts);
    expect(attempts.map((item: { id: string; number: number; gapToBestMs: number }) => [item.id, item.number, item.gapToBestMs])).toEqual([
      [faster, 2, 0],
      [slower, 1, 500]
    ]);
    expect(attempts[1].largestDifference).toMatchObject({ kind: 'brake-early', eventKey: 'brake@291' });
  });

  it('recurring_uses_last_complete_attempts_only', async () => {
    const base = Date.now() - 3600000;
    for (let index = 0; index < 4; index++) await attempt({ startedAt: new Date(base + index * 60000) });
    await attempt({ completion: 'aborted', startedAt: new Date(base + 10 * 60000) });
    const lastThree = await http().get(`/api/exercises/${exerciseId}/recurring?last=3`).set('Cookie', cookie).expect(200);
    expect(lastThree.body.length).toBeGreaterThan(0);
    expect(lastThree.body.every((item: { count: number; of: number }) => item.of === 3 && item.count === 3)).toBe(true);
    expect(lastThree.body.find((item: { eventKey: string }) => item.eventKey === 'brake@291')).toMatchObject({ kind: 'brake-early', unit: 'm' });
    const lastTwo = await http().get(`/api/exercises/${exerciseId}/recurring?last=2`).set('Cookie', cookie).expect(200);
    expect(lastTwo.body).toEqual([]);
    const defaults = await http().get(`/api/exercises/${exerciseId}/recurring`).set('Cookie', cookie).expect(200);
    expect(defaults.body.every((item: { of: number }) => item.of === 4)).toBe(true);
  });

  it('progress_counts_by_status', async () => {
    await attempt();
    const create = async (body: object) => (await http().post('/api/exercises').set('Cookie', cookie).send(body).expect(201)).body.id as string;
    await create({ catalogueId: 'licence-b-1' });
    await create({ family: 'Time Trial', name: 'Tsukuba lap' });
    const ready = await interlagos();
    await reference(demoCapture, DEMONSTRATION, ready);
    const gold = await interlagos();
    const goldReference = await reference(demoCapture, DEMONSTRATION, gold);
    await attempt({ exercise: gold, reference: goldReference, gameMs: 16300 });
    const progress = await http().get('/api/progress').set('Cookie', cookie).expect(200);
    const counts = (family: string, collection: string) =>
      progress.body.collections.find((item: { family: string; collection: string }) => item.family === family && item.collection === collection)?.counts;
    expect(counts('Circuit Experience', 'Americas')).toEqual({ new: 0, ready: 1, practising: 0, bronze: 1, silver: 0, gold: 1 });
    expect(counts('Licence', 'National B')).toEqual({ new: 1, ready: 0, practising: 0, bronze: 0, silver: 0, gold: 0 });
    expect(counts('Time Trial', 'Own exercises')).toEqual({ new: 1, ready: 0, practising: 0, bronze: 0, silver: 0, gold: 0 });
    expect(progress.body.exercises.find((item: { id: string }) => item.id === exerciseId)).toMatchObject({ status: 'bronze', bestMs: 17071 });
  });

  it('best_by_day_groups_local_dates', async () => {
    const lateEvening = new Date(2026, 10, 14, 23, 30);
    const nextMorning = new Date(2026, 10, 15, 0, 30);
    await attempt({ gameMs: 18000, startedAt: new Date(2026, 10, 14, 20, 0) });
    await attempt({ gameMs: 17500, startedAt: lateEvening });
    await attempt({ gameMs: 17900, startedAt: nextMorning });
    await attempt({ completion: 'aborted', startedAt: new Date(2026, 10, 16, 10, 0) });
    const progress = await http().get('/api/progress').set('Cookie', cookie).expect(200);
    const exercise = progress.body.exercises.find((item: { id: string }) => item.id === exerciseId);
    expect(exercise.bestByDay).toEqual([
      { date: localDate(lateEvening), bestMs: 17500 },
      { date: localDate(nextMorning), bestMs: 17900 }
    ]);
    const list = await http().get(`/api/exercises/${exerciseId}/attempts`).set('Cookie', cookie).expect(200);
    expect(list.body.days.map((day: { date: string; bestMs: number | null; attempts: unknown[] }) => [day.date, day.bestMs, day.attempts.length])).toEqual([
      [localDate(new Date(2026, 10, 16, 10, 0)), null, 1],
      [localDate(nextMorning), 17900, 1],
      [localDate(lateEvening), 17500, 2]
    ]);
  });

  it('review_lists_corners_with_outside_distance', async () => {
    const attemptId = await attempt();
    const response = await http().get(`/api/attempts/${attemptId}/review`).set('Cookie', cookie).expect(200);
    expect(response.body.corners).toHaveLength(1);
    for (const corner of response.body.corners) {
      expect(corner).toEqual({
        number: expect.any(Number),
        turnInSM: expect.any(Number),
        apexSM: expect.any(Number),
        radiusM: expect.any(Number),
        apexSpeedMps: expect.any(Number),
        zoneFromSM: expect.any(Number),
        zoneToSM: expect.any(Number),
        outsideM: expect.any(Number),
        speedMps: expect.any(Number)
      });
    }
    const wide = response.body.findings.filter((finding: { kind: string }) => finding.kind === 'wide-apex');
    for (const finding of wide) {
      const corner = response.body.corners.find((entry: { number: number }) => `corner-${entry.number}` === finding.eventKey);
      expect(corner.outsideM).toBeCloseTo(finding.size, 6);
    }
    expect(response.body.reactions).toEqual([]);
  });

  it('review_reports_turns_and_turn_losses', async () => {
    const attemptId = await attempt();
    const response = await http().get(`/api/attempts/${attemptId}/review`).set('Cookie', cookie).expect(200);
    const { corners, findings, turnLosses } = response.body;
    expect(corners.length).toBeGreaterThan(0);
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(Number.isInteger(finding.turn)).toBe(true);
      expect(finding.turn).toBeGreaterThanOrEqual(1);
    }
    expect(turnLosses).toHaveLength(corners.length);
    turnLosses.forEach((loss: { fromSM: number; toSM: number }, index: number) => {
      expect(loss.fromSM).toBe(corners[index].zoneFromSM);
      expect(loss.toSM).toBe(corners[index].zoneToSM);
    });
    expect(turnLosses.map((loss: { turn: number }) => loss.turn)).toEqual(corners.map((corner: { number: number }) => corner.number));
    expect(turnLosses.some((loss: { lostMs: number | null }) => typeof loss.lostMs === 'number')).toBe(true);
  });

  it('recurring_differences_carry_turns', async () => {
    const base = Date.now() - 3600000;
    for (let index = 0; index < 3; index++) await attempt({ startedAt: new Date(base + index * 60000) });
    const recurring = await http().get(`/api/exercises/${exerciseId}/recurring`).set('Cookie', cookie).expect(200);
    expect(recurring.body.length).toBeGreaterThan(0);
    for (const item of recurring.body) expect(Number.isInteger(item.turn)).toBe(true);
    expect(recurring.body.find((item: { eventKey: string }) => item.eventKey === 'brake@291')).toMatchObject({ turn: 1 });
  });

  it('attempt_list_largest_difference_has_turn', async () => {
    const attemptId = await attempt();
    await http().get(`/api/attempts/${attemptId}/review`).set('Cookie', cookie).expect(200);
    const list = await http().get(`/api/exercises/${exerciseId}/attempts`).set('Cookie', cookie).expect(200);
    const [summary] = list.body.days.flatMap((day: { attempts: object[] }) => day.attempts);
    expect(summary.largestDifference).toMatchObject({ kind: 'brake-early', eventKey: 'brake@291', turn: 1 });
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
    await as(http().get(`/api/attempts/${attemptId}/review`));
    await as(http().get(`/api/exercises/${exerciseId}/recurring`));
    const progress = await http().get('/api/progress').set('Cookie', other).expect(200);
    expect(progress.body).toEqual({ collections: [], exercises: [] });
  });
});
