import { median as medianOrNull } from '@gt7/contracts';

export function median(values: number[]): number {
  return medianOrNull(values) ?? Number.NaN;
}

export function percentile95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? Number.POSITIVE_INFINITY;
}
