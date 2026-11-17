import type { CoreConfig } from './config.ts';
import type { ReferenceCueEvent } from './cue-events.ts';
import { pointAt, type ReferencePath } from './reference.ts';
import { KPH_PER_MPS } from './units.ts';

export type Corner = {
  number: number;
  zoneStartSM: number;
  turnInSM: number;
  apexSM: number;
  radiusM: number;
  apexSpeedKph: number;
  insideSign: 1 | -1;
};

type Bend = { sM: number; curvature: number; sign: 1 | -1 };

type Window = { zoneStartSM: number; fromM: number; toM: number };

const SAMPLE_STEP_M = 1;

function signedTurn(path: ReferencePath, sM: number, spanM: number): number {
  const before = pointAt(path, sM - spanM).tangent;
  const after = pointAt(path, sM + spanM).tangent;
  const cross = before.x * after.z - before.z * after.x;
  const cosine = before.x * after.x + before.z * after.z;
  return Math.atan2(cross, cosine);
}

function bends(path: ReferencePath, config: CoreConfig): Bend[] {
  const spanM = config.corners.curvatureSpanM;
  const found: Bend[] = [];
  for (let sM = spanM; sM <= path.lengthM - spanM; sM += SAMPLE_STEP_M) {
    const turn = signedTurn(path, sM, spanM);
    found.push({ sM, curvature: Math.abs(turn) / (2 * spanM), sign: turn >= 0 ? 1 : -1 });
  }
  return found;
}

function apexWindows(events: ReferenceCueEvent[], path: ReferencePath, config: CoreConfig): Window[] {
  const ordered = [...events].sort((a, b) => a.sM - b.sM);
  return ordered
    .filter(event => event.kind === 'brake' || event.kind === 'ease-off')
    .map(opening => {
      const throttle = ordered.find(event => event.kind === 'throttle' && event.sM > opening.sM);
      const toM = throttle ? throttle.sM + config.corners.apexAfterThrottleM : path.lengthM;
      return { zoneStartSM: opening.sM, fromM: opening.sM, toM };
    });
}

function sharpest(curve: Bend[], window: Window): Bend | null {
  const inside = curve.filter(bend => bend.sM >= window.fromM && bend.sM <= window.toM);
  if (inside.length === 0) return null;
  return inside.reduce((best, bend) => (bend.curvature > best.curvature ? bend : best));
}

function turnIn(curve: Bend[], apex: Bend, config: CoreConfig): number {
  const limit = apex.curvature * config.corners.turnInShare;
  const before = curve.filter(bend => bend.sM < apex.sM && bend.curvature < limit);
  return before.at(-1)?.sM ?? curve[0]?.sM ?? apex.sM;
}

export function findCorners(path: ReferencePath, events: ReferenceCueEvent[], config: CoreConfig): Corner[] {
  const curve = bends(path, config);
  const corners: Omit<Corner, 'number'>[] = [];
  for (const window of apexWindows(events, path, config)) {
    const apex = sharpest(curve, window);
    if (!apex || apex.curvature === 0 || 1 / apex.curvature > config.corners.maxRadiusM) continue;
    if (corners.some(corner => corner.apexSM === apex.sM)) continue;
    corners.push({
      zoneStartSM: window.zoneStartSM,
      turnInSM: turnIn(curve, apex, config),
      apexSM: apex.sM,
      radiusM: 1 / apex.curvature,
      apexSpeedKph: pointAt(path, apex.sM).speedMps * KPH_PER_MPS,
      insideSign: apex.sign
    });
  }
  return corners.sort((a, b) => a.apexSM - b.apexSM).map((corner, index) => ({ number: index + 1, ...corner }));
}

export function cornerAt(corners: Corner[], sM: number): Corner | null {
  return corners.filter(corner => corner.zoneStartSM <= sM).at(-1) ?? corners[0] ?? null;
}

export function outsideM(corner: Corner, lateralM: number): number {
  return -corner.insideSign * lateralM;
}
