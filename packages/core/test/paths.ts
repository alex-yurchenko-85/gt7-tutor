import type { Sample, Vec3 } from '@gt7/contracts';
import { buildReference, type ReferencePath } from '../src/reference.ts';
import { between, samplesOf } from './fixtures.ts';
import { drive, FRAME_MS, type Waypoint } from './synthetic.ts';

let yangwang: ReferencePath | null = null;

export function yangwangReference(): ReferencePath {
  yangwang ??= buildReference(between(samplesOf('demo-wait05'), 352, 1897), 'flying');
  return yangwang;
}

export function polyline(corners: Vec3[], speedMps: number, stepM = 0.5): Waypoint[] {
  const points: Waypoint[] = [];
  corners.forEach((corner, index) => {
    const next = corners[index + 1];
    if (!next) {
      points.push({ position: corner, speedMps });
      return;
    }
    const span = Math.hypot(next.x - corner.x, next.y - corner.y, next.z - corner.z);
    const steps = Math.max(1, Math.round(span / stepM));
    for (let step = 0; step < steps; step++) {
      const u = step / steps;
      points.push({
        position: {
          x: corner.x + (next.x - corner.x) * u,
          y: corner.y + (next.y - corner.y) * u,
          z: corner.z + (next.z - corner.z) * u
        },
        speedMps
      });
    }
  });
  return points;
}

export function hairpinCorners(separationM: number): Vec3[] {
  const radius = separationM / 2;
  const arc = Array.from({ length: 13 }, (_, index) => {
    const angle = -Math.PI / 2 + (index / 12) * Math.PI;
    return { x: 100 + radius * Math.cos(angle), y: 0, z: radius + radius * Math.sin(angle) };
  });
  return [{ x: 0, y: 0, z: 0 }, ...arc, { x: 0, y: 0, z: separationM }];
}

export function pathFromCorners(corners: Vec3[], speedMps = 20): ReferencePath {
  return buildReference(drive(polyline(corners, speedMps)), 'flying');
}

export function shift(samples: Sample[], offset: Partial<Vec3>): Sample[] {
  return samples.map(sample => ({
    ...sample,
    position: {
      x: sample.position.x + (offset.x ?? 0),
      y: sample.position.y + (offset.y ?? 0),
      z: sample.position.z + (offset.z ?? 0)
    }
  }));
}

export type ProfilePoint = { speedKph: number; throttle: number; brake: number };

export function profiledSamples(lengthM: number, at: (sM: number) => ProfilePoint): Sample[] {
  let monoMs = 0;
  const samples: Sample[] = [];
  for (let sM = 0; sM <= lengthM; sM++) {
    const point = at(sM);
    if (sM > 0) monoMs += (1000 * 3.6) / Math.max(1, (at(sM - 1).speedKph + point.speedKph) / 2);
    samples.push({
      ...drive([{ position: { x: sM, y: 0, z: 0 }, speedMps: point.speedKph / 3.6 }])[0]!,
      rawIndex: sM,
      packetId: sM + 1,
      receivedMonoMs: monoMs,
      throttle: point.throttle,
      brake: point.brake
    });
  }
  return samples;
}

export function profiledPath(lengthM: number, at: (sM: number) => ProfilePoint): ReferencePath {
  return buildReference(profiledSamples(lengthM, at), 'flying');
}

export type Zone = { fromM: number; toM: number };

export function inZone(sM: number, zones: Zone[]): boolean {
  return zones.some(zone => sM >= zone.fromM && sM < zone.toM);
}

export const BEND_START_M = 100;
export const BEND_LENGTH_M = 120;
export const BEND_MAX_CURVATURE = 1 / 40;
const BEND_TOTAL_M = 400;
const MAX_OFFSET_STEP_M = 0.1;

function bendCurvature(sM: number): number {
  if (sM < BEND_START_M || sM > BEND_START_M + BEND_LENGTH_M) return 0;
  return BEND_MAX_CURVATURE * Math.sin((Math.PI * (sM - BEND_START_M)) / BEND_LENGTH_M);
}

export function bendWaypoints(bend: 1 | -1, speedMps: number, outsideM: (sM: number) => number = () => 0): Waypoint[] {
  const stepM = (speedMps * FRAME_MS) / 1000;
  const points: Waypoint[] = [];
  let x = 0;
  let z = 0;
  let heading = 0;
  let offset = 0;
  for (let sM = 0; sM <= BEND_TOTAL_M; sM += stepM) {
    offset += Math.max(-MAX_OFFSET_STEP_M, Math.min(MAX_OFFSET_STEP_M, outsideM(sM) - offset));
    const inside = { x: -bend * Math.sin(heading), z: bend * Math.cos(heading) };
    points.push({ position: { x: x - inside.x * offset, y: 0, z: z - inside.z * offset }, speedMps });
    heading += bend * bendCurvature(sM) * stepM;
    x += Math.cos(heading) * stepM;
    z += Math.sin(heading) * stepM;
  }
  return points;
}

export function bendPath(bend: 1 | -1, speedMps = 20): ReferencePath {
  return buildReference(drive(bendWaypoints(bend, speedMps)), 'flying');
}
