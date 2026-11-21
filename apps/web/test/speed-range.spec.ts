import { describe, expect, it } from 'vitest';
import { speedRange } from '../src/features/races/speed-range.ts';

describe('speed range', () => {
  it('finds_the_range_of_many_laps_without_a_spread', () => {
    const lines = Array.from({ length: 300 }, (_, lap) => Array.from({ length: 10_000 }, (_, at) => (at === 5 && lap === 7 ? 300 : at === 9 ? null : 50 + (at % 3))));
    expect(speedRange(lines)).toEqual({ min: 50, max: 300 });
  });

  it('gives_null_without_a_value', () => {
    expect(speedRange([[null, null], []])).toBeNull();
  });
});
