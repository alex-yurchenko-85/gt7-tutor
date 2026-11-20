import { describe, expect, it } from 'vitest';
import { median } from '../src/statistics.ts';

describe('median', () => {
  it('median_is_the_contracts_median_or_nan', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNaN();
  });
});
