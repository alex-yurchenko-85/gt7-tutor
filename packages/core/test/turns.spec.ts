import { describe, expect, it } from 'vitest';
import type { Corner } from '../src/corners.ts';
import { turnLosses, turnOf, turnZones } from '../src/turns.ts';
import { kph } from '../src/units.ts';
import { interlagosAnalysis } from './paths.ts';

function corner(number: number, zoneStartSM: number, turnInSM = zoneStartSM + 20, apexSM = zoneStartSM + 40): Corner {
  return {
    number,
    zoneStartSM,
    turnInSM,
    apexSM,
    radiusM: 60,
    apexSpeedMps: kph(90),
    insideSign: 1
  };
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

  it('turn_losses_count_only_the_turn_zone', () => {
    const t = Array.from({ length: 51 }, (_, i) => i * 100);
    const ref = Array.from({ length: 51 }, (_, i) => i * 100 - i * 20);
    expect(turnLosses([corner(1, 100), corner(2, 300)], 500, 10, t, ref)).toEqual([
      { turn: 1, fromSM: 120, toSM: 160, lostMs: 80 },
      { turn: 2, fromSM: 320, toSM: 360, lostMs: 80 }
    ]);
  });

  it('turn_losses_null_without_two_matched_points', () => {
    const t = Array.from({ length: 51 }, (_, i) => (i <= 30 ? i * 100 : null));
    const ref = Array.from({ length: 51 }, (_, i) => i * 90);
    expect(turnLosses([corner(1, 100), corner(2, 300)], 500, 10, t, ref)).toEqual([
      { turn: 1, fromSM: 120, toSM: 160, lostMs: 40 },
      { turn: 2, fromSM: 320, toSM: 360, lostMs: null }
    ]);
  });

  it('turn_losses_use_the_first_and_last_matched_points_in_the_zone', () => {
    const t = Array.from({ length: 51 }, (_, i) => (i === 12 ? null : i * 100));
    const ref = Array.from({ length: 51 }, (_, i) => (i === 16 ? null : i * 90));
    expect(turnLosses([corner(1, 100)], 500, 10, t, ref)).toEqual([
      { turn: 1, fromSM: 120, toSM: 160, lostMs: 20 }
    ]);
  });

  it('turn_losses_empty_without_corners', () => {
    expect(turnLosses([], 500, 10, [], [])).toEqual([]);
  });
});
