import { describe, expect, it } from 'vitest';
import { exerciseStatus, targetGap } from '../src/progress.ts';

describe('exerciseStatus', () => {
  it('status_rules', () => {
    expect(exerciseStatus({ hasActiveReference: false, bestMs: null, targetMs: null })).toBe('new');
    expect(exerciseStatus({ hasActiveReference: true, bestMs: 17071, targetMs: 16400 })).toBe('practising');
    expect(exerciseStatus({ hasActiveReference: true, bestMs: 16400, targetMs: 16400 })).toBe('target-reached');
    expect(exerciseStatus({ hasActiveReference: false, bestMs: 16000, targetMs: 16400 })).toBe('target-reached');
    expect(exerciseStatus({ hasActiveReference: true, bestMs: 17071, targetMs: null })).toBe('practising');
    expect(exerciseStatus({ hasActiveReference: true, bestMs: null, targetMs: 16400 })).toBe('practising');
    expect(exerciseStatus({ hasActiveReference: false, bestMs: 17071, targetMs: 16400 })).toBe('new');
  });
});

describe('targetGap', () => {
  it('gap_is_the_best_time_above_the_target', () => {
    expect(targetGap(17071, 16400)).toBe(671);
  });

  it('gap_is_null_at_the_target_without_best_or_without_target', () => {
    expect(targetGap(16400, 16400)).toBeNull();
    expect(targetGap(16000, 16400)).toBeNull();
    expect(targetGap(null, 16400)).toBeNull();
    expect(targetGap(17071, null)).toBeNull();
  });
});
