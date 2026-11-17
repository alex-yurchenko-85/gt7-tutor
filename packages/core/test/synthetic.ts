import type { Sample, Vec3 } from '@gt7/contracts';

export const FRAME_MS = 1000 / 60;

export function syntheticSample(overrides: Partial<Sample> = {}): Sample {
  return {
    rawIndex: 0,
    packetId: 0,
    receivedMonoMs: 0,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    speedMps: 0,
    throttle: 0,
    brake: 0,
    gear: 1,
    lap: 1,
    carId: 3602,
    flags: 9,
    playerSession: true,
    paused: false,
    loading: false,
    ...overrides
  };
}

export type Waypoint = { position: Vec3; speedMps: number; throttle?: number; brake?: number };

export function renumber(samples: Sample[], firstIndex = 0, firstMonoMs = 0): Sample[] {
  return samples.map((sample, index) => ({
    ...sample,
    rawIndex: firstIndex + index,
    packetId: firstIndex + index + 1,
    receivedMonoMs: firstMonoMs + index * FRAME_MS
  }));
}

export function drive(points: Waypoint[], overrides: Partial<Sample> = {}): Sample[] {
  return renumber(
    points.map(point =>
      syntheticSample({
        position: point.position,
        speedMps: point.speedMps,
        throttle: point.throttle ?? 0,
        brake: point.brake ?? 0,
        ...overrides
      })
    )
  );
}

export function straightLine(o: { fromX: number; toX: number; speedMps: number; z?: number; y?: number }): Waypoint[] {
  const step = (o.speedMps * FRAME_MS) / 1000;
  const direction = Math.sign(o.toX - o.fromX);
  const count = Math.floor(Math.abs(o.toX - o.fromX) / step);
  return Array.from({ length: count + 1 }, (_, index) => ({
    position: { x: o.fromX + direction * index * step, y: o.y ?? 0, z: o.z ?? 0 },
    speedMps: o.speedMps
  }));
}
