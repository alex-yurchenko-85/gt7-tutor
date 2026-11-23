import { describe, expect, it } from 'vitest';
import type { Corner } from '../src/corners.ts';
import { turnLosses, turnOf, turnZones, type TurnLoss } from '../src/turns.ts';
import { kph } from '../src/units.ts';
import { buildReview, type Review } from '../src/compare.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { analyseRace } from '../src/race-analysis.ts';
import { compareLaps } from '../src/race-compare.ts';
import { between, samplesOf } from './fixtures.ts';
import { interlagosAnalysis } from './paths.ts';
import { raceOf } from './synthetic.ts';

function corner(number: number, zoneStartSM: number, turnInSM = zoneStartSM + 20, apexSM = zoneStartSM + 40): Corner {
  return {
    number,
    zoneStartSM,
    turnInSM,
    apexSM,
    radiusM: 60,
    apexSpeedMps: kph(90),
    insideSign: 1,
    brakeToSM: null,
    brakeAtTurnIn: null,
    lowSpeedSM: null,
    lowSpeedMps: null
  };
}

function ranges(losses: TurnLoss[]) {
  return losses.map(loss => ({ turn: loss.turn, fromSM: loss.fromSM, toSM: loss.toSM, lostMs: loss.lostMs }));
}

describe('turns', () => {
  it('turn_of_uses_zone_start_and_first_turn_before_it', () => {
    const corners = [corner(1, 100), corner(2, 300)];
    expect(turnOf(corners, 50)).toBe(1);
    expect(turnOf(corners, 350)).toBe(2);
    expect(turnOf([], 10)).toBeNull();
  });

  it('turn_zone_runs_from_the_turn_in_to_the_same_distance_after_the_apex', () => {
    expect(turnZones([corner(1, 100), corner(2, 300)], 500)).toEqual([
      { turn: 1, fromSM: 120, toSM: 160 },
      { turn: 2, fromSM: 320, toSM: 360 }
    ]);
  });

  it('zones_end_at_the_next_turn_in', () => {
    const zones = turnZones([corner(1, 100, 120, 160), corner(2, 150, 180, 210)], 500);
    expect(zones).toEqual([
      { turn: 1, fromSM: 120, toSM: 180 },
      { turn: 2, fromSM: 180, toSM: 240 }
    ]);
    expect(zones[0]!.toSM).toBeLessThanOrEqual(zones[1]!.fromSM);
  });

  it('zones_end_at_the_end_of_the_section', () => {
    expect(turnZones([corner(1, 400, 450, 480)], 500)).toEqual([{ turn: 1, fromSM: 450, toSM: 500 }]);
    expect(turnZones([], 500)).toEqual([]);
  });

  it('interlagos_sector_2_turn_1_zone', () => {
    const { corners, path } = interlagosAnalysis();
    expect(turnZones(corners, path.lengthM)).toEqual([{ turn: 1, fromSM: 346, toSM: 462 }]);
  });

  it('turn_losses_run_from_the_opening_event_of_a_turn_to_the_opening_event_of_the_next_turn', () => {
    const t = Array.from({ length: 51 }, (_, i) => i * 100);
    const ref = Array.from({ length: 51 }, (_, i) => i * 100 - i * 20);
    expect(ranges(turnLosses([corner(1, 100), corner(2, 300)], 500, 10, t, ref))).toEqual([
      { turn: 1, fromSM: 0, toSM: 300, lostMs: 600 },
      { turn: 2, fromSM: 300, toSM: 500, lostMs: 400 }
    ]);
  });

  it('turn_loss_splits_at_the_turn_in_and_the_apex_of_the_reference', () => {
    const t = Array.from({ length: 51 }, (_, i) => i * 100);
    const ref = Array.from({ length: 51 }, (_, i) => i * 100 - i * 20);
    const [first, second] = turnLosses([corner(1, 100), corner(2, 300)], 500, 10, t, ref);
    expect(first!.parts).toEqual({ approach: 240, entry: 40, exit: 320 });
    expect(second!.parts).toEqual({ approach: 40, entry: 40, exit: 320 });
    expect([first!.entrySM, first!.exitSM, second!.entrySM, second!.exitSM]).toEqual([120, 140, 320, 340]);
    expect(first!.parts.approach! + first!.parts.entry! + first!.parts.exit!).toBe(first!.lostMs);
  });

  it('turn_loss_part_is_empty_when_the_turn_in_is_before_the_range_start', () => {
    const t = Array.from({ length: 51 }, (_, i) => i * 100);
    const ref = Array.from({ length: 51 }, (_, i) => i * 100 - i * 20);
    const [, second] = turnLosses([corner(1, 100), corner(2, 300, 280, 340)], 500, 10, t, ref);
    expect(second!.parts).toEqual({ approach: 0, entry: 80, exit: 320 });
    expect([second!.entrySM, second!.exitSM]).toEqual([300, 340]);
  });

  it('turn_loss_without_a_value_has_no_parts', () => {
    expect(turnLosses([corner(1, 100)], 500, 10, [], [])[0]!.parts).toEqual({ approach: null, entry: null, exit: null });
  });

  it('turn_losses_include_the_exit_and_the_straight_after_the_zone', () => {
    const t = Array.from({ length: 51 }, (_, i) => i * 100 + (i > 20 ? 300 : 0));
    const ref = Array.from({ length: 51 }, (_, i) => i * 100);
    const [first] = turnLosses([corner(1, 100), corner(2, 300)], 500, 10, t, ref);
    expect(ranges([first!])).toEqual([{ turn: 1, fromSM: 0, toSM: 300, lostMs: 300 }]);
  });

  it('turn_losses_give_a_hole_on_a_boundary_to_the_sector_after_it', () => {
    const t = Array.from({ length: 51 }, (_, i) => (i >= 28 && i <= 32 ? null : i * 100 + (i > 30 ? 200 : 0)));
    const ref = Array.from({ length: 51 }, (_, i) => i * 100);
    expect(ranges(turnLosses([corner(1, 100), corner(2, 300)], 500, 10, t, ref))).toEqual([
      { turn: 1, fromSM: 0, toSM: 300, lostMs: 0 },
      { turn: 2, fromSM: 300, toSM: 500, lostMs: 200 }
    ]);
  });

  it('turn_losses_null_for_a_sector_without_a_gap', () => {
    const t = Array.from({ length: 51 }, (_, i) => (i <= 25 ? i * 100 : null));
    const ref = Array.from({ length: 51 }, (_, i) => i * 90);
    expect(ranges(turnLosses([corner(1, 100), corner(2, 300)], 500, 10, t, ref))).toEqual([
      { turn: 1, fromSM: 0, toSM: 300, lostMs: 250 },
      { turn: 2, fromSM: 300, toSM: 500, lostMs: null }
    ]);
  });

  it('turn_losses_null_when_the_only_gap_of_a_range_is_its_shared_start_cell', () => {
    const t = Array.from({ length: 51 }, (_, i) => (i <= 30 ? i * 100 : null));
    const ref = Array.from({ length: 51 }, (_, i) => i * 90);
    expect(turnLosses([corner(1, 100), corner(2, 300)], 500, 10, t, ref).map(loss => loss.lostMs)).toEqual([300, null]);
  });

  it('turn_losses_count_a_first_range_whose_only_gap_is_cell_0', () => {
    const t = Array.from({ length: 51 }, (_, i) => (i === 0 ? 0 : null));
    const ref = Array.from({ length: 51 }, (_, i) => i * 90);
    expect(turnLosses([corner(1, 100), corner(2, 300)], 500, 10, t, ref).map(loss => loss.lostMs)).toEqual([0, null]);
  });

  it('turn_losses_start_at_the_first_gap_when_the_path_starts_without_a_match', () => {
    const t = Array.from({ length: 51 }, (_, i) => (i < 5 ? null : 5000 + i * 100));
    const ref = Array.from({ length: 51 }, (_, i) => i * 90);
    expect(ranges(turnLosses([corner(1, 100), corner(2, 300)], 500, 10, t, ref))).toEqual([
      { turn: 1, fromSM: 0, toSM: 300, lostMs: 250 },
      { turn: 2, fromSM: 300, toSM: 500, lostMs: 200 }
    ]);
  });

  it('turn_losses_snap_a_boundary_to_the_nearest_grid_cell', () => {
    const t = Array.from({ length: 51 }, (_, i) => i * 100 + i * i);
    const ref = Array.from({ length: 51 }, (_, i) => i * 100);
    const losses = turnLosses([corner(1, 100), corner(2, 303)], 500, 10, t, ref);
    expect(losses.map(loss => loss.lostMs)).toEqual([900, 1600]);
    expect(losses[1]!.fromSM).toBe(303);
  });

  it('turn_losses_empty_without_corners', () => {
    expect(turnLosses([], 500, 10, [], [])).toEqual([]);
  });
});

function endGapMs(attemptT: (number | null)[], referenceT: (number | null)[]): number {
  const gaps = attemptT.flatMap((value, index) => (value === null || referenceT[index] === null || referenceT[index] === undefined ? [] : [value - referenceT[index]!]));
  return gaps.at(-1)! - gaps[0]!;
}

function lossSum(review: Review, corners: Corner[] = review.corners): number {
  return turnLosses(corners, review.lengthM, review.gridM, review.attempt.t, review.reference.t).reduce((sum, loss) => sum + (loss.lostMs ?? 0), 0);
}

describe('turn losses add up to the gap', () => {
  const attempts: [string, Review][] = [
    ['ce-clean', buildReview(between(samplesOf('ce-clean'), 8451, 9479), interlagosAnalysis(), DEFAULT_CONFIG)],
    ['ce-slow', buildReview(between(samplesOf('ce-slow'), 5491, 6624), interlagosAnalysis(), DEFAULT_CONFIG)],
    ['ce-pause', buildReview(between(samplesOf('ce-pause'), 11564, 13309), interlagosAnalysis(), DEFAULT_CONFIG)]
  ];
  const race = raceOf({ laps: [60000, 59000, 61000], lapsInRace: 3, brakeLater: { lap: 2, m: 20 } });
  const raceAnalysis = analyseRace(race, DEFAULT_CONFIG)!;
  const pit = raceOf({ laps: [60000, 62000, 59000], lapsInRace: 3, pitAfter: [1] });
  const pitAnalysis = analyseRace(pit, DEFAULT_CONFIG)!;
  const laps: [string, Review][] = [
    ['race 2 with 1', compareLaps(race, raceAnalysis, 2, 1, DEFAULT_CONFIG)!.review],
    ['race 3 with 2', compareLaps(race, raceAnalysis, 3, 2, DEFAULT_CONFIG)!.review],
    ['out-lap 2 with 3', compareLaps(pit, pitAnalysis, 2, 3, DEFAULT_CONFIG)!.review],
    ['in-lap 1 with 3', compareLaps(pit, pitAnalysis, 1, 3, DEFAULT_CONFIG)!.review],
    ['lap 3 with out-lap 2', compareLaps(pit, pitAnalysis, 3, 2, DEFAULT_CONFIG)!.review]
  ];

  it.each([...attempts, ...laps])('sum_of_turn_losses_equals_the_gap_change_%s', (_, review) => {
    expect(review.corners.length).toBeGreaterThan(0);
    expect(Math.abs(lossSum(review) - endGapMs(review.attempt.t, review.reference.t))).toBeLessThanOrEqual(1);
  });

  it.each([...attempts, ...laps])('sum_of_many_sector_losses_equals_the_gap_change_%s', (_, review) => {
    const step = review.lengthM / 7;
    const many = Array.from({ length: 6 }, (__, index) => corner(index + 1, Math.round(step * (index + 1) + 0.7)));
    expect(Math.abs(lossSum(review, many) - endGapMs(review.attempt.t, review.reference.t))).toBeLessThanOrEqual(1);
  });
});

describe('turn losses without samples', () => {
  it('null_for_each_turn_when_the_attempt_has_no_cell', () => {
    expect(ranges(turnLosses([corner(1, 100)], 500, 10, [], []))).toEqual([{ turn: 1, fromSM: 0, toSM: 500, lostMs: null }]);
  });
});
