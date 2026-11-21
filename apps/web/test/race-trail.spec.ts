import { describe, expect, it } from 'vitest';
import { keepTrailPoint, trailCoversLap, trailFit, trailSegments, withPoint, type TrailPoint } from '../src/features/races/race-trail.ts';

function line(count: number, stepMs = 100, stepM = 5): TrailPoint[] {
  return Array.from({ length: count }, (_, index) => ({ x: index * stepM, z: 0, tMs: index * stepMs }));
}

describe('race trail', () => {
  it('fades_by_age_from_the_car_to_the_floor', () => {
    const points = line(101);
    const segments = trailSegments(points, 10_000, 10_000);
    expect(segments).toHaveLength(10);
    expect(segments.at(-1)!.opacity).toBeGreaterThan(0.9);
    expect(segments[0]!.opacity).toBeCloseTo(0.1, 2);
    const opacities = segments.map(segment => segment.opacity);
    expect([...opacities].sort((a, b) => a - b)).toEqual(opacities);
  });

  it('never_goes_below_the_floor_and_drops_points_older_than_the_fade', () => {
    const points = line(201);
    const segments = trailSegments(points, 20_000, 10_000);
    expect(Math.min(...segments.map(segment => segment.opacity))).toBeGreaterThanOrEqual(0.1);
    expect(segments[0]!.d.startsWith('M500 0')).toBe(true);
    expect(segments).toHaveLength(10);
  });

  it('keeps_every_point_in_lap_1_and_starts_the_oldest_at_045', () => {
    const points = line(301);
    const segments = trailSegments(points, 30_000, null);
    expect(segments[0]!.d.startsWith('M0 0')).toBe(true);
    expect(segments[0]!.opacity).toBeCloseTo(0.45, 2);
    expect(segments.at(-1)!.opacity).toBeGreaterThan(0.95);
  });

  it('breaks_the_line_where_two_points_are_more_than_100_m_apart', () => {
    const points = [...line(5), ...line(5).map(point => ({ ...point, x: point.x + 500, tMs: point.tMs + 500 }))];
    const segments = trailSegments(points, 1000, null);
    expect(segments).toHaveLength(2);
    expect(segments.every(segment => !segment.d.includes('L500 0') || segment.d.startsWith('M500 0'))).toBe(true);
    expect(segments[0]!.d).toBe('M0 0L5 0L10 0L15 0L20 0');
  });

  it('joins_the_segments_of_a_run_without_a_gap', () => {
    const segments = trailSegments(line(21), 2000, null);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.d.endsWith('L50 0')).toBe(true);
    expect(segments[1]!.d.startsWith('M50 0')).toBe(true);
  });

  it('gives_nothing_for_fewer_than_two_points', () => {
    expect(trailSegments([], 0, null)).toEqual([]);
    expect(trailSegments(line(1), 0, 1000)).toEqual([]);
  });

  it('keeps_at_most_10_points_per_second_and_drops_old_points', () => {
    let points: TrailPoint[] = [];
    for (let tMs = 0; tMs <= 1000; tMs += 1000 / 60) {
      points = keepTrailPoint(points, { x: tMs, z: 0, tMs }, null) ?? points;
    }
    expect(points.length).toBeLessThanOrEqual(11);
    const later = keepTrailPoint(points, { x: 5000, z: 0, tMs: 5000 }, 2000)!;
    expect(later).toEqual([{ x: 5000, z: 0, tMs: 5000 }]);
  });

  it('does_not_fade_while_the_position_does_not_change', () => {
    const points = line(50);
    const before = trailSegments(points, points.at(-1)!.tMs, 3000);
    const last = points.at(-1)!;
    expect(keepTrailPoint(points, { x: last.x, z: last.z, tMs: last.tMs + 5000 }, 3000)).toBeNull();
    expect(trailSegments(points, points.at(-1)!.tMs, 3000)).toEqual(before);
  });

  it('fits_x_and_z_with_one_scale', () => {
    const fit = trailFit({ x0: 0, x1: 1000, z0: 0, z1: 250 }, 400, 400, 20);
    expect(fit.scale).toBeCloseTo(0.36, 5);
    expect(fit.tx).toBeCloseTo(20, 5);
    expect(fit.ty).toBeCloseTo((400 - 250 * 0.36) / 2, 5);
    const tall = trailFit({ x0: -100, x1: 100, z0: 0, z1: 1000 }, 400, 400, 20);
    expect(tall.scale).toBeCloseTo(0.36, 5);
    expect(tall.tx).toBeCloseTo((400 - 200 * 0.36) / 2 + 100 * 0.36, 5);
  });

  it('grows_the_fixed_map_by_a_point_outside_it_and_keeps_it_for_a_point_inside', () => {
    const fixed = { x0: 0, x1: 100, z0: 0, z1: 50 };
    expect(withPoint(fixed, { x: 50, z: 20, tMs: 0 })).toBe(fixed);
    expect(withPoint(fixed, { x: -10, z: 80, tMs: 0 })).toEqual({ x0: -10, x1: 100, z0: 0, z1: 80 });
    expect(withPoint(fixed, { x: 130, z: -5, tMs: 0 })).toEqual({ x0: 0, x1: 130, z0: -5, z1: 50 });
  });

  it('fixes_the_map_only_when_the_points_cover_a_lap', () => {
    expect(trailCoversLap(line(1), 60_000)).toBe(false);
    expect(trailCoversLap(line(301), 60_000)).toBe(false);
    expect(trailCoversLap(line(551), 60_000)).toBe(true);
    expect(trailCoversLap(line(601), null)).toBe(false);
  });
});
