import { describe, expect, it } from 'vitest';
import { orderedFamilies } from '../src/features/exercises/next-step.ts';

describe('next step', () => {
  it('families_follow_the_game_order', () => {
    expect(orderedFamilies(['Time Trial', 'Brand Central', 'Licence', 'Brand Central', 'Arcade'])).toEqual(['Licence', 'Brand Central', 'Arcade', 'Time Trial']);
  });
});
