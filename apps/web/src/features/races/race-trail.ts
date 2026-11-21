export type TrailPoint = { x: number; z: number; tMs: number };

export type TrailSegment = { d: string; opacity: number };

export type TrailBounds = { x0: number; x1: number; z0: number; z1: number };

export type TrailFit = { scale: number; tx: number; ty: number };

const TRAIL_STEP_MS = 100;

const SEGMENT_POINTS = 10;
const FLOOR = 0.1;
const GROWING_OLDEST = 0.45;
const BREAK_M = 100;
const LAP_SHARE = 0.9;

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function opacityOf(ageMs: number, fadeMs: number | null, oldestAgeMs: number): number {
  if (fadeMs !== null) return Math.max(FLOOR, 1 - ((1 - FLOOR) * ageMs) / fadeMs);
  if (oldestAgeMs <= 0) return 1;
  return 1 - ((1 - GROWING_OLDEST) * ageMs) / oldestAgeMs;
}

function runs(points: TrailPoint[]): TrailPoint[][] {
  const found: TrailPoint[][] = [];
  let current: TrailPoint[] = [];
  for (const point of points) {
    const last = current.at(-1);
    if (last && Math.hypot(point.x - last.x, point.z - last.z) > BREAK_M) {
      found.push(current);
      current = [];
    }
    current.push(point);
  }
  found.push(current);
  return found.filter(run => run.length > 1);
}

function pathOf(points: TrailPoint[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${rounded(point.x)} ${rounded(point.z)}`).join('');
}

export function trailSegments(points: TrailPoint[], nowMs: number, fadeMs: number | null): TrailSegment[] {
  const kept = fadeMs === null ? points : points.filter(point => nowMs - point.tMs <= fadeMs);
  if (kept.length < 2) return [];
  const oldestAgeMs = nowMs - kept[0]!.tMs;
  const segments: TrailSegment[] = [];
  for (const run of runs(kept)) {
    for (let start = 0; start < run.length - 1; start += SEGMENT_POINTS) {
      const chunk = run.slice(start, start + SEGMENT_POINTS + 1);
      const opacity = opacityOf(nowMs - chunk[0]!.tMs, fadeMs, oldestAgeMs);
      segments.push({ d: pathOf(chunk), opacity: Math.round(opacity * 100) / 100 });
    }
  }
  return segments;
}

export function keepTrailPoint(points: TrailPoint[], point: TrailPoint, fadeMs: number | null): TrailPoint[] | null {
  const last = points.at(-1);
  if (last && last.x === point.x && last.z === point.z) return null;
  if (last && point.tMs - last.tMs < TRAIL_STEP_MS) return null;
  const kept = fadeMs === null ? points : points.filter(old => point.tMs - old.tMs <= fadeMs);
  return [...kept, point];
}

export function trailCoversLap(points: TrailPoint[], fadeMs: number | null): boolean {
  const first = points[0];
  const last = points.at(-1);
  return fadeMs !== null && first !== undefined && last !== undefined && last.tMs - first.tMs >= LAP_SHARE * fadeMs;
}

export function trailBounds(points: TrailPoint[]): TrailBounds | null {
  if (points.length === 0) return null;
  const bounds = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const point of points) {
    bounds.x0 = Math.min(bounds.x0, point.x);
    bounds.x1 = Math.max(bounds.x1, point.x);
    bounds.z0 = Math.min(bounds.z0, point.z);
    bounds.z1 = Math.max(bounds.z1, point.z);
  }
  return bounds;
}

export function withPoint(bounds: TrailBounds, point: TrailPoint): TrailBounds {
  if (point.x >= bounds.x0 && point.x <= bounds.x1 && point.z >= bounds.z0 && point.z <= bounds.z1) return bounds;
  return { x0: Math.min(bounds.x0, point.x), x1: Math.max(bounds.x1, point.x), z0: Math.min(bounds.z0, point.z), z1: Math.max(bounds.z1, point.z) };
}

export function trailFit(bounds: TrailBounds, width: number, height: number, pad: number): TrailFit {
  const spanX = Math.max(1, bounds.x1 - bounds.x0);
  const spanZ = Math.max(1, bounds.z1 - bounds.z0);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanZ);
  return {
    scale,
    tx: (width - (bounds.x1 - bounds.x0) * scale) / 2 - bounds.x0 * scale,
    ty: (height - (bounds.z1 - bounds.z0) * scale) / 2 - bounds.z0 * scale
  };
}
