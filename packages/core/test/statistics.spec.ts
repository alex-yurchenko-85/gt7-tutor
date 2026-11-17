import { describe, expect, it } from 'vitest';
import { median } from '../src/statistics.ts';

describe('median', () => {
  it('median_of_odd_even_and_empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNaN();
  });
});
