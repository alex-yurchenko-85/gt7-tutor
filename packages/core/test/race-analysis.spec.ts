import { describe, expect, it } from 'vitest';
import type { Sample } from '@gt7/contracts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { analyseRace, lapPath, raceDistances, raceRange, trackCandidates } from '../src/race-analysis.ts';
import { isClosedLap } from '../src/race-laps.ts';
import { racePositionOf, renumber, raceOf, syntheticSample } from './synthetic.ts';

function firstOf(samples: Sample[], predicate: (sample: Sample) => boolean): Sample {
  return samples.find(predicate)!;
}

describe('raceRange', () => {
  it('gives_the_range_from_the_grid_to_2000_ms_after_the_finish', () => {
    const samples = raceOf({ laps: [60000, 58000], lapsInRace: 2 });
    const finish = firstOf(samples, sample => sample.lap === 3);
    const last = samples.filter(sample => sample.receivedMonoMs - finish.receivedMonoMs <= 2000).at(-1)!;
    expect(raceRange(samples, DEFAULT_CONFIG)).toEqual({ first: 0, last: last.rawIndex });
    expect(last.rawIndex - finish.rawIndex).toBeGreaterThanOrEqual(119);
    expect(last.rawIndex).toBeLessThan(samples.at(-1)!.rawIndex);
  });

  it('ends_the_range_at_the_end_of_the_race', () => {
    const samples = raceOf({ laps: [60000], lapsInRace: 3 });
    const lost = firstOf(samples, sample => !sample.playerSession);
    const range = raceRange(samples, DEFAULT_CONFIG)!;
    expect(range.first).toBe(0);
    expect(samples.find(sample => sample.rawIndex === range.last)!.receivedMonoMs - lost.receivedMonoMs).toBeGreaterThan(1000);
    expect(range.last).toBeLessThan(samples.at(-1)!.rawIndex);
  });

  it('waits_for_the_next_grid_when_a_grid_ends_before_the_start', () => {
    const left = renumber([
      ...Array.from({ length: 10 }, () => syntheticSample({ lap: 0, lapsInRace: 3 })),
      ...Array.from({ length: 80 }, () => syntheticSample({ lap: -1, lapsInRace: -1, playerSession: false }))
    ]);
    const race = renumber(raceOf({ laps: [60000, 58000, 59000], lapsInRace: 3 }), left.length, left.at(-1)!.receivedMonoMs + 1000);
    expect(raceRange([...left, ...race], DEFAULT_CONFIG)!.first).toBe(left.length);
    expect(analyseRace([...left, ...race], DEFAULT_CONFIG)).toMatchObject({ complete: true, raceMs: 177000 });
  });

  it('gives_the_last_sample_when_the_race_has_no_end_and_null_without_a_grid_or_a_join', () => {
    const samples = raceOf({ laps: [60000, 58000], lapsInRace: 3 }).filter(sample => sample.playerSession);
    expect(raceRange(samples, DEFAULT_CONFIG)).toEqual({ first: 0, last: samples.at(-1)!.rawIndex });
    const afterFinish = raceOf({ laps: [60000, 58000], lapsInRace: 2 }).filter(sample => sample.lap === 3);
    expect(raceRange(afterFinish, DEFAULT_CONFIG)).toBeNull();
  });
});

describe('analyseRace', () => {
  it('gives_null_for_a_race_without_a_complete_lap', () => {
    const samples = raceOf({ laps: [60000], lapsInRace: 3 });
    const withoutLap2 = samples.filter(sample => sample.lap !== 2);
    expect(analyseRace(withoutLap2, DEFAULT_CONFIG)).toBeNull();
    expect(analyseRace(samples.filter(sample => sample.lap >= 1), DEFAULT_CONFIG)).toBeNull();
  });

  it('cuts_the_samples_to_the_first_race_a_second_session_with_the_same_lap_numbers_after_it_changes_nothing', () => {
    const first = raceOf({ laps: [60000, 58000, 59000], lapsInRace: 3 });
    const second = renumber(raceOf({ laps: [70000, 71000, 72000], lapsInRace: 3 }), first.length, first.at(-1)!.receivedMonoMs + 5000);
    expect(analyseRace([...first, ...second], DEFAULT_CONFIG)).toEqual(analyseRace(first, DEFAULT_CONFIG));
  });

  it('sums_the_lap_times_and_marks_the_race_complete', () => {
    const a = analyseRace(raceOf({ laps: [60000, 58000, 59000], lapsInRace: 3 }), DEFAULT_CONFIG)!;
    expect(a).toMatchObject({ complete: true, raceMs: 177000, bestLap: 2, bestLapMs: 58000, referenceLap: 2 });
    expect(a).toMatchObject({ lapsInRace: 3, carsInRace: 16, carId: 3602, startPosition: 8, finishPosition: 5 });
    expect(a.laps.map(lap => lap.number)).toEqual([1, 2, 3]);
    expect(a.lapLengthM).toBeGreaterThan(620);
    expect(a.lapLengthM).toBeLessThan(630);
  });

  it('marks_a_race_with_2_of_3_laps_as_not_complete', () => {
    const a = analyseRace(raceOf({ laps: [60000, 58000], lapsInRace: 3 }), DEFAULT_CONFIG)!;
    expect(a).toMatchObject({ complete: false, raceMs: 118000, bestLap: 2 });
  });

  it('takes_a_reference_lap_that_has_no_pit_stop', () => {
    const a = analyseRace(raceOf({ laps: [60000, 55000, 56000, 61000], lapsInRace: 4, pitAfter: [2] }), DEFAULT_CONFIG)!;
    expect(a.bestLap).toBe(2);
    expect(a.referenceLap).toBe(4);
    expect(a.pitStops.map(stop => stop.afterLap)).toEqual([2]);
    expect(a.laps.map(lap => [lap.number, lap.pitIn, lap.pitOut])).toEqual([
      [1, false, false],
      [2, true, false],
      [3, false, true],
      [4, false, false]
    ]);
  });

  it('takes_a_closed_lap_as_the_reference_lap_because_lap_1_starts_on_the_grid', () => {
    const a = analyseRace(raceOf({ laps: [55000, 58000, 57000], lapsInRace: 3 }), DEFAULT_CONFIG)!;
    expect(a).toMatchObject({ bestLap: 1, referenceLap: 3 });
  });

  it('says_that_only_a_lap_after_lap_1_without_a_pit_stop_is_closed', () => {
    expect(isClosedLap({ number: 2, pitIn: false, pitOut: false })).toBe(true);
    expect(isClosedLap({ number: 1, pitIn: false, pitOut: false })).toBe(false);
    expect(isClosedLap({ number: 3, pitIn: true, pitOut: false })).toBe(false);
    expect(isClosedLap({ number: 3, pitIn: false, pitOut: true })).toBe(false);
  });

  it('falls_back_to_the_fastest_lap_when_every_lap_has_a_pit_stop', () => {
    const a = analyseRace(raceOf({ laps: [62000, 61000], lapsInRace: 2, pitAfter: [1] }), DEFAULT_CONFIG)!;
    expect(a.laps.map(lap => [lap.pitIn, lap.pitOut])).toEqual([
      [true, false],
      [false, true]
    ]);
    expect(a).toMatchObject({ bestLap: 2, referenceLap: 2 });
    expect(a.lapLengthM).not.toBeNull();
  });

  it('takes_the_next_lap_as_the_reference_lap_when_the_fastest_clean_lap_has_a_position_jump', () => {
    const samples = raceOf({ laps: [60000, 58000, 59000], lapsInRace: 3 });
    const lap2 = samples.filter(sample => sample.lap === 2);
    const jumpAt = lap2[300]!.rawIndex;
    const jumped = samples.map(sample => (sample.rawIndex === jumpAt ? { ...sample, position: { x: 900, y: 0, z: 900 } } : sample));
    expect(analyseRace(jumped, DEFAULT_CONFIG)).toMatchObject({ bestLap: 2, referenceLap: 3 });
  });

  it('gives_the_lap_length_of_the_longest_path_when_every_lap_has_a_pit_stop', () => {
    const samples = raceOf({ laps: [62000, 61000], lapsInRace: 2, pitAfter: [1] });
    const a = analyseRace(samples, DEFAULT_CONFIG)!;
    const lengths = a.laps.map(lap => lapPath(samples, lap, a.pitStops, DEFAULT_CONFIG)!.lengthM);
    expect(a.referenceLap).toBe(2);
    expect(a.lapLengthM).toBe(Math.max(...lengths));
  });

  it('gives_no_lap_length_when_no_lap_has_a_path', () => {
    const samples = raceOf({ laps: [60000, 58000], lapsInRace: 2 }).map(sample => (sample.lap >= 1 ? { ...sample, position: { x: 1, y: 0, z: 1 } } : sample));
    expect(analyseRace(samples, DEFAULT_CONFIG)).toMatchObject({ bestLap: 2, referenceLap: 2, lapLengthM: null });
  });

  it('works_for_a_race_that_was_stopped_after_one_complete_lap_of_three', () => {
    const a = analyseRace(raceOf({ laps: [60000], lapsInRace: 3 }), DEFAULT_CONFIG)!;
    expect(a).toMatchObject({ complete: false, raceMs: 60000, bestLap: 1, referenceLap: 1, lapsInRace: 3 });
    expect(a.laps).toHaveLength(1);
  });

  it('gives_one_position_step_per_change_on_the_race_time', () => {
    const a = analyseRace(raceOf({ laps: [60000, 58000, 59000], lapsInRace: 3 }), DEFAULT_CONFIG)!;
    expect(a.position).toEqual([
      { tMs: 0, position: 8 },
      { tMs: 60000, position: 7 },
      { tMs: 118000, position: 6 },
      { tMs: 177000, position: 5 }
    ]);
  });

  it('gives_one_fuel_point_per_2000_ms_of_race_time', () => {
    const a = analyseRace(raceOf({ laps: [60000, 58000], lapsInRace: 2 }), DEFAULT_CONFIG)!;
    expect(a.fuel[0]!.tMs).toBe(0);
    expect(a.fuel.slice(1).every((point, index) => point.tMs - a.fuel[index]!.tMs >= 2000)).toBe(true);
    expect(a.fuel.at(-1)!.tMs).toBe(118000);
    expect(a.fuel.every(point => point.fuel <= 100 && point.fuel >= 75)).toBe(true);
  });

  it('gives_the_start_position_of_the_last_grid_sample', () => {
    const samples = raceOf({ laps: [60000, 58000], lapsInRace: 2 });
    expect(samples[0]!.racePosition).toBe(1);
    expect(analyseRace(samples, DEFAULT_CONFIG)!.startPosition).toBe(8);
    expect(analyseRace(samples.filter(sample => sample.lap !== 0 || sample.rawIndex === 0), DEFAULT_CONFIG)!.startPosition).toBe(1);
  });

  it('passes_the_lap_length_to_the_recurring_places', () => {
    const samples = raceOf({ laps: [60000, 58000, 59000, 60000], lapsInRace: 4 });
    const offAtTheLine = samples.map(sample => {
      const lapStart = samples.find(candidate => candidate.lap === sample.lap)!.rawIndex;
      const index = sample.rawIndex - lapStart;
      const nearLine = sample.lap === 2 ? index >= 588 && index < 594 : (sample.lap === 3 || sample.lap === 4) && index < 6;
      return nearLine ? { ...sample, surface: 'GGTT' } : sample;
    });
    const a = analyseRace(offAtTheLine, DEFAULT_CONFIG)!;
    expect(a.offTrack.map(moment => moment.lap)).toEqual([2, 3, 4]);
    expect(a.recurring).toHaveLength(1);
    expect(a.recurring[0]!.laps).toEqual([2, 3, 4]);
    expect(a.recurring[0]!.fromSM).toBeGreaterThan(a.recurring[0]!.toSM);
  });

  it('makes_no_place_over_the_lap_line_when_the_reference_lap_is_an_in_lap_or_an_out_lap', () => {
    const samples = raceOf({ laps: [62000, 58000, 61000], lapsInRace: 3, pitAfter: [1, 2] });
    const off = samples.map(sample => {
      const onOval = (at: number) => sample.speedMps > 1 && sample.position.z < 400 && Math.abs(Math.atan2(sample.position.x, 100 - sample.position.z) - (2 * Math.PI * at) / 600) < 0.04;
      const atEnd = (sample.lap === 1 || sample.lap === 2) && onOval(535 - 600);
      const atStart = sample.lap === 3 && onOval(65);
      return atEnd || atStart ? { ...sample, surface: 'GGTT' } : sample;
    });
    const a = analyseRace(off, DEFAULT_CONFIG)!;
    expect(a.referenceLap).toBe(2);
    expect(a.offTrack.map(moment => moment.lap)).toEqual([1, 2, 3]);
    expect(a.recurring).toEqual([]);
  });
});

describe('a race recorded from a lap line', () => {
  it('leaves_out_the_lap_that_runs_at_the_join_and_keeps_the_lap_numbers_of_the_game', () => {
    const a = analyseRace(raceOf({ laps: [60000, 58000, 59000, 61000], lapsInRace: 4, joinAtLap: 2 }), DEFAULT_CONFIG)!;
    expect(a.laps.map(l => l.number)).toEqual([3, 4]);
    expect(a).toMatchObject({ firstLap: 3, complete: false, raceMs: 120000, bestLap: 3 });
    expect(a).toMatchObject({ lapsInRace: 4, referenceLap: 3 });
  });

  it('starts_the_range_at_the_join_sample', () => {
    const samples = raceOf({ laps: [60000, 58000, 59000, 61000], lapsInRace: 4, joinAtLap: 2 });
    expect(raceRange(samples, DEFAULT_CONFIG)!.first).toBe(samples[0]!.rawIndex);
  });

  it('takes_the_start_position_at_the_first_recorded_lap_line_after_a_join', () => {
    const a = analyseRace(raceOf({ laps: [60000, 58000, 59000, 61000], lapsInRace: 4, joinAtLap: 2 }), DEFAULT_CONFIG)!;
    expect(a).toMatchObject({ startPosition: racePositionOf(3), finishPosition: racePositionOf(5) });
    expect(a.position[0]).toEqual({ tMs: 0, position: racePositionOf(3) });
    expect(a.fuel[0]!.tMs).toBe(0);
    expect(a.position.at(-1)!.tMs).toBe(120000);
  });

  it('gives_null_when_the_recording_joins_in_the_last_lap', () => {
    expect(analyseRace(raceOf({ laps: [60000, 58000, 59000], lapsInRace: 3, joinAtLap: 3 }), DEFAULT_CONFIG)).toBeNull();
  });

  it('marks_the_out_lap_after_a_join_in_an_in_lap_and_stores_no_pit_stop_for_it', () => {
    const a = analyseRace(raceOf({ laps: [60000, 58000, 59000, 61000], lapsInRace: 4, pitAfter: [2], joinAtLap: 2 }), DEFAULT_CONFIG)!;
    expect(a.laps.map(lap => [lap.number, lap.pitIn, lap.pitOut])).toEqual([
      [3, false, true],
      [4, false, false]
    ]);
    expect(a.pitStops).toEqual([]);
    expect(a.referenceLap).toBe(4);
  });

  it('builds_the_path_of_an_out_lap_whose_in_lap_is_not_recorded', () => {
    const samples = raceOf({ laps: [60000, 58000, 59000, 61000], lapsInRace: 4, pitAfter: [2], joinAtLap: 2 });
    const a = analyseRace(samples, DEFAULT_CONFIG)!;
    const length = lapPath(samples, a.laps[0]!, a.pitStops, DEFAULT_CONFIG)?.lengthM;
    expect(length).toBeGreaterThan(560);
    expect(length).toBeLessThan(570);
  });

  it('gives_no_off_track_moment_in_the_box_of_an_out_lap_whose_in_lap_is_not_recorded', () => {
    const samples = raceOf({ laps: [60000, 58000, 59000, 61000], lapsInRace: 4, pitAfter: [2], joinAtLap: 2 });
    const boxed = samples.map(sample => (sample.lap === 3 && sample.speedMps < 0.01 ? { ...sample, surface: 'GGGG' } : sample));
    expect(analyseRace(boxed, DEFAULT_CONFIG)!.offTrack).toEqual([]);
  });

  it('waits_for_the_next_race_when_a_joined_race_ends_before_its_first_lap_line', () => {
    const joined = raceOf({ laps: [60000, 58000, 59000], lapsInRace: 3, joinAtLap: 2 }).filter(sample => sample.lap === 2);
    const restart = renumber(raceOf({ laps: [60000, 58000, 59000], lapsInRace: 3 }), joined.at(-1)!.rawIndex + 1, joined.at(-1)!.receivedMonoMs + 100);
    expect(analyseRace([...joined, ...restart], DEFAULT_CONFIG)).toMatchObject({ firstLap: 1, complete: true, raceMs: 177000 });
  });

  it('takes_the_car_of_the_first_recorded_lap', () => {
    const samples = raceOf({ laps: [60000, 58000, 59000], lapsInRace: 3, joinAtLap: 1 }).map(sample => (sample.lap === 1 ? { ...sample, carId: 1, carsInRace: 4 } : sample));
    expect(analyseRace(samples, DEFAULT_CONFIG)).toMatchObject({ carId: 3602, carsInRace: 16 });
  });

  it('still_gives_first_lap_1_and_complete_true_for_a_race_recorded_from_the_grid', () => {
    expect(analyseRace(raceOf({ laps: [60000, 58000, 59000], lapsInRace: 3 }), DEFAULT_CONFIG)).toMatchObject({ firstLap: 1, complete: true, startPosition: 8 });
  });
});

describe('lapPath', () => {
  it('builds_the_path_of_a_lap_without_the_pit_stop', () => {
    const samples = raceOf({ laps: [60000, 55000, 56000], lapsInRace: 3, pitAfter: [1] });
    const a = analyseRace(samples, DEFAULT_CONFIG)!;
    const lengths = a.laps.map(lap => Math.round(lapPath(samples, lap, a.pitStops, DEFAULT_CONFIG)!.lengthM));
    expect(lengths[0]).toBeGreaterThan(560);
    expect(lengths[0]).toBeLessThan(570);
    expect(lengths[1]).toBeGreaterThan(560);
    expect(lengths[1]).toBeLessThan(570);
    expect(lengths[2]).toBeGreaterThan(620);
  });

  it('gives_null_when_the_lap_has_no_path', () => {
    const samples = raceOf({ laps: [60000, 55000], lapsInRace: 2 });
    const a = analyseRace(samples, DEFAULT_CONFIG)!;
    const still = samples.map(sample => (sample.lap === 1 ? { ...sample, position: { x: 1, y: 0, z: 1 } } : sample));
    expect(lapPath(still, a.laps[0]!, [], DEFAULT_CONFIG)).toBeNull();
  });
});

describe('trackCandidates', () => {
  it('gives_track_candidates_within_60_m_nearest_first', () => {
    const circuits = [
      { name: 'High Speed Ring', lengthM: 4345 },
      { name: 'Dragon Trail - Gardens', lengthM: 4352 },
      { name: 'Suzuka Circuit', lengthM: 5807 }
    ];
    expect(trackCandidates(4352, circuits, DEFAULT_CONFIG).map(c => c.name)).toEqual(['Dragon Trail - Gardens', 'High Speed Ring']);
    expect(trackCandidates(4412, circuits, DEFAULT_CONFIG).map(c => c.name)).toEqual(['Dragon Trail - Gardens']);
    expect(trackCandidates(4413, circuits, DEFAULT_CONFIG)).toEqual([]);
  });
});

describe('raceDistances', () => {
  const samples = raceOf({ laps: [60000, 59000, 61000], lapsInRace: 3 });
  const analysis = analyseRace(samples, DEFAULT_CONFIG)!;
  const points = raceDistances(samples, analysis, DEFAULT_CONFIG);

  it('starts_each_lap_at_0_m_at_its_lap_line_on_the_race_time', () => {
    const starts = [1, 2, 3].map(lap => points.find(point => point.lap === lap)!);
    expect(starts.map(point => point.sM)).toEqual([0, 0, 0]);
    expect(starts.map(point => point.tMs)).toEqual([0, 60000, 119000]);
  });

  it('gives_the_distance_driven_up_to_the_end_of_each_lap', () => {
    for (const lap of [1, 2, 3]) {
      const last = points.filter(point => point.lap === lap).at(-1)!;
      expect(last.sM, `lap ${lap}`).toBeGreaterThan(analysis.lapLengthM! - 40);
      expect(last.sM, `lap ${lap}`).toBeLessThan(analysis.lapLengthM! + 5);
    }
  });

  it('gives_one_point_each_250_ms_in_the_order_of_the_race_time', () => {
    const lap = points.filter(point => point.lap === 2);
    const steps = lap.slice(1).map((point, index) => point.tMs - lap[index]!.tMs);
    expect(Math.max(...steps)).toBeLessThan(300);
    expect(Math.min(...steps)).toBeGreaterThan(0);
    expect(lap.every((point, index) => index === 0 || point.sM >= lap[index - 1]!.sM)).toBe(true);
    expect(points.every(point => point.tMs <= analysis.raceMs)).toBe(true);
  });

  it('keeps_0_m_at_the_lap_line_when_the_next_sample_has_the_same_race_time', () => {
    const lapTwo = samples.filter(sample => sample.lap === 2 && sample.rawIndex >= analysis.laps[1]!.range.first);
    const repeated = samples.map(sample => (sample.rawIndex === lapTwo[1]!.rawIndex ? { ...sample, gameTimerMs: 0 } : sample));
    const lap = raceDistances(repeated, analyseRace(repeated, DEFAULT_CONFIG)!, DEFAULT_CONFIG).filter(point => point.lap === 2);
    expect(lap[0]).toEqual({ lap: 2, tMs: 60000, sM: 0 });
    expect(lap[1]!.tMs).toBeGreaterThan(60000);
  });

  it('counts_the_pit_lane_on_an_out_lap', () => {
    const pit = raceOf({ laps: [60000, 62000, 59000], lapsInRace: 3, pitAfter: [1] });
    const pitAnalysis = analyseRace(pit, DEFAULT_CONFIG)!;
    const outLap = raceDistances(pit, pitAnalysis, DEFAULT_CONFIG).filter(point => point.lap === 2);
    expect(outLap[0]!.sM).toBe(0);
    expect(outLap.at(-1)!.sM).toBeGreaterThan(pitAnalysis.lapLengthM! - 40);
  });
});

