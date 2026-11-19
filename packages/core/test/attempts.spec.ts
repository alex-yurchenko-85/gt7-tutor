import { describe, expect, it } from 'vitest';
import type { Sample } from '@gt7/contracts';
import { AttemptTracker, type AttemptEvent } from '../src/attempts.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { clockOf } from '../src/packet-clock.ts';
import { between, samplesOf } from './fixtures.ts';
import { renumber } from './synthetic.ts';

function run(tracker: AttemptTracker, samples: Sample[]): AttemptEvent[] {
  return samples.flatMap(sample => tracker.step(sample));
}

function types(events: AttemptEvent[]): string[] {
  return events.map(event => event.type);
}

function sampleAt(samples: Sample[], rawIndex: number): Sample {
  return samples.find(sample => sample.rawIndex === rawIndex)!;
}

function changedFrom(samples: Sample[], rawIndex: number, change: (sample: Sample) => Sample): Sample[] {
  return samples.map(sample => (sample.rawIndex >= rawIndex ? change(sample) : sample));
}

describe('AttemptTracker', () => {
  const b3Run = samplesOf('b3-run');
  const ceClean = samplesOf('ce-clean');

  it('attempt_starts_and_finishes_with_the_game_timer', () => {
    const events = run(new AttemptTracker(DEFAULT_CONFIG), b3Run);
    expect(types(events)).toEqual(['started', 'finished']);
    const [started, finished] = events;
    expect(started).toMatchObject({ rawIndex: 5492, reason: 'game-timer', gameTimeMs: null, generation: 1 });
    expect(started!.atClockMs).toBeCloseTo(clockOf(sampleAt(b3Run, 5492)) - 16, 6);
    expect(finished).toMatchObject({ rawIndex: 6442, reason: 'game-timer', gameTimeMs: 15839, generation: 1 });
    expect(finished!.atClockMs).toBeCloseTo(clockOf(sampleAt(b3Run, 6442)), 6);
    expect(finished!.atMonoMs).toBeCloseTo(sampleAt(b3Run, 6442).receivedMonoMs, 6);
  });

  it('left_track_aborts_the_attempt', () => {
    const events = run(new AttemptTracker(DEFAULT_CONFIG), samplesOf('ce-off-track-reset'));
    expect(types(events)).toEqual(['started', 'aborted']);
    expect(events[1]).toMatchObject({ rawIndex: 7974, reason: 'left-track', gameTimeMs: null });
  });

  it('pause_and_resume_still_reported', () => {
    const events = run(new AttemptTracker(DEFAULT_CONFIG), samplesOf('ce-pause'));
    expect(types(events)).toEqual(['started', 'paused', 'resumed', 'finished']);
    expect(events[1]!.rawIndex).toBe(11651);
    expect(events[2]!.rawIndex).toBe(12347);
    expect(events[3]).toMatchObject({ rawIndex: 13306, gameTimeMs: 17412 });
    expect(new Set(events.map(event => event.generation))).toEqual(new Set([1]));
  });

  it('armed_in_the_middle_of_a_run_waits_for_the_next_start', () => {
    const tracker = new AttemptTracker(DEFAULT_CONFIG);
    const events = run(tracker, between(b3Run, 6000, 7840));
    expect(events.filter(event => event.type === 'started')).toEqual([]);
    expect(tracker.state).toBe('waiting');
  });

  it('demonstration_timer_does_not_start_an_attempt', () => {
    const tracker = new AttemptTracker(DEFAULT_CONFIG);
    expect(run(tracker, samplesOf('demo-a'))).toEqual([]);
    expect(tracker.state).toBe('waiting');
  });

  it('missing_player_flag_aborts', () => {
    const samples = changedFrom(between(ceClean, 8070, 9200), 9000, sample => ({ ...sample, playerSession: false }));
    const events = run(new AttemptTracker(DEFAULT_CONFIG), samples);
    expect(types(events)).toEqual(['started', 'aborted']);
    expect(events[1]).toMatchObject({ rawIndex: 9000, reason: 'player-session-ended' });
  });

  it('loading_aborts', () => {
    const samples = changedFrom(between(ceClean, 8070, 9200), 9000, sample => ({ ...sample, loading: true }));
    const events = run(new AttemptTracker(DEFAULT_CONFIG), samples);
    expect(types(events)).toEqual(['started', 'aborted']);
    expect(events[1]).toMatchObject({ rawIndex: 9000, reason: 'loading' });
  });

  it('silence_over_1000_ms_aborts_through_tick', () => {
    const tracker = new AttemptTracker(DEFAULT_CONFIG);
    const samples = between(ceClean, 8070, 8700);
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

  it('silence_ends_the_game_timer_run', () => {
    const tracker = new AttemptTracker(DEFAULT_CONFIG);
    const before = between(ceClean, 8070, 8700);
    run(tracker, before);
    tracker.tick(before.at(-1)!.receivedMonoMs + 1001);
    expect(run(tracker, between(ceClean, 8701, 9700))).toEqual([]);
    expect(tracker.state).toBe('waiting');
  });

  it('teleport_aborts', () => {
    const samples = changedFrom(between(ceClean, 8070, 9200), 9000, sample => ({
      ...sample,
      position: { ...sample.position, x: sample.position.x + 200 }
    }));
    const events = run(new AttemptTracker(DEFAULT_CONFIG), samples);
    expect(types(events)).toEqual(['started', 'aborted']);
    expect(events[1]).toMatchObject({ rawIndex: 9000, reason: 'discontinuity' });
  });

  it('car_change_aborts', () => {
    const samples = changedFrom(between(ceClean, 8070, 9200), 9000, sample => ({ ...sample, carId: 3599 }));
    const events = run(new AttemptTracker(DEFAULT_CONFIG), samples);
    expect(types(events)).toEqual(['started', 'aborted']);
    expect(events[1]!.reason).toBe('car-changed');
  });

  it('user_abort_ends_only_a_running_attempt', () => {
    const tracker = new AttemptTracker(DEFAULT_CONFIG);
    expect(tracker.abortByUser(10)).toEqual([]);
    run(tracker, between(b3Run, 5100, 6000));
    const atMonoMs = sampleAt(b3Run, 6000).receivedMonoMs;
    const events = tracker.abortByUser(atMonoMs);
    expect(events).toEqual([expect.objectContaining({ type: 'aborted', rawIndex: 6000, atMonoMs, reason: 'manual', gameTimeMs: null, generation: 1 })]);
    expect(tracker.state).toBe('waiting');
    expect(tracker.abortByUser(atMonoMs + 10)).toEqual([]);
  });

  it('user_abort_ends_the_game_timer_run', () => {
    const tracker = new AttemptTracker(DEFAULT_CONFIG);
    run(tracker, between(b3Run, 5100, 6000));
    expect(types(tracker.abortByUser(sampleAt(b3Run, 6000).receivedMonoMs))).toEqual(['aborted']);
    expect(run(tracker, between(b3Run, 6001, 7840))).toEqual([]);
  });

  it('replay_without_tick_aborts_like_tick', () => {
    const samples = between(ceClean, 8070, 8700);
    const lastMs = samples.at(-1)!.receivedMonoMs;
    const late = { ...sampleAt(ceClean, 8701), receivedMonoMs: lastMs + 20_000 };
    const live = new AttemptTracker(DEFAULT_CONFIG);
    run(live, samples);
    const replay = new AttemptTracker(DEFAULT_CONFIG);
    run(replay, samples);
    const expected = live.tick(lastMs + 20_000);
    expect(expected).toEqual([expect.objectContaining({ type: 'aborted', rawIndex: 8700, atMonoMs: lastMs + 1000, reason: 'silence', generation: 1 })]);
    expect(replay.step(late)).toEqual(expected);
    expect(replay.state).toBe('waiting');
  });

  it('three_retries_get_three_generations', () => {
    const tracker = new AttemptTracker(DEFAULT_CONFIG);
    const section = between(ceClean, 8440, 9500);
    const retries = renumber([...section, ...section, ...section], 0, 0);
    const events = run(tracker, retries);
    expect(types(events)).toEqual(['started', 'finished', 'started', 'finished', 'started', 'finished']);
    expect(events.map(event => event.generation)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(events.filter(event => event.type === 'finished').map(event => event.gameTimeMs)).toEqual([17071, 17071, 17071]);
  });

  it('restart_during_attempt_aborts_then_starts_new_generation', () => {
    const tracker = new AttemptTracker(DEFAULT_CONFIG);
    const retries = renumber([...between(ceClean, 8440, 9000), ...between(ceClean, 8440, 9500)], 0, 0);
    const events = run(tracker, retries);
    expect(types(events)).toEqual(['started', 'aborted', 'started', 'finished']);
    expect(events[1]!.reason).toBe('restart');
    expect(events.map(event => event.generation)).toEqual([1, 1, 2, 2]);
  });

  it('reset_returns_to_waiting_and_keeps_generation_counter', () => {
    const tracker = new AttemptTracker(DEFAULT_CONFIG);
    const section = between(ceClean, 8070, 8700);
    run(tracker, section);
    tracker.reset();
    expect(tracker.state).toBe('waiting');
    const again = renumber(section, section.at(-1)!.rawIndex + 1, section.at(-1)!.receivedMonoMs + 5000);
    expect(run(tracker, again)[0]).toMatchObject({ type: 'started', generation: 2 });
  });
});
