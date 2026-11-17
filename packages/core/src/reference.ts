import type { Sample, Vec3 } from '@gt7/contracts';
import { positionBreak, type PositionBreak, type StartKind } from './attempts.ts';
import { DEFAULT_CONFIG, type CoreConfig } from './config.ts';
import { distance, isFiniteVec, lerp, normalize, sub, type Gate } from './geometry.ts';

export type ReferencePoint = {
  sM: number;
  position: Vec3;
  tangent: Vec3;
  speedMps: number;
  throttle: number;
  brake: number;
  timeMs: number;
};

export type ReferencePath = {
  points: ReferencePoint[];
  lengthM: number;
  startKind: StartKind;
  start: Gate;
  end: Gate;
};

export type ReferencePathErrorCode = 'too-few-points' | 'nonfinite-field' | 'discontinuity' | 'car-changed';

export class ReferencePathError extends Error {
  readonly code: ReferencePathErrorCode;

  constructor(code: ReferencePathErrorCode, message: string) {
    super(message);
    this.name = 'ReferencePathError';
    this.code = code;
  }
}

type TimedSample = { sample: Sample; activeMs: number };

const POINT_SPACING_M = 1;

export function isDriven(sample: Sample): boolean {
  return !sample.paused && !sample.loading;
}

function assertFinite(sample: Sample): void {
  const scalars = [sample.receivedMonoMs, sample.speedMps, sample.throttle, sample.brake];
  if (scalars.every(Number.isFinite) && isFiniteVec(sample.position)) return;
  throw new ReferencePathError('nonfinite-field', `raw index ${sample.rawIndex} has a nonfinite field`);
}

const BREAK_MESSAGES: Record<PositionBreak, string> = {
  'car-changed': 'car changes',
  discontinuity: 'position jumps'
};

function assertContinuous(samples: Sample[], config: CoreConfig): void {
  samples.forEach((current, index) => {
    const previous = samples[index - 1];
    const broken = previous ? positionBreak(previous, current, config) : null;
    if (broken) throw new ReferencePathError(broken, `${BREAK_MESSAGES[broken]} at raw index ${current.rawIndex}`);
  });
}

export function activeTimesMs(samples: Sample[]): number[] {
  let activeMs = 0;
  return samples.map((sample, index) => {
    const previous = samples[index - 1];
    if (previous && isDriven(previous)) activeMs += sample.receivedMonoMs - previous.receivedMonoMs;
    return activeMs;
  });
}

function withActiveTime(samples: Sample[]): TimedSample[] {
  const times = activeTimesMs(samples);
  return samples.map((sample, index) => ({ sample, activeMs: times[index]! }));
}

function samePosition(a: TimedSample | undefined, b: TimedSample | undefined): boolean {
  return a !== undefined && b !== undefined && distance(a.sample.position, b.sample.position) === 0;
}

function trimHeldEnds(samples: TimedSample[]): TimedSample[] {
  let first = 0;
  while (first < samples.length - 1 && samePosition(samples[first], samples[first + 1])) first += 1;
  let last = samples.length - 1;
  while (last > first && samePosition(samples[last], samples[last - 1])) last -= 1;
  return samples.slice(first, last + 1);
}

function cumulativeDistance(samples: TimedSample[]): number[] {
  const along = [0];
  for (let index = 1; index < samples.length; index++) {
    along.push(along[index - 1]! + distance(samples[index - 1]!.sample.position, samples[index]!.sample.position));
  }
  return along;
}

function mix(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

function resample(samples: TimedSample[], along: number[], lengthM: number): Omit<ReferencePoint, 'tangent'>[] {
  const targets: number[] = [];
  for (let sM = 0; sM <= lengthM; sM += POINT_SPACING_M) targets.push(sM);
  if (lengthM - targets.at(-1)! > 1e-9) targets.push(lengthM);
  const startMs = samples[0]!.activeMs;
  let segment = 0;
  return targets.map(sM => {
    while (segment < along.length - 2 && along[segment + 1]! < sM) segment += 1;
    while (segment < along.length - 2 && along[segment + 1] === along[segment]) segment += 1;
    const from = samples[segment]!;
    const to = samples[segment + 1]!;
    const span = along[segment + 1]! - along[segment]!;
    const u = span > 0 ? Math.min(1, Math.max(0, (sM - along[segment]!) / span)) : 0;
    return {
      sM,
      position: lerp(from.sample.position, to.sample.position, u),
      speedMps: mix(from.sample.speedMps, to.sample.speedMps, u),
      throttle: mix(from.sample.throttle, to.sample.throttle, u),
      brake: mix(from.sample.brake, to.sample.brake, u),
      timeMs: mix(from.activeMs, to.activeMs, u) - startMs
    };
  });
}

function withTangents(points: Omit<ReferencePoint, 'tangent'>[]): ReferencePoint[] {
  return points.map((point, index) => {
    const before = points[index - 1] ?? point;
    const after = points[index + 1] ?? point;
    return { ...point, tangent: normalize(sub(after.position, before.position)) };
  });
}

export function buildReference(samples: Sample[], startKind: StartKind, config: CoreConfig = DEFAULT_CONFIG): ReferencePath {
  samples.forEach(assertFinite);
  assertContinuous(samples, config);
  const moving = trimHeldEnds(withActiveTime(samples).filter(timed => isDriven(timed.sample)));
  const along = cumulativeDistance(moving);
  const lengthM = along.at(-1) ?? 0;
  if (moving.length < 2 || lengthM <= 0) {
    throw new ReferencePathError('too-few-points', 'a reference needs at least two different positions');
  }
  const points = withTangents(resample(moving, along, lengthM));
  const first = points[0]!;
  const last = points.at(-1)!;
  return {
    points,
    lengthM,
    startKind,
    start: { position: first.position, tangent: first.tangent },
    end: { position: last.position, tangent: last.tangent }
  };
}

export function pointAt(path: ReferencePath, sM: number): ReferencePoint {
  const clamped = Math.min(path.lengthM, Math.max(0, sM));
  const index = Math.min(Math.floor(clamped / POINT_SPACING_M), path.points.length - 2);
  const from = path.points[index]!;
  const to = path.points[index + 1]!;
  const u = (clamped - from.sM) / (to.sM - from.sM);
  return {
    sM: clamped,
    position: lerp(from.position, to.position, u),
    tangent: normalize(lerp(from.tangent, to.tangent, u)),
    speedMps: mix(from.speedMps, to.speedMps, u),
    throttle: mix(from.throttle, to.throttle, u),
    brake: mix(from.brake, to.brake, u),
    timeMs: mix(from.timeMs, to.timeMs, u)
  };
}
