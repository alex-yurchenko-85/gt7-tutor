import { describe, expect, it } from 'vitest';
import { nextTitle, orderedFamilies } from '../src/features/exercises/next-step.ts';

describe('next step', () => {
  it('next_title_by_step', () => {
    expect(nextTitle(1)).toBe('Next: record the reference');
    expect(nextTitle(2)).toBe('Next: drive attempts');
    expect(nextTitle(3)).toBe('Next: review your attempts');
  });

  it('families_follow_the_game_order', () => {
    expect(orderedFamilies(['Time Trial', 'Brand Central', 'Licence', 'Brand Central', 'Arcade'])).toEqual(['Licence', 'Brand Central', 'Arcade', 'Time Trial']);
  });
});
