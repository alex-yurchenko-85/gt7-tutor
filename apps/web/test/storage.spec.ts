import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStored, writeStored } from '../src/app/storage.ts';

describe('stored values', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('stored_value_is_kept_and_removed', () => {
    expect(readStored('gt7.sample')).toBeNull();
    writeStored('gt7.sample', 'one');
    expect(window.localStorage.getItem('gt7.sample')).toBe('one');
    expect(readStored('gt7.sample')).toBe('one');
    writeStored('gt7.sample', null);
    expect(readStored('gt7.sample')).toBeNull();
  });

  it('stored_value_survives_a_throwing_storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readStored('gt7.sample')).toBeNull();
    expect(() => writeStored('gt7.sample', 'one')).not.toThrow();
    expect(() => writeStored('gt7.sample', null)).not.toThrow();
  });
});
