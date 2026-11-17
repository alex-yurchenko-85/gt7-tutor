import { describe, expect, it } from 'vitest';
import type { Sample } from '@gt7/contracts';
import { AttemptTracker, type AttemptEvent, type BoundaryConfig } from '../src/attempts.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { gateAt } from '../src/geometry.ts';
import { between, samplesOf } from './fixtures.ts';
import { drive, FRAME_MS, renumber, straightLine, syntheticSample } from './synthetic.ts';

function yangwangBoundary(): BoundaryConfig {
  const demo = between(samplesOf('demo-wait05'), 352, 1897).map(sample => sample.position);
  return {
    start: gateAt(demo, 0, 'forward'),
    end: gateAt(demo, demo.length - 1, 'backward'),
    startKind: 'flying'
  };
}

function run(tracker: AttemptTracker, samples: Sample[]): AttemptEvent[] {
  return samples.flatMap(sample => tracker.step(sample));
}

function types(events: AttemptEvent[]): string[] {
  return events.map(event => event.type);
}

const straightBoundary: BoundaryConfig = {
  start: { position: { x: 0, y: 0, z: 0 }, tangent: { x: 1, y: 0, z: 0 } },
  end: { position: { x: 300, y: 0, z: 0 }, tangent: { x: 1, y: 0, z: 0 } },
  startKind: 'flying'
};

describe('AttemptTracker', () => {
  const playerRun = samplesOf('player-run');

  it('player_run_gives_one_attempt', () => {
    const events = run(new AttemptTracker(yangwangBoundary(), DEFAULT_CONFIG), playerRun);
    expect(types(events)).toEqual(['started', 'finished']);
    expect(Math.abs(events[0]!.rawIndex! - 1162)).toBeLessThanOrEqual(2);
    expect(Math.abs(events[1]!.rawIndex! - 2786)).toBeLessThanOrEqual(3);
    expect(events.every(event => event.generation === 1)).toBe(true);
  });

  it('auto_replay_never_reopens_finished_attempt', () => {
    const tracker = new AttemptTracker(yangwangBoundary(), DEFAULT_CONFIG);
    run(tracker, between(playerRun, 0, 3040));
    expect(tracker.state).toBe('finished');
    expect(run(tracker, between(playerRun, 3041, 3397))).toEqual([]);
    expect(tracker.state).toBe('finished');
  });

  it('transient_player_flag_at_replay_exit_is_not_new_start', () => {
    const tracker = new AttemptTracker(yangwangBoundary(), DEFAULT_CONFIG);
    run(tracker, between(playerRun, 0, 3397));
    const exit = between(playerRun, 3398, playerRun.length - 1);
    expect(exit.slice(0, 4).every(sample => sample.playerSession)).toBe(true);
    expect(run(tracker, exit)).toEqual([]);
    expect(tracker.state).toBe('finished');
  });

  it('moving_preview_does_not_start_player_coaching', () => {
    const tracker = new AttemptTracker(yangwangBoundary(), DEFAULT_CONFIG);
    expect(run(tracker, samplesOf('demo-wait05'))).toEqual([]);
    expect(tracker.state).toBe('waiting');
  });

  it('pause_keeps_attempt_but_emits_paused_and_resumed', () => {
    const events = run(new AttemptTracker(yangwangBoundary(), DEFAULT_CONFIG), samplesOf('player-pause'));
    expect(types(events).slice(0, 3)).toEqual(['started', 'paused', 'resumed']);
    expect(events[1]!.rawIndex).toBe(913);
    expect(events[2]!.rawIndex).toBe(1452);
    expect(new Set(events.map(event => event.generation))).toEqual(new Set([1]));
  });

  it('missing_player_flag_aborts', () => {
    const events = run(new AttemptTracker(yangwangBoundary(), DEFAULT_CONFIG), samplesOf('player-pause'));
    expect(types(events)).toEqual(['started', 'paused', 'resumed', 'aborted']);
    const aborted = events[3]!;
    expect(aborted.reason).toBe('player-session-ended');
    expect(aborted.rawIndex).toBe(1946);
  });

  it('silence_over_1000_ms_aborts_through_tick', () => {
    const tracker = new AttemptTracker(yangwangBoundary(), DEFAULT_CONFIG);
    const samples = between(playerRun, 1100, 1400);
    run(tracker, samples);
    const last = samples.at(-1)!.receivedMonoMs;
    expect(tracker.tick(last + 1000)).toEqual([]);
    const events = tracker.tick(last + 1001);
    expect(types(events)).toEqual(['aborted']);
    expect(events[0]!.reason).toBe('silence');
    expect(events[0]!.generation).toBe(1);
    expect(tracker.state).toBe('waiting');
    expect(tracker.tick(last + 5000)).toEqual([]);
  });

  it('teleport_aborts', () => {
    const tracker = new AttemptTracker(yangwangBoundary(), DEFAULT_CONFIG);
    const samples = between(playerRun, 1100, 1500).map(sample =>
      sample.rawIndex >= 1300 ? { ...sample, position: { ...sample.position, x: sample.position.x + 200 } } : sample
    );
    const events = run(tracker, samples);
    expect(types(events)).toEqual(['started', 'aborted']);
    expect(events[1]!.reason).toBe('discontinuity');
    expect(events[1]!.rawIndex).toBe(1300);
  });

  it('car_change_aborts', () => {
    const tracker = new AttemptTracker(yangwangBoundary(), DEFAULT_CONFIG);
    const samples = between(playerRun, 1100, 1500).map(sample =>
      sample.rawIndex >= 1300 ? { ...sample, carId: 3599 } : sample
    );
    const events = run(tracker, samples);
    expect(types(events)).toEqual(['started', 'aborted']);
    expect(events[1]!.reason).toBe('car-changed');
  });

  it('return_crossing_does_not_start_twice', () => {
    const tracker = new AttemptTracker(straightBoundary, DEFAULT_CONFIG);
    const samples = drive([
      ...straightLine({ fromX: -20, toX: 10, speedMps: 10 }),
      ...straightLine({ fromX: 10, toX: -10, speedMps: 10 }),
      ...straightLine({ fromX: -10, toX: 50, speedMps: 10 })
    ]);
    expect(types(run(tracker, samples))).toEqual(['started']);
  });

  it('finish_beside_the_reference_line_is_detected', () => {
    const events = run(new AttemptTracker(yangwangBoundary(), DEFAULT_CONFIG), samplesOf('h3-wide-finish'));
    expect(types(events)).toEqual(['started', 'finished']);
    expect(events[1]!.reason).toBe('end-gate');
    expect(Math.abs(events[1]!.rawIndex! - 6917)).toBeLessThanOrEqual(3);
  });

  it('reverse_crossing_does_not_start', () => {
    const tracker = new AttemptTracker(straightBoundary, DEFAULT_CONFIG);
    expect(run(tracker, drive(straightLine({ fromX: 20, toX: -20, speedMps: 10 })))).toEqual([]);
  });

  it('crossing_beside_the_gate_does_not_start', () => {
    const tracker = new AttemptTracker(straightBoundary, DEFAULT_CONFIG);
    expect(run(tracker, drive(straightLine({ fromX: -20, toX: 20, speedMps: 10, z: 8.5 })))).toEqual([]);
    expect(run(tracker, drive(straightLine({ fromX: -20, toX: 20, speedMps: 10, y: 3.5 })))).toEqual([]);
  });

  it('flying_start_time_is_interpolated', () => {
    const tracker = new AttemptTracker(straightBoundary, DEFAULT_CONFIG);
    const samples = drive(straightLine({ fromX: -0.25, toX: 2, speedMps: 30 }));
    const events = run(tracker, samples);
    expect(events[0]!.rawIndex).toBe(1);
    expect(events[0]!.atMonoMs).toBeCloseTo((0.25 / 30) * 1000, 6);
  });

  it('standing_start_needs_area_and_movement', () => {
    const standing: BoundaryConfig = { ...straightBoundary, startKind: 'standing' };
    const tracker = new AttemptTracker(standing, DEFAULT_CONFIG);
    const still = Array.from({ length: 30 }, () => ({ position: { x: 1, y: 0, z: 1 }, speedMps: 0 }));
    const creeping = Array.from({ length: 5 }, (_, index) => ({ position: { x: 1 + index * 0.005, y: 0, z: 1 }, speedMps: 0.3 }));
    const moving = Array.from({ length: 6 }, (_, index) => ({ position: { x: 1.03 + index * 0.01, y: 0, z: 1 }, speedMps: 0.6 }));
    const samples = drive([...still, ...creeping, moving[0]!, moving[1]!]);
    expect(run(tracker, samples)).toEqual([]);
    const third = renumber([syntheticSample({ position: moving[2]!.position, speedMps: 0.6 })], samples.length, samples.length * FRAME_MS);
    const events = run(tracker, third);
    expect(types(events)).toEqual(['started']);
    expect(events[0]!.rawIndex).toBe(35);
    expect(events[0]!.atMonoMs).toBeCloseTo(35 * FRAME_MS, 6);
  });

  it('standing_start_outside_area_does_not_start', () => {
    const standing: BoundaryConfig = { ...straightBoundary, startKind: 'standing' };
    const tracker = new AttemptTracker(standing, DEFAULT_CONFIG);
    const still = Array.from({ length: 30 }, () => ({ position: { x: 5, y: 0, z: 0 }, speedMps: 0 }));
    const moving = Array.from({ length: 10 }, (_, index) => ({ position: { x: 5 + index * 0.01, y: 0, z: 0 }, speedMps: 0.6 }));
    expect(run(tracker, drive([...still, ...moving]))).toEqual([]);
  });

  it('standing_start_without_stop_does_not_start', () => {
    const standing: BoundaryConfig = { ...straightBoundary, startKind: 'standing' };
    const tracker = new AttemptTracker(standing, DEFAULT_CONFIG);
    expect(run(tracker, drive(straightLine({ fromX: -10, toX: 10, speedMps: 20 })))).toEqual([]);
  });

  it('six_second_attempt_is_valid', () => {
    const tracker = new AttemptTracker(straightBoundary, DEFAULT_CONFIG);
    const events = run(tracker, drive(straightLine({ fromX: -10, toX: 310, speedMps: 50 })));
    expect(types(events)).toEqual(['started', 'finished']);
    expect(events[1]!.atMonoMs - events[0]!.atMonoMs).toBeCloseTo(6000, 0);
  });

  it('manual_finish_and_abort_work_without_gates', () => {
    const tracker = new AttemptTracker(straightBoundary, DEFAULT_CONFIG);
    expect(tracker.manual('finish', 10)).toEqual([]);
    expect(tracker.manual('abort', 10)).toEqual([]);
    const started = tracker.manual('start', 100);
    expect(started).toEqual([{ type: 'started', rawIndex: null, atMonoMs: 100, reason: 'manual', generation: 1 }]);
    expect(tracker.manual('start', 150)).toEqual([]);
    expect(tracker.manual('finish', 200)).toEqual([{ type: 'finished', rawIndex: null, atMonoMs: 200, reason: 'manual', generation: 1 }]);
    expect(tracker.state).toBe('finished');
    tracker.step(syntheticSample({ rawIndex: 7, position: { x: 100, y: 0, z: 40 } }));
    expect(tracker.manual('start', 300)[0]).toMatchObject({ type: 'started', rawIndex: 7, generation: 2 });
    expect(tracker.manual('abort', 400)).toEqual([{ type: 'aborted', rawIndex: 7, atMonoMs: 400, reason: 'manual', generation: 2 }]);
    expect(tracker.state).toBe('waiting');
  });

  it('manual_start_before_first_sample_keeps_driving', () => {
    const tracker = new AttemptTracker(yangwangBoundary(), DEFAULT_CONFIG);
    const samples = between(playerRun, 1300, 1400);
    expect(types(tracker.manual('start', samples[0]!.receivedMonoMs - 10))).toEqual(['started']);
    expect(run(tracker, samples)).toEqual([]);
    expect(tracker.state).toBe('driving');
  });

  it('manual_start_after_telemetry_gap_keeps_driving', () => {
    const tracker = new AttemptTracker(yangwangBoundary(), DEFAULT_CONFIG);
    const before = between(playerRun, 1300, 1310);
    run(tracker, before);
    const gapMs = 5000;
    const after = between(playerRun, 1311, 1400).map(sample => ({ ...sample, receivedMonoMs: sample.receivedMonoMs + gapMs }));
    tracker.manual('start', after[0]!.receivedMonoMs - 5);
    expect(run(tracker, after)).toEqual([]);
    expect(tracker.state).toBe('driving');
  });

  it('manual_start_without_samples_aborts_on_silence', () => {
    const tracker = new AttemptTracker(straightBoundary, DEFAULT_CONFIG);
    tracker.manual('start', 100);
    expect(tracker.tick(1100)).toEqual([]);
    expect(tracker.tick(1101)).toEqual([{ type: 'aborted', rawIndex: null, atMonoMs: 1100, reason: 'silence', generation: 1 }]);
  });

  it('manual_start_clears_standing_start_progress', () => {
    const standing: BoundaryConfig = { ...straightBoundary, startKind: 'standing' };
    const tracker = new AttemptTracker(standing, DEFAULT_CONFIG);
    const still = Array.from({ length: 30 }, () => ({ position: { x: 1, y: 0, z: 0 }, speedMps: 0 }));
    const moving = [0, 1].map(index => ({ position: { x: 1.01 + index * 0.01, y: 0, z: 0 }, speedMps: 0.6 }));
    const before = drive([...still, ...moving]);
    expect(run(tracker, before)).toEqual([]);
    const startMs = before.at(-1)!.receivedMonoMs + 5;
    expect(types(tracker.manual('start', startMs))).toEqual(['started']);
    const onward = renumber(drive(straightLine({ fromX: 1.05, toX: 320, speedMps: 20 })), before.length, startMs + 5);
    expect(types(run(tracker, onward))).toEqual(['finished']);
    expect(tracker.state).toBe('finished');
  });

  it('manual_start_measures_silence_from_the_start', () => {
    const tracker = new AttemptTracker(straightBoundary, DEFAULT_CONFIG);
    tracker.step(syntheticSample({ rawIndex: 1, receivedMonoMs: 0, position: { x: 50, y: 0, z: 0 }, speedMps: 20 }));
    tracker.manual('start', 900);
    expect(tracker.tick(1100)).toEqual([]);
    const next = syntheticSample({ rawIndex: 2, receivedMonoMs: 1200, position: { x: 51, y: 0, z: 0 }, speedMps: 20 });
    expect(tracker.step(next)).toEqual([]);
    expect(tracker.state).toBe('driving');
  });

  it('replay_without_tick_aborts_like_tick_after_manual_start', () => {
    const late = syntheticSample({ rawIndex: 9, receivedMonoMs: 20_000, position: { x: 60, y: 0, z: 0 }, speedMps: 20 });
    const live = new AttemptTracker(straightBoundary, DEFAULT_CONFIG);
    live.manual('start', 5000);
    const replay = new AttemptTracker(straightBoundary, DEFAULT_CONFIG);
    replay.manual('start', 5000);
    const expected = [{ type: 'aborted', rawIndex: null, atMonoMs: 6000, reason: 'silence', generation: 1 }];
    expect(live.tick(20_000)).toEqual(expected);
    expect(replay.step(late)).toEqual(expected);
    expect(replay.state).toBe('waiting');
  });

  it('manual_start_after_gap_has_no_old_raw_index', () => {
    const afterGap = new AttemptTracker(straightBoundary, DEFAULT_CONFIG);
    afterGap.step(syntheticSample({ rawIndex: 1, receivedMonoMs: 0 }));
    expect(afterGap.manual('start', 5000)[0]!.rawIndex).toBeNull();
    expect(afterGap.manual('abort', 5100)[0]!.rawIndex).toBeNull();
    const recent = new AttemptTracker(straightBoundary, DEFAULT_CONFIG);
    recent.step(syntheticSample({ rawIndex: 1, receivedMonoMs: 0 }));
    expect(recent.manual('start', 500)[0]!.rawIndex).toBe(1);
    expect(recent.manual('abort', 600)[0]!.rawIndex).toBe(1);
  });

  it('restart_teleport_right_after_manual_start_keeps_attempt', () => {
    const tracker = new AttemptTracker(straightBoundary, DEFAULT_CONFIG);
    tracker.step(syntheticSample({ rawIndex: 1, receivedMonoMs: 0, position: { x: 250, y: 0, z: 0 }, speedMps: 20 }));
    tracker.manual('start', 100);
    const teleported = syntheticSample({ rawIndex: 2, receivedMonoMs: 117, position: { x: 10, y: 0, z: 0 }, speedMps: 20 });
    expect(tracker.step(teleported)).toEqual([]);
    expect(tracker.state).toBe('driving');
  });

  it('three_retries_get_three_generations', () => {
    const tracker = new AttemptTracker(yangwangBoundary(), DEFAULT_CONFIG);
    const section = between(playerRun, 1100, 2800);
    const retries = renumber([...section, ...section, ...section], 0, 0);
    const events = run(tracker, retries);
    expect(types(events)).toEqual(['started', 'finished', 'started', 'finished', 'started', 'finished']);
    expect(events.map(event => event.generation)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('restart_during_attempt_aborts_then_starts_new_generation', () => {
    const tracker = new AttemptTracker(yangwangBoundary(), DEFAULT_CONFIG);
    const retries = renumber([...between(playerRun, 1100, 1800), ...between(playerRun, 1100, 2800)], 0, 0);
    const events = run(tracker, retries);
    expect(types(events)).toEqual(['started', 'aborted', 'started', 'finished']);
    expect(events[1]!.reason).toBe('discontinuity');
    expect(events.map(event => event.generation)).toEqual([1, 1, 2, 2]);
  });

  it('reset_returns_to_waiting_and_keeps_generation_counter', () => {
    const tracker = new AttemptTracker(straightBoundary, DEFAULT_CONFIG);
    tracker.manual('start', 0);
    tracker.reset();
    expect(tracker.state).toBe('waiting');
    expect(tracker.manual('start', 10)[0]!.generation).toBe(2);
  });
});
