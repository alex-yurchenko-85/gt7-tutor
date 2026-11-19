import { describe, expect, it } from 'vitest';
import { coveredPoints, placeCallout, type CalloutPlaceInput } from '../src/charts/callout-place.ts';
import type { Point } from '../src/charts/geometry.ts';

const BOUNDS = { width: 800, height: 400 };

function input(overrides: Partial<CalloutPlaceInput> = {}): CalloutPlaceInput {
  return {
    anchor: [400, 200],
    normal: [0, 1],
    side: 1,
    width: 150,
    height: 44,
    leader: 70,
    bounds: BOUNDS,
    margin: 4,
    clearance: 6,
    obstacles: [],
    taken: [],
    ...overrides
  };
}

function horizontalLine(y: number): Point[] {
  return Array.from({ length: 401 }, (_, index) => [index * 2, y] as Point);
}

function block(fromY: number, toY: number): Point[] {
  const points: Point[] = [];
  for (let x = 0; x <= 800; x += 4) for (let y = fromY; y <= toY; y += 4) points.push([x, y]);
  return points;
}

function inside(box: { x: number; y: number; width: number; height: number }) {
  expect(box.x).toBeGreaterThanOrEqual(4);
  expect(box.y).toBeGreaterThanOrEqual(4);
  expect(box.x + box.width).toBeLessThanOrEqual(796);
  expect(box.y + box.height).toBeLessThanOrEqual(396);
}

describe('callout place', () => {
  it('box_never_covers_a_line_point_when_a_free_place_exists', () => {
    const obstacles = horizontalLine(200);
    const place = placeCallout(input({ obstacles }));
    expect(coveredPoints(place.box, obstacles, 6)).toBe(0);
    expect(place.box.y).toBeGreaterThan(200);
    inside(place.box);
  });

  it('free_place_on_one_side_only_picks_that_side', () => {
    const obstacles = [...horizontalLine(200), ...block(204, 400)];
    const place = placeCallout(input({ obstacles }));
    expect(coveredPoints(place.box, obstacles, 6)).toBe(0);
    expect(place.box.y + place.box.height).toBeLessThan(200);
    inside(place.box);
  });

  it('longer_leader_when_both_near_places_are_taken', () => {
    const obstacles = [...horizontalLine(200), ...block(140, 260)];
    const place = placeCallout(input({ obstacles }));
    expect(coveredPoints(place.box, obstacles, 6)).toBe(0);
    expect(place.box.y > 260 || place.box.y + place.box.height < 140).toBe(true);
  });

  it('leader_ends_on_the_box_edge', () => {
    const place = placeCallout(input());
    expect(place.end[1]).toBe(place.box.y);
    expect(place.end[0]).toBeGreaterThanOrEqual(place.box.x);
    expect(place.end[0]).toBeLessThanOrEqual(place.box.x + place.box.width);
  });

  it('box_stays_apart_from_a_box_already_placed', () => {
    const first = placeCallout(input());
    const second = placeCallout(input({ anchor: [410, 205], taken: [first.box] }));
    const apart =
      second.box.x >= first.box.x + first.box.width ||
      first.box.x >= second.box.x + second.box.width ||
      second.box.y >= first.box.y + first.box.height ||
      first.box.y >= second.box.y + second.box.height;
    expect(apart).toBe(true);
  });

  it('no_free_place_takes_the_fewest_covered_points', () => {
    const obstacles = [...block(0, 400), ...block(300, 400)];
    const place = placeCallout(input({ obstacles }));
    inside(place.box);
    expect(place.box.y + place.box.height).toBeLessThan(300);
  });

  it('box_stays_inside_the_map_near_an_edge', () => {
    const place = placeCallout(input({ anchor: [790, 395], normal: [1, 0] }));
    inside(place.box);
  });

  it('free_place_away_from_the_normal_is_found', () => {
    const obstacles = [...block(0, 300).filter(([x]) => x > 200), ...block(150, 300)];
    const place = placeCallout(input({ anchor: [500, 200], normal: [1, 0], obstacles }));
    expect(coveredPoints(place.box, obstacles, 6)).toBe(0);
    inside(place.box);
  });
});
