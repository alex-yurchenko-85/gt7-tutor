import type { CoreConfig } from './config.ts';
import type { ReferenceCueEvent } from './cue-events.ts';
import { pointAt, type ReferencePath } from './reference.ts';
import { StepCursor } from './step-cursor.ts';

export type Corner = {
  number: number;
  zoneStartSM: number;
  turnInSM: number;
  apexSM: number;
  radiusM: number;
  apexSpeedMps: number;
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
      apexSpeedMps: pointAt(path, apex.sM).speedMps,
      insideSign: apex.sign
    });
  }
  return joinCorners(corners.sort((a, b) => a.apexSM - b.apexSM)).map((corner, index) => ({ number: index + 1, ...corner }));
}

export function joinCorners(ordered: Omit<Corner, 'number'>[]): Omit<Corner, 'number'>[] {
  const joined: Omit<Corner, 'number'>[] = [];
  let lastApexSM = -Infinity;
  for (const corner of ordered) {
    const last = joined.at(-1);
    if (!last || corner.turnInSM > lastApexSM) {
      joined.push(corner);
      lastApexSM = corner.apexSM;
      continue;
    }
    const sharper = corner.radiusM < last.radiusM ? corner : last;
    joined[joined.length - 1] = { ...sharper, zoneStartSM: Math.min(last.zoneStartSM, corner.zoneStartSM), turnInSM: Math.min(last.turnInSM, corner.turnInSM) };
    lastApexSM = Math.max(lastApexSM, corner.apexSM);
  }
  return joined;
}

export function cornerAt(corners: Corner[], sM: number): Corner | null {
  return corners.filter(corner => corner.zoneStartSM <= sM).at(-1) ?? corners[0] ?? null;
}

export function cornerCursor(corners: Corner[]): StepCursor<Corner | null> {
  const starts = [...new Set(corners.map(corner => corner.zoneStartSM))].sort((a, b) => a - b);
  return new StepCursor(corners[0] ?? null, starts.map(fromM => ({ fromM, value: cornerAt(corners, fromM) })));
}

export function outsideM(corner: Corner, lateralM: number): number {
  return -corner.insideSign * lateralM;
}
