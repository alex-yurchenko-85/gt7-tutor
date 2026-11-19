import { afterEach, describe, expect, it, vi } from 'vitest';
import { lastCatalogueCheck, rememberCatalogueCheck } from '../src/features/setup/catalogue-check.ts';

describe('catalogue check store', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('catalogue_check_is_empty_at_first', () => {
    expect(lastCatalogueCheck()).toBeNull();
  });

  it('catalogue_check_is_stored_and_read_back', () => {
    rememberCatalogueCheck({ at: '2026-11-18T13:52:07.000Z', result: 'No changes.' });
    expect(window.localStorage.getItem('gt7.catalogueCheck')).toBe('{"at":"2026-11-18T13:52:07.000Z","result":"No changes."}');
    expect(lastCatalogueCheck()).toEqual({ at: '2026-11-18T13:52:07.000Z', result: 'No changes.' });
  });

  it('catalogue_check_ignores_a_broken_value', () => {
    window.localStorage.setItem('gt7.catalogueCheck', '{"at":3}');
    expect(lastCatalogueCheck()).toBeNull();
    window.localStorage.setItem('gt7.catalogueCheck', 'not json');
    expect(lastCatalogueCheck()).toBeNull();
  });

  it('catalogue_check_store_survives_storage_errors', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => rememberCatalogueCheck({ at: '2026-11-18T13:52:07.000Z', result: 'No changes.' })).not.toThrow();
    expect(lastCatalogueCheck()).toBeNull();
  });
});
