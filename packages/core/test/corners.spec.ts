import type { Vec3 } from '@gt7/contracts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { cornerAt, findCorners, outsideM, type Corner } from '../src/corners.ts';
import { buildCueEvents } from '../src/cue-events.ts';
import { Matcher } from '../src/match.ts';
import type { ReferencePath } from '../src/reference.ts';
import { event } from './coaching.ts';
import { samplesOf } from './fixtures.ts';
import { pathFromCorners, polyline, yangwangReference } from './paths.ts';
import { drive } from './synthetic.ts';

function yangwangCorners(): Corner[] {
  const path = yangwangReference();
  return findCorners(path, buildCueEvents(path, DEFAULT_CONFIG), DEFAULT_CONFIG);
}

const ARC_RADIUS_M = 50;
const ARC_STEPS = 40;

function arcPoint(bend: 1 | -1, angle: number): Vec3 {
  return { x: 100 + ARC_RADIUS_M * Math.sin(angle), y: 0, z: bend * ARC_RADIUS_M * (1 - Math.cos(angle)) };
}

function arcCorners(bend: 1 | -1): Vec3[] {
  const arc = Array.from({ length: ARC_STEPS + 1 }, (_, index) => arcPoint(bend, ((index / ARC_STEPS) * Math.PI) / 2));
  return [{ x: 0, y: 0, z: 0 }, ...arc, { x: 150, y: 0, z: bend * (ARC_RADIUS_M + 100) }];
}

function towardCentre(bend: 1 | -1, position: Vec3): Vec3 {
  if (position.x <= 100) return { x: 0, y: 0, z: bend };
  const centre = { x: 100, z: bend * ARC_RADIUS_M };
  const dx = centre.x - position.x;
  const dz = centre.z - position.z;
  const size = Math.hypot(dx, dz);
  return { x: dx / size, y: 0, z: dz / size };
}

function arcPath(bend: 1 | -1): ReferencePath {
  return pathFromCorners(arcCorners(bend));
}

const arcEvents = [event('brake', 60, 50, 90), event('throttle', 150, null)];

function lateralAtApex(bend: 1 | -1, shiftM: number): { corner: Corner; lateralM: number } {
  const path = arcPath(bend);
  const corner = findCorners(path, arcEvents, DEFAULT_CONFIG)[0]!;
  const waypoints = polyline(arcCorners(bend), 20).filter(point => point.position.x < 100 + ARC_RADIUS_M * Math.sin(Math.PI / 4));
  const shifted = waypoints.map(point => {
    const inside = towardCentre(bend, point.position);
    return {
      ...point,
      position: { x: point.position.x + inside.x * shiftM, y: 0, z: point.position.z + inside.z * shiftM }
    };
  });
  const matcher = new Matcher(path, DEFAULT_CONFIG);
  const matches = drive(shifted).map(sample => matcher.step(sample));
  return { corner, lateralM: matches.at(-1)!.lateralM };
}

describe('corners', () => {
  it('yangwang_has_three_corners', () => {
    const corners = yangwangCorners();
    expect(corners.map(corner => corner.number)).toEqual([1, 2, 3]);
    const [first, second, third] = corners as [Corner, Corner, Corner];
    expect(Math.abs(first.apexSM - 519)).toBeLessThanOrEqual(5);
    expect(Math.abs(second.apexSM - 737)).toBeLessThanOrEqual(5);
    expect(Math.abs(third.apexSM - 870)).toBeLessThanOrEqual(5);
    expect(Math.abs(first.radiusM - 43)).toBeLessThanOrEqual(5);
    expect(Math.abs(second.radiusM - 66)).toBeLessThanOrEqual(7);
    expect(Math.abs(third.radiusM - 84)).toBeLessThanOrEqual(9);
    expect(corners.some(corner => Math.abs(corner.apexSM - 1071) <= 50)).toBe(false);
    expect(first.insideSign).toBe(-second.insideSign);
    expect(second.insideSign).toBe(third.insideSign);
  });

  it('turn_in_is_before_the_apex', () => {
    for (const corner of yangwangCorners()) {
      expect(corner.turnInSM).toBeLessThan(corner.apexSM);
      expect(corner.turnInSM).toBeGreaterThanOrEqual(corner.zoneStartSM);
    }
  });

  it('inside_sign_matches_the_matcher', () => {
    for (const bend of [1, -1] as const) {
      const inside = lateralAtApex(bend, 3);
      expect(outsideM(inside.corner, inside.lateralM)).toBeLessThan(-2.5);
      const outside = lateralAtApex(bend, -3);
      expect(outsideM(outside.corner, outside.lateralM)).toBeGreaterThan(2.5);
    }
    expect(lateralAtApex(1, 3).corner.insideSign).toBe(-lateralAtApex(-1, 3).corner.insideSign);
  });

  it('arc_radius_is_measured', () => {
    const corner = findCorners(arcPath(1), arcEvents, DEFAULT_CONFIG)[0]!;
    expect(Math.abs(corner.radiusM - ARC_RADIUS_M)).toBeLessThanOrEqual(3);
  });

  it('straight_has_no_corner', () => {
    const path = pathFromCorners([
      { x: 0, y: 0, z: 0 },
      { x: 400, y: 0, z: 0 }
    ]);
    expect(findCorners(path, arcEvents, DEFAULT_CONFIG)).toEqual([]);
    expect(cornerAt([], 100)).toBeNull();
  });

  it('corner_at_maps_a_place_to_its_zone', () => {
    const corners = yangwangCorners();
    expect(cornerAt(corners, 340)!.number).toBe(1);
    expect(cornerAt(corners, 700)!.number).toBe(2);
    expect(cornerAt(corners, 1060)!.number).toBe(3);
    expect(cornerAt(corners, 100)!.number).toBe(1);
  });

  it('h3_attempt_is_outside_at_the_first_two_apexes', () => {
    const path = yangwangReference();
    const corners = yangwangCorners();
    const matcher = new Matcher(path, DEFAULT_CONFIG);
    const matches = samplesOf('h3-wide-apex').map(sample => matcher.step(sample));
    const outsideAt = (corner: Corner) => {
      const nearest = matches
        .filter(match => match !== null)
        .reduce((a, b) => (Math.abs(b.sM - corner.apexSM) < Math.abs(a.sM - corner.apexSM) ? b : a));
      return outsideM(corner, nearest.lateralM);
    };
    expect(Math.abs(outsideAt(corners[0]!) - 4.8)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(outsideAt(corners[1]!) - 2.1)).toBeLessThanOrEqual(0.5);
  });
});
