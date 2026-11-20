import { describe, expect, it } from 'vitest';
import { ATTEMPTS_BEFORE_REVIEW, exerciseStep } from '../../src/exercises/exercise-step.js';

describe('exerciseStep', () => {
  it.each([
    { hasActiveReference: false, activeReferenceAttempts: 0, step: 1 },
    { hasActiveReference: false, activeReferenceAttempts: 5, step: 1 },
    { hasActiveReference: true, activeReferenceAttempts: 0, step: 2 },
    { hasActiveReference: true, activeReferenceAttempts: 2, step: 2 },
    { hasActiveReference: true, activeReferenceAttempts: 3, step: 3 },
    { hasActiveReference: true, activeReferenceAttempts: 9, step: 3 }
  ])('step_is_$step_with_reference_$hasActiveReference_and_$activeReferenceAttempts_attempts', ({ hasActiveReference, activeReferenceAttempts, step }) => {
    expect(exerciseStep({ hasActiveReference, activeReferenceAttempts })).toBe(step);
  });

  it('review_starts_after_three_attempts', () => {
    expect(ATTEMPTS_BEFORE_REVIEW).toBe(3);
  });
});
