import { describe, expect, it } from 'vitest';
import { eventually } from './eventually.ts';

describe('eventually', () => {
  it('eventually_returns_the_first_truthy_probe_value', async () => {
    let calls = 0;
    const value = await eventually(() => (++calls >= 3 ? 'ready' : null), 1000);
    expect(value).toBe('ready');
    expect(calls).toBe(3);
  });

  it('eventually_rejects_when_the_probe_never_succeeds', async () => {
    await expect(eventually(() => false, 60)).rejects.toThrow(/not met within 60 ms/);
  });
});
