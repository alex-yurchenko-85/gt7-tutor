import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStateRate, stateRate } from '../src/app/state-rate.ts';

describe('state rate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('state_rate_defaults_to_15', () => {
    expect(stateRate()).toBe(15);
  });

  it('state_rate_keeps_a_stored_choice', () => {
    setStateRate(60);
    expect(window.localStorage.getItem('gt7.stateRate')).toBe('60');
    expect(stateRate()).toBe(60);
  });

  it('state_rate_ignores_other_values', () => {
    window.localStorage.setItem('gt7.stateRate', '45');
    expect(stateRate()).toBe(15);
  });

  it('state_rate_survives_a_storage_error', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => setStateRate(30)).not.toThrow();
    expect(stateRate()).toBe(15);
  });
});
