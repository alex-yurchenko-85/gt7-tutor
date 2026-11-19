import type { ExerciseStep } from '@gt7/contracts';

export const ATTEMPTS_BEFORE_REVIEW = 3;

export type StepInput = { hasActiveReference: boolean; activeReferenceAttempts: number };

export function exerciseStep(input: StepInput): ExerciseStep {
  if (!input.hasActiveReference) return 1;
  if (input.activeReferenceAttempts < ATTEMPTS_BEFORE_REVIEW) return 2;
  return 3;
}
