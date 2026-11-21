import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { analyseRace } from '../src/race-analysis.ts';
import type { CoreConfig } from '../src/config.ts';
import { compareLaps, lapsSpeed, offTrackView, raceCompareConfig } from '../src/race-compare.ts';
import { raceOf } from './synthetic.ts';

const samples = raceOf({ laps: [60000, 59000, 61000], lapsInRace: 3, brakeLater: { lap: 2, m: 20 } });
const analysis = analyseRace(samples, DEFAULT_CONFIG)!;
const pitSamples = raceOf({ laps: [60000, 62000, 59000], lapsInRace: 3, pitAfter: [1] });
const pitAnalysis = analyseRace(pitSamples, DEFAULT_CONFIG)!;

const exerciseValues: CoreConfig = {
  ...DEFAULT_CONFIG,
  race: {
    ...DEFAULT_CONFIG.race,
    matchLateralM: DEFAULT_CONFIG.match.lateralM,
    matchHeightM: DEFAULT_CONFIG.match.heightM,
    eventWindowM: DEFAULT_CONFIG.findings.eventWindowM,
    offLineM: DEFAULT_CONFIG.findings.offLineM,
    brakeM: DEFAULT_CONFIG.findings.brakeM,
    throttleLateM: DEFAULT_CONFIG.findings.throttleLateM,
    slowCornerMps: DEFAULT_CONFIG.findings.slowCornerMps
  }
};

function aside(lap: number, from: number, to: number, metres: number, lowerM = 0) {
  return samples.map(sample => {
    const lapStart = samples.find(candidate => candidate.lap === lap)!.rawIndex;
    const index = sample.rawIndex - lapStart;
    if (sample.lap !== lap || index < from || index >= to) return sample;
    const { x, z } = sample.position;
    const outward = Math.hypot(x, z - 100);
    return { ...sample, position: { x: x + (metres * x) / outward, y: -lowerM, z: z + (metres * (z - 100)) / outward } };
  });
}

function gaps(values: (number | null)[]): number {
  return values.filter(value => value === null).length;
}

function lostMs(review: { attempt: { t: (number | null)[] }; reference: { t: (number | null)[] } }): (number | null)[] {
  return review.attempt.t.map((t, index) => {
    const reference = review.reference.t[index];
    return t === null || reference === null || reference === undefined ? null : t - reference;
  });
}

function firstValueM(values: (number | null)[], gridM: number): number {
  return values.findIndex(value => value !== null) * gridM;
}

describe('compareLaps', () => {
  it('gives_a_brake_difference_between_two_laps_of_one_race', () => {
    const result = compareLaps(samples, analysis, 2, 1, DEFAULT_CONFIG)!;
    expect(result.findings).toContainEqual(expect.objectContaining({ kind: 'brake-late' }));
    expect(result.review.lengthM).toBeCloseTo(analysis.lapLengthM!, 0);
    const late = result.findings.find(finding => finding.kind === 'brake-late')!;
    expect(late.size).toBeGreaterThan(18);
    expect(late.size).toBeLessThan(22);
    expect(result).toMatchObject({ lapMs: 59000, withMs: 60000 });
    expect(result.turnLosses.length).toBeGreaterThan(0);
  });

  it('matches_a_lap_that_runs_15_m_to_the_side_of_the_other_lap', () => {
    const wide = aside(3, 100, 200, 15);
    expect(gaps(compareLaps(wide, analysis, 3, 1, DEFAULT_CONFIG)!.review.attempt.v)).toBe(0);
    expect(gaps(compareLaps(wide, analysis, 3, 1, exerciseValues)!.review.attempt.v)).toBeGreaterThan(40);
  });

  it('matches_a_lap_that_runs_13_m_to_the_side_and_3_3_m_lower_on_a_banked_turn', () => {
    const banked = aside(3, 100, 200, 13, 3.3);
    expect(gaps(compareLaps(banked, analysis, 3, 1, DEFAULT_CONFIG)!.review.attempt.v)).toBe(0);
    expect(gaps(compareLaps(banked, analysis, 3, 1, exerciseValues)!.review.attempt.v)).toBeGreaterThan(40);
  });

  it('gives_a_brake_early_finding_for_a_brake_100_m_earlier', () => {
    const early = raceOf({ laps: [60000, 59000], lapsInRace: 2, brakeLater: { lap: 2, m: -100 } });
    const earlyAnalysis = analyseRace(early, DEFAULT_CONFIG)!;
    const finding = compareLaps(early, earlyAnalysis, 2, 1, DEFAULT_CONFIG)!.findings.find(candidate => candidate.kind === 'brake-early');
    expect(finding?.size).toBeGreaterThan(98);
    expect(finding?.size).toBeLessThan(102);
    expect(compareLaps(early, earlyAnalysis, 2, 1, exerciseValues)!.findings.filter(candidate => candidate.kind.startsWith('brake'))).toEqual([]);
  });

  it('sets_the_race_values_only_for_the_race_functions', () => {
    const race = raceCompareConfig(DEFAULT_CONFIG);
    expect(race.match).toMatchObject({ lateralM: 20, searchLateralM: 20, heightM: 6 });
    expect(race.findings.eventWindowM).toBe(120);
    expect(DEFAULT_CONFIG.match).toMatchObject({ lateralM: 8, searchLateralM: 8, heightM: 3 });
    expect(DEFAULT_CONFIG.findings.eventWindowM).toBe(60);
  });

  it('uses_the_race_limits_for_the_differences', () => {
    const race = raceCompareConfig(DEFAULT_CONFIG);
    expect(race.findings).toMatchObject({ offLineM: 5, brakeM: 15, throttleLateM: 30, slowCornerMps: 10 / 3.6 });
    expect(DEFAULT_CONFIG.findings).toMatchObject({ offLineM: 1.5, brakeM: 8, throttleLateM: 10 });
  });

  it('gives_no_finding_for_a_brake_12_m_later_with_the_race_limits_and_one_with_the_exercise_limits', () => {
    const late = raceOf({ laps: [60000, 59000], lapsInRace: 2, brakeLater: { lap: 2, m: 12 } });
    const lateAnalysis = analyseRace(late, DEFAULT_CONFIG)!;
    const brakes = (config: CoreConfig) => compareLaps(late, lateAnalysis, 2, 1, config)!.findings.filter(finding => finding.kind.startsWith('brake'));
    expect(brakes(DEFAULT_CONFIG)).toEqual([]);
    expect(brakes(exerciseValues)).toEqual([expect.objectContaining({ kind: 'brake-late' })]);
  });

  it('gives_no_off_line_finding_for_a_lap_3_m_to_the_side_with_the_race_limits', () => {
    const wide = aside(3, 100, 200, 3);
    const offLine = (config: CoreConfig) => compareLaps(wide, analysis, 3, 1, config)!.findings.filter(finding => finding.kind === 'off-line');
    expect(offLine(DEFAULT_CONFIG)).toEqual([]);
    expect(offLine(exerciseValues).length).toBeGreaterThan(0);
  });

  it('gives_no_difference_for_two_equal_laps', () => {
    expect(compareLaps(samples, analysis, 3, 1, DEFAULT_CONFIG)!.findings.filter(finding => finding.kind.startsWith('brake'))).toEqual([]);
  });

  it('gives_null_for_one_lap_against_itself_and_for_an_unknown_lap', () => {
    expect(compareLaps(samples, analysis, 2, 2, DEFAULT_CONFIG)).toBeNull();
    expect(compareLaps(samples, analysis, 9, 1, DEFAULT_CONFIG)).toBeNull();
    expect(compareLaps(samples, analysis, 2, 9, DEFAULT_CONFIG)).toBeNull();
    const still = samples.map(sample => (sample.lap === 1 ? { ...sample, position: { x: 1, y: 0, z: 1 } } : sample));
    expect(compareLaps(still, analysis, 2, 1, DEFAULT_CONFIG)).toBeNull();
  });

  it('matches_an_out_lap_from_the_pit_exit', () => {
    const result = compareLaps(pitSamples, pitAnalysis, 2, 3, DEFAULT_CONFIG)!;
    const { gridM, attempt, lengthM } = result.review;
    expect(firstValueM(attempt.v, gridM)).toBeGreaterThan(55);
    expect(firstValueM(attempt.v, gridM)).toBeLessThan(70);
    expect(attempt.v.at(-1)).not.toBeNull();
    const firstIndex = attempt.v.findIndex(value => value !== null);
    expect(attempt.v.slice(firstIndex).every(value => value !== null)).toBe(true);
    expect(lengthM).toBeGreaterThan(620);
  });

  it('starts_an_out_lap_where_the_pit_exit_joins_the_line', () => {
    const exit = pitAnalysis.pitStops[0]!.exitRawIndex;
    const offsetM = (index: number) => (index < 30 ? 25 : Math.max(0, 25 - (index - 30) * 1.25));
    const wide = pitSamples.map(sample => {
      if (sample.lap !== 2 || sample.rawIndex < exit || sample.rawIndex >= exit + 50) return sample;
      const { x, z } = sample.position;
      const outward = Math.hypot(x, z - 100);
      const metres = offsetM(sample.rawIndex - exit);
      return { ...sample, position: { x: x + (metres * x) / outward, y: 0, z: z + (metres * (z - 100)) / outward } };
    });
    const { attempt, gridM } = compareLaps(wide, pitAnalysis, 2, 3, DEFAULT_CONFIG)!.review;
    expect(firstValueM(attempt.v, gridM)).toBeGreaterThan(95);
    expect(firstValueM(attempt.v, gridM)).toBeLessThan(105);
    expect(attempt.v.at(-1)).not.toBeNull();
  });

  it('ends_the_time_lost_of_an_out_lap_at_the_difference_of_the_lap_times', () => {
    for (const [lap, withLap, gapMs] of [
      [2, 3, 3000],
      [3, 2, -3000]
    ] as const) {
      const { review, lapMs, withMs } = compareLaps(pitSamples, pitAnalysis, lap, withLap, DEFAULT_CONFIG)!;
      expect(lapMs - withMs).toBe(gapMs);
      const lost = lostMs(review);
      expect(lost[lost.findLastIndex(value => value !== null)], `${lap} with ${withLap}`).toBeCloseTo(gapMs, 6);
    }
  });

  it('starts_the_time_lost_of_an_out_lap_with_the_time_in_the_pit_lane', () => {
    const lost = lostMs(compareLaps(pitSamples, pitAnalysis, 2, 3, DEFAULT_CONFIG)!.review);
    expect(lost[lost.findIndex(value => value !== null)]).toBeCloseTo(3000, 0);
  });

  it('keeps_the_turn_losses_of_an_out_lap', () => {
    const shifted = compareLaps(pitSamples, pitAnalysis, 2, 3, DEFAULT_CONFIG)!;
    const losses = shifted.turnLosses.map(loss => loss.lostMs).filter(value => value !== null);
    expect(losses.length).toBeGreaterThan(0);
    for (const value of losses) expect(Math.abs(value)).toBeLessThan(100);
  });

  it('starts_the_time_lost_of_an_in_lap_at_0_at_the_lap_line', () => {
    const lost = lostMs(compareLaps(pitSamples, pitAnalysis, 1, 3, DEFAULT_CONFIG)!.review);
    expect(lost[0]).toBeCloseTo(0, 6);
    expect(lost.at(-1)).toBeNull();
  });

  it('starts_the_time_lost_at_0_when_an_in_lap_meets_an_out_lap', () => {
    for (const [lap, withLap] of [
      [1, 2],
      [2, 1]
    ] as const) {
      const lost = lostMs(compareLaps(pitSamples, pitAnalysis, lap, withLap, DEFAULT_CONFIG)!.review);
      expect(lost[lost.findIndex(value => value !== null)], `${lap} with ${withLap}`).toBeCloseTo(0, 6);
    }
  });

  it('keeps_the_time_lost_of_two_laps_without_a_pit_stop', () => {
    const lost = lostMs(compareLaps(samples, analysis, 2, 1, DEFAULT_CONFIG)!.review);
    expect(lost[0]).toBeCloseTo(0, 6);
    expect(lost.at(-1)).toBeCloseTo(0, 0);
  });

  it('compares_a_lap_with_an_out_lap', () => {
    const result = compareLaps(pitSamples, pitAnalysis, 3, 2, DEFAULT_CONFIG)!;
    expect(gaps(result.review.attempt.v)).toBe(0);
    expect(result.review.lengthM).toBeLessThan(570);
  });

  it('gives_an_empty_review_when_an_out_lap_never_joins_the_line', () => {
    const exit = pitAnalysis.pitStops[0]!.exitRawIndex;
    const away = pitSamples.map(sample => (sample.lap === 2 && sample.rawIndex >= exit ? { ...sample, position: { ...sample.position, y: 50 } } : sample));
    const { attempt } = compareLaps(away, pitAnalysis, 2, 3, DEFAULT_CONFIG)!.review;
    expect(attempt.v.every(value => value === null)).toBe(true);
  });

  it('compares_an_in_lap_up_to_the_pit_stop', () => {
    const { attempt, gridM } = compareLaps(pitSamples, pitAnalysis, 1, 3, DEFAULT_CONFIG)!.review;
    const lastIndex = attempt.v.findLastIndex(value => value !== null);
    expect(attempt.v[0]).not.toBeNull();
    expect(lastIndex * gridM).toBeGreaterThan(560);
    expect(lastIndex * gridM).toBeLessThan(570);
  });
});

describe('an out-lap whose in-lap is not recorded', () => {
  const joined = raceOf({ laps: [60000, 58000, 59000, 61000], lapsInRace: 4, pitAfter: [2], joinAtLap: 2 });
  const joinedAnalysis = analyseRace(joined, DEFAULT_CONFIG)!;

  it('compares_the_out_lap_from_the_pit_exit', () => {
    const { attempt, gridM } = compareLaps(joined, joinedAnalysis, 3, 4, DEFAULT_CONFIG)!.review;
    expect(firstValueM(attempt.v, gridM)).toBeGreaterThan(55);
    expect(firstValueM(attempt.v, gridM)).toBeLessThan(70);
    expect(compareLaps(joined, joinedAnalysis, 4, 3, DEFAULT_CONFIG)).not.toBeNull();
  });

  it('gives_the_pit_lane_of_the_out_lap', () => {
    const outLap = offTrackView(joined, joinedAnalysis, DEFAULT_CONFIG)!.pitLane;
    expect(outLap).toEqual([{ lap: 3, fromSM: 0, toSM: expect.any(Number) }]);
    expect(outLap[0]!.toSM).toBeGreaterThan(55);
    expect(outLap[0]!.toSM).toBeLessThan(70);
  });
});

describe('lapsSpeed', () => {
  it('gives_one_speed_series_per_lap_on_the_review_grid', () => {
    const speed = lapsSpeed(samples, analysis, DEFAULT_CONFIG)!;
    expect(speed.gridM).toBe(DEFAULT_CONFIG.reviewGridM);
    expect(speed.lengthM).toBeCloseTo(analysis.lapLengthM!, 6);
    expect(speed.laps.map(lap => lap.number)).toEqual([1, 2, 3]);
    const cells = Math.floor(speed.lengthM / speed.gridM) + 1;
    for (const lap of speed.laps) {
      expect(lap.v).toHaveLength(cells);
      expect(lap.v.filter(value => value === null).length).toBeLessThan(3);
    }
    expect(speed.turns.length).toBeGreaterThan(0);
  });

  it('leaves_the_pit_lane_of_a_lap_empty', () => {
    const speed = lapsSpeed(pitSamples, pitAnalysis, DEFAULT_CONFIG)!;
    const [inLap, outLap] = speed.laps;
    expect(inLap!.v.findLastIndex(value => value !== null) * speed.gridM).toBeLessThan(570);
    expect(firstValueM(outLap!.v, speed.gridM)).toBeGreaterThan(55);
  });

  it('gives_null_without_a_reference_path', () => {
    expect(lapsSpeed(samples, { ...analysis, referenceLap: 99 }, DEFAULT_CONFIG)).toBeNull();
  });
});

describe('offTrackView', () => {
  it('gives_the_line_height_and_speed_of_the_reference_lap', () => {
    const view = offTrackView(samples, analysis, DEFAULT_CONFIG)!;
    const cells = Math.floor(view.lengthM / view.gridM) + 1;
    expect([view.x.length, view.z.length, view.heightM.length, view.speedMps.length]).toEqual([cells, cells, cells, cells]);
    expect(Math.min(...view.heightM)).toBe(0);
    expect(view.speedMps[10]).toBeGreaterThan(60);
    expect(view.pitLane).toEqual([]);
  });

  it('gives_the_height_above_the_lowest_place_of_the_reference_lap', () => {
    const hilly = samples.map(sample => ({ ...sample, position: { ...sample.position, y: 40 + 10 * Math.sin(sample.position.x / 30) } }));
    const view = offTrackView(hilly, analyseRace(hilly, DEFAULT_CONFIG)!, DEFAULT_CONFIG)!;
    expect(Math.min(...view.heightM)).toBeCloseTo(0, 6);
    expect(Math.max(...view.heightM)).toBeGreaterThan(15);
  });

  it('ends_the_pit_lane_of_an_out_lap_where_the_lap_joins_the_line', () => {
    const exit = pitAnalysis.pitStops[0]!.exitRawIndex;
    const offsetM = (index: number) => (index < 30 ? 25 : Math.max(0, 25 - (index - 30) * 1.25));
    const wide = pitSamples.map(sample => {
      if (sample.lap !== 2 || sample.rawIndex < exit || sample.rawIndex >= exit + 50) return sample;
      const { x, z } = sample.position;
      const outward = Math.hypot(x, z - 100);
      const metres = offsetM(sample.rawIndex - exit);
      return { ...sample, position: { x: x + (metres * x) / outward, y: 0, z: z + (metres * (z - 100)) / outward } };
    });
    const outLap = offTrackView(wide, pitAnalysis, DEFAULT_CONFIG)!.pitLane.find(range => range.lap === 2)!;
    expect(outLap.toSM).toBeGreaterThan(95);
    expect(outLap.toSM).toBeLessThan(105);
  });

  it('gives_the_pit_lane_ranges_of_an_in_lap_and_an_out_lap', () => {
    const view = offTrackView(pitSamples, pitAnalysis, DEFAULT_CONFIG)!;
    expect(view.pitLane).toHaveLength(2);
    const [inLap, outLap] = view.pitLane;
    expect(inLap!.lap).toBe(1);
    expect(inLap!.fromSM).toBeGreaterThan(560);
    expect(inLap!.fromSM).toBeLessThan(570);
    expect(inLap!.toSM).toBeCloseTo(view.lengthM, 6);
    expect(outLap).toMatchObject({ lap: 2, fromSM: 0 });
    expect(outLap!.toSM).toBeGreaterThan(55);
    expect(outLap!.toSM).toBeLessThan(70);
  });
});
