import { createWriteStream, readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OpenStream } from '@gt7/capture';
import type { LiveState, RawDatagram, Sample, ServerMsg } from '@gt7/contracts';
import { DEFAULT_CONFIG, DEFAULT_SIDE_CUE_DISTANCE_M, buildCueEvents, buildReference, estimatedPhraseMs, replayCoach, toSample } from '@gt7/core';

function fixtureSamples(rows: RawDatagram[], first: number, last: number): Sample[] {
  return rows.filter(row => row.rawIndex >= first && row.rawIndex <= last).map(row => toSample(row)!);
}
import { RAW_STREAM_OPENER } from '../src/captures/capture.service.js';
import { SampleCache } from '../src/captures/sample-cache.js';
import { TELEMETRY_SOURCE_FACTORY } from '../src/captures/telemetry-source.factory.js';
import { MONO_CLOCK } from '../src/clock/mono-clock.js';
import { LiveHub, type LiveClient } from '../src/live/live-hub.service.js';
import { createTestApp } from './support/app.js';
import { createMigratedDatabase, type DisposableDatabase } from './support/database.js';
import { ManualSource, TestClock, eventually, fixtureRows, openLive, type LiveConnection } from './support/live.js';
import { tempDir } from './support/process.js';
import { FixtureReplays } from './support/replay-sources.js';
import { firstProfile } from './support/session.js';

type GoldenCue = { id: string; decidedMonoMs: number };
const golden = JSON.parse(readFileSync(new URL('../../../fixtures/golden/player-run-cues.json', import.meta.url), 'utf8')) as {
  trace: { cues: GoldenCue[] };
};
const goldenKeys = golden.trace.cues.map(cue => cue.id.slice(cue.id.indexOf(':') + 1));
const goldenAt1M = JSON.parse(readFileSync(new URL('../../../fixtures/golden/player-run-cues-side-1m.json', import.meta.url), 'utf8')) as {
  trace: { cues: GoldenCue[] };
};
const goldenSideKeysAt1M = goldenAt1M.trace.cues.map(cue => cue.id.slice(cue.id.indexOf(':') + 1)).filter(key => key.startsWith('keep-'));

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
  let playerRun: RawDatagram[];
  let playerPause: RawDatagram[];
  const sockets: LiveConnection[] = [];
  const http = () => request(app.getHttpServer());

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

  async function arm(mode: 'baseline' | 'guided', source: string | ManualSource, confirmNoVoice?: boolean) {
    replays.queue.push(source);
    const body = confirmNoVoice === undefined ? { exerciseId, mode } : { exerciseId, mode, confirmNoVoice };
    return http().post('/api/training/arm').set('Cookie', cookie).send(body);
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

  async function guidedRun(rows: RawDatagram[]): Promise<void> {
    const source = new ManualSource();
    await arm('guided', source, true).then(response => expect(response.status).toBe(201));
    const before = (await db('attempts').where({ exercise_id: exerciseId })).length;
    source.emit(rows);
    await storedAttempts(before + 1);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
  }

  async function cueEvents(attemptId: string) {
    return db('cue_events').where({ attempt_id: attemptId }).orderBy('decided_mono_ms');
  }

  function firstPausedIndex(): number {
    return playerPause.findIndex(row => toSample(row)?.paused === true);
  }

  beforeAll(async () => {
    database = await createMigratedDatabase();
    db = knex({ client: 'pg', connection: database.url });
    playerRun = await fixtureRows('player-run');
    playerPause = await fixtureRows('player-pause');
  });

  afterAll(async () => {
    await db.destroy();
    await database.drop();
  });

  beforeEach(async () => {
    await db.raw('truncate table users, sessions, settings cascade');
    replays = new FixtureReplays();
    clock = new TestClock();
    opener = new SwitchableOpener();
    samples = new GatedSampleCache();
    closed = false;
    app = await createTestApp(database.url, {
      env: { DATA_DIR: tempDir(), TELEMETRY_SOURCE: 'replay' },
      override: builder =>
        builder
          .overrideProvider(TELEMETRY_SOURCE_FACTORY)
          .useValue(replays.factory)
          .overrideProvider(MONO_CLOCK)
          .useValue(clock)
          .overrideProvider(RAW_STREAM_OPENER)
          .useValue(opener.open)
          .overrideProvider(SampleCache)
          .useValue(samples)
    });
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as { port: number }).port;
    cookie = await firstProfile(app);
    exerciseId = (await http().post('/api/exercises').set('Cookie', cookie).send({ catalogueId: 'brand-yangwang-racing-lines' }).expect(201)).body.id;
    replays.queue.push('demo-wait05');
    const capture = await http().post('/api/captures').set('Cookie', cookie).send({ exerciseId, purpose: 'demo' }).expect(201);
    await replays.finished();
    await http().post(`/api/captures/${capture.body.id}/stop`).set('Cookie', cookie).expect(201);
    await http()
      .post('/api/references')
      .set('Cookie', cookie)
      .send({ exerciseId, captureId: capture.body.id, first: 352, last: 1897, startKind: 'flying' })
      .expect(201);
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.socket.terminate();
    if (!closed) await app.close();
  });

  it('replay_player_run_guided_end_to_end', async () => {
    await arm('guided', 'player-run', true).then(response => expect(response.status).toBe(201));
    await replays.finished();
    const [attempt] = await storedAttempts();
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    expect(attempt).toMatchObject({ mode: 'guided', completion: 'complete', reason: 'end-gate', first_raw_index: 1162 });
    expect(Math.abs(attempt.measured_ms - 27100)).toBeLessThanOrEqual(50);
    expect(Number((await db('attempt_findings').where({ attempt_id: attempt.id }).count('* as count'))[0]!.count)).toBeGreaterThan(0);
    const cues = (await cueEvents(attempt.id)).filter(row => !String(row.outcome).startsWith('suppressed'));
    expect(cues.map(row => row.event_key)).toEqual([...goldenKeys, 'focus']);
    expect(cues.every(row => row.outcome === 'no-device')).toBe(true);
    expect(await db('attempts').where({ exercise_id: exerciseId }).count('* as count')).toEqual([{ count: '1' }]);
  });

  it('baseline_mode_sends_no_cue_but_stores_findings', async () => {
    const voice = await voiceDevice();
    await arm('baseline', 'player-run').then(response => expect(response.status).toBe(201));
    await replays.finished();
    const [attempt] = await storedAttempts();
    expect(attempt).toMatchObject({ mode: 'baseline', completion: 'complete' });
    expect(Number((await db('attempt_findings').where({ attempt_id: attempt.id }).count('* as count'))[0]!.count)).toBeGreaterThan(0);
    expect(await cueEvents(attempt.id)).toEqual([]);
    expect(voice.of('cue')).toEqual([]);
  });

  it('focus_cue_after_a_complete_guided_attempt', async () => {
    const voice = await voiceDevice();
    const source = new ManualSource();
    await arm('guided', source).then(response => expect(response.status).toBe(201));
    const finishIndex = 2786;
    source.emit(playerRun.slice(0, finishIndex - 20));
    await voice.waitFor('cue', message => message.cue.eventKey === 'brake@1044');
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(voice.of('cue').filter(message => message.cue.kind === 'focus')).toEqual([]);
    source.emit(playerRun.slice(finishIndex - 20));
    const focus = await voice.waitFor('cue', message => message.cue.eventKey === 'focus');
    expect(focus.cue).toMatchObject({ kind: 'focus', clip: 'focus-brake-early-1', followClip: null, priority: 10 });
    await voice.waitFor('state', message => message.state.mode === 'finished');
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(voice.of('cue').filter(message => message.cue.kind === 'focus')).toHaveLength(1);
    const [attempt] = await storedAttempts();
    const stored = (await cueEvents(attempt.id)).filter(row => row.event_key === 'focus');
    expect(stored).toEqual([expect.objectContaining({ kind: 'focus', outcome: 'sent' })]);
  });

  it('no_focus_cue_after_an_aborted_attempt', async () => {
    const source = new ManualSource();
    const voice = await voiceDevice();
    await arm('guided', source).then(response => expect(response.status).toBe(201));
    source.emit(playerRun.slice(0, 1700));
    await voice.waitFor('cue', message => message.cue.eventKey === 'brake@332');
    await http().post('/api/training/manual').set('Cookie', cookie).send({ action: 'abort' }).expect(201);
    const [attempt] = await storedAttempts();
    expect(attempt.completion).toBe('aborted');
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(voice.of('cue').filter(message => message.cue.kind === 'focus')).toEqual([]);
    expect((await cueEvents(attempt.id)).filter(row => row.event_key === 'focus')).toEqual([]);
  });

  it('focus_cue_without_voice_device_is_no_device', async () => {
    await arm('guided', 'player-run', true).then(response => expect(response.status).toBe(201));
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
    await arm('guided', source).then(response => expect(response.status).toBe(201));
    await http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ speakTargets: false }).expect(200);
    source.emit(playerRun);
    const spoken = await voice.waitFor('cue', message => message.cue.eventKey === 'brake@332');
    expect(spoken.cue).toMatchObject({ kind: 'hard-brake', clip: 'hard-brake', followClip: 'speed-85', targetSpeedKph: 85 });
    await storedAttempts(1);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    voice.messages.splice(0);
    const next = new ManualSource();
    await arm('guided', next).then(response => expect(response.status).toBe(201));
    next.emit(playerRun);
    const quiet = await voice.waitFor('cue', message => message.cue.eventKey === 'brake@332');
    expect(quiet.cue).toMatchObject({ clip: 'hard-brake', followClip: null, targetSpeedKph: 85 });
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
    await arm('guided', source, true).then(response => expect(response.status).toBe(201));
    await http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ sideCueDistanceM: null }).expect(200);
    source.emit(playerRun);
    await storedAttempts(1);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    await guidedRun(playerRun);
    expect(goldenSideKeysAt1M.length).toBeGreaterThanOrEqual(3);
    expect(await sideKeys(0)).toEqual(goldenSideKeysAt1M);
    expect(await sideKeys(1)).toEqual([]);
  });

  it('cue_offsets_are_validated_stored_and_snapshotted_at_arm', async () => {
    await http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ cueOffsetsMs: { 'brake@677': 1100 } }).expect(400);
    const decidedAt = async (attemptIndex: number) => {
      const rows = await db('attempts').where({ exercise_id: exerciseId }).orderBy('created_at');
      const cue = (await cueEvents(rows[attemptIndex].id)).find(row => row.event_key === 'brake@677')!;
      return cue.decided_mono_ms as number;
    };
    const source = new ManualSource();
    await arm('guided', source, true).then(response => expect(response.status).toBe(201));
    await http().patch(`/api/exercises/${exerciseId}`).set('Cookie', cookie).send({ cueOffsetsMs: { 'brake@677': 1000 } }).expect(200);
    source.emit(playerRun);
    await storedAttempts(1);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    await guidedRun(playerRun);
    const goldenBrake = golden.trace.cues.find(cue => cue.id.endsWith(':brake@677'))!;
    expect(await decidedAt(0)).toBeCloseTo(goldenBrake.decidedMonoMs, 6);
    const path = buildReference(fixtureSamples(await fixtureRows('demo-wait05'), 352, 1897), 'flying');
    const replayed = replayCoach(fixtureSamples(playerRun, 0, playerRun.length - 1), path, buildCueEvents(path, DEFAULT_CONFIG), DEFAULT_CONFIG, {
      deviceDelayMs: 60,
      phraseMs: estimatedPhraseMs,
      mutedKeys: new Set(),
      speakTargets: true,
      offsetsMs: new Map([['brake@677', 1000]]),
      sideCueDistanceM: DEFAULT_SIDE_CUE_DISTANCE_M
    });
    const shifted = replayed.cues.find(cue => cue.id.endsWith(':brake@677'))!;
    expect(await decidedAt(1)).toBeCloseTo(shifted.decidedMonoMs, 6);
    expect(goldenBrake.decidedMonoMs - shifted.decidedMonoMs).toBeGreaterThan(800);
  });

  it('reactions_use_the_last_8_complete_guided_attempts', async () => {
    const voice = await voiceDevice();
    reportPlayed(voice);
    await guidedRun(playerRun);
    const reactions = await http().get(`/api/exercises/${exerciseId}/reactions`).set('Cookie', cookie).expect(200);
    expect(reactions.body.map((entry: { eventKey: string }) => entry.eventKey)).toEqual(['brake@332', 'brake@677', 'brake@832', 'brake@1044']);
    for (const entry of reactions.body) {
      expect(entry.count).toBe(1);
      expect(entry.medianMs).toBeGreaterThanOrEqual(-3000);
      expect(entry.medianMs).toBeLessThanOrEqual(3000);
    }
    const [attempt] = await storedAttempts();
    const played = (await cueEvents(attempt.id)).filter(row => String(row.event_key).startsWith('brake@'));
    expect(played.every(row => row.outcome === 'played' && row.start_delay_ms === 30)).toBe(true);
  });

  it('wrong_address_goes_disconnected_after_5_s', async () => {
    clock.manual = 1000;
    const watcher = await live();
    await arm('baseline', new ManualSource()).then(response => expect(response.status).toBe(201));
    await watcher.waitFor('state', message => message.state.mode === 'armed' && message.state.connection === 'stale');
    clock.manual = 1000 + 5001;
    const state = await watcher.waitFor('state', message => message.state.mode === 'armed' && message.state.connection === 'disconnected');
    expect(state.state.exerciseId).toBe(exerciseId);
  });

  it('only_voice_device_receives_cues', async () => {
    const other = await live();
    const voice = await voiceDevice('phone');
    await other.waitFor('state', message => message.state.voiceDeviceId === 'phone' && message.state.voiceReady);
    await arm('guided', 'player-run').then(response => expect(response.status).toBe(201));
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
    await arm('guided', 'player-run').then(response => expect(response.status).toBe(201));
    await replays.finished();
    await storedAttempts();
    const cue = await voice.waitFor('cue', message => message.cue.eventKey === 'brake@332');
    expect(typeof cue.sentMs).toBe('number');
  });

  it('state_names_the_training_mode_and_reference', async () => {
    const watcher = await live();
    const referenceId = (await http().get(`/api/exercises/${exerciseId}`).set('Cookie', cookie).expect(200)).body.activeReferenceId;
    await arm('baseline', new ManualSource()).then(response => expect(response.status).toBe(201));
    const armed = await watcher.waitFor('state', message => message.state.mode === 'armed');
    expect(armed.state).toMatchObject({ trainingMode: 'baseline', referenceId });
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    const idle = await watcher.waitFor('state', message => message.state.mode === 'idle');
    expect(idle.state).toMatchObject({ trainingMode: null, referenceId: null });
  });

  it('voice_device_drop_keeps_recording', async () => {
    const source = new ManualSource();
    const voice = await voiceDevice();
    await arm('guided', source).then(response => expect(response.status).toBe(201));
    source.emit(playerRun.slice(0, 1700));
    await voice.waitFor('cue', message => message.cue.eventKey === 'brake@332');
    await voice.close();
    const user = await db('users').first();
    await eventually(() => !app.get(LiveHub).voiceReady(user.id));
    source.emit(playerRun.slice(1700));
    const [attempt] = await storedAttempts();
    expect(attempt.completion).toBe('complete');
    const cues = (await cueEvents(attempt.id)).filter(row => !String(row.outcome).startsWith('suppressed'));
    expect(cues.slice(0, 2).map(row => [row.event_key, row.outcome])).toEqual([
      ['big-stop@332', 'sent'],
      ['brake@332', 'sent']
    ]);
    expect(cues.slice(2).length).toBeGreaterThan(0);
    expect(cues.slice(2).every(row => row.outcome === 'no-device')).toBe(true);
    const again = await live();
    await again.waitFor('state');
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(again.of('cue')).toEqual([]);
    expect(again.messages[0]!.type).toBe('state');
  });

  it('arm_guided_without_voice_needs_confirmation', async () => {
    const refused = await arm('guided', 'player-run');
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('voice-not-ready');
    replays.queue.length = 0;
    const accepted = await arm('guided', 'player-run', true);
    expect(accepted.status).toBe(201);
    const second = await arm('baseline', 'player-run');
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('busy');
    replays.queue.length = 0;
    await replays.finished();
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
  });

  it('concurrent_arm_requests_leave_one_training', async () => {
    const [first, second] = await Promise.all([arm('baseline', new ManualSource()), arm('baseline', new ManualSource())]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    replays.queue.length = 0;
    expect((await arm('baseline', new ManualSource())).status).toBe(201);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
  });

  async function armHeldAtReference(): Promise<{ response: Promise<request.Response> }> {
    samples.close();
    const response = arm('baseline', new ManualSource()).then(result => result);
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
    expect((await arm('baseline', new ManualSource())).status).toBe(201);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
  });

  it('capture_during_arm_is_409', async () => {
    const armed = (await armHeldAtReference()).response;
    replays.queue.push('demo-wait10');
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
    await arm('guided', source).then(response => expect(response.status).toBe(201));
    source.emit(playerRun.slice(1100, 1700));
    const firstCue = await voice.waitFor('cue');
    await http().post('/api/training/manual').set('Cookie', cookie).send({ action: 'abort' }).expect(201);
    source.emit(playerRun.slice(1100, 1700), 100000);
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
    await arm('guided', source).then(response => expect(response.status).toBe(201));
    source.emit(playerPause.slice(0, firstPausedIndex() + 5));
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
    await arm('guided', 'player-run').then(response => expect(response.status).toBe(201));
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

  it('state_rate_is_at_most_15_hz', async () => {
    const source = new ManualSource();
    const watcher = await live();
    await arm('baseline', source).then(response => expect(response.status).toBe(201));
    const before = watcher.of('state').length;
    const started = performance.now();
    let next = 0;
    while (performance.now() - started < 1200) {
      source.emit(playerRun.slice(next, next + 10));
      next += 10;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const count = watcher.of('state').length - before;
    expect(count).toBeGreaterThan(5);
    expect(count).toBeLessThanOrEqual(Math.ceil(1.2 * 15) + 2);
  });

  it('slow_client_is_skipped_not_queued', async () => {
    const hub = app.get(LiveHub);
    const user = await db('users').first();
    const received: LiveState[] = [];
    const client: LiveClient & { bufferedAmount: number } = {
      id: 'slow',
      userId: user.id,
      bufferedAmount: 300 * 1024,
      send: text => {
        const message = JSON.parse(text);
        if (message.type === 'state') received.push(message.state);
      }
    };
    hub.attach(client);
    expect(received).toHaveLength(1);
    for (let change = 0; change < 5; change++) {
      hub.changed();
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    expect(received).toHaveLength(1);
    client.bufferedAmount = 0;
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(received).toHaveLength(2);
    hub.detach(client);
  });

  it('clock_jump_of_10_s_aborts_and_cancels', async () => {
    clock.manual = 0;
    const source = new ManualSource();
    const watcher = await live();
    await arm('guided', source, true).then(response => expect(response.status).toBe(201));
    source.emit(playerRun.slice(0, 1500));
    clock.manual = playerRun[1499]!.receivedMonoMs;
    const driving = await watcher.waitFor('state', message => message.state.mode === 'driving');
    clock.manual = playerRun[1499]!.receivedMonoMs + 10000;
    await watcher.waitFor('cancel', message => message.generation === driving.state.generation);
    const [attempt] = await storedAttempts();
    expect(attempt).toMatchObject({ completion: 'aborted', reason: 'silence', measured_ms: null });
  });

  it('unauthenticated_socket_is_closed', async () => {
    const anonymous = await live(null);
    expect((await anonymous.closed).code).toBe(4401);
    expect(anonymous.messages).toEqual([]);
    const foreign = await live(cookie, { Origin: 'http://evil.example' });
    expect((await foreign.closed).code).toBe(4403);
  });
});
