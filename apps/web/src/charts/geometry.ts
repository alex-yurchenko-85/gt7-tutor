import type { TrackLine } from './TrackMap.tsx';

export const WIDTH = 800;
const PAD = 48;
const MIN_HEIGHT = 220;

export type Point = [number, number];

export function finitePoints(line: TrackLine): Point[] {
  return line.x.flatMap((x, index) => {
    const z = line.z[index];
    return x === null || z === null || z === undefined ? [] : [[x, z] as Point];
  });
}

export function projection(lines: TrackLine[]) {
  const points = lines.flatMap(finitePoints);
  const xs = points.map(point => point[0]);
  const zs = points.map(point => point[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const z0 = Math.min(...zs);
  const z1 = Math.max(...zs);
  const scale = (WIDTH - 2 * PAD) / Math.max(1, x1 - x0, (z1 - z0) * 1.6);
  const height = Math.max(MIN_HEIGHT, Math.round((z1 - z0) * scale) + 2 * PAD);
  const offsetX = (WIDTH - (x1 - x0) * scale) / 2;
  const offsetY = (height - (z1 - z0) * scale) / 2;
  const project = (x: number, z: number): Point => [Number((offsetX + (x - x0) * scale).toFixed(1)), Number((offsetY + (z - z0) * scale).toFixed(1))];
  return { height, project };
}

export function lineSegments(line: TrackLine, project: (x: number, z: number) => Point): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  line.x.forEach((x, index) => {
    const z = line.z[index];
    if (x === null || z === null || z === undefined) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(project(x, z).join(','));
  });
  if (current.length > 1) segments.push(current.join(' '));
  return segments;
}

export function seriesSegments(values: (number | null)[], toX: (index: number) => number, toY: (value: number) => number): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(`${toX(index).toFixed(1)},${toY(value).toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(' '));
  return segments;
}

export const SIDE_FACTOR = 6;

type Values = (number | null)[];

function valueAt(values: Values, index: number): number | null {
  return values[index] ?? null;
}

function pointAt(line: TrackLine, index: number): Point | null {
  const x = valueAt(line.x, index);
  const z = valueAt(line.z, index);
  return x === null || z === null ? null : [x, z];
}

function tangentAt(line: TrackLine, index: number): Point | null {
  const before = pointAt(line, index - 1) ?? pointAt(line, index);
  const after = pointAt(line, index + 1) ?? pointAt(line, index);
  if (!before || !after) return null;
  const tx = after[0] - before[0];
  const tz = after[1] - before[1];
  const length = Math.hypot(tx, tz);
  return length === 0 ? null : [tx / length, tz / length];
}

export function sideScaledLine(reference: TrackLine, lat: Values, factor: number): TrackLine {
  const x: Values = [];
  const z: Values = [];
  reference.x.forEach((_, index) => {
    const here = pointAt(reference, index);
    const side = valueAt(lat, index);
    const tangent = here && side !== null ? tangentAt(reference, index) : null;
    if (!here || side === null || !tangent) {
      x.push(null);
      z.push(null);
      return;
    }
    x.push(here[0] - factor * side * tangent[1]);
    z.push(here[1] + factor * side * tangent[0]);
  });
  return { gridM: reference.gridM, x, z };
}

function beyond(lat: Values, limitM: number, index: number): boolean {
  const side = valueAt(lat, index);
  return side !== null && Math.abs(side) > limitM;
}

export function beyondSide(line: TrackLine, lat: Values, limitM: number): TrackLine {
  const keep = line.x.map((_, index) => beyond(lat, limitM, index));
  line.x.forEach((_, index) => {
    if (!beyond(lat, limitM, index) || beyond(lat, limitM, index - 1) || beyond(lat, limitM, index + 1)) return;
    if (index > 0) keep[index - 1] = true;
    if (index < keep.length - 1) keep[index + 1] = true;
  });
  return {
    gridM: line.gridM,
    x: line.x.map((value, index) => (keep[index] ? value : null)),
    z: line.z.map((value, index) => (keep[index] ? (value ?? null) : null))
  };
}

export type TurnZone = { number: number; zoneFromSM: number; zoneToSM: number };

export type SidePeak = { turn: number; sM: number; lat: number };

export function largestSideInZones(zones: TurnZone[], lat: Values, gridM: number): SidePeak[] {
  return zones.flatMap(zone => {
    let peak: SidePeak | null = null;
    const last = Math.min(lat.length - 1, Math.floor(zone.zoneToSM / gridM));
    for (let index = Math.max(0, Math.ceil(zone.zoneFromSM / gridM)); index <= last; index++) {
      const side = valueAt(lat, index);
      if (side !== null && (!peak || Math.abs(side) > Math.abs(peak.lat))) peak = { turn: zone.number, sM: index * gridM, lat: side };
    }
    return peak ? [peak] : [];
  });
}
