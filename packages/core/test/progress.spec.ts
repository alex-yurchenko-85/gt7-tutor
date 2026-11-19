import { describe, expect, it } from 'vitest';
import { exerciseStatus } from '../src/progress.ts';

const targets = { bronzeMs: 30_000, silverMs: 28_000, goldMs: 27_000 };
const base = { hasActiveReference: true, completeAttempts: 3, bestMs: 29_000, targets };

describe('exerciseStatus', () => {
  it('status_rules', () => {
    expect(exerciseStatus({ ...base, hasActiveReference: false, completeAttempts: 0, bestMs: null })).toBe('new');
    expect(exerciseStatus({ ...base, completeAttempts: 0, bestMs: null })).toBe('ready');
    expect(exerciseStatus({ ...base, bestMs: 31_000 })).toBe('practising');
    expect(exerciseStatus({ ...base, targets: {} })).toBe('practising');
    expect(exerciseStatus({ ...base, bestMs: 30_000 })).toBe('bronze');
    expect(exerciseStatus({ ...base, bestMs: 28_000 })).toBe('silver');
    expect(exerciseStatus({ ...base, bestMs: 26_500 })).toBe('gold');
    expect(exerciseStatus({ ...base, bestMs: 27_500, targets: { goldMs: 27_000 } })).toBe('practising');
  });
});
