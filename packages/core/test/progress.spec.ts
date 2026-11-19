import { describe, expect, it } from 'vitest';
import { exerciseStatus, nextMedal } from '../src/progress.ts';

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

describe('nextMedal', () => {
  const all = { bronzeMs: 26_000, silverMs: 25_500, goldMs: 25_000 };

  it('next_medal_is_the_lowest_medal_not_yet_reached', () => {
    expect(nextMedal(27_100, all)).toEqual({ medal: 'bronze', targetMs: 26_000, gapMs: 1_100 });
    expect(nextMedal(25_800, all)).toEqual({ medal: 'silver', targetMs: 25_500, gapMs: 300 });
    expect(nextMedal(25_500, all)).toEqual({ medal: 'gold', targetMs: 25_000, gapMs: 500 });
    expect(nextMedal(25_800, { goldMs: 25_000 })).toEqual({ medal: 'gold', targetMs: 25_000, gapMs: 800 });
    expect(nextMedal(17_071, { bronzeMs: 17_800, silverMs: 16_700, goldMs: 16_400 })).toEqual({ medal: 'silver', targetMs: 16_700, gapMs: 371 });
  });

  it('next_medal_is_null_at_gold_without_best_or_without_targets', () => {
    expect(nextMedal(24_900, all)).toBeNull();
    expect(nextMedal(25_000, all)).toBeNull();
    expect(nextMedal(null, all)).toBeNull();
    expect(nextMedal(27_100, {})).toBeNull();
  });
});
