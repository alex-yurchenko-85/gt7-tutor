import { describe, expect, it } from 'vitest';
import { activeTimesMs, buildReference, pointAt, ReferencePathError } from '../src/reference.ts';
import { interlagosReference } from './paths.ts';
import { drive, straightLine, syntheticSample } from './synthetic.ts';

function codeOf(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error) {
    return error instanceof ReferencePathError ? error.code : 'other';
  }
}

describe('buildReference', () => {
  it('reference_length_matches_capture', () => {
    const path = interlagosReference();
    expect(Math.abs(path.lengthM - 818.17)).toBeLessThan(0.5);
    expect(path.points[0]!.sM).toBe(0);
    expect(path.points.at(-1)!.sM).toBeCloseTo(path.lengthM, 6);
    const steps = path.points.slice(1).map((point, index) => point.sM - path.points[index]!.sM);
    expect(steps.slice(0, -1).every(step => Math.abs(step - 1) < 1e-9)).toBe(true);
    expect(steps.at(-1)!).toBeGreaterThan(0);
    expect(steps.at(-1)!).toBeLessThanOrEqual(1);
    expect(path.startKind).toBe('flying');
  });

  it('reference_profiles_follow_the_capture', () => {
    const path = interlagosReference();
    const first = path.points[0]!;
    expect(first.speedMps * 3.6).toBeCloseTo(213.09, 0);
    expect(first.timeMs).toBe(0);
    const last = path.points.at(-1)!;
    expect(Math.abs(last.timeMs - 16082)).toBeLessThan(40);
    expect(path.points.every(point => point.throttle >= 0 && point.throttle <= 1 && point.brake >= 0 && point.brake <= 1)).toBe(true);
    expect(path.points.every(point => Math.abs(Math.hypot(point.tangent.x, point.tangent.y, point.tangent.z) - 1) < 1e-9)).toBe(true);
  });

  it('reference_points_carry_the_demonstration_timer', () => {
    const path = interlagosReference();
    expect(path.points[0]!.timerMs).toBe(0);
    expect(path.points.at(-1)!.timerMs).toBe(16082);
    const timers = path.points.map(point => point.timerMs);
    expect(timers.slice(1).every((timer, index) => timer >= timers[index]!)).toBe(true);
  });

  it('point_at_interpolates_the_timer', () => {
    const line = drive(straightLine({ fromX: 0, toX: 30, speedMps: 10 })).map((sample, index) => ({ ...sample, gameTimerMs: index * 20 }));
    const path = buildReference(line, 'flying');
    const before = pointAt(path, 10);
    const after = pointAt(path, 11);
    expect(pointAt(path, 10.5).timerMs).toBeCloseTo((before.timerMs + after.timerMs) / 2, 6);
    expect(after.timerMs).toBeGreaterThan(before.timerMs);
  });

  it('point_at_interpolates_between_points', () => {
    const path = buildReference(drive(straightLine({ fromX: 0, toX: 30, speedMps: 10 })), 'flying');
    const middle = pointAt(path, 10.5);
    expect(middle.sM).toBe(10.5);
    expect(middle.position.x).toBeCloseTo(10.5, 6);
    expect(pointAt(path, -3).sM).toBe(0);
    expect(pointAt(path, 1000).sM).toBeCloseTo(path.lengthM, 9);
  });

  it('reference_rejects_bad_input', () => {
    const stillCar = drive(Array.from({ length: 10 }, () => ({ position: { x: 1, y: 2, z: 3 }, speedMps: 0 })));
    expect(codeOf(() => buildReference(stillCar, 'standing'))).toBe('too-few-points');
    expect(codeOf(() => buildReference([syntheticSample()], 'flying'))).toBe('too-few-points');

    const line = drive(straightLine({ fromX: 0, toX: 30, speedMps: 10 }));
    const broken = line.map((sample, index) => (index === 20 ? { ...sample, speedMps: Number.NaN } : sample));
    expect(codeOf(() => buildReference(broken, 'flying'))).toBe('nonfinite-field');

    const jumped = line.map((sample, index) =>
      index >= 20 ? { ...sample, position: { ...sample.position, x: sample.position.x + 100 } } : sample
    );
    expect(codeOf(() => buildReference(jumped, 'flying'))).toBe('discontinuity');

    const otherCar = line.map((sample, index) => (index >= 20 ? { ...sample, carId: 1 } : sample));
    expect(codeOf(() => buildReference(otherCar, 'flying'))).toBe('car-changed');
  });

  it('paused_and_repeated_start_frames_add_no_time', () => {
    const line = drive(straightLine({ fromX: 0, toX: 30, speedMps: 10 }));
    const plain = buildReference(line, 'flying');
    const held = Array.from({ length: 20 }, () => ({ ...line[0]! }));
    const pausedFrames = Array.from({ length: 30 }, () => ({ ...line[50]!, paused: true }));
    const padded = [...held, ...line.slice(0, 51), ...pausedFrames, ...line.slice(51)].map((sample, index) => ({
      ...sample,
      receivedMonoMs: index * (1000 / 60)
    }));
    const path = buildReference(padded, 'flying');
    expect(path.lengthM).toBeCloseTo(plain.lengthM, 9);
    expect(path.points.at(-1)!.timeMs).toBeCloseTo(plain.points.at(-1)!.timeMs, 6);
  });

  it('active_times_follow_the_packet_clock', () => {
    const line = drive(straightLine({ fromX: 0, toX: 30, speedMps: 10 }));
    const plain = activeTimesMs(line);
    const doubled = activeTimesMs(line.map(sample => ({ ...sample, clockMs: sample.receivedMonoMs * 2 })));
    expect(doubled.at(-1)).toBeCloseTo(2 * plain.at(-1)!, 6);
  });

  it('standing_reference_starts_at_the_stationary_position', () => {
    const still = Array.from({ length: 30 }, () => ({ position: { x: 0, y: 0, z: 0 }, speedMps: 0 }));
    const samples = drive([...still, ...straightLine({ fromX: 0.1, toX: 30, speedMps: 5 })]);
    const path = buildReference(samples, 'standing');
    expect(path.startKind).toBe('standing');
    expect(path.points[0]!.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(path.points[0]!.speedMps).toBe(0);
  });
});
