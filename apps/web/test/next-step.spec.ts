import { describe, expect, it } from 'vitest';
import { nextTitle, orderedFamilies, primaryAction } from '../src/features/exercises/next-step.ts';
import { exerciseAtStep } from './fixtures.ts';

describe('next step', () => {
  it('next_title_by_step', () => {
    expect(nextTitle(1)).toBe('Next: record the reference');
    expect(nextTitle(2)).toBe('Next: drive attempts');
    expect(nextTitle(3)).toBe('Next: review your attempts');
  });

  it('primary_action_by_step', () => {
    expect(primaryAction(exerciseAtStep(1))).toEqual({ label: 'Record the reference', to: '/exercises/e0000000-0000-4000-8000-000000000001/record' });
    expect(primaryAction(exerciseAtStep(2))).toEqual({ label: 'Start an attempt', to: '/drive' });
    expect(primaryAction(exerciseAtStep(3))).toEqual({ label: 'Open the attempts', to: '/exercises/e0000000-0000-4000-8000-000000000001/attempts' });
  });

  it('families_follow_the_game_order', () => {
    expect(orderedFamilies(['Time Trial', 'Brand Central', 'Licence', 'Brand Central', 'Arcade'])).toEqual(['Licence', 'Brand Central', 'Arcade', 'Time Trial']);
  });
});
