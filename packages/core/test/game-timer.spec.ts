import type { Sample } from '@gt7/contracts';
import { describe, expect, it } from 'vitest';
import { GameTimerWatch, type GameTimerEvent } from '../src/game-timer.ts';
import { samplesOf, type FixtureName } from './fixtures.ts';

function eventsOf(samples: Sample[], watch = new GameTimerWatch()): GameTimerEvent[] {
  return samples.map(sample => watch.step(sample)).filter((event): event is GameTimerEvent => event !== null);
}

function fixtureEvents(name: FixtureName): GameTimerEvent[] {
  return eventsOf(samplesOf(name));
}

function synthetic(values: number[], packetIds?: number[]): Sample[] {
  const base = samplesOf('b3-run')[0]!;
  return values.map((gameTimerMs, index) => ({
    ...base,
    rawIndex: index,
    packetId: packetIds ? packetIds[index]! : index + 1,
    playerSession: true,
    paused: false,
    gameTimerMs,
  }));
}

describe('GameTimerWatch', () => {
  it('licence_run_starts_and_finishes_with_the_game_time', () => {
    expect(fixtureEvents('b3-run').slice(0, 2)).toEqual([
      { type: 'started', rawIndex: 5492, gameTimeMs: 16 },
      { type: 'finished', rawIndex: 6442, gameTimeMs: 15839 },
    ]);
  });

  it('standing_start_finishes_when_the_car_stops', () => {
    expect(fixtureEvents('b1-run').slice(0, 2)).toEqual([
      { type: 'started', rawIndex: 4184, gameTimeMs: 16 },
      { type: 'finished', rawIndex: 5405, gameTimeMs: 20366 },
    ]);
  });

  it('pause_is_not_a_finish', () => {
    expect(fixtureEvents('ce-pause')).toEqual([
      { type: 'started', rawIndex: 11565, gameTimeMs: 16 },
      { type: 'finished', rawIndex: 13306, gameTimeMs: 17412 },
    ]);
  });

  it('left_track_ends_the_run', () => {
    expect(fixtureEvents('ce-off-track-reset')).toEqual([
      { type: 'started', rawIndex: 7433, gameTimeMs: 16 },
      { type: 'left-track', rawIndex: 7974, gameTimeMs: -1 },
    ]);
  });

  it('background_timer_starts_nothing', () => {
    expect(fixtureEvents('ce-off-track-end')).toEqual([
      { type: 'started', rawIndex: 14386, gameTimeMs: 16 },
      { type: 'left-track', rawIndex: 14545, gameTimeMs: -1 },
    ]);
  });

  it('jump_to_the_final_value_is_not_a_start', () => {
    expect(fixtureEvents('b3-run').filter(event => event.rawIndex >= 7826)).toEqual([]);
  });

  it('repeated_packets_do_not_finish', () => {
    const samples = synthetic([0, 16, 33, 33, 33, 33, 33, 50], [1, 2, 3, 3, 3, 3, 3, 4]);
    expect(eventsOf(samples)).toEqual([{ type: 'started', rawIndex: 1, gameTimeMs: 16 }]);
  });

  it('restart_ends_the_run', () => {
    expect(eventsOf(synthetic([0, 16, 33, 0]))).toEqual([
      { type: 'started', rawIndex: 1, gameTimeMs: 16 },
      { type: 'restart', rawIndex: 3, gameTimeMs: 0 },
    ]);
  });

  it('packet_id_drop_during_a_run_counts_as_newer', () => {
    const samples = synthetic([0, 16, 33, 50, 66, 83, 0], [900_000, 900_001, 900_002, 10, 11, 12, 13]);
    expect(eventsOf(samples)).toEqual([
      { type: 'started', rawIndex: 1, gameTimeMs: 16 },
      { type: 'restart', rawIndex: 6, gameTimeMs: 0 },
    ]);
  });

  it('packet_id_wrap_counts_as_newer', () => {
    const samples = synthetic([0, 16, 33, 0], [0xfffffffe, 0xffffffff, 0, 1]);
    expect(eventsOf(samples)).toEqual([
      { type: 'started', rawIndex: 1, gameTimeMs: 16 },
      { type: 'restart', rawIndex: 3, gameTimeMs: 0 },
    ]);
  });

  it('packet_id_within_the_reorder_window_behind_changes_nothing', () => {
    const samples = synthetic([0, 16, 33, 0, 50], [100, 101, 102, 40, 103]);
    expect(eventsOf(samples)).toEqual([{ type: 'started', rawIndex: 1, gameTimeMs: 16 }]);
  });

  it('pause_after_the_timer_stops_is_not_a_finish', () => {
    const values = [0, 16, 33, 50, 50, 50, 50, 50, 50, 66, 83, 100, 100, 100, 100];
    const samples = synthetic(values).map((sample, index) => ({ ...sample, paused: index >= 6 && index <= 8 }));
    expect(eventsOf(samples)).toEqual([
      { type: 'started', rawIndex: 1, gameTimeMs: 16 },
      { type: 'finished', rawIndex: 11, gameTimeMs: 100 },
    ]);
  });

  it('demonstration_timer_runs_with_bit_0_false', () => {
    expect(eventsOf(samplesOf('demo-a'), new GameTimerWatch({ session: 'demonstration' })).slice(0, 2)).toEqual([
      { type: 'started', rawIndex: 458, gameTimeMs: 16 },
      { type: 'finished', rawIndex: 1422, gameTimeMs: 16082 },
    ]);
    expect(fixtureEvents('demo-a')).toEqual([]);
  });

  it('demonstration_watch_ignores_a_player_run', () => {
    expect(eventsOf(samplesOf('b3-run'), new GameTimerWatch({ session: 'demonstration' })).filter(event => event.rawIndex === 5492)).toEqual([]);
  });
});
