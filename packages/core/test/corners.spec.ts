import { KPH_PER_MPS, type Vec3 } from '@gt7/contracts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { cornerAt, cornerCursor, findCorners, outsideM, type Corner } from '../src/corners.ts';
import { buildCueEvents } from '../src/cue-events.ts';
import { Matcher } from '../src/match.ts';
import type { ReferencePath } from '../src/reference.ts';
import { event } from './coaching.ts';
import { between, samplesOf } from './fixtures.ts';
import { pathFromCorners, polyline, interlagosReference } from './paths.ts';
import { drive } from './synthetic.ts';
import { kph } from '../src/units.ts';

function interlagosCorners(): Corner[] {
  const path = interlagosReference();
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
  it('interlagos_has_one_corner', () => {
    const corners = interlagosCorners();
    expect(corners.map(corner => corner.number)).toEqual([1]);
    const corner = corners[0]!;
    expect(Math.abs(corner.zoneStartSM - 291)).toBeLessThanOrEqual(5);
    expect(Math.abs(corner.apexSM - 404)).toBeLessThanOrEqual(5);
    expect(Math.abs(corner.radiusM - 70)).toBeLessThanOrEqual(7);
    expect(Math.abs(corner.apexSpeedMps * KPH_PER_MPS - 116)).toBeLessThanOrEqual(3);
    expect(corner.insideSign).toBe(-1);
  });

  it('turn_in_is_before_the_apex', () => {
    for (const corner of interlagosCorners()) {
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
    const zoneCorner = (number: number, zoneStartSM: number): Corner => ({
      number,
      zoneStartSM,
      turnInSM: zoneStartSM + 20,
      apexSM: zoneStartSM + 40,
      radiusM: 60,
      apexSpeedMps: kph(90),
      insideSign: 1
    });
    const corners = [zoneCorner(1, 300), zoneCorner(2, 600), zoneCorner(3, 900)];
    expect([100, 300, 599, 600, 899, 900, 1200].map(sM => cornerAt(corners, sM)!.number)).toEqual([1, 1, 1, 2, 2, 3, 3]);
  });

  it('corner_cursor_gives_the_corner_of_corner_at_forwards_backwards_and_after_jumps', () => {
    const corner = (number: number, zoneStartSM: number): Corner => ({
      number,
      zoneStartSM,
      turnInSM: zoneStartSM + 20,
      apexSM: zoneStartSM + 40,
      radiusM: 60,
      apexSpeedMps: kph(90),
      insideSign: 1
    });
    const sets = [[], [corner(1, 300)], [corner(1, 300), corner(2, 600), corner(3, 900)], [corner(1, 400), corner(2, 250), corner(3, 250), corner(4, 700), corner(5, 650)]];
    const forwards = Array.from({ length: 1201 }, (_, index) => index);
    const places = [...forwards, ...forwards.toReversed(), 650, 0, 1200, 249.5, 250, 700, 399.99, 400, -10, 699.99, 650, 300, 900, 899.99];
    for (const corners of sets) {
      const cursor = cornerCursor(corners);
      for (const sM of places) expect(cursor.at(sM), `${corners.length} corners at ${sM}`).toBe(cornerAt(corners, sM));
    }
  });

  it('clean_run_is_wider_at_the_apex_than_the_slow_run', () => {
    const path = interlagosReference();
    const corner = interlagosCorners()[0]!;
    const outsideAtApex = (samples: ReturnType<typeof samplesOf>) => {
      const matcher = new Matcher(path, DEFAULT_CONFIG);
      const matches = samples.map(sample => matcher.step(sample)).filter(match => match !== null);
      const nearest = matches.reduce((a, b) => (Math.abs(b.sM - corner.apexSM) < Math.abs(a.sM - corner.apexSM) ? b : a));
      return outsideM(corner, nearest.lateralM);
    };
    expect(Math.abs(outsideAtApex(between(samplesOf('ce-clean'), 8451, 9479)) - 3.0)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(outsideAtApex(between(samplesOf('ce-slow'), 5491, 6624)) - 1.2)).toBeLessThanOrEqual(0.5);
  });
});
