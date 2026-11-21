import { describe, expect, it } from 'vitest';
import type { Sample } from '@gt7/contracts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { findOffTrack, recurringPlaces, type OffTrackFacts } from '../src/race-off-track.ts';
import type { LapFacts, PitStopFacts } from '../src/race-laps.ts';
import { buildReference } from '../src/reference.ts';
import { samplesOf } from './fixtures.ts';
import { FRAME_MS, drive, renumber, straightLine, syntheticSample } from './synthetic.ts';

function lapOver(samples: Sample[], number: number): LapFacts {
  return {
    number,
    range: { first: samples[0]!.rawIndex, last: samples.at(-1)!.rawIndex },
    timeMs: 0,
    positionStart: 1,
    positionEnd: 1,
    topSpeedMps: 0,
    fuelStart: 100,
    fuelEnd: 100,
    pitIn: false,
    pitOut: false
  };
}

function lap(number: number, first: number, last: number): LapFacts {
  return { ...lapOver([syntheticSample({ rawIndex: first }), syntheticSample({ rawIndex: last })], number) };
}

function track(surfaces: string[], overrides: (index: number) => Partial<Sample> = () => ({})): Sample[] {
  return renumber(surfaces.map((surface, index) => syntheticSample({ surface, speedMps: 30, position: { x: index, y: 0, z: 0 }, ...overrides(index) })));
}

function run(surface: string, count: number): string[] {
  return Array.from({ length: count }, () => surface);
}

function moment(lapNumber: number, sM: number | null, overrides: Partial<OffTrackFacts> = {}): OffTrackFacts {
  return { lap: lapNumber, rawIndex: 0, sM, x: sM ?? 0, z: 0, wheels: 2, durationMs: 500, speedInMps: 40, speedMinMps: 30, ...overrides };
}

describe('findOffTrack', () => {
  it('finds_the_moment_of_the_real_capture', () => {
    const samples = samplesOf('race-off-track');
    const moments = findOffTrack(samples, [lapOver(samples, 4)], [], null, DEFAULT_CONFIG);
    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({ lap: 4, wheels: 4 });
    expect(moments[0]!.durationMs / 1000).toBeCloseTo(3.7, 1);
    expect(moments[0]!.speedMinMps * 3.6).toBeCloseTo(40, 0);
    expect(moments[0]).toMatchObject({ rawIndex: 32233, sM: null });
  });

  it('ignores_one_wheel_on_the_grass', () => {
    const samples = track([...run('TTTT', 10), ...run('GTTT', 60), ...run('TCTT', 10)]);
    expect(findOffTrack(samples, [lapOver(samples, 1)], [], null, DEFAULT_CONFIG)).toEqual([]);
  });

  it('takes_sand_and_other_letters_as_off_the_track', () => {
    const samples = track([...run('TTTT', 10), ...run('SSTX', 30), ...run('TTTT', 10)]);
    expect(findOffTrack(samples, [lapOver(samples, 1)], [], null, DEFAULT_CONFIG)).toEqual([
      { lap: 1, rawIndex: 10, sM: null, x: 10, z: 0, wheels: 3, durationMs: expect.closeTo(29 * FRAME_MS, 6), speedInMps: 30, speedMinMps: 30 }
    ]);
  });

  it('joins_two_runs_less_than_1000_ms_apart', () => {
    const joined = track([...run('GGTT', 30), ...run('TTTT', 58), ...run('GGGG', 30), ...run('TTTT', 5)], index => ({ speedMps: index === 100 ? 12 : 30 }));
    expect(findOffTrack(joined, [lapOver(joined, 2)], [], null, DEFAULT_CONFIG)).toEqual([
      { lap: 2, rawIndex: 0, sM: null, x: 0, z: 0, wheels: 4, durationMs: expect.closeTo(117 * FRAME_MS, 6), speedInMps: 30, speedMinMps: 12 }
    ]);
    const apart = track([...run('GGTT', 30), ...run('TTTT', 60), ...run('GGGG', 30)]);
    expect(findOffTrack(apart, [lapOver(apart, 2)], [], null, DEFAULT_CONFIG).map(found => found.rawIndex)).toEqual([0, 90]);
  });

  it('gives_a_moment_that_crosses_the_lap_line_to_the_lap_where_it_starts', () => {
    const samples = track([...run('TTTT', 50), ...run('GGTT', 20), ...run('TTTT', 30)]);
    const moments = findOffTrack(samples, [lap(1, 0, 59), lap(2, 60, 99)], [], null, DEFAULT_CONFIG);
    expect(moments.map(found => ({ lap: found.lap, rawIndex: found.rawIndex, durationMs: found.durationMs }))).toEqual([{ lap: 1, rawIndex: 50, durationMs: expect.closeTo(19 * FRAME_MS, 6) }]);
  });

  it('does_not_join_runs_that_start_in_two_laps', () => {
    const samples = track([...run('TTTT', 40), ...run('GGTT', 10), ...run('TTTT', 20), ...run('GGTT', 10), ...run('TTTT', 10)]);
    const moments = findOffTrack(samples, [lap(1, 0, 59), lap(2, 60, 89)], [], null, DEFAULT_CONFIG);
    expect(moments.map(found => [found.lap, found.rawIndex])).toEqual([
      [1, 40],
      [2, 70]
    ]);
  });

  it('gives_no_moment_inside_a_pit_stop', () => {
    const samples = track([...run('TTTT', 10), ...run('GGTT', 10), ...run('TTTT', 10), ...run('GGGG', 40), ...run('TTTT', 10)]);
    const pitStop: PitStopFacts = { afterLap: 1, durationMs: 1000, fuelBefore: 30, fuelAfter: 100, stopRawIndex: 28, exitRawIndex: 75 };
    const moments = findOffTrack(samples, [lap(1, 0, 49), lap(2, 50, 79)], [pitStop], null, DEFAULT_CONFIG);
    expect(moments.map(found => found.rawIndex)).toEqual([10]);
  });

  it('gives_no_moment_outside_the_laps', () => {
    const samples = track([...run('GGGG', 30), ...run('TTTT', 30), ...run('GGGG', 30)]);
    expect(findOffTrack(samples, [lap(1, 30, 59)], [], null, DEFAULT_CONFIG)).toEqual([]);
  });

  it('leaves_out_paused_time_from_the_duration', () => {
    const samples = track(run('GGTT', 100), index => ({ paused: index >= 20 && index < 80 }));
    expect(findOffTrack(samples, [lapOver(samples, 1)], [], null, DEFAULT_CONFIG)[0]!.durationMs).toBeCloseTo(38 * FRAME_MS, 6);
  });

  it('gives_the_distance_on_the_path', () => {
    const path = buildReference(drive(straightLine({ fromX: 0, toX: 200, speedMps: 30 })));
    const samples = track([...run('TTTT', 120), ...run('GGTT', 10), ...run('TTTT', 10)]);
    expect(findOffTrack(samples, [lapOver(samples, 1)], [], path, DEFAULT_CONFIG)[0]!.sM).toBe(120);
  });
});

describe('recurringPlaces', () => {
  it('finds_a_place_that_comes_again_in_3_laps_within_80_m_and_not_one_in_2_laps', () => {
    const moments = [
      moment(1, 1000, { speedInMps: 50, speedMinMps: 20 }),
      moment(2, 1050, { wheels: 4 }),
      moment(3, 1125, { wheels: 4, x: 7, z: 9 }),
      moment(3, 1130),
      moment(4, 2000),
      moment(5, 2010),
      moment(6, 2100),
      moment(7, null)
    ];
    expect(recurringPlaces(moments, DEFAULT_CONFIG, null)).toEqual([
      { label: 'A', sM: 1087.5, fromSM: 1000, toSM: 1130, x: 1050, z: 0, laps: [1, 2, 3], allWheels: 2, largestLossMps: 30 }
    ]);
  });

  it('a_place_at_the_lap_line_in_3_laps_is_one_recurring_place', () => {
    const moments = [moment(1, 5, { wheels: 4 }), moment(2, 6170), moment(3, 20), moment(4, 3000)];
    expect(recurringPlaces(moments, DEFAULT_CONFIG, 6181)).toEqual([
      { label: 'A', sM: 5, fromSM: 6170, toSM: 20, x: 5, z: 0, laps: [1, 2, 3], allWheels: 1, largestLossMps: 10 }
    ]);
    expect(recurringPlaces(moments, DEFAULT_CONFIG, null)).toEqual([]);
  });

  it('keeps_one_chain_round_the_whole_lap_as_one_place', () => {
    const moments = [0, 70, 140, 210].map((sM, index) => moment(index + 1, sM));
    expect(recurringPlaces(moments, DEFAULT_CONFIG, 260).map(place => [place.fromSM, place.toSM, place.laps])).toEqual([[0, 210, [1, 2, 3, 4]]]);
  });

  it('gives_no_place_for_moments_80_m_apart', () => {
    expect(recurringPlaces([moment(1, 100), moment(2, 180), moment(3, 260)], DEFAULT_CONFIG, null)).toEqual([]);
  });

  it('labels_the_places_by_the_number_of_laps_and_then_by_the_distance', () => {
    const moments = [
      ...[1, 2, 3].map(number => moment(number, 500 + number)),
      ...[1, 2, 3, 4].map(number => moment(number, 3000 + number)),
      ...[4, 5, 6].map(number => moment(number, 1500 + number))
    ];
    expect(recurringPlaces(moments, DEFAULT_CONFIG, null).map(place => [place.label, place.fromSM, place.laps.length])).toEqual([
      ['A', 3001, 4],
      ['B', 501, 3],
      ['C', 1504, 3]
    ]);
  });
});
