import { describe, expect, it } from 'vitest';
import { medalGap, nextStepText, orderedFamilies, primaryAction } from '../src/features/exercises/next-step.ts';
import { exercise, exerciseAtStep } from './fixtures.ts';

const TARGETS = { bronzeMs: 26000, silverMs: 25500, goldMs: 25000 };

describe('next step', () => {
  it('medal_gap_to_next_medal', () => {
    expect(medalGap(exercise({ bestMs: 27100, targets: TARGETS }))).toEqual({ medal: 'bronze', targetMs: 26000, gapMs: 1100 });
  });

  it('medal_gap_uses_the_game_time', () => {
    expect(medalGap(exercise({ bestMs: 26300, targets: TARGETS }))).toEqual({ medal: 'bronze', targetMs: 26000, gapMs: 300 });
  });

  it('medal_gap_after_bronze_targets_silver', () => {
    expect(medalGap(exercise({ bestMs: 25800, targets: TARGETS, status: 'bronze' }))).toEqual({ medal: 'silver', targetMs: 25500, gapMs: 300 });
    expect(medalGap(exercise({ bestMs: 25500, targets: TARGETS, status: 'silver' }))).toEqual({ medal: 'gold', targetMs: 25000, gapMs: 500 });
  });

  it('medal_gap_null_with_gold', () => {
    expect(medalGap(exercise({ bestMs: 24900, targets: TARGETS, status: 'gold' }))).toBeNull();
    expect(medalGap(exercise({ bestMs: 26500, targets: TARGETS, status: 'gold' }))).toBeNull();
  });

  it('medal_gap_null_without_best_or_targets', () => {
    expect(medalGap(exercise({ bestMs: null, targets: TARGETS }))).toBeNull();
    expect(medalGap(exercise({ bestMs: 27100, targets: {} }))).toBeNull();
    expect(medalGap(exercise({ bestMs: 25800, targets: { goldMs: 25000 } }))).toEqual({ medal: 'gold', targetMs: 25000, gapMs: 800 });
  });

  it('next_step_text_by_step', () => {
    expect(nextStepText(exerciseAtStep(1))).toBe('record the reference');
    expect(nextStepText(exerciseAtStep(2))).toBe('baseline attempts');
    expect(nextStepText(exerciseAtStep(3))).toBe('guided attempt');
    expect(nextStepText(exerciseAtStep(4))).toBe('review');
    expect(nextStepText(exercise({ step: 4, status: 'gold' }))).toBe('none, done');
  });

  it('primary_action_by_step', () => {
    expect(primaryAction(exerciseAtStep(1))).toEqual({ label: 'Record the reference', to: '/exercises/e0000000-0000-4000-8000-000000000001/record' });
    expect(primaryAction(exerciseAtStep(2))).toEqual({ label: 'Start a baseline attempt', to: '/drive?mode=baseline' });
    expect(primaryAction(exerciseAtStep(3))).toEqual({ label: 'Start a guided attempt', to: '/drive?mode=guided' });
    expect(primaryAction(exerciseAtStep(4))).toEqual({ label: 'Open the attempts', to: '/exercises/e0000000-0000-4000-8000-000000000001/attempts' });
  });

  it('families_follow_the_game_order', () => {
    expect(orderedFamilies(['Time Trial', 'Brand Central', 'Licence', 'Brand Central', 'Arcade'])).toEqual([
      'Licence',
      'Circuit Experience',
      'Brand Central',
      'Arcade',
      'Time Trial'
    ]);
  });
});
