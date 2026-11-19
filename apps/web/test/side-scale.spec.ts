import { describe, expect, it } from 'vitest';
import { SIDE_FACTOR, beyondSide, largestSideInZones, sideScaledLine } from '../src/charts/geometry.ts';
import type { TrackLine } from '../src/charts/TrackMap.tsx';

const EAST: TrackLine = { gridM: 2, x: [0, 2, 4, 6], z: [0, 0, 0, 0] };

describe('side distance on the map', () => {
  it('factor_is_six', () => {
    expect(SIDE_FACTOR).toBe(6);
  });

  it('scaled_point_is_the_reference_point_plus_factor_times_lat_along_the_right_normal', () => {
    const line = sideScaledLine(EAST, [1, -0.5, 0, 2], 6);
    expect(line.gridM).toBe(2);
    expect(line.x).toEqual([0, 2, 4, 6]);
    expect(line.z).toEqual([6, -3, 0, 12]);
  });

  it('positive_lat_is_drawn_to_the_right_of_the_travel_direction', () => {
    const north: TrackLine = { gridM: 2, x: [0, 0, 0], z: [0, 2, 4] };
    const line = sideScaledLine(north, [1, 1, 1], 6);
    expect(line.x).toEqual([-6, -6, -6]);
    expect(line.z).toEqual([0, 2, 4]);
  });

  it('scaled_point_uses_the_unit_normal_of_the_reference_tangent', () => {
    const diagonal: TrackLine = { gridM: 2, x: [0, 1, 2], z: [0, 1, 2] };
    const line = sideScaledLine(diagonal, [0, 2, 0], 6);
    expect(line.x[1]).toBeCloseTo(1 - 12 / Math.SQRT2, 9);
    expect(line.z[1]).toBeCloseTo(1 + 12 / Math.SQRT2, 9);
  });

  it('scaled_line_has_a_gap_where_lat_or_the_reference_has_no_value', () => {
    const reference: TrackLine = { gridM: 2, x: [0, 2, null, 6, 8], z: [0, 0, null, 0, 0] };
    const line = sideScaledLine(reference, [1, null, 1, 1, 1], 6);
    expect(line.x).toEqual([0, null, null, 6, 8]);
    expect(line.z).toEqual([6, null, null, 6, 6]);
  });

  it('beyond_side_keeps_only_the_parts_above_the_limit', () => {
    const line: TrackLine = { gridM: 2, x: [0, 1, 2, 3, 4, 5, 6], z: [0, 0, 0, 0, 0, 0, 0] };
    const far = beyondSide(line, [0, 3, -3, 0, 2.5, 0, 2], 2);
    expect(far.x).toEqual([null, 1, 2, 3, 4, 5, null]);
    expect(far.z).toEqual([null, 0, 0, 0, 0, 0, null]);
  });

  it('beyond_side_is_empty_when_no_point_is_above_the_limit', () => {
    const far = beyondSide(EAST, [1, -2, 2, null], 2);
    expect(far.x).toEqual([null, null, null, null]);
  });

  it('one_label_per_zone_at_the_largest_side_distance', () => {
    const lat = [0, 1, -5, 2, null, 0.4, 1.2, -0.3, null, null, null];
    const labels = largestSideInZones(
      [
        { number: 1, zoneFromSM: 0, zoneToSM: 8 },
        { number: 2, zoneFromSM: 10, zoneToSM: 14 },
        { number: 3, zoneFromSM: 16, zoneToSM: 20 }
      ],
      lat,
      2
    );
    expect(labels).toEqual([
      { turn: 1, sM: 4, lat: -5 },
      { turn: 2, sM: 12, lat: 1.2 }
    ]);
  });
});
