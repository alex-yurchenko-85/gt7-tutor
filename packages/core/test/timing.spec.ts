import { describe, expect, it } from 'vitest';
import type { ReferencePath } from '../src/reference.ts';
import { gapToReferenceMs, measureAttemptTimes } from '../src/timing.ts';
import { between, samplesOf } from './fixtures.ts';

describe('measureAttemptTimes', () => {
  const ceClean = samplesOf('ce-clean');

  it('measure_attempt_times_gives_the_game_time', () => {
    const times = measureAttemptTimes(samplesOf('ce-pause'));
    expect(times.gameMs).toBe(17412);
    expect(times.measuredMs).not.toBeNull();
    expect(Math.abs(times.measuredMs! - 17412)).toBeLessThanOrEqual(100);
  });

  it('measured_time_of_a_clean_run', () => {
    const times = measureAttemptTimes(ceClean);
    expect(times.gameMs).toBe(17071);
    expect(Math.abs(times.measuredMs! - 17071)).toBeLessThanOrEqual(100);
  });

  it('measured_time_uses_the_packet_clock', () => {
    const plain = measureAttemptTimes(ceClean.map(sample => ({ ...sample, clockMs: sample.receivedMonoMs }))).measuredMs!;
    const doubled = measureAttemptTimes(ceClean.map(sample => ({ ...sample, clockMs: sample.receivedMonoMs * 2 }))).measuredMs;
    const startTimerMs = 16;
    expect(doubled).not.toBeNull();
    expect(Math.abs(doubled! - (2 * plain - startTimerMs))).toBeLessThan(1);
  });

  it('times_null_without_finish', () => {
    expect(measureAttemptTimes(between(ceClean, 8070, 9000))).toEqual({ measuredMs: null, gameMs: null });
    expect(measureAttemptTimes(samplesOf('ce-off-track-reset'))).toEqual({ measuredMs: null, gameMs: null });
  });
});

function constantSpeedPath(lengthM: number, speedMps: number): ReferencePath {
  const points = Array.from({ length: lengthM + 1 }, (_, sM) => ({
    sM,
    position: { x: sM, y: 0, z: 0 },
    tangent: { x: 1, y: 0, z: 0 },
    speedMps,
    throttle: 1,
    brake: 0,
    timeMs: (sM / speedMps) * 1000,
    timerMs: (sM / speedMps) * 1000 + 17
  }));
  return { points, lengthM, startKind: 'flying' };
}

describe('gapToReferenceMs', () => {
  it('gap_to_reference_subtracts_the_reference_timer', () => {
    const path = constantSpeedPath(200, 10);
    expect(gapToReferenceMs(path, 100, 10400)).toBeCloseTo(383, 6);
    expect(gapToReferenceMs(path, 100.5, 9800)).toBeCloseTo(-267, 6);
  });
});
