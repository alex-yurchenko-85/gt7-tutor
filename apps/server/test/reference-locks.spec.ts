import { describe, expect, it } from 'vitest';
import { ReferenceLocks } from '../src/references/reference-locks.js';

describe('reference locks', () => {
  it('holds_are_counted_and_a_second_release_does_nothing', async () => {
    const locks = new ReferenceLocks();
    const first = await locks.hold('r');
    const second = await locks.hold('r');
    first();
    first();
    expect(locks.held('r')).toBe(true);
    second();
    expect(locks.held('r')).toBe(false);
    expect(locks.held('other')).toBe(false);
  });

  it('deleting_is_refused_while_a_hold_exists', async () => {
    const locks = new ReferenceLocks();
    const release = await locks.hold('r');
    expect(locks.deleting(['other', 'r'])).toBeNull();
    release();
    expect(locks.deleting(['other', 'r'])).toEqual(expect.any(Function));
  });

  it('hold_waits_until_the_deletion_ends', async () => {
    const locks = new ReferenceLocks();
    const done = locks.deleting(['r'])!;
    let holding = false;
    const hold = locks.hold('r').then(release => {
      holding = true;
      return release;
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(holding).toBe(false);
    expect(locks.held('r')).toBe(false);
    done();
    done();
    (await hold)();
    expect(holding).toBe(true);
    expect(locks.held('r')).toBe(false);
  });
});
