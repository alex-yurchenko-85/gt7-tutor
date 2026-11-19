import { describe, expect, it } from 'vitest';
import { median } from '../src/constants.ts';

describe('median', () => {
  it('median_of_even_and_odd_lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
