import { describe, expect, it } from 'vitest';
import { pointAt, type ReferencePath } from '../src/reference.ts';
import { gapToReferenceMs } from '../src/timing.ts';

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
  return { points, lengthM };
}

describe('gapToReferenceMs', () => {
  it('gap_to_reference_subtracts_the_reference_timer', () => {
    const path = constantSpeedPath(200, 10);
    expect(gapToReferenceMs({ reference: pointAt(path, 100) }, 10400)).toBeCloseTo(383, 6);
    expect(gapToReferenceMs({ reference: pointAt(path, 100.5) }, 9800)).toBeCloseTo(-267, 6);
  });
});
