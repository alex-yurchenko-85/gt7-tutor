import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ReplaySource, readRaw } from '@gt7/capture';
import type { LiveState, Sample } from '@gt7/contracts';
import { clockWarmupStart, toSample } from '@gt7/core';
import { SampleCache } from '../src/captures/sample-cache.js';
import { MONO_CLOCK } from '../src/clock/mono-clock.js';
import { importRaceFile } from '../src/races/race-import.app.js';
import { RaceImport } from '../src/races/race-import.service.js';
import { RACE_SHUTDOWN_WAIT_MS } from '../src/races/race-recorder.service.js';
import { TestApi, createReplayApp } from './support/api.js';
import { createDisposableDatabase, createMigratedDatabase, migrationConfig, type DisposableDatabase } from './support/database.js';
import { ManualSource, TestClock, fixtureRows, listen, openLive, type LiveConnection } from './support/live.js';
import { raceRows, writeRaceRaw } from './support/race-raw.js';
import type { FixtureReplays } from './support/replay-sources.js';
import { PASSWORD, anotherProfile, cookiePair, firstProfile, sessionCookie } from './support/session.js';
import { eventually } from '../../../tools/testing/eventually.js';
import { testTempDir } from '../../../tools/testing/temp-root.js';
import { raceOf, renumber, syntheticSample } from '../../../packages/core/test/synthetic.js';

const THREE_LAPS = [60000, 58000, 59000];

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

function upTo(samples: Sample[], predicate: (sample: Sample) => boolean): Sample[] {
  return samples.slice(0, samples.findIndex(predicate) + 1);
}

class StuckSource extends ManualSource {
  override async stop(): Promise<void> {
    await super.stop();
    throw new Error('The source did not stop.');
  }
}

describe('race recorder', () => {
  let database: DisposableDatabase;
  let db: Knex;
  let app: INestApplication;
  let port: number;
  let replays: FixtureReplays;
  let dataDir: string;
  let clock: TestClock;
  let samples: GatedSampleCache;
  let cookie: string;
  let closed: boolean;
  const sockets: LiveConnection[] = [];
  const api = new TestApi(() => app, () => replays, () => cookie);
  const http = () => api.http();

  async function start(dir?: string): Promise<void> {
    clock = new TestClock();
    clock.manual = 1000;
    samples = new GatedSampleCache();
    ({ app, replays, dataDir } = await createReplayApp(database.url, {
      ...(dir ? { dataDir: dir } : {}),
      override: builder => builder.overrideProvider(MONO_CLOCK).useValue(clock).overrideProvider(SampleCache).useValue(samples)
    }));
    port = await listen(app);
    closed = false;
  }

  async function live(): Promise<LiveConnection> {
    const connection = await openLive(port, cookie);
    sockets.push(connection);
    return connection;
  }

  function latest(connection: LiveConnection): LiveState {
    return connection.of('state').at(-1)!.state;
  }

  async function stateWhere(connection: LiveConnection, predicate: (state: LiveState) => boolean): Promise<LiveState> {
    return (await connection.waitFor('state', message => predicate(message.state))).state;
  }

  async function replayRace(samples: Sample[]): Promise<ReplaySource> {
    const path = join(testTempDir('gt7-race-'), 'race.ndjson');
    writeRaceRaw(path, samples);
    const source = new ReplaySource({ path, speed: 0 });
    replays.queue.push(source);
    return source;
  }

  async function recordWith(source: ReplaySource | ManualSource): Promise<string> {
    replays.queue.push(source);
    return (await http().post('/api/races/record').set('Cookie', cookie).expect(201)).body.captureId as string;
  }

  async function record(): Promise<string> {
    return (await http().post('/api/races/record').set('Cookie', cookie).expect(201)).body.captureId as string;
  }

  async function stop(): Promise<string | null> {
    return (await http().post('/api/races/record/stop').set('Cookie', cookie).expect(201)).body.raceId as string | null;
  }

  async function indexAfter(connection: LiveConnection, from: number, predicate: (state: LiveState) => boolean): Promise<number> {
    const found = await eventually(() => {
      const index = connection.of('state').findIndex((message, position) => position >= from && predicate(message.state));
      return index < 0 ? null : { index };
    }, 5000);
    return found.index;
  }

  async function stateAfter(connection: LiveConnection, from: number, predicate: (state: LiveState) => boolean): Promise<LiveState> {
    const index = await indexAfter(connection, from, predicate);
    return connection.of('state')[index]!.state;
  }

  async function finishedRace(watcher: LiveConnection, source: ReplaySource, from = Math.max(0, watcher.of('state').length - 1)): Promise<LiveState> {
    await source.finished;
    const finished = await indexAfter(watcher, from, state => state.mode === 'race-running' && state.race?.phase === 'finished');
    clock.manual = clock.now() + 2001;
    return stateAfter(watcher, finished, state => state.mode === 'idle' && state.race?.phase === 'finished' && state.lastRaceId !== null);
  }

  async function recordRace(watcher: LiveConnection, samples: Sample[]): Promise<string> {
    const source = await replayRace(samples);
    const from = watcher.of('state').length;
    await record();
    return (await finishedRace(watcher, source, from)).lastRaceId!;
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
    await start();
    cookie = await firstProfile(app);
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.socket.terminate();
    if (!closed) await app.close();
  });

  it('records a race from the grid to the finish and stores it', async () => {
    const watcher = await live();
    const source = await replayRace(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }));
    const captureId = await record();
    const state = await finishedRace(watcher, source);
    expect(state.race).toMatchObject({ phase: 'finished', savedRaceId: state.lastRaceId });
    const rows = await db('race_laps').where({ race_id: state.lastRaceId }).orderBy('number');
    expect(rows.map(row => row.time_ms)).toEqual(THREE_LAPS);
    expect(await db('races').where({ id: state.lastRaceId }).first()).toMatchObject({
      capture_id: captureId,
      first_lap: 1,
      laps_in_race: 3,
      cars: 16,
      start_position: 8,
      finish_position: 5,
      race_ms: 177000,
      best_lap: 2,
      best_lap_ms: 58000,
      reference_lap: 2,
      complete: true,
      track_candidates: []
    });
    expect(await db('captures').where({ id: captureId }).first()).toMatchObject({ purpose: 'race', exercise_id: null, complete: true });
    expect((await http().get('/api/captures').set('Cookie', cookie).expect(200)).body).toEqual([
      expect.objectContaining({ id: captureId, purpose: 'race', exerciseId: null, active: false })
    ]);
  });

  it('stores the pit stop and the off-track moments of the race', async () => {
    const samples = raceOf({ laps: [60000, 58000, 59000, 61000], lapsInRace: 4, pitAfter: [2] });
    const lap3 = samples.findIndex(sample => sample.lap === 3 && !sample.loading && sample.speedMps > 1);
    const offTrack = samples.map((sample, index) => (index >= lap3 + 200 && index < lap3 + 230 ? { ...sample, surface: 'GGTT' } : sample));
    const watcher = await live();
    const source = await replayRace(offTrack);
    await record();
    const state = await finishedRace(watcher, source);
    expect(state.race!.laps.map(lap => lap.pitAfter)).toEqual([false, true, false, false]);
    const events = await db('race_events').where({ race_id: state.lastRaceId }).orderBy('kind');
    expect(events).toEqual([
      expect.objectContaining({ kind: 'off-track', lap: 3, wheels: 2, first_raw_index: lap3 + 200, last_raw_index: lap3 + 200, fuel_before: null }),
      expect.objectContaining({ kind: 'pit-stop', lap: 2, wheels: null, s_m: null, fuel_after: 100 })
    ]);
    const pit = events[1]!;
    const stop = offTrack[pit.first_raw_index]!;
    expect(pit.x).toBeCloseTo(stop.position.x, 3);
    expect(pit.z).toBeCloseTo(stop.position.z, 3);
    expect(pit.last_raw_index).toBeGreaterThan(pit.first_raw_index);
    expect((await db('race_laps').where({ race_id: state.lastRaceId }).orderBy('number')).map(row => [row.pit_in, row.pit_out])).toEqual([
      [false, false],
      [true, false],
      [false, true],
      [false, false]
    ]);
  });

  it('waits again when a grid ends before the start, then records the next race', async () => {
    const watcher = await live();
    const race = raceOf({ laps: THREE_LAPS, lapsInRace: 3 });
    const lost = Array.from({ length: 120 }, () => ({ ...race[0]!, lap: -1, lapsInRace: -1, racePosition: -1, carsInRace: -1, playerSession: false }));
    const samples = renumber([...race.filter(sample => sample.lap === 0), ...lost, ...race]);
    const source = await replayRace(samples);
    const captureId = await record();
    const state = await finishedRace(watcher, source);
    expect((await db('race_laps').where({ race_id: state.lastRaceId }).orderBy('number')).map(row => row.time_ms)).toEqual(THREE_LAPS);
    const capture = await db('captures').where({ id: captureId }).first();
    const stored = await db('races').where({ id: state.lastRaceId }).first();
    const gridMs = samples[race.filter(sample => sample.lap === 0).length + lost.length]!.receivedMonoMs;
    expect((stored.started_at as Date).getTime() - (capture.started_at as Date).getTime()).toBe(Math.round(gridMs));
  });

  it('answers 409 when the source does not start, and records after it', async () => {
    const watcher = await live();
    expect((await http().post('/api/races/record').set('Cookie', cookie).expect(409)).body.code).toBe('source-failed');
    expect(await stateWhere(watcher, state => state.mode === 'idle')).toMatchObject({ race: null });
    await recordWith(new ManualSource());
    await stateWhere(watcher, state => state.mode === 'race-waiting');
  });

  it('has no start position before the race starts', async () => {
    const watcher = await live();
    await recordWith(new ManualSource());
    expect((await stateWhere(watcher, state => state.mode === 'race-waiting')).race).toMatchObject({ phase: 'waiting', startPosition: null });
  });

  it('shows race-waiting, then race-running with the lap', async () => {
    const watcher = await live();
    const source = new ManualSource();
    await recordWith(source);
    expect((await stateWhere(watcher, state => state.mode === 'race-waiting')).race).toMatchObject({ phase: 'waiting', lap: 0, savedRaceId: null });
    const rows = raceRows(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }));
    source.emit(rows.slice(0, 20));
    expect((await stateWhere(watcher, state => state.race?.phase === 'grid')).mode).toBe('race-running');
    source.emit(rows.slice(20, 700));
    const running = await stateWhere(watcher, state => state.race?.lap === 2);
    expect(running).toMatchObject({ mode: 'race-running', race: { phase: 'lap', lap: 2, lapsInRace: 3 } });
  });

  it('gives the live lap list, position and lap times while a race runs', async () => {
    const watcher = await live();
    const source = new ManualSource();
    await recordWith(source);
    const samples = upTo(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }), sample => sample.lap === 2 && sample.gameTimerMs >= 2000);
    source.emit(raceRows(samples));
    const state = await stateWhere(watcher, state => (state.race?.lapTimeMs ?? 0) >= 2000);
    const last = samples.at(-1)!;
    const car = (await http().get('/api/cars/3602').set('Cookie', cookie).expect(200)).body.name as string;
    expect(state.race).toMatchObject({
      lap: 2,
      position: 7,
      startPosition: 8,
      cars: 16,
      lastLapMs: 60000,
      bestLap: 1,
      bestLapMs: 60000,
      laps: [{ number: 1, timeMs: 60000, pitAfter: false }],
      carName: car
    });
    expect(state.race!.lapTimeMs).toBeCloseTo(last.gameTimerMs, 0);
    expect(state.race!.x).toBeCloseTo(last.position.x, 3);
    expect(state.race!.z).toBeCloseTo(last.position.z, 3);
    expect(state.race!.fuel).toBeCloseTo(last.fuel, 3);
    expect(state.race!.fuelLapsLeft).toBeGreaterThan(8);
  });

  it('answers 409 busy while a training is armed, and a training answers 409 while a race records', async () => {
    const exerciseId = await api.exercise();
    await api.reference(exerciseId, await api.capture(exerciseId, 'demo-a'));
    replays.queue.push(new ManualSource());
    await http().post('/api/training/arm').set('Cookie', cookie).send({ exerciseId }).expect(201);
    const busy = await http().post('/api/races/record').set('Cookie', cookie).expect(409);
    expect(busy.body.code).toBe('busy');
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    await recordWith(new ManualSource());
    const training = await http().post('/api/training/arm').set('Cookie', cookie).send({ exerciseId }).expect(409);
    expect(training.body.code).toBe('busy');
    expect((await http().post('/api/races/record').set('Cookie', cookie).expect(409)).body.code).toBe('busy');
  });

  it('stores 2 of 3 laps as not complete when the recording is stopped', async () => {
    const watcher = await live();
    const source = new ManualSource();
    await recordWith(source);
    source.emit(raceRows(upTo(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }), sample => sample.lap === 3 && sample.gameTimerMs > 1000)));
    await stateWhere(watcher, state => state.race?.lap === 3);
    const raceId = await stop();
    expect(raceId).not.toBeNull();
    expect((await db('race_laps').where({ race_id: raceId }).orderBy('number')).map(row => row.time_ms)).toEqual([60000, 58000]);
    expect(await db('races').where({ id: raceId }).first()).toMatchObject({ complete: false, first_lap: 1, laps_in_race: 3 });
    const state = await stateWhere(watcher, state => state.mode === 'idle' && state.race?.phase === 'stopped');
    expect(state).toMatchObject({ lastRaceId: raceId, race: { savedRaceId: raceId } });
  });

  it('answers with an error and keeps the capture when the race cannot be stored', async () => {
    const watcher = await live();
    const source = new ManualSource();
    const captureId = await recordWith(source);
    source.emit(raceRows(upTo(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }), sample => sample.lap === 3)));
    await stateWhere(watcher, state => state.race?.lap === 3);
    await db.raw('alter table races add constraint races_blocked_check check (false) not valid');
    try {
      await http().post('/api/races/record/stop').set('Cookie', cookie).expect(500);
    } finally {
      await db.raw('alter table races drop constraint races_blocked_check');
    }
    expect(await db('captures').where({ id: captureId }).first()).toMatchObject({ purpose: 'race', complete: true });
    expect(await stateWhere(watcher, state => state.mode === 'idle' && state.race?.phase === 'stopped')).toMatchObject({ lastRaceId: null, race: { savedRaceId: null } });
  });

  it('closes the capture and frees the server when the source does not stop at the end of a race', async () => {
    const watcher = await live();
    const source = new StuckSource();
    const captureId = await recordWith(source);
    source.emit(raceRows(upTo(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }), sample => sample.lap === 3)));
    await stateWhere(watcher, state => state.race?.lap === 3);
    await http().post('/api/races/record/stop').set('Cookie', cookie).expect(500);
    expect(await stateWhere(watcher, state => state.mode === 'idle' && state.race?.phase === 'stopped')).toMatchObject({ lastRaceId: null, race: { savedRaceId: null } });
    const row = await db('captures').where({ id: captureId }).first();
    expect(row).toMatchObject({ purpose: 'race' });
    expect(existsSync(join(dataDir, row.raw_path as string))).toBe(true);
    await recordWith(new ManualSource());
    await stateWhere(watcher, state => state.mode === 'race-waiting');
  });

  it('keeps the last race in the live state when a new recording cannot start', async () => {
    const watcher = await live();
    const source = await replayRace(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }));
    await record();
    const state = await finishedRace(watcher, source);
    expect((await http().post('/api/races/record').set('Cookie', cookie).expect(409)).body.code).toBe('source-failed');
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(latest(watcher)).toMatchObject({ mode: 'idle', race: { phase: 'finished', savedRaceId: state.lastRaceId } });
  });

  it('stores nothing and removes the capture when no lap is complete', async () => {
    const watcher = await live();
    const source = new ManualSource();
    const captureId = await recordWith(source);
    const path = join(dataDir, (await db('captures').where({ id: captureId }).first()).raw_path as string);
    source.emit(raceRows(upTo(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }), sample => sample.lap === 1 && sample.gameTimerMs > 1000)));
    await stateWhere(watcher, state => state.race?.phase === 'lap');
    expect(await stop()).toBeNull();
    expect(await db('captures').where({ id: captureId }).first()).toBeUndefined();
    expect(existsSync(path)).toBe(false);
    expect(await db('races').count('* as count')).toEqual([{ count: '0' }]);
    const state = await stateWhere(watcher, state => state.race?.phase === 'stopped');
    expect(state).toMatchObject({ mode: 'idle', lastRaceId: null, race: { savedRaceId: null } });
  });

  it('cancels a recording that still waits without a race in the live state', async () => {
    const watcher = await live();
    const captureId = await recordWith(new ManualSource());
    await stateWhere(watcher, state => state.mode === 'race-waiting');
    expect(await stop()).toBeNull();
    expect(await stateWhere(watcher, state => state.mode === 'idle')).toMatchObject({ race: null, lastRaceId: null });
    expect(await db('captures').where({ id: captureId }).first()).toBeUndefined();
  });

  it('records a race that already runs from the next lap line, with the lap numbers of the game', async () => {
    const watcher = await live();
    const source = await replayRace(raceOf({ laps: [60000, 58000, 59000, 61000], lapsInRace: 4, joinAtLap: 2 }));
    await record();
    const joined = await stateWhere(watcher, state => state.race?.phase === 'joined' || state.race?.phase === 'lap' || state.race?.phase === 'finished');
    expect(joined.race).toMatchObject({ firstRecordedLap: 3, lapsInRace: 4 });
    const state = await finishedRace(watcher, source);
    const stored = await db('races').where({ id: state.lastRaceId }).first();
    expect(state.race!.startPosition).toBe(stored.start_position);
    expect(state.race!.laps).toEqual([
      { number: 3, timeMs: 59000, pitAfter: false },
      { number: 4, timeMs: 61000, pitAfter: false }
    ]);
    expect((await db('race_laps').where({ race_id: state.lastRaceId }).orderBy('number')).map(row => row.number)).toEqual([3, 4]);
    expect(await db('races').where({ id: state.lastRaceId }).first()).toMatchObject({ first_lap: 3, complete: false, race_ms: 120000 });
  });

  it('shows the phase stopped without a race when a join in the last lap reaches the finish', async () => {
    const watcher = await live();
    const source = await replayRace(raceOf({ laps: [60000, 58000, 59000], lapsInRace: 3, joinAtLap: 3 }));
    const captureId = await record();
    await source.finished;
    await stateWhere(watcher, state => state.race?.phase === 'finished');
    clock.manual = clock.now() + 2001;
    const state = await stateWhere(watcher, state => state.mode === 'idle' && state.race !== null);
    expect(state).toMatchObject({ lastRaceId: null, race: { phase: 'stopped', savedRaceId: null } });
    expect(await db('captures').where({ id: captureId }).first()).toBeUndefined();
  });

  it('keeps the phase finished with the saved race id until close', async () => {
    const watcher = await live();
    const source = await replayRace(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }));
    await record();
    const state = await finishedRace(watcher, source);
    clock.manual = 60000;
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(latest(watcher).race).toMatchObject({ phase: 'finished', savedRaceId: state.lastRaceId });
    await http().post('/api/races/record/close').set('Cookie', cookie).expect(201);
    expect(await stateWhere(watcher, current => current.race === null && current.lastRaceId === state.lastRaceId)).toMatchObject({ mode: 'idle' });
  });

  it('drops the finished race from the live state when a training starts', async () => {
    const exerciseId = await api.exercise();
    await api.reference(exerciseId, await api.capture(exerciseId, 'demo-a'));
    const watcher = await live();
    const source = await replayRace(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }));
    await record();
    await finishedRace(watcher, source);
    replays.queue.push(new ManualSource());
    await http().post('/api/training/arm').set('Cookie', cookie).send({ exerciseId }).expect(201);
    await stateWhere(watcher, state => state.mode === 'armed' && state.race === null);
    await http().post('/api/training/disarm').set('Cookie', cookie).expect(201);
    expect(await stateWhere(watcher, state => state.mode === 'idle')).toMatchObject({ race: null });
  });

  it('stores the complete laps when no packet comes for 10 000 ms during a race', async () => {
    const watcher = await live();
    const source = new ManualSource();
    await recordWith(source);
    source.emit(raceRows(upTo(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }), sample => sample.lap === 3 && sample.gameTimerMs > 1000)));
    await stateWhere(watcher, state => state.race?.lap === 3);
    clock.manual = 1000 + 9999;
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(latest(watcher).mode).toBe('race-running');
    clock.manual = 1000 + 10001;
    const state = await stateWhere(watcher, state => state.mode === 'idle' && state.race?.phase === 'stopped');
    expect((await db('race_laps').where({ race_id: state.lastRaceId }).orderBy('number')).map(row => row.time_ms)).toEqual([60000, 58000]);
  });

  it('keeps waiting without packets before the race', async () => {
    const watcher = await live();
    await recordWith(new ManualSource());
    clock.manual = 1000 + 60000;
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(latest(watcher)).toMatchObject({ mode: 'race-waiting', race: { phase: 'waiting' } });
  });

  it('does not record a licence test or a Circuit Experience section (laps in the race 1)', async () => {
    const watcher = await live();
    const source = new ManualSource();
    const captureId = await recordWith(source);
    const rows = await fixtureRows('b3-run');
    const samples = rows.map(row => toSample(row)!);
    const sessionStart = samples.find(sample => sample.playerSession)!.receivedMonoMs;
    source.emit(rows.slice(0, samples.findIndex(sample => sample.playerSession && sample.receivedMonoMs - sessionStart > 6000) + 1));
    const state = await stateWhere(watcher, state => state.race?.unsupported === true);
    expect(state).toMatchObject({ mode: 'race-waiting', race: { phase: 'waiting', lapsInRace: 0 } });
    expect(await stop()).toBeNull();
    expect(await db('captures').where({ id: captureId }).first()).toBeUndefined();
  });

  async function closeApp(): Promise<void> {
    await app.close();
    closed = true;
  }

  it('stores the complete laps as a race that is not finished when the server stops during a recording', async () => {
    const watcher = await live();
    const source = new ManualSource();
    const captureId = await recordWith(source);
    source.emit(raceRows(upTo(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }), sample => sample.lap === 3 && sample.gameTimerMs > 1000)));
    await stateWhere(watcher, state => state.race?.lap === 3);
    const kept = dataDir;
    await closeApp();
    const race = await db('races').where({ capture_id: captureId }).first();
    expect(race).toMatchObject({ complete: false, first_lap: 1, laps_in_race: 3 });
    expect((await db('race_laps').where({ race_id: race.id }).orderBy('number')).map(row => row.time_ms)).toEqual([60000, 58000]);
    expect(await db('captures').where({ id: captureId }).first()).toMatchObject({ complete: true, error_reason: null });
    await start(kept);
    cookie = cookiePair(sessionCookie(await http().post('/api/auth/sign-in').send({ name: 'Driver', password: PASSWORD }).expect(200)));
    expect((await http().get(`/api/races/${race.id}`).set('Cookie', cookie).expect(200)).body.laps).toHaveLength(2);
  });

  it('stores the whole race when the server stops 1 s after the finish', async () => {
    const watcher = await live();
    const source = await replayRace(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }));
    const captureId = await record();
    await source.finished;
    await stateWhere(watcher, state => state.race?.phase === 'finished');
    clock.manual = clock.now() + 1000;
    await closeApp();
    const race = await db('races').where({ capture_id: captureId }).first();
    expect(race).toMatchObject({ complete: true, laps_in_race: 3 });
    expect((await db('race_laps').where({ race_id: race.id }).orderBy('number')).map(row => row.time_ms)).toEqual(THREE_LAPS);
  });

  it('stores nothing and removes the capture when the server stops while the recording waits', async () => {
    const watcher = await live();
    const captureId = await recordWith(new ManualSource());
    await stateWhere(watcher, state => state.mode === 'race-waiting');
    const path = join(dataDir, (await db('captures').where({ id: captureId }).first()).raw_path as string);
    await closeApp();
    expect(await db('captures').where({ id: captureId }).first()).toBeUndefined();
    expect(existsSync(path)).toBe(false);
    expect(await db('races').count('* as count')).toEqual([{ count: '0' }]);
  });

  it('stops without the race when the save takes longer than the wait of the shutdown', async () => {
    await app.close();
    clock = new TestClock();
    clock.manual = 1000;
    samples = new GatedSampleCache();
    ({ app, replays, dataDir } = await createReplayApp(database.url, {
      override: builder =>
        builder.overrideProvider(MONO_CLOCK).useValue(clock).overrideProvider(SampleCache).useValue(samples).overrideProvider(RACE_SHUTDOWN_WAIT_MS).useValue(100)
    }));
    port = await listen(app);
    cookie = cookiePair(sessionCookie(await http().post('/api/auth/sign-in').send({ name: 'Driver', password: PASSWORD }).expect(200)));
    const watcher = await live();
    const source = new ManualSource();
    const captureId = await recordWith(source);
    source.emit(raceRows(upTo(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }), sample => sample.lap === 3 && sample.gameTimerMs > 1000)));
    await stateWhere(watcher, state => state.race?.lap === 3);
    samples.close();
    try {
      const started = Date.now();
      await closeApp();
      expect(Date.now() - started).toBeLessThan(5000);
      expect(samples.waiting).toBe(true);
      expect(await db('captures').where({ id: captureId }).first()).toMatchObject({ complete: false, error_reason: 'interrupted' });
      expect(await db('races').count('* as count')).toEqual([{ count: '0' }]);
    } finally {
      samples.open();
    }
  });

  it('answers 409 not-recording for a stop without a recording', async () => {
    expect((await http().post('/api/races/record/stop').set('Cookie', cookie).expect(409)).body.code).toBe('not-recording');
    await http().post('/api/races/record/close').set('Cookie', cookie).expect(201);
  });

  function offTrackRace(): Sample[] {
    const samples = raceOf({ laps: [60000, 58000, 59000, 61000], lapsInRace: 4, pitAfter: [2] });
    const lap3 = samples.findIndex(sample => sample.lap === 3 && !sample.loading && sample.speedMps > 1);
    const lap4 = samples.findIndex(sample => sample.lap === 4);
    const surfaceAt = (index: number) => {
      if (index >= lap3 + 150 && index < lap3 + 170) return 'GGGG';
      if (index >= lap3 + 300 && index < lap3 + 320) return 'GGTT';
      if (index >= lap4 + 200 && index < lap4 + 220) return 'GGGT';
      return null;
    };
    return samples.map((sample, index) => ({ ...sample, surface: surfaceAt(index) ?? sample.surface }));
  }

  function scaled(samples: Sample[], factor: number): Sample[] {
    return samples.map(sample => ({ ...sample, position: { x: sample.position.x * factor, y: 0, z: sample.position.z * factor }, speedMps: sample.speedMps * factor }));
  }

  async function carName(): Promise<string> {
    return (await http().get('/api/cars/3602').set('Cookie', cookie).expect(200)).body.name as string;
  }

  it('lists the races of the profile, newest first', async () => {
    const watcher = await live();
    const first = await recordRace(watcher, raceOf({ laps: THREE_LAPS, lapsInRace: 3 }));
    const second = await recordRace(watcher, raceOf({ laps: [60000, 58000, 59000, 61000], lapsInRace: 4, joinAtLap: 2 }));
    const list = (await http().get('/api/races').set('Cookie', cookie).expect(200)).body;
    expect(list.map((race: { id: string }) => race.id)).toEqual([second, first]);
    expect(list[1]).toEqual({
      id: first,
      trackName: null,
      trackCandidates: [],
      carId: 3602,
      carName: await carName(),
      firstLap: 1,
      lapsDone: 3,
      lapsInRace: 3,
      cars: 16,
      startPosition: 8,
      finishPosition: 5,
      raceMs: 177000,
      bestLap: 2,
      bestLapMs: 58000,
      pitStops: 0,
      offTrack: 0,
      complete: true,
      startedAt: (await db('races').where({ id: first }).first()).started_at.toISOString()
    });
    expect(list[0]).toMatchObject({ firstLap: 3, lapsDone: 2, lapsInRace: 4, complete: false, raceMs: 120000 });
  });

  it('gives the detail of a race with laps, pit stops and off-track moments per lap', async () => {
    const watcher = await live();
    const raceId = await recordRace(watcher, offTrackRace());
    const detail = (await http().get(`/api/races/${raceId}`).set('Cookie', cookie).expect(200)).body;
    expect(detail).toMatchObject({ id: raceId, lapsDone: 4, pitStops: 1, offTrack: 3, bestLap: 2, referenceLap: 4, complete: true });
    expect(detail.lapLengthM).toBeCloseTo(2 * Math.PI * 100, -1);
    expect(detail.laps.map((lap: Record<string, unknown>) => [lap.number, lap.pitIn, lap.pitOut, lap.closed, lap.offAll, lap.offPart])).toEqual([
      [1, false, false, false, 0, 0],
      [2, true, false, false, 0, 0],
      [3, false, true, false, 1, 1],
      [4, false, false, true, 0, 1]
    ]);
    expect(detail.laps[0]).toMatchObject({ timeMs: 60000, positionStart: 8, positionEnd: 8 });
    expect(detail.laps[0].topSpeedMps).toBeGreaterThan(0);
    expect(detail.laps[0].fuelStart).toBeGreaterThan(detail.laps[0].fuelEnd);
    expect(detail.pitStopList).toEqual([{ afterLap: 2, durationMs: expect.any(Number), fuelBefore: expect.any(Number), fuelAfter: 100, fromMs: expect.any(Number), toMs: expect.any(Number) }]);
    expect(detail.pitStopList[0].durationMs).toBeGreaterThan(0);
    const inLap = await db('race_laps').where({ race_id: raceId, number: 2 }).first();
    const stopRow = await db('race_events').where({ race_id: raceId, kind: 'pit-stop' }).first();
    const inLapEndMs = detail.laps[0].timeMs + detail.laps[1].timeMs;
    expect(detail.pitStopList[0].fromMs).toBeCloseTo(inLapEndMs - ((inLap.last_raw_index - stopRow.first_raw_index) * 1000) / 60, 3);
    expect(detail.pitStopList[0].fromMs).toBeLessThan(inLapEndMs);
    expect(detail.pitStopList[0].toMs).toBeCloseTo(detail.pitStopList[0].fromMs + detail.pitStopList[0].durationMs, 3);
    expect(detail.offTrackList.map((moment: Record<string, unknown>) => [moment.lap, moment.wheels])).toEqual([
      [3, 4],
      [3, 2],
      [4, 3]
    ]);
    expect(Object.keys(detail.offTrackList[0]).sort()).toEqual(['durationMs', 'lap', 'sM', 'speedInMps', 'speedMinMps', 'wheels', 'x', 'z']);
    expect(detail.recurring).toEqual([]);
    expect(detail.position[0]).toEqual({ tMs: 0, position: 8 });
    expect(detail.fuel.length).toBeGreaterThan(10);
  });

  it('names a race', async () => {
    const watcher = await live();
    const raceId = await recordRace(watcher, raceOf({ laps: THREE_LAPS, lapsInRace: 3 }));
    const renamed = await http().patch(`/api/races/${raceId}`).set('Cookie', cookie).send({ trackName: '  High Speed Ring ' }).expect(200);
    expect(renamed.body).toMatchObject({ id: raceId, trackName: 'High Speed Ring', lapsDone: 3 });
    expect((await http().get(`/api/races/${raceId}`).set('Cookie', cookie).expect(200)).body.trackName).toBe('High Speed Ring');
    await http().patch(`/api/races/${raceId}`).set('Cookie', cookie).send({ trackName: '   ' }).expect(400);
    await http().patch(`/api/races/${raceId}`).set('Cookie', cookie).send({ trackName: 'x'.repeat(81) }).expect(400);
    await http().patch(`/api/races/${raceId}`).set('Cookie', cookie).send({ trackName: 'A', other: 1 }).expect(400);
  });

  it('sets the track name when one circuit has the length of the lap, and keeps the 5 nearest candidates', async () => {
    const watcher = await live();
    const ovalM = 2 * Math.PI * 100;
    const single = await recordRace(watcher, scaled(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }), 3809 / ovalM));
    expect(await db('races').where({ id: single }).first()).toMatchObject({ track_name: 'Goodwood Motor Circuit', track_candidates: ['Goodwood Motor Circuit'] });
    const many = await recordRace(watcher, scaled(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }), 4309 / ovalM));
    const row = await db('races').where({ id: many }).first();
    expect(row.track_name).toBeNull();
    expect(row.track_candidates).toHaveLength(5);
    const summary = (await http().get('/api/races').set('Cookie', cookie).expect(200)).body.find((race: { id: string }) => race.id === many);
    expect(summary.trackCandidates).toEqual(row.track_candidates);
  });

  it('answers 404 for a race of another profile in every route', async () => {
    const watcher = await live();
    const raceId = await recordRace(watcher, raceOf({ laps: THREE_LAPS, lapsInRace: 3 }));
    const other = await anotherProfile(app, cookie, 'Second');
    expect((await http().get('/api/races').set('Cookie', other).expect(200)).body).toEqual([]);
    await http().get(`/api/races/${raceId}`).set('Cookie', other).expect(404);
    await http().patch(`/api/races/${raceId}`).set('Cookie', other).send({ trackName: 'Mine' }).expect(404);
    await http().post('/api/races/delete').set('Cookie', other).send({ ids: [raceId] }).expect(404);
    await http().get(`/api/races/${crypto.randomUUID()}`).set('Cookie', cookie).expect(404);
    await http().get('/api/races/not-a-uuid').set('Cookie', cookie).expect(400);
    expect(await db('races').where({ id: raceId }).first()).toMatchObject({ track_name: null });
  });

  it('deletes races, keeps the raw file and leaves no deleted id in the live state', async () => {
    const watcher = await live();
    const first = await recordRace(watcher, offTrackRace());
    const second = await recordRace(watcher, raceOf({ laps: THREE_LAPS, lapsInRace: 3 }));
    const captureId = (await db('races').where({ id: second }).first()).capture_id as string;
    await http().post('/api/races/delete').set('Cookie', cookie).send({ ids: [first, crypto.randomUUID()] }).expect(404);
    expect(await db('races').count('* as count')).toEqual([{ count: '2' }]);
    const from = watcher.of('state').length;
    const deleted = await http().post('/api/races/delete').set('Cookie', cookie).send({ ids: [second, first, second] }).expect(200);
    expect(deleted.body).toEqual({ deleted: 2 });
    expect(await db('races').count('* as count')).toEqual([{ count: '0' }]);
    expect(await db('race_laps').count('* as count')).toEqual([{ count: '0' }]);
    expect(await db('race_events').count('* as count')).toEqual([{ count: '0' }]);
    expect(existsSync(join(dataDir, (await db('captures').where({ id: captureId }).first()).raw_path as string))).toBe(true);
    expect(await stateAfter(watcher, from, state => state.race === null)).toMatchObject({ mode: 'idle', lastRaceId: null });
    await http().post('/api/races/delete').set('Cookie', cookie).send({ ids: [] }).expect(400);
  });

  it('keeps a stored race in the clean-up and removes the rest of its file', async () => {
    const watcher = await live();
    const menu = Array.from({ length: 1000 }, () => syntheticSample({ lap: -1, lapsInRace: -1, racePosition: -1, carsInRace: -1, playerSession: false }));
    const samples = renumber([...menu, ...raceOf({ laps: THREE_LAPS, lapsInRace: 3 })]);
    const raceId = await recordRace(watcher, samples);
    const race = await db('races').where({ id: raceId }).first();
    const path = join(dataDir, (await db('captures').where({ id: race.capture_id }).first()).raw_path as string);
    const before = (await http().get(`/api/races/${raceId}`).set('Cookie', cookie).expect(200)).body;
    expect(race.first_raw_index).toBe(1000);
    expect(race.last_raw_index).toBeLessThan(samples.length - 1);
    const cleaned = await http().post('/api/storage/cleanup').set('Cookie', cookie).expect(201);
    expect(cleaned.body.captures).toBe(1);
    const kept: number[] = [];
    for await (const row of readRaw(path)) kept.push(row.rawIndex);
    const first = clockWarmupStart(race.first_raw_index);
    expect(kept).toEqual(Array.from({ length: race.last_raw_index - first + 1 }, (_, index) => first + index));
    expect((await http().get(`/api/races/${raceId}`).set('Cookie', cookie).expect(200)).body).toEqual(before);
  });

  it('keeps the raw file of a race that is being saved in a clean-up', async () => {
    const watcher = await live();
    const source = new ManualSource();
    await recordWith(source);
    source.emit(raceRows(upTo(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }), sample => sample.lap === 3)));
    await stateWhere(watcher, state => state.race?.lap === 3);
    samples.close();
    const stopping = http().post('/api/races/record/stop').set('Cookie', cookie).then(response => response);
    try {
      await eventually(() => samples.waiting);
      expect((await http().post('/api/storage/cleanup').set('Cookie', cookie).expect(201)).body.captures).toBe(0);
    } finally {
      samples.open();
    }
    const stopped = await stopping;
    expect(stopped.status).toBe(201);
    expect(stopped.body.raceId).not.toBeNull();
    expect((await http().get(`/api/races/${stopped.body.raceId}`).set('Cookie', cookie).expect(200)).body).toMatchObject({ lapsDone: 2 });
    expect((await http().post('/api/storage/cleanup').set('Cookie', cookie).expect(201)).body.captures).toBe(1);
  });

  it('answers 409 raw-missing when the raw file is cut, empty or gone, while the list and the race still open', async () => {
    const watcher = await live();
    const raceId = await recordRace(watcher, raceOf({ laps: THREE_LAPS, lapsInRace: 3 }));
    const race = await db('races').where({ id: raceId }).first();
    const path = join(dataDir, (await db('captures').where({ id: race.capture_id }).first()).raw_path as string);
    const speed = async () => (await http().get(`/api/races/${raceId}/speed`).set('Cookie', cookie)).status;
    const rows: string[] = [];
    for await (const row of readRaw(path)) if (row.rawIndex > race.first_raw_index) rows.push(JSON.stringify(row));
    writeFileSync(path, `${rows.join('\n')}\n`);
    expect(await speed()).toBe(409);
    writeFileSync(path, '');
    expect(await speed()).toBe(409);
    unlinkSync(path);
    expect(await speed()).toBe(409);
    expect((await http().get('/api/races').set('Cookie', cookie).expect(200)).body[0]).toMatchObject({ id: raceId, lapsDone: 3 });
    expect((await http().get(`/api/races/${raceId}`).set('Cookie', cookie).expect(200)).body).toMatchObject({ lapsDone: 3 });
  });

  const BRAKE_RACE = { laps: [60000, 59000, 61000], lapsInRace: 3, brakeLater: { lap: 2, m: 20 } };

  it('compares two laps of a race with the series of both laps and a difference', async () => {
    const watcher = await live();
    const raceId = await recordRace(watcher, raceOf(BRAKE_RACE));
    const compare = (await http().get(`/api/races/${raceId}/compare?lap=2&with=1`).set('Cookie', cookie).expect(200)).body;
    expect(compare).toMatchObject({ lap: 2, withLap: 1, lapMs: 59000, withMs: 60000, gridM: 2 });
    expect(compare.lengthM).toBeCloseTo(2 * Math.PI * 100, -1);
    const cells = Math.floor(compare.lengthM / compare.gridM + 1e-9) + 1;
    for (const series of [compare.reference, compare.attempt]) expect(Object.keys(series).sort()).toEqual(['br', 'lat', 't', 'th', 'v', 'x', 'z']);
    expect(compare.attempt.v).toHaveLength(cells);
    expect(compare.reference.t).toHaveLength(cells);
    expect(compare.findings).toContainEqual(expect.objectContaining({ kind: 'brake-late', turn: expect.anything() }));
    expect(compare.referenceEvents.length).toBeGreaterThan(0);
    expect(compare.corners.length).toBeGreaterThan(0);
    expect(Object.keys(compare.corners[0]).sort()).toEqual(['apexSM', 'apexSpeedMps', 'number', 'outsideM', 'radiusM', 'speedMps', 'turnInSM', 'zoneFromSM', 'zoneToSM']);
    expect(compare.turnLosses.length).toBe(compare.corners.length);
    expect(compare.turnLosses[0]).toEqual({ turn: expect.any(Number), fromSM: expect.any(Number), toSM: expect.any(Number), lostMs: expect.any(Number) });
  });

  it('compares with the reference lap by default, and the reference lap with the best other lap', async () => {
    const watcher = await live();
    const raceId = await recordRace(watcher, raceOf(BRAKE_RACE));
    const compare = async (query: string) => (await http().get(`/api/races/${raceId}/compare?${query}`).set('Cookie', cookie).expect(200)).body;
    expect(await compare('lap=3')).toMatchObject({ lap: 3, withLap: 2 });
    expect(await compare('lap=2')).toMatchObject({ lap: 2, withLap: 1 });
  });

  it('gives the same compare again from memory and keeps the two laps of a pair apart', async () => {
    const watcher = await live();
    const raceId = await recordRace(watcher, raceOf(BRAKE_RACE));
    const compare = async (query: string) => (await http().get(`/api/races/${raceId}/compare?${query}`).set('Cookie', cookie).expect(200)).body;
    const first = await compare('lap=2&with=1');
    expect(await compare('lap=2&with=1')).toEqual(first);
    expect(await compare('lap=1&with=2')).toMatchObject({ lap: 1, withLap: 2, lapMs: 60000, withMs: 59000 });
    const speed = (await http().get(`/api/races/${raceId}/speed`).set('Cookie', cookie).expect(200)).body;
    expect((await http().get(`/api/races/${raceId}/speed`).set('Cookie', cookie).expect(200)).body).toEqual(speed);
  });

  it('answers 400 for an unknown lap or a lap against itself, and 409 without a lap to compare with', async () => {
    const watcher = await live();
    const raceId = await recordRace(watcher, raceOf(BRAKE_RACE));
    const status = async (query: string) => (await http().get(`/api/races/${raceId}/compare${query}`).set('Cookie', cookie)).status;
    const unknown = await http().get(`/api/races/${raceId}/compare?lap=4`).set('Cookie', cookie).expect(400);
    expect(unknown.body).toEqual({ code: 'unknown-lap', reason: 'Lap 4 is not in this race.' });
    expect(await status('?lap=1&with=4')).toBe(400);
    expect(await status('?lap=2&with=2')).toBe(400);
    expect(await status('?lap=0')).toBe(400);
    expect(await status('?lap=1.5')).toBe(400);
    expect(await status('')).toBe(400);
    expect(await status('?lap=1&other=2')).toBe(400);
    const single = await recordRace(watcher, raceOf({ laps: [60000, 58000, 59000, 61000], lapsInRace: 4, joinAtLap: 3 }));
    const lonely = await http().get(`/api/races/${single}/compare?lap=4`).set('Cookie', cookie).expect(409);
    expect(lonely.body.code).toBe('no-match');
  });

  it('gives the speed of every lap on the grid of the reference lap', async () => {
    const watcher = await live();
    const raceId = await recordRace(watcher, raceOf(BRAKE_RACE));
    const speed = (await http().get(`/api/races/${raceId}/speed`).set('Cookie', cookie).expect(200)).body;
    const cells = Math.floor(speed.lengthM / speed.gridM + 1e-9) + 1;
    expect(speed.laps.map((lap: { number: number }) => lap.number)).toEqual([1, 2, 3]);
    for (const lap of speed.laps) expect(lap.v).toHaveLength(cells);
    expect(speed.turns.length).toBeGreaterThan(0);
    expect(Object.keys(speed.turns[0]).sort()).toEqual(['fromSM', 'toSM', 'turn']);
  });

  it('gives the distance driven from the lap line on the race time', async () => {
    const watcher = await live();
    const raceId = await recordRace(watcher, raceOf(BRAKE_RACE));
    const { points } = (await http().get(`/api/races/${raceId}/distances`).set('Cookie', cookie).expect(200)).body as { points: { lap: number; tMs: number; sM: number }[] };
    expect(Object.keys(points[0]!).sort()).toEqual(['lap', 'sM', 'tMs']);
    expect([1, 2, 3].map(lap => points.find(point => point.lap === lap)!.sM)).toEqual([0, 0, 0]);
    expect(points.filter(point => point.lap === 2).at(-1)!.sM).toBeGreaterThan(500);
  });

  it('gives the line, the pit lane and the moments off the track', async () => {
    const watcher = await live();
    const raceId = await recordRace(watcher, offTrackRace());
    const view = (await http().get(`/api/races/${raceId}/off-track`).set('Cookie', cookie).expect(200)).body;
    const detail = (await http().get(`/api/races/${raceId}`).set('Cookie', cookie).expect(200)).body;
    const cells = Math.floor(view.lengthM / view.gridM + 1e-9) + 1;
    expect([view.x.length, view.z.length, view.heightM.length, view.speedMps.length]).toEqual([cells, cells, cells, cells]);
    expect(view.pitLane.map((lane: { lap: number }) => lane.lap)).toEqual([2, 3]);
    expect(view.moments).toEqual(detail.offTrackList);
    expect(view.recurring).toEqual(detail.recurring);
  });

  it('serves a race recorded from lap 5 with the lap numbers of the game', async () => {
    const watcher = await live();
    const raceId = await recordRace(watcher, raceOf({ laps: [60000, 58000, 59000, 61000, 60500, 59500, 62000], lapsInRace: 7, joinAtLap: 4 }));
    expect((await http().get(`/api/races/${raceId}`).set('Cookie', cookie).expect(200)).body).toMatchObject({ firstLap: 5, lapsDone: 3, referenceLap: 6 });
    expect((await http().get(`/api/races/${raceId}/compare?lap=7`).set('Cookie', cookie).expect(200)).body).toMatchObject({ lap: 7, withLap: 6, lapMs: 62000, withMs: 59500 });
    expect((await http().get(`/api/races/${raceId}/speed`).set('Cookie', cookie).expect(200)).body.laps.map((lap: { number: number }) => lap.number)).toEqual([5, 6, 7]);
    await http().get(`/api/races/${raceId}/off-track`).set('Cookie', cookie).expect(200);
    await http().get(`/api/races/${raceId}/compare?lap=4`).set('Cookie', cookie).expect(400);
  });

  it('answers 409 raw-missing when the raw file is gone, while the race still opens', async () => {
    const watcher = await live();
    const raceId = await recordRace(watcher, raceOf(BRAKE_RACE));
    await http().get(`/api/races/${raceId}/compare?lap=2`).set('Cookie', cookie).expect(200);
    const race = await db('races').where({ id: raceId }).first();
    unlinkSync(join(dataDir, (await db('captures').where({ id: race.capture_id }).first()).raw_path as string));
    for (const route of ['compare?lap=2', 'speed', 'off-track', 'distances']) {
      const response = await http().get(`/api/races/${raceId}/${route}`).set('Cookie', cookie).expect(409);
      expect(response.body).toEqual({ code: 'raw-missing', reason: 'The recording of this race is no longer on the disk.' });
    }
    expect((await http().get(`/api/races/${raceId}`).set('Cookie', cookie).expect(200)).body).toMatchObject({ id: raceId });
  });

  it('answers 404 for the views of a race of another profile and forgets the views of a deleted race', async () => {
    const watcher = await live();
    const raceId = await recordRace(watcher, raceOf(BRAKE_RACE));
    await http().get(`/api/races/${raceId}/speed`).set('Cookie', cookie).expect(200);
    const other = await anotherProfile(app, cookie, 'Second');
    for (const route of ['compare?lap=2', 'speed', 'off-track', 'distances']) await http().get(`/api/races/${raceId}/${route}`).set('Cookie', other).expect(404);
    await http().post('/api/races/delete').set('Cookie', cookie).send({ ids: [raceId] }).expect(200);
    await http().get(`/api/races/${raceId}/speed`).set('Cookie', cookie).expect(404);
  });

  it('refuses to stop a race recording through the capture route', async () => {
    const watcher = await live();
    const captureId = await recordWith(new ManualSource());
    await stateWhere(watcher, state => state.mode === 'race-waiting');
    const refused = await http().post(`/api/captures/${captureId}/stop`).set('Cookie', cookie).expect(409);
    expect(refused.body).toEqual({ code: 'not-active', reason: 'Stop a race recording on its own screen.' });
    expect((await http().get('/api/captures').set('Cookie', cookie).expect(200)).body[0]).toMatchObject({ id: captureId, active: true });
    expect(latest(watcher).mode).toBe('race-waiting');
    expect(await stop()).toBeNull();
  });

  function sourceFile(samples: Sample[]): string {
    const path = join(testTempDir('gt7-race-source-'), '2026-11-20T16-21-23-993Z-player.ndjson');
    writeRaceRaw(path, samples);
    writeFileSync(`${path}.summary.json`, '{"schemaVersion":1}\n');
    return path;
  }

  function withMenu(samples: Sample[]): Sample[] {
    const menu = Array.from({ length: 700 }, () => syntheticSample({ lap: -1, lapsInRace: -1, racePosition: -1, carsInRace: -1, playerSession: false }));
    return renumber([...menu, ...samples]);
  }

  function rawFiles(): string[] {
    const directory = join(dataDir, 'raw');
    return existsSync(directory) ? readdirSync(directory) : [];
  }

  it('imports a raw file as a race that is the same as a recorded race', async () => {
    const path = sourceFile(withMenu(raceOf({ laps: THREE_LAPS, lapsInRace: 3 })));
    const before = readFileSync(path);
    const { raceId, laterRace } = await app.get(RaceImport).importFile('Driver', path);
    expect(laterRace).toBe(false);
    expect(readFileSync(path).equals(before)).toBe(true);
    const list = (await http().get('/api/races').set('Cookie', cookie).expect(200)).body;
    expect(list).toEqual([expect.objectContaining({ id: raceId, firstLap: 1, lapsDone: 3, raceMs: 177000, bestLap: 2, complete: true, startPosition: 8, finishPosition: 5 })]);
    const race = await db('races').where({ id: raceId }).first();
    expect(race).toMatchObject({ first_raw_index: 700, track_name: null });
    const capture = await db('captures').where({ id: race.capture_id }).first();
    const sourceRows: { receivedUnixMs: number; rawIndex: number }[] = [];
    for await (const row of readRaw(path)) sourceRows.push(row);
    expect(capture).toMatchObject({ purpose: 'race', exercise_id: null, complete: true, packets: sourceRows.length, error_reason: null });
    expect((capture.started_at as Date).getTime()).toBe(sourceRows[0]!.receivedUnixMs);
    expect((capture.ended_at as Date).getTime()).toBe(sourceRows.at(-1)!.receivedUnixMs);
    expect((race.started_at as Date).getTime()).toBe(sourceRows.find(row => row.rawIndex === 700)!.receivedUnixMs);
    expect(rawFiles()).toEqual([basename(capture.raw_path as string)]);
    const copied: { captureId: string; peerIp: string; rawIndex: number; payloadBase64: string }[] = [];
    for await (const row of readRaw(join(dataDir, capture.raw_path as string))) copied.push(row);
    expect(copied.map(row => row.rawIndex)).toEqual(sourceRows.map(row => row.rawIndex));
    expect(new Set(copied.map(row => `${row.captureId}/${row.peerIp}`))).toEqual(new Set([`${capture.id}/0.0.0.0`]));
    expect((await http().get(`/api/races/${raceId}/compare?lap=3`).set('Cookie', cookie).expect(200)).body).toMatchObject({ lap: 3, withLap: 2 });
  });

  it('imports a race that already runs with the lap numbers of the game', async () => {
    const path = sourceFile(raceOf({ laps: [60000, 58000, 59000, 61000], lapsInRace: 4, joinAtLap: 2 }));
    const { raceId } = await app.get(RaceImport).importFile('Driver', path);
    expect((await http().get(`/api/races/${raceId}`).set('Cookie', cookie).expect(200)).body).toMatchObject({ firstLap: 3, lapsDone: 2, complete: false });
  });

  it('stores the first race of a file with two races and says that one more race is in it', async () => {
    const first = raceOf({ laps: THREE_LAPS, lapsInRace: 3 });
    const second = raceOf({ laps: [61000, 60000], lapsInRace: 2 });
    const { raceId, laterRace } = await app.get(RaceImport).importFile('Driver', sourceFile(withMenu([...first, ...withMenu(second)])));
    expect(laterRace).toBe(true);
    expect((await http().get('/api/races').set('Cookie', cookie).expect(200)).body).toEqual([expect.objectContaining({ id: raceId, lapsDone: 3 })]);
  });

  it('leaves no file and no row when the raw folder cannot be written', async () => {
    const directory = join(dataDir, 'raw');
    mkdirSync(directory, { recursive: true });
    chmodSync(directory, 0o500);
    try {
      await expect(app.get(RaceImport).importFile('Driver', sourceFile(raceOf({ laps: THREE_LAPS, lapsInRace: 3 })))).rejects.toMatchObject({ code: 'EACCES' });
    } finally {
      chmodSync(directory, 0o700);
    }
    expect(rawFiles()).toEqual([]);
    expect(await db('captures').count('* as count')).toEqual([{ count: '0' }]);
  });

  it('leaves no file and no row when the import fails', async () => {
    const importer = app.get(RaceImport);
    const noLap = sourceFile(upTo(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }), sample => sample.lap === 1 && sample.gameTimerMs > 1000));
    await expect(importer.importFile('Driver', noLap)).rejects.toThrow('No race with a complete lap is in the file.');
    await expect(importer.importFile('Nobody', sourceFile(raceOf({ laps: THREE_LAPS, lapsInRace: 3 })))).rejects.toThrow('No profile is named Nobody.');
    await expect(importer.importFile('Driver', join(testTempDir('gt7-race-missing-'), 'gone.ndjson'))).rejects.toThrow('The file does not exist');
    const broken = sourceFile(raceOf({ laps: THREE_LAPS, lapsInRace: 3 }));
    const lines = readFileSync(broken, 'utf8').split('\n');
    lines[500] = '{"broken":';
    writeFileSync(broken, lines.join('\n'));
    await expect(importer.importFile('Driver', broken)).rejects.toThrow(/Invalid raw row/);
    expect(rawFiles()).toEqual([]);
    expect(await db('captures').count('* as count')).toEqual([{ count: '0' }]);
    expect(await db('races').count('* as count')).toEqual([{ count: '0' }]);
  });

  it('imports through an application context that leaves the open capture of a running server alone', async () => {
    const userId = (await db('users').where({ name: 'Driver' }).first()).id as string;
    const [open] = await db('captures').insert({ user_id: userId, purpose: 'race', raw_path: 'raw/running.ndjson', started_at: new Date() }).returning('id');
    const result = await importRaceFile({ DATABASE_URL: database.url, DATA_DIR: dataDir }, 'Driver', sourceFile(raceOf({ laps: THREE_LAPS, lapsInRace: 3 })));
    expect(result).toMatchObject({ trackName: null, candidates: [], laps: [{ number: 1, timeMs: 60000 }, { number: 2, timeMs: 58000 }, { number: 3, timeMs: 59000 }], bestLap: 2, bestLapMs: 58000 });
    expect(await db('races').where({ id: result.raceId }).first()).toBeDefined();
    expect(await db('captures').where({ id: open.id }).first()).toMatchObject({ ended_at: null, error_reason: null });
    await expect(importRaceFile({ DATABASE_URL: database.url, DATA_DIR: dataDir }, 'Nobody', sourceFile(raceOf({ laps: THREE_LAPS, lapsInRace: 3 })))).rejects.toThrow('No profile is named Nobody.');
  });

  it('migrates down and up', async () => {
    const disposable = await createDisposableDatabase();
    const migrated = knex({ client: 'pg', connection: disposable.url });
    try {
      await migrated.migrate.latest(migrationConfig());
      const [user] = await migrated('users').insert({ name: 'racer', password_hash: 'x' }).returning('id');
      const capture = (purpose: string) => migrated('captures').insert({ user_id: user.id, purpose, raw_path: `raw/${purpose}.ndjson`, started_at: migrated.fn.now() }).returning('id');
      const [race] = await capture('race');
      await capture('player');
      const [stored] = await migrated('races')
        .insert({
          user_id: user.id,
          capture_id: race.id,
          first_raw_index: 0,
          last_raw_index: 10,
          car_id: 3602,
          first_lap: 1,
          laps_in_race: 3,
          cars: 16,
          start_position: 8,
          finish_position: 5,
          race_ms: 177000,
          best_lap: 2,
          best_lap_ms: 58000,
          reference_lap: 2,
          complete: true,
          position_steps: JSON.stringify([]),
          fuel_points: JSON.stringify([]),
          recurring: JSON.stringify([]),
          started_at: migrated.fn.now()
        })
        .returning('id');
      await migrated('race_laps').insert({ race_id: stored.id, number: 1, first_raw_index: 0, last_raw_index: 5, time_ms: 60000, position_start: 8, position_end: 8, top_speed_mps: 50, fuel_start: 100, fuel_end: 90, pit_in: false, pit_out: false });
      await expect(migrated('race_events').insert({ race_id: stored.id, kind: 'pause', lap: 1, x: 0, z: 0, duration_ms: 1, first_raw_index: 0, last_raw_index: 0 })).rejects.toMatchObject({ code: '23514' });
      await migrated.migrate.down(migrationConfig());
      expect((await migrated('captures').select('purpose')).map(row => row.purpose)).toEqual(['player']);
      await expect(capture('race')).rejects.toMatchObject({ code: '23514' });
      expect(await migrated.schema.hasTable('races')).toBe(false);
      await migrated.migrate.latest(migrationConfig());
      expect(await migrated.schema.hasTable('race_events')).toBe(true);
      await capture('race');
    } finally {
      await migrated.destroy();
      await disposable.drop();
    }
  });

  it('does not take a race capture as a capture of an exercise', async () => {
    const exerciseId = await api.exercise();
    const response = await http().post('/api/captures').set('Cookie', cookie).send({ exerciseId, purpose: 'race' }).expect(400);
    expect(response.status).toBe(400);
  });

  it('writes a synthetic race that decodes to the same samples', () => {
    const samples = raceOf({ laps: THREE_LAPS, lapsInRace: 3, pitAfter: [1] }).map(sample => ({ ...sample, surface: 'TGST', paused: sample.rawIndex === 5 }));
    const decoded = raceRows(samples).map(row => toSample(row)!);
    const fields = (sample: Sample) => ({ ...sample, position: null, velocity: null, speedMps: Math.round(sample.speedMps * 1000), fuel: Math.round(sample.fuel * 1000), throttle: Math.round(sample.throttle * 255), brake: Math.round(sample.brake * 255), gameTimerMs: Math.round(sample.gameTimerMs), flags: sample.flags & ~7 });
    expect(decoded.map(fields)).toEqual(samples.map(fields));
    decoded.forEach((sample, index) => expect(sample.position.x).toBeCloseTo(samples[index]!.position.x, 3));
  });
});
