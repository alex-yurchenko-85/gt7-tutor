import { describe, expect, it } from 'vitest';
import type { Corner } from '../src/corners.ts';
import { turnLosses, turnOf } from '../src/turns.ts';

function corner(number: number, zoneStartSM: number): Corner {
  return {
    number,
    zoneStartSM,
    turnInSM: zoneStartSM + 20,
    apexSM: zoneStartSM + 40,
    radiusM: 60,
    apexSpeedKph: 90,
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

  it('turn_losses_split_the_section_at_zone_starts', () => {
    const t = Array.from({ length: 51 }, (_, i) => i * 100);
    const ref = Array.from({ length: 51 }, (_, i) => i * 100 - i * 20);
    expect(turnLosses([corner(1, 100), corner(2, 300)], 500, 10, t, ref)).toEqual([
      { turn: 1, fromSM: 0, toSM: 300, lostMs: 600 },
      { turn: 2, fromSM: 300, toSM: 500, lostMs: 400 }
    ]);
  });

  it('turn_losses_null_without_two_matched_points', () => {
    const t = Array.from({ length: 51 }, (_, i) => (i <= 30 ? i * 100 : null));
    const ref = Array.from({ length: 51 }, (_, i) => i * 90);
    expect(turnLosses([corner(1, 100), corner(2, 300)], 500, 10, t, ref)).toEqual([
      { turn: 1, fromSM: 0, toSM: 300, lostMs: 300 },
      { turn: 2, fromSM: 300, toSM: 500, lostMs: null }
    ]);
  });

  it('turn_losses_use_the_first_and_last_matched_points_in_the_zone', () => {
    const t = Array.from({ length: 51 }, (_, i) => (i === 0 || i === 30 ? null : i * 100));
    const ref = Array.from({ length: 51 }, (_, i) => (i === 29 ? null : i * 90));
    expect(turnLosses([corner(1, 100)], 500, 10, t, ref)).toEqual([
      { turn: 1, fromSM: 0, toSM: 500, lostMs: 490 }
    ]);
  });

  it('turn_losses_empty_without_corners', () => {
    expect(turnLosses([], 500, 10, [], [])).toEqual([]);
  });
});
