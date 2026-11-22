import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { analyseRace } from '../src/race-analysis.ts';
import { goldenLap, type GoldenLap } from '../src/race-golden.ts';
import { raceOf, type RaceOptions } from './synthetic.ts';

type Race = Omit<RaceOptions, 'laps' | 'lapsInRace' | 'timedLaps'> & { count: number };

function golden({ count, ...options }: Race): GoldenLap {
  const samples = raceOf({ track: 'stadium', laps: Array<number>(count).fill(0), lapsInRace: count, timedLaps: true, ...options });
  return goldenLap(samples, analyseRace(samples, DEFAULT_CONFIG)!, DEFAULT_CONFIG);
}

function ok(result: GoldenLap): Extract<GoldenLap, { state: 'ok' }> {
  if (result.state !== 'ok') throw new Error(`state ${result.state}`);
  return result;
}

const FAST_FIRST_HALF = { from: 20, to: 100, factor: 1.1 };
const FAST_SECOND_HALF = { from: 450, to: 530, factor: 1.1 };

describe('goldenLap', () => {
  it('builds_the_golden_lap_from_compatible_sectors', () => {
    const result = ok(golden({ count: 4, pace: [{ lap: 3, ...FAST_FIRST_HALF }, { lap: 4, ...FAST_SECOND_HALF }] }));
    expect(result.cleanLaps).toEqual([2, 3, 4]);
    expect(result.sourceLaps).toEqual([3, 4]);
    expect(result.sectors.map(sector => [sector.turn, sector.lap, sector.bestLap, sector.bestJoins])).toEqual([
      [1, 3, 3, true],
      [2, 4, 4, true]
    ]);
    expect(Math.abs(result.goldenMs - (result.sectors[0]!.bestMs + result.sectors[1]!.bestMs))).toBeLessThan(1);
    expect(result.goldenMs).toBeLessThan(result.bestMs - 100);
    expect(result.sectors[0]!.fromM).toBe(0);
    expect(result.sectors[0]!.toM).toBe(result.sectors[1]!.fromM);
    for (const sector of result.sectors) {
      expect(sector.cleanLaps).toBe(3);
      expect(sector.spreadMs).toBeCloseTo(sector.medianMs - sector.bestMs, 6);
      expect(sector.slipstream).toBe(false);
    }
  });

  it('rejects_a_join_that_differs_in_speed_or_line', () => {
    const faster = ok(golden({ count: 5, pace: [{ lap: 3, ...FAST_FIRST_HALF }, { lap: 4, from: 150, to: 600, factor: 1.04 }] }));
    expect(faster.sectors.map(sector => [sector.lap, sector.bestLap, sector.bestJoins])).toEqual([
      [4, 3, false],
      [4, 4, true]
    ]);
    const aside = ok(golden({ count: 5, pace: [{ lap: 3, ...FAST_FIRST_HALF }, { lap: 4, ...FAST_SECOND_HALF, factor: 1.05 }], aside: [{ lap: 4, from: 150, to: 600, m: 2 }] }));
    expect(aside.sectors.map(sector => [sector.lap, sector.bestLap, sector.bestJoins])).toEqual([
      [3, 3, true],
      [3, 4, false]
    ]);
    expect(aside.sourceLaps).toEqual([3]);
  });

  it('drops_lap_1_pit_laps_and_off_track_sectors', () => {
    const result = ok(
      golden({
        count: 6,
        pitAfter: [3],
        pace: [{ lap: 1, ...FAST_FIRST_HALF, factor: 1.2 }, { lap: 5, ...FAST_FIRST_HALF }],
        offTrack: [{ lap: 5, from: 200, to: 210 }]
      })
    );
    expect(result.cleanLaps).toEqual([2, 5, 6]);
    expect(result.sectors[0]!.cleanLaps).toBe(2);
    expect(result.sectors[0]!.lap).not.toBe(5);
    expect(result.sectors[0]!.bestLap).not.toBe(5);
    expect(result.sectors[1]!.cleanLaps).toBe(3);
  });

  it('too_few_clean_laps_gives_no_golden_lap', () => {
    const result = golden({ count: 6, pitAfter: [2], aside: [{ lap: 6, from: 0, to: 600, m: 30 }] });
    expect(result).toEqual({
      state: 'too-few',
      cleanLaps: [4, 5],
      excluded: [
        { lap: 1, reason: 'first' },
        { lap: 2, reason: 'pit' },
        { lap: 3, reason: 'pit' },
        { lap: 6, reason: 'open' }
      ]
    });
  });

  it('names_the_first_recorded_lap_as_first', () => {
    const result = golden({ count: 5, joinAtLap: 2 });
    expect(result).toEqual({ state: 'too-few', cleanLaps: [4, 5], excluded: [{ lap: 3, reason: 'first' }] });
  });

  it('a_sector_without_a_clean_lap_gives_a_gap', () => {
    const offTrack = [2, 3, 4, 5].map(lap => ({ lap, from: 470, to: 480 }));
    expect(golden({ count: 5, offTrack })).toEqual({ state: 'gap', cleanLaps: [2, 3, 4, 5], turn: 2 });
  });

  it('no_compatible_chain_gives_no_chain', () => {
    const result = golden({
      count: 4,
      offTrack: [
        { lap: 2, from: 50, to: 60 },
        { lap: 3, from: 470, to: 480 },
        { lap: 4, from: 50, to: 60 }
      ],
      aside: [{ lap: 3, from: 150, to: 600, m: 2 }]
    });
    expect(result).toEqual({ state: 'no-chain', cleanLaps: [2, 3, 4] });
  });

  it('one_sector_gives_the_best_clean_lap', () => {
    const result = ok(golden({ count: 4, track: 'circle', pace: [{ lap: 3, ...FAST_FIRST_HALF }] }));
    expect(result.sectors).toHaveLength(1);
    expect(result.sectors[0]).toMatchObject({ turn: null, lap: 3, bestLap: 3, bestJoins: true, fromM: 0 });
    expect(result.bestLap).toBe(3);
    expect(result.sourceLaps).toEqual([3]);
    expect(Math.abs(result.goldenMs - result.bestMs)).toBeLessThan(1);
  });

  it('slipstream_hint_needs_a_car_ahead', () => {
    const pace = [{ lap: 4, from: 300, to: 400, factor: 1.05 }];
    const leading = ok(golden({ count: 5, pace, positions: [8, 1, 1, 1, 1] }));
    expect(leading.sectors.map(sector => [sector.lap, sector.slipstream])).toEqual([
      [2, false],
      [4, false]
    ]);
    const following = ok(golden({ count: 5, pace, positions: [8, 3, 3, 3, 3] }));
    expect(following.sectors.map(sector => [sector.lap, sector.slipstream])).toEqual([
      [2, false],
      [4, true]
    ]);
  });

  it('checks_the_join_at_the_lap_line', () => {
    const result = ok(
      golden({
        count: 5,
        pace: [{ lap: 3, ...FAST_FIRST_HALF }, { lap: 4, ...FAST_SECOND_HALF, factor: 1.15 }],
        aside: [{ lap: 5, from: 0, to: 30, m: 2 }]
      })
    );
    expect(result.sectors[1]!.lap).toBe(4);
    expect(result.sectors[0]!.lap).not.toBe(3);
    expect(result.sectors[0]!.bestJoins).toBe(false);
  });
});
