import { describe, expect, it } from 'vitest';
import { cornerBrake, turnRange, type CornerBrake } from '../src/brake-shape.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import type { Corner } from '../src/corners.ts';
import type { ReferencePath } from '../src/reference.ts';
import { kph } from '../src/units.ts';
import { interlagosAnalysis } from './paths.ts';

const LENGTH_M = 800;

type Profile = (sM: number) => { speedMps: number; brake: number };

function path(profile: Profile): ReferencePath {
  const points = Array.from({ length: LENGTH_M + 1 }, (_, sM) => ({
    sM,
    position: { x: sM, y: 0, z: 0 },
    tangent: { x: 1, y: 0, z: 0 },
    throttle: 0,
    timeMs: sM * 50,
    timerMs: sM * 50,
    ...profile(sM)
  }));
  return { points, lengthM: LENGTH_M };
}

function corner(number: number, zoneStartSM: number, turnInSM: number, apexSM: number): Omit<Corner, keyof CornerBrake> {
  return { number, zoneStartSM, turnInSM, apexSM, radiusM: 40, apexSpeedMps: kph(66), insideSign: 1 };
}

const TSUKUBA_T1 = corner(1, 170, 250, 277);

function tsukubaProfile(sM: number): { speedMps: number; brake: number } {
  const brake = sM < 178 ? 0 : sM < 250 ? 1 : sM <= 268 ? 0.35 : 0;
  const speedKph = sM <= 280 ? 140 - (74 * Math.max(0, sM - 178)) / 102 : 66 + (sM - 280) * 0.5;
  return { speedMps: kph(speedKph), brake };
}

describe('brake shape', () => {
  it('reference_brake_facts_of_the_tsukuba_turn', () => {
    const facts = cornerBrake(path(tsukubaProfile), [TSUKUBA_T1], 0, DEFAULT_CONFIG);
    expect(facts.brakeToSM).toBe(268);
    expect(facts.brakeAtTurnIn).toBeCloseTo(0.35, 5);
    expect(facts.lowSpeedSM).toBe(280);
    expect(facts.lowSpeedMps! * 3.6).toBeCloseTo(66, 5);
  });

  it('turn_without_a_brake_zone_has_no_brake_facts', () => {
    const facts = cornerBrake(path(sM => ({ speedMps: kph(100 - Math.abs(sM - 280) * -0.1), brake: 0 })), [TSUKUBA_T1], 0, DEFAULT_CONFIG);
    expect(facts).toEqual({ brakeToSM: null, brakeAtTurnIn: null, lowSpeedSM: null, lowSpeedMps: null });
  });

  it('a_brake_run_that_starts_after_the_apex_is_not_the_brake_zone_of_the_turn', () => {
    const late = path(sM => ({ speedMps: kph(100), brake: sM >= 290 && sM <= 300 ? 1 : 0 }));
    expect(cornerBrake(late, [TSUKUBA_T1], 0, DEFAULT_CONFIG).brakeToSM).toBeNull();
  });

  it('one_brake_point_is_not_a_brake_zone', () => {
    const touch = path(sM => ({ speedMps: kph(100), brake: sM === 260 ? 0.12 : 0 }));
    expect(cornerBrake(touch, [TSUKUBA_T1], 0, DEFAULT_CONFIG).brakeToSM).toBeNull();
  });

  it('turn_range_starts_before_the_zone_and_ends_before_the_next_zone', () => {
    const corners = [TSUKUBA_T1, corner(2, 330, 360, 380)].map(item => ({ ...item, brakeToSM: null, brakeAtTurnIn: null, lowSpeedSM: null, lowSpeedMps: null }));
    expect(turnRange(corners, 0, LENGTH_M, DEFAULT_CONFIG)).toEqual({ fromSM: 140, toSM: 330 });
    expect(turnRange(corners, 1, LENGTH_M, DEFAULT_CONFIG)).toEqual({ fromSM: 300, toSM: 460 });
    expect(turnRange([{ ...corners[0]!, zoneStartSM: 10 }], 0, LENGTH_M, DEFAULT_CONFIG).fromSM).toBe(0);
  });

  it('interlagos_reference_has_the_brake_facts_of_its_turn', () => {
    const [turn] = interlagosAnalysis().corners;
    expect(turn).toMatchObject({ apexSM: 404, brakeToSM: 377, lowSpeedSM: 410 });
    expect(turn!.brakeAtTurnIn!).toBeCloseTo(0.87, 2);
    expect(turn!.lowSpeedMps!).toBeLessThanOrEqual(turn!.apexSpeedMps);
  });
});
