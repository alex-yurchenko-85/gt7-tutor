import type { TrackLine } from './TrackMap.tsx';

export const WIDTH = 800;
const PAD = 30;
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
