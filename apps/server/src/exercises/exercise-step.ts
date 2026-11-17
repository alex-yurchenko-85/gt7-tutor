import type { ExerciseStep } from '@gt7/contracts';

export const BASELINE_ATTEMPTS = 3;
export const GUIDED_ATTEMPTS_BEFORE_REVIEW = 3;

export type StepInput = { hasActiveReference: boolean; baselineAttempts: number; guidedAttempts: number };

export function exerciseStep(input: StepInput): ExerciseStep {
  if (!input.hasActiveReference) return 1;
  if (input.guidedAttempts === 0 && input.baselineAttempts < BASELINE_ATTEMPTS) return 2;
  if (input.guidedAttempts < GUIDED_ATTEMPTS_BEFORE_REVIEW) return 3;
  return 4;
}
