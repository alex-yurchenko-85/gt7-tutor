import type { ExerciseStatusName } from '@gt7/contracts';

export type StatusInput = {
  hasActiveReference: boolean;
  bestMs: number | null;
  targetMs: number | null;
};

export function targetGap(bestMs: number | null, targetMs: number | null): number | null {
  if (bestMs === null || targetMs === null || bestMs <= targetMs) return null;
  return bestMs - targetMs;
}

export function exerciseStatus(input: StatusInput): ExerciseStatusName {
  if (input.bestMs !== null && input.targetMs !== null && input.bestMs <= input.targetMs) return 'target-reached';
  return input.hasActiveReference ? 'practising' : 'new';
}
