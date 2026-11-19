import { describe, expect, it } from 'vitest';
import { StepCursor } from '../src/step-cursor.ts';

function lookup(sM: number): string {
  if (sM >= 300) return 'c';
  if (sM >= 200) return 'b';
  if (sM >= 100) return 'a';
  return 'below';
}

describe('StepCursor', () => {
  const steps = [
    { fromM: 100, value: 'a' },
    { fromM: 200, value: 'b' },
    { fromM: 300, value: 'c' }
  ];

  it('step_cursor_gives_the_value_of_the_last_step_that_starts_at_or_before_the_place', () => {
    const cursor = new StepCursor('below', steps);
    const places = [0, 99.99, 100, 150, 199.99, 200, 250, 300, 1000];
    expect(places.map(sM => cursor.at(sM))).toEqual(places.map(lookup));
  });

  it('step_cursor_moves_back_and_jumps', () => {
    const cursor = new StepCursor('below', steps);
    const places = [350, 250, 150, 50, 320, 0, 205, 205, 199.5, 1e9, -1e9, 100, 300, 299.99];
    expect(places.map(sM => cursor.at(sM))).toEqual(places.map(lookup));
  });

  it('step_cursor_gives_the_value_below_for_nan_and_without_steps', () => {
    const cursor = new StepCursor('below', steps);
    expect(cursor.at(250)).toBe('b');
    expect(cursor.at(Number.NaN)).toBe('below');
    expect(cursor.at(250)).toBe('b');
    expect(new StepCursor<string | null>(null, []).at(500)).toBeNull();
  });
});
