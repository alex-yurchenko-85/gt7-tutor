import { describe, expect, it } from 'vitest';
import type { Match } from '../src/match.ts';
import { Matcher } from '../src/match.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { between, samplesOf } from './fixtures.ts';
import { hairpinCorners, pathFromCorners, shift, interlagosReference } from './paths.ts';
import { drive, straightLine } from './synthetic.ts';

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe('Matcher', () => {
  const cleanRun = samplesOf('ce-clean');

  it('clean_run_matches_end_to_end', () => {
    const matcher = new Matcher(interlagosReference(), DEFAULT_CONFIG);
    const matches = new Map<number, Match | null>();
    for (const sample of cleanRun) matches.set(sample.rawIndex, matcher.step(sample));
    const samples = between(cleanRun, 8452, 9476);
    const section = samples.map(sample => matches.get(sample.rawIndex) ?? null);
    expect(section.every(match => match !== null)).toBe(true);
    expect(section.every(match => match!.trusted)).toBe(true);
    expect(Math.max(...section.map(match => Math.abs(match!.lateralM)))).toBeGreaterThan(2.5);
    const progress = section.map(match => match!.sM);
    expect(progress.slice(1).every((sM, index) => sM - progress[index]! >= -5)).toBe(true);
    expect(median(section.map(match => Math.abs(match!.lateralM)))).toBeLessThan(1);
    expect(progress.at(-1)!).toBeGreaterThan(interlagosReference().lengthM - 3);
  });

  it('attempt_from_the_timer_start_matches_from_the_path_start', () => {
    const matcher = new Matcher(interlagosReference(), DEFAULT_CONFIG);
    const matches = between(cleanRun, 8451, 9476).map(sample => matcher.step(sample));
    expect(matches.every(match => match !== null)).toBe(true);
    expect(matches[0]!.sM).toBeLessThan(1);
  });

  it('no_match_outside_section', () => {
    const matcher = new Matcher(interlagosReference(), DEFAULT_CONFIG);
    const before = between(cleanRun, 8070, 8449).map(sample => matcher.step(sample));
    expect(before.every(match => match === null)).toBe(true);
  });

  it('no_branch_jump_on_parallel_straights', () => {
    const path = pathFromCorners(hairpinCorners(6));
    const matcher = new Matcher(path, DEFAULT_CONFIG);
    const car = drive(straightLine({ fromX: 0.5, toX: 99.5, speedMps: 20, z: 3.4 }));
    const matches = car.map(sample => matcher.step(sample));
    expect(matches.every(match => match !== null && match.trusted)).toBe(true);
    expect(matches.every(match => match!.sM <= 100.5)).toBe(true);
    expect(matches.every(match => Math.abs(match!.lateralM - 3.4) < 0.05)).toBe(true);
  });

  it('bridge_uses_height', () => {
    const path = pathFromCorners([{ x: 0, y: 0, z: 0 }, { x: 200, y: 0, z: 0 }]);
    const unlocked = new Matcher(path, DEFAULT_CONFIG);
    const overpass = shift(drive(straightLine({ fromX: 0.5, toX: 40, speedMps: 20 })), { y: 8 });
    expect(overpass.map(sample => unlocked.step(sample)).every(match => match === null)).toBe(true);

    const locked = new Matcher(path, DEFAULT_CONFIG);
    const road = drive(straightLine({ fromX: 0.5, toX: 40, speedMps: 20 }));
    expect(road.map(sample => locked.step(sample)).every(match => match?.trusted)).toBe(true);
    const above = shift(drive(straightLine({ fromX: 40.3, toX: 80, speedMps: 20 })), { y: 8 }).map((sample, index) => ({
      ...sample,
      receivedMonoMs: road.at(-1)!.receivedMonoMs + (index + 1) * (1000 / 60)
    }));
    expect(above.map(sample => locked.step(sample)).every(match => match === null)).toBe(true);
  });

  it('reverse_travel_is_untrusted', () => {
    const path = pathFromCorners([{ x: 0, y: 0, z: 0 }, { x: 200, y: 0, z: 0 }]);
    const matcher = new Matcher(path, DEFAULT_CONFIG);
    const forward = drive(straightLine({ fromX: 0.5, toX: 30, speedMps: 10 }));
    forward.forEach(sample => matcher.step(sample));
    const backward = drive(straightLine({ fromX: 30, toX: 10, speedMps: 10 })).map(sample => ({
      ...sample,
      velocity: { x: -10, y: 0, z: 0 },
      receivedMonoMs: forward.at(-1)!.receivedMonoMs + sample.receivedMonoMs + 1000 / 60
    }));
    const matches = backward.slice(1).map(sample => matcher.step(sample));
    expect(matches.every(match => match !== null && !match.trusted)).toBe(true);
    expect(matches.every(match => match!.headingErrorDeg > 170)).toBe(true);
    expect(matches.every(match => match!.velocityErrorDeg! > 170)).toBe(true);
  });

  it('lateral_sign_is_consistent_in_both_directions', () => {
    const rightOf = (tangent: { x: number; z: number }) => ({ x: -tangent.z, z: tangent.x });
    for (const direction of [1, -1]) {
      const path = pathFromCorners([{ x: 0, y: 0, z: 0 }, { x: 100 * direction, y: 0, z: 0 }]);
      const right = rightOf({ x: direction, z: 0 });
      const matcher = new Matcher(path, DEFAULT_CONFIG);
      const car = shift(
        drive(straightLine({ fromX: 0.5 * direction, toX: 50 * direction, speedMps: 10 })),
        { x: right.x * 2, z: right.z * 2 }
      );
      const matches = car.map(sample => matcher.step(sample));
      expect(matches.every(match => match !== null && Math.abs(match.lateralM - 2) < 1e-6)).toBe(true);
    }
  });

  it('match_reports_reference_point_and_errors', () => {
    const path = pathFromCorners([{ x: 0, y: 0, z: 0 }, { x: 200, y: 0, z: 0 }]);
    const matcher = new Matcher(path, DEFAULT_CONFIG);
    const car = drive(straightLine({ fromX: 0.5, toX: 20, speedMps: 10 })).map(sample => ({
      ...sample,
      velocity: { x: 10, y: 0, z: 0 },
      position: { ...sample.position, y: 1 }
    }));
    const match = car.map(sample => matcher.step(sample)).at(-1)!;
    expect(match.trusted).toBe(true);
    expect(match.heightM).toBeCloseTo(1, 6);
    expect(match.headingErrorDeg).toBeCloseTo(0, 6);
    expect(match.velocityErrorDeg).toBeCloseTo(0, 6);
    expect(match.reference.sM).toBeCloseTo(match.sM, 9);
    expect(match.reference.position.x).toBeCloseTo(match.sM, 6);
  });

  it('slow_car_has_no_velocity_error', () => {
    const path = pathFromCorners([{ x: 0, y: 0, z: 0 }, { x: 200, y: 0, z: 0 }]);
    const matcher = new Matcher(path, DEFAULT_CONFIG);
    const car = drive(straightLine({ fromX: 0.5, toX: 2, speedMps: 1 }));
    const match = car.map(sample => matcher.step(sample)).at(-1)!;
    expect(match.trusted).toBe(true);
    expect(match.velocityErrorDeg).toBeNull();
  });

  it('car_without_planar_velocity_has_no_velocity_error', () => {
    const path = pathFromCorners([{ x: 0, y: 0, z: 0 }, { x: 200, y: 0, z: 0 }]);
    const matcher = new Matcher(path, DEFAULT_CONFIG);
    const car = drive(straightLine({ fromX: 0.5, toX: 20, speedMps: 10 }));
    const last = car.at(-1)!;
    car.slice(0, -1).forEach(sample => matcher.step(sample));
    const match = matcher.step({ ...last, velocity: { x: 0, y: 10, z: 0 } })!;
    expect(match.trusted).toBe(true);
    expect(match.velocityErrorDeg).toBeNull();
  });

  it('lateral_within_8_m_is_trusted_and_beyond_is_null', () => {
    const path = pathFromCorners([{ x: 0, y: 0, z: 0 }, { x: 200, y: 0, z: 0 }]);
    const wide = new Matcher(path, DEFAULT_CONFIG);
    const atSeven = wide.step(shift(drive(straightLine({ fromX: 1, toX: 2, speedMps: 10 })), { z: 7 })[0]!);
    expect(atSeven?.trusted).toBe(true);
    expect(atSeven?.lateralM).toBeCloseTo(7, 6);
    const far = new Matcher(path, DEFAULT_CONFIG);
    expect(far.step(shift(drive(straightLine({ fromX: 1, toX: 2, speedMps: 10 })), { z: 8.5 })[0]!)).toBeNull();
  });

  it('reset_forgets_progress', () => {
    const path = pathFromCorners([{ x: 0, y: 0, z: 0 }, { x: 200, y: 0, z: 0 }]);
    const matcher = new Matcher(path, DEFAULT_CONFIG);
    drive(straightLine({ fromX: 0.5, toX: 100, speedMps: 20 })).forEach(sample => matcher.step(sample));
    matcher.reset();
    const far = drive(straightLine({ fromX: 120, toX: 121, speedMps: 20 }));
    expect(far.map(sample => matcher.step(sample)).every(match => match === null)).toBe(true);
  });
});
