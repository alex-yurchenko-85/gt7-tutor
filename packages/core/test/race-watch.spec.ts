import { describe, expect, it } from 'vitest';
import type { Sample } from '@gt7/contracts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { RaceWatch, type RaceWatchEvent } from '../src/race-watch.ts';
import { samplesOf } from './fixtures.ts';
import { renumber, syntheticSample } from './synthetic.ts';

function feed(samples: Sample[], watch = new RaceWatch(DEFAULT_CONFIG)): RaceWatchEvent[] {
  return samples.flatMap(sample => watch.push(sample));
}

function runningWatch(o: { lap: number; lapsInRace: number }): RaceWatch {
  const watch = new RaceWatch(DEFAULT_CONFIG);
  const laps = Array.from({ length: o.lap + 1 }, (_, lap) => syntheticSample({ lap, lapsInRace: o.lapsInRace }));
  feed(laps, watch);
  return watch;
}

function repeated(count: number, overrides: Partial<Sample>): Sample[] {
  return Array.from({ length: count }, () => syntheticSample(overrides));
}

describe('RaceWatch', () => {
  it('finds_the_grid_and_the_start_in_a_real_race', () => {
    const events = feed(samplesOf('race-grid-start'));
    expect(events.map(event => event.type)).toEqual(['grid', 'start']);
    expect(events[0]).toMatchObject({ lapsInRace: 5 });
    expect(events).toEqual([
      { type: 'grid', rawIndex: 688, lapsInRace: 5 },
      { type: 'start', rawIndex: 1073 }
    ]);
  });

  it('gives_the_lap_time_at_the_lap_line', () => {
    const watch = runningWatch({ lap: 1, lapsInRace: 5 });
    const events = samplesOf('race-lap-line').flatMap(sample => watch.push(sample));
    expect(events).toEqual([expect.objectContaining({ type: 'lap', lap: 1, lastLapMs: 83585 })]);
    expect(watch.lap).toBe(2);
    expect(watch.lapsInRace).toBe(5);
  });

  it('finishes_when_the_lap_counter_passes_the_laps_in_the_race', () => {
    const watch = runningWatch({ lap: 5, lapsInRace: 5 });
    const events = samplesOf('race-finish').flatMap(sample => watch.push(sample));
    expect(events.map(event => event.type)).toEqual(['lap', 'finish']);
    expect(events).toEqual([
      { type: 'lap', rawIndex: 24982, lap: 5, lastLapMs: 79336 },
      { type: 'finish', rawIndex: 24982 }
    ]);
    expect(watch.state).toBe('finished');
  });

  it('keeps_running_through_a_pit_stop', () => {
    const watch = runningWatch({ lap: 2, lapsInRace: 7 });
    const events = samplesOf('race-pit-stop').flatMap(sample => watch.push(sample));
    expect(events.map(event => event.type)).toEqual(['lap']);
    expect(watch.state).toBe('running');
  });

  it('joins_a_race_that_already_runs_and_gives_the_lap_that_runs', () => {
    const watch = new RaceWatch(DEFAULT_CONFIG);
    expect(watch.firstRecordedLap).toBeNull();
    const running = renumber([...repeated(10, { lap: 2, lapsInRace: 5 }), ...repeated(10, { lap: 3, lapsInRace: 5, lastLapMs: 80000 })]);
    expect(feed(running, watch)).toEqual([
      { type: 'join', rawIndex: 0, lap: 2, lapsInRace: 5 },
      { type: 'lap', rawIndex: 10, lap: 2, lastLapMs: 80000 }
    ]);
    expect(watch).toMatchObject({ state: 'running', lap: 3, lapsInRace: 5, firstRecordedLap: 3 });
    const finish = renumber(repeated(10, { lap: 6, lapsInRace: 5, lastLapMs: 79000 }), 20, 1000);
    expect(feed(finish, watch).map(event => event.type)).toEqual(['lap', 'finish']);
    expect(watch.state).toBe('finished');
  });

  it('gives_first_recorded_lap_1_after_a_grid', () => {
    expect(runningWatch({ lap: 1, lapsInRace: 5 }).firstRecordedLap).toBe(1);
  });

  it('does_not_join_after_the_finish', () => {
    const watch = new RaceWatch(DEFAULT_CONFIG);
    expect(feed(renumber(repeated(10, { lap: 6, lapsInRace: 5, lastLapMs: 79000 })), watch)).toEqual([]);
    expect(watch.state).toBe('waiting');
    const next = renumber([syntheticSample({ lap: 0, lapsInRace: 3 }), syntheticSample({ lap: 1, lapsInRace: 3 })], 10, 1000);
    expect(feed(next, watch).map(event => event.type)).toEqual(['grid', 'start']);
    expect(watch.lapsInRace).toBe(3);
  });

  it('does_not_join_a_session_of_one_lap_or_a_lost_session', () => {
    const watch = new RaceWatch(DEFAULT_CONFIG);
    expect(feed(renumber([...repeated(5, { lap: 1, lapsInRace: 1 }), ...repeated(5, { lap: 2, lapsInRace: 5, playerSession: false })]), watch)).toEqual([]);
    expect(watch.state).toBe('waiting');
  });

  it('ends_a_joined_race_when_the_player_session_is_lost', () => {
    const watch = new RaceWatch(DEFAULT_CONFIG);
    const samples = [
      syntheticSample({ receivedMonoMs: 0, lap: 3, lapsInRace: 5 }),
      syntheticSample({ receivedMonoMs: 100, lap: -1, lapsInRace: -1, playerSession: false }),
      syntheticSample({ rawIndex: 7, receivedMonoMs: 1200, lap: -1, lapsInRace: -1, playerSession: false })
    ];
    expect(feed(samples, watch).map(event => event.type)).toEqual(['join', 'ended']);
  });

  it('ends_when_the_player_session_is_lost_for_more_than_1000_ms', () => {
    const watch = runningWatch({ lap: 2, lapsInRace: 5 });
    const lost = [0, 500, 1000, 1001].map((ms, index) => syntheticSample({ rawIndex: 100 + index, receivedMonoMs: 10000 + ms, lap: 2, lapsInRace: 5, playerSession: false }));
    expect(feed(lost.slice(0, 3), watch)).toEqual([]);
    expect(watch.state).toBe('running');
    expect(feed(lost.slice(3), watch)).toEqual([{ type: 'ended', rawIndex: 103, reason: 'session-left' }]);
    expect(watch.state).toBe('ended');
    expect(feed([syntheticSample({ receivedMonoMs: 12000, lap: 3, lapsInRace: 5 })], watch)).toEqual([]);
  });

  it('keeps_running_when_the_player_session_comes_back_within_1000_ms', () => {
    const watch = runningWatch({ lap: 2, lapsInRace: 5 });
    const samples = [
      syntheticSample({ receivedMonoMs: 10000, lap: 2, lapsInRace: 5, playerSession: false }),
      syntheticSample({ receivedMonoMs: 10900, lap: 2, lapsInRace: 5 }),
      syntheticSample({ receivedMonoMs: 11000, lap: 2, lapsInRace: 5, playerSession: false }),
      syntheticSample({ receivedMonoMs: 11900, lap: 2, lapsInRace: 5, playerSession: false })
    ];
    expect(feed(samples, watch)).toEqual([]);
    expect(watch.state).toBe('running');
  });

  it('waits_the_session_loss_also_when_the_lost_packets_give_a_lower_lap', () => {
    const watch = runningWatch({ lap: 3, lapsInRace: 5 });
    const samples = [
      syntheticSample({ receivedMonoMs: 10000, lap: -1, lapsInRace: -1, playerSession: false }),
      syntheticSample({ receivedMonoMs: 10500, lap: -1, lapsInRace: -1, playerSession: false }),
      syntheticSample({ receivedMonoMs: 10600, lap: 3, lapsInRace: 5 })
    ];
    expect(feed(samples, watch)).toEqual([]);
    expect(watch.state).toBe('running');
    const menu = [11000, 12001].map((ms, index) => syntheticSample({ rawIndex: 200 + index, receivedMonoMs: ms, lap: -1, lapsInRace: -1, playerSession: false }));
    expect(feed(menu, watch)).toEqual([{ type: 'ended', rawIndex: 201, reason: 'session-left' }]);
  });

  it('ends_when_the_lap_counter_goes_down', () => {
    const watch = runningWatch({ lap: 3, lapsInRace: 5 });
    expect(feed([syntheticSample({ rawIndex: 50, lap: 0, lapsInRace: 5 })], watch)).toEqual([{ type: 'ended', rawIndex: 50, reason: 'lap-counter-down' }]);
    expect(watch.state).toBe('ended');
  });

  it('ends_on_the_grid_when_the_player_session_is_lost', () => {
    const watch = new RaceWatch(DEFAULT_CONFIG);
    const samples = [
      syntheticSample({ receivedMonoMs: 0, lap: 0, lapsInRace: 5 }),
      syntheticSample({ receivedMonoMs: 100, lap: 0, lapsInRace: 5, playerSession: false }),
      syntheticSample({ rawIndex: 9, receivedMonoMs: 1200, lap: 0, lapsInRace: 5, playerSession: false })
    ];
    expect(feed(samples, watch).map(event => event.type)).toEqual(['grid', 'ended']);
    expect(watch.state).toBe('ended');
  });

  it('gives_no_events_after_the_finish', () => {
    const watch = runningWatch({ lap: 2, lapsInRace: 2 });
    expect(feed([syntheticSample({ lap: 3, lapsInRace: 2 })], watch).map(event => event.type)).toEqual(['lap', 'finish']);
    expect(feed([syntheticSample({ lap: 0, lapsInRace: 2 }), syntheticSample({ lap: 1, lapsInRace: 2, playerSession: false })], watch)).toEqual([]);
    expect(watch.state).toBe('finished');
  });

  it('says_unsupported_for_a_session_without_a_lap_count_after_5000_ms', () => {
    const watch = new RaceWatch(DEFAULT_CONFIG);
    const at = (ms: number) => syntheticSample({ receivedMonoMs: ms, lap: 1, lapsInRace: 0 });
    feed([at(0), at(2500), at(5000)], watch);
    expect(watch.unsupported).toBe(false);
    feed([at(5001)], watch);
    expect(watch.unsupported).toBe(true);
    expect(watch.state).toBe('waiting');
    feed([syntheticSample({ receivedMonoMs: 6000, lap: 0, lapsInRace: 5 })], watch);
    expect(watch.state).toBe('grid');
    expect(watch.unsupported).toBe(false);
  });

  it('a_licence_test_is_not_a_race', () => {
    const watch = new RaceWatch(DEFAULT_CONFIG);
    const changes: { rawIndex: number; unsupported: boolean }[] = [];
    for (const sample of samplesOf('b1-run')) {
      expect(watch.push(sample)).toEqual([]);
      if (watch.unsupported !== (changes.at(-1)?.unsupported ?? false)) changes.push({ rawIndex: sample.rawIndex, unsupported: watch.unsupported });
    }
    expect(watch.state).toBe('waiting');
    expect(changes).toEqual([
      { rawIndex: 4470, unsupported: true },
      { rawIndex: 6367, unsupported: false }
    ]);
  });

  it('a_circuit_experience_section_is_not_a_race', () => {
    const watch = new RaceWatch(DEFAULT_CONFIG);
    expect(feed(samplesOf('ce-clean'), watch)).toEqual([]);
    expect(watch.state).toBe('waiting');
    expect(watch.unsupported).toBe(true);
  });

  it('a_session_of_one_lap_gives_no_grid_and_two_laps_give_the_grid', () => {
    const session = (lapsInRace: number) => renumber([syntheticSample({ lap: 0, lapsInRace }), syntheticSample({ lap: 1, lapsInRace })]);
    expect(feed(session(1))).toEqual([]);
    expect(feed(session(2)).map(event => event.type)).toEqual(['grid', 'start']);
  });

  it('says_unsupported_for_a_session_of_one_lap_after_5000_ms', () => {
    const watch = new RaceWatch(DEFAULT_CONFIG);
    feed([0, 5000].map(ms => syntheticSample({ receivedMonoMs: ms, lap: 1, lapsInRace: 1 })), watch);
    expect(watch.unsupported).toBe(false);
    feed([syntheticSample({ receivedMonoMs: 5001, lap: 1, lapsInRace: 1 })], watch);
    expect(watch.unsupported).toBe(true);
  });

  it('stops_saying_unsupported_when_the_player_leaves_the_session', () => {
    const watch = new RaceWatch(DEFAULT_CONFIG);
    feed([0, 5001].map(ms => syntheticSample({ receivedMonoMs: ms, lap: 1, lapsInRace: 0 })), watch);
    expect(watch.unsupported).toBe(true);
    feed([syntheticSample({ receivedMonoMs: 5100, lap: -1, lapsInRace: -1, playerSession: false })], watch);
    expect(watch.unsupported).toBe(false);
  });

  it('does_not_say_unsupported_for_menus_and_the_scene_before_the_grid', () => {
    const watch = new RaceWatch(DEFAULT_CONFIG);
    const samples = [
      ...[0, 3000, 6000].map(ms => syntheticSample({ receivedMonoMs: ms, lap: -1, lapsInRace: -1 })),
      ...[6100, 9000, 12000].map(ms => syntheticSample({ receivedMonoMs: ms, lap: 0, lapsInRace: 0, playerSession: false })),
      ...[12100, 15000, 17100].map(ms => syntheticSample({ receivedMonoMs: ms, lap: 1, lapsInRace: 0 }))
    ];
    feed(samples, watch);
    expect(watch.unsupported).toBe(false);
    expect(feed(samplesOf('race-grid-start'), new RaceWatch(DEFAULT_CONFIG)).length).toBe(2);
  });
});
