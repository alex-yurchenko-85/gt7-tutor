import type { Vec3 } from '@gt7/contracts';

export type Gate = { position: Vec3; tangent: Vec3 };

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(a: Vec3, factor: number): Vec3 {
  return { x: a.x * factor, y: a.y * factor, z: a.z * factor };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

export function lerp(a: Vec3, b: Vec3, u: number): Vec3 {
  return add(a, scale(sub(b, a), u));
}

export function normalize(a: Vec3): Vec3 {
  const size = length(a);
  if (size === 0) throw new RangeError('cannot normalize a zero vector');
  return scale(a, 1 / size);
}

export function isFiniteVec(a: Vec3): boolean {
  return Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
}

export type GateOffset = { along: number; lateral: number; height: number };

export function gateOffset(gate: Gate, point: Vec3): GateOffset {
  const offset = sub(point, gate.position);
  const along = dot(offset, gate.tangent);
  const across = sub(offset, scale(gate.tangent, along));
  return { along, lateral: Math.hypot(across.x, across.z), height: Math.abs(across.y) };
}

export function gateAt(points: Vec3[], index: number, direction: 'forward' | 'backward', minSpanM = 1): Gate {
  const position = points[index];
  if (!position) throw new RangeError(`no point at index ${index}`);
  const step = direction === 'forward' ? 1 : -1;
  for (let other = index + step; other >= 0 && other < points.length; other += step) {
    const candidate = points[other]!;
    if (distance(candidate, position) < minSpanM) continue;
    const travel = direction === 'forward' ? sub(candidate, position) : sub(position, candidate);
    return { position, tangent: normalize(travel) };
  }
  throw new RangeError(`no point ${minSpanM} m away from index ${index}`);
}
