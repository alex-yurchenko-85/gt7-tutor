import { describe, expect, it } from 'vitest';
import { dropOldest } from '../../src/drop-oldest.js';

describe('dropOldest', () => {
  it('drop_oldest_keeps_the_newest_entries_up_to_the_limit', () => {
    const map = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3]
    ]);
    dropOldest(map, 2);
    expect([...map.keys()]).toEqual(['b', 'c']);
    dropOldest(map, 2);
    expect([...map.keys()]).toEqual(['b', 'c']);
  });
});
