import type { CoreConfig } from './config.ts';
import type { Corner } from './corners.ts';
import { pointAt, type ReferencePath } from './reference.ts';

export type CornerBrake = { brakeToSM: number | null; brakeAtTurnIn: number | null; lowSpeedSM: number | null; lowSpeedMps: number | null };

type TurnRange = { fromSM: number; toSM: number };

type TurnGeometry = Pick<Corner, 'zoneStartSM' | 'turnInSM' | 'apexSM'>;

const NO_BRAKE: CornerBrake = { brakeToSM: null, brakeAtTurnIn: null, lowSpeedSM: null, lowSpeedMps: null };

export function turnRange(corners: TurnGeometry[], index: number, lengthM: number, config: CoreConfig): TurnRange {
  const corner = corners[index]!;
  const previous = corners[index - 1];
  const next = corners[index + 1];
  const fromSM = Math.max(0, corner.zoneStartSM - config.corners.rangeBeforeM, previous ? previous.apexSM : 0);
  const exitSM = corner.apexSM + (corner.apexSM - corner.turnInSM) + config.corners.rangeAfterM;
  return { fromSM, toSM: Math.min(next ? next.zoneStartSM : lengthM, exitSM, lengthM) };
}

function lastBrakeEndM(path: ReferencePath, range: TurnRange, apexSM: number, config: CoreConfig): number | null {
  let end: number | null = null;
  let runStartM: number | null = null;
  let runPoints = 0;
  for (const point of path.points) {
    if (point.sM < range.fromSM || point.sM > range.toSM) continue;
    if (point.brake > config.events.brakeOn) {
      runStartM ??= point.sM;
      runPoints++;
      if (runStartM <= apexSM && runPoints >= config.events.consecutiveSamples) end = point.sM;
    } else {
      runStartM = null;
      runPoints = 0;
    }
  }
  return end;
}

function lowestPoint(path: ReferencePath, range: TurnRange): { sM: number; speedMps: number } | null {
  let lowest: { sM: number; speedMps: number } | null = null;
  for (const point of path.points) {
    if (point.sM < range.fromSM || point.sM > range.toSM) continue;
    if (!lowest || point.speedMps < lowest.speedMps) lowest = { sM: point.sM, speedMps: point.speedMps };
  }
  return lowest;
}

export function cornerBrake(path: ReferencePath, corners: TurnGeometry[], index: number, config: CoreConfig): CornerBrake {
  const corner = corners[index]!;
  const range = turnRange(corners, index, path.lengthM, config);
  const brakeToSM = lastBrakeEndM(path, range, corner.apexSM, config);
  const lowest = lowestPoint(path, range);
  if (brakeToSM === null || lowest === null) return NO_BRAKE;
  return { brakeToSM, brakeAtTurnIn: pointAt(path, corner.turnInSM).brake, lowSpeedSM: lowest.sM, lowSpeedMps: lowest.speedMps };
}
