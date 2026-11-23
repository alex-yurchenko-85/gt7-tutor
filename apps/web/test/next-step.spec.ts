import { describe, expect, it } from 'vitest';
import { exercise } from './fixtures.ts';
import { orderedFamilies, orderedExercises } from '../src/features/exercises/next-step.ts';

describe('next step', () => {
  it('families_follow_the_game_order', () => {
    expect(orderedFamilies(['Time Trial', 'Brand Central', 'Licence', 'Brand Central', 'Arcade'])).toEqual(['Licence', 'Brand Central', 'Arcade', 'Time Trial']);
  });

  it('exercises_follow_the_catalogue_order_and_own_exercises_come_last_by_creation_time', () => {
    const made = (name: string, catalogueId: string | null, createdAt: string) => exercise({ name, catalogueId, createdAt });
    const own = made('own late', null, '2026-11-14T10:00:00.000Z');
    const early = made('own early', null, '2026-11-13T10:00:00.000Z');
    const second = made('second', 'b', '2026-11-12T10:00:00.000Z');
    const first = made('first', 'a', '2026-11-15T10:00:00.000Z');
    const unknown = made('unknown', 'gone', '2026-11-12T12:00:00.000Z');
    expect(orderedExercises([own, second, unknown, early, first], ['a', 'b', 'c']).map(item => item.name)).toEqual(['first', 'second', 'unknown', 'own early', 'own late']);
  });
});
