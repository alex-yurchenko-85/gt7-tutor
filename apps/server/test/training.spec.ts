import { createWriteStream, readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenStream } from '@gt7/capture';
import { ENGLISH, type RawDatagram, type Sample, type ServerMsg } from '@gt7/contracts';
import { COMPARISON_VERSION, DEFAULT_CONFIG, DEFAULT_SIDE_CUE_DISTANCE_M, analyseReference, estimatedPhraseMs, replayCoach, toSample } from '@gt7/core';
import { RAW_STREAM_OPENER } from '../src/captures/capture.service.js';
import { SampleCache } from '../src/captures/sample-cache.js';
import { MONO_CLOCK } from '../src/clock/mono-clock.js';
import { LiveHub } from '../src/live/live-hub.service.js';
import { ReferencesService } from '../src/references/references.service.js';
import { TrainingService } from '../src/training/training.service.js';
import { DEMONSTRATION, TestApi, createReplayApp, type Range } from './support/api.js';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';
import { ManualSource, TestClock, fixtureRows, listen, openLive, type LiveConnection } from './support/live.js';
import { eventually } from '../../../tools/testing/eventually.js';
import type { FixtureReplays } from './support/replay-sources.js';
import { firstProfile } from './support/session.js';

const englishPhraseMs = (clip: string) => estimatedPhraseMs(ENGLISH, clip);

type GoldenCue = { id: string; decidedMonoMs: number };
const golden = JSON.parse(readFileSync(new URL('../../../fixtures/golden/ce-slow-cues.json', import.meta.url), 'utf8')) as {
  trace: { cues: GoldenCue[] };
};
const goldenKeys = golden.trace.cues.map(cue => cue.id.slice(cue.id.indexOf(':') + 1));
const goldenAt1M = JSON.parse(readFileSync(new URL('../../../fixtures/golden/ce-slow-cues-side-1m.json', import.meta.url), 'utf8')) as {
  trace: { cues: GoldenCue[] };
};
const goldenSideKeysAt1M = goldenAt1M.trace.cues.map(cue => cue.id.slice(cue.id.indexOf(':') + 1)).filter(key => key.startsWith('keep-'));

function fixtureSamples(rows: RawDatagram[], range: Range): Sample[] {
  return rows.filter(row => row.rawIndex >= range.first && row.rawIndex <= range.last).map(row => toSample(row)!);
}

class SwitchableOpener {
  failing = false;
  readonly open: OpenStream = path =>
    this.failing
      ? new Writable({
          write(_chunk, _encoding, callback) {
            callback(new Error('disk full'));
          }
        })
      : createWriteStream(path, { flags: 'wx' });
}

class GatedSampleCache extends SampleCache {
  private gate: Promise<void> | null = null;
  private openGate: () => void = () => undefined;
  waiting = false;

  close(): void {
    this.gate = new Promise(resolve => (this.openGate = resolve));
  }

  open(): void {
    this.gate = null;
    this.openGate();
  }

  override async read(...args: Parameters<SampleCache['read']>): ReturnType<SampleCache['read']> {
    if (this.gate) {
      this.waiting = true;
      await this.gate;
    }
    return super.read(...args);
  }
}

describe('training pipeline and live protocol', () => {
  let database: DisposableDatabase;
  let db: Knex;
  let app: INestApplication;
  let port: number;
  let replays: FixtureReplays;
  let clock: TestClock;
  let opener: SwitchableOpener;
  let samples: GatedSampleCache;
  let closed: boolean;
  let cookie: string;
  let exerciseId: string;
  let referenceId: string;
  let slowRun: RawDatagram[];
  let pauseRun: RawDatagram[];
  const sockets: LiveConnection[] = [];
  const api = new TestApi(() => app, () => replays, () => cookie);
  const http = () => api.http();

  async function live(session: string | null = cookie, headers: Record<string, string> = {}): Promise<LiveConnection> {
    const connection = await openLive(port, session ?? undefined, headers);
    sockets.push(connection);
    return connection;
  }

  async function voiceDevice(deviceId = 'desk'): Promise<LiveConnection> {
    const connection = await live();
    connection.send({ type: 'claim-voice', deviceId, ready: true });
    await connection.waitFor('state', message => message.state.voiceDeviceId === deviceId);
    return connection;
  }

  async function arm(source: string | ManualSource) {
    replays.queue.push(source);
    return http().post('/api/training/arm').set('Cookie', cookie).send({ exerciseId });
  }

  async function storedAttempts(count = 1) {
    return eventually(async () => {
      const rows = await db('attempts').where({ exercise_id: exerciseId }).orderBy('created_at');
      return rows.length >= count ? rows : null;
    });
  }

  function reportPlayed(voice: LiveConnection, startDelayMs = 30): void {
    voice.socket.on('message', data => {
      const message = JSON.parse(String(data)) as ServerMsg;
      if (message.type === 'cue') voice.send({ type: 'cue-outcome', cueId: message.cue.id, outcome: 'played', startDelayMs });
    });
  }

  async function completeRun(rows: RawDatagram[]): Promise<void> {
    const source = new ManualSource();
    await arm(source).then(response => expect(response.status).toBe(201));
    const before = (await db('attempts').where({ exercise_id: exerciseId })).length;
    source.emit(rows);
    await storedAttempts(before + 1);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
  }

  async function cueEvents(attemptId: string) {
    return db('cue_events').where({ attempt_id: attemptId }).orderBy('decided_mono_ms');
  }

  function firstPausedIndex(): number {
    return pauseRun.findIndex(row => toSample(row)?.paused === true);
  }

  beforeAll(async () => {
    database = await createMigratedDatabase();
    db = knex({ client: 'pg', connection: database.url });
    slowRun = await fixtureRows('ce-slow');
    pauseRun = await fixtureRows('ce-pause');
  });

  afterAll(async () => {
    await db.destroy();
    await database.drop();
  });

  beforeEach(async () => {
    await db.raw('truncate table users, sessions, settings cascade');
    clock = new TestClock();
    opener = new SwitchableOpener();
    samples = new GatedSampleCache();
    closed = false;
    ({ app, replays } = await createReplayApp(database.url, {
      override: builder =>
        builder
          .overrideProvider(MONO_CLOCK)
          .useValue(clock)
          .overrideProvider(RAW_STREAM_OPENER)
          .useValue(opener.open)
          .overrideProvider(SampleCache)
          .useValue(samples)
    }));
    port = await listen(app);
    cookie = await firstProfile(app);
    exerciseId = await api.exercise();
    referenceId = await api.reference(exerciseId, await api.capture(exerciseId, 'demo-a'));
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.socket.terminate();
    if (!closed) await app.close();
  });

  it('replay_slow_run_end_to_end', async () => {
    await arm('ce-slow').then(response => expect(response.status).toBe(201));
    await replays.finished();
    const [attempt] = await storedAttempts();
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    expect(attempt).toMatchObject({ completion: 'complete', reason: 'game-timer', first_raw_index: 391, last_raw_index: 1524 });
    expect(attempt.game_ms).toBe(18824);
    expect(Number((await db('attempt_findings').where({ attempt_id: attempt.id }).count('* as count'))[0]!.count)).toBeGreaterThan(0);
    const cues = (await cueEvents(attempt.id)).filter(row => !String(row.outcome).startsWith('suppressed'));
    expect(cues.map(row => row.event_key)).toEqual([...goldenKeys, 'focus']);
    expect(cues.every(row => row.outcome === 'no-device')).toBe(true);
    expect(await db('attempts').where({ exercise_id: exerciseId }).count('* as count')).toEqual([{ count: '1' }]);
  });

  it('training_stores_the_game_time', async () => {
    await arm('ce-clean').then(response => expect(response.status).toBe(201));
    await replays.finished();
    const [attempt] = await storedAttempts();
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    expect(attempt).toMatchObject({ completion: 'complete', reason: 'game-timer', game_ms: 17071 });
    expect(await db('attempts').where({ exercise_id: exerciseId }).count('* as count')).toEqual([{ count: '1' }]);
    const summary = await http().get(`/api/attempts/${attempt.id}`).set('Cookie', cookie).expect(200);
    expect(summary.body).toMatchObject({ timeMs: 17071 });
  });

  it('review_gap_uses_the_game_times', async () => {
    await arm('ce-pause').then(response => expect(response.status).toBe(201));
    await replays.finished();
    const [attempt] = await storedAttempts();
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    const summary = await http().get(`/api/attempts/${attempt.id}`).set('Cookie', cookie).expect(200);
    const review = await http().get(`/api/attempts/${attempt.id}/review`).set('Cookie', cookie).expect(200);
    expect(summary.body.timeMs).toBe(17412);
    expect(review.body.referenceTimeMs).toBe(16082);
    expect(summary.body.timeMs - review.body.referenceTimeMs).toBe(1330);
  });

  it('left_track_is_stored_as_aborted', async () => {
    await arm('ce-off-track-reset').then(response => expect(response.status).toBe(201));
    await replays.finished();
    const [attempt] = await storedAttempts();
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    expect(attempt).toMatchObject({ completion: 'aborted', reason: 'left-track', game_ms: null });
    expect(await db('attempts').where({ exercise_id: exerciseId }).count('* as count')).toEqual([{ count: '1' }]);
  });

  it('replay_slow_run_reports_gap', async () => {
    const source = new ManualSource();
    const watcher = await live();
    await arm(source).then(response => expect(response.status).toBe(201));
    source.emit(slowRun.slice(0, 1000));
    const driving = await watcher.waitFor('state', message => message.state.mode === 'driving' && typeof message.state.gapMs === 'number');
    expect(Number.isFinite(driving.state.gapMs)).toBe(true);
    expect(Math.abs(driving.state.gapMs!)).toBeLessThan(5000);
    source.emit(slowRun.slice(1000));
    await storedAttempts();
    const finished = await watcher.waitFor('state', message => message.state.mode === 'finished');
    expect(finished.state.gapMs).toBeNull();
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
  });

  it('live_attempt_number_continues_the_exercise_numbering', async () => {
    await completeRun(slowRun);
    await completeRun(slowRun);
    await completeRun(slowRun);
    const watcher = await live();
    const source = new ManualSource();
    await arm(source).then(response => expect(response.status).toBe(201));
    const armed = await watcher.waitFor('state', message => message.state.mode === 'armed');
    expect(armed.state.attemptNumber).toBeNull();
    source.emit(slowRun.slice(0, 1000));
    const first = await watcher.waitFor('state', message => message.state.mode === 'driving');
    expect(first.state.attemptNumber).toBe(4);
    source.emit(slowRun.slice(1000));
    await storedAttempts(4);
    const lastId = (await db('attempts').where({ exercise_id: exerciseId }).orderBy([{ column: 'started_at', order: 'desc' }]).first()).id;
    const summary = await http().get(`/api/attempts/${lastId}`).set('Cookie', cookie).expect(200);
    expect(summary.body.number).toBe(4);
    source.emit(slowRun.slice(0, 1000));
    const next = await watcher.waitFor('state', message => message.state.mode === 'driving' && message.state.generation > first.state.generation);
    expect(next.state.attemptNumber).toBe(5);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
  });

  it('start_at_once_after_stop_counts_the_stopped_attempt', async () => {
    const watcher = await live();
    const first = new ManualSource();
    await arm(first).then(response => expect(response.status).toBe(201));
    first.emit(slowRun.slice(0, 1000));
    const stopped = await watcher.waitFor('state', message => message.state.mode === 'driving');
    expect(stopped.state.attemptNumber).toBe(1);
    await db.raw("create function slow_attempt_insert() returns trigger language plpgsql as $$ begin perform pg_sleep(0.5); return new; end $$");
    await db.raw('create trigger slow_attempt_insert before insert on attempts for each row execute function slow_attempt_insert()');
    try {
      await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
      const second = new ManualSource();
      await arm(second).then(response => expect(response.status).toBe(201));
      second.emit(slowRun.slice(0, 1000));
      const driving = await watcher.waitFor('state', message => message.state.mode === 'driving' && message.state.generation > stopped.state.generation);
      const stored = await storedAttempts();
      expect(stored).toHaveLength(1);
      expect(driving.state.attemptNumber).toBe(stored.length + 1);
      await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    } finally {
      await db.raw('drop trigger if exists slow_attempt_insert on attempts');
      await db.raw('drop function if exists slow_attempt_insert()');
    }
  });

  it('live_state_shows_a_missed_start_when_armed_in_the_middle_of_a_run', async () => {
    const watcher = await live();
    const source = new ManualSource();
    await arm(source).then(response => expect(response.status).toBe(201));
    const armed = await watcher.waitFor('state', message => message.state.mode === 'armed');
    expect(armed.state.startMissed).toBe(false);
    source.emit(slowRun.filter(row => row.rawIndex >= 6000 && row.rawIndex <= 6300));
    const missed = await watcher.waitFor('state', message => message.state.startMissed);
    expect(missed.state.mode).toBe('armed');
    source.emit(slowRun.filter(row => row.rawIndex > 6300));
    await watcher.waitFor('state', message => message.state.seq > missed.state.seq && !message.state.startMissed);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    expect(await db('attempts').where({ exercise_id: exerciseId })).toEqual([]);
  });

  it('focus_cue_after_every_complete_attempt', async () => {
    const voice = await voiceDevice();
    const source = new ManualSource();
    await arm(source).then(response => expect(response.status).toBe(201));
    const finishIndex = 1521;
    source.emit(slowRun.slice(0, finishIndex - 20));
    await voice.waitFor('cue', message => message.cue.eventKey === 'ease-off@792');
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(voice.of('cue').filter(message => message.cue.kind === 'focus')).toEqual([]);
    source.emit(slowRun.slice(finishIndex - 20));
    const focus = await voice.waitFor('cue', message => message.cue.eventKey === 'focus');
    expect(focus.cue).toMatchObject({ kind: 'focus', clip: 'focus-approach-brake-late-1', followClip: null, priority: 10 });
    await voice.waitFor('state', message => message.state.mode === 'finished');
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(voice.of('cue').filter(message => message.cue.kind === 'focus')).toHaveLength(1);
    const [attempt] = await storedAttempts();
    const stored = (await cueEvents(attempt.id)).filter(row => row.event_key === 'focus');
    expect(stored).toEqual([expect.objectContaining({ kind: 'focus', outcome: 'sent' })]);
  });

  it('focus_cue_uses_the_stored_comparisons_and_reads_no_raw_file', async () => {
    await completeRun(slowRun);
    await completeRun(slowRun);
    const earlier = await storedAttempts(2);
    for (const row of earlier) {
      const comparison = await db('attempt_comparisons').where({ attempt_id: row.id }).first();
      const [first] = comparison.turn_losses as { turn: number; fromSM: number }[];
      await db('attempt_findings').where({ attempt_id: row.id }).delete();
      await db('attempt_findings').insert({ attempt_id: row.id, reference_id: referenceId, kind: 'brake-early', event_key: `brake@${first!.fromSM + 1}`, s_m: first!.fromSM + 1, size: 3, unit: 'm' });
    }
    const voice = await voiceDevice();
    const source = new ManualSource();
    await arm(source).then(response => expect(response.status).toBe(201));
    const samplesOf = vi.spyOn(app.get(ReferencesService), 'samplesOf');
    source.emit(slowRun);
    const focus = await voice.waitFor('cue', message => message.cue.eventKey === 'focus');
    expect(focus.cue).toMatchObject({ kind: 'focus', clip: 'focus-approach-brake-early-1' });
    await storedAttempts(3);
    expect(samplesOf).not.toHaveBeenCalled();
  });

  it('arm_calculates_old_comparisons_of_the_focus_window_again', async () => {
    await completeRun(slowRun);
    const [earlier] = await storedAttempts(1);
    await db('attempt_comparisons').where({ attempt_id: earlier!.id }).update({ version: 1, turn_losses: JSON.stringify([]) });
    const source = new ManualSource();
    await arm(source).then(response => expect(response.status).toBe(201));
    const refreshed = await eventually(async () => {
      const row = await db('attempt_comparisons').where({ attempt_id: earlier!.id }).first();
      return row.version === COMPARISON_VERSION ? row : null;
    });
    expect(refreshed.turn_losses.length).toBeGreaterThan(0);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
  });

  it('focus_cue_waits_for_the_focus_window_to_be_calculated_again', async () => {
    await completeRun(slowRun);
    const [earlier] = await storedAttempts(1);
    await db('attempt_comparisons').where({ attempt_id: earlier!.id }).update({ version: 1, turn_losses: JSON.stringify([]) });
    const voice = await voiceDevice();
    samples.close();
    try {
      const source = new ManualSource();
      await arm(source).then(response => expect(response.status).toBe(201));
      source.emit(slowRun);
      await voice.waitFor('state', message => message.state.mode === 'finished');
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(voice.of('cue').filter(message => message.cue.kind === 'focus')).toEqual([]);
    } finally {
      samples.open();
    }
    await voice.waitFor('cue', message => message.cue.eventKey === 'focus');
    expect(await db('attempt_comparisons').where({ attempt_id: earlier!.id }).first()).toMatchObject({ version: COMPARISON_VERSION });
    await storedAttempts(2);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
  });

  it('manual_training_route_does_not_exist', async () => {
    const source = new ManualSource();
    await arm(source).then(response => expect(response.status).toBe(201));
    await http().post('/api/training/manual').set('Cookie', cookie).send({ action: 'abort' }).expect(404);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    expect(await db('attempts').where({ exercise_id: exerciseId })).toEqual([]);
  });

  it('stop_during_a_running_attempt_stores_it_as_aborted_manual', async () => {
    const source = new ManualSource();
    const watcher = await live();
    await arm(source).then(response => expect(response.status).toBe(201));
    source.emit(slowRun.slice(0, 1000));
    await watcher.waitFor('state', message => message.state.mode === 'driving');
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    const [attempt] = await storedAttempts();
    expect(attempt).toMatchObject({ completion: 'aborted', reason: 'manual', game_ms: null });
  });

  it('no_focus_cue_after_an_aborted_attempt', async () => {
    const source = new ManualSource();
    const voice = await voiceDevice();
    await arm(source).then(response => expect(response.status).toBe(201));
    source.emit(slowRun.slice(0, 1000));
    await voice.waitFor('cue', message => message.cue.eventKey === 'brake@291');
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    const [attempt] = await storedAttempts();
    expect(attempt).toMatchObject({ completion: 'aborted', reason: 'manual' });
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(voice.of('cue').filter(message => message.cue.kind === 'focus')).toEqual([]);
    expect((await cueEvents(attempt.id)).filter(row => row.event_key === 'focus')).toEqual([]);
  });

  it('focus_cue_without_voice_device_is_no_device', async () => {
    await arm('ce-slow').then(response => expect(response.status).toBe(201));
    await replays.finished();
    const [attempt] = await storedAttempts();
    expect((await cueEvents(attempt.id)).filter(row => row.event_key === 'focus')).toEqual([
      expect.objectContaining({ kind: 'focus', outcome: 'no-device' })
    ]);
    const voice = await voiceDevice();
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(voice.of('cue')).toEqual([]);
  });

  it('speak_targets_setting_is_stored_and_snapshotted_at_arm', async () => {
    const voice = await voiceDevice();
    const source = new ManualSource();
    await arm(source).then(response => expect(response.status).toBe(201));
    await http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ speakTargets: false }).expect(200);
    source.emit(slowRun);
    const spoken = await voice.waitFor('cue', message => message.cue.eventKey === 'brake@291');
    expect(spoken.cue).toMatchObject({ kind: 'hard-brake', clip: 'hard-brake', followClip: 'speed-115', targetSpeedKph: 115 });
    await storedAttempts(1);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    voice.messages.splice(0);
    const next = new ManualSource();
    await arm(next).then(response => expect(response.status).toBe(201));
    next.emit(slowRun);
    const quiet = await voice.waitFor('cue', message => message.cue.eventKey === 'brake@291');
    expect(quiet.cue).toMatchObject({ clip: 'hard-brake', followClip: null, targetSpeedKph: 115 });
  });

  it('side_cue_distance_is_snapshotted_at_arm', async () => {
    const sideKeys = async (attemptIndex: number) => {
      const rows = await db('attempts').where({ exercise_id: exerciseId }).orderBy('created_at');
      const cues = await cueEvents(rows[attemptIndex].id);
      const spoken = cues.filter(row => !(row.outcome as string).startsWith('suppressed-'));
      return spoken.map(row => row.event_key as string).filter(key => key.startsWith('keep-'));
    };
    await http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ sideCueDistanceM: 1 }).expect(200);
    const source = new ManualSource();
    await arm(source).then(response => expect(response.status).toBe(201));
    await http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ sideCueDistanceM: null }).expect(200);
    source.emit(slowRun);
    await storedAttempts(1);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    await completeRun(slowRun);
    expect(goldenSideKeysAt1M.length).toBeGreaterThan(0);
    expect(await sideKeys(0)).toEqual(goldenSideKeysAt1M);
    expect(await sideKeys(1)).toEqual([]);
  });

  it('cue_offsets_are_validated_stored_and_snapshotted_at_arm', async () => {
    await http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ cueOffsetsMs: { 'brake@291': 1100 } }).expect(400);
    const decidedAt = async (attemptIndex: number) => {
      const rows = await db('attempts').where({ exercise_id: exerciseId }).orderBy('created_at');
      const cue = (await cueEvents(rows[attemptIndex].id)).find(row => row.event_key === 'brake@291')!;
      return cue.decided_mono_ms as number;
    };
    const source = new ManualSource();
    await arm(source).then(response => expect(response.status).toBe(201));
    await http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ cueOffsetsMs: { 'brake@291': 1000 } }).expect(200);
    source.emit(slowRun);
    await storedAttempts(1);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    await completeRun(slowRun);
    const goldenBrake = golden.trace.cues.find(cue => cue.id.endsWith(':brake@291'))!;
    expect(Math.round(await decidedAt(0))).toBe(goldenBrake.decidedMonoMs);
    const analysis = analyseReference(fixtureSamples(await fixtureRows('demo-a'), DEMONSTRATION), DEFAULT_CONFIG);
    const replayed = replayCoach(fixtureSamples(slowRun, { first: slowRun[0]!.rawIndex, last: slowRun.at(-1)!.rawIndex }), analysis, DEFAULT_CONFIG, {
      deviceDelayMs: 60,
      phraseMs: englishPhraseMs,
      mutedKeys: new Set(),
      speakTargets: true,
      offsetsMs: new Map([['brake@291', 1000]]),
      sideCueDistanceM: DEFAULT_SIDE_CUE_DISTANCE_M
    });
    const shifted = replayed.cues.find(cue => cue.id.endsWith(':brake@291'))!;
    expect(Math.round(await decidedAt(1))).toBe(shifted.decidedMonoMs);
    expect(shifted.decidedMonoMs).not.toBe(goldenBrake.decidedMonoMs);
  });

  it('reactions_count_the_played_brake_cues_of_every_attempt', async () => {
    const voice = await voiceDevice();
    reportPlayed(voice);
    await completeRun(slowRun);
    const reactions = await http().get(`/api/exercises/${exerciseId}/reactions`).set('Cookie', cookie).expect(200);
    expect(reactions.body.map((entry: { eventKey: string }) => entry.eventKey)).toEqual(['brake@291']);
    for (const entry of reactions.body) {
      expect(entry.count).toBe(1);
      expect(entry.medianMs).toBeGreaterThanOrEqual(-3000);
      expect(entry.medianMs).toBeLessThanOrEqual(3000);
    }
    const [attempt] = await storedAttempts();
    const played = (await cueEvents(attempt.id)).filter(row => row.event_kind === 'brake');
    expect(played.every(row => row.outcome === 'played' && row.start_delay_ms === 30)).toBe(true);
  });

  it('suppressed_brake_rows_store_event_kind_brake', async () => {
    await http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ mutedCues: ['brake@291'] }).expect(200);
    await completeRun(slowRun);
    const [attempt] = await storedAttempts();
    const rows = await cueEvents(attempt.id);
    const brake = rows.filter(row => row.event_key === 'brake@291');
    expect(brake).toEqual([expect.objectContaining({ kind: 'brake', event_kind: 'brake', outcome: 'suppressed-muted' })]);
    expect(Math.round(brake[0].s_m)).toBe(291);
    expect(rows.filter(row => row.event_key === 'big-stop@291')).toEqual([expect.objectContaining({ kind: 'big-stop', event_kind: 'big-stop', outcome: 'suppressed-muted' })]);
    const throttle = rows.find(row => row.event_key === 'throttle@411' && !String(row.outcome).startsWith('suppressed-'));
    expect(throttle).toMatchObject({ kind: 'full-throttle', event_kind: 'throttle' });
    expect(Math.round(throttle.s_m)).toBe(411);
    expect(rows.find(row => row.event_key === 'focus')).toMatchObject({ kind: 'focus', event_kind: 'focus', s_m: null });
  });

  it('wrong_address_goes_disconnected_after_5_s', async () => {
    clock.manual = 1000;
    const watcher = await live();
    await arm(new ManualSource()).then(response => expect(response.status).toBe(201));
    await watcher.waitFor('state', message => message.state.mode === 'armed' && message.state.connection === 'stale');
    clock.manual = 1000 + 5001;
    const state = await watcher.waitFor('state', message => message.state.mode === 'armed' && message.state.connection === 'disconnected');
    expect(state.state.exerciseId).toBe(exerciseId);
  });

  it('only_voice_device_receives_cues', async () => {
    const other = await live();
    const voice = await voiceDevice('phone');
    await other.waitFor('state', message => message.state.voiceDeviceId === 'phone' && message.state.voiceReady);
    await arm('ce-slow').then(response => expect(response.status).toBe(201));
    await replays.finished();
    await storedAttempts();
    await voice.waitFor('cue', message => message.cue.eventKey === 'focus');
    expect(voice.of('cue').map(message => message.cue.eventKey)).toEqual([...goldenKeys, 'focus']);
    expect(other.of('cue')).toEqual([]);
  });

  it('cue_and_ping_carry_the_server_clock', async () => {
    clock.manual = 40000;
    const voice = await voiceDevice('phone');
    const ping = await voice.waitFor('ping');
    expect(ping.serverMs).toBe(40000);
    clock.manual = null;
    await arm('ce-slow').then(response => expect(response.status).toBe(201));
    await replays.finished();
    await storedAttempts();
    const cue = await voice.waitFor('cue', message => message.cue.eventKey === 'brake@291');
    expect(typeof cue.sentMs).toBe('number');
  });

  it('state_names_the_reference', async () => {
    const watcher = await live();
    await arm(new ManualSource()).then(response => expect(response.status).toBe(201));
    const armed = await watcher.waitFor('state', message => message.state.mode === 'armed');
    expect(armed.state).toMatchObject({ referenceId });
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    const idle = await watcher.waitFor('state', message => message.state.mode === 'idle');
    expect(idle.state).toMatchObject({ referenceId: null });
  });

  it('voice_device_drop_keeps_recording', async () => {
    const source = new ManualSource();
    const voice = await voiceDevice();
    await arm(source).then(response => expect(response.status).toBe(201));
    source.emit(slowRun.slice(0, 700));
    await voice.waitFor('cue', message => message.cue.eventKey === 'brake@291');
    await voice.close();
    const user = await db('users').first();
    await eventually(() => !app.get(LiveHub).voiceReady(user.id));
    source.emit(slowRun.slice(700));
    const [attempt] = await storedAttempts();
    expect(attempt.completion).toBe('complete');
    const cues = (await cueEvents(attempt.id)).filter(row => !String(row.outcome).startsWith('suppressed'));
    expect(cues.slice(0, 2).map(row => [row.event_key, row.outcome])).toEqual([
      ['big-stop@291', 'sent'],
      ['brake@291', 'sent']
    ]);
    expect(cues.slice(2).length).toBeGreaterThan(0);
    expect(cues.slice(2).every(row => row.outcome === 'no-device')).toBe(true);
    const again = await live();
    await again.waitFor('state');
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(again.of('cue')).toEqual([]);
    expect(again.messages[0]!.type).toBe('state');
  });

  it('arm_without_a_voice_device_succeeds_and_records_cue_events', async () => {
    const accepted = await arm('ce-slow');
    expect(accepted.status).toBe(201);
    expect(accepted.body).toEqual({ captureId: expect.any(String), exerciseId, referenceId });
    const second = await arm('ce-slow');
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('busy');
    replays.queue.length = 0;
    await replays.finished();
    const [attempt] = await storedAttempts();
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    const cues = (await cueEvents(attempt.id)).filter(row => !String(row.outcome).startsWith('suppressed'));
    expect(cues.length).toBeGreaterThan(0);
    expect(cues.every(row => row.outcome === 'no-device')).toBe(true);
  });

  it('arm_refuses_a_field_that_is_not_in_the_request', async () => {
    replays.queue.push('ce-slow');
    await http().post('/api/training/arm').set('Cookie', cookie).send({ exerciseId, mode: 'guided' }).expect(400);
    replays.queue.length = 0;
  });

  it('concurrent_arm_requests_leave_one_training', async () => {
    const [first, second] = await Promise.all([arm(new ManualSource()), arm(new ManualSource())]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    replays.queue.length = 0;
    expect((await arm(new ManualSource())).status).toBe(201);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
  });

  async function armHeldAtReference(): Promise<{ response: Promise<request.Response> }> {
    samples.close();
    const response = arm(new ManualSource()).then(result => result);
    await eventually(() => samples.waiting);
    return { response };
  }

  async function openCaptures() {
    return db('captures').whereNull('ended_at');
  }

  it('disarm_during_arm_stops_the_new_capture', async () => {
    const armed = (await armHeldAtReference()).response;
    const disarm = http().post('/api/training/disarm').set('Cookie', cookie).then(result => result);
    await new Promise(resolve => setTimeout(resolve, 50));
    samples.open();
    expect((await armed).status).toBe(201);
    expect((await disarm).status).toBe(201);
    expect(await openCaptures()).toEqual([]);
    replays.queue.length = 0;
    expect((await arm(new ManualSource())).status).toBe(201);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
  });

  it('reference_delete_is_refused_while_a_training_uses_it', async () => {
    expect((await arm(new ManualSource())).status).toBe(201);
    const refused = await http().delete(`/api/references/${referenceId}`).set('Cookie', cookie);
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ code: 'reference-in-training' });
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    await app.get(TrainingService).idle();
    const active = await http().delete(`/api/references/${referenceId}`).set('Cookie', cookie).expect(409);
    expect(active.body.code).toBe('reference-active');
  });

  it('reference_delete_is_refused_while_a_training_arms', async () => {
    const armed = (await armHeldAtReference()).response;
    const refused = await http().delete(`/api/references/${referenceId}`).set('Cookie', cookie);
    samples.open();
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('reference-in-training');
    expect((await armed).status).toBe(201);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
  });

  it('reference_delete_after_disarm_keeps_the_last_attempt', async () => {
    const source = new ManualSource();
    const watcher = await live();
    expect((await arm(source)).status).toBe(201);
    source.emit(slowRun);
    await watcher.waitFor('state', message => message.state.mode === 'finished');
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    const refused = await http().delete(`/api/references/${referenceId}`).set('Cookie', cookie);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('reference-active');
    const [attempt] = await storedAttempts();
    expect(attempt.reference_id).toBe(referenceId);
  });

  it('capture_during_arm_is_409', async () => {
    const armed = (await armHeldAtReference()).response;
    replays.queue.push('demo-b');
    const capture = await http().post('/api/captures').set('Cookie', cookie).send({ exerciseId, purpose: 'demo' });
    expect(capture.status).toBe(409);
    expect(capture.body.code).toBe('busy');
    samples.open();
    expect((await armed).status).toBe(201);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    expect(await openCaptures()).toEqual([]);
  });

  it('shutdown_during_arm_leaves_no_open_capture', async () => {
    const armed = (await armHeldAtReference()).response;
    closed = true;
    const closing = app.close();
    await new Promise(resolve => setTimeout(resolve, 50));
    samples.open();
    await closing;
    expect((await armed).status).toBe(503);
    expect(await openCaptures()).toEqual([]);
  });

  it('new_generation_sends_cancel_first', async () => {
    const source = new ManualSource();
    const voice = await voiceDevice();
    await arm(source).then(response => expect(response.status).toBe(201));
    source.emit(slowRun.slice(300, 900));
    const firstCue = await voice.waitFor('cue');
    source.emit(slowRun.slice(300, 900), 100000);
    const secondCue = await voice.waitFor('cue', message => message.cue.generation > firstCue.cue.generation);
    const messages = voice.messages;
    const cancelIndex = messages.findIndex(message => message.type === 'cancel' && message.generation === firstCue.cue.generation);
    expect(cancelIndex).toBeGreaterThan(messages.indexOf(firstCue));
    expect(cancelIndex).toBeLessThan(messages.indexOf(secondCue));
    expect(secondCue.cue.id.startsWith(`${secondCue.cue.generation}:`)).toBe(true);
    await storedAttempts(1);
  });

  it('pause_sends_cancel', async () => {
    const source = new ManualSource();
    const voice = await voiceDevice();
    await arm(source).then(response => expect(response.status).toBe(201));
    source.emit(pauseRun.slice(0, firstPausedIndex() + 5));
    const paused = await voice.waitFor('state', message => message.state.mode === 'paused');
    const cancel = await voice.waitFor('cancel');
    expect(cancel.generation).toBe(paused.state.generation);
    expect(paused.state.generation).toBeGreaterThan(0);
  });

  it('device_delay_uses_ping_and_output_latency', async () => {
    clock.manual = 1000;
    const voice = await live();
    voice.send({ type: 'claim-voice', deviceId: 'desk', ready: true });
    const ping = await voice.waitFor('ping');
    clock.manual = 1040;
    voice.send({ type: 'pong', id: ping.id, outputLatencyMs: 30 });
    const user = await db('users').first();
    const hub = app.get(LiveHub);
    await eventually(() => hub.deviceDelayMs(user.id) === 50);
    expect(hub.deviceDelayMs(user.id)).toBe(50);
  });

  it('raw_write_failure_keeps_coaching', async () => {
    const voice = await voiceDevice();
    opener.failing = true;
    await arm('ce-slow').then(response => expect(response.status).toBe(201));
    await replays.finished();
    await voice.waitFor('cue');
    const state = await voice.waitFor('state', message => message.state.recordingComplete === false);
    expect(state.state.storageError).toContain('write-error');
    await storedAttempts();
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    const capture = await db('captures').where({ purpose: 'player' }).first();
    expect(capture).toMatchObject({ complete: false });
    expect(capture.error_reason).toContain('write-error');
  });

  it('state_rate_follows_the_client_choice', async () => {
    const fast = await live();
    fast.send({ type: 'state-rate', perSecond: 60 });
    const odd = await live();
    odd.send({ type: 'state-rate', perSecond: 45 });
    const plain = await live();
    await Promise.all([fast, odd, plain].map(watcher => watcher.waitFor('state')));
    const source = new ManualSource();
    await arm(source).then(response => expect(response.status).toBe(201));
    const watchers = [fast, odd, plain];
    const before = watchers.map(watcher => watcher.of('state').length);
    const started = performance.now();
    let next = 0;
    while (performance.now() - started < 600) {
      source.emit(slowRun.slice(next, next + 10));
      next += 10;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const [fastCount, oddCount, plainCount] = watchers.map((watcher, index) => watcher.of('state').length - before[index]!);
    expect(plainCount).toBeGreaterThan(2);
    expect(plainCount).toBeLessThanOrEqual(Math.ceil(0.6 * 15) + 2);
    expect(oddCount).toBeLessThanOrEqual(Math.ceil(0.6 * 15) + 2);
    expect(fastCount).toBeGreaterThan(2 * plainCount);
  });

  it('clock_jump_of_10_s_aborts_and_cancels', async () => {
    clock.manual = 0;
    const source = new ManualSource();
    const watcher = await live();
    await arm(source).then(response => expect(response.status).toBe(201));
    source.emit(slowRun.slice(0, 1000));
    clock.manual = slowRun[999]!.receivedMonoMs;
    const driving = await watcher.waitFor('state', message => message.state.mode === 'driving');
    clock.manual = slowRun[999]!.receivedMonoMs + 10000;
    await watcher.waitFor('cancel', message => message.generation === driving.state.generation);
    const [attempt] = await storedAttempts();
    expect(attempt).toMatchObject({ completion: 'aborted', reason: 'silence' });
  });

  it('unauthenticated_socket_is_closed', async () => {
    const anonymous = await live(null);
    expect((await anonymous.closed).code).toBe(4401);
    expect(anonymous.messages).toEqual([]);
    const foreign = await live(cookie, { Origin: 'http://evil.example' });
    expect((await foreign.closed).code).toBe(4403);
  });
});
