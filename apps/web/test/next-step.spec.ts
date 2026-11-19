import { describe, expect, it } from 'vitest';
import { nextStepText, orderedFamilies, primaryAction, STEP_LABELS } from '../src/features/exercises/next-step.ts';
import { exercise, exerciseAtStep } from './fixtures.ts';

describe('next step', () => {
  it('next_step_text_by_step', () => {
    expect(nextStepText(exerciseAtStep(1))).toBe('record the reference');
    expect(nextStepText(exerciseAtStep(2))).toBe('attempt');
    expect(nextStepText(exerciseAtStep(3))).toBe('review');
    expect(nextStepText(exercise({ step: 3, status: 'gold' }))).toBe('none, done');
  });

  it('primary_action_by_step', () => {
    expect(primaryAction(exerciseAtStep(1))).toEqual({ label: 'Record the reference', to: '/exercises/e0000000-0000-4000-8000-000000000001/record' });
    expect(primaryAction(exerciseAtStep(2))).toEqual({ label: 'Start an attempt', to: '/drive' });
    expect(primaryAction(exerciseAtStep(3))).toEqual({ label: 'Open the attempts', to: '/exercises/e0000000-0000-4000-8000-000000000001/attempts' });
  });

  it('step_labels_are_three', () => {
    expect(STEP_LABELS).toEqual([
      { step: 1, label: 'Reference' },
      { step: 2, label: 'Attempts' },
      { step: 3, label: 'Review' }
    ]);
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
