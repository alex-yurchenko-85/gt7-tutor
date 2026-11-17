import type { Sample } from '@gt7/contracts';
import type { CoreConfig } from './config.ts';
import { findCorners, type Corner } from './corners.ts';
import { detectEvents, type EventPoint, type ReferenceCueEvent } from './cue-events.ts';
import { Matcher } from './match.ts';
import { activeTimesMs, isDriven, pointAt, type ReferencePath } from './reference.ts';

export type Series = {
  t: (number | null)[];
  v: (number | null)[];
  th: (number | null)[];
  br: (number | null)[];
  x: (number | null)[];
  z: (number | null)[];
  lat: (number | null)[];
};

export type Review = {
  gridM: number;
  lengthM: number;
  reference: Series;
  attempt: Series;
  referenceEvents: ReferenceCueEvent[];
  attemptEvents: ReferenceCueEvent[];
  corners: Corner[];
};

type TracePoint = { sM: number; t: number; v: number; th: number; br: number; x: number; z: number; lat: number };

const MAX_BRIDGE_M = 10;
const EVENT_STEP_M = 1;

function attemptTrace(samples: Sample[], path: ReferencePath, config: CoreConfig): (TracePoint | null)[] {
  const times = activeTimesMs(samples);
  const driven = samples.map((sample, index) => ({ sample, timeMs: times[index]! })).filter(entry => isDriven(entry.sample));
  const matcher = new Matcher(path, config);
  return driven.map(({ sample, timeMs }) => {
    const match = matcher.step(sample);
    if (!match) return null;
    return {
      sM: match.sM,
      t: timeMs,
      v: sample.speedMps,
      th: sample.throttle,
      br: sample.brake,
      x: sample.position.x,
      z: sample.position.z,
      lat: match.lateralM
    };
  });
}

function mixPoints(a: TracePoint, b: TracePoint, sM: number): TracePoint {
  const u = b.sM > a.sM ? (sM - a.sM) / (b.sM - a.sM) : 0;
  const mix = (from: number, to: number) => from + (to - from) * u;
  return { sM, t: mix(a.t, b.t), v: mix(a.v, b.v), th: mix(a.th, b.th), br: mix(a.br, b.br), x: mix(a.x, b.x), z: mix(a.z, b.z), lat: mix(a.lat, b.lat) };
}

function resample(trace: (TracePoint | null)[], stepM: number, lengthM: number, toleranceM: number): (TracePoint | null)[] {
  const count = Math.floor(lengthM / stepM + 1e-9) + 1;
  const grid: (TracePoint | null)[] = Array.from({ length: count }, () => null);
  const assign = (index: number, point: TracePoint) => {
    if (index >= 0 && index < count && grid[index] === null) grid[index] = point;
  };
  trace.forEach((current, index) => {
    const previous = trace[index - 1];
    if (!current || !previous || current.sM <= previous.sM || current.sM - previous.sM > MAX_BRIDGE_M) return;
    for (let cell = Math.ceil(previous.sM / stepM); cell * stepM <= current.sM; cell++) {
      assign(cell, mixPoints(previous, current, cell * stepM));
    }
  });
  const matched = trace.filter((point): point is TracePoint => point !== null);
  const first = matched.reduce<TracePoint | null>((best, point) => (!best || point.sM < best.sM ? point : best), null);
  const last = matched.reduce<TracePoint | null>((best, point) => (!best || point.sM > best.sM ? point : best), null);
  for (let cell = 0; cell < count; cell++) {
    const sM = cell * stepM;
    if (first && sM < first.sM && first.sM - sM <= toleranceM) assign(cell, { ...first, sM });
    if (last && sM > last.sM && sM - last.sM <= toleranceM) assign(cell, { ...last, sM });
  }
  return grid;
}

function toSeries(points: (TracePoint | null)[]): Series {
  const channel = (pick: (point: TracePoint) => number) => points.map(point => (point ? pick(point) : null));
  return {
    t: channel(point => point.t),
    v: channel(point => point.v),
    th: channel(point => point.th),
    br: channel(point => point.br),
    x: channel(point => point.x),
    z: channel(point => point.z),
    lat: channel(point => point.lat)
  };
}

function referenceSeries(path: ReferencePath, stepM: number): Series {
  const count = Math.floor(path.lengthM / stepM + 1e-9) + 1;
  const points = Array.from({ length: count }, (_, cell) => {
    const point = pointAt(path, cell * stepM);
    return { sM: point.sM, t: point.timeMs, v: point.speedMps, th: point.throttle, br: point.brake, x: point.position.x, z: point.position.z, lat: 0 };
  });
  return toSeries(points);
}

function contiguousRuns(points: (TracePoint | null)[]): EventPoint[][] {
  const runs: EventPoint[][] = [];
  let current: EventPoint[] = [];
  for (const point of points) {
    if (point) {
      current.push({ sM: point.sM, speedMps: point.v, throttle: point.th, brake: point.br, timeMs: point.t });
      continue;
    }
    if (current.length > 0) runs.push(current);
    current = [];
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

export function buildReview(attempt: Sample[], path: ReferencePath, config: CoreConfig): Review {
  const trace = attemptTrace(attempt, path, config);
  const tolerance = config.match.sectionEndToleranceM;
  const grid = resample(trace, config.reviewGridM, path.lengthM, tolerance);
  const detail = resample(trace, EVENT_STEP_M, path.lengthM, tolerance);
  const referenceEvents = detectEvents(path.points, path.lengthM, config);
  return {
    gridM: config.reviewGridM,
    lengthM: path.lengthM,
    reference: referenceSeries(path, config.reviewGridM),
    attempt: toSeries(grid),
    referenceEvents,
    attemptEvents: contiguousRuns(detail).flatMap(run => detectEvents(run, path.lengthM, config)),
    corners: findCorners(path, referenceEvents, config)
  };
}
